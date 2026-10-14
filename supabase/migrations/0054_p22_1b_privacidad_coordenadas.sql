-- P22.1b · Módulo B1 · privacidad de las coordenadas (B-40) y de la corrección de la validación
-- (B-28) · base de datos.
--
-- El problema: las políticas de `select` de 0012 dan acceso a la FILA ENTERA de attendance_records
-- y supervision_attendance al supervisor (fichajes de los empleados de los turnos que supervisa) y
-- al empleado (sus propios registros). Con eso el supervisor leía latitud, longitud y precisión de
-- los empleados, y el empleado leía el motivo de la corrección (geo_override_reason, que B-28 le
-- esconde) y quién la hizo. B-40: la posición la ven solo el dueño y los administradores.
--
-- Técnica (por qué):
--   - La RLS filtra filas, no columnas. Para esconder columnas hace falta el privilegio de columna.
--     Pero `authenticated` es UN solo rol de Postgres para todo el mundo (dueño, administrador,
--     supervisor y empleado comparten el rol), así que un `revoke` de columna le quita la lectura
--     directa a todos, administradores incluidos. Por eso la lectura de administración no puede
--     pasar por la tabla: pasa por una función de definidor que corta con `app.is_admin()` (se lee
--     del JWT, que no cambia dentro de una función `security definer`).
--   - Se descarta partir las tablas (una `attendance_locations` con RLS solo de administración):
--     obligaba a reescribir las RPC de fichaje de 0052/0053, la validación del historial, el seed y
--     las pruebas existentes. El privilegio de columna cierra el hueco con un cambio chico y
--     verificable (`has_column_privilege`).
--   - Se descarta una vista de definidor para v_presence_today: bypassa toda la RLS de lo que lee y
--     el linter de Supabase la marca. Las vistas siguen siendo `security_invoker`; las columnas
--     protegidas salen de `app.attendance_position`, que devuelve nulos si no es administración.
--
-- Contenido:
--   1. `app.attendance_position(tipo, id)`: latitud, longitud y precisión de un fichaje, solo para
--      administración (definidor; interno, lo usan las vistas).
--   2. Privilegios de columna: `authenticated` pierde el select de latitude, longitude,
--      accuracy_m, geo_override_by y geo_override_reason en attendance_records y
--      supervision_attendance. El resto de las columnas conserva el select (la RLS sigue igual).
--   3. Vistas: v_assignments_board y v_supervisions_admin (precisión del fichaje) y
--      v_presence_today (posición) leen las columnas protegidas por la función de (1). Mismas
--      columnas y tipos; los no administradores ven null en las columnas de posición.
--   4. `get_attendance_location(tipo, id)`: RPC de lectura para el mini mapa del detalle del turno
--      de administración (P22.4).
--
-- Efecto colateral aceptado: el supervisor y el empleado dejan de poder leer también SU PROPIA
-- posición de la tabla. No hace falta: el celular usa el GPS en vivo al fichar (B-38, B-40) y las
-- RPC de fichaje devuelven la fila propia con su propio rol de definidor.
--
-- Atención para migraciones futuras: un `grant select on all tables in schema public to
-- authenticated` (como el de 0017) volvería a abrir las columnas. El pgTAP 0054 lo detecta. Las
-- columnas que se agreguen a estas dos tablas después de esta migración NO tienen select para
-- `authenticated` hasta que se les otorgue explícitamente (falla cerrada); las vistas y el
-- frontend no las ven hasta entonces.

-- ---------------------------------------------------------------------------------------------
-- 1. app.attendance_position
-- ---------------------------------------------------------------------------------------------

-- Una sola consulta por clave primaria. Si la sesión no es del dueño ni de un administrador no
-- devuelve filas (y la vista muestra null), nunca un error: así el tablero y las pantallas de los
-- demás roles siguen funcionando.
create function app.attendance_position(p_record_type text, p_record_id uuid)
returns table (o_latitude numeric, o_longitude numeric, o_accuracy_m numeric)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select ar.latitude::numeric, ar.longitude::numeric, ar.accuracy_m::numeric
  from public.attendance_records ar
  where p_record_type = 'attendance' and ar.id = p_record_id and app.is_admin()
  union all
  select sa.latitude::numeric, sa.longitude::numeric, sa.accuracy_m::numeric
  from public.supervision_attendance sa
  where p_record_type = 'supervision' and sa.id = p_record_id and app.is_admin();
$$;

comment on function app.attendance_position(text, uuid) is
  'Posición de un fichaje (tipo attendance o supervision) para las vistas de administración (B-40, 0054). Definidor: lee las columnas protegidas. Sin filas si la sesión no es del dueño ni de un administrador. Interna: no se expone en la API.';

revoke all on function app.attendance_position(text, uuid) from public, anon;
grant execute on function app.attendance_position(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Privilegios de columna
-- ---------------------------------------------------------------------------------------------

-- Se quita el select de tabla a `authenticated` y se otorga columna por columna, todas menos las
-- protegidas. Dinámico a propósito: toma las columnas que existen en este momento, sin repetir una
-- lista que se desactualice.
do $$
declare
  v_table text;
  v_columns text;
begin
  foreach v_table in array array['attendance_records', 'supervision_attendance'] loop
    execute format('revoke select on table public.%I from authenticated', v_table);

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
    where a.attrelid = format('public.%I', v_table)::regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attname::text <> all (array[
        'latitude', 'longitude', 'accuracy_m', 'geo_override_by', 'geo_override_reason'
      ]);

    execute format('grant select (%s) on table public.%I to authenticated', v_columns, v_table);
  end loop;
end;
$$;

comment on column public.attendance_records.latitude is
  'Posición del fichaje (B-40). Sin select para authenticated: solo la leen las vistas de administración y get_attendance_location, por app.attendance_position (0054).';
comment on column public.attendance_records.longitude is
  'Posición del fichaje (B-40). Sin select para authenticated: ver latitude (0054).';
comment on column public.attendance_records.accuracy_m is
  'Precisión del GPS al fichar (B-40). Sin select para authenticated: ver latitude (0054).';
comment on column public.attendance_records.geo_override_by is
  'Quién marcó el fichaje como válido (B-09). Sin select para authenticated: el empleado no ve la corrección (B-28); administración la lee en attendance_corrections (0054).';
comment on column public.attendance_records.geo_override_reason is
  'Motivo de la corrección de la validación (B-09). Sin select para authenticated: ver geo_override_by (0054).';
comment on column public.supervision_attendance.latitude is
  'Posición del fichaje del supervisor (B-40). Sin select para authenticated: ver attendance_records.latitude (0054).';
comment on column public.supervision_attendance.longitude is
  'Posición del fichaje del supervisor (B-40). Sin select para authenticated: ver attendance_records.latitude (0054).';
comment on column public.supervision_attendance.accuracy_m is
  'Precisión del GPS al fichar (B-40). Sin select para authenticated: ver attendance_records.latitude (0054).';
comment on column public.supervision_attendance.geo_override_by is
  'Quién marcó el fichaje como válido (B-09). Sin select para authenticated (0054).';
comment on column public.supervision_attendance.geo_override_reason is
  'Motivo de la corrección de la validación (B-09). Sin select para authenticated (0054).';

-- ---------------------------------------------------------------------------------------------
-- 3. Vistas: las columnas protegidas salen de app.attendance_position
-- ---------------------------------------------------------------------------------------------

-- Mismo texto que 0052, salvo las expresiones de accuracy_m / latitude / longitude. Los
-- comentarios de las vistas no cambian.

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
    (select pos.o_accuracy_m from app.attendance_position('attendance', ci.id) pos)::numeric(7,1) as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('attendance', co.id) pos)::numeric(7,1) as check_out_accuracy_m,
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
    (select pos.o_accuracy_m from app.attendance_position('supervision', ci.id) pos)::numeric(7,1) as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('supervision', co.id) pos)::numeric(7,1) as check_out_accuracy_m,
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

-- v_presence_today: mismas columnas y tipos que 0052. Sigue siendo security_invoker y con
-- `app.is_admin()` en la definición.
create or replace view public.v_presence_today
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
  (select pos.o_latitude from app.attendance_position('attendance', ci.id) pos)::numeric(9, 6) as latitude,
  (select pos.o_longitude from app.attendance_position('attendance', ci.id) pos)::numeric(9, 6) as longitude,
  (select pos.o_accuracy_m from app.attendance_position('attendance', ci.id) pos)::numeric(7, 1) as accuracy_m,
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
  (select pos.o_latitude from app.attendance_position('supervision', ci.id) pos)::numeric(9, 6) as latitude,
  (select pos.o_longitude from app.attendance_position('supervision', ci.id) pos)::numeric(9, 6) as longitude,
  (select pos.o_accuracy_m from app.attendance_position('supervision', ci.id) pos)::numeric(7, 1) as accuracy_m,
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


-- ---------------------------------------------------------------------------------------------
-- 4. get_attendance_location: posición de un fichaje para el mini mapa de administración
-- ---------------------------------------------------------------------------------------------

-- Para el detalle del turno de administración (P22.4): un solo objeto con la posición del fichaje,
-- su validación congelada y la sede (coordenadas y radio vigente) para dibujar el mapa de solo
-- lectura. Solo dueño y administradores (app.require_admin, no pide capacidad: es lectura, igual
-- que v_presence_today). Los nulos se devuelven como null (fichaje sin permiso de ubicación).
create function public.get_attendance_location(p_record_type text, p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform app.require_admin();

  if p_record_type is null or p_record_type not in ('attendance', 'supervision') then
    raise exception using
      errcode = 'P0001',
      message = 'El tipo de registro no es válido.',
      hint = 'INVALID_RECORD_TYPE';
  end if;

  if p_record_type = 'attendance' then
    select jsonb_build_object(
      'record_type', 'attendance',
      'record_id', ar.id,
      'kind', ar.kind,
      'recorded_at', ar.recorded_at,
      'latitude', ar.latitude,
      'longitude', ar.longitude,
      'accuracy_m', ar.accuracy_m,
      'geo_status', ar.geo_status,
      'geo_reason', ar.geo_unvalidated_reason,
      'distance_m', ar.site_distance_m,
      'geofence_radius_m', ar.geofence_radius_m,
      'geo_overridden', (ar.geo_override_at is not null),
      'site_id', si.id,
      'site_name', si.name,
      'site_latitude', si.latitude,
      'site_longitude', si.longitude,
      'site_radius_m', coalesce(si.geofence_radius_m, cs.geofence_radius_m)
    )
    into v_result
    from public.attendance_records ar
    join public.assignments a on a.id = ar.assignment_id
    join public.shifts sh on sh.id = a.shift_id
    join public.sites si on si.id = sh.site_id
    cross join public.company_settings cs
    where ar.id = p_record_id and cs.id = 1;
  else
    select jsonb_build_object(
      'record_type', 'supervision',
      'record_id', sa.id,
      'kind', sa.kind,
      'recorded_at', sa.recorded_at,
      'latitude', sa.latitude,
      'longitude', sa.longitude,
      'accuracy_m', sa.accuracy_m,
      'geo_status', sa.geo_status,
      'geo_reason', sa.geo_unvalidated_reason,
      'distance_m', sa.site_distance_m,
      'geofence_radius_m', sa.geofence_radius_m,
      'geo_overridden', (sa.geo_override_at is not null),
      'site_id', si.id,
      'site_name', si.name,
      'site_latitude', si.latitude,
      'site_longitude', si.longitude,
      'site_radius_m', coalesce(si.geofence_radius_m, cs.geofence_radius_m)
    )
    into v_result
    from public.supervision_attendance sa
    join public.supervisions sv on sv.id = sa.supervision_id
    join public.shifts sh on sh.id = sv.shift_id
    join public.sites si on si.id = sh.site_id
    cross join public.company_settings cs
    where sa.id = p_record_id and cs.id = 1;
  end if;

  if v_result is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese registro.',
      hint = 'RECORD_NOT_FOUND';
  end if;

  return v_result;
end;
$$;

comment on function public.get_attendance_location(text, uuid) is
  'Posición de un fichaje para el mini mapa de solo lectura del detalle del turno de administración (B-40, P22.4). p_record_type: attendance | supervision. Solo dueño y administradores (FORBIDDEN si no). Devuelve jsonb con la posición (latitude, longitude, accuracy_m; null si el fichaje no tiene), la validación congelada, y la sede (site_latitude, site_longitude, site_radius_m vigente). INVALID_RECORD_TYPE, RECORD_NOT_FOUND.';

revoke all on function public.get_attendance_location(text, uuid) from public, anon;
grant execute on function public.get_attendance_location(text, uuid) to authenticated;
