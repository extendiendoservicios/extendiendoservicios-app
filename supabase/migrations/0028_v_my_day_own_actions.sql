-- Corrección chica de F14 (P14.2, detectada en la revisión visual): "Cambios desde tu última
-- visita" (P-092, v_my_day.changed_since_last_seen) se prendía también con las propias acciones
-- del empleado -- avisar demora/ausencia (notify_delay/notify_absence), registrar inicio o fin
-- (record_check_in/record_check_out, y admin_record_attendance/close_assignment cuando las carga
-- en su nombre) y cargar la observación (set_assignment_notes) actualizan assignments.updated_at
-- (y, vía app.start_shift_if_needed/app.complete_shift_if_done, 0027, también shifts.updated_at)
-- con updated_by = auth.uid(). Si ese auth.uid() es el propio empleado, el cálculo original
-- (greatest(...) > last_seen_changes_at) se prendía igual, aunque el cambio lo hizo la misma
-- persona que está mirando la pantalla. Comprobado en vivo contra App_dev el 26 sep 2026 (el
-- orquestador avisó una demora con María y, al volver a Hoy, apareció el aviso de cambios).
--
-- Diagnóstico de updated_by en assignments/shifts (encargo, revisado archivo por archivo):
--   - assignments.updated_by: TODAS las RPC que actualizan la tabla ponen updated_by = auth.uid()
--     (set_assignment_notes, record_check_in/record_check_out, notify_delay, notify_absence,
--     admin_record_attendance, close_assignment), salvo update_assignment_time (0024), que cambia
--     start_time/end_time sin tocar esa columna -- queda con lo que haya dejado una llamada
--     anterior sobre la misma fila. Si esa llamada anterior fue del propio empleado (por ejemplo,
--     set_assignment_notes), un cambio posterior de administración por update_assignment_time
--     quedaría atribuido, de arrastre, al empleado -- exactamente el caso que pide cuidar el
--     encargo ("que el cambio de administración no se pierda"). Se corrige acá agregando
--     updated_by = auth.uid() a esa única actualización que le faltaba.
--   - shifts.updated_by: NINGUNA RPC lo ponía antes de esta migración. app.start_shift_if_needed/
--     app.complete_shift_if_done (0027) son las que disparan record_check_in/record_check_out (y
--     sus versiones "en nombre"), así que son las que hay que corregir para el reporte puntual de
--     este defecto. Por el mismo motivo de arrastre que el punto anterior, se agrega también a las
--     dos únicas RPC de turnos que pueden seguir tocando la fila DESPUÉS de que ya está
--     in_progress -- es decir, después de que alguien ya hizo el primer check-in del turno:
--     update_shift_time (0023, la franja horaria: mientras in_progress solo admite cambiar la hora
--     de fin) y update_shift_details (0024, dotación y notas administrativas: no bloquea
--     in_progress, solo cancelled/completed). El resto de las RPC que tocan shifts
--     (assign_employee, remove_assignment, reload_shift_tasks vía app.copy_checklist_to_shift)
--     solo actualizan la fila mientras el turno sigue scheduled/assigned -- antes de cualquier
--     check-in -- así que no corren este riesgo y no se tocan.
--
-- Alcance del cambio en v_my_day: changed_since_last_seen deja de contar un cambio de
-- assignments/shifts cuando el updated_by de esa fila es el mismo empleado dueño de la asignación
-- (P-092 es "avisame lo que cambió OTRA persona", no lo que cambié yo mismo). Sigue contando
-- created_at sin condición (asignación nueva): ninguna RPC del empleado inserta una asignación,
-- siempre la crea alguien de administración (assign_employee).
--
-- Límite conocido, aceptado, no resuelto acá (no se agrega ninguna tabla ni columna nueva, tal
-- como pide el encargo si no alcanza con updated_by): updated_at/updated_by son UNA sola pareja de
-- columnas por fila, así que solo recuerdan el ÚLTIMO cambio y quién lo hizo. Si administración
-- cambia algo de un turno (por ejemplo, lo reprograma) y ANTES de que el empleado abra Hoy y vea
-- ese cambio hace una acción propia que también toca esa misma fila de shifts (el primer check-in
-- del turno, que dispara app.start_shift_if_needed), la fila queda con updated_by = ese empleado y
-- el aviso de "cambios" para él se apaga, aunque el cambio de administración nunca le llegó a
-- mostrar ese cartel puntual. La información en sí NO se pierde -- v_my_day siempre devuelve el
-- horario/las notas VIGENTES, nunca una copia vieja -- se pierde solo el cartel "cambió algo" para
-- ESE cambio puntual, para ESE empleado, en la ventana acotada entre el cambio de administración y
-- la acción propia siguiente sobre la misma fila. Alternativa para cerrar el caso por completo, si
-- Mike la prioriza en una tarea aparte: una columna nueva (por ejemplo shifts.admin_changed_at) que
-- solo actualicen las RPC administrativas de turnos, incorporada al cálculo de
-- changed_since_last_seen de forma independiente de updated_by/updated_at -- no entra en esta
-- corrección chica porque excede lo pedido (tocaría todas las RPC de turnos, no solo los dos
-- auxiliares que menciona el encargo) y requiere una migración de esquema, no solo de funciones.

-- ---------------------------------------------------------------------------------------------
-- 1. app.start_shift_if_needed/app.complete_shift_if_done (0027): fijan updated_by = auth.uid() --
-- ---------------------------------------------------------------------------------------------

create or replace function app.start_shift_if_needed(p_shift_id uuid)
returns void
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  update public.shifts
  set status = 'in_progress', updated_by = auth.uid()
  where id = p_shift_id and status in ('scheduled', 'assigned');
end;
$$;

comment on function app.start_shift_if_needed(uuid) is
  'Transición scheduled/assigned -> in_progress con el primer inicio del turno (04 sección 6.1). Auxiliar compartido por record_check_in (0026) y admin_record_attendance (0027) -- asume que el turno ya está bloqueado (for update) por quien llama. Desde 0028 (P14.2) también fija updated_by = auth.uid(): quien dispara el primer check-in del turno (el empleado, o administración si lo carga en su nombre) queda como último editor de la fila, para que v_my_day (changed_since_last_seen, P-092) distinga esta transición de un cambio ajeno.';

create or replace function app.complete_shift_if_done(p_shift_id uuid)
returns void
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_remaining_count int;
begin
  select count(*) into v_remaining_count
  from public.assignments a
  where a.shift_id = p_shift_id
    and a.removed_at is null
    and a.status not in ('finished', 'absence_notified');

  if v_remaining_count = 0 then
    update public.shifts set status = 'completed', updated_by = auth.uid() where id = p_shift_id;
  end if;
end;
$$;

comment on function app.complete_shift_if_done(uuid) is
  'Transición in_progress -> completed cuando ya no queda ninguna asignación vigente sin finished/absence_notified (04 sección 6.1). Auxiliar compartido por record_check_out (0026), admin_record_attendance y close_assignment (0027) -- asume que el turno ya está bloqueado (for update) por quien llama. Desde 0028 (P14.2) también fija updated_by = auth.uid(), mismo criterio que app.start_shift_if_needed.';

-- ---------------------------------------------------------------------------------------------
-- 2. update_shift_time (0023): agrega updated_by = auth.uid() -- puede seguir tocando la fila -----
--    (la hora de fin) con el turno ya in_progress, después de un check-in ajeno a esta RPC --------
-- ---------------------------------------------------------------------------------------------

create or replace function public.update_shift_time(p_shift_id uuid, p_start time, p_end time)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id;

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

  if p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if v_shift.status = 'in_progress' and p_start is distinct from v_shift.start_time then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  begin
    update public.shifts
    set start_time = p_start, end_time = p_end, updated_by = auth.uid()
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      raise exception using
        errcode = 'P0001',
        message = 'El empleado ya tiene otro turno en ese horario.',
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time) is
  'Cambia la franja de un turno (04 sección 6.1, 9; 06 sección 7). O, A. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula la ventana de las asignaciones vigentes; si eso las deja superpuestas, se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP (pendiente de P04.4, verificado el 21 sep 2026). Desde 0028 (P14.2) fija updated_by = auth.uid(): esta RPC puede seguir cambiando la hora de fin con el turno in_progress, después de un check-in de otra persona, y no tiene que quedar atribuida a quien hizo ese check-in.';

-- ---------------------------------------------------------------------------------------------
-- 3. update_assignment_time (0024): agrega updated_by = auth.uid() -- era la única RPC que --------
--    tocaba assignments sin fijarlo --------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

create or replace function public.update_assignment_time(p_assignment_id uuid, p_start time default null, p_end time default null)
returns public.assignments
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
begin
  perform app.require_role('owner', 'admin');

  select * into v_assignment from public.assignments where id = p_assignment_id and removed_at is null;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- "Solo antes del inicio" (06 sección 8): se toma la hora de inicio EFECTIVA de la asignación
  -- (lower(window), la propia si tenía franja propia, si no la del turno), no el estado -- una
  -- asignación puede seguir en expected pasada su hora si nadie marcó el check-in (P-068).
  if now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
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

  begin
    update public.assignments
    set start_time = p_start, end_time = p_end, updated_by = auth.uid()
    where id = p_assignment_id
    returning * into v_assignment;
  exception
    when exclusion_violation then
      raise exception using
        errcode = 'P0001',
        message = 'El empleado ya tiene otro turno en ese horario.',
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  return v_assignment;
end;
$$;

comment on function public.update_assignment_time(uuid, time, time) is
  'Cambia la franja propia de una asignación (P-046, 06 sección 8). O, A. Solo antes del inicio efectivo (lower(window)) -- ASSIGNMENT_STARTED si ya pasó. ASSIGNMENT_NOT_FOUND, INVALID_TIME_RANGE, ASSIGNMENT_TIME_OUT_OF_SHIFT (fuera de la franja del turno), ASSIGNMENT_OVERLAP si la nueva ventana pisa otra asignación del mismo empleado (exclusion_violation traducido, mismo criterio que update_shift_time, 0023). El trigger app.sync_assignment_window (0007) recalcula la ventana. Desde 0028 (P14.2) fija updated_by = auth.uid(): era la única RPC que actualizaba assignments sin completar esta columna, y podía quedar con el updated_by de una llamada anterior de otra RPC sobre la misma fila (por ejemplo, set_assignment_notes del propio empleado), atribuyéndole a él, por arrastre, un cambio de administración.';

-- ---------------------------------------------------------------------------------------------
-- 4. update_shift_details (0024): agrega updated_by = auth.uid() -- puede seguir tocando la fila --
--    (dotación y notas) con el turno ya in_progress, después de un check-in ajeno a esta RPC ------
-- ---------------------------------------------------------------------------------------------

create or replace function public.update_shift_details(p_shift_id uuid, p_required_staff smallint, p_notes text default null)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_assigned_count int;
begin
  perform app.require_role('owner', 'admin');

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

  if p_required_staff < 1 or p_required_staff > 10 then
    raise exception using
      errcode = 'P0001',
      message = 'La dotación tiene que ser entre 1 y 10 personas.',
      hint = 'REQUIRED_STAFF_RANGE';
  end if;

  select count(*) into v_assigned_count
  from public.assignments a
  where a.shift_id = p_shift_id and a.removed_at is null;

  if p_required_staff < v_assigned_count then
    raise exception using
      errcode = 'P0001',
      message = 'No podés bajar la dotación por debajo de la cantidad de personas ya asignadas.',
      hint = 'REQUIRED_STAFF_BELOW_ASSIGNED';
  end if;

  update public.shifts
  set
    required_staff = p_required_staff,
    notes = p_notes,
    status = case
      when status = 'scheduled' and v_assigned_count >= p_required_staff then 'assigned'
      when status = 'assigned' and v_assigned_count < p_required_staff then 'scheduled'
      else status
    end,
    updated_by = auth.uid()
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

comment on function public.update_shift_details(uuid, smallint, text) is
  'Edita la dotación y las notas administrativas de un turno (corrige 06 sección 7, que traía "editar notas: update shifts.notes" -- 0012 no permite escritura directa de shifts, todo pasa por RPC; pendiente anotado en 12_Registro_de_Progreso.md, P10.3). O, A. SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, REQUIRED_STAFF_RANGE (1..10), REQUIRED_STAFF_BELOW_ASSIGNED si p_required_staff queda por debajo de los asignados vigentes. Recalcula scheduled/assigned según la nueva dotación (04 sección 6.1). Devuelve la fila de shifts. Desde 0028 (P14.2) fija updated_by = auth.uid(): esta RPC puede seguir editando notas/dotación con el turno in_progress, después de un check-in de otra persona, y no tiene que quedar atribuida a quien hizo ese check-in.';

-- ---------------------------------------------------------------------------------------------
-- 5. v_my_day (create or replace): changed_since_last_seen ignora las acciones del propio --------
--    empleado (P-092) ------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

create or replace view public.v_my_day
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.shift_id,
  sh.shift_date,
  (sh.shift_date = app.today()) as is_today,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions,
  si.building_hours,
  si.phone_restricted,
  si.photos_not_allowed,
  si.restrictions_notes,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  coalesce(tasks.tasks_total, 0) as tasks_total,
  coalesce(tasks.tasks_done, 0) as tasks_done,
  (
    (
      coalesce(a.updated_at, a.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (a.updated_at is null or a.updated_by is distinct from a.employee_id)
    )
    or
    (
      coalesce(sh.updated_at, sh.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (sh.updated_at is null or sh.updated_by is distinct from a.employee_id)
    )
  ) as changed_since_last_seen,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  ci.source as check_in_source,
  ci.recorded_by as check_in_recorded_by,
  co.source as check_out_source,
  co.recorded_by as check_out_recorded_by,
  notice.kind as last_notice_kind,
  notice.minutes_late as last_notice_minutes_late,
  notice.reason_code as last_notice_reason_code,
  notice.reason_text as last_notice_reason_text,
  notice.reported_by as last_notice_reported_by,
  notice.source as last_notice_source,
  notice.created_at as last_notice_at
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join lateral (
  select
    count(*) as tasks_total,
    count(*) filter (where st.status = 'done') as tasks_done
  from public.shift_tasks st
  where st.shift_id = a.shift_id
) tasks on true
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source, an.created_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.status <> 'cancelled'
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) -- pero, desde 0028 (P14.2), IGNORA el cambio si quien lo hizo (updated_by) es el mismo empleado dueño de la asignación: P-092 es "avisame lo que cambió otra persona", no las propias acciones (avisar demora/ausencia, registrar inicio/fin, cargar la observación). La asignación nueva sigue contando siempre por created_at (nadie más que administración inserta una asignación). Límite conocido y documentado en 0028: updated_at/updated_by son una sola pareja de columnas por fila, así que un cambio de administración no visto, seguido de una acción propia que vuelve a tocar la MISMA fila antes de que el empleado abra Hoy, puede apagar el cartel para ese cambio puntual (el dato en sí sigue siendo el vigente, nunca uno viejo). is_today distingue el bloque "hoy en detalle" de la lista simple de próximos días (P-093). check_in_at/check_out_at (0026, ATT-003) son la hora registrada de inicio y fin, si existen. site_city/site_latitude/site_longitude (0027, pendiente de P13.2): datos de la sede para mostrar mapa/ciudad sin una segunda consulta. check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by y last_notice_* (0027): origen del registro y último aviso propio, para "Avisaste demora de 15 min" (P14.2). Filtra employee_id = auth.uid() en la definición (no solo por RLS): es la vista de "mi día", no la de compañeros. security_invoker: además queda sujeta a la RLS de assignments/shifts/attendance_records/attendance_notices (0012, DB-014).';
