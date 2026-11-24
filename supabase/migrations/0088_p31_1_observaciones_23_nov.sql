-- 0088_p31_1_observaciones_23_nov.sql
-- P31.1 (Docs/Plan_Maestro/modulos/P31_observaciones_de_la_direccion_23_nov.md, sección «Paquetes»).
--
--   1. D-14  geo_unvalidated_reason: tres motivos técnicos nuevos (permission_denied,
--            position_unavailable, timeout) y un parámetro opcional p_geo_reason en record_check_in,
--            record_check_out, take_supervision y complete_supervision (cambian de firma).
--   2. D-01  public.employee_fixed_gaps: deja de listar los turnos con la dotación completa por
--            otras personas, los pasados y los finalizados.
--   3. D-07  public.update_shift_time: permite cambiar la franja (no la fecha) de un turno
--            finalizado.
--   4. D-08  tabla employee_calendar_notes y RPC save_employee_calendar_note,
--            delete_employee_calendar_note y list_employee_calendar_notes (observaciones del
--            calendario del empleado).
--   5. D-09  app.supervisor_upcoming y public.v_supervisor_upcoming (próximos 7 días del
--            coordinador).
--   6. D-10  v_assignments_board: supervision_state y supervisor_name al final.
--   7. D-11  v_supervisor_status: posición = la del evento más reciente que la trae (jornada y
--            supervisiones); position_at al final. app.workday_last_position.
--   8. D-05  Color: solo del cliente. Sin DDL: se documenta que color_index de la pizarra queda
--            sin uso y que dueño y administradores ya actualizan clients.calendar_color.
--
-- El valor nuevo de un enum no se puede usar en la misma transacción que lo agrega: las funciones
-- que lo nombran lo hacen por texto convertido en tiempo de ejecución (p_geo_reason::enum), nunca
-- como literal de una restricción, vista o valor por defecto. Mismo criterio que 0052 con
-- security_event_type.

-- ---------------------------------------------------------------------------------------------
-- 1. D-14: motivos de ubicación (parte 1, el enum)
-- ---------------------------------------------------------------------------------------------

-- permission_denied     el usuario no dio el permiso de ubicación (GeolocationPositionError.PERMISSION_DENIED)
-- position_unavailable  el celular no entregó posición: sin señal o sensor apagado (POSITION_UNAVAILABLE)
-- timeout               pasó el tiempo de espera sin lectura (TIMEOUT)
alter type public.geo_unvalidated_reason add value if not exists 'permission_denied';
alter type public.geo_unvalidated_reason add value if not exists 'position_unavailable';
alter type public.geo_unvalidated_reason add value if not exists 'timeout';

-- ---------------------------------------------------------------------------------------------
-- 2. D-01: employee_fixed_gaps sin turnos cubiertos, pasados ni finalizados
-- ---------------------------------------------------------------------------------------------

-- Misma firma y mismas columnas que 0087. Cambia el filtro: no entran los turnos con la dotación
-- completa (assigned_count >= required_staff) aunque la persona tenga licencia o choque, ni los
-- anteriores a hoy, ni los finalizados. Por eso el motivo SHIFT_FULL ya no puede aparecer.
create or replace function public.employee_fixed_gaps(
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
  --   REMOVED       alguien la quitó a mano (o una licencia) de ese turno: hay una baja lógica
  --   ADDED_AFTER   el fijo se agregó al servicio después de crearse el turno
  --   NOT_ASSIGNED  ninguna de las anteriores (no se asignó, por ejemplo por disponibilidad)
  -- Los turnos con la dotación completa por otras personas no se listan (D-01): no hay nada que
  -- resolver en el calendario de la persona.
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
           when x.removed is not null then 'REMOVED'
           when f.created_at > sh.created_at then 'ADDED_AFTER'
           else 'NOT_ASSIGNED'
         end,
         case
           when x.leave is not null then x.leave
           when x.overlap is not null then x.overlap
           when x.removed is not null then x.removed
           when f.created_at > sh.created_at then jsonb_build_object(
             'code', 'ADDED_AFTER', 'fixed_since', f.created_at, 'shift_created_at', sh.created_at
           )
           else jsonb_build_object('code', 'NOT_ASSIGNED')
         end,
         sh.status
  from public.service_fixed_employees f
  join public.services sv on sv.id = f.service_id and sv.deleted_at is null and sv.status = 'active'
  join public.shifts sh on sh.service_id = sv.id and sh.deleted_at is null
    and sh.status not in ('cancelled', 'completed')
    and sh.shift_date >= app.today()
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
    and x.assigned_count < sh.required_staff
    and not exists (
      select 1 from public.assignments a
      where a.shift_id = sh.id and a.employee_id = f.employee_id and a.removed_at is null
    )
  order by sh.shift_date, sh.start_time, sh.id;
end;
$$;

comment on function public.employee_fixed_gaps(uuid, date, date) is
  'Turnos donde la persona es fija del servicio y no está asignada (0087, OH-06; filtro de 0088, D-01). Solo O, A (FORBIDDEN si no). Turnos no borrados, de servicios activos, con fecha entre p_from y p_to (hasta 400 días, INVALID_DATE_RANGE si no), donde la persona está en service_fixed_employees y no tiene asignación vigente. Desde 0088 NO lista: los cancelados ni los finalizados, los anteriores a hoy (Argentina) ni los que ya tienen la dotación completa con otras personas (assigned_count >= required_staff), aunque la persona tenga licencia o choque. Columnas: shift_id, shift_date, start_time, end_time, open_ended, client_id, client_name, site_id, site_name, service_id, service_name, calendar_color (del cliente), reason, detail (jsonb), shift_status. reason por prioridad: ON_LEAVE (licencia que cubre el día; detail = app.leave_conflict), OVERLAP (se superpone con otra asignación vigente; detail = app.overlap_conflict con el turno que choca), REMOVED (tiene una baja lógica en ese turno: detail con removed_at, removed_by, removed_reason), ADDED_AFTER (el fijo se agregó después de crearse el turno), NOT_ASSIGNED (ninguna de las anteriores). SHIFT_FULL (0087) ya no aparece: esos turnos no se listan. Todos los detail traen code.';

-- ---------------------------------------------------------------------------------------------
-- 3. D-07: editar la franja de un turno finalizado
-- ---------------------------------------------------------------------------------------------

-- Misma firma que 0082. Cambia una sola regla: un turno finalizado admite cambiar la franja
-- (inicio y/o fin) siempre que NO cambie la fecha y no se lo convierta en «A terminar». Con otra
-- fecha sigue SHIFT_COMPLETED. No toca el estado del turno ni el de las asignaciones: las horas
-- trabajadas salen de app.capped_worked_minutes sobre assignments."window", que el trigger
-- app.sync_assignment_window recalcula al cambiar la franja del turno.
--   - ON_LEAVE no se evalúa: solo se chequea al cambiar de fecha, y acá la fecha no cambia (el
--     turno ya se trabajó).
--   - Una asignación con franja propia (assignments.start_time / end_time) NO cambia su ventana
--     al cambiar la franja del turno: sus horas se siguen contando con su franja. Para esa
--     persona hay que usar update_assignment_time, que solo funciona antes del inicio efectivo
--     (ASSIGNMENT_STARTED), así que en un turno finalizado no se puede.
create or replace function public.update_shift_time(
  p_shift_id uuid,
  p_start time,
  p_end time,
  p_open_ended boolean default false,
  p_date date default null
)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_names text;
  v_open boolean := coalesce(p_open_ended, false);
  v_end time;
  v_new_date date;
  v_date_changed boolean;
  v_conflicts jsonb;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  v_new_date := coalesce(p_date, v_shift.shift_date);
  v_date_changed := v_new_date <> v_shift.shift_date;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  -- D-07: un turno finalizado admite cambiar la franja, pero no la fecha ni pasar a «A terminar».
  if v_shift.status = 'completed' and (v_date_changed or (v_open and not v_shift.open_ended)) then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó: solo se puede cambiar el horario, no la fecha.',
      hint = 'SHIFT_COMPLETED';
  end if;

  v_end := case when v_open then time '23:59' else p_end end;

  if v_end is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  -- OF-18 (pendiente de C-04): acá iría la excepción del dueño para cambiar el inicio de un turno
  -- en curso y la fecha de uno empezado.
  if v_shift.status = 'in_progress' and p_start is distinct from v_shift.start_time then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  if v_date_changed then
    -- Solo si el turno no empezó: estado que permite editar y ningún fichaje (ni siquiera de
    -- una asignación que después se quitó).
    if v_shift.status not in ('scheduled', 'assigned')
      or exists (
        select 1
        from public.attendance_records ar
        join public.assignments a on a.id = ar.assignment_id
        where a.shift_id = p_shift_id
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'El turno ya empezó: no se puede cambiar la fecha.',
        hint = 'SHIFT_STARTED';
    end if;

    -- Decisión de Mike del 20 oct 2026: no se mueve un turno al pasado.
    if v_new_date < app.today() then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede mover el turno a una fecha que ya pasó.',
        hint = 'SHIFT_DATE_IN_PAST';
    end if;

    if v_shift.service_id is not null and exists (
      select 1 from public.shifts o
      where o.service_id = v_shift.service_id
        and o.shift_date = v_new_date
        and o.deleted_at is null
        and o.id <> p_shift_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Ese servicio ya tiene un turno en esa fecha.',
        hint = 'SHIFT_DATE_TAKEN';
    end if;

    -- Licencia en la nueva fecha: bloquea (decisión del 19 oct 2026), igual que al asignar. Desde
    -- 0082 (OF-08) el mensaje dice motivo y rango de cada licencia.
    select coalesce(jsonb_agg(x.c order by x.c ->> 'employee_name'), '[]'::jsonb)
    into v_conflicts
    from (
      select app.leave_conflict(a.employee_id, v_new_date) as c
      from public.assignments a
      where a.shift_id = p_shift_id and a.removed_at is null
    ) x
    where x.c is not null;

    if jsonb_array_length(v_conflicts) > 0 then
      raise exception using
        errcode = 'P0001',
        message = (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_conflicts) e),
        hint = 'ON_LEAVE',
        detail = app.conflicts_detail(v_conflicts)::text;
    end if;

    -- Lo mismo para el coordinador de la supervisión vigente del turno (decisión del 20 oct 2026).
    select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
    into v_names
    from public.supervisions sv
    join public.profiles p on p.id = sv.supervisor_id
    where sv.shift_id = p_shift_id
      and sv.status in ('assigned', 'in_progress')
      and exists (
        select 1 from public.employee_leaves el
        where el.employee_id = sv.supervisor_id
          and el.deleted_at is null
          and el.starts_on <= v_new_date
          and (el.ends_on is null or el.ends_on >= v_new_date)
      );

    if v_names is not null then
      raise exception using
        errcode = 'P0001',
        message = 'El coordinador está de licencia en la nueva fecha: ' || v_names || '.',
        hint = 'ON_LEAVE';
    end if;
  end if;

  begin
    update public.shifts
    set shift_date = v_new_date, start_time = p_start, end_time = v_end, open_ended = v_open,
        updated_by = auth.uid()
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      -- La actualización ya se deshizo (subtransacción del bloque): v_shift conserva el turno
      -- anterior; la fecha que importa es la pedida (v_new_date).
      select coalesce(jsonb_agg(x.c order by x.c ->> 'employee_name'), '[]'::jsonb)
      into v_conflicts
      from (
        select app.overlap_conflict(
                 a.employee_id,
                 app.local_ts(v_new_date, coalesce(a.start_time, p_start)),
                 app.local_ts(v_new_date, coalesce(a.end_time, v_end)),
                 p_shift_id
               ) as c
        from public.assignments a
        where a.shift_id = p_shift_id and a.removed_at is null
      ) x
      where x.c is not null;

      raise exception using
        errcode = 'P0001',
        message = case
          when jsonb_array_length(v_conflicts) = 0 then 'El empleado ya tiene otro turno en ese horario.'
          else (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_conflicts) e)
        end,
        hint = 'ASSIGNMENT_OVERLAP',
        detail = app.conflicts_detail(v_conflicts)::text;
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese servicio ya tiene un turno en esa fecha.',
        hint = 'SHIFT_DATE_TAKEN';
  end;

  -- Al mover de día los avisos dejan de valer (decisión del 20 oct 2026): cada aviso de las
  -- asignaciones del turno se anula (voided_at; queda como historial, nada se borra) y las
  -- asignaciones con demora o ausencia avisada vuelven a «esperado» (assigned en la UI).
  if v_date_changed then
    update public.attendance_notices an
    set voided_at = now(), voided_by = auth.uid(), void_reason = 'SHIFT_DATE_CHANGED'
    from public.assignments a
    where a.id = an.assignment_id
      and a.shift_id = p_shift_id
      and an.voided_at is null;

    update public.assignments
    set status = 'expected', updated_by = auth.uid()
    where shift_id = p_shift_id
      and removed_at is null
      and status in ('delay_notified', 'absence_notified');
  end if;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time, boolean, date) is
  'Cambia la franja y la fecha de un turno (04 sección 6.1, 9; 06 sección 7). O, A. p_date null = misma fecha. SHIFT_CANCELLED si está cancelado; INVALID_TIME_RANGE; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio. Desde 0088 (D-07) un turno FINALIZADO admite cambiar la franja (inicio y/o fin) con la misma fecha: no cambia el estado del turno ni el de las asignaciones, y las horas trabajadas se recalculan solas (app.capped_worked_minutes sobre la ventana vigente de cada asignación, que el trigger app.sync_assignment_window actualiza); si se pide otra fecha o pasarlo a «A terminar» sigue SHIFT_COMPLETED. En un turno finalizado ON_LEAVE no se evalúa (solo se chequea al cambiar de fecha). Una asignación con franja propia (assignments.start_time / end_time) conserva su ventana: el cambio solo afecta a quienes usan la franja del turno. Cambiar la fecha solo se puede si el turno no empezó (SHIFT_STARTED), no al pasado (SHIFT_DATE_IN_PAST) y si el servicio no tiene otro turno ese día (SHIFT_DATE_TAKEN); al mover de día se anulan los avisos del turno (0061). ON_LEAVE si algún asignado está de licencia en la nueva fecha, o el coordinador. ASSIGNMENT_OVERLAP si el cambio superpone a un asignado con otro turno (también en un turno finalizado). Desde 0082 (OF-08) ON_LEAVE y ASSIGNMENT_OVERLAP dicen en el mensaje a quién y con qué (una frase por persona) y el campo detail (texto JSON) trae las claves del primer choque más conflicts (todos, con conflict_shift_id, sede, servicio, fecha y horario). Para el cronograma arrastrable (OF-10) esta RPC mueve el turno entero de día u hora; el estado anterior (fecha, inicio, fin, a terminar) lo tiene la pantalla y es lo que usa para deshacer. Las advertencias (HOLIDAY, OUTSIDE_AVAILABILITY) las da get_shift_date_warnings.';

-- ---------------------------------------------------------------------------------------------
-- 4. D-08: observaciones del calendario del empleado
-- ---------------------------------------------------------------------------------------------

-- Varias por día. Solo dueño y administradores las leen y las escriben (el empleado y el
-- coordinador no). Se escriben únicamente con las RPC; la lectura directa está permitida por RLS a
-- dueño y administradores. Baja lógica con deleted_at. employee_id con on delete cascade, como
-- employee_week_boards: el borrado del empleado del dueño (0078) se lleva sus observaciones. Las
-- columnas de autoría referencian a profiles (las cubre app.profile_foreign_refs, como el resto).
create table public.employee_calendar_notes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (profile_id) on delete cascade,
  note_date date not null,
  body text not null,
  color smallint,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint employee_calendar_notes_body_check check (char_length(body) between 1 and 500),
  constraint employee_calendar_notes_color_check check (color is null or color between 0 and 11)
);

comment on table public.employee_calendar_notes is
  'Observaciones del calendario del mes de la ficha de una persona (0088, D-08, OI-06): una celda de texto en un día, por ejemplo por qué ese día no hay turnos. Varias por día. Solo las leen y escriben dueño y administradores (RLS y RPC). Baja lógica con deleted_at. No modifican turnos ni asignaciones.';
comment on column public.employee_calendar_notes.employee_id is 'Persona de cuyo calendario es la observación.';
comment on column public.employee_calendar_notes.note_date is 'Día del calendario (fecha de Argentina).';
comment on column public.employee_calendar_notes.body is 'Texto de la observación, de 1 a 500 caracteres.';
comment on column public.employee_calendar_notes.color is 'Color de la celda, índice 0 a 11 (el mismo rango que clients.calendar_color); null = sin color.';
comment on column public.employee_calendar_notes.deleted_at is 'Baja lógica: la pone delete_employee_calendar_note; nada se borra físicamente.';

create index employee_calendar_notes_employee_date_idx
  on public.employee_calendar_notes (employee_id, note_date)
  where deleted_at is null;

create trigger trg_set_updated_at
before update on public.employee_calendar_notes
for each row execute function app.set_updated_at();

alter table public.employee_calendar_notes enable row level security;

create policy employee_calendar_notes_select_admin
  on public.employee_calendar_notes
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.employee_calendar_notes from public, anon, authenticated;
grant select on public.employee_calendar_notes to authenticated;

create function public.save_employee_calendar_note(
  p_note_id uuid,
  p_employee_id uuid,
  p_date date,
  p_body text,
  p_color smallint default null
)
returns public.employee_calendar_notes
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_note public.employee_calendar_notes;
  v_body text := nullif(btrim(p_body), '');
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

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí el día de la observación.',
      hint = 'INVALID_DATE';
  end if;

  if v_body is null or char_length(v_body) > 500 then
    raise exception using
      errcode = 'P0001',
      message = 'La observación tiene que tener entre 1 y 500 caracteres.',
      hint = 'INVALID_NOTE_BODY';
  end if;

  if p_color is not null and (p_color < 0 or p_color > 11) then
    raise exception using
      errcode = 'P0001',
      message = 'El color tiene que ser un número de 0 a 11.',
      hint = 'INVALID_COLOR';
  end if;

  if p_note_id is null then
    insert into public.employee_calendar_notes (employee_id, note_date, body, color, created_by, updated_by)
    values (p_employee_id, p_date, v_body, p_color, auth.uid(), auth.uid())
    returning * into v_note;
  else
    update public.employee_calendar_notes
    set note_date = p_date, body = v_body, color = p_color, updated_by = auth.uid()
    where id = p_note_id and employee_id = p_employee_id and deleted_at is null
    returning * into v_note;

    if v_note.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos esa observación.',
        hint = 'NOTE_NOT_FOUND';
    end if;
  end if;

  return v_note;
end;
$$;

comment on function public.save_employee_calendar_note(uuid, uuid, date, text, smallint) is
  'Alta o cambio de una observación del calendario de una persona (0088, D-08). Solo O, A (FORBIDDEN si no). p_note_id null = alta; con id = cambio de día, texto y color (NOTE_NOT_FOUND si no existe, está dada de baja o no es de esa persona). p_color null = sin color; 0 a 11 (INVALID_COLOR). EMPLOYEE_NOT_FOUND, INVALID_DATE (sin día), INVALID_NOTE_BODY (vacía o de más de 500 caracteres; se recorta el espacio de los bordes). Fija created_by / updated_by con quien llama. Devuelve la fila.';

revoke execute on function public.save_employee_calendar_note(uuid, uuid, date, text, smallint) from public, anon;
grant execute on function public.save_employee_calendar_note(uuid, uuid, date, text, smallint) to authenticated;

create function public.delete_employee_calendar_note(p_note_id uuid)
returns public.employee_calendar_notes
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_note public.employee_calendar_notes;
begin
  perform app.require_role('owner', 'admin');

  update public.employee_calendar_notes
  set deleted_at = now(), updated_by = auth.uid()
  where id = p_note_id and deleted_at is null
  returning * into v_note;

  if v_note.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa observación.',
      hint = 'NOTE_NOT_FOUND';
  end if;

  return v_note;
end;
$$;

comment on function public.delete_employee_calendar_note(uuid) is
  'Da de baja (deleted_at, baja lógica) una observación del calendario (0088, D-08). Solo O, A (FORBIDDEN si no). NOTE_NOT_FOUND si no existe o ya estaba dada de baja. Devuelve la fila.';

revoke execute on function public.delete_employee_calendar_note(uuid) from public, anon;
grant execute on function public.delete_employee_calendar_note(uuid) to authenticated;

-- Lectura por rango para el mes del calendario (y su impresión). Con nombres de quien la cargó y
-- la editó. Solo O, A.
create function public.list_employee_calendar_notes(p_employee_id uuid, p_from date, p_to date)
returns table (
  id uuid,
  employee_id uuid,
  note_date date,
  body text,
  color smallint,
  created_at timestamptz,
  created_by uuid,
  created_by_name text,
  updated_at timestamptz,
  updated_by uuid,
  updated_by_name text
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

  return query
  select n.id, n.employee_id, n.note_date, n.body, n.color,
         n.created_at, n.created_by, btrim(pc.first_name || ' ' || pc.last_name),
         n.updated_at, n.updated_by, btrim(pu.first_name || ' ' || pu.last_name)
  from public.employee_calendar_notes n
  left join public.profiles pc on pc.id = n.created_by
  left join public.profiles pu on pu.id = n.updated_by
  where n.employee_id = p_employee_id
    and n.deleted_at is null
    and n.note_date between p_from and p_to
  order by n.note_date, n.created_at, n.id;
end;
$$;

comment on function public.list_employee_calendar_notes(uuid, date, date) is
  'Observaciones del calendario de una persona entre dos fechas, sin las dadas de baja (0088, D-08). Solo O, A (FORBIDDEN si no). INVALID_DATE_RANGE (hasta 400 días). Columnas: id, employee_id, note_date, body, color, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name. Orden: día y alta.';

revoke execute on function public.list_employee_calendar_notes(uuid, date, date) from public, anon;
grant execute on function public.list_employee_calendar_notes(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. D-09: próximos turnos del coordinador (7 días)
-- ---------------------------------------------------------------------------------------------

create function app.supervisor_upcoming()
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
    and sh.shift_date between app.today() + 1 and app.today() + 7
    and sh.status <> 'cancelled'
  order by sh.shift_date, sh.start_time, cl.legal_name, si.name, sh.id;
$$;

comment on function app.supervisor_upcoming() is
  'Turnos de los 7 días siguientes (de mañana a hoy + 7, Argentina) de todos los clientes y sedes, para «Próximos días» del coordinador (0088, D-09, OI-07). Mismas columnas que app.supervisor_today (0081): shift_date trae el día; priority_kind / is_priority separan «Mis sedes» de «Otras sedes». Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Turnos no cancelados ni dados de baja. Solo consulta: el turno se toma el día (take_supervision exige NOT_TODAY). Interna: la lee v_supervisor_upcoming.';

revoke execute on function app.supervisor_upcoming() from public, anon;
grant execute on function app.supervisor_upcoming() to authenticated, service_role;

create view public.v_supervisor_upcoming
with (security_invoker = true)
as
select * from app.supervisor_upcoming();

comment on view public.v_supervisor_upcoming is
  'Pantalla «Próximos días» del coordinador (0088, D-09, OI-07): los turnos no cancelados de los 7 días siguientes (mañana a hoy + 7) de todos los clientes y sedes, ordenados por fecha y hora. Mismas columnas y significado que v_supervisor_today: shift_date (el día), priority_kind (site | client | null) / is_priority (Mis sedes / Otras sedes), assigned_employees, supervisors, my_supervision_id / my_supervision_status. Solo consulta. Solo trae filas para el rol supervisor (mismos permisos que v_supervisor_today).';

revoke all on public.v_supervisor_upcoming from public, anon, authenticated;
grant select on public.v_supervisor_upcoming to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. D-10: supervisión en v_assignments_board
-- ---------------------------------------------------------------------------------------------

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
    coalesce((ci.geo_status = 'outside' and ci.geo_override_at is null) or (co.geo_status = 'outside' and co.geo_override_at is null), false) as has_outside_geo,
    notice.has_certificate AS last_notice_has_certificate,
    cl.calendar_color AS client_calendar_color,
    coalesce(co.auto_closed, false) AS check_out_auto_closed,
        CASE
            WHEN NOT app.is_admin() THEN NULL::text
            WHEN sup.supervisor_name IS NULL THEN 'none'::text
            WHEN sup.is_open THEN 'in_progress'::text
            ELSE 'done'::text
        END AS supervision_state,
        CASE WHEN app.is_admin() THEN sup.supervisor_name ELSE NULL::text END AS supervisor_name
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
            an.estimated_arrival_at,
            an.has_certificate
           FROM attendance_notices an
          WHERE (an.assignment_id = a.id) AND (an.voided_at IS NULL)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
     LEFT JOIN LATERAL ( SELECT btrim(((sp.first_name || ' '::text) || sp.last_name)) AS supervisor_name,
            (sv.status = 'in_progress'::supervision_status AND NOT (EXISTS ( SELECT 1
                   FROM supervision_attendance sa
                  WHERE ((sa.supervision_id = sv.id) AND (sa.kind = 'check_out'::attendance_kind))))) AS is_open
           FROM (supervisions sv
             JOIN profiles sp ON ((sp.id = sv.supervisor_id)))
          WHERE (sv.shift_id = sh.id) AND (sv.status = ANY (ARRAY['in_progress'::supervision_status, 'completed'::supervision_status])) AND app.is_admin()
          ORDER BY (sv.status = 'in_progress'::supervision_status AND NOT (EXISTS ( SELECT 1
                   FROM supervision_attendance sa
                  WHERE ((sa.supervision_id = sv.id) AND (sa.kind = 'check_out'::attendance_kind))))) DESC, sv.created_at DESC
         LIMIT 1) sup ON (true);

comment on view public.v_assignments_board is
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). Ver 0052 para display_status, worked_minutes, planned_minutes y la validación por ubicación (check_in_* / check_out_*). Desde 0088 (D-10) suma supervision_state y supervisor_name al final: la supervisión del turno (coordinación libre), solo para dueño y administradores. security_invoker.';

comment on column public.v_assignments_board.supervision_state is
  'Estado de supervisión del turno de la fila (0088, D-10, OI-08), solo para dueño y administradores (null para los demás): none (ningún coordinador la tomó), in_progress (hay una supervisión abierta: in_progress sin fin registrado) o done (la supervisan o la supervisaron y ya terminó, incluida la «Sin cerrar» que ya tiene fin). Sale de supervisions (coordinación libre, P24/P27): se repite igual en todas las filas del mismo turno. El front decide cuándo mostrarla (por ejemplo, nada en turnos que no empezaron).';
comment on column public.v_assignments_board.supervisor_name is
  'Nombre y apellido del coordinador que supervisa o supervisó el turno (0088, D-10): el de la supervisión abierta y, si no hay, el de la última que terminó. Null si supervision_state = none, y siempre null para quien no es dueño ni administrador.';

-- ---------------------------------------------------------------------------------------------
-- 7. D-11: última posición conocida del coordinador
-- ---------------------------------------------------------------------------------------------

-- Posición más reciente de una jornada: entre los eventos de la jornada no dados de baja y el inicio
-- y fin de las supervisiones de esa jornada (supervision_attendance), el que tenga posición y el
-- instante más alto. Definidor (criterio de 0054: las coordenadas no se leen con select directo).
-- Sin filas si la sesión no es del dueño ni de un administrador, o si ningún evento trae posición.
create function app.workday_last_position(p_workday_id uuid)
returns table (o_latitude numeric, o_longitude numeric, o_accuracy_m numeric, o_at timestamptz)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select p.lat, p.lng, p.acc, p.at
  from (
    select e.latitude::numeric as lat, e.longitude::numeric as lng, e.accuracy_m::numeric as acc, e.recorded_at as at
    from public.supervisor_workday_events e
    where e.workday_id = p_workday_id and e.removed_at is null and e.latitude is not null
    union all
    select sa.latitude::numeric, sa.longitude::numeric, sa.accuracy_m::numeric, sa.recorded_at
    from public.supervision_attendance sa
    join public.supervisions sv on sv.id = sa.supervision_id
    where sv.workday_id = p_workday_id and sa.latitude is not null
  ) p
  where app.is_admin()
  order by p.at desc
  limit 1;
$$;

comment on function app.workday_last_position(uuid) is
  'Posición más reciente de una jornada del coordinador (0088, D-11): el evento más reciente CON posición entre los de la jornada (supervisor_workday_events, sin baja) y el inicio/fin de sus supervisiones (supervision_attendance). Devuelve latitud, longitud, precisión y el instante (o_at). Definidor: solo dueño y administradores (sin filas si no). Interna: la lee v_supervisor_status.';

revoke execute on function app.workday_last_position(uuid) from public, anon;
grant execute on function app.workday_last_position(uuid) to authenticated, service_role;

-- Mismas columnas que 0063; latitude / longitude / accuracy_m salen de la última posición conocida
-- y position_at (columna nueva, al final) es su instante. El estado (status, last_event_*) sigue
-- saliendo del último evento de la jornada.
create or replace view public.v_supervisor_status
with (security_invoker = true)
as
select
  p.id as supervisor_id,
  p.first_name,
  p.last_name,
  p.avatar_path,
  wd.id as workday_id,
  app.today() as work_date,
  case
    when wd.id is null then 'not_started'
    when st.state = 'ended' then 'finished'
    when st.state = 'paused' then 'paused'
    when os.id is not null then 'supervising'
    else 'in_activity'
  end as status,
  wd.started_at,
  wd.ended_at,
  case when wd.id is null then 0 else app.workday_minutes(wd.id) end as worked_minutes,
  coalesce(wd.auto_closed, false) as auto_closed,
  coalesce(wd.corrected, false) as corrected,
  le.id as last_event_id,
  le.kind as last_event_kind,
  le.recorded_at as last_event_at,
  lp.o_latitude::numeric(9, 6) as latitude,
  lp.o_longitude::numeric(9, 6) as longitude,
  lp.o_accuracy_m::numeric(7, 1) as accuracy_m,
  case when st.state = 'paused' then lm.reason end as pause_reason,
  os.id as supervision_id,
  os.client_id,
  os.client_legal_name,
  os.site_id,
  os.site_name,
  exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p.id
      and el.deleted_at is null
      and el.starts_on <= app.today()
      and (el.ends_on is null or el.ends_on >= app.today())
  ) as on_leave,
  lp.o_at as position_at
from public.profiles p
join public.employees em on em.profile_id = p.id
left join lateral (
  select w.* from public.supervisor_workdays w
  where w.supervisor_id = p.id and w.work_date = app.today()
) wd on true
left join lateral (select app.workday_state(wd.id) as state) st on wd.id is not null
left join lateral (
  select e.id, e.kind, e.recorded_at
  from public.supervisor_workday_events e
  where e.workday_id = wd.id and e.removed_at is null
  order by e.recorded_at desc, e.seq desc
  limit 1
) le on wd.id is not null
left join lateral (
  select e.reason
  from public.supervisor_workday_events e
  where e.workday_id = wd.id
    and e.removed_at is null
    and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  order by e.recorded_at desc, e.seq desc
  limit 1
) lm on wd.id is not null
left join lateral (
  select sv.id, sh.client_id, cl.legal_name as client_legal_name, sh.site_id, si.name as site_name
  from public.supervisions sv
  join public.shifts sh on sh.id = sv.shift_id
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  where sv.workday_id = wd.id
    and sv.id = app.open_supervision_id(wd.id)
) os on wd.id is not null
left join lateral (
  select pos.o_latitude, pos.o_longitude, pos.o_accuracy_m, pos.o_at
  from app.workday_last_position(wd.id) pos
) lp on wd.id is not null
where app.is_admin()
  and p.is_active
  and p.deleted_at is null
  and em.status = 'active'
  and em.deleted_at is null
  and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'supervisor');

comment on view public.v_supervisor_status is
  'Estado de cada coordinador activo hoy, para el mapa del Resumen y Asistencia de hoy (0063, CJ-22, CJ-33). status: in_activity (jornada iniciada, entre sedes) | supervising (con supervision_id, cliente y sede) | paused (con pause_reason, si lo cargó) | finished | not_started; sale del último evento de la jornada. latitude / longitude / accuracy_m (desde 0088, D-11): última posición conocida, la del evento más reciente QUE LA TRAE entre los de la jornada y el inicio/fin de sus supervisiones (app.workday_last_position); nula solo si ningún evento de hoy trae posición («Sin ubicación»). position_at (0088, al final): el instante de esa posición, para mostrar «Ubicación de las 10:42» cuando es anterior al último evento (last_event_at). Solo la leen dueño y administradores. worked_minutes: horas netas de hoy. auto_closed / corrected: constancias de CJ-31 y CJ-32. on_leave: licencia vigente hoy. Solo trae filas para dueño y administradores.';

-- ---------------------------------------------------------------------------------------------
-- 8. D-14: motivos de ubicación (parte 2, las RPC)
-- ---------------------------------------------------------------------------------------------

drop function public.record_check_in(uuid, numeric, numeric, numeric, text);
drop function public.record_check_out(uuid, numeric, numeric, numeric, text);
drop function public.take_supervision(uuid, numeric, numeric, numeric, text);
drop function public.complete_supervision(uuid, text, numeric, numeric, numeric, text);

create function public.record_check_in(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null,
  p_geo_reason text default null
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
  v_reason public.geo_unvalidated_reason;
  v_tech text;
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
  -- D-14: motivo técnico cuando no hay coordenadas (permission_denied, position_unavailable,
  -- timeout). Se ignora si el celular sí mandó la ubicación. Se convierte en tiempo de ejecución:
  -- el valor del enum se agregó en esta misma migración.
  v_tech := nullif(btrim(p_geo_reason), '');
  if v_tech is not null and v_tech not in ('permission_denied', 'position_unavailable', 'timeout') then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo de la falta de ubicación no es válido.',
      hint = 'INVALID_GEO_REASON';
  end if;

  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);
  v_reason := v_geo.reason;
  if p_lat is null and v_tech is not null and v_geo.status = 'unvalidated' then
    v_reason := v_tech::public.geo_unvalidated_reason;
  end if;

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_assignment_id, 'check_in', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid(),
    v_geo.status, v_reason, v_geo.distance_m, v_geo.radius_m,
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

comment on function public.record_check_in(uuid, numeric, numeric, numeric, text, text) is
  'Registra el inicio de una asignación con la hora del servidor y la validación por ubicación (B-04 a B-08, B-23; 06 sección 10). E (propia). Devuelve el registro con geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m y outside_reason. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, SHIFT_COMPLETED, NOT_TODAY, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG, ALREADY_CHECKED_IN. Desde 0088 (D-14) recibe p_geo_reason (opcional): el motivo técnico por el que no hay coordenadas (permission_denied = sin permiso, position_unavailable = sin señal o posición no disponible, timeout = tiempo agotado); se guarda como geo_unvalidated_reason en vez de no_location y se ignora si vienen coordenadas. INVALID_GEO_REASON si es otro texto. Sin él (null) queda no_location, como antes.';

create function public.record_check_out(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null,
  p_geo_reason text default null
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
  v_reason public.geo_unvalidated_reason;
  v_tech text;
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

  -- D-14: motivo técnico cuando no hay coordenadas (permission_denied, position_unavailable,
  -- timeout). Se ignora si el celular sí mandó la ubicación. Se convierte en tiempo de ejecución:
  -- el valor del enum se agregó en esta misma migración.
  v_tech := nullif(btrim(p_geo_reason), '');
  if v_tech is not null and v_tech not in ('permission_denied', 'position_unavailable', 'timeout') then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo de la falta de ubicación no es válido.',
      hint = 'INVALID_GEO_REASON';
  end if;

  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);
  v_reason := v_geo.reason;
  if p_lat is null and v_tech is not null and v_geo.status = 'unvalidated' then
    v_reason := v_tech::public.geo_unvalidated_reason;
  end if;

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    p_assignment_id, 'check_out', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid(),
    v_geo.status, v_reason, v_geo.distance_m, v_geo.radius_m,
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

comment on function public.record_check_out(uuid, numeric, numeric, numeric, text, text) is
  'Registra el fin de una asignación con la hora del servidor y la validación por ubicación (B-04 a B-08, B-23; 06 sección 10). E (propia). Devuelve el registro con la validación. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, OPEN_SHIFT_DAY_ENDED, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Desde 0088 (D-14) recibe p_geo_reason (opcional): el motivo técnico por el que no hay coordenadas (permission_denied = sin permiso, position_unavailable = sin señal o posición no disponible, timeout = tiempo agotado); se guarda como geo_unvalidated_reason en vez de no_location y se ignora si vienen coordenadas. INVALID_GEO_REASON si es otro texto. Sin él (null) queda no_location, como antes.';

create function public.take_supervision(
  p_shift_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null,
  p_geo_reason text default null
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
  v_reason public.geo_unvalidated_reason;
  v_tech text;
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
  -- D-14: motivo técnico cuando no hay coordenadas (permission_denied, position_unavailable,
  -- timeout). Se ignora si el celular sí mandó la ubicación. Se convierte en tiempo de ejecución:
  -- el valor del enum se agregó en esta misma migración.
  v_tech := nullif(btrim(p_geo_reason), '');
  if v_tech is not null and v_tech not in ('permission_denied', 'position_unavailable', 'timeout') then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo de la falta de ubicación no es válido.',
      hint = 'INVALID_GEO_REASON';
  end if;

  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);
  v_reason := v_geo.reason;
  if p_lat is null and v_tech is not null and v_geo.status = 'unvalidated' then
    v_reason := v_tech::public.geo_unvalidated_reason;
  end if;

  insert into public.supervision_attendance (
    supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    v_supervision.id, 'check_in', now(), p_lat, p_lng, p_accuracy,
    v_geo.status, v_reason, v_geo.distance_m, v_geo.radius_m,
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

comment on function public.take_supervision(uuid, numeric, numeric, numeric, text, text) is
  'El coordinador toma un turno de hoy y empieza la supervisión en un solo paso (CJ-26): crea la supervisión en in_progress, registra el inicio con la hora del servidor y la validación contra la sede (B-07) y deja el evento supervision_start. Desde 0079 (OD-08, OD-10) acepta cualquier turno de hoy no cancelado —en curso, terminado o sin empezar, haya llegado o no el empleado— y puede volver al mismo turno más tarde: cada pasada es una supervisión nueva (ya no existe ALREADY_SUPERVISED). S. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado), NOT_TODAY, WORKDAY_NOT_STARTED, WORKDAY_ENDED, WORKDAY_PAUSED (CJ-07), SUPERVISION_ALREADY_OPEN (CJ-08), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Devuelve { supervision, check_in, warnings } con SUPERVISES_OWN_SHIFT si también está asignado como empleado en ese turno. Desde 0088 (D-14) recibe p_geo_reason (opcional): el motivo técnico por el que no hay coordenadas (permission_denied = sin permiso, position_unavailable = sin señal o posición no disponible, timeout = tiempo agotado); se guarda como geo_unvalidated_reason en vez de no_location y se ignora si vienen coordenadas. INVALID_GEO_REASON si es otro texto. Sin él (null) queda no_location, como antes.';

create function public.complete_supervision(
  p_supervision_id uuid,
  p_general_notes text default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null,
  p_geo_reason text default null
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
  v_reason public.geo_unvalidated_reason;
  v_tech text;
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

    -- D-14: motivo técnico cuando no hay coordenadas (permission_denied, position_unavailable,
    -- timeout). Se ignora si el celular sí mandó la ubicación. Se convierte en tiempo de ejecución:
    -- el valor del enum se agregó en esta misma migración.
    v_tech := nullif(btrim(p_geo_reason), '');
    if v_tech is not null and v_tech not in ('permission_denied', 'position_unavailable', 'timeout') then
      raise exception using
        errcode = 'P0001',
        message = 'El motivo de la falta de ubicación no es válido.',
        hint = 'INVALID_GEO_REASON';
    end if;

    select * into v_geo from app.geo_for_site(v_site_id, p_lat, p_lng, p_accuracy);
    v_reason := v_geo.reason;
    if p_lat is null and v_tech is not null and v_geo.status = 'unvalidated' then
      v_reason := v_tech::public.geo_unvalidated_reason;
    end if;

    insert into public.supervision_attendance (
      supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
      geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
    )
    values (
      p_supervision_id, 'check_out', v_now, p_lat, p_lng, p_accuracy,
      v_geo.status, v_reason, v_geo.distance_m, v_geo.radius_m,
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

comment on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text, text) is
  'Cierra una supervisión in_progress (04 sección 6.4) y registra el fin con la hora del servidor, la validación contra la sede y el evento supervision_end. Desde 0079 (OD-09) NO exige calificar a nadie: se puede cerrar sin calificaciones (RATINGS_PENDING desaparece; la pantalla avisa quiénes faltan y deja seguir). S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, NOT_STARTED, SUPERVISION_NOT_EDITABLE (no está in_progress), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Texto vacío de general_notes se guarda como null. Desde 0088 (D-14) recibe p_geo_reason (opcional): el motivo técnico por el que no hay coordenadas (permission_denied = sin permiso, position_unavailable = sin señal o posición no disponible, timeout = tiempo agotado); se guarda como geo_unvalidated_reason en vez de no_location y se ignora si vienen coordenadas. INVALID_GEO_REASON si es otro texto. Sin él (null) queda no_location, como antes.';

revoke execute on function public.record_check_in(uuid, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.record_check_in(uuid, numeric, numeric, numeric, text, text) to authenticated;
revoke execute on function public.record_check_out(uuid, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.record_check_out(uuid, numeric, numeric, numeric, text, text) to authenticated;
revoke execute on function public.take_supervision(uuid, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.take_supervision(uuid, numeric, numeric, numeric, text, text) to authenticated, service_role;
revoke execute on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text, text) from public, anon;
grant execute on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 9. D-05: el color es solo del cliente (sin DDL)
-- ---------------------------------------------------------------------------------------------

-- save_employee_week_board (0087) ya acepta bloques sin color (color_index nulo) y no lo exige: el
-- front deja de enviarlo y, si lo envía, se guarda sin efecto. Dueño y administradores ya
-- actualizan clients.calendar_color con la política clients_write_admin (app.is_admin()): no hace
-- falta una RPC aparte.
comment on function public.save_employee_week_board(uuid, jsonb) is
  'Guarda la pizarra semanal de una persona (0087, OH-07): reemplaza todos los bloques. Solo O, A (FORBIDDEN si no). EMPLOYEE_NOT_FOUND. INVALID_BOARD (con el motivo en el message) si p_blocks no es un arreglo, tiene más de 60 bloques o algún bloque no cumple: {id (texto único, hasta 64), weekday (entero 0 = domingo a 6 = sábado, el mismo criterio que services.weekdays y employee_availability.weekday), start ("HH:MM"), end ("HH:MM" o null), label (texto de hasta 80; ausente = vacío), color_index (0 a 11 o null; desde 0088, D-05, SIN USO: el color es solo del cliente, clients.calendar_color; se sigue aceptando y guardando por compatibilidad pero la pantalla no lo envía ni lo usa), service_id (uuid o null)}. Se guardan solo esas claves, normalizadas, con quién y cuándo (now()). No toca turnos ni asignaciones. Devuelve {employee_id, blocks, updated_by, updated_by_name, updated_at}.';

comment on column public.employee_week_boards.blocks is
  'Arreglo jsonb de bloques validado por save_employee_week_board: {id, weekday, start, end, label, color_index, service_id}. color_index queda sin uso desde 0088 (D-05): el color es solo del cliente (clients.calendar_color).';

comment on column public.clients.calendar_color is
  'Índice (0..11) del color del cliente en los calendarios (0066, P24.8). Desde 0088 (D-05) es la ÚNICA fuente de color: el cronograma semanal de la ficha y el calendario del mes lo usan. Dueño y administradores lo actualizan con update sobre clients (política clients_write_admin).';
