-- P22.1 · Módulo B1 (geolocalización y corrección de fichajes) · base de datos
-- (Docs/Plan_Maestro/modulos/B_asistencia_avanzada.md, sección 3; decisiones B-02 a B-10, B-16,
-- B-20 a B-23, B-28 y B-36 a B-41).
--
-- Contenido, en orden:
--   1. Enumeraciones (`geo_status`, `geo_unvalidated_reason`, `attendance_correction_kind`) y
--      valores nuevos de `security_event_type`.
--   2. Columnas nuevas: `company_settings` (radio general, tope de precisión, fecha del texto de
--      consentimiento), `sites` (radio propio), `attendance_records` y `supervision_attendance`
--      (validación congelada, motivo del empleado, corrección de la validación).
--   3. `geo_distance_m` y `geo_evaluate` (B-36, B-06, B-23) y el auxiliar interno
--      `app.geo_for_site`.
--   4. Fichajes: `record_check_in`, `record_check_out`, `supervision_check_in` y
--      `supervision_check_out` evalúan y guardan la validación y aceptan `p_outside_reason`;
--      `admin_record_attendance` guarda `unvalidated` / `admin_record`.
--   5. `attendance_corrections` (B-41) y las RPC `correct_attendance_time` (B-28),
--      `override_geo_validation` (B-09) y `set_geofence_radius` (B-02).
--   6. Disparadores: `location_consent_updated_at` (B-22) y `security_events` por cambio de radio.
--   7. Vistas: `v_presence_today` (nueva) y la validación agregada al final de las vistas de
--      asistencia, del celular del empleado y del supervisor.
--   8. Validación única del historial (B-10).
--
-- Decisiones menores (también en el reporte del paquete):
--   - Radio terrestre de la fórmula haversine: 6 371 000 m (radio medio). La distancia se compara
--     sin redondear; `site_distance_m` guarda el entero más cercano (`floor(d + 0.5)`, igual que
--     `Math.round` en TypeScript).
--   - Si hay latitud y longitud pero la precisión es nula, `geo_evaluate` responde
--     `unvalidated` / `no_location`: sin precisión no se puede decidir (las RPC mandan siempre las
--     tres o ninguna, `COORDINATES_INCOMPLETE`).
--   - El radio vigente se guarda en todo fichaje evaluado (incluidos `no_location` y
--     `site_without_coords`); el registro de origen `admin` guarda distancia y radio nulos.
--   - La corrección de hora y la de validación exigen la capacidad `manage_attendance`, igual que
--     `admin_record_attendance` (el dueño la tiene siempre); el radio general, `app.require_admin`.
--   - El guardado de sede no tiene RPC (se edita con `update` directo bajo RLS): el radio propio
--     entra por esa misma vía, con `check` en la tabla y un disparador que deja el rastro.
--   - `attendance_records.time_corrected_at` (no está en la especificación): marca de corrección de
--     hora legible por cualquiera que vea el registro, sin dar acceso a `attendance_corrections`
--     (el empleado ve «Corregido» sin el motivo, B-28).

-- ---------------------------------------------------------------------------------------------
-- 1. Enumeraciones
-- ---------------------------------------------------------------------------------------------

create type public.geo_status as enum ('valid', 'outside', 'unvalidated');

create type public.geo_unvalidated_reason as enum (
  'no_location',
  'site_without_coords',
  'admin_record',
  'low_accuracy'
);

create type public.attendance_correction_kind as enum ('time', 'geo');

-- Se usan solo dentro de cuerpos de funciones y disparadores (se resuelven al ejecutarse).
alter type public.security_event_type add value if not exists 'attendance_time_corrected';
alter type public.security_event_type add value if not exists 'geo_validation_overridden';
alter type public.security_event_type add value if not exists 'geofence_radius_changed';

-- ---------------------------------------------------------------------------------------------
-- 2. Columnas nuevas
-- ---------------------------------------------------------------------------------------------

alter table public.company_settings
  add column geofence_radius_m smallint not null default 150,
  add column geofence_max_accuracy_m smallint not null default 150,
  add column location_consent_updated_at timestamptz,
  add constraint company_settings_geofence_radius_check check (geofence_radius_m between 50 and 1000),
  add constraint company_settings_geofence_max_accuracy_check check (geofence_max_accuracy_m between 1 and 5000);

comment on column public.company_settings.geofence_radius_m is
  'Radio general de validación por ubicación, en metros (B-02): 50 a 1000, 150 por defecto. Cada sede puede tener uno propio (sites.geofence_radius_m). Lo edita el dueño o un administrador (set_geofence_radius).';
comment on column public.company_settings.geofence_max_accuracy_m is
  'Tope de precisión del GPS, en metros (B-23): con una precisión peor, un fichaje que toca el círculo de la sede queda «Sin validar (precisión insuficiente)». Fijo por ahora, sin pantalla.';
comment on column public.company_settings.location_consent_updated_at is
  'Cuándo cambió por última vez location_consent_text (B-22). La app vuelve a mostrar el consentimiento si es posterior al de la persona. Lo mantiene el disparador enforce_company_settings_columns.';

alter table public.sites
  add column geofence_radius_m smallint,
  add constraint sites_geofence_radius_check check (geofence_radius_m is null or geofence_radius_m between 50 and 1000);

comment on column public.sites.geofence_radius_m is
  'Radio propio de validación de la sede, en metros (B-02): 50 a 1000. Nulo = usa el general de company_settings.';

-- attendance_records: validación congelada (B-08), motivo del empleado (B-04), corrección de la
-- validación (B-09) y marca de corrección de hora (B-28). Los valores por defecto hacen que un
-- insert directo (seed, tests) quede «Sin validar / sin ubicación», que es lo que corresponde a un
-- registro sin coordenadas; las RPC de fichaje siempre mandan los valores calculados.
alter table public.attendance_records
  add column geo_status public.geo_status not null default 'unvalidated',
  add column geo_unvalidated_reason public.geo_unvalidated_reason default 'no_location',
  add column site_distance_m integer,
  add column geofence_radius_m smallint,
  add column outside_reason text,
  add column geo_override_by uuid references public.profiles (id),
  add column geo_override_at timestamptz,
  add column geo_override_reason text,
  add column time_corrected_at timestamptz,
  add constraint attendance_records_geo_reason_check check (
    (geo_status = 'unvalidated') = (geo_unvalidated_reason is not null)
  ),
  add constraint attendance_records_outside_reason_check check (
    outside_reason is null or char_length(outside_reason) <= 300
  ),
  add constraint attendance_records_geo_override_check check (
    (geo_override_at is null and geo_override_by is null and geo_override_reason is null)
    or (geo_override_at is not null and geo_override_by is not null and geo_override_reason is not null)
  );

alter table public.supervision_attendance
  add column geo_status public.geo_status not null default 'unvalidated',
  add column geo_unvalidated_reason public.geo_unvalidated_reason default 'no_location',
  add column site_distance_m integer,
  add column geofence_radius_m smallint,
  add column outside_reason text,
  add column geo_override_by uuid references public.profiles (id),
  add column geo_override_at timestamptz,
  add column geo_override_reason text,
  add constraint supervision_attendance_geo_reason_check check (
    (geo_status = 'unvalidated') = (geo_unvalidated_reason is not null)
  ),
  add constraint supervision_attendance_outside_reason_check check (
    outside_reason is null or char_length(outside_reason) <= 300
  ),
  add constraint supervision_attendance_geo_override_check check (
    (geo_override_at is null and geo_override_by is null and geo_override_reason is null)
    or (geo_override_at is not null and geo_override_by is not null and geo_override_reason is not null)
  );

comment on column public.attendance_records.geo_status is
  'Resultado de la validación por ubicación al fichar (B-03, B-06, B-23), congelado: no se recalcula si cambian el radio o las coordenadas de la sede (B-08). La corrección de un administrador (B-09) no lo pisa: queda en geo_override_*.';
comment on column public.attendance_records.geo_unvalidated_reason is
  'Motivo de «Sin validar» (B-03): no_location, site_without_coords, admin_record o low_accuracy. Nulo si geo_status no es unvalidated.';
comment on column public.attendance_records.site_distance_m is
  'Distancia al punto de la sede, en metros enteros, al momento de fichar (B-08). Nula si no se pudo calcular.';
comment on column public.attendance_records.geofence_radius_m is
  'Radio vigente (el de la sede o el general) al momento de fichar (B-08). Nulo en los registros de origen admin.';
comment on column public.attendance_records.outside_reason is
  'Motivo opcional escrito por la persona cuando quedó «Fuera de zona» (B-04). Máximo 300 caracteres.';
comment on column public.attendance_records.geo_override_by is
  'Quién marcó el fichaje como válido (B-09). Junto con geo_override_at y geo_override_reason; el detalle queda también en attendance_corrections (kind = geo).';
comment on column public.attendance_records.time_corrected_at is
  'Cuándo se corrigió la hora de este registro (B-28). Nulo si nunca se corrigió. El valor anterior y el motivo están en attendance_corrections (solo administración).';
comment on column public.supervision_attendance.geo_status is
  'Resultado de la validación por ubicación del fichaje de la supervisión, contra la sede supervisada (B-07, B-08). Mismo significado que attendance_records.geo_status.';

-- «Solo fuera de zona» (B-20) y aviso de «Requiere atención» (B-21).
create index attendance_records_geo_outside_idx
  on public.attendance_records (recorded_at) where geo_status = 'outside';

-- ---------------------------------------------------------------------------------------------
-- 3. geo_distance_m, geo_evaluate y app.geo_for_site
-- ---------------------------------------------------------------------------------------------

-- Haversine con radio terrestre de 6 371 000 m (B-36), en doble precisión:
--   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2);  d = 2 · R · asin(min(1, √a))
create function public.geo_distance_m(
  p_lat1 numeric,
  p_lng1 numeric,
  p_lat2 numeric,
  p_lng2 numeric
)
returns double precision
language sql
immutable
parallel safe
set search_path = public, app, pg_temp
as $$
  select 2 * 6371000::double precision * asin(least(1::double precision, sqrt(
    power(sin(radians(p_lat2::double precision - p_lat1::double precision) / 2), 2)
    + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
      * power(sin(radians(p_lng2::double precision - p_lng1::double precision) / 2), 2)
  )));
$$;

comment on function public.geo_distance_m(numeric, numeric, numeric, numeric) is
  'Distancia en metros entre dos puntos (haversine, radio terrestre 6 371 000 m, doble precisión) sin PostGIS (B-36). Inmutable. Devuelve null si algún argumento es nulo.';

-- B-06 + B-23. El origen «admin» no pasa por acá: lo resuelve quien llama (unvalidated / admin_record).
--   - sin coordenadas del fichaje (o sin precisión)  -> unvalidated / no_location
--   - sede sin coordenadas                            -> unvalidated / site_without_coords
--   - d > radio + precisión                           -> outside
--   - d <= radio + precisión y precisión <= tope      -> valid
--   - d <= radio + precisión y precisión > tope       -> unvalidated / low_accuracy
create function public.geo_evaluate(
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_site_lat numeric,
  p_site_lng numeric,
  p_radius integer,
  p_max_accuracy integer default 150
)
returns table (
  status public.geo_status,
  reason public.geo_unvalidated_reason,
  distance_m integer
)
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
declare
  v_d double precision;
  v_distance integer;
begin
  if p_lat is null or p_lng is null or p_accuracy is null then
    return query select 'unvalidated'::public.geo_status, 'no_location'::public.geo_unvalidated_reason, null::integer;
    return;
  end if;

  if p_site_lat is null or p_site_lng is null then
    return query select 'unvalidated'::public.geo_status, 'site_without_coords'::public.geo_unvalidated_reason, null::integer;
    return;
  end if;

  if p_radius is null or p_max_accuracy is null then
    raise exception 'geo_evaluate: el radio y el tope de precisión son obligatorios.'
      using errcode = '22023';
  end if;

  v_d := public.geo_distance_m(p_lat, p_lng, p_site_lat, p_site_lng);
  v_distance := floor(v_d + 0.5)::integer;

  -- La suma radio + precisión se hace en decimal exacto y recién después pasa a doble precisión.
  if v_d > (p_radius + p_accuracy)::double precision then
    return query select 'outside'::public.geo_status, null::public.geo_unvalidated_reason, v_distance;
  elsif p_accuracy <= p_max_accuracy then
    return query select 'valid'::public.geo_status, null::public.geo_unvalidated_reason, v_distance;
  else
    return query select 'unvalidated'::public.geo_status, 'low_accuracy'::public.geo_unvalidated_reason, v_distance;
  end if;
end;
$$;

comment on function public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer) is
  'Validación por ubicación de un fichaje (B-06, B-23, B-36). Devuelve estado, motivo (solo si es unvalidated) y distancia en metros enteros. Inmutable; el frontend replica la misma fórmula en TypeScript.';

-- Auxiliar interno: evalúa contra una sede con el radio vigente (propio o general) y el tope general.
create function app.geo_for_site(
  p_site_id uuid,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric
)
returns table (
  status public.geo_status,
  reason public.geo_unvalidated_reason,
  distance_m integer,
  radius_m smallint
)
language sql
stable
set search_path = public, app, pg_temp
as $$
  select g.status, g.reason, g.distance_m, r.radius_m
  from (
    select
      si.latitude as site_lat,
      si.longitude as site_lng,
      coalesce(si.geofence_radius_m, cs.geofence_radius_m) as radius_m,
      cs.geofence_max_accuracy_m as max_accuracy_m
    from public.company_settings cs
    left join public.sites si on si.id = p_site_id
    where cs.id = 1
  ) r
  cross join lateral public.geo_evaluate(
    p_lat, p_lng, p_accuracy, r.site_lat, r.site_lng, r.radius_m, r.max_accuracy_m
  ) g;
$$;

comment on function app.geo_for_site(uuid, numeric, numeric, numeric) is
  'Uso interno: geo_evaluate contra una sede con el radio vigente (propio o general) y el tope de precisión de company_settings. Devuelve además el radio aplicado (radius_m).';

revoke execute on function app.geo_for_site(uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.geo_distance_m(numeric, numeric, numeric, numeric) from public, anon;
grant execute on function public.geo_distance_m(numeric, numeric, numeric, numeric) to authenticated;
revoke execute on function public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer) from public, anon;
grant execute on function public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Fichajes con validación (B-04, B-06, B-07, B-08, B-23, B-37)
-- ---------------------------------------------------------------------------------------------

-- Cada RPC gana `p_outside_reason text default null` (motivo opcional, solo se guarda si el
-- resultado es «outside»; máximo 300 caracteres, OUTSIDE_REASON_TOO_LONG). Como cambia la firma, se
-- elimina la versión anterior para no dejar una sobrecarga que haría ambiguo el llamado de
-- PostgREST. El resto del cuerpo es el vigente (0026, 0029 y sus ajustes posteriores).
drop function public.record_check_in(uuid, numeric, numeric, numeric);
drop function public.record_check_out(uuid, numeric, numeric, numeric);
drop function public.supervision_check_in(uuid, numeric, numeric, numeric);
drop function public.supervision_check_out(uuid, numeric, numeric, numeric);

create function public.record_check_in(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_record public.attendance_records;
  v_geo record;
  v_outside_reason text;
begin
  perform app.require_role('employee');

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_assignment.employee_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no es tuya.',
      hint = 'NOT_YOUR_ASSIGNMENT';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if v_shift.status = 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó.',
      hint = 'SHIFT_COMPLETED';
  end if;

  if v_shift.shift_date <> app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no es de hoy.',
      hint = 'NOT_TODAY';
  end if;

  if (p_lat is not null or p_lng is not null or p_accuracy is not null)
    and (p_lat is null or p_lng is null or p_accuracy is null)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Si mandás la ubicación, tiene que venir completa.',
      hint = 'COORDINATES_INCOMPLETE';
  end if;

  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
    or (p_lng is not null and (p_lng < -180 or p_lng > 180))
    or (p_accuracy is not null and p_accuracy < 0)
  then
    raise exception using
      errcode = 'P0001',
      message = 'La ubicación recibida no es válida.',
      hint = 'COORDINATES_OUT_OF_RANGE';
  end if;

  v_outside_reason := nullif(btrim(p_outside_reason), '');
  if v_outside_reason is not null and char_length(v_outside_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'OUTSIDE_REASON_TOO_LONG';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.assignment_id = p_assignment_id and ar.kind = 'check_in'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el inicio.',
      hint = 'ALREADY_CHECKED_IN';
  end if;

  -- Validación por ubicación (B-06, B-23): la calcula la base y queda congelada (B-08).
  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_assignment_id, 'check_in', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid(),
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  update public.assignments
  set status = 'present', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.start_shift_if_needed(v_shift.id);

  return v_record;
end;
$$;

comment on function public.record_check_in(uuid, numeric, numeric, numeric, text) is
  'Registra el inicio de una asignación con la hora del servidor y la validación por ubicación (B-04 a B-08, B-23; 06 sección 10). E (propia). Devuelve el registro con geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m y outside_reason. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, SHIFT_COMPLETED, NOT_TODAY, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG, ALREADY_CHECKED_IN.';

create function public.record_check_out(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_record public.attendance_records;
  v_geo record;
  v_outside_reason text;
begin
  perform app.require_role('employee');

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_assignment.employee_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no es tuya.',
      hint = 'NOT_YOUR_ASSIGNMENT';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if not exists (
    select 1 from public.attendance_records ar
    where ar.assignment_id = p_assignment_id and ar.kind = 'check_in'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no registraste el inicio.',
      hint = 'NOT_CHECKED_IN';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.assignment_id = p_assignment_id and ar.kind = 'check_out'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el fin.',
      hint = 'ALREADY_CHECKED_OUT';
  end if;

  if v_shift.open_ended and v_assignment.end_time is null and now() >= upper(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El día del turno ya terminó y quedó sin salida: pedile a un administrador que cargue tu hora de salida.',
      hint = 'OPEN_SHIFT_DAY_ENDED';
  end if;

  if (p_lat is not null or p_lng is not null or p_accuracy is not null)
    and (p_lat is null or p_lng is null or p_accuracy is null)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Si mandás la ubicación, tiene que venir completa.',
      hint = 'COORDINATES_INCOMPLETE';
  end if;

  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
    or (p_lng is not null and (p_lng < -180 or p_lng > 180))
    or (p_accuracy is not null and p_accuracy < 0)
  then
    raise exception using
      errcode = 'P0001',
      message = 'La ubicación recibida no es válida.',
      hint = 'COORDINATES_OUT_OF_RANGE';
  end if;

  v_outside_reason := nullif(btrim(p_outside_reason), '');
  if v_outside_reason is not null and char_length(v_outside_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'OUTSIDE_REASON_TOO_LONG';
  end if;

  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_assignment_id, 'check_out', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid(),
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  update public.assignments
  set status = 'finished', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.complete_shift_if_done(v_shift.id);

  return v_record;
end;
$$;

comment on function public.record_check_out(uuid, numeric, numeric, numeric, text) is
  'Registra el fin de una asignación con la hora del servidor y la validación por ubicación (B-04 a B-08, B-23; 06 sección 10). E (propia). Devuelve el registro con la validación. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, OPEN_SHIFT_DAY_ENDED, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG.';

create function public.supervision_check_in(
  p_supervision_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.supervision_attendance
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_shift public.shifts;
  v_criteria jsonb;
  v_record public.supervision_attendance;
  v_geo record;
  v_outside_reason text;
begin
  perform app.require_role('supervisor');

  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_supervision.supervisor_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión no es tuya.',
      hint = 'NOT_YOUR_SUPERVISION';
  end if;

  if v_supervision.status in ('in_progress', 'completed') then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el inicio de esta supervisión.',
      hint = 'ALREADY_STARTED';
  end if;

  if v_supervision.status in ('not_done', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  select * into v_shift from public.shifts where id = v_supervision.shift_id;

  -- Fecha del turno = hoy, mismo criterio que record_check_in (P-068, 0026).
  if v_shift.shift_date <> app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no es de hoy.',
      hint = 'NOT_TODAY';
  end if;

  if (p_lat is not null or p_lng is not null or p_accuracy is not null)
    and (p_lat is null or p_lng is null or p_accuracy is null)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Si mandás la ubicación, tiene que venir completa.',
      hint = 'COORDINATES_INCOMPLETE';
  end if;

  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
    or (p_lng is not null and (p_lng < -180 or p_lng > 180))
    or (p_accuracy is not null and p_accuracy < 0)
  then
    raise exception using
      errcode = 'P0001',
      message = 'La ubicación recibida no es válida.',
      hint = 'COORDINATES_OUT_OF_RANGE';
  end if;

  v_outside_reason := nullif(btrim(p_outside_reason), '');
  if v_outside_reason is not null and char_length(v_outside_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'OUTSIDE_REASON_TOO_LONG';
  end if;

  -- criteria_snapshot (P-087): criterios de rating_criteria vigentes hoy, ordenados por position.
  select coalesce(
      jsonb_agg(
        jsonb_build_object('id', rc.id, 'title', rc.title, 'description', rc.description, 'position', rc.position)
        order by rc.position
      ),
      '[]'::jsonb
    )
    into v_criteria
  from public.rating_criteria rc
  where rc.valid_from <= app.today() and (rc.valid_to is null or rc.valid_to >= app.today());

  -- Validación contra la sede supervisada (B-07).
  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);

  insert into public.supervision_attendance (
    supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_supervision_id, 'check_in', now(), p_lat, p_lng, p_accuracy,
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  update public.supervisions
  set status = 'in_progress', criteria_snapshot = v_criteria, updated_by = auth.uid()
  where id = p_supervision_id;

  return v_record;
end;
$$;

comment on function public.supervision_check_in(uuid, numeric, numeric, numeric, text) is
  'Registra el inicio de una supervisión con la hora del servidor y la validación contra la sede supervisada (B-07, B-08). S (propia). Devuelve el registro con la validación. SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, ALREADY_STARTED, SUPERVISION_NOT_EDITABLE, NOT_TODAY, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG.';

create function public.supervision_check_out(
  p_supervision_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.supervision_attendance
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_site_id uuid;
  v_record public.supervision_attendance;
  v_geo record;
  v_outside_reason text;
begin
  perform app.require_role('supervisor');

  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_supervision.supervisor_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión no es tuya.',
      hint = 'NOT_YOUR_SUPERVISION';
  end if;

  if v_supervision.status = 'assigned' then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no registraste el inicio.',
      hint = 'NOT_STARTED';
  end if;

  if v_supervision.status <> 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  if exists (
    select 1 from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el fin.',
      hint = 'ALREADY_CHECKED_OUT';
  end if;

  if (p_lat is not null or p_lng is not null or p_accuracy is not null)
    and (p_lat is null or p_lng is null or p_accuracy is null)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Si mandás la ubicación, tiene que venir completa.',
      hint = 'COORDINATES_INCOMPLETE';
  end if;

  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
    or (p_lng is not null and (p_lng < -180 or p_lng > 180))
    or (p_accuracy is not null and p_accuracy < 0)
  then
    raise exception using
      errcode = 'P0001',
      message = 'La ubicación recibida no es válida.',
      hint = 'COORDINATES_OUT_OF_RANGE';
  end if;

  v_outside_reason := nullif(btrim(p_outside_reason), '');
  if v_outside_reason is not null and char_length(v_outside_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'OUTSIDE_REASON_TOO_LONG';
  end if;

  select sh.site_id into v_site_id from public.shifts sh where sh.id = v_supervision.shift_id;

  select * into v_geo from app.geo_for_site(v_site_id, p_lat, p_lng, p_accuracy);

  insert into public.supervision_attendance (
    supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_supervision_id, 'check_out', now(), p_lat, p_lng, p_accuracy,
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  return v_record;
end;
$$;

comment on function public.supervision_check_out(uuid, numeric, numeric, numeric, text) is
  'Registra el fin de una supervisión con la hora del servidor y la validación contra la sede supervisada (B-07, B-08). S (propia). Devuelve el registro con la validación. SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, NOT_STARTED, SUPERVISION_NOT_EDITABLE, ALREADY_CHECKED_OUT, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG.';

revoke execute on function public.record_check_in(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.record_check_in(uuid, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.record_check_out(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.record_check_out(uuid, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.supervision_check_in(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.supervision_check_in(uuid, numeric, numeric, numeric, text) to authenticated;
revoke execute on function public.supervision_check_out(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.supervision_check_out(uuid, numeric, numeric, numeric, text) to authenticated;

-- admin_record_attendance (misma firma, 0027 y ajustes): el registro de origen admin queda sin
-- validar con el motivo `admin_record` y sin distancia ni radio (B-03, B-23).
create or replace function public.admin_record_attendance(
  p_assignment_id uuid,
  p_kind public.attendance_kind,
  p_at timestamptz default null,
  p_reason text default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_at timestamptz;
  v_min_at timestamptz;
  v_check_in public.attendance_records;
  v_record public.attendance_records;
begin
  perform app.require_capability('manage_attendance');

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if v_shift.status = 'completed' and p_kind = 'check_in' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó.',
      hint = 'SHIFT_COMPLETED';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  -- Hora editable (decisión de Mike, 26 sep 2026, P14.0): desde las 0:00 del día del turno
  -- (Argentina) hasta el momento de la carga, nunca futura.
  v_at := coalesce(p_at, now());
  v_min_at := app.local_ts(v_shift.shift_date, '00:00'::time);

  if v_at < v_min_at or v_at > now() then
    raise exception using
      errcode = 'P0001',
      message = 'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if p_kind = 'check_in' then
    if exists (
      select 1 from public.attendance_records ar
      where ar.assignment_id = p_assignment_id and ar.kind = 'check_in'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Ya registraste el inicio.',
        hint = 'ALREADY_CHECKED_IN';
    end if;

    insert into public.attendance_records (
      assignment_id, kind, recorded_at, source, recorded_by, reason,
      geo_status, geo_unvalidated_reason
    )
    values (p_assignment_id, 'check_in', v_at, 'admin', auth.uid(), p_reason, 'unvalidated', 'admin_record')
    returning * into v_record;

    update public.assignments
    set status = 'present', updated_by = auth.uid()
    where id = p_assignment_id;

    perform app.start_shift_if_needed(v_shift.id);
  else
    select * into v_check_in from public.attendance_records
    where assignment_id = p_assignment_id and kind = 'check_in';

    if v_check_in.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'Todavía no registraste el inicio.',
        hint = 'NOT_CHECKED_IN';
    end if;

    if exists (
      select 1 from public.attendance_records ar
      where ar.assignment_id = p_assignment_id and ar.kind = 'check_out'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Ya registraste el fin.',
        hint = 'ALREADY_CHECKED_OUT';
    end if;

    if v_at <= v_check_in.recorded_at then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de fin tiene que ser posterior a la de inicio.',
        hint = 'INVALID_TIME_RANGE';
    end if;

    insert into public.attendance_records (
      assignment_id, kind, recorded_at, source, recorded_by, reason,
      geo_status, geo_unvalidated_reason
    )
    values (p_assignment_id, 'check_out', v_at, 'admin', auth.uid(), p_reason, 'unvalidated', 'admin_record')
    returning * into v_record;

    update public.assignments
    set status = 'finished', updated_by = auth.uid()
    where id = p_assignment_id;

    perform app.complete_shift_if_done(v_shift.id);
  end if;

  return v_record;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. attendance_corrections y las RPC de corrección (B-09, B-28, B-41)
-- ---------------------------------------------------------------------------------------------

-- La constancia de cada corrección. El registro de asistencia guarda el valor vigente; acá queda
-- el anterior, quién y cuándo (nada se pisa ni se borra, P-014). Solo lectura para dueño y
-- administradores: sin políticas de insert, update ni delete (solo las RPC security definer).
create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid not null references public.attendance_records (id),
  kind public.attendance_correction_kind not null,
  old_recorded_at timestamptz,
  new_recorded_at timestamptz,
  reason text not null,
  corrected_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint attendance_corrections_reason_check check (btrim(reason) <> ''),
  constraint attendance_corrections_time_check check (
    kind <> 'time' or (old_recorded_at is not null and new_recorded_at is not null)
  )
);

comment on table public.attendance_corrections is
  'Correcciones de fichajes (B-41): kind = time guarda el instante anterior y el nuevo (B-28); kind = geo deja la constancia de la validación marcada como válida (B-09, el detalle vigente está en attendance_records.geo_override_*). Motivo obligatorio. Solo la leen el dueño y los administradores; solo la escriben correct_attendance_time y override_geo_validation. Sin delete.';

create index attendance_corrections_record_idx
  on public.attendance_corrections (attendance_record_id, created_at desc);

alter table public.attendance_corrections enable row level security;

create policy attendance_corrections_select_admin
  on public.attendance_corrections for select to authenticated
  using ((select app.is_admin()));

revoke all on public.attendance_corrections from public, anon, authenticated;
grant select on public.attendance_corrections to authenticated;

-- B-28 · correct_attendance_time(record_id, new_time, reason). Regla de hora de
-- admin_record_attendance: desde las 0:00 del día del turno (Argentina) hasta ahora, nunca futura;
-- además, el inicio sigue siendo anterior al fin.
create function public.correct_attendance_time(
  p_record_id uuid,
  p_new_time timestamptz,
  p_reason text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_record public.attendance_records;
  v_shift public.shifts;
  v_other public.attendance_records;
  v_reason text;
  v_old timestamptz;
begin
  perform app.require_capability('manage_attendance');

  select * into v_record from public.attendance_records where id = p_record_id for update;

  if v_record.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese registro.',
      hint = 'RECORD_NOT_FOUND';
  end if;

  select sh.* into v_shift
  from public.assignments a
  join public.shifts sh on sh.id = a.shift_id
  where a.id = v_record.assignment_id
  for update of sh;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_new_time is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la hora nueva.',
      hint = 'TIME_REQUIRED';
  end if;

  if p_new_time < app.local_ts(v_shift.shift_date, '00:00'::time) or p_new_time > now() then
    raise exception using
      errcode = 'P0001',
      message = 'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if p_new_time = v_record.recorded_at then
    raise exception using
      errcode = 'P0001',
      message = 'La hora nueva es igual a la actual.',
      hint = 'SAME_TIME';
  end if;

  -- El inicio tiene que seguir siendo anterior al fin.
  select * into v_other
  from public.attendance_records
  where assignment_id = v_record.assignment_id
    and kind = case when v_record.kind = 'check_in' then 'check_out'::public.attendance_kind
                    else 'check_in'::public.attendance_kind end;

  if v_other.id is not null then
    if (v_record.kind = 'check_in' and p_new_time >= v_other.recorded_at)
      or (v_record.kind = 'check_out' and p_new_time <= v_other.recorded_at)
    then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de fin tiene que ser posterior a la de inicio.',
        hint = 'INVALID_TIME_RANGE';
    end if;
  end if;

  v_old := v_record.recorded_at;

  insert into public.attendance_corrections (
    attendance_record_id, kind, old_recorded_at, new_recorded_at, reason, corrected_by
  )
  values (v_record.id, 'time', v_old, p_new_time, v_reason, auth.uid());

  update public.attendance_records
  set recorded_at = p_new_time, time_corrected_at = now()
  where id = v_record.id
  returning * into v_record;

  perform app.log_security_event(
    'attendance_time_corrected',
    auth.uid(),
    v_record.id,
    jsonb_build_object(
      'assignment_id', v_record.assignment_id,
      'kind', v_record.kind,
      'old_recorded_at', v_old,
      'new_recorded_at', p_new_time,
      'reason', v_reason
    )
  );

  return v_record;
end;
$$;

comment on function public.correct_attendance_time(uuid, timestamptz, text) is
  'Corrige la hora de un inicio o fin ya registrado (B-28, B-41). O, A con manage_attendance (FORBIDDEN si no). RECORD_NOT_FOUND, SHIFT_CANCELLED, REASON_REQUIRED, TIME_REQUIRED, AT_OUT_OF_RANGE (entre las 0:00 del día del turno y ahora), SAME_TIME, INVALID_TIME_RANGE (el inicio tiene que ser anterior al fin). Guarda el valor anterior en attendance_corrections, marca time_corrected_at y registra attendance_time_corrected en security_events. Devuelve el registro actualizado.';

-- B-09 · override_geo_validation(record_type, record_id, reason). record_type: 'attendance'
-- (attendance_records) o 'supervision' (supervision_attendance). El resultado original se
-- conserva; se registra quién, cuándo y por qué.
create function public.override_geo_validation(
  p_record_type text,
  p_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_reason text;
  v_att public.attendance_records;
  v_sup public.supervision_attendance;
  v_result jsonb;
  v_original public.geo_status;
begin
  perform app.require_capability('manage_attendance');

  if p_record_type is null or p_record_type not in ('attendance', 'supervision') then
    raise exception using
      errcode = 'P0001',
      message = 'El tipo de registro no es válido.',
      hint = 'INVALID_RECORD_TYPE';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_record_type = 'attendance' then
    select * into v_att from public.attendance_records where id = p_record_id for update;

    if v_att.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos ese registro.',
        hint = 'RECORD_NOT_FOUND';
    end if;

    v_original := v_att.geo_status;

    if v_att.geo_status = 'valid' then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya está validado.',
        hint = 'GEO_ALREADY_VALID';
    end if;

    if v_att.geo_override_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya fue marcado como válido.',
        hint = 'GEO_ALREADY_OVERRIDDEN';
    end if;

    update public.attendance_records
    set geo_override_by = auth.uid(), geo_override_at = now(), geo_override_reason = v_reason
    where id = v_att.id
    returning * into v_att;

    insert into public.attendance_corrections (attendance_record_id, kind, reason, corrected_by)
    values (v_att.id, 'geo', v_reason, auth.uid());

    v_result := to_jsonb(v_att);
  else
    select * into v_sup from public.supervision_attendance where id = p_record_id for update;

    if v_sup.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos ese registro.',
        hint = 'RECORD_NOT_FOUND';
    end if;

    v_original := v_sup.geo_status;

    if v_sup.geo_status = 'valid' then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya está validado.',
        hint = 'GEO_ALREADY_VALID';
    end if;

    if v_sup.geo_override_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya fue marcado como válido.',
        hint = 'GEO_ALREADY_OVERRIDDEN';
    end if;

    update public.supervision_attendance
    set geo_override_by = auth.uid(), geo_override_at = now(), geo_override_reason = v_reason
    where id = v_sup.id
    returning * into v_sup;

    v_result := to_jsonb(v_sup);
  end if;

  perform app.log_security_event(
    'geo_validation_overridden',
    auth.uid(),
    p_record_id,
    jsonb_build_object(
      'record_type', p_record_type,
      'original_geo_status', v_original,
      'reason', v_reason
    )
  );

  return v_result;
end;
$$;

comment on function public.override_geo_validation(text, uuid, text) is
  'Marca como válido un fichaje fuera de zona o sin validar (B-09, B-41). p_record_type: attendance | supervision (INVALID_RECORD_TYPE). O, A con manage_attendance (FORBIDDEN si no). REASON_REQUIRED, RECORD_NOT_FOUND, GEO_ALREADY_VALID, GEO_ALREADY_OVERRIDDEN. El resultado original se conserva (geo_status); se guardan geo_override_by/at/reason, la constancia en attendance_corrections (solo attendance) y el evento geo_validation_overridden. Devuelve el registro actualizado como jsonb.';

-- B-02 · radio general. Lo editan el dueño y los administradores.
create function public.set_geofence_radius(p_radius integer)
returns public.company_settings
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_settings public.company_settings;
begin
  perform app.require_admin();

  if p_radius is null or p_radius < 50 or p_radius > 1000 then
    raise exception using
      errcode = 'P0001',
      message = 'El radio tiene que estar entre 50 y 1000 metros.',
      hint = 'RADIUS_OUT_OF_RANGE';
  end if;

  update public.company_settings
  set geofence_radius_m = p_radius, updated_by = auth.uid()
  where id = 1
  returning * into v_settings;

  return v_settings;
end;
$$;

comment on function public.set_geofence_radius(integer) is
  'Cambia el radio general de validación (B-02). O, A (FORBIDDEN si no). RADIUS_OUT_OF_RANGE fuera de 50 a 1000 m. No recalcula los fichajes anteriores (B-08). El cambio queda en security_events (geofence_radius_changed) por el disparador de company_settings. Devuelve company_settings.';

revoke execute on function public.correct_attendance_time(uuid, timestamptz, text) from public, anon;
grant execute on function public.correct_attendance_time(uuid, timestamptz, text) to authenticated;
revoke execute on function public.override_geo_validation(text, uuid, text) from public, anon;
grant execute on function public.override_geo_validation(text, uuid, text) to authenticated;
revoke execute on function public.set_geofence_radius(integer) from public, anon;
grant execute on function public.set_geofence_radius(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Disparadores: texto de consentimiento (B-22) y rastro de cambios de radio (B-02)
-- ---------------------------------------------------------------------------------------------

-- Misma función de 0030 (DEF-P01), con una línea nueva: cuando cambia el texto de consentimiento
-- se actualiza location_consent_updated_at (también para service_role y postgres).
create or replace function app.enforce_company_settings_columns()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if auth.uid() is not null and not app.has_role('owner') then
    if new.name is distinct from old.name
      or new.support_phone is distinct from old.support_phone
      or new.location_consent_text is distinct from old.location_consent_text
    then
      raise exception using
        errcode = 'P0001',
        message = 'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
        hint = 'FORBIDDEN';
    end if;
  end if;

  -- B-22: cuando cambia el texto, la app lo vuelve a mostrar a cada persona.
  if new.location_consent_text is distinct from old.location_consent_text then
    new.location_consent_updated_at := now();
  end if;

  return new;
end;
$$;

comment on function app.enforce_company_settings_columns() is
  'Trigger BEFORE UPDATE en company_settings (0030, DEF-P01; 0052, B-22): una sesión que no es owner solo puede cambiar logo_path y el radio de validación (y updated_by/updated_at). Si cambia location_consent_text, actualiza location_consent_updated_at. service_role y postgres quedan afuera de la restricción.';

create function app.log_geofence_radius_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_table_name = 'sites' then
    perform app.log_security_event(
      'geofence_radius_changed',
      auth.uid(),
      new.id,
      jsonb_build_object('scope', 'site', 'site_id', new.id, 'old', old.geofence_radius_m, 'new', new.geofence_radius_m)
    );
  else
    perform app.log_security_event(
      'geofence_radius_changed',
      auth.uid(),
      null,
      jsonb_build_object('scope', 'company', 'old', old.geofence_radius_m, 'new', new.geofence_radius_m)
    );
  end if;
  return new;
end;
$$;

comment on function app.log_geofence_radius_change() is
  'Trigger AFTER UPDATE (0052, B-02): registra geofence_radius_changed en security_events cuando cambia el radio general (company_settings) o el propio de una sede (sites), venga de set_geofence_radius o de un update directo.';

create trigger trg_log_geofence_radius_change
after update on public.company_settings
for each row
when (old.geofence_radius_m is distinct from new.geofence_radius_m)
execute function app.log_geofence_radius_change();

create trigger trg_log_geofence_radius_change
after update on public.sites
for each row
when (old.geofence_radius_m is distinct from new.geofence_radius_m)
execute function app.log_geofence_radius_change();

-- ---------------------------------------------------------------------------------------------
-- 7. Vistas: la validación y la marca de corrección, siempre al final de cada vista
-- ---------------------------------------------------------------------------------------------

-- v_assignments_board: columnas nuevas al final (create or replace view solo admite agregar al final).
create or replace view public.v_assignments_board
with (security_invoker = true)
as
SELECT a.id,
    a.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    a.employee_id,
    p.first_name AS employee_first_name,
    p.last_name AS employee_last_name,
    p.avatar_path AS employee_avatar_path,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
        CASE
            WHEN ((ci.recorded_at IS NOT NULL) AND (ci.recorded_at > lower(a."window"))) THEN (round((EXTRACT(epoch FROM (ci.recorded_at - lower(a."window"))) / (60)::numeric)))::integer
            ELSE NULL::integer
        END AS minutes_late,
        CASE
            WHEN (sh.open_ended AND (a.end_time IS NULL)) THEN NULL::integer
            WHEN ((co.recorded_at IS NOT NULL) AND (co.recorded_at < upper(a."window"))) THEN (round((EXTRACT(epoch FROM (upper(a."window") - co.recorded_at)) / (60)::numeric)))::integer
            ELSE NULL::integer
        END AS minutes_early_leave,
        CASE
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (notice.kind = 'on_the_way'::notice_kind) AND (ci.recorded_at IS NULL) AND (now() < upper(a."window")) AND (now() <= (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes())))) THEN 'on_the_way'::text
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (now() > lower(a."window")) AND (now() <= (lower(a."window") + make_interval(mins => app.late_grace_minutes())))) THEN 'late'::text
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (now() > lower(a."window"))) THEN 'no_record'::text
            WHEN ((a.status = 'present'::assignment_status) AND (a.removed_at IS NULL) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) THEN 'no_checkout'::text
            ELSE (a.status)::text
        END AS display_status,
    a.removed_at,
    a.removed_by,
    a.removed_reason,
    a.created_at,
    a.updated_at,
    a.created_by,
    a.updated_by,
    ci.source AS check_in_source,
    ci.recorded_by AS check_in_recorded_by,
    co.source AS check_out_source,
    co.recorded_by AS check_out_recorded_by,
    notice.kind AS last_notice_kind,
    notice.minutes_late AS last_notice_minutes_late,
    notice.reason_code AS last_notice_reason_code,
    notice.reason_text AS last_notice_reason_text,
    notice.reported_by AS last_notice_reported_by,
    notice.source AS last_notice_source,
    notice.created_at AS last_notice_at,
    notice.estimated_arrival_at AS last_notice_estimated_arrival_at,
        CASE
            WHEN (sh.open_ended AND (a.end_time IS NULL)) THEN NULL::integer
            ELSE app.minutes_between(lower(a."window"), upper(a."window"))
        END AS planned_minutes,
        CASE
            WHEN ((a.status = 'present'::assignment_status) AND (a.removed_at IS NULL) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) THEN 0
            ELSE app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window"))
        END AS worked_minutes,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
        CASE
            WHEN o.show_in_print THEN NULLIF(btrim(o.observation), ''::text)
            ELSE NULL::text
        END AS shift_observation,
    ci.id as check_in_record_id,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    ci.accuracy_m as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    co.accuracy_m as check_out_accuracy_m,
    co.outside_reason as check_out_outside_reason,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected,
    coalesce((ci.geo_status = 'outside' and ci.geo_override_at is null) or (co.geo_status = 'outside' and co.geo_override_at is null), false) as has_outside_geo
   FROM ((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     LEFT JOIN shift_observations o ON ((o.shift_id = sh.id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT an.kind,
            an.minutes_late,
            an.reason_code,
            an.reason_text,
            an.reported_by,
            an.source,
            an.created_at,
            an.estimated_arrival_at
           FROM attendance_notices an
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true));

comment on view public.v_assignments_board is 'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status deriva (no se persiste), sobre expected/delay_notified sin inicio registrado y en este orden: on_the_way (último aviso en camino, franja sin terminar y now() <= vencimiento del aviso: hora estimada + app.late_grace_minutes(), o inicio efectivo + app.late_grace_minutes() si no indicó estimación; 0034), late («Llegada tarde»: pasó el inicio efectivo hace app.late_grace_minutes() = 15 minutos o menos, P19.5a) y no_record (más de esos minutos, P-071); no_checkout («Sin salida», 0037, AJ2-10): asignación present de un turno «A terminar» sin fin propio, vigente, pasadas las 23:59 del día del turno; en los demás casos es assignments.status. minutes_late / minutes_early_leave (P-076) comparan contra la franja efectiva (assignments."window"); minutes_early_leave es null en una asignación «A terminar» (no tiene fin previsto). planned_minutes: duración de la franja efectiva, null si la asignación es «A terminar» (0037). worked_minutes (AJ2-09, 0037): minutos de [inicio fichado, fin fichado] dentro de la franja efectiva (app.capped_worked_minutes), redondeados al minuto, nunca negativos; null si falta alguno; 0 si está «Sin salida». El front muestra tilde si worked_minutes >= planned_minutes sin margen y advertencia si es menor o hubo salida anticipada. effective_open_ended (0037): la asignación es «A terminar» (turno abierto y sin fin propio); el front muestra «A terminar» en vez de effective_end_time (23:59). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027). last_notice_*: último aviso de la asignación (por created_at). Incluye asignaciones quitadas (removed_at not null). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices. shift_observation (0040, AJ2-15): observación del turno para la columna «Observaciones» del imprimible; solo si el turno tiene la casilla «mostrar en la impresión» tildada y solo para administración (lee shift_observations; null para los demás roles). Suma (0052, B1) la validación por ubicación de cada fichaje (check_in_* / check_out_*: record_id, geo_status, geo_reason, distance_m, geofence_radius_m, accuracy_m, outside_reason, geo_overridden, time_corrected) y has_outside_geo (algún fichaje fuera de zona sin corregir, B-20, B-21). No trae coordenadas del fichaje (B-40): para el mapa de presencia, v_presence_today.';

-- v_my_day: columnas nuevas al final (create or replace view solo admite agregar al final).
create or replace view public.v_my_day
with (security_invoker = true)
as
SELECT a.id AS assignment_id,
    a.shift_id,
    sh.shift_date,
    (sh.shift_date = app.today()) AS is_today,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    cl.trade_name AS client_trade_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
    si.contact_name AS site_contact_name,
    si.contact_phone AS site_contact_phone,
    si.access_instructions,
    si.building_hours,
    si.phone_restricted,
    si.photos_not_allowed,
    si.restrictions_notes,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    COALESCE(tasks.tasks_total, (0)::bigint) AS tasks_total,
    COALESCE(tasks.tasks_done, (0)::bigint) AS tasks_done,
    (((COALESCE(a.updated_at, a.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((a.updated_at IS NULL) OR (a.updated_by IS DISTINCT FROM a.employee_id))) OR ((COALESCE(sh.updated_at, sh.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((sh.updated_at IS NULL) OR (sh.updated_by IS DISTINCT FROM a.employee_id)))) AS changed_since_last_seen,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
    ci.source AS check_in_source,
    ci.recorded_by AS check_in_recorded_by,
    co.source AS check_out_source,
    co.recorded_by AS check_out_recorded_by,
    notice.kind AS last_notice_kind,
    notice.minutes_late AS last_notice_minutes_late,
    notice.reason_code AS last_notice_reason_code,
    notice.reason_text AS last_notice_reason_text,
    notice.reported_by AS last_notice_reported_by,
    notice.source AS last_notice_source,
    notice.created_at AS last_notice_at,
    notice.estimated_arrival_at AS last_notice_estimated_arrival_at,
        CASE
            WHEN (notice.kind = 'on_the_way'::notice_kind) THEN (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes()))
            ELSE NULL::timestamp with time zone
        END AS on_the_way_expires_at,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
    ((a.status = 'present'::assignment_status) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) AS no_checkout,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    coalesce(si.geofence_radius_m, (select cs.geofence_radius_m from public.company_settings cs where cs.id = 1)) as site_geofence_radius_m,
    (select cs.geofence_max_accuracy_m from public.company_settings cs where cs.id = 1) as geofence_max_accuracy_m,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected
   FROM (((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     JOIN v_clients_basic cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS tasks_total,
            count(*) FILTER (WHERE (st.status = 'done'::task_status)) AS tasks_done
           FROM shift_tasks st
          WHERE (st.shift_id = a.shift_id)) tasks ON (true))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.assignment_id = a.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
     LEFT JOIN LATERAL ( SELECT an.kind,
            an.minutes_late,
            an.reason_code,
            an.reason_text,
            an.reported_by,
            an.source,
            an.created_at,
            an.estimated_arrival_at
           FROM attendance_notices an
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND ((sh.shift_date >= app.today()) AND (sh.shift_date <= (app.today() + 7))));

comment on view public.v_my_day is 'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028). is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_estimated_arrival_at (0033) y on_the_way_expires_at (0034): aviso «en camino» y hasta cuándo vale. effective_open_ended (0037, AJ2-10): la asignación es «A terminar» (turno abierto y sin fin propio): el celular muestra «A terminar» en vez de effective_end_time (23:59). no_checkout (0037): «Sin salida» (present, abierta, pasadas las 23:59 del día del turno); la salida ya no se puede fichar desde el celular (record_check_out da OPEN_SHIFT_DAY_ENDED) y la carga administración. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en photos_not_allowed. Suma (0052, B1) site_geofence_radius_m (radio vigente de la sede para el mini mapa, B-18), geofence_max_accuracy_m y la validación propia de cada fichaje (check_in_* / check_out_*: geo_status, geo_reason, distance_m, geofence_radius_m, geo_overridden, time_corrected), sin el motivo de la corrección (B-28).';

-- v_my_history: columnas nuevas al final (create or replace view solo admite agregar al final).
create or replace view public.v_my_history
with (security_invoker = true)
as
SELECT a.id AS assignment_id,
    a.shift_id,
    sh.shift_date,
    (sh.shift_date = app.today()) AS is_today,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    cl.trade_name AS client_trade_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
    si.contact_name AS site_contact_name,
    si.contact_phone AS site_contact_phone,
    si.access_instructions,
    si.building_hours,
    si.phone_restricted,
    si.photos_not_allowed,
    si.restrictions_notes,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    COALESCE(tasks.tasks_total, (0)::bigint) AS tasks_total,
    COALESCE(tasks.tasks_done, (0)::bigint) AS tasks_done,
    (((COALESCE(a.updated_at, a.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((a.updated_at IS NULL) OR (a.updated_by IS DISTINCT FROM a.employee_id))) OR ((COALESCE(sh.updated_at, sh.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((sh.updated_at IS NULL) OR (sh.updated_by IS DISTINCT FROM a.employee_id)))) AS changed_since_last_seen,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
    ci.source AS check_in_source,
    ci.recorded_by AS check_in_recorded_by,
    co.source AS check_out_source,
    co.recorded_by AS check_out_recorded_by,
    notice.kind AS last_notice_kind,
    notice.minutes_late AS last_notice_minutes_late,
    notice.reason_code AS last_notice_reason_code,
    notice.reason_text AS last_notice_reason_text,
    notice.reported_by AS last_notice_reported_by,
    notice.source AS last_notice_source,
    notice.created_at AS last_notice_at,
    notice.estimated_arrival_at AS last_notice_estimated_arrival_at,
        CASE
            WHEN (notice.kind = 'on_the_way'::notice_kind) THEN (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes()))
            ELSE NULL::timestamp with time zone
        END AS on_the_way_expires_at,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
    ((a.status = 'present'::assignment_status) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) AS no_checkout,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    coalesce(si.geofence_radius_m, (select cs.geofence_radius_m from public.company_settings cs where cs.id = 1)) as site_geofence_radius_m,
    (select cs.geofence_max_accuracy_m from public.company_settings cs where cs.id = 1) as geofence_max_accuracy_m,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected
   FROM (((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     JOIN v_clients_basic cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS tasks_total,
            count(*) FILTER (WHERE (st.status = 'done'::task_status)) AS tasks_done
           FROM shift_tasks st
          WHERE (st.shift_id = a.shift_id)) tasks ON (true))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.assignment_id = a.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
     LEFT JOIN LATERAL ( SELECT an.kind,
            an.minutes_late,
            an.reason_code,
            an.reason_text,
            an.reported_by,
            an.source,
            an.created_at,
            an.estimated_arrival_at
           FROM attendance_notices an
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND (sh.shift_date < app.today()));

comment on view public.v_my_history is 'Historial propio del empleado, pantalla «Mis servicios anteriores» (AJ4-06): asignaciones propias de días anteriores a hoy, sin límite de antigüedad. Mismas columnas que v_my_day (0047) para reutilizar el mapeo en el front; hoy y los días siguientes se siguen leyendo de v_my_day, por eso el filtro es sh.shift_date < app.today(). Excluye las asignaciones quitadas (removed_at) e incluye los turnos cancelados (shift_status = ''cancelled''). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de las tablas base. Paginación: el front ordena por shift_date desc, start_time desc (effective_start_time) y usa rango (.range) de a 20 filas; el índice assignments_employee_id_shift_date_idx cubre el filtro por empleado y el orden por fecha. Mismas columnas que v_my_day (incluidas las de validación y corrección de 0052, B-19), solo días anteriores.';

-- v_my_supervisions: columnas nuevas al final (create or replace view solo admite agregar al final).
create or replace view public.v_my_supervisions
with (security_invoker = true)
as
SELECT sv.id,
    sv.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.ends_at,
    sv.status,
    sv.assigned_at,
    sv.not_done_reason,
    sv.cancel_reason,
    sv.general_notes,
    sv.criteria_snapshot,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    COALESCE(emp.employees, '[]'::jsonb) AS assigned_employees,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
    si.contact_name AS site_contact_name,
    si.contact_phone AS site_contact_phone,
    si.access_instructions AS site_access_instructions,
    si.building_hours AS site_building_hours,
    si.phone_restricted AS site_phone_restricted,
    si.photos_not_allowed AS site_photos_not_allowed,
    si.restrictions_notes AS site_restrictions_notes,
    sh.open_ended AS shift_open_ended,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    coalesce(si.geofence_radius_m, (select cs.geofence_radius_m from public.company_settings cs where cs.id = 1)) as site_geofence_radius_m,
    (select cs.geofence_max_accuracy_m from public.company_settings cs where cs.id = 1) as geofence_max_accuracy_m,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (co.geo_override_at is not null) as check_out_geo_overridden
   FROM (((((((supervisions sv
     JOIN shifts sh ON ((sh.id = sv.shift_id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     LEFT JOIN supervision_attendance ci ON (((ci.supervision_id = sv.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN supervision_attendance co ON (((co.supervision_id = sv.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.supervision_id = sv.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'first_name', p2.first_name, 'last_name', p2.last_name, 'status', a.status, 'check_in_at', ar.recorded_at) ORDER BY p2.last_name, p2.first_name) AS employees
           FROM ((assignments a
             JOIN v_people_basic p2 ON ((p2.profile_id = a.employee_id)))
             LEFT JOIN attendance_records ar ON (((ar.assignment_id = a.id) AND (ar.kind = 'check_in'::attendance_kind))))
          WHERE ((a.shift_id = sv.shift_id) AND (a.removed_at IS NULL))) emp ON (true))
  WHERE (sv.supervisor_id = auth.uid());

comment on view public.v_my_supervisions is 'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", 0029, SUP-03); el nombre sale de v_people_basic (0030, DEF-P03). site_* (0029, SUP-006). shift_open_ended (0037, AJ2-10): el turno es «A terminar»; la pantalla muestra «A terminar» en vez de end_time (23:59). security_invoker: además queda sujeta a la RLS de supervisions/shifts/clients/sites/assignments. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en site_photos_not_allowed. Suma (0052, B1) site_geofence_radius_m, geofence_max_accuracy_m y la validación de la supervisión (check_in_* / check_out_*: geo_status, geo_reason, distance_m, geofence_radius_m, geo_overridden) contra la sede supervisada (B-07).';

-- v_supervisions_admin: columnas nuevas al final (create or replace view solo admite agregar al final).
create or replace view public.v_supervisions_admin
with (security_invoker = true)
as
SELECT sv.id,
    sv.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    sv.supervisor_id,
    p.first_name AS supervisor_first_name,
    p.last_name AS supervisor_last_name,
    sv.status,
    sv.assigned_by,
    sv.assigned_at,
    sv.not_done_reason,
    sv.cancel_reason,
    sv.general_notes,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    COALESCE(r.ratings_count, (0)::bigint) AS ratings_count,
    r.ratings_avg,
    sv.created_at,
    sv.updated_at,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.ends_at,
    sv.criteria_snapshot,
    COALESCE(emp.assigned_employees_count, (0)::bigint) AS assigned_employees_count,
        CASE
            WHEN sh.open_ended THEN NULL::integer
            ELSE app.minutes_between(sh.starts_at, sh.ends_at)
        END AS planned_minutes,
    app.minutes_between(ci.recorded_at, co.recorded_at) AS worked_minutes,
    sh.open_ended AS shift_open_ended,
    ci.id as check_in_record_id,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    ci.accuracy_m as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    co.accuracy_m as check_out_accuracy_m,
    co.outside_reason as check_out_outside_reason,
    (co.geo_override_at is not null) as check_out_geo_overridden
   FROM ((((((((supervisions sv
     JOIN shifts sh ON ((sh.id = sv.shift_id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = sv.supervisor_id)))
     LEFT JOIN supervision_attendance ci ON (((ci.supervision_id = sv.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN supervision_attendance co ON (((co.supervision_id = sv.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) AS ratings_count,
            (avg(rt.score))::numeric(3,2) AS ratings_avg
           FROM ratings rt
          WHERE (rt.supervision_id = sv.id)) r ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS assigned_employees_count
           FROM assignments a
          WHERE ((a.shift_id = sv.shift_id) AND (a.removed_at IS NULL))) emp ON (true));

comment on view public.v_supervisions_admin is 'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). ratings_count/ratings_avg: cantidad y promedio simple del turno. start_time/end_time/starts_at/ends_at: franja del turno (0029, ADM-13). criteria_snapshot: criterios vigentes al iniciar (ADM-15). assigned_employees_count: empleados asignados vigentes del turno (0029). planned_minutes/worked_minutes (0033, P19.5a): duración de la franja y minutos entre el inicio y el fin reales de la supervisión (null si falta alguno), para las horas del supervisor en la pestaña Asistencia de su ficha (ADM-12). Sin tope de horas (0038: el tope de AJ2-09 rige solo para empleados). planned_minutes es null si el turno es «A terminar» y shift_open_ended lo avisa (0037; end_time = 23:59 no es una hora de fin). security_invoker: visibilidad de filas por RLS (0012) -- en la práctica solo O/A ven filas. Suma (0052, B1) la validación de cada fichaje de la supervisión (check_in_* / check_out_*: record_id, geo_status, geo_reason, distance_m, geofence_radius_m, accuracy_m, outside_reason, geo_overridden).';

-- ---------------------------------------------------------------------------------------------
-- 7 (continuación). v_presence_today (B-11 a B-15, B-40): mapa de presencia del Resumen
-- ---------------------------------------------------------------------------------------------

-- Solo dueño y administradores: la condición `app.is_admin()` va en la definición (la RLS de las
-- tablas de base también deja pasar al empleado y al supervisor por sus propias filas, y la
-- posición de otra persona no es de ellos, B-40). Tres tipos de fila (`kind`):
--   - employee: asignaciones con inicio hoy (Argentina), con y sin fin (`in_progress`).
--   - supervisor: supervisiones en curso o con inicio hoy.
--   - site: sedes con turno hoy (no cancelado), con sus coordenadas y el radio vigente.
-- `latitude`/`longitude`/`accuracy_m` son la posición del fichaje de inicio, no un seguimiento.
create view public.v_presence_today
with (security_invoker = true)
as
select
  'employee'::text as kind,
  a.id as record_id,
  a.employee_id as person_id,
  p.first_name as person_first_name,
  p.last_name as person_last_name,
  sh.id as shift_id,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  sh.shift_date,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  (co.id is null) as in_progress,
  ci.latitude,
  ci.longitude,
  ci.accuracy_m,
  ci.geo_status,
  ci.geo_unvalidated_reason as geo_reason,
  ci.site_distance_m as distance_m,
  ci.geofence_radius_m,
  (ci.geo_override_at is not null) as geo_overridden,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  coalesce(si.geofence_radius_m, cs.geofence_radius_m) as site_radius_m
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
cross join public.company_settings cs
where app.is_admin()
  and cs.id = 1
  and a.removed_at is null
  and sh.status <> 'cancelled'
  and ci.recorded_at >= app.local_ts(app.today(), '00:00'::time)
  and ci.recorded_at < app.local_ts(app.today() + 1, '00:00'::time)

union all

select
  'supervisor'::text,
  sv.id,
  sv.supervisor_id,
  p.first_name,
  p.last_name,
  sh.id,
  sh.client_id,
  cl.legal_name,
  cl.trade_name,
  sh.site_id,
  si.name,
  sh.shift_date,
  sh.start_time,
  sh.end_time,
  ci.recorded_at,
  co.recorded_at,
  (co.id is null and sv.status = 'in_progress'),
  ci.latitude,
  ci.longitude,
  ci.accuracy_m,
  ci.geo_status,
  ci.geo_unvalidated_reason,
  ci.site_distance_m,
  ci.geofence_radius_m,
  (ci.geo_override_at is not null),
  si.latitude,
  si.longitude,
  coalesce(si.geofence_radius_m, cs.geofence_radius_m)
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = sv.supervisor_id
join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
cross join public.company_settings cs
where app.is_admin()
  and cs.id = 1
  and sv.status in ('in_progress', 'completed')
  and (
    sv.status = 'in_progress'
    or (
      ci.recorded_at >= app.local_ts(app.today(), '00:00'::time)
      and ci.recorded_at < app.local_ts(app.today() + 1, '00:00'::time)
    )
  )

union all

select
  'site'::text,
  si.id,
  null::uuid,
  null::text,
  null::text,
  null::uuid,
  si.client_id,
  cl.legal_name,
  cl.trade_name,
  si.id,
  si.name,
  app.today(),
  null::time,
  null::time,
  null::timestamptz,
  null::timestamptz,
  null::boolean,
  null::numeric(9, 6),
  null::numeric(9, 6),
  null::numeric(7, 1),
  null::public.geo_status,
  null::public.geo_unvalidated_reason,
  null::integer,
  null::smallint,
  null::boolean,
  si.latitude,
  si.longitude,
  coalesce(si.geofence_radius_m, cs.geofence_radius_m)
from public.sites si
join public.clients cl on cl.id = si.client_id
cross join public.company_settings cs
where app.is_admin()
  and cs.id = 1
  and exists (
    select 1 from public.shifts sh
    where sh.site_id = si.id and sh.shift_date = app.today() and sh.status <> 'cancelled'
  );

comment on view public.v_presence_today is
  'Mapa de presencia del Resumen (B-11 a B-15, B-40). Solo dueño y administradores (app.is_admin() en la definición; security_invoker). kind = employee: asignaciones con inicio hoy (in_progress = sin fin); kind = supervisor: supervisiones en curso o con inicio hoy; kind = site: sedes con turno hoy, con coordenadas y radio vigente (site_radius_m). latitude/longitude/accuracy_m/geo_* son los del fichaje de inicio (sin seguimiento continuo). La app la consulta cada 45 s (B-39).';

revoke all on public.v_presence_today from public, anon, authenticated;
grant select on public.v_presence_today to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. Validación única del historial (B-10)
-- ---------------------------------------------------------------------------------------------

-- Una sola vez, con el radio de la configuración (150 m por defecto) y el radio propio de cada
-- sede (todavía nulo en esta migración). Sin coordenadas: unvalidated / no_location; de origen
-- admin: unvalidated / admin_record; el resto se evalúa contra la sede del turno. Los fichajes de
-- prueba de los administradores van a dar «Fuera de zona»: es lo esperado.
with hist as (
  select
    ar.id,
    ar.source,
    g.status,
    g.reason,
    g.distance_m,
    g.radius_m
  from public.attendance_records ar
  join public.assignments a on a.id = ar.assignment_id
  join public.shifts sh on sh.id = a.shift_id
  cross join lateral app.geo_for_site(sh.site_id, ar.latitude, ar.longitude, ar.accuracy_m) g
)
update public.attendance_records ar
set
  geo_status = case when h.source = 'admin' then 'unvalidated'::public.geo_status else h.status end,
  geo_unvalidated_reason = case when h.source = 'admin' then 'admin_record'::public.geo_unvalidated_reason else h.reason end,
  site_distance_m = case when h.source = 'admin' then null else h.distance_m end,
  geofence_radius_m = case when h.source = 'admin' then null else h.radius_m end
from hist h
where h.id = ar.id;

with hist as (
  select
    sa.id,
    g.status,
    g.reason,
    g.distance_m,
    g.radius_m
  from public.supervision_attendance sa
  join public.supervisions sv on sv.id = sa.supervision_id
  join public.shifts sh on sh.id = sv.shift_id
  cross join lateral app.geo_for_site(sh.site_id, sa.latitude, sa.longitude, sa.accuracy_m) g
)
update public.supervision_attendance sa
set
  geo_status = h.status,
  geo_unvalidated_reason = h.reason,
  site_distance_m = h.distance_m,
  geofence_radius_m = h.radius_m
from hist h
where h.id = sa.id;
