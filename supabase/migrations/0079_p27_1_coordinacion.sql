-- =================================================================================================
-- 0079_p27_1_coordinacion.sql (P27.1, observaciones de los dueños del 2 nov 2026)
--
-- Segunda de tres migraciones (0078 a 0080). Cambia tres reglas de P24 (CJ-10, CJ-27 y CJ-28) y
-- suma las correcciones de la administración sobre la jornada del coordinador.
--
--   OD-08  El coordinador puede supervisar cualquier turno de hoy no cancelado: en curso, terminado
--          o todavía no empezado, y aunque el empleado no haya llegado. Siguen la jornada iniciada
--          y sin pausa (CJ-07) y una supervisión abierta a la vez (CJ-08). take_supervision ya no
--          mira el estado del turno (salvo cancelado); lo que cambia es la unicidad (OD-10).
--   OD-09  Una supervisión se cierra sin calificar: complete_supervision deja de exigir las
--          calificaciones (desaparece RATINGS_PENDING). «Descartar» sigue para la que no tiene
--          calificaciones.
--   OD-10  Se quita la unicidad por coordinador y turno (índice supervisions_shift_id_supervisor_id_key
--          de 0010, CJ-27): el coordinador puede volver al mismo turno y abrir una supervisión nueva;
--          cada pasada queda registrada. ALREADY_SUPERVISED desaparece. v_supervisor_today elige la
--          supervisión propia abierta (o la última) en my_supervision_id.
--   OD-06  admin_end_workday: la administración finaliza la jornada de un coordinador a la hora que
--          elija (por defecto, ahora), con motivo. Cierra la pausa abierta y deja «Sin cerrar» la
--          supervisión abierta (igual que el cierre automático, CJ-31).
--   OD-07  Todo se corrige: admin_close_workday_pause (cerrar una pausa abierta a la hora indicada),
--          admin_correct_workday_event suma el cambio del motivo de la pausa (p_pause_reason) y
--          admin_correct_supervision_time corrige el inicio y el fin de una supervisión. Cada
--          corrección pide motivo, deja la traza de CJ-32 (corrected_*, jornada corrected) y un
--          evento workday_corrected en security_events.
--   OD-05  v_supervisor_workdays_admin suma columnas para la pantalla de jornadas (estado de lista,
--          pausa y supervisión abiertas, legajo y avatar). El período, el coordinador y el estado
--          se filtran con work_date, supervisor_id, list_status, auto_closed y corrected.
-- =================================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. OD-10: fuera la unicidad por coordinador y turno
-- ---------------------------------------------------------------------------------------------

drop index public.supervisions_shift_id_supervisor_id_key;

-- Las consultas por turno y coordinador (v_supervisor_today, la pantalla de calificaciones) siguen
-- necesitando el índice, ahora no único.
create index supervisions_shift_id_supervisor_id_idx
  on public.supervisions (shift_id, supervisor_id)
  where status <> 'cancelled';

comment on table public.supervisions is
  'Una supervisión de un coordinador a un turno (04 sección 2.5). Desde 0079 (OD-10) un coordinador puede tener varias del mismo turno (vuelve más tarde y abre una nueva); varios coordinadores también (CJ-05). Produce calificaciones (ratings) por asignación, una por supervisión. criteria_snapshot guarda los criterios vigentes al iniciar (P-087). Sin deleted_at: el modelo la lista solo "Traza".';

-- ---------------------------------------------------------------------------------------------
-- 2. take_supervision (OD-08, OD-10): igual que 0063 sin el chequeo de unicidad
-- ---------------------------------------------------------------------------------------------

create or replace function public.take_supervision(
  p_shift_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts;
  v_wd public.supervisor_workdays;
  v_state text;
  v_supervision public.supervisions;
  v_record public.supervision_attendance;
  v_criteria jsonb;
  v_geo record;
  v_outside_reason text;
  v_warnings text[] := array[]::text[];
begin
  perform app.require_role('supervisor');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado: no se puede supervisar.',
      hint = 'SHIFT_NOT_SUPERVISABLE';
  end if;

  if v_shift.shift_date <> app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no es de hoy.',
      hint = 'NOT_TODAY';
  end if;

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Primero iniciá tu jornada.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada está finalizada: reabrila para supervisar.',
      hint = 'WORKDAY_ENDED';
  end if;

  if v_state = 'paused' then
    raise exception using
      errcode = 'P0001',
      message = 'Estás en pausa: reanudá tu jornada para supervisar.',
      hint = 'WORKDAY_PAUSED';
  end if;

  -- CJ-08: de a una.
  if app.open_supervision_id(v_wd.id) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cerrá o descartá tu supervisión abierta antes de empezar otra.',
      hint = 'SUPERVISION_ALREADY_OPEN';
  end if;

  v_outside_reason := app.validate_position(p_lat, p_lng, p_accuracy, p_outside_reason);

  -- criteria_snapshot (P-087): criterios vigentes hoy, ordenados por position.
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

  -- OD-10: sin unicidad. El coordinador puede abrir otra supervisión del mismo turno más tarde.
  insert into public.supervisions (shift_id, supervisor_id, status, workday_id, criteria_snapshot, created_by)
  values (p_shift_id, v_uid, 'in_progress', v_wd.id, v_criteria, v_uid)
  returning * into v_supervision;

  -- Validación contra la sede supervisada (B-07).
  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);

  insert into public.supervision_attendance (
    supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    v_supervision.id, 'check_in', now(), p_lat, p_lng, p_accuracy,
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  perform app.add_workday_event(
    v_wd.id, 'supervision_start', now(), p_lat, p_lng, p_accuracy, null, v_supervision.id
  );

  -- Advertencia (no bloquea, P15.0): el coordinador también está asignado como empleado.
  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = v_uid and a.removed_at is null
  ) then
    v_warnings := array_append(v_warnings, 'SUPERVISES_OWN_SHIFT');
  end if;

  return jsonb_build_object(
    'supervision', to_jsonb(v_supervision),
    'check_in', to_jsonb(v_record),
    'warnings', v_warnings
  );
end;
$$;

comment on function public.take_supervision(uuid, numeric, numeric, numeric, text) is
  'El coordinador toma un turno de hoy y empieza la supervisión en un solo paso (CJ-26): crea la supervisión en in_progress, registra el inicio con la hora del servidor y la validación contra la sede (B-07) y deja el evento supervision_start. Desde 0079 (OD-08, OD-10) acepta cualquier turno de hoy no cancelado —en curso, terminado o sin empezar, haya llegado o no el empleado— y puede volver al mismo turno más tarde: cada pasada es una supervisión nueva (ya no existe ALREADY_SUPERVISED). S. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado), NOT_TODAY, WORKDAY_NOT_STARTED, WORKDAY_ENDED, WORKDAY_PAUSED (CJ-07), SUPERVISION_ALREADY_OPEN (CJ-08), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Devuelve { supervision, check_in, warnings } con SUPERVISES_OWN_SHIFT si también está asignado como empleado en ese turno.';

-- ---------------------------------------------------------------------------------------------
-- 3. complete_supervision (OD-09): sin exigir calificaciones
-- ---------------------------------------------------------------------------------------------

create or replace function public.complete_supervision(
  p_supervision_id uuid,
  p_general_notes text default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_site_id uuid;
  v_geo record;
  v_outside_reason text;
  v_has_checkout boolean;
  v_now timestamptz := now();
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

  v_outside_reason := app.validate_position(p_lat, p_lng, p_accuracy, p_outside_reason);

  -- OD-09: calificar es opcional. La pantalla avisa quiénes faltan y deja seguir; la base no lo exige.

  -- Registro del fin (con la validación contra la sede, B-07). Si ya tenía un fin (supervisiones
  -- «Sin cerrar» del cierre automático), no se vuelve a registrar.
  select exists (
    select 1 from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out'
  ) into v_has_checkout;

  if not v_has_checkout then
    select sh.site_id into v_site_id from public.shifts sh where sh.id = v_supervision.shift_id;

    select * into v_geo from app.geo_for_site(v_site_id, p_lat, p_lng, p_accuracy);

    insert into public.supervision_attendance (
      supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
      geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
    )
    values (
      p_supervision_id, 'check_out', v_now, p_lat, p_lng, p_accuracy,
      v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
      case when v_geo.status = 'outside' then v_outside_reason end
    );

    if v_supervision.workday_id is not null then
      perform app.add_workday_event(
        v_supervision.workday_id, 'supervision_end', v_now, p_lat, p_lng, p_accuracy, null, v_supervision.id
      );
    end if;
  end if;

  update public.supervisions
  set status = 'completed', general_notes = nullif(btrim(p_general_notes), ''), updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  return v_supervision;
end;
$$;

comment on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text) is
  'Cierra una supervisión in_progress (04 sección 6.4) y registra el fin con la hora del servidor, la validación contra la sede y el evento supervision_end. Desde 0079 (OD-09) NO exige calificar a nadie: se puede cerrar sin calificaciones (RATINGS_PENDING desaparece; la pantalla avisa quiénes faltan y deja seguir). S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, NOT_STARTED, SUPERVISION_NOT_EDITABLE (no está in_progress), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Texto vacío de general_notes se guarda como null.';

-- ---------------------------------------------------------------------------------------------
-- 4. app.supervisor_today: con varias supervisiones por coordinador y turno, my_supervision_*
--    es la abierta (in_progress) y, si no hay, la última no cancelada. Mismas columnas que 0068.
-- ---------------------------------------------------------------------------------------------

create or replace function app.supervisor_today()
returns table (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  open_ended boolean,
  shift_status public.shift_status,
  display_state text,
  required_staff smallint,
  client_id uuid,
  client_legal_name text,
  client_trade_name text,
  site_id uuid,
  site_name text,
  site_address text,
  site_city text,
  site_latitude numeric,
  site_longitude numeric,
  priority_kind text,
  is_priority boolean,
  assigned_employees jsonb,
  supervisors jsonb,
  my_supervision_id uuid,
  my_supervision_status public.supervision_status,
  site_radius_m smallint,
  max_accuracy_m smallint,
  site_contact_name text,
  site_contact_phone text,
  access_instructions text,
  building_hours text,
  restrictions_notes text,
  phone_restricted boolean,
  photos_not_allowed boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    sh.id,
    sh.shift_date,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.ends_at,
    sh.open_ended,
    sh.status,
    case sh.status when 'in_progress' then 'in_progress' when 'completed' then 'finished' else 'pending' end,
    sh.required_staff,
    sh.client_id,
    cl.legal_name,
    cl.trade_name,
    sh.site_id,
    si.name,
    si.address,
    si.city,
    si.latitude::numeric,
    si.longitude::numeric,
    pr.kind,
    (pr.kind is not null),
    coalesce(emp.employees, '[]'::jsonb),
    coalesce(sup.supervisors, '[]'::jsonb),
    mine.id,
    mine.status,
    coalesce(si.geofence_radius_m, cs.geofence_radius_m),
    cs.geofence_max_accuracy_m,
    si.contact_name,
    si.contact_phone,
    si.access_instructions,
    si.building_hours,
    si.restrictions_notes,
    si.phone_restricted,
    si.photos_not_allowed
  from public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  cross join public.company_settings cs
  left join lateral (
    select case
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = auth.uid() and sp.removed_at is null and sp.site_id = sh.site_id
      ) then 'site'
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = auth.uid() and sp.removed_at is null and sp.client_id = sh.client_id
      ) then 'client'
    end as kind
  ) pr on true
  left join lateral (
    select jsonb_agg(
        jsonb_build_object(
          'assignment_id', a.id,
          'employee_id', a.employee_id,
          'first_name', p2.first_name,
          'last_name', p2.last_name,
          'status', a.status,
          'check_in_at', ci.recorded_at,
          'check_out_at', co.recorded_at
        )
        order by p2.last_name, p2.first_name
      ) as employees
    from public.assignments a
    join public.profiles p2 on p2.id = a.employee_id
    left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
    where a.shift_id = sh.id and a.removed_at is null
  ) emp on true
  left join lateral (
    select jsonb_agg(
        jsonb_build_object(
          'supervision_id', sv.id,
          'supervisor_id', sv.supervisor_id,
          'first_name', p3.first_name,
          'last_name', p3.last_name,
          'status', sv.status,
          'check_in_at', sci.recorded_at,
          'check_out_at', sco.recorded_at,
          'is_me', (sv.supervisor_id = auth.uid())
        )
        order by sci.recorded_at nulls last, sv.created_at
      ) as supervisors
    from public.supervisions sv
    join public.profiles p3 on p3.id = sv.supervisor_id
    left join public.supervision_attendance sci on sci.supervision_id = sv.id and sci.kind = 'check_in'
    left join public.supervision_attendance sco on sco.supervision_id = sv.id and sco.kind = 'check_out'
    where sv.shift_id = sh.id and sv.status <> 'cancelled'
  ) sup on true
  left join lateral (
    select sv.id, sv.status
    from public.supervisions sv
    where sv.shift_id = sh.id and sv.supervisor_id = auth.uid() and sv.status <> 'cancelled'
    order by (sv.status = 'in_progress') desc, sv.created_at desc
    limit 1
  ) mine on true
  where app.has_role('supervisor')
    and sh.deleted_at is null
    and sh.shift_date = app.today()
    and sh.status <> 'cancelled';
$$;

comment on function app.supervisor_today() is
  'Turnos de hoy de todos los clientes y sedes para el coordinador (0063, CJ-02, CJ-25). Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Interna: la lee v_supervisor_today. Desde 0064 trae site_radius_m y max_accuracy_m; desde 0065 los datos de la sede de SUP-04; desde 0068 phone_restricted y photos_not_allowed. Desde 0079 (OD-10), si el coordinador tiene varias supervisiones del turno, my_supervision_id / my_supervision_status son los de la abierta (in_progress) y, si no hay, los de la última no cancelada; supervisors las trae a todas.';

-- ---------------------------------------------------------------------------------------------
-- 5. Auxiliar: la hora de una corrección (dentro del día de la jornada y no futura)
-- ---------------------------------------------------------------------------------------------

create function app.check_correction_time(p_workday_date date, p_at timestamptz)
returns void
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
begin
  if p_at < app.local_ts(p_workday_date, time '00:00')
    or p_at >= app.local_ts(p_workday_date + 1, time '00:00')
    or p_at > now()
  then
    raise exception using
      errcode = 'P0001',
      message = 'La hora tiene que estar dentro del día de la jornada y no puede ser futura.',
      hint = 'AT_OUT_OF_RANGE';
  end if;
end;
$$;

comment on function app.check_correction_time(date, timestamptz) is
  'Uso interno (0079): AT_OUT_OF_RANGE si p_at no cae dentro del día de la jornada (hora de Argentina) o es futura.';

revoke execute on function app.check_correction_time(date, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. OD-06: admin_end_workday
-- ---------------------------------------------------------------------------------------------

create function public.admin_end_workday(
  p_workday_id uuid,
  p_reason text,
  p_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_at timestamptz;
  v_state text;
  v_last timestamptz;
  v_pause_closed boolean;
  v_sv record;
  v_unclosed uuid[] := array[]::uuid[];
  v_end public.supervisor_workday_events;
  v_ev public.supervisor_workday_events;
begin
  perform app.require_capability('manage_attendance');

  select * into v_wd from public.supervisor_workdays where id = p_workday_id for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa jornada.',
      hint = 'WORKDAY_NOT_FOUND';
  end if;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'La jornada ya está finalizada. Corregí su hora de fin en lugar de finalizarla de nuevo.',
      hint = 'WORKDAY_ENDED';
  end if;

  v_at := coalesce(p_at, now());
  perform app.check_correction_time(v_wd.work_date, v_at);

  select max(e.recorded_at) into v_last
  from public.supervisor_workday_events e
  where e.workday_id = v_wd.id and e.removed_at is null;

  if v_last is not null and v_at < v_last then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin no puede ser anterior al último registro de la jornada.',
      hint = 'AT_BEFORE_LAST_EVENT';
  end if;

  v_pause_closed := (v_state = 'paused');

  -- Supervisión abierta: se cierra a esa hora y queda «Sin cerrar» (in_progress con fin), igual que
  -- en el cierre automático (CJ-31). Sin posición.
  for v_sv in
    select sv.id
    from public.supervisions sv
    where sv.workday_id = v_wd.id
      and sv.status = 'in_progress'
      and not exists (
        select 1 from public.supervision_attendance sa
        where sa.supervision_id = sv.id and sa.kind = 'check_out'
      )
    order by sv.created_at
  loop
    insert into public.supervision_attendance (supervision_id, kind, recorded_at)
    values (v_sv.id, 'check_out', v_at);

    v_ev := app.add_workday_event(
      v_wd.id, 'supervision_end', v_at, null, null, null, 'Cierre por la administración', v_sv.id
    );

    update public.supervisor_workday_events
    set corrected_at = now(), corrected_by = auth.uid(), correction_reason = v_reason
    where id = v_ev.id;

    v_unclosed := array_append(v_unclosed, v_sv.id);
  end loop;

  -- El fin cierra también la pausa abierta (un fin estando en pausa es válido, como en end_workday).
  v_end := app.add_workday_event(v_wd.id, 'end', v_at, null, null, null, 'Cierre por la administración');

  update public.supervisor_workday_events
  set corrected_at = now(), corrected_by = auth.uid(), correction_reason = v_reason
  where id = v_end.id;

  perform app.assert_workday_consistent(v_wd.id);
  perform app.sync_workday(v_wd.id);

  update public.supervisor_workdays
  set corrected = true, updated_by = auth.uid()
  where id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_wd.supervisor_id,
    jsonb_build_object(
      'action', 'end_workday',
      'workday_id', v_wd.id,
      'event_id', v_end.id,
      'ended_at', v_at,
      'pause_closed', v_pause_closed,
      'unclosed_supervisions', to_jsonb(v_unclosed),
      'reason', v_reason
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_end_workday(uuid, text, timestamptz) is
  'Finaliza la jornada de un coordinador desde la administración (OD-06, 0079). O, A con manage_attendance (FORBIDDEN si no). p_reason (motivo, obligatorio); p_at: hora de fin (por defecto, ahora). Si la jornada está en pausa, la pausa se cierra a esa hora; si hay una supervisión abierta, se cierra a esa hora y queda «Sin cerrar» (in_progress con fin, CJ-31), con el motivo «Cierre por la administración». Marca la jornada como corrected, deja la traza de CJ-32 en los eventos y registra workday_corrected (action end_workday). WORKDAY_NOT_FOUND, REASON_REQUIRED, WORKDAY_ENDED (ya está finalizada: se corrige su fin), AT_OUT_OF_RANGE (dentro del día de la jornada y no futura), AT_BEFORE_LAST_EVENT (anterior al último registro), INVALID_EVENT_ORDER. Devuelve el estado de la jornada.';

-- ---------------------------------------------------------------------------------------------
-- 7. OD-07: cerrar una pausa abierta
-- ---------------------------------------------------------------------------------------------

create function public.admin_close_workday_pause(
  p_event_id uuid,
  p_reason text,
  p_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_event public.supervisor_workday_events;
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_at timestamptz;
  v_last public.supervisor_workday_events;
  v_resume public.supervisor_workday_events;
begin
  perform app.require_capability('manage_attendance');

  select * into v_event from public.supervisor_workday_events where id = p_event_id for update;

  if v_event.id is null or v_event.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese evento de la jornada.',
      hint = 'EVENT_NOT_FOUND';
  end if;

  select * into v_wd from public.supervisor_workdays where id = v_event.workday_id for update;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if v_event.kind <> 'pause' then
    raise exception using
      errcode = 'P0001',
      message = 'Ese evento no es una pausa.',
      hint = 'EVENT_NOT_PAUSE';
  end if;

  -- La pausa tiene que seguir abierta: ser el último evento de jornada vigente.
  select e.* into v_last
  from public.supervisor_workday_events e
  where e.workday_id = v_wd.id
    and e.removed_at is null
    and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  order by e.recorded_at desc, e.seq desc
  limit 1;

  if v_last.id is distinct from v_event.id then
    raise exception using
      errcode = 'P0001',
      message = 'Esa pausa ya está cerrada.',
      hint = 'PAUSE_NOT_OPEN';
  end if;

  v_at := coalesce(p_at, now());
  perform app.check_correction_time(v_wd.work_date, v_at);

  if v_at <= v_event.recorded_at then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de reanudación tiene que ser posterior al inicio de la pausa.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  v_resume := app.add_workday_event(v_wd.id, 'resume', v_at, null, null, null, null);

  update public.supervisor_workday_events
  set corrected_at = now(), corrected_by = auth.uid(), correction_reason = v_reason
  where id in (v_event.id, v_resume.id);

  perform app.assert_workday_consistent(v_wd.id);
  perform app.sync_workday(v_wd.id);

  update public.supervisor_workdays
  set corrected = true, updated_by = auth.uid()
  where id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_wd.supervisor_id,
    jsonb_build_object(
      'action', 'close_pause',
      'workday_id', v_wd.id,
      'pause_event_id', v_event.id,
      'resume_event_id', v_resume.id,
      'pause_started_at', v_event.recorded_at,
      'resumed_at', v_at,
      'reason', v_reason
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_close_workday_pause(uuid, text, timestamptz) is
  'Cierra una pausa abierta de un coordinador a la hora indicada, agregando la reanudación (OD-07, 0079). p_event_id: el evento pause; p_reason: motivo de la corrección (obligatorio); p_at: hora de reanudación (por defecto, ahora). O, A con manage_attendance. EVENT_NOT_FOUND, REASON_REQUIRED, EVENT_NOT_PAUSE, PAUSE_NOT_OPEN (ya tiene reanudación o la jornada terminó), AT_OUT_OF_RANGE, INVALID_TIME_RANGE (no posterior al inicio de la pausa), INVALID_EVENT_ORDER. Marca la jornada corrected y registra workday_corrected (action close_pause). Devuelve el estado de la jornada.';

-- ---------------------------------------------------------------------------------------------
-- 8. OD-07: admin_correct_workday_event con el motivo de la pausa
--    Cambia de firma (suma p_pause_reason al final): se elimina la anterior. Las llamadas con los
--    cuatro parámetros anteriores siguen funcionando.
-- ---------------------------------------------------------------------------------------------

drop function public.admin_correct_workday_event(uuid, text, timestamptz, boolean);

create function public.admin_correct_workday_event(
  p_event_id uuid,
  p_reason text,
  p_new_time timestamptz default null,
  p_remove boolean default false,
  p_pause_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_event public.supervisor_workday_events;
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_old timestamptz;
  v_next public.supervisor_workday_events;
  v_auto_ids uuid[] := array[]::uuid[];
  v_change_time boolean;
  v_change_pause_reason boolean := (p_pause_reason is not null);
  v_new_pause_reason text := nullif(btrim(p_pause_reason), '');
begin
  perform app.require_capability('manage_attendance');

  select * into v_event from public.supervisor_workday_events where id = p_event_id for update;

  if v_event.id is null or v_event.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese evento de la jornada.',
      hint = 'EVENT_NOT_FOUND';
  end if;

  select * into v_wd from public.supervisor_workdays where id = v_event.workday_id for update;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if v_event.kind in ('supervision_start', 'supervision_end') then
    raise exception using
      errcode = 'P0001',
      message = case
        when v_event.kind = 'supervision_end' and v_event.reason = 'Cierre automático'
          then 'El fin automático de una supervisión se ajusta solo cuando corregís el fin de la jornada.'
        else 'Los eventos de una supervisión no se corrigen desde la jornada. Usá la corrección de la supervisión.'
      end,
      hint = 'EVENT_NOT_CORRECTABLE';
  end if;

  v_old := v_event.recorded_at;

  if coalesce(p_remove, false) then
    if v_event.kind <> 'pause' then
      raise exception using
        errcode = 'P0001',
        message = 'Solo se pueden quitar las pausas.',
        hint = 'EVENT_NOT_REMOVABLE';
    end if;

    -- La pausa se quita junto con la reanudación que la cierra (si la cierra una).
    select e.* into v_next
    from public.supervisor_workday_events e
    where e.workday_id = v_event.workday_id
      and e.removed_at is null
      and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
      and (e.recorded_at, e.seq) > (v_event.recorded_at, v_event.seq)
    order by e.recorded_at, e.seq
    limit 1;

    update public.supervisor_workday_events
    set removed_at = now(), removed_by = auth.uid(), correction_reason = v_reason,
        corrected_by = auth.uid(), corrected_at = now()
    where id = v_event.id;

    if v_next.id is not null and v_next.kind = 'resume' then
      update public.supervisor_workday_events
      set removed_at = now(), removed_by = auth.uid(), correction_reason = v_reason,
          corrected_by = auth.uid(), corrected_at = now()
      where id = v_next.id;
    end if;
  else
    if p_new_time is null and not v_change_pause_reason then
      raise exception using
        errcode = 'P0001',
        message = 'Indicá la hora nueva o el motivo de la pausa.',
        hint = 'TIME_REQUIRED';
    end if;

    if v_change_pause_reason then
      if v_event.kind <> 'pause' then
        raise exception using
          errcode = 'P0001',
          message = 'Solo las pausas tienen motivo.',
          hint = 'EVENT_NOT_PAUSE';
      end if;

      if v_new_pause_reason is not null and char_length(v_new_pause_reason) > 300 then
        raise exception using
          errcode = 'P0001',
          message = 'El motivo es demasiado largo (máximo 300 caracteres).',
          hint = 'REASON_TOO_LONG';
      end if;
    end if;

    v_change_time := (p_new_time is not null and p_new_time <> v_event.recorded_at);

    if p_new_time is not null then
      perform app.check_correction_time(v_wd.work_date, p_new_time);
    end if;

    if not v_change_time and (not v_change_pause_reason or v_new_pause_reason is not distinct from v_event.reason) then
      raise exception using
        errcode = 'P0001',
        message = case when p_new_time is not null and not v_change_pause_reason
          then 'La hora nueva es igual a la actual.'
          else 'No hay nada para cambiar.' end,
        hint = case when p_new_time is not null and not v_change_pause_reason then 'SAME_TIME' else 'NO_CHANGES' end;
    end if;

    -- 0064 (DEF-P24-01): si es el fin de un cierre automático, los supervision_end que generó ese
    -- mismo cierre (reason «Cierre automático», misma hora que el fin, supervisión no cancelada)
    -- acompañan a la hora nueva. El que registró el coordinador (sin reason) no se toca.
    if v_change_time and v_event.kind = 'end' and v_event.reason = 'Cierre automático' then
      select coalesce(array_agg(e.id), array[]::uuid[]) into v_auto_ids
      from public.supervisor_workday_events e
      join public.supervisions sv on sv.id = e.supervision_id
      where e.workday_id = v_wd.id
        and e.kind = 'supervision_end'
        and e.reason = 'Cierre automático'
        and e.removed_at is null
        and e.recorded_at = v_old
        and sv.status <> 'cancelled';

      -- Caso borde: la hora nueva no puede quedar antes del inicio de esas supervisiones.
      if exists (
        select 1
        from public.supervisor_workday_events e
        join public.supervision_attendance ci on ci.supervision_id = e.supervision_id and ci.kind = 'check_in'
        where e.id = any (v_auto_ids)
          and ci.recorded_at > p_new_time
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'La hora de fin queda antes del inicio de una supervisión que se cerró sola. Elegí una hora posterior o cancelá esa supervisión antes.',
          hint = 'END_BEFORE_SUPERVISION_START';
      end if;

      update public.supervisor_workday_events
      set recorded_at = p_new_time,
          corrected_from = coalesce(corrected_from, v_old),
          corrected_at = now(),
          corrected_by = auth.uid(),
          correction_reason = v_reason
      where id = any (v_auto_ids);

      update public.supervision_attendance sa
      set recorded_at = p_new_time
      from public.supervisor_workday_events e
      where e.id = any (v_auto_ids)
        and sa.supervision_id = e.supervision_id
        and sa.kind = 'check_out'
        and sa.recorded_at = v_old;
    end if;

    update public.supervisor_workday_events
    set recorded_at = case when v_change_time then p_new_time else recorded_at end,
        reason = case when v_change_pause_reason then v_new_pause_reason else reason end,
        corrected_from = case when v_change_time then coalesce(corrected_from, v_old) else corrected_from end,
        corrected_at = now(),
        corrected_by = auth.uid(),
        correction_reason = v_reason
    where id = v_event.id;
  end if;

  perform app.assert_workday_consistent(v_wd.id);
  perform app.sync_workday(v_wd.id);

  update public.supervisor_workdays
  set corrected = true, updated_by = auth.uid()
  where id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_wd.supervisor_id,
    jsonb_build_object(
      'action', case
        when coalesce(p_remove, false) then 'remove_pause'
        when v_change_pause_reason and not coalesce(v_change_time, false) then 'correct_pause_reason'
        else 'correct_event'
      end,
      'workday_id', v_wd.id,
      'event_id', v_event.id,
      'kind', v_event.kind,
      'old_recorded_at', v_old,
      'new_recorded_at', case when coalesce(p_remove, false) or not coalesce(v_change_time, false) then null else p_new_time end,
      'old_pause_reason', case when v_change_pause_reason then v_event.reason end,
      'new_pause_reason', case when v_change_pause_reason then v_new_pause_reason end,
      'reason', v_reason,
      'adjusted_supervision_event_ids', to_jsonb(v_auto_ids)
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean, text) is
  'Corrige un evento de la jornada de un coordinador (CJ-32, OD-07): la hora de un inicio, pausa, reanudación, fin o reapertura (p_new_time), el motivo de una pausa (p_pause_reason: texto nuevo; cadena vacía lo borra, que es opcional por CJ-16; nulo = no se toca) o, con p_remove = true, da de baja una pausa junto con su reanudación. Se puede cambiar la hora y el motivo de la pausa en la misma llamada. O, A con manage_attendance (FORBIDDEN si no). p_reason: motivo de la corrección, obligatorio. Guarda la hora anterior en el evento (corrected_from), marca la jornada como corrected y registra workday_corrected en security_events (con el motivo de pausa anterior y el nuevo). Desde 0064 (CJ-17), al corregir el fin de una jornada cerrada sola, el fin automático de sus supervisiones «Sin cerrar» se ajusta a la hora nueva en la misma transacción. EVENT_NOT_FOUND, REASON_REQUIRED, EVENT_NOT_CORRECTABLE (eventos de supervisión: ver admin_correct_supervision_time), EVENT_NOT_REMOVABLE (solo se quitan pausas), EVENT_NOT_PAUSE (p_pause_reason en un evento que no es pausa), REASON_TOO_LONG (máximo 300), TIME_REQUIRED (ni hora ni motivo de pausa), AT_OUT_OF_RANGE, SAME_TIME (solo hora, igual a la actual), NO_CHANGES (el motivo de la pausa queda igual), END_BEFORE_SUPERVISION_START, INVALID_EVENT_ORDER. Devuelve el estado de la jornada.';

-- ---------------------------------------------------------------------------------------------
-- 9. OD-07: admin_correct_supervision_time
-- ---------------------------------------------------------------------------------------------

create function public.admin_correct_supervision_time(
  p_supervision_id uuid,
  p_reason text,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_sv public.supervisions;
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_day date;
  v_ci public.supervision_attendance;
  v_co public.supervision_attendance;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_start_changed boolean;
  v_end_changed boolean;
begin
  perform app.require_capability('manage_attendance');

  select * into v_sv from public.supervisions where id = p_supervision_id for update;

  if v_sv.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_start_at is null and p_end_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la hora de inicio o la de fin.',
      hint = 'TIME_REQUIRED';
  end if;

  if v_sv.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Una supervisión cancelada no se corrige.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  select * into v_ci from public.supervision_attendance where supervision_id = p_supervision_id and kind = 'check_in';
  select * into v_co from public.supervision_attendance where supervision_id = p_supervision_id and kind = 'check_out';

  if v_ci.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión no tiene inicio registrado.',
      hint = 'NOT_STARTED';
  end if;

  if p_end_at is not null and v_co.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión todavía no tiene fin. Cerrala o finalizá la jornada antes de corregir el fin.',
      hint = 'SUPERVISION_NOT_CLOSED';
  end if;

  if v_sv.workday_id is not null then
    select * into v_wd from public.supervisor_workdays where id = v_sv.workday_id for update;
    v_day := v_wd.work_date;
  else
    select sh.shift_date into v_day from public.shifts sh where sh.id = v_sv.shift_id;
  end if;

  v_new_start := coalesce(p_start_at, v_ci.recorded_at);
  v_new_end := coalesce(p_end_at, v_co.recorded_at);
  v_start_changed := (p_start_at is not null and p_start_at <> v_ci.recorded_at);
  v_end_changed := (p_end_at is not null and p_end_at <> v_co.recorded_at);

  if p_start_at is not null then perform app.check_correction_time(v_day, p_start_at); end if;
  if p_end_at is not null then perform app.check_correction_time(v_day, p_end_at); end if;

  if v_new_end is not null and v_new_end <= v_new_start then
    raise exception using
      errcode = 'P0001',
      message = 'El fin de la supervisión tiene que ser posterior al inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if not v_start_changed and not v_end_changed then
    raise exception using
      errcode = 'P0001',
      message = 'Las horas nuevas son iguales a las actuales.',
      hint = 'SAME_TIME';
  end if;

  if v_start_changed then
    update public.supervision_attendance set recorded_at = p_start_at where id = v_ci.id;

    update public.supervisor_workday_events
    set recorded_at = p_start_at,
        corrected_from = coalesce(corrected_from, v_ci.recorded_at),
        corrected_at = now(),
        corrected_by = auth.uid(),
        correction_reason = v_reason
    where supervision_id = p_supervision_id and kind = 'supervision_start' and removed_at is null;
  end if;

  if v_end_changed then
    update public.supervision_attendance set recorded_at = p_end_at where id = v_co.id;

    update public.supervisor_workday_events
    set recorded_at = p_end_at,
        corrected_from = coalesce(corrected_from, v_co.recorded_at),
        corrected_at = now(),
        corrected_by = auth.uid(),
        correction_reason = v_reason
    where supervision_id = p_supervision_id and kind = 'supervision_end' and removed_at is null;
  end if;

  if v_wd.id is not null then
    perform app.assert_workday_consistent(v_wd.id);

    update public.supervisor_workdays
    set corrected = true, updated_by = auth.uid()
    where id = v_wd.id;
  end if;

  update public.supervisions set updated_by = auth.uid() where id = p_supervision_id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_sv.supervisor_id,
    jsonb_build_object(
      'action', 'correct_supervision_time',
      'workday_id', v_sv.workday_id,
      'supervision_id', p_supervision_id,
      'old_start_at', v_ci.recorded_at,
      'new_start_at', case when v_start_changed then p_start_at end,
      'old_end_at', v_co.recorded_at,
      'new_end_at', case when v_end_changed then p_end_at end,
      'reason', v_reason
    )
  );

  return jsonb_build_object(
    'supervision_id', p_supervision_id,
    'status', v_sv.status,
    'check_in_at', v_new_start,
    'check_out_at', v_new_end,
    'duration_minutes', app.minutes_between(v_new_start, v_new_end),
    'workday', case when v_wd.id is not null then app.workday_snapshot(v_wd.id) end
  );
end;
$$;

comment on function public.admin_correct_supervision_time(uuid, text, timestamptz, timestamptz) is
  'Corrige la hora de inicio y/o de fin de una supervisión (OD-07, 0079): actualiza el registro de supervision_attendance y los eventos supervision_start / supervision_end de la jornada, con la traza de CJ-32 (corrected_from, corrected_*, la jornada pasa a corrected) y un workday_corrected en security_events. O, A con manage_attendance (FORBIDDEN si no). p_reason: motivo obligatorio; al menos una de p_start_at / p_end_at. SUPERVISION_NOT_FOUND, REASON_REQUIRED, TIME_REQUIRED, SUPERVISION_NOT_EDITABLE (cancelada), NOT_STARTED (sin inicio), SUPERVISION_NOT_CLOSED (p_end_at en una supervisión sin fin), AT_OUT_OF_RANGE (dentro del día de la jornada y no futura), INVALID_TIME_RANGE (fin no posterior al inicio), SAME_TIME, INVALID_EVENT_ORDER (la supervisión queda fuera de la jornada en marcha). Devuelve {supervision_id, status, check_in_at, check_out_at, duration_minutes, workday}.';

-- ---------------------------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.admin_end_workday(uuid, text, timestamptz) from public, anon;
revoke execute on function public.admin_close_workday_pause(uuid, text, timestamptz) from public, anon;
revoke execute on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean, text) from public, anon;
revoke execute on function public.admin_correct_supervision_time(uuid, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_end_workday(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.admin_close_workday_pause(uuid, text, timestamptz) to authenticated, service_role;
grant execute on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean, text) to authenticated, service_role;
grant execute on function public.admin_correct_supervision_time(uuid, text, timestamptz, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 11. OD-05: v_supervisor_workdays_admin para la pantalla de jornadas (columnas nuevas al final)
-- ---------------------------------------------------------------------------------------------

create or replace view public.v_supervisor_workdays_admin
with (security_invoker = true)
as
select
  w.id,
  w.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  w.work_date,
  w.started_at,
  w.ended_at,
  app.workday_state(w.id) as state,
  app.workday_minutes(w.id) as worked_minutes,
  greatest(
    app.minutes_between(w.started_at, coalesce(w.ended_at, now())) - app.workday_minutes(w.id),
    0
  ) as pause_minutes,
  w.auto_closed,
  (w.auto_closed and not w.corrected) as auto_close_warning,
  w.corrected,
  app.workday_pauses(w.id) as pauses,
  app.workday_supervisions(w.id) as supervisions,
  (select count(*) from public.supervisions sv where sv.workday_id = w.id and sv.status <> 'cancelled') as supervisions_count,
  app.workday_events_json(w.id) as events,
  w.created_at,
  w.updated_at,
  case
    when w.ended_at is null then 'open'
    when w.auto_closed then 'auto_closed'
    else 'closed'
  end as list_status,
  (w.ended_at is null) as is_open,
  (
    select e.id
    from public.supervisor_workday_events e
    where e.workday_id = w.id
      and e.removed_at is null
      and e.kind = 'pause'
      and app.workday_state(w.id) = 'paused'
    order by e.recorded_at desc, e.seq desc
    limit 1
  ) as open_pause_event_id,
  app.open_supervision_id(w.id) as open_supervision_id,
  em.employee_number as supervisor_employee_number,
  p.avatar_path as supervisor_avatar_path
from public.supervisor_workdays w
join public.profiles p on p.id = w.supervisor_id
left join public.employees em on em.profile_id = w.supervisor_id
where app.is_admin();

comment on view public.v_supervisor_workdays_admin is
  'Jornadas de los coordinadores para la ficha, las correcciones, los informes (0063, CJ-13, CJ-19, CJ-32) y la pantalla «Jornadas» de Supervisiones (0079, OD-05). state: running | paused | ended. worked_minutes: neto (inicio a fin menos pausas; las supervisiones no suman, CJ-14). pause_minutes: bruto menos neto. auto_closed: constancia del cierre automático (CJ-31); auto_close_warning: auto_closed y todavía sin corregir; corrected: la administración la corrigió o la registró. pauses: [{ type (pause | reopened), pause_event_id, resume_event_id, starts_at, ends_at, minutes, reason, corrected }]. supervisions: [{ supervision_id, shift_id, client_id, client_legal_name, site_id, site_name, status, check_in_at, check_out_at, duration_minutes (informativa), unclosed }]. events: eventos ordenados con corrected_from / correction_reason y removed, sin coordenadas. Desde 0079: list_status (open | closed | auto_closed; el filtro «corregida» es corrected = true), is_open, open_pause_event_id (la pausa abierta, si la hay: para «Cerrar pausa»), open_supervision_id (la supervisión abierta, si la hay), supervisor_employee_number (legajo) y supervisor_avatar_path. Filtros de la pantalla: período = work_date, coordinador = supervisor_id, estado = list_status / corrected. Solo trae filas para dueño y administradores.';
