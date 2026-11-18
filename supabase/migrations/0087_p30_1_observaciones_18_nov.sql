-- 0087_p30_1_observaciones_18_nov.sql
-- P30.1 (Docs/Plan_Maestro/modulos/P30_observaciones_de_la_duena_18_nov.md, sección 3).
--
--   1. OH-10  app.raise_shift_date_taken + public.create_shift: un servicio que ya tiene turno ese
--             día devuelve SHIFT_DATE_TAKEN con el turno existente (antes: 23505 crudo).
--   2. OH-08  public.save_employee_leave: alta o cambio de la licencia y liberación de las
--             asignaciones del período, en una transacción; con p_preview solo informa. Se quitan
--             el insert, el update general y el delete directos de authenticated sobre
--             employee_leaves (queda la baja lógica: update de deleted_at / updated_by).
--   3. OH-06  public.employee_fixed_gaps: turnos de servicios donde la persona es fija y no está
--             asignada, con el motivo.
--   4. OH-07  public.employee_fixed_pattern, tabla employee_week_boards y RPC
--             save_employee_week_board / get_employee_week_board (cronograma semanal de la ficha).
--   5. OH-09  app.assign_employee_core con p_allow_leave y public.register_past_shift («Registrar
--             como realizado»): turno ya terminado + asignaciones + asistencia, en una transacción.
--   6. OH-11  app.service_changes_run: gana el último cambio (ya no conserva horario, dotación ni
--             fotos cambiados a mano); los cuenta como overridden. Limpia los horarios por persona
--             de los turnos que se actualizan por horario.
--
-- No se agregan valores a security_event_type: la liberación de licencias y la carga posterior
-- quedan trazadas en assignments (removed_*) y attendance_records (recorded_by, reason), como en
-- cancel_shift y remove_assignment. Una sola migración, sin DDL de enums.

-- ---------------------------------------------------------------------------------------------
-- 1. OH-10: SHIFT_DATE_TAKEN al crear un turno de un servicio que ya tiene turno ese día
-- ---------------------------------------------------------------------------------------------

-- Levanta el error SHIFT_DATE_TAKEN con el turno que ya existe: detail (texto JSON) = las claves de
-- app.shift_brief (shift_id, client_id, client_name, site_id, site_name, service_id, service_name,
-- shift_date, start_time, end_time, open_ended) + code, status, assigned [{assignment_id,
-- employee_id, employee_name, start_time, end_time}] y message.
create function app.raise_shift_date_taken(p_service_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_brief jsonb;
  v_assigned jsonb;
  v_msg text;
begin
  select * into v_shift
  from public.shifts sh
  where sh.service_id = p_service_id and sh.shift_date = p_date and sh.deleted_at is null
  limit 1;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Ese servicio ya tiene un turno en esa fecha.',
      hint = 'SHIFT_DATE_TAKEN';
  end if;

  v_brief := app.shift_brief(v_shift.id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'assignment_id', a.id,
           'employee_id', a.employee_id,
           'employee_name', btrim(p.first_name || ' ' || p.last_name),
           'start_time', coalesce(a.start_time, v_shift.start_time),
           'end_time', coalesce(a.end_time, v_shift.end_time)
         ) order by a.created_at, a.id), '[]'::jsonb)
  into v_assigned
  from public.assignments a
  join public.profiles p on p.id = a.employee_id
  where a.shift_id = v_shift.id and a.removed_at is null;

  v_msg := 'Ese servicio ya tiene un turno el ' || app.fmt_dia(p_date) || ' de ' || app.fmt_hora(v_shift.start_time)
    || case when v_shift.open_ended then ' (a terminar).' else ' a ' || app.fmt_hora(v_shift.end_time) || '.' end;

  raise exception using
    errcode = 'P0001',
    message = v_msg,
    hint = 'SHIFT_DATE_TAKEN',
    detail = (v_brief || jsonb_build_object(
      'code', 'SHIFT_DATE_TAKEN',
      'status', v_shift.status,
      'assigned', v_assigned,
      'message', v_msg
    ))::text;
end;
$$;

comment on function app.raise_shift_date_taken(uuid, date) is
  'Uso interno (0087, OH-10): levanta SHIFT_DATE_TAKEN con el turno vigente que el servicio ya tiene ese día. detail (texto JSON) = claves de app.shift_brief + code, status, assigned [{assignment_id, employee_id, employee_name, start_time, end_time}] y message.';

revoke execute on function app.raise_shift_date_taken(uuid, date) from public, anon, authenticated;

create or replace function public.create_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_service_id uuid default null,
  p_notes text default null,
  p_open_ended boolean default false,
  p_show_in_print boolean default true,
  p_employee_ids uuid[] default null,
  p_requires_photos boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_constraint text;
begin
  perform app.require_role('owner', 'admin');

  begin
    return app.create_shift_core(
      p_client_id, p_site_id, p_date, p_start, p_end, p_required_staff, p_service_id,
      p_notes, p_open_ended, p_show_in_print, p_employee_ids, null, p_requires_photos
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if p_service_id is not null and v_constraint = 'shifts_service_id_shift_date_key' then
        perform app.raise_shift_date_taken(p_service_id, p_date);
      end if;
      raise;
  end;
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], boolean) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. Mismas validaciones y retorno que en 0047 (CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE, INVALID_TIME_RANGE; {"shift", "warnings", "assigned", "rejected"}). p_requires_photos: null = hereda services.requires_photos del servicio (o false si es un turno suelto). Desde 0087 (OH-10) si se pide con un p_service_id que ya tiene un turno vigente ese día, devuelve SHIFT_DATE_TAKEN (en lugar del 23505 crudo) y su detail (texto JSON) trae el turno existente: shift_id, client_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended, status, assigned [{assignment_id, employee_id, employee_name, start_time, end_time}] y message. Sin servicio (p_service_id null) no aplica: la unicidad solo rige para turnos de un servicio.';

-- ---------------------------------------------------------------------------------------------
-- 2. OH-08: licencias que liberan los turnos
-- ---------------------------------------------------------------------------------------------

-- La licencia ya no se escribe a mano desde las pantallas: se guarda con save_employee_leave. Queda
-- la baja lógica (deleted_at / updated_by), que sigue siendo un update directo del dueño y la
-- administración (employee_leaves_write_admin). Nada borra físicamente (el borrado del empleado
-- del dueño es una función security definer).
revoke insert, update, delete on public.employee_leaves from authenticated;
grant update (deleted_at, updated_by) on public.employee_leaves to authenticated;

create function public.save_employee_leave(
  p_leave_id uuid,
  p_employee_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text,
  p_preview boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
declare
  v_today date := app.today();
  v_reason text := nullif(btrim(p_reason), '');
  v_leave public.employee_leaves;
  v_leave_json jsonb;
  v_row record;
  v_brief jsonb;
  v_entry jsonb;
  v_who text := app.person_label(p_employee_id);
  v_removed_reason text;
  v_released jsonb := '[]'::jsonb;
  v_kept jsonb := '[]'::jsonb;
  v_released_count integer := 0;
  v_kept_count integer := 0;
  v_remaining integer;
begin
  perform app.require_role('owner', 'admin');

  if p_starts_on is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha es la licencia.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception using
      errcode = 'P0001',
      message = 'La fecha "hasta" no puede ser anterior a la fecha "desde".',
      hint = 'INVALID_DATE_RANGE';
  end if;

  if p_employee_id is null or not exists (
    select 1 from public.employees e where e.profile_id = p_employee_id and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  if p_leave_id is not null then
    select * into v_leave
    from public.employee_leaves l
    where l.id = p_leave_id and l.employee_id = p_employee_id and l.deleted_at is null
    for update;

    if v_leave.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos esa licencia.',
        hint = 'LEAVE_NOT_FOUND';
    end if;
  end if;

  v_removed_reason := 'Licencia'
    || case when v_reason is null then '' else ' (' || v_reason || ')' end
    || ' ' || app.leave_range_text(p_starts_on, p_ends_on);

  -- La licencia (salvo vista previa).
  if p_preview is true then
    v_leave_json := jsonb_build_object(
      'id', p_leave_id, 'employee_id', p_employee_id, 'starts_on', p_starts_on,
      'ends_on', p_ends_on, 'reason', v_reason
    );
  elsif p_leave_id is null then
    insert into public.employee_leaves (employee_id, starts_on, ends_on, reason, created_by)
    values (p_employee_id, p_starts_on, p_ends_on, v_reason, auth.uid())
    returning * into v_leave;
    v_leave_json := to_jsonb(v_leave);
  else
    update public.employee_leaves
    set starts_on = p_starts_on, ends_on = p_ends_on, reason = v_reason, updated_by = auth.uid()
    where id = p_leave_id
    returning * into v_leave;
    v_leave_json := to_jsonb(v_leave);
  end if;

  -- Las asignaciones vigentes del período, desde hoy (Argentina), de turnos que no están
  -- cancelados ni finalizados. Las que tienen algún fichaje son historia de asistencia: no se
  -- tocan y se informan en `kept`.
  for v_row in
    select a.id as assignment_id,
           sh.id as shift_id,
           sh.status as shift_status,
           sh.required_staff,
           exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id) as has_attendance
    from public.assignments a
    join public.shifts sh on sh.id = a.shift_id and sh.deleted_at is null
    where a.employee_id = p_employee_id
      and a.removed_at is null
      and sh.status not in ('cancelled', 'completed')
      and sh.shift_date >= v_today
      and sh.shift_date >= p_starts_on
      and (p_ends_on is null or sh.shift_date <= p_ends_on)
    order by sh.shift_date, coalesce(a.start_time, sh.start_time), sh.id
    for update of sh
  loop
    v_brief := app.shift_brief(v_row.shift_id, v_row.assignment_id);
    v_entry := (v_brief - 'conflict_shift_id' - 'conflict_assignment_id') || jsonb_build_object(
      'assignment_id', v_row.assignment_id,
      'shift_status', v_row.shift_status
    );

    if v_row.has_attendance then
      v_kept_count := v_kept_count + 1;
      v_kept := v_kept || jsonb_build_array(v_entry || jsonb_build_object('detail', v_brief || jsonb_build_object(
        'code', 'LEAVE_KEPT_HAS_ATTENDANCE',
        'employee_id', p_employee_id,
        'employee_name', v_who,
        'message', v_who || ' ya tiene fichajes en ' || (v_brief ->> 'site_name') || ' el '
          || app.fmt_dia((v_brief ->> 'shift_date')::date) || ': ese turno no se toca.'
      )));
      continue;
    end if;

    v_released_count := v_released_count + 1;
    v_released := v_released || jsonb_build_array(v_entry || jsonb_build_object('detail', v_brief || jsonb_build_object(
      'code', 'LEAVE_RELEASED',
      'employee_id', p_employee_id,
      'employee_name', v_who,
      'message', 'Se libera a ' || v_who || ' de ' || (v_brief ->> 'site_name')
        || ' (' || coalesce(v_brief ->> 'service_name', 'turno manual') || ') el '
        || app.fmt_dia((v_brief ->> 'shift_date')::date)
        || ' de ' || app.fmt_hora((v_brief ->> 'start_time')::time)
        || case
             when (v_brief ->> 'open_ended')::boolean then ' (a terminar).'
             else ' a ' || app.fmt_hora((v_brief ->> 'end_time')::time) || '.'
           end
    )));

    if p_preview is true then
      continue;
    end if;

    -- Misma baja lógica que remove_assignment (removed_at / removed_by / removed_reason).
    update public.assignments
    set removed_at = now(),
        removed_by = auth.uid(),
        removed_reason = v_removed_reason,
        updated_by = auth.uid()
    where id = v_row.assignment_id and removed_at is null;

    -- Los avisos de demora o ausencia de esa asignación dejan de valer (quedan como historia).
    update public.attendance_notices
    set voided_at = now(), voided_by = auth.uid(), void_reason = 'LEAVE_RELEASED'
    where assignment_id = v_row.assignment_id and voided_at is null;

    -- assigned -> scheduled si la baja deja la dotación incompleta (04 sección 6.1).
    select count(*) into v_remaining
    from public.assignments a
    where a.shift_id = v_row.shift_id and a.removed_at is null;

    update public.shifts
    set status = 'scheduled', updated_by = auth.uid()
    where id = v_row.shift_id and status = 'assigned' and v_remaining < required_staff;
  end loop;

  return jsonb_build_object(
    'preview', coalesce(p_preview, false),
    'leave', v_leave_json,
    'released', v_released,
    'kept', v_kept,
    'released_count', v_released_count,
    'kept_count', v_kept_count
  );
end;
$$;

comment on function public.save_employee_leave(uuid, uuid, date, date, text, boolean) is
  'Guarda una licencia y libera los turnos del período (0087, OH-08). Solo O, A (FORBIDDEN si no). p_leave_id null = alta; con id = cambio (LEAVE_NOT_FOUND si no existe, está dada de baja o no es de ese empleado). p_ends_on null = licencia abierta. Se pueden superponer licencias (OF-20). INVALID_DATE_RANGE (sin desde o hasta anterior al desde), EMPLOYEE_NOT_FOUND. En la misma transacción quita (removed_at, removed_by, removed_reason «Licencia (motivo) del 3 al 10/11», igual que remove_assignment) las asignaciones vigentes del empleado en turnos no cancelados ni finalizados, con fecha >= hoy (Argentina) dentro del período y SIN fichajes; anula sus avisos (attendance_notices.voided_at, void_reason LEAVE_RELEASED) y vuelve a scheduled los turnos que dejan la dotación incompleta. Las asignaciones con algún fichaje no se tocan y se devuelven en kept. Con p_preview = true no escribe nada y devuelve lo que liberaría. Borrar o acortar una licencia NO vuelve a asignar: los turnos liberados quedan sin cubrir (employee_fixed_gaps los muestra como ON_LEAVE mientras la licencia los cubra y como REMOVED después). Devuelve {"preview", "leave" (la fila; en vista previa los datos pedidos, con id nulo en el alta), "released": [{assignment_id, shift_id, shift_date, start_time, end_time, open_ended, shift_status, client_id, client_name, site_id, site_name, service_id, service_name, detail}], "kept": [...igual], "released_count", "kept_count"}; detail = claves de app.shift_brief + code (LEAVE_RELEASED o LEAVE_KEPT_HAS_ATTENDANCE), employee_id, employee_name y message. Desde 0087 el insert, el update general y el delete directos sobre employee_leaves dejan de estar disponibles para authenticated: solo queda la baja lógica (update de deleted_at y updated_by).';

revoke execute on function public.save_employee_leave(uuid, uuid, date, date, text, boolean) from public, anon;
grant execute on function public.save_employee_leave(uuid, uuid, date, date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. OH-06: fijos que no quedaron asignados
-- ---------------------------------------------------------------------------------------------

create function public.employee_fixed_gaps(
  p_employee_id uuid,
  p_from date,
  p_to date
)
returns table (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  open_ended boolean,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  service_id uuid,
  service_name text,
  calendar_color smallint,
  reason text,
  detail jsonb,
  shift_status public.shift_status
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
begin
  perform app.require_role('owner', 'admin');

  if p_employee_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception using
      errcode = 'P0001',
      message = 'El período no es válido (hasta 400 días).',
      hint = 'INVALID_DATE_RANGE';
  end if;

  -- Motivo, en orden de prioridad (lo que de verdad impide asignar va primero):
  --   ON_LEAVE      licencia vigente que cubre el día (detail: app.leave_conflict)
  --   OVERLAP       otra asignación vigente que se superpone en el horario (detail: app.overlap_conflict)
  --   SHIFT_FULL    el turno ya tiene la dotación completa con otras personas
  --   REMOVED       alguien la quitó a mano (o una licencia) de ese turno: hay una baja lógica
  --   ADDED_AFTER   el fijo se agregó al servicio después de crearse el turno
  --   NOT_ASSIGNED  ninguna de las anteriores (no se asignó, por ejemplo por disponibilidad)
  return query
  select sh.id,
         sh.shift_date,
         sh.start_time,
         sh.end_time,
         sh.open_ended,
         sh.client_id,
         coalesce(nullif(btrim(cl.trade_name), ''), cl.legal_name),
         sh.site_id,
         si.name,
         sv.id,
         sv.name,
         cl.calendar_color,
         case
           when x.leave is not null then 'ON_LEAVE'
           when x.overlap is not null then 'OVERLAP'
           when x.assigned_count >= sh.required_staff then 'SHIFT_FULL'
           when x.removed is not null then 'REMOVED'
           when f.created_at > sh.created_at then 'ADDED_AFTER'
           else 'NOT_ASSIGNED'
         end,
         case
           when x.leave is not null then x.leave
           when x.overlap is not null then x.overlap
           when x.assigned_count >= sh.required_staff then jsonb_build_object(
             'code', 'SHIFT_FULL', 'assigned_count', x.assigned_count, 'required_staff', sh.required_staff
           )
           when x.removed is not null then x.removed
           when f.created_at > sh.created_at then jsonb_build_object(
             'code', 'ADDED_AFTER', 'fixed_since', f.created_at, 'shift_created_at', sh.created_at
           )
           else jsonb_build_object('code', 'NOT_ASSIGNED')
         end,
         sh.status
  from public.service_fixed_employees f
  join public.services sv on sv.id = f.service_id and sv.deleted_at is null and sv.status = 'active'
  join public.shifts sh on sh.service_id = sv.id and sh.deleted_at is null and sh.status <> 'cancelled'
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  cross join lateral (
    select app.leave_conflict(f.employee_id, sh.shift_date) as leave,
           app.overlap_conflict(
             f.employee_id,
             app.local_ts(sh.shift_date, sh.start_time),
             app.local_ts(sh.shift_date, sh.end_time),
             sh.id
           ) as overlap,
           (select count(*) from public.assignments a where a.shift_id = sh.id and a.removed_at is null) as assigned_count,
           (select jsonb_build_object(
                     'code', 'REMOVED',
                     'removed_at', r.removed_at,
                     'removed_by', r.removed_by,
                     'removed_reason', r.removed_reason
                   )
            from public.assignments r
            where r.shift_id = sh.id and r.employee_id = f.employee_id and r.removed_at is not null
            order by r.removed_at desc
            limit 1) as removed
  ) x
  where f.employee_id = p_employee_id
    and sh.shift_date between p_from and p_to
    and not exists (
      select 1 from public.assignments a
      where a.shift_id = sh.id and a.employee_id = f.employee_id and a.removed_at is null
    )
  order by sh.shift_date, sh.start_time, sh.id;
end;
$$;

comment on function public.employee_fixed_gaps(uuid, date, date) is
  'Turnos donde la persona es fija del servicio y no está asignada (0087, OH-06). Solo O, A (FORBIDDEN si no). Turnos no borrados ni cancelados, de servicios activos, con fecha entre p_from y p_to (hasta 400 días, INVALID_DATE_RANGE si no), donde la persona está en service_fixed_employees y no tiene asignación vigente. Columnas: shift_id, shift_date, start_time, end_time, open_ended, client_id, client_name, site_id, site_name, service_id, service_name, calendar_color (del cliente), reason, detail (jsonb), shift_status. reason por prioridad: ON_LEAVE (licencia que cubre el día; detail = app.leave_conflict), OVERLAP (se superpone con otra asignación vigente; detail = app.overlap_conflict con el turno que choca), SHIFT_FULL (dotación completa con otras personas), REMOVED (tiene una baja lógica en ese turno: detail con removed_at, removed_by, removed_reason), ADDED_AFTER (el fijo se agregó después de crearse el turno), NOT_ASSIGNED (ninguna de las anteriores). Todos los detail traen code.';

revoke execute on function public.employee_fixed_gaps(uuid, date, date) from public, anon;
grant execute on function public.employee_fixed_gaps(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. OH-07: patrón fijo y pizarra semanal
-- ---------------------------------------------------------------------------------------------

create function public.employee_fixed_pattern(p_employee_id uuid)
returns table (
  service_id uuid,
  service_name text,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  calendar_color smallint,
  weekdays smallint[],
  weeks_of_month smallint[],
  start_time time,
  end_time time,
  open_ended boolean,
  valid_from date,
  valid_to date
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
begin
  perform app.require_role('owner', 'admin');

  return query
  select sv.id,
         sv.name,
         sv.client_id,
         coalesce(nullif(btrim(cl.trade_name), ''), cl.legal_name),
         sv.site_id,
         si.name,
         cl.calendar_color,
         sv.weekdays,
         sv.weeks_of_month,
         sv.start_time,
         sv.end_time,
         sv.open_ended,
         sv.valid_from,
         sv.valid_to
  from public.service_fixed_employees f
  join public.services sv on sv.id = f.service_id and sv.deleted_at is null and sv.status = 'active'
  join public.clients cl on cl.id = sv.client_id
  join public.sites si on si.id = sv.site_id
  where f.employee_id = p_employee_id
    and (sv.valid_to is null or sv.valid_to >= app.today())
  order by sv.start_time, cl.legal_name, sv.name, sv.id;
end;
$$;

comment on function public.employee_fixed_pattern(uuid) is
  'Patrón fijo de una persona (0087, OH-07): los servicios activos, no borrados y vigentes hoy o a futuro (valid_to nulo o >= hoy) donde está en service_fixed_employees. Solo O, A (FORBIDDEN si no). Columnas: service_id, service_name, client_id, client_name, site_id, site_name, calendar_color (del cliente), weekdays (0 = domingo a 6 = sábado, igual que services.weekdays), weeks_of_month (null = todas), start_time, end_time, open_ended, valid_from, valid_to. Orden: horario de inicio, cliente, servicio.';

revoke execute on function public.employee_fixed_pattern(uuid) from public, anon;
grant execute on function public.employee_fixed_pattern(uuid) to authenticated;

-- La pizarra es un borrador libre de la dirección: no toca turnos ni asignaciones. Una fila por
-- persona. employee_id con on delete cascade: el borrado del empleado del dueño (0078) se lleva la
-- pizarra sin tener que tocar esa función. updated_by referencia a profiles como el resto de la
-- autoría (lo cubre app.profile_foreign_refs).
create table public.employee_week_boards (
  employee_id uuid primary key references public.employees (profile_id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  constraint employee_week_boards_blocks_check check (jsonb_typeof(blocks) = 'array')
);

comment on table public.employee_week_boards is
  'Cronograma semanal (pizarra) de la ficha de una persona (0087, OH-07). Una fila por empleado; blocks = arreglo de hasta 60 bloques {id, weekday (0 = domingo a 6 = sábado, como services.weekdays), start (HH:MM), end (HH:MM o null), label (hasta 80), color_index (0 a 11 o null), service_id (o null)}. Lo escribe solo save_employee_week_board; lo leen O, A. No modifica turnos ni asignaciones.';
comment on column public.employee_week_boards.blocks is
  'Arreglo jsonb de bloques validado por save_employee_week_board: {id, weekday, start, end, label, color_index, service_id}.';
comment on column public.employee_week_boards.updated_by is 'Quién guardó por última vez (dueño o administrador).';
comment on column public.employee_week_boards.updated_at is 'Cuándo se guardó por última vez (now() dentro de la RPC).';

alter table public.employee_week_boards enable row level security;

create policy employee_week_boards_select_admin
  on public.employee_week_boards
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.employee_week_boards from public, anon, authenticated;
grant select on public.employee_week_boards to authenticated;

-- Forma del resultado de la lectura y de la escritura: la fila más el nombre de quien la guardó.
create function app.week_board_json(p_employee_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'employee_id', b.employee_id,
    'blocks', b.blocks,
    'updated_by', b.updated_by,
    'updated_by_name', (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = b.updated_by),
    'updated_at', b.updated_at
  )
  from public.employee_week_boards b
  where b.employee_id = p_employee_id;
$$;

comment on function app.week_board_json(uuid) is
  'Uso interno (0087, OH-07): la pizarra de una persona como jsonb {employee_id, blocks, updated_by, updated_by_name, updated_at}, o null si no tiene.';

revoke execute on function app.week_board_json(uuid) from public, anon, authenticated;

create function public.get_employee_week_board(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner', 'admin');
  return app.week_board_json(p_employee_id);
end;
$$;

comment on function public.get_employee_week_board(uuid) is
  'Lee la pizarra semanal de una persona (0087, OH-07). Solo O, A (FORBIDDEN si no). Devuelve {employee_id, blocks, updated_by, updated_by_name, updated_at} o null si todavía no se guardó ninguna (la pantalla la arma con employee_fixed_pattern). También se puede leer con select sobre employee_week_boards, pero esta RPC trae el nombre de quien la editó.';

revoke execute on function public.get_employee_week_board(uuid) from public, anon;
grant execute on function public.get_employee_week_board(uuid) to authenticated;

create function public.save_employee_week_board(p_employee_id uuid, p_blocks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_block jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_ids text[] := array[]::text[];
  v_pos integer := 0;
  v_id text;
  v_label text;
  v_end text;
  v_service text;
  v_color text;
begin
  perform app.require_role('owner', 'admin');

  if not exists (
    select 1 from public.employees e where e.profile_id = p_employee_id and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'El cronograma no tiene un formato válido: tiene que ser una lista de bloques.',
      hint = 'INVALID_BOARD';
  end if;

  if jsonb_array_length(p_blocks) > 60 then
    raise exception using
      errcode = 'P0001',
      message = 'El cronograma admite hasta 60 bloques.',
      hint = 'INVALID_BOARD';
  end if;

  for v_block in select e from jsonb_array_elements(p_blocks) e
  loop
    v_pos := v_pos + 1;

    if jsonb_typeof(v_block) <> 'object' then
      raise exception using
        errcode = 'P0001',
        message = 'El bloque ' || v_pos || ' no tiene un formato válido.',
        hint = 'INVALID_BOARD';
    end if;

    -- id: texto no vacío, hasta 64 caracteres, sin repetirse.
    if jsonb_typeof(v_block -> 'id') is distinct from 'string'
       or btrim(v_block ->> 'id') = '' or length(v_block ->> 'id') > 64 then
      raise exception using
        errcode = 'P0001',
        message = 'El bloque ' || v_pos || ' necesita un identificador (texto de hasta 64 caracteres).',
        hint = 'INVALID_BOARD';
    end if;
    v_id := v_block ->> 'id';
    if v_id = any (v_ids) then
      raise exception using
        errcode = 'P0001',
        message = 'El bloque ' || v_pos || ' repite el identificador de otro bloque.',
        hint = 'INVALID_BOARD';
    end if;
    v_ids := array_append(v_ids, v_id);

    -- weekday: entero de 0 (domingo) a 6 (sábado), como services.weekdays.
    if jsonb_typeof(v_block -> 'weekday') is distinct from 'number'
       or (v_block ->> 'weekday') !~ '^[0-6]$' then
      raise exception using
        errcode = 'P0001',
        message = 'El día del bloque ' || v_pos || ' tiene que ser un número de 0 (domingo) a 6 (sábado).',
        hint = 'INVALID_BOARD';
    end if;

    -- start: HH:MM; end: HH:MM o null.
    if jsonb_typeof(v_block -> 'start') is distinct from 'string'
       or (v_block ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de inicio del bloque ' || v_pos || ' tiene que tener el formato HH:MM.',
        hint = 'INVALID_BOARD';
    end if;

    v_end := case when jsonb_typeof(v_block -> 'end') = 'string' then v_block ->> 'end' else null end;
    if (v_block ? 'end') and jsonb_typeof(v_block -> 'end') not in ('string', 'null') then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de fin del bloque ' || v_pos || ' tiene que tener el formato HH:MM (o quedar vacía).',
        hint = 'INVALID_BOARD';
    end if;
    if v_end is not null and v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de fin del bloque ' || v_pos || ' tiene que tener el formato HH:MM (o quedar vacía).',
        hint = 'INVALID_BOARD';
    end if;

    -- label: texto de hasta 80 caracteres (ausente o null = vacío).
    if (v_block ? 'label') and jsonb_typeof(v_block -> 'label') not in ('string', 'null') then
      raise exception using
        errcode = 'P0001',
        message = 'El texto del bloque ' || v_pos || ' tiene que ser un texto.',
        hint = 'INVALID_BOARD';
    end if;
    v_label := coalesce(v_block ->> 'label', '');
    if length(v_label) > 80 then
      raise exception using
        errcode = 'P0001',
        message = 'El texto del bloque ' || v_pos || ' admite hasta 80 caracteres.',
        hint = 'INVALID_BOARD';
    end if;

    -- color_index: 0 a 11 o null.
    v_color := case when jsonb_typeof(v_block -> 'color_index') = 'number' then v_block ->> 'color_index' else null end;
    if (v_block ? 'color_index') and jsonb_typeof(v_block -> 'color_index') not in ('number', 'null') then
      raise exception using
        errcode = 'P0001',
        message = 'El color del bloque ' || v_pos || ' tiene que ser un número de 0 a 11.',
        hint = 'INVALID_BOARD';
    end if;
    if v_color is not null and v_color !~ '^([0-9]|1[01])$' then
      raise exception using
        errcode = 'P0001',
        message = 'El color del bloque ' || v_pos || ' tiene que ser un número de 0 a 11.',
        hint = 'INVALID_BOARD';
    end if;

    -- service_id: uuid o null.
    if (v_block ? 'service_id') and jsonb_typeof(v_block -> 'service_id') not in ('string', 'null') then
      raise exception using
        errcode = 'P0001',
        message = 'El servicio del bloque ' || v_pos || ' no es válido.',
        hint = 'INVALID_BOARD';
    end if;
    v_service := case when jsonb_typeof(v_block -> 'service_id') = 'string' then v_block ->> 'service_id' else null end;
    if v_service is not null and v_service !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using
        errcode = 'P0001',
        message = 'El servicio del bloque ' || v_pos || ' no es válido.',
        hint = 'INVALID_BOARD';
    end if;

    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'id', v_id,
      'weekday', (v_block ->> 'weekday')::int,
      'start', v_block ->> 'start',
      'end', v_end,
      'label', v_label,
      'color_index', v_color::int,
      'service_id', v_service
    ));
  end loop;

  insert into public.employee_week_boards as b (employee_id, blocks, updated_by, updated_at)
  values (p_employee_id, v_clean, auth.uid(), now())
  on conflict (employee_id) do update
  set blocks = excluded.blocks, updated_by = excluded.updated_by, updated_at = excluded.updated_at;

  return app.week_board_json(p_employee_id);
end;
$$;

comment on function public.save_employee_week_board(uuid, jsonb) is
  'Guarda la pizarra semanal de una persona (0087, OH-07): reemplaza todos los bloques. Solo O, A (FORBIDDEN si no). EMPLOYEE_NOT_FOUND. INVALID_BOARD (con el motivo en el message) si p_blocks no es un arreglo, tiene más de 60 bloques o algún bloque no cumple: {id (texto único, hasta 64), weekday (entero 0 = domingo a 6 = sábado, el mismo criterio que services.weekdays y employee_availability.weekday), start ("HH:MM"), end ("HH:MM" o null), label (texto de hasta 80; ausente = vacío), color_index (0 a 11 o null), service_id (uuid o null)}. Se guardan solo esas claves, normalizadas, con quién y cuándo (now()). No toca turnos ni asignaciones. Devuelve {employee_id, blocks, updated_by, updated_by_name, updated_at}.';

revoke execute on function public.save_employee_week_board(uuid, jsonb) from public, anon;
grant execute on function public.save_employee_week_board(uuid, jsonb) to authenticated;

-- 5.0 app.assign_employee_core (versión de 0082): sexto parámetro p_allow_leave. Cambia la firma:
--     se reemplaza la función (los llamadores con cinco parámetros siguen funcionando por el
--     valor por defecto).
drop function app.assign_employee_core(uuid, uuid, time, time, boolean);

create function app.assign_employee_core(
  p_shift_id uuid,
  p_employee_id uuid,
  p_start time default null,
  p_end time default null,
  p_strict boolean default false,
  p_allow_leave boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_employee public.employees;
  v_assignment public.assignments;
  v_assigned_count int;
  v_warnings text[] := array[]::text[];
  v_has_permissions boolean;
  v_has_availability boolean;
  v_conflict jsonb;
begin
  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null for update;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

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

  -- OF-18 (pendiente de C-04): acá iría la excepción del dueño para asignar en un turno empezado.
  if now() >= v_shift.starts_at and not app.has_capability('manage_attendance') then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya empezó.',
      hint = 'SHIFT_STARTED';
  end if;

  select * into v_employee from public.employees where profile_id = p_employee_id and deleted_at is null;

  if v_employee.profile_id is null or v_employee.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'Ese empleado no está activo.',
      hint = 'EMPLOYEE_NOT_ACTIVE';
  end if;

  if p_start is not null and p_end is not null and p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if (p_start is not null and (p_start < v_shift.start_time or p_start >= v_shift.end_time))
    or (p_end is not null and (p_end > v_shift.end_time or p_end <= v_shift.start_time))
  then
    raise exception using
      errcode = 'P0001',
      message = 'La franja de la asignación tiene que estar dentro de la del turno.',
      hint = 'ASSIGNMENT_TIME_OUT_OF_SHIFT';
  end if;

  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = p_employee_id and a.removed_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese empleado ya está asignado a este turno.',
      hint = 'ALREADY_ASSIGNED';
  end if;

  select count(*) into v_assigned_count
  from public.assignments a
  where a.shift_id = p_shift_id and a.removed_at is null;

  if v_assigned_count >= v_shift.required_staff then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya tiene la dotación completa.',
      hint = 'SHIFT_FULL';
  end if;

  -- Advertencias (P-033, P-034, P-035). Se calculan antes de insertar (solo dependen de los
  -- datos de entrada) para que el modo estricto pueda rechazar sin dejar la asignación creada.
  select exists (
    select 1 from public.employee_client_permissions ecp where ecp.employee_id = p_employee_id
  ) into v_has_permissions;

  if v_has_permissions and not exists (
    select 1 from public.employee_client_permissions ecp
    where ecp.employee_id = p_employee_id and ecp.client_id = v_shift.client_id
  ) then
    v_warnings := array_append(v_warnings, 'NOT_ENABLED_FOR_CLIENT');
  end if;

  select exists (
    select 1 from public.employee_availability ea where ea.employee_id = p_employee_id
  ) into v_has_availability;

  if v_has_availability and not exists (
    select 1 from public.employee_availability ea
    where ea.employee_id = p_employee_id
      and ea.weekday = extract(dow from v_shift.shift_date)::smallint
      and ea.start_time <= coalesce(p_start, v_shift.start_time)
      and ea.end_time >= coalesce(p_end, v_shift.end_time)
  ) then
    v_warnings := array_append(v_warnings, 'OUTSIDE_AVAILABILITY');
  end if;

  -- Licencia (P-033): bloquea siempre (0059). Desde 0082 (OF-08) el mensaje dice el motivo y el
  -- rango («Boutter tiene licencia (Vacaciones) del 3 al 10/11.») y el detalle trae las licencias.
  -- 0087 (OH-09): con p_allow_leave (solo register_past_shift, días pasados) la licencia no
  -- bloquea: queda como advertencia ON_LEAVE.
  v_conflict := app.leave_conflict(p_employee_id, v_shift.shift_date);
  if v_conflict is not null then
    if p_allow_leave then
      v_warnings := array_append(v_warnings, 'ON_LEAVE');
    else
      raise exception using
        errcode = 'P0001',
        message = v_conflict ->> 'message',
        hint = 'ON_LEAVE',
        detail = app.conflicts_detail(jsonb_build_array(v_conflict))::text;
    end if;
  end if;

  -- Modo estricto (asignación automática de los fijos): la falta de disponibilidad bloquea,
  -- porque nadie está mirando la advertencia.
  if p_strict and 'OUTSIDE_AVAILABILITY' = any(v_warnings) then
    raise exception using
      errcode = 'P0001',
      message = 'El empleado no está disponible ese día en ese horario.',
      hint = 'OUTSIDE_AVAILABILITY';
  end if;

  begin
    insert into public.assignments (shift_id, employee_id, start_time, end_time, created_by)
    values (p_shift_id, p_employee_id, p_start, p_end, auth.uid())
    returning * into v_assignment;
  exception
    when exclusion_violation then
      v_conflict := app.overlap_conflict(
        p_employee_id,
        app.local_ts(v_shift.shift_date, coalesce(p_start, v_shift.start_time)),
        app.local_ts(v_shift.shift_date, coalesce(p_end, v_shift.end_time)),
        p_shift_id
      );
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_conflict ->> 'message', 'El empleado ya tiene otro turno en ese horario.'),
        hint = 'ASSIGNMENT_OVERLAP',
        detail = app.conflicts_detail(
          case when v_conflict is null then '[]'::jsonb else jsonb_build_array(v_conflict) end
        )::text;
  end;

  -- Transición scheduled -> assigned (04 sección 6.1): si esta asignación completa la dotación.
  update public.shifts
  set status = 'assigned'
  where id = p_shift_id
    and status = 'scheduled'
    and (v_assigned_count + 1) >= required_staff;

  select * into v_assignment from public.assignments where id = v_assignment.id;

  return jsonb_build_object('assignment', to_jsonb(v_assignment), 'warnings', v_warnings);
end;
$$;

comment on function app.assign_employee_core(uuid, uuid, time, time, boolean, boolean) is
  'Cuerpo de public.assign_employee (0024) sin el control de rol: lo llaman assign_employee, create_shift, generate_shifts, apply_service_fixed_employees, move_assignment, apply_service_changes y register_past_shift, que ya validaron quién es el que llama. ON_LEAVE (licencia vigente en la fecha del turno) y ASSIGNMENT_OVERLAP son siempre un error. El mensaje del error dice con qué choca («Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.») o qué licencia tiene («Boutter tiene licencia (Vacaciones) del 3 al 10/11.»), y el campo detail del error es un texto JSON con las claves del primer choque y conflicts (arreglo con todos). p_strict = true (asignación automática) convierte además OUTSIDE_AVAILABILITY en error; NOT_ENABLED_FOR_CLIENT y OUTSIDE_AVAILABILITY (fuera del modo estricto) siguen siendo advertencias. Desde 0087 (OH-09) p_allow_leave = true (solo lo usa register_past_shift, para días pasados) no bloquea por licencia: la deja como advertencia ON_LEAVE en el arreglo warnings. Sexto parámetro nuevo: la firma anterior (5 parámetros) ya no existe.';

revoke execute on function app.assign_employee_core(uuid, uuid, time, time, boolean, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. OH-09: registrar un turno que ya pasó como realizado
-- ---------------------------------------------------------------------------------------------

create function public.register_past_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint default null,
  p_service_id uuid default null,
  p_notes text default null,
  p_show_in_print boolean default true,
  p_employee_ids uuid[] default null,
  p_requires_photos boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_ids uuid[];
  v_required smallint;
  v_created jsonb;
  v_shift_id uuid;
  v_emp uuid;
  v_res jsonb;
  v_assigned jsonb := '[]'::jsonb;
  v_att jsonb := '[]'::jsonb;
  v_warnings text[] := array[]::text[];
  v_warnings_detail jsonb := '[]'::jsonb;
  v_emp_warnings text[];
  v_leave jsonb;
  v_item jsonb;
  v_in public.attendance_records;
  v_out public.attendance_records;
  v_constraint text;
  v_code text;
  v_msg text;
  v_detail text;
  v_shift public.shifts;
begin
  perform app.require_role('owner', 'admin');
  perform app.require_capability('manage_attendance');

  if p_date is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  v_start_at := app.local_ts(p_date, p_start);
  v_end_at := app.local_ts(p_date, p_end);

  -- Solo un turno que ya terminó (hora de Argentina). Si no, se crea y se ficha como siempre.
  if v_end_at > now() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno todavía no terminó: crealo como un turno común.',
      hint = 'SHIFT_NOT_PAST';
  end if;

  select coalesce(array_agg(d.x order by d.ord), array[]::uuid[])
  into v_ids
  from (
    select t.x, min(t.ord) as ord
    from unnest(coalesce(p_employee_ids, array[]::uuid[])) with ordinality as t(x, ord)
    where t.x is not null
    group by t.x
  ) d;

  if cardinality(v_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí al menos una persona: sin asistencia no hay nada que registrar.',
      hint = 'EMPLOYEES_REQUIRED';
  end if;

  v_required := coalesce(p_required_staff, cardinality(v_ids)::smallint);

  -- El turno (sin asignados: se asignan abajo, uno por uno y con error si alguien falla).
  begin
    v_created := app.create_shift_core(
      p_client_id, p_site_id, p_date, p_start, p_end, v_required, p_service_id,
      p_notes, false, p_show_in_print, null, null, p_requires_photos
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if p_service_id is not null and v_constraint = 'shifts_service_id_shift_date_key' then
        perform app.raise_shift_date_taken(p_service_id, p_date);
      end if;
      raise;
  end;

  v_shift_id := (v_created -> 'shift' ->> 'id')::uuid;
  select coalesce(array_agg(w), array[]::text[]) into v_warnings
  from jsonb_array_elements_text(coalesce(v_created -> 'warnings', '[]'::jsonb)) w;

  -- Asignación de cada persona. Si alguna falla, falla todo (la transacción se revierte) y el
  -- mensaje dice quién y por qué. La licencia en un día pasado no bloquea: se avisa.
  foreach v_emp in array v_ids
  loop
    begin
      v_res := app.assign_employee_core(v_shift_id, v_emp, null, null, false, true);
    exception
      when sqlstate 'P0001' then
        get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
        raise exception using
          errcode = 'P0001',
          message = case
            when v_code in ('ON_LEAVE', 'ASSIGNMENT_OVERLAP') then v_msg
            else app.person_label(v_emp) || ': ' || v_msg
          end,
          hint = v_code,
          detail = v_detail;
    end;

    select coalesce(array_agg(w), array[]::text[]) into v_emp_warnings
    from jsonb_array_elements_text(coalesce(v_res -> 'warnings', '[]'::jsonb)) w;

    v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
      'employee_id', v_emp,
      'assignment_id', v_res -> 'assignment' ->> 'id',
      'warnings', to_jsonb(v_emp_warnings)
    ));

    if 'ON_LEAVE' = any (v_emp_warnings) then
      v_leave := app.leave_conflict(v_emp, p_date);
      v_warnings_detail := v_warnings_detail || jsonb_build_array(
        coalesce(v_leave, jsonb_build_object('code', 'ON_LEAVE', 'employee_id', v_emp))
      );
      if not ('ON_LEAVE' = any (v_warnings)) then
        v_warnings := array_append(v_warnings, 'ON_LEAVE');
      end if;
    end if;
  end loop;

  -- Asistencia: primero el inicio de todos y después el fin, con el horario del turno, origen
  -- administración y motivo «Carga posterior». admin_record_attendance pone recorded_by =
  -- auth.uid(), deja la asignación en present / finished y pasa el turno a in_progress y, cuando
  -- el último termina, a completed.
  for v_item in select e from jsonb_array_elements(v_assigned) e
  loop
    v_in := public.admin_record_attendance((v_item ->> 'assignment_id')::uuid, 'check_in', v_start_at, 'Carga posterior');
  end loop;

  for v_item in select e from jsonb_array_elements(v_assigned) e
  loop
    v_out := public.admin_record_attendance((v_item ->> 'assignment_id')::uuid, 'check_out', v_end_at, 'Carga posterior');
    v_att := v_att || jsonb_build_array(jsonb_build_object(
      'assignment_id', v_item ->> 'assignment_id',
      'employee_id', v_item ->> 'employee_id',
      'check_in_at', v_start_at,
      'check_out_at', v_out.recorded_at
    ));
  end loop;

  select * into v_shift from public.shifts where id = v_shift_id;

  return jsonb_build_object(
    'shift',
    to_jsonb(v_shift) || jsonb_build_object(
      'notes', (select o.observation from public.shift_observations o where o.shift_id = v_shift.id),
      'show_in_print', coalesce((select o.show_in_print from public.shift_observations o where o.shift_id = v_shift.id), true)
    ),
    'warnings', to_jsonb(v_warnings),
    'warnings_detail', v_warnings_detail,
    'assigned', v_assigned,
    'attendance', v_att,
    'rejected', '[]'::jsonb
  );
end;
$$;

comment on function public.register_past_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, uuid[], boolean) is
  'Registra como realizado un turno que ya pasó (0087, OH-09, «Registrar como realizado»). Solo O, A con manage_attendance (FORBIDDEN si no; el dueño siempre). Mismos datos que create_shift, sin serie ni «a terminar» (hace falta la hora de fin), con p_required_staff opcional (por omisión, la cantidad de personas) y p_employee_ids obligatorio. En una sola transacción: (1) crea el turno con app.create_shift_core; (2) asigna a cada persona con app.assign_employee_core (si alguna falla, falla todo y no queda nada guardado: el error trae su código y, salvo ON_LEAVE y ASSIGNMENT_OVERLAP que ya nombran a la persona, el message empieza con su apellido; la licencia en un día pasado NO bloquea: queda como advertencia ON_LEAVE); (3) carga la asistencia de inicio y de fin con el horario del turno por admin_record_attendance (origen admin, motivo «Carga posterior», recorded_by = quien llama, geo sin validar), de modo que las asignaciones quedan finished y el turno completed igual que si se hubiera fichado: las horas cuentan en los informes y el cierre automático (OF-11) y los avisos no lo marcan. Errores: INVALID_TIME_RANGE, SHIFT_NOT_PAST (el turno todavía no terminó, hora de Argentina), EMPLOYEES_REQUIRED, CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE, SHIFT_DATE_TAKEN (con el turno existente en detail, como create_shift), y los de la asignación (EMPLOYEE_NOT_ACTIVE, ALREADY_ASSIGNED, SHIFT_FULL, ASSIGNMENT_OVERLAP, ASSIGNMENT_TIME_OUT_OF_SHIFT). Devuelve {"shift", "warnings" (HOLIDAY, ON_LEAVE), "warnings_detail" (las licencias: code, employee_id, employee_name, leaves, message), "assigned": [{employee_id, assignment_id, warnings}], "attendance": [{assignment_id, employee_id, check_in_at, check_out_at}], "rejected": []}.';

revoke execute on function public.register_past_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, uuid[], boolean) from public, anon;
grant execute on function public.register_past_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. OH-11: editar el servicio, gana el último cambio
-- ---------------------------------------------------------------------------------------------

-- Misma firma que la de 0084: create or replace, apply_service_changes y preview_service_changes
-- no se tocan (devuelven lo que devuelve el cuerpo común).
create or replace function app.service_changes_run(
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
  v_overridden jsonb := '[]'::jsonb;
  v_overridden_count integer := 0;
  v_over text[];
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
    v_over := array[]::text[];

    if v_reason is null then
      select count(*) into v_assigned_count
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      -- 0087 (OH-11): gana el último cambio. Los valores cambiados a mano en el turno ya no se
      -- conservan: se actualizan igual y se anotan en v_over (fields de `overridden`) si p_previous
      -- dice que el turno ya no tenía el valor que tenía el servicio antes de guardarlo.
      if (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
         is distinct from (v_service.start_time, v_service.end_time, v_service.open_ended)
      then
        v_time_diff := true;
        if v_has_time and (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
           is distinct from (v_prev_start, v_prev_end, v_prev_open)
        then
          v_over := array_append(v_over, 'time');
        end if;
      end if;

      if v_shift.required_staff <> v_service.required_staff then
        if v_service.required_staff < v_assigned_count then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'STAFF_BELOW_ASSIGNED',
            'message', 'La dotación nueva es menor que las personas ya asignadas: se conserva la del turno.'
          ));
        else
          v_staff_diff := true;
          if v_has_staff and v_shift.required_staff <> v_prev_staff then
            v_over := array_append(v_over, 'required_staff');
          end if;
        end if;
      end if;

      if v_shift.requires_photos <> v_service.requires_photos then
        v_photos_diff := true;
        if v_has_photos and v_shift.requires_photos <> v_prev_photos then
          v_over := array_append(v_over, 'requires_photos');
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
        -- 0087 (OH-11): los horarios por persona de un turno que cambia de horario se borran: todos
        -- toman el horario nuevo del turno. Después se revalida licencia y superposición.
        update public.assignments
        set start_time = null, end_time = null, updated_by = auth.uid()
        where shift_id = v_shift.id
          and removed_at is null
          and (start_time is not null or end_time is not null);

        for v_asg in
          select a.id, a.employee_id
          from public.assignments a
          where a.shift_id = v_shift.id and a.removed_at is null
          order by a.created_at, a.id
        loop
          v_conf := app.leave_conflict(v_asg.employee_id, v_shift.shift_date);
          if v_conf is null then
            v_conf := app.overlap_conflict(
              v_asg.employee_id,
              app.local_ts(v_shift.shift_date, v_service.start_time),
              app.local_ts(v_shift.shift_date, v_service.end_time),
              v_shift.id
            );
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
        'kept', v_notes,
        'overridden_fields', to_jsonb(v_over)
      );

      if cardinality(v_over) > 0 then
        v_overridden_count := v_overridden_count + 1;
        v_overridden := v_overridden || jsonb_build_object(
          'shift_id', v_shift.id,
          'shift_date', v_shift.shift_date,
          'fields', to_jsonb(v_over),
          'changes', v_changes
        );
      end if;
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
    'overridden_count', v_overridden_count,
    'assignments_removed', v_removed_total + v_deleted_assignments,
    'assignments_added', v_assigned_new,
    'deleted', v_deleted,
    'updated', v_updated,
    'overridden', v_overridden,
    'created', v_created,
    'skipped', v_skipped,
    'unassigned', v_unassigned,
    'months', v_months_out,
    'event_id', v_event.id
  );
end;
$$;

comment on function app.service_changes_run(uuid, date, jsonb, boolean) is
  'Uso interno (0082, OF-05; 0084, OF-05b; 0087, OH-11): cuerpo común de preview_service_changes y apply_service_changes. Hace los cambios de verdad; la vista previa los deshace con una subtransacción. p_create_missing = false no genera los turnos faltantes. Desde 0087 gana el último cambio: horario, dotación y fotos se actualizan en todos los turnos que siguen aunque se hubieran cambiado a mano (ya no hay notas MANUAL_TIME, MANUAL_STAFF ni MANUAL_PHOTOS); los que tenían un valor distinto al anterior del servicio (según p_previous) se cuentan en overridden_count y se listan en overridden. En los turnos que cambian de horario se borran los horarios por persona (assignments.start_time y end_time).';

revoke execute on function app.service_changes_run(uuid, date, jsonb, boolean) from public, anon, authenticated;

comment on function public.apply_service_changes(uuid, date, jsonb, boolean) is
  'Aplica a los turnos del servicio con fecha >= p_from_date los cambios que el servicio ya tiene guardados (0082, OF-05; 0087, OH-11). O, A (FORBIDDEN si no). Una sola transacción. (1) Borra los turnos generados, sin historia y que no empezaron, que ya no corresponden: día de la semana, semana del mes, feriado si el servicio no trabaja feriados, o fuera de vigencia. (2) Actualiza a la hora, dotación y opción de fotos del servicio TODOS los que siguen, aunque se hubieran cambiado a mano (gana el último cambio, 0087): al cambiar el horario borra los horarios por persona, revalida a los asignados y quita a los que quedan de licencia o superpuestos con otro turno (los informa). La dotación nueva menor que las personas ya asignadas se conserva (STAFF_BELOW_ASSIGNED). (3) Genera los turnos que faltan, desde p_from_date y con los empleados fijos, en los meses (desde el de p_from_date) en los que el servicio ya tenía turnos generados, calculados antes de borrar. p_previous (jsonb, opcional) = valores del servicio ANTES de guardarlo: {"start_time", "end_time", "open_ended", "required_staff", "requires_photos"}; solo sirve para contar y listar en overridden los turnos que tenían un valor cambiado a mano y que se reemplaza; no impide actualizar. No toca turnos cancelados (SHIFT_CANCELLED), creados a mano (MANUAL_SHIFT), que ya empezaron (SHIFT_STARTED), con historia al borrar (HAS_HISTORY) ni con fichajes o avisos al actualizar (HAS_ATTENDANCE, HAS_NOTICES). FROM_DATE_REQUIRED, SERVICE_NOT_FOUND, INVALID_PREVIOUS. Si borra turnos deja un evento record_deleted (entity service_changes) con la copia JSON. Devuelve {"service_id", "from_date", "preview": false, "deleted_count", "updated_count", "created_count", "unchanged_count", "skipped_count" (turnos salteados), "partial_count" (actualizados con asignados quitados o con campos conservados), "overridden_count" (turnos actualizados que tenían cambios a mano que se reemplazaron), "assignments_removed", "assignments_added" (fijos de los turnos creados), "deleted": [{shift_id, shift_date, reason: WEEKDAY | WEEK_OF_MONTH | HOLIDAY | OUT_OF_VALIDITY, message, assignments}], "updated": [{shift_id, shift_date, changes: {time: {from, to}, required_staff: {from, to}, requires_photos: {from, to}}, removed: [{assignment_id, code, employee_id, employee_name, message, ...detalle}], kept: [{code, message}], overridden_fields: [time | required_staff | requires_photos]}], "overridden": [{shift_id, shift_date, fields: [time | required_staff | requires_photos], changes: {...igual que en updated}}], "created": [{shift_id, shift_date, service_id}], "skipped": [{scope: "shift" | "field", shift_id, shift_date, code, message, wanted: "delete" | "update"}], "unassigned": [fijos de los turnos creados que no se pudieron asignar: {shift_id, shift_date, employee_id, employee_name, code, message, detail}], "months": [{year, month, created}], "event_id"}. El cuarto parámetro p_create_missing (boolean, default true) en falso no genera ningún turno faltante (paso 3): created_count = 0, created, unassigned y months quedan vacíos.';

comment on function public.preview_service_changes(uuid, date, jsonb, boolean) is
  'Vista previa de apply_service_changes (0082, OF-05; 0087, OH-11): devuelve lo mismo que devolvería aplicarlo (mismos conteos y listas, incluidos overridden_count y overridden, preview = true) sin dejar nada escrito. O, A. Mismos parámetros, errores y contrato que apply_service_changes. Implementación: corre el cuerpo real dentro de una subtransacción que se deshace, así que la vista previa y la aplicación no pueden diferir; toma bloqueos de fila un instante.';
