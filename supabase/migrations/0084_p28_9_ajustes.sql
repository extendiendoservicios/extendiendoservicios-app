-- P28.9a (0084): ajustes después del pase de P28 (observaciones de la dirección, respuestas del 13 nov 2026).
--
--   1. OF-05b: preview_service_changes y apply_service_changes reciben p_create_missing (default
--      true); en falso no generan turnos faltantes. Se reemplazan las firmas de 0082.
--   2. OF-23: move_assignment_to_new_shift (crea el turno destino y pasa a la persona, atómico).
--   3. OF-08b: get_leave_conflicts y assign_supervision devuelven el detail de OF-08
--      (app.shift_brief); get_leave_conflicts suma service_id, service_name y detail al final.
--   4. OF-22: client_service_summary (fuente de la hoja imprimible de asistencia) suma
--      check_out_auto_closed por empleado.

-- ---------------------------------------------------------------------------------------------
-- 2. OF-23: pasar a una persona a un turno nuevo, creado en el mismo paso
-- ---------------------------------------------------------------------------------------------

-- Crea un turno del mismo servicio y sede que el turno actual de la asignación (fecha y horario
-- pedidos, dotación 1) y pasa a la persona a ese turno con move_assignment (0082). Todo corre en
-- la transacción de la función: si el pase falla (licencia, superposición, fichaje, etc.) el
-- turno nuevo tampoco queda.
create function public.move_assignment_to_new_shift(
  p_assignment_id uuid,
  p_date date,
  p_start time,
  p_end time
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_old public.assignments;
  v_old_shift public.shifts;
  v_created jsonb;
  v_new_shift_id uuid;
  v_res jsonb;
  v_service_taken boolean;
  v_photos boolean;
begin
  perform app.require_role('owner', 'admin');

  if p_date is null or p_start is null or p_end is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la fecha y el horario del turno nuevo.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  select * into v_old from public.assignments where id = p_assignment_id and removed_at is null;

  if v_old.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  select * into v_old_shift from public.shifts where id = v_old.shift_id;

  -- Un servicio genera a lo sumo un turno vigente por fecha (índice único service_id + shift_date).
  -- Si ya tiene uno ese día (el caso normal de «Solo a <nombre>» a otro horario el mismo día), el
  -- turno nuevo es manual, sin servicio, del mismo cliente y sede, con la opción de fotos del
  -- servicio. Si no tiene, nace con el servicio.
  if v_old_shift.service_id is not null then
    v_service_taken := exists (
      select 1 from public.shifts s
      where s.service_id = v_old_shift.service_id and s.shift_date = p_date and s.deleted_at is null
    );
    v_photos := (select sv.requires_photos from public.services sv where sv.id = v_old_shift.service_id);
  else
    v_service_taken := false;
    v_photos := v_old_shift.requires_photos;
  end if;

  v_created := app.create_shift_core(
    v_old_shift.client_id, v_old_shift.site_id, p_date, p_start, p_end, 1::smallint,
    case when v_service_taken then null else v_old_shift.service_id end,
    null, false, true, null, null, v_photos
  );

  v_new_shift_id := (v_created -> 'shift' ->> 'id')::uuid;

  v_res := public.move_assignment(p_assignment_id, v_new_shift_id, null, null);

  return v_res || jsonb_build_object(
    'shift_id', v_new_shift_id,
    'assignment_id', v_res -> 'assignment' ->> 'id',
    'shift', (select to_jsonb(sh) from public.shifts sh where sh.id = v_new_shift_id),
    'shift_warnings', v_created -> 'warnings'
  );
end;
$$;

comment on function public.move_assignment_to_new_shift(uuid, date, time, time) is
  'Pasa a una persona a un turno nuevo que se crea en el mismo paso (0084, OF-23), en una transacción. O, A. p_assignment_id = la asignación vigente de origen; p_date, p_start y p_end = fecha y horario del turno nuevo, que es del mismo cliente y sede que el turno actual de la asignación y, si no hay conflicto de fecha, del mismo servicio, con dotación 1, sin observación (turno manual: generated = false) y con la opción de fotos del servicio; si el servicio ya tiene un turno vigente esa fecha (lo normal al pasar a la persona a otro horario el mismo día) el turno nuevo nace SIN servicio (service_id null, manual), del mismo cliente y sede, porque un servicio no puede tener dos turnos el mismo día. El pase es el de move_assignment (0082): quita la asignación de origen con motivo «Movido a otro turno» y asigna en el nuevo con todas las validaciones de assign_employee (ON_LEAVE y ASSIGNMENT_OVERLAP con el detail de OF-08, ASSIGNMENT_STARTED, SHIFT_CANCELLED, SHIFT_COMPLETED, SHIFT_STARTED, etc.). Errores propios: ASSIGNMENT_NOT_FOUND, INVALID_TIME_RANGE (fecha u horario faltantes, o fin no posterior al inicio). Si algo falla no queda ni el turno ni el pase. Devuelve el mismo objeto que move_assignment ({assignment, warnings, previous, removed_assignment_id}) más {shift_id (turno nuevo), assignment_id (asignación nueva), shift (fila del turno nuevo), shift_warnings (por ejemplo HOLIDAY)}. Para «Deshacer»: move_assignment(assignment_id, previous.shift_id, previous.start_time, previous.end_time) y después borrar el turno nuevo (shift_id).';

revoke execute on function public.move_assignment_to_new_shift(uuid, date, time, time) from public, anon;
grant execute on function public.move_assignment_to_new_shift(uuid, date, time, time) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. OF-08b: detail de OF-08 en get_leave_conflicts y assign_supervision
-- ---------------------------------------------------------------------------------------------

-- Los datos de un turno para «Ver turno» en los mensajes: las mismas claves que
-- app.overlap_conflict (conflict_shift_id, conflict_assignment_id, client_id, client_name,
-- site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended) y
-- shift_id (igual a conflict_shift_id). Con p_assignment_id el horario es el efectivo de esa
-- asignación (su franja propia si la tiene).
create function app.shift_brief(p_shift_id uuid, p_assignment_id uuid default null)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'shift_id', sh.id,
    'conflict_shift_id', sh.id,
    'conflict_assignment_id', a.id,
    'client_id', sh.client_id,
    'client_name', coalesce(nullif(btrim(cl.trade_name), ''), cl.legal_name),
    'site_id', sh.site_id,
    'site_name', si.name,
    'service_id', sh.service_id,
    'service_name', sv.name,
    'shift_date', sh.shift_date,
    'start_time', coalesce(a.start_time, sh.start_time),
    'end_time', coalesce(a.end_time, sh.end_time),
    'open_ended', (sh.open_ended and a.end_time is null)
  )
  from public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  left join public.services sv on sv.id = sh.service_id
  left join public.assignments a on a.id = p_assignment_id
  where sh.id = p_shift_id;
$$;

comment on function app.shift_brief(uuid, uuid) is
  'Uso interno (0084, OF-08b): datos de un turno para el detail de los mensajes («Ver turno»): shift_id, conflict_shift_id, conflict_assignment_id, client_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended. Con p_assignment_id, el horario efectivo de esa asignación.';

revoke execute on function app.shift_brief(uuid, uuid) from public, anon, authenticated;

-- get_leave_conflicts devuelve filas, no lanza error: se suman al final tres columnas (service_id,
-- service_name, detail) y las anteriores quedan igual. Cambia el tipo de retorno, así que se
-- reemplaza la función.
drop function public.get_leave_conflicts(uuid, date, date);

create function public.get_leave_conflicts(
  p_employee_id uuid,
  p_starts_on date,
  p_ends_on date default null
)
returns table (
  assignment_id uuid,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  open_ended boolean,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  shift_status public.shift_status,
  service_id uuid,
  service_name text,
  detail jsonb
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
begin
  perform app.require_role('owner', 'admin');

  if p_employee_id is null or p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception using
      errcode = 'P0001',
      message = 'El período de la licencia no es válido.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  return query
  select a.id,
         sh.id,
         sh.shift_date,
         coalesce(a.start_time, sh.start_time),
         coalesce(a.end_time, sh.end_time),
         (sh.open_ended and a.end_time is null),
         sh.client_id,
         cl.legal_name,
         sh.site_id,
         si.name,
         sh.status,
         sh.service_id,
         sv.name,
         app.shift_brief(sh.id, a.id) || jsonb_build_object(
           'code', 'SHIFT_IN_LEAVE',
           'employee_id', p_employee_id,
           'employee_name', app.person_label(p_employee_id),
           'message', app.person_label(p_employee_id) || ' ya está en ' || si.name
             || ' (' || coalesce(sv.name, 'turno manual') || ') el ' || app.fmt_dia(sh.shift_date)
             || ' de ' || app.fmt_hora(coalesce(a.start_time, sh.start_time))
             || case
                  when sh.open_ended and a.end_time is null then ' (a terminar).'
                  else ' a ' || app.fmt_hora(coalesce(a.end_time, sh.end_time)) || '.'
                end
         )
  from public.assignments a
  join public.shifts sh on sh.id = a.shift_id and sh.deleted_at is null
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  left join public.services sv on sv.id = sh.service_id
  where a.employee_id = p_employee_id
    and a.removed_at is null
    and sh.status not in ('cancelled', 'completed')
    and sh.shift_date >= app.today()
    and sh.shift_date >= p_starts_on
    and (p_ends_on is null or sh.shift_date <= p_ends_on)
  order by sh.shift_date, coalesce(a.start_time, sh.start_time), sh.id;
end;
$$;

comment on function public.get_leave_conflicts(uuid, date, date) is
  'Turnos que un empleado ya tiene asignados dentro de un período de licencia (0059, P19.11a). O, A. p_ends_on null = licencia abierta. Devuelve las asignaciones vigentes de turnos no cancelados ni finalizados, desde hoy (hora de Argentina), con fecha, horario efectivo, cliente, sede y estado del turno. No desasigna nada: la pantalla avisa y lista después de guardar la licencia. INVALID_DATE_RANGE si p_ends_on < p_starts_on. Desde 0084 (OF-08b) suma al final service_id, service_name y detail (jsonb, el mismo formato que el detail de OF-08): {code: SHIFT_IN_LEAVE, employee_id, employee_name, shift_id, conflict_shift_id, conflict_assignment_id, client_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended, message}, con message «Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.». Las columnas anteriores no cambian.';

revoke execute on function public.get_leave_conflicts(uuid, date, date) from public, anon;
grant execute on function public.get_leave_conflicts(uuid, date, date) to authenticated;

-- assign_supervision (0061): ON_LEAVE ahora dice qué licencia es y trae el detail de OF-08. El
-- resto no cambia. Sigue sin execute para authenticated (0063): la pantalla usa take_supervision.
create or replace function public.assign_supervision(p_shift_id uuid, p_supervisor_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_shift public.shifts;
  v_supervision public.supervisions;
  v_warnings text[] := array[]::text[];
  v_leave jsonb;
begin
  perform app.require_capability('manage_supervisions');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null for update;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status not in ('scheduled', 'assigned', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no admite asignar una supervisión en su estado actual.',
      hint = 'SHIFT_NOT_SUPERVISABLE';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.employees e on e.profile_id = p.id
    join public.user_roles ur on ur.profile_id = p.id and ur.role = 'supervisor'
    where p.id = p_supervisor_id
      and p.is_active
      and p.deleted_at is null
      and e.status = 'active'
      and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese coordinador no tiene el rol vigente o no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  -- Coordinador de licencia ese día (decisión de Mike del 20 oct 2026): no recibe supervisiones.
  -- Desde 0084 (OF-08b) el mensaje dice la licencia y el detail trae sus datos y los del turno.
  v_leave := app.leave_conflict(p_supervisor_id, v_shift.shift_date);
  if v_leave is not null then
    raise exception using
      errcode = 'P0001',
      message = v_leave ->> 'message',
      hint = 'ON_LEAVE',
      detail = app.conflicts_detail(jsonb_build_array(v_leave || app.shift_brief(p_shift_id)))::text;
  end if;

  begin
    insert into public.supervisions (shift_id, supervisor_id, assigned_by, created_by)
    values (p_shift_id, p_supervisor_id, auth.uid(), auth.uid())
    returning * into v_supervision;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese coordinador ya tiene una supervisión asignada a este turno.',
        hint = 'ALREADY_ASSIGNED';
  end;

  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = p_supervisor_id and a.removed_at is null
  ) then
    v_warnings := array_append(v_warnings, 'SUPERVISES_OWN_SHIFT');
  end if;

  return jsonb_build_object('supervision', to_jsonb(v_supervision), 'warnings', v_warnings);
end;
$function$;

comment on function public.assign_supervision(uuid, uuid) is
  'Asigna un coordinador (rol supervisor) a un turno (04 sección 6.4, 9; 06 sección 12; P-078, P-079). O, A + manage_supervisions. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado o completado), SUPERVISOR_ROLE_REQUIRED (rol vigente y activo), ON_LEAVE (0061, P19.11e: el coordinador tiene una licencia vigente que cubre la fecha del turno; desde 0084, OF-08b, el message dice motivo y rango de la licencia y el detail es un texto JSON con las claves de la licencia (code, employee_id, employee_name, date, leaves [{leave_id, reason, starts_on, ends_on}]) y las del turno (shift_id, conflict_shift_id, client_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended) más conflicts), ALREADY_ASSIGNED (unique_violation de supervisions_shift_id_supervisor_id_key, 0010). Devuelve {"supervision": <fila>, "warnings": [...]} con SUPERVISES_OWN_SHIFT si el coordinador también está asignado como empleado en ese turno -- no bloquea (ratificado 27 sep 2026, P15.0). Sin execute para authenticated desde 0063.';

-- ---------------------------------------------------------------------------------------------
-- 1. OF-05b: p_create_missing en preview_service_changes / apply_service_changes
-- ---------------------------------------------------------------------------------------------

drop function public.apply_service_changes(uuid, date, jsonb);
drop function public.preview_service_changes(uuid, date, jsonb);
drop function app.service_changes_run(uuid, date, jsonb);

create function app.service_changes_run(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb,
  p_create_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_has_time boolean := false;
  v_prev_start time;
  v_prev_end time;
  v_prev_open boolean;
  v_has_staff boolean := false;
  v_prev_staff smallint;
  v_has_photos boolean := false;
  v_prev_photos boolean;
  v_months date[];
  v_month date;
  v_shift public.shifts;
  v_asg record;
  v_reason text;
  v_reason_msg text;
  v_time_diff boolean;
  v_staff_diff boolean;
  v_photos_diff boolean;
  v_notes jsonb;
  v_block text;
  v_block_msg text;
  v_assigned_count integer;
  v_conf jsonb;
  v_removed jsonb;
  v_changes jsonb;
  v_failed boolean;
  v_res jsonb;
  v_gen jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_unassigned jsonb := '[]'::jsonb;
  v_months_out jsonb := '[]'::jsonb;
  v_deleted_count integer := 0;
  v_deleted_assignments integer := 0;
  v_deleted_tasks integer := 0;
  v_deleted_observations integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_skipped_shifts integer := 0;
  v_partial_count integer := 0;
  v_removed_total integer := 0;
  v_created_count integer := 0;
  v_assigned_new integer := 0;
  v_event public.security_events;
begin
  select * into v_service from public.services where id = p_service_id and deleted_at is null for update;

  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  if p_previous is not null then
    begin
      if jsonb_typeof(p_previous) <> 'object' then
        raise exception 'no es un objeto';
      end if;
      v_has_time := (p_previous ? 'start_time') and (p_previous ? 'end_time');
      if v_has_time then
        v_prev_start := (p_previous ->> 'start_time')::time;
        v_prev_end := (p_previous ->> 'end_time')::time;
        v_prev_open := coalesce((p_previous ->> 'open_ended')::boolean, false);
      end if;
      v_has_staff := p_previous ? 'required_staff';
      if v_has_staff then
        v_prev_staff := (p_previous ->> 'required_staff')::smallint;
      end if;
      v_has_photos := p_previous ? 'requires_photos';
      if v_has_photos then
        v_prev_photos := (p_previous ->> 'requires_photos')::boolean;
      end if;
    exception
      when others then
        raise exception using
          errcode = 'P0001',
          message = 'Los valores anteriores del servicio no son válidos.',
          hint = 'INVALID_PREVIOUS';
    end;
  end if;

  -- 1. Meses con turnos generados (antes de borrar).
  select coalesce(array_agg(m.month order by m.month), array[]::date[])
  into v_months
  from (
    select distinct date_trunc('month', sh.shift_date)::date as month
    from public.shifts sh
    where sh.service_id = p_service_id
      and sh.deleted_at is null
      and sh.generated
      and sh.shift_date >= date_trunc('month', p_from_date)::date
  ) m;

  -- 2. Borrar lo que ya no corresponde y actualizar lo que sigue.
  for v_shift in
    select sh.*
    from public.shifts sh
    where sh.service_id = p_service_id
      and sh.deleted_at is null
      and sh.shift_date >= p_from_date
    order by sh.shift_date, sh.start_time, sh.id
    for update
  loop
    v_reason := case
      when not (extract(dow from v_shift.shift_date)::smallint = any (v_service.weekdays)) then 'WEEKDAY'
      when not app.date_matches_weeks_of_month(v_shift.shift_date, v_service.weeks_of_month) then 'WEEK_OF_MONTH'
      when not v_service.works_on_holidays and exists (
        select 1 from public.holidays h where h.holiday_date = v_shift.shift_date and h.deleted_at is null
      ) then 'HOLIDAY'
      when v_shift.shift_date < v_service.valid_from
        or (v_service.valid_to is not null and v_shift.shift_date > v_service.valid_to) then 'OUT_OF_VALIDITY'
      else null
    end;
    v_reason_msg := case v_reason
      when 'WEEKDAY' then 'El servicio ya no se presta ese día de la semana.'
      when 'WEEK_OF_MONTH' then 'El servicio ya no se presta esa semana del mes.'
      when 'HOLIDAY' then 'Es feriado y el servicio no trabaja feriados.'
      when 'OUT_OF_VALIDITY' then 'Está fuera de la vigencia del servicio.'
      else null
    end;

    v_notes := '[]'::jsonb;
    v_time_diff := false;
    v_staff_diff := false;
    v_photos_diff := false;

    if v_reason is null then
      select count(*) into v_assigned_count
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      if (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
         is distinct from (v_service.start_time, v_service.end_time, v_service.open_ended)
      then
        if v_has_time and (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
           is distinct from (v_prev_start, v_prev_end, v_prev_open)
        then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_TIME',
            'message', 'El horario del turno es distinto al que tenía el servicio: se lo cambió a mano y se conserva.'
          ));
        else
          v_time_diff := true;
        end if;
      end if;

      if v_shift.required_staff <> v_service.required_staff then
        if v_has_staff and v_shift.required_staff <> v_prev_staff then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_STAFF',
            'message', 'La dotación del turno es distinta a la que tenía el servicio: se la cambió a mano y se conserva.'
          ));
        elsif v_service.required_staff < v_assigned_count then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'STAFF_BELOW_ASSIGNED',
            'message', 'La dotación nueva es menor que las personas ya asignadas: se conserva la del turno.'
          ));
        else
          v_staff_diff := true;
        end if;
      end if;

      if v_shift.requires_photos <> v_service.requires_photos then
        if v_has_photos and v_shift.requires_photos <> v_prev_photos then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_PHOTOS',
            'message', 'La opción de fotos del turno es distinta a la que tenía el servicio: se la cambió a mano y se conserva.'
          ));
        else
          v_photos_diff := true;
        end if;
      end if;
    end if;

    -- Nada que hacer ni que informar.
    if v_reason is null and not (v_time_diff or v_staff_diff or v_photos_diff) and jsonb_array_length(v_notes) = 0 then
      v_unchanged_count := v_unchanged_count + 1;
      continue;
    end if;

    -- Turnos que no se tocan (solo si había algo para hacer).
    v_block := null;
    v_block_msg := null;
    if v_reason is not null or v_time_diff or v_staff_diff or v_photos_diff then
      v_block := case
        when v_shift.status = 'cancelled' then 'SHIFT_CANCELLED'
        when not v_shift.generated then 'MANUAL_SHIFT'
        when v_shift.status in ('in_progress', 'completed') or now() >= v_shift.starts_at then 'SHIFT_STARTED'
        when v_reason is not null and app.shift_has_history(v_shift.id) then 'HAS_HISTORY'
        when v_reason is null and exists (
          select 1 from public.attendance_records ar
          join public.assignments a on a.id = ar.assignment_id
          where a.shift_id = v_shift.id
        ) then 'HAS_ATTENDANCE'
        when v_reason is null and exists (
          select 1 from public.attendance_notices n
          join public.assignments a on a.id = n.assignment_id
          where a.shift_id = v_shift.id and n.voided_at is null
        ) then 'HAS_NOTICES'
        else null
      end;
      v_block_msg := case v_block
        when 'SHIFT_CANCELLED' then 'El turno está cancelado.'
        when 'MANUAL_SHIFT' then 'El turno se creó a mano, no desde el servicio.'
        when 'SHIFT_STARTED' then 'El turno ya empezó.'
        when 'HAS_HISTORY' then (
          select string_agg(b ->> 'message', ' ') from jsonb_array_elements(app.od_shift_blockers(v_shift.id)) b
        )
        when 'HAS_ATTENDANCE' then 'El turno ya tiene fichajes.'
        when 'HAS_NOTICES' then 'El turno ya tiene avisos de demora o ausencia.'
        else null
      end;
    end if;

    if v_block is not null then
      v_skipped_shifts := v_skipped_shifts + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'scope', 'shift',
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'code', v_block,
        'message', v_block_msg,
        'wanted', case when v_reason is not null then 'delete' else 'update' end
      );
      continue;
    end if;

    -- Borrar.
    if v_reason is not null then
      v_res := app.od_delete_shift_rows(v_shift.id);
      v_deleted_count := v_deleted_count + 1;
      v_deleted_assignments := v_deleted_assignments + (v_res ->> 'assignments')::integer;
      v_deleted_tasks := v_deleted_tasks + (v_res ->> 'tasks')::integer;
      v_deleted_observations := v_deleted_observations + (v_res ->> 'observations')::integer;
      v_snapshots := v_snapshots || jsonb_build_array(v_res -> 'snapshot');
      v_deleted := v_deleted || jsonb_build_object(
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'reason', v_reason,
        'message', v_reason_msg,
        'assignments', (v_res ->> 'assignments')::integer
      );
      continue;
    end if;

    -- Actualizar (con las asignaciones revalidadas si cambia el horario). Todo el bloque se deshace
    -- junto si falla.
    v_removed := '[]'::jsonb;
    v_failed := false;

    begin
      if v_time_diff then
        for v_asg in
          select a.id, a.employee_id, a.start_time, a.end_time
          from public.assignments a
          where a.shift_id = v_shift.id and a.removed_at is null
          order by a.created_at, a.id
        loop
          v_conf := null;

          if (v_asg.start_time is not null and (v_asg.start_time < v_service.start_time or v_asg.start_time >= v_service.end_time))
             or (v_asg.end_time is not null and (v_asg.end_time > v_service.end_time or v_asg.end_time <= v_service.start_time))
          then
            v_conf := jsonb_build_object(
              'code', 'ASSIGNMENT_TIME_OUT_OF_SHIFT',
              'employee_id', v_asg.employee_id,
              'employee_name', app.person_label(v_asg.employee_id),
              'message', app.person_label(v_asg.employee_id) || ' tenía una franja propia que queda fuera del nuevo horario.'
            );
          else
            v_conf := app.leave_conflict(v_asg.employee_id, v_shift.shift_date);
            if v_conf is null then
              v_conf := app.overlap_conflict(
                v_asg.employee_id,
                app.local_ts(v_shift.shift_date, coalesce(v_asg.start_time, v_service.start_time)),
                app.local_ts(v_shift.shift_date, coalesce(v_asg.end_time, v_service.end_time)),
                v_shift.id
              );
            end if;
          end if;

          if v_conf is not null then
            update public.assignments
            set removed_at = now(),
                removed_by = auth.uid(),
                removed_reason = 'Cambio de horario del servicio: ' || (v_conf ->> 'code'),
                updated_by = auth.uid()
            where id = v_asg.id;

            v_removed := v_removed || jsonb_build_array(
              (v_conf - 'leaves') || jsonb_build_object('assignment_id', v_asg.id)
            );
          end if;
        end loop;
      end if;

      update public.shifts
      set start_time = case when v_time_diff then v_service.start_time else start_time end,
          end_time = case when v_time_diff then v_service.end_time else end_time end,
          open_ended = case when v_time_diff then v_service.open_ended else open_ended end,
          required_staff = case when v_staff_diff then v_service.required_staff else required_staff end,
          requires_photos = case when v_photos_diff then v_service.requires_photos else requires_photos end,
          updated_by = auth.uid()
      where id = v_shift.id;

      select count(*) into v_assigned_count
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      -- scheduled <-> assigned según la dotación y los asignados que quedaron (04 sección 6.1).
      update public.shifts
      set status = case
        when status = 'scheduled' and v_assigned_count >= required_staff then 'assigned'
        when status = 'assigned' and v_assigned_count < required_staff then 'scheduled'
        else status
      end
      where id = v_shift.id and status in ('scheduled', 'assigned');
    exception
      when exclusion_violation then
        v_failed := true;
    end;

    if v_failed then
      v_skipped_shifts := v_skipped_shifts + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'scope', 'shift',
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'code', 'ASSIGNMENT_OVERLAP',
        'message', 'No se pudo cambiar el horario: alguien asignado queda superpuesto con otro turno.',
        'wanted', 'update'
      );
      continue;
    end if;

    v_changes := '{}'::jsonb;
    if v_time_diff then
      v_changes := v_changes || jsonb_build_object('time', jsonb_build_object(
        'from', jsonb_build_object('start_time', v_shift.start_time, 'end_time', v_shift.end_time, 'open_ended', v_shift.open_ended),
        'to', jsonb_build_object('start_time', v_service.start_time, 'end_time', v_service.end_time, 'open_ended', v_service.open_ended)
      ));
    end if;
    if v_staff_diff then
      v_changes := v_changes || jsonb_build_object('required_staff', jsonb_build_object(
        'from', v_shift.required_staff, 'to', v_service.required_staff
      ));
    end if;
    if v_photos_diff then
      v_changes := v_changes || jsonb_build_object('requires_photos', jsonb_build_object(
        'from', v_shift.requires_photos, 'to', v_service.requires_photos
      ));
    end if;

    if v_time_diff or v_staff_diff or v_photos_diff then
      v_updated_count := v_updated_count + 1;
      v_removed_total := v_removed_total + jsonb_array_length(v_removed);
      v_updated := v_updated || jsonb_build_object(
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'changes', v_changes,
        'removed', v_removed,
        'kept', v_notes
      );
    end if;

    if jsonb_array_length(v_removed) > 0 or jsonb_array_length(v_notes) > 0 then
      v_partial_count := v_partial_count + 1;
    end if;

    -- Notas de campos conservados, también si el turno no cambió nada más.
    if not (v_time_diff or v_staff_diff or v_photos_diff) then
      v_skipped := v_skipped || (
        select coalesce(jsonb_agg(jsonb_build_object(
          'scope', 'field',
          'shift_id', v_shift.id,
          'shift_date', v_shift.shift_date,
          'code', n ->> 'code',
          'message', n ->> 'message'
        )), '[]'::jsonb)
        from jsonb_array_elements(v_notes) n
      );
    end if;
  end loop;

  -- 3. Generar los que faltan en los meses que ya tenían turnos generados (0084, OF-05b: solo si
  --    p_create_missing; en falso no se crea ningún turno).
  if coalesce(p_create_missing, true) then
    foreach v_month in array v_months
    loop
      v_gen := app.generate_shifts_core(
        extract(year from v_month)::int, extract(month from v_month)::int, p_service_id, p_from_date
      );
      v_created_count := v_created_count + (v_gen ->> 'created')::integer;
      v_assigned_new := v_assigned_new + (v_gen ->> 'assigned')::integer;
      v_created := v_created || (v_gen -> 'created_shifts');
      v_unassigned := v_unassigned || (v_gen -> 'unassigned');
      v_months_out := v_months_out || jsonb_build_array(jsonb_build_object(
        'year', extract(year from v_month)::int,
        'month', extract(month from v_month)::int,
        'created', (v_gen ->> 'created')::integer
      ));
    end loop;
  end if;

  if v_deleted_count > 0 then
    v_event := app.log_security_event(
      'record_deleted',
      auth.uid(),
      null,
      jsonb_build_object(
        'entity', 'service_changes',
        'record_id', p_service_id,
        'name', v_service.name,
        'from_date', p_from_date,
        'deleted_counts', jsonb_build_object(
          'shifts', v_deleted_count, 'assignments', v_deleted_assignments,
          'tasks', v_deleted_tasks, 'observations', v_deleted_observations
        ),
        'snapshot', v_snapshots
      )
    );
  end if;

  return jsonb_build_object(
    'service_id', p_service_id,
    'from_date', p_from_date,
    'deleted_count', v_deleted_count,
    'updated_count', v_updated_count,
    'created_count', v_created_count,
    'unchanged_count', v_unchanged_count,
    'skipped_count', v_skipped_shifts,
    'partial_count', v_partial_count,
    'assignments_removed', v_removed_total + v_deleted_assignments,
    'assignments_added', v_assigned_new,
    'deleted', v_deleted,
    'updated', v_updated,
    'created', v_created,
    'skipped', v_skipped,
    'unassigned', v_unassigned,
    'months', v_months_out,
    'event_id', v_event.id
  );
end;
$$;

comment on function app.service_changes_run(uuid, date, jsonb, boolean) is
  'Uso interno (0082, OF-05; 0084, OF-05b): cuerpo común de preview_service_changes y apply_service_changes. Hace los cambios de verdad; la vista previa los deshace con una subtransacción. p_create_missing = false no genera los turnos faltantes.';

revoke execute on function app.service_changes_run(uuid, date, jsonb, boolean) from public, anon, authenticated;

create function public.apply_service_changes(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb default null,
  p_create_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner', 'admin');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  return app.service_changes_run(p_service_id, p_from_date, p_previous, p_create_missing) || jsonb_build_object('preview', false);
end;
$$;

comment on function public.apply_service_changes(uuid, date, jsonb, boolean) is
  'Aplica a los turnos del servicio con fecha >= p_from_date los cambios que el servicio ya tiene guardados (0082, OF-05). O, A (FORBIDDEN si no). Una sola transacción. (1) Borra los turnos generados, sin historia y que no empezaron, que ya no corresponden: día de la semana, semana del mes, feriado si el servicio no trabaja feriados, o fuera de vigencia. (2) Actualiza a la hora, dotación y opción de fotos del servicio los que siguen; al cambiar el horario revalida a los asignados y quita a los que quedan con franja propia fuera del nuevo horario, de licencia o superpuestos con otro turno (los informa). (3) Genera los turnos que faltan, desde p_from_date y con los empleados fijos, en los meses (desde el de p_from_date) en los que el servicio ya tenía turnos generados, calculados antes de borrar. p_previous (jsonb, opcional) = valores del servicio ANTES de guardarlo: {"start_time", "end_time", "open_ended", "required_staff", "requires_photos"}; por cada campo presente solo se actualizan los turnos que todavía tienen el valor anterior (los demás se consideran cambiados a mano y se conservan: notas MANUAL_TIME, MANUAL_STAFF, MANUAL_PHOTOS); un campo ausente se fuerza en todos los turnos que siguen. No toca turnos cancelados (SHIFT_CANCELLED), creados a mano (MANUAL_SHIFT), que ya empezaron (SHIFT_STARTED), con historia al borrar (HAS_HISTORY) ni con fichajes o avisos al actualizar (HAS_ATTENDANCE, HAS_NOTICES). FROM_DATE_REQUIRED, SERVICE_NOT_FOUND, INVALID_PREVIOUS. Si borra turnos deja un evento record_deleted (entity service_changes) con la copia JSON. Devuelve {"service_id", "from_date", "preview": false, "deleted_count", "updated_count", "created_count", "unchanged_count", "skipped_count" (turnos salteados), "partial_count" (actualizados con asignados quitados o con campos conservados), "assignments_removed", "assignments_added" (fijos de los turnos creados), "deleted": [{shift_id, shift_date, reason: WEEKDAY | WEEK_OF_MONTH | HOLIDAY | OUT_OF_VALIDITY, message, assignments}], "updated": [{shift_id, shift_date, changes: {time: {from, to}, required_staff: {from, to}, requires_photos: {from, to}}, removed: [{assignment_id, code, employee_id, employee_name, message, ...detalle}], kept: [{code, message}]}], "created": [{shift_id, shift_date, service_id}], "skipped": [{scope: "shift" | "field", shift_id, shift_date, code, message, wanted: "delete" | "update"}], "unassigned": [fijos de los turnos creados que no se pudieron asignar: {shift_id, shift_date, employee_id, employee_name, code, message, detail}], "months": [{year, month, created}], "event_id"}. Desde 0084 (OF-05b) el cuarto parámetro p_create_missing (boolean, default true) en falso no genera ningún turno faltante (paso 3): solo actualiza y borra los existentes, para no recrear turnos borrados a propósito; created_count = 0, created, unassigned y months quedan vacíos.';

revoke execute on function public.apply_service_changes(uuid, date, jsonb, boolean) from public, anon;
grant execute on function public.apply_service_changes(uuid, date, jsonb, boolean) to authenticated;

create function public.preview_service_changes(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb default null,
  p_create_missing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_result jsonb;
  v_hint text;
  v_detail text;
begin
  perform app.require_role('owner', 'admin');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  -- Se corre el mismo cuerpo que apply_service_changes dentro de una subtransacción que se
  -- deshace al final: el resultado es exactamente el que daría aplicar, y no queda nada escrito.
  begin
    v_result := app.service_changes_run(p_service_id, p_from_date, p_previous, p_create_missing);

    raise exception using
      errcode = 'P0001',
      message = 'Vista previa: se deshace.',
      hint = 'PREVIEW_ROLLBACK',
      detail = v_result::text;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      if v_hint is distinct from 'PREVIEW_ROLLBACK' then
        raise;
      end if;
      v_result := v_detail::jsonb;
  end;

  return (v_result - 'event_id') || jsonb_build_object('preview', true);
end;
$$;

comment on function public.preview_service_changes(uuid, date, jsonb, boolean) is
  'Vista previa de apply_service_changes (0082, OF-05): devuelve lo mismo que devolvería aplicarlo (mismos conteos y listas, preview = true) sin dejar nada escrito. O, A. Mismos parámetros, errores y contrato que apply_service_changes. Implementación: corre el cuerpo real dentro de una subtransacción que se deshace, así que la vista previa y la aplicación no pueden diferir; toma bloqueos de fila un instante. Desde 0084 (OF-05b) el cuarto parámetro p_create_missing (boolean, default true) en falso no genera ningún turno faltante (paso 3): solo actualiza y borra los existentes, para no recrear turnos borrados a propósito; created_count = 0, created, unassigned y months quedan vacíos.';

revoke execute on function public.preview_service_changes(uuid, date, jsonb, boolean) from public, anon;
grant execute on function public.preview_service_changes(uuid, date, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. OF-22: cierre automático en la hoja imprimible de asistencia (client_service_summary)
-- ---------------------------------------------------------------------------------------------

create or replace function public.client_service_summary(
  p_client_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client_exists boolean;
  v_result jsonb;
begin
  -- Lo ve quien puede ver clientes (clients_select_admin, 0012): dueño y cualquier administrador.
  perform app.require_admin();

  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El rango de fechas no es válido: la fecha desde no puede ser posterior a la fecha hasta.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  select exists (select 1 from public.clients c where c.id = p_client_id) into v_client_exists;

  if not v_client_exists then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  with done_shifts as (
    select sh.id, sh.shift_date, sh.site_id, si.name as site_name, sh.start_time, sh.end_time,
           sh.status, sh.open_ended,
           case when o.show_in_print then nullif(btrim(o.observation), '') end as observation
    from public.shifts sh
    join public.sites si on si.id = sh.site_id
    left join public.shift_observations o on o.shift_id = sh.id
    where sh.client_id = p_client_id
      and sh.deleted_at is null
      and sh.status <> 'cancelled'
      and sh.shift_date between p_from and p_to
      and (
        sh.status = 'completed'
        or exists (
          select 1
          from public.assignments a
          join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
          where a.shift_id = sh.id
        )
      )
  ),
  rows as (
    select
      ds.id as shift_id,
      a.id as assignment_id,
      a.employee_id,
      p.first_name,
      p.last_name,
      a.status,
      ci.recorded_at as check_in_at,
      co.recorded_at as check_out_at,
      (ds.open_ended and a.end_time is null) as open_ended,
      (
        a.status = 'present'
        and ds.open_ended
        and a.end_time is null
        and now() >= upper(a."window")
      ) as no_checkout,
      case
        when ds.open_ended and a.end_time is null then null
        else app.minutes_between(lower(a."window"), upper(a."window"))
      end as planned_minutes,
      app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window")) as worked_minutes,
      ci.geo_status as check_in_geo_status,
      ci.geo_unvalidated_reason as check_in_geo_reason,
      ci.site_distance_m as check_in_distance_m,
      (ci.geo_override_at is not null) as check_in_geo_overridden,
      co.geo_status as check_out_geo_status,
      co.geo_unvalidated_reason as check_out_geo_reason,
      co.site_distance_m as check_out_distance_m,
      (co.geo_override_at is not null) as check_out_geo_overridden,
      coalesce(co.auto_closed, false) as check_out_auto_closed
    from done_shifts ds
    join public.assignments a on a.shift_id = ds.id and a.removed_at is null
    join public.profiles p on p.id = a.employee_id
    left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
  ),
  per_shift as (
    select
      ds.id,
      coalesce(sum(r.worked_minutes), 0)::integer as worked_minutes,
      coalesce(sum(r.planned_minutes) filter (where r.check_in_at is not null), 0)::integer as planned_minutes,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'assignment_id', r.assignment_id,
            'employee_id', r.employee_id,
            'first_name', r.first_name,
            'last_name', r.last_name,
            'status', r.status,
            'check_in_at', r.check_in_at,
            'check_out_at', r.check_out_at,
            'planned_minutes', r.planned_minutes,
            'worked_minutes', r.worked_minutes,
            'open_ended', r.open_ended,
            'no_checkout', r.no_checkout,
            'check_in_geo_status', r.check_in_geo_status,
            'check_in_geo_reason', r.check_in_geo_reason,
            'check_in_distance_m', r.check_in_distance_m,
            'check_in_geo_overridden', r.check_in_geo_overridden,
            'check_out_geo_status', r.check_out_geo_status,
            'check_out_geo_reason', r.check_out_geo_reason,
            'check_out_distance_m', r.check_out_distance_m,
            'check_out_geo_overridden', r.check_out_geo_overridden,
            'check_out_auto_closed', r.check_out_auto_closed
          )
          order by r.last_name, r.first_name, r.assignment_id
        ) filter (where r.assignment_id is not null),
        '[]'::jsonb
      ) as employees
    from done_shifts ds
    left join rows r on r.shift_id = ds.id
    group by ds.id
  )
  select jsonb_build_object(
    'client_id', p_client_id,
    'from', p_from,
    'to', p_to,
    'totals', jsonb_build_object(
      'shifts_done', (select count(*) from done_shifts),
      'employees_count', (select count(distinct employee_id) from rows where check_in_at is not null),
      'worked_minutes', coalesce((select sum(worked_minutes) from rows), 0),
      'planned_minutes', coalesce((select sum(planned_minutes) from rows where check_in_at is not null), 0),
      'open_ended_shifts', (select count(*) from done_shifts where open_ended)
    ),
    'shifts', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'shift_id', ds.id,
            'shift_date', ds.shift_date,
            'site_id', ds.site_id,
            'site_name', ds.site_name,
            'start_time', ds.start_time,
            'end_time', ds.end_time,
            'status', ds.status,
            'worked_minutes', ps.worked_minutes,
            'planned_minutes', ps.planned_minutes,
            'employees', ps.employees,
            'open_ended', ds.open_ended,
            'observation', ds.observation
          )
          order by ds.shift_date, ds.start_time, ds.site_name, ds.id
        )
        from done_shifts ds
        join per_shift ps on ps.id = ds.id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.client_service_summary(uuid, date, date) is
  'Resumen de servicios de un cliente en un período, para la hoja imprimible (0033, P19.5a). O, A (quien ve clientes, clients_select_admin); FORBIDDEN si no; INVALID_DATE_RANGE (fechas nulas o desde > hasta), CLIENT_NOT_FOUND. "Turno realizado": vigente, no cancelado, completed o con al menos un inicio registrado, con shift_date entre p_from y p_to. Devuelve jsonb { client_id, from, to, totals { shifts_done, employees_count (distintos con inicio), worked_minutes, planned_minutes, open_ended_shifts (0037) }, shifts [ { shift_id, shift_date, site_id, site_name, start_time, end_time, status, worked_minutes, planned_minutes, open_ended (0037), observation (0040, AJ2-15: solo si tiene tildada «mostrar en la impresión»), employees [ { assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at, planned_minutes, worked_minutes, open_ended, no_checkout, check_in_geo_status, check_in_geo_reason, check_in_distance_m, check_in_geo_overridden, check_out_geo_status, check_out_geo_reason, check_out_distance_m, check_out_geo_overridden, check_out_auto_closed (0084, OF-22) } ] } ] } ordenado por fecha, hora y sede. worked_minutes cuenta solo la parte del fichaje dentro de la franja efectiva (app.capped_worked_minutes); las asignaciones «A terminar» tienen planned_minutes null. Desde 0056 (P22.4b, B-20, B-40) cada empleado trae la validación por ubicación del inicio y del fin (estado, motivo de «Sin validar», distancia a la sede en metros y si un administrador la corrigió); null si no hay fichaje. Nunca trae coordenadas ni precisión. Desde 0084 (OF-22) cada empleado trae al final check_out_auto_closed (boolean): true si el fin lo registró el cierre automático (el empleado no fichó el fin); las hojas imprimibles marcan esa hora con «*».';

-- ---------------------------------------------------------------------------------------------
-- 5. OF-21: p_exclude_dates en preview_shift_series y create_shift_series («Sacar esas fechas»)
-- ---------------------------------------------------------------------------------------------

drop function public.preview_shift_series(date, date, smallint[], smallint[], boolean);
drop function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean);

create function public.preview_shift_series(
  p_from date,
  p_to date,
  p_weekdays smallint[],
  p_weeks_of_month smallint[] default null,
  p_works_on_holidays boolean default false,
  p_exclude_dates date[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_dates jsonb;
  v_skipped jsonb;
begin
  perform app.require_role('owner', 'admin');

  select
    coalesce(jsonb_agg(d.shift_date order by d.shift_date)
      filter (where (coalesce(p_works_on_holidays, false) or not d.is_holiday)
        and not (p_exclude_dates is not null and d.shift_date = any(p_exclude_dates))), '[]'::jsonb),
    coalesce(jsonb_agg(d.shift_date order by d.shift_date)
      filter (where d.is_holiday and not coalesce(p_works_on_holidays, false)
        and not (p_exclude_dates is not null and d.shift_date = any(p_exclude_dates))), '[]'::jsonb)
  into v_dates, v_skipped
  from app.shift_series_dates(p_from, p_to, p_weekdays, p_weeks_of_month) d;

  return jsonb_build_object(
    'dates', v_dates,
    'holidays_skipped', v_skipped,
    'count', jsonb_array_length(v_dates)
  );
end;
$$;

comment on function public.preview_shift_series(date, date, smallint[], smallint[], boolean, date[]) is
  'Vista previa de create_shift_series (0046, AJ3-08): no escribe nada. O, A. Mismas validaciones de rango y de regla: SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG, INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH. Devuelve {"dates": [fechas que se crearían], "holidays_skipped": [feriados salteados], "count"}. Si ninguna fecha cumple devuelve count 0 (no es error; create_shift_series sí falla con SERIES_EMPTY). Desde 0084 (OF-21) p_exclude_dates (date[], por defecto null) saca esas fechas de dates y de holidays_skipped.';

revoke execute on function public.preview_shift_series(date, date, smallint[], smallint[], boolean, date[]) from public, anon;
grant execute on function public.preview_shift_series(date, date, smallint[], smallint[], boolean, date[]) to authenticated;

create function public.create_shift_series(
  p_client_id uuid,
  p_site_id uuid,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_from date,
  p_to date,
  p_weekdays smallint[],
  p_weeks_of_month smallint[] default null,
  p_works_on_holidays boolean default false,
  p_notes text default null,
  p_open_ended boolean default false,
  p_show_in_print boolean default true,
  p_employee_ids uuid[] default null,
  p_requires_photos boolean default false,
  p_exclude_dates date[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_series_id uuid := gen_random_uuid();
  v_rec record;
  v_res jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_code text;
  v_msg text;
begin
  perform app.require_role('owner', 'admin');

  for v_rec in
    select d.shift_date, d.is_holiday from app.shift_series_dates(p_from, p_to, p_weekdays, p_weeks_of_month) d
  loop
    -- 0084 (OF-21): las fechas excluidas no se crean ni se informan como feriados salteados.
    if p_exclude_dates is not null and v_rec.shift_date = any(p_exclude_dates) then
      continue;
    end if;

    if v_rec.is_holiday and not coalesce(p_works_on_holidays, false) then
      v_skipped := v_skipped || to_jsonb(v_rec.shift_date);
      continue;
    end if;

    begin
      v_res := app.create_shift_core(
        p_client_id, p_site_id, v_rec.shift_date, p_start, p_end, p_required_staff, null,
        p_notes, p_open_ended, p_show_in_print, p_employee_ids, v_series_id, coalesce(p_requires_photos, false)
      );
    exception
      when sqlstate 'P0001' then
        -- Falla todo (la transacción se revierte) y el mensaje indica la fecha que falló.
        get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text;
        raise exception using
          errcode = 'P0001',
          message = v_msg || ' (turno del ' || to_char(v_rec.shift_date, 'DD/MM/YYYY') || ')',
          hint = v_code;
    end;

    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'shift_id', v_res -> 'shift' ->> 'id',
      'shift_date', v_rec.shift_date,
      'warnings', v_res -> 'warnings',
      'assigned', v_res -> 'assigned',
      'rejected', v_res -> 'rejected'
    ));
  end loop;

  if jsonb_array_length(v_created) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Ninguna fecha del período cumple la regla elegida (o todas son feriados).',
      hint = 'SERIES_EMPTY';
  end if;

  return jsonb_build_object(
    'series_id', v_series_id,
    'created', v_created,
    'holidays_skipped', v_skipped
  );
end;
$$;

comment on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean, date[]) is
  'Repite un turno suelto (0046, AJ3-08). O, A (igual que create_shift). Crea un turno por cada fecha entre p_from y p_to (hasta <= desde + 3 meses) que cae en p_weekdays y en p_weeks_of_month (null = todas; 1 a 4 y 5 = última, como services). Si p_works_on_holidays es false, las fechas feriadas se saltean y se informan. Cada turno es independiente y comparte shifts.series_id; copia el checklist y asigna a p_employee_ids como create_shift. Todo en una transacción: si el turno de una fecha falla por una validación (INVALID_TIME_RANGE, CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE...) falla todo y el mensaje indica la fecha; las asignaciones rechazadas no frenan y se informan por fecha. Errores propios: SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG, SERIES_EMPTY, INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH. Desde 0047 (H-07) p_requires_photos (por defecto false) marca todos los turnos creados. Devuelve {"series_id", "created": [{shift_id, shift_date, warnings, assigned, rejected}], "holidays_skipped": [fechas]}. Desde 0084 (OF-21) p_exclude_dates (date[], por defecto null): las fechas excluidas no se crean (ni se informan); si después de excluir no queda ninguna, SERIES_EMPTY.';

revoke execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean, date[]) from public, anon;
grant execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean, date[]) to authenticated;
