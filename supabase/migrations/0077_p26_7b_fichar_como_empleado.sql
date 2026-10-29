-- 0077_p26_7b_fichar_como_empleado.sql
-- P26.7b (CR-16): un dueño o administrador que también es empleado actúa COMO EMPLEADO cuando opera
-- sobre su propio turno desde la app del celular.
--
-- Hasta 0076, varias RPC evaluaban `app.is_admin()` antes de mirar si quien llama es el titular:
-- un dueño asignado a un turno que avisaba una demora o ausencia quedaba registrado como
-- administración (origen `admin`, exige `manage_attendance`, sin ventana de aviso), y en las tareas
-- y la observación se saltaba las validaciones del empleado.
--
-- Regla (decisión del orquestador, 28 oct 2026): si quien llama es el empleado asignado de esa
-- asignación (rol `employee` y `employee_id = auth.uid()`), la RPC sigue el camino del empleado, con
-- sus mismas validaciones, origen y eventos, aunque además tenga `owner` o `admin`. El camino de
-- administración queda para operar sobre asignaciones de OTRAS personas.
--
-- Cambian solo el orden y la condición de la rama de permisos de cuatro RPC (`create or replace`,
-- misma firma, mismos grants, mismos mensajes y códigos de error):
--   update_task_status, set_assignment_notes, notify_delay, notify_absence.
-- No se toca ningún dato.

create or replace function public.update_task_status(
  p_task_id uuid,
  p_status public.task_status,
  p_reason text default null
)
returns public.shift_tasks
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_task public.shift_tasks;
begin
  select * into v_task from public.shift_tasks where id = p_task_id;

  if v_task.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa tarea.',
      hint = 'TASK_NOT_FOUND';
  end if;

  if app.has_role('employee') and exists (
    select 1 from public.assignments a
    where a.shift_id = v_task.shift_id
      and a.employee_id = auth.uid()
      and a.removed_at is null
  ) then
    -- Titular del turno (0077, CR-16): camino del empleado aunque además sea dueño o administrador.
    -- Solo con asignación vigente en estado present -- la ventana entre su inicio
    -- (record_check_in) y su fin (record_check_out), F13 (04 sección 6.3, P-063).
    if not exists (
      select 1 from public.assignments a
      where a.shift_id = v_task.shift_id
        and a.employee_id = auth.uid()
        and a.removed_at is null
        and a.status = 'present'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Las tareas se marcan entre el inicio y el fin del servicio.',
        hint = 'TASK_LOCKED';
    end if;
  elsif app.is_admin() then
    -- Dueño y administrador editan siempre, en cualquier momento del turno, las tareas de turnos en
    -- los que no son titulares (P-063).
    null;
  elsif app.has_role('employee') then
    -- Empleado sin asignación vigente en el turno de la tarea.
    raise exception using
      errcode = 'P0001',
      message = 'Las tareas se marcan entre el inicio y el fin del servicio.',
      hint = 'TASK_LOCKED';
  else
    -- Supervisor (o cualquier otro caso sin rol admin ni employee): sin permiso alguno sobre esta
    -- RPC (06 sección 9 no lo lista).
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  if p_status = 'not_done' and (p_reason is null or btrim(p_reason) = '') then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  update public.shift_tasks
  set
    status = p_status,
    not_done_reason = case when p_status = 'not_done' then p_reason else null end,
    status_changed_at = now(),
    status_changed_by = auth.uid(),
    updated_by = auth.uid()
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

create or replace function public.set_assignment_notes(p_assignment_id uuid, p_notes text)
returns public.assignments
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift_status public.shift_status;
  v_notes text;
  v_result public.assignments;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  select status into v_shift_status from public.shifts where id = v_assignment.shift_id;

  if app.has_role('employee') and v_assignment.employee_id = auth.uid() then
    -- Titular de la asignación (0077, CR-16): camino del empleado aunque además sea dueño o
    -- administrador. Solo su propia asignación vigente, mientras el turno no esté completed.
    if v_assignment.removed_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;

    if v_shift_status = 'completed' then
      raise exception using
        errcode = 'P0001',
        message = 'Este turno ya terminó.',
        hint = 'SHIFT_COMPLETED';
    end if;
  elsif app.is_admin() then
    -- Dueño y administrador editan siempre, en cualquier momento, la observación de asignaciones
    -- de otras personas (P-063).
    null;
  elsif app.has_role('employee') then
    -- Empleado sobre la asignación de otra persona.
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  else
    -- Supervisor (o cualquier otro caso sin rol admin ni employee): sin permiso alguno.
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  v_notes := nullif(btrim(p_notes), '');

  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using
      errcode = 'P0001',
      message = 'La observación es demasiado larga (máximo 2000 caracteres).',
      hint = 'NOTES_TOO_LONG';
  end if;

  update public.assignments
  set notes = v_notes, updated_by = auth.uid()
  where id = p_assignment_id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.notify_delay(
  p_assignment_id uuid,
  p_minutes integer,
  p_reason_text text default null
)
returns public.attendance_notices
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_source public.attendance_source;
  v_notice public.attendance_notices;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- Árbol de permisos (P-074): owner/admin siempre necesitan manage_attendance (aviso en
  -- nombre); si no son admin, tienen que ser employee y dueños de la asignación.
  -- Desde 0077 (P26.7b, CR-16): primero se decide si quien llama es el titular. Un dueño o
  -- administrador con rol employee avisando por su propia asignación va por el camino del empleado
  -- (origen employee_app, sin manage_attendance).
  if app.has_role('employee') and v_assignment.employee_id = auth.uid() then
    v_source := 'employee_app';
  elsif app.is_admin() then
    if not app.has_capability('manage_attendance') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
    v_source := 'admin';
  elsif app.has_role('employee') then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no es tuya.',
      hint = 'NOT_YOUR_ASSIGNMENT';
  else
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
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

  if v_assignment.status in ('present', 'finished') then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
  end if;

  if v_assignment.status = 'absence_notified' then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  -- P-072: la demora es solo antes del inicio efectivo, para todos (ratificado el 26 sep 2026,
  -- P14.0) -- sin excepción para el aviso en nombre, a diferencia de notify_absence.
  if now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  if p_minutes is null or p_minutes < 1 or p_minutes > 600 then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá los minutos de demora estimados.',
      hint = 'MINUTES_REQUIRED';
  end if;

  insert into public.attendance_notices (
    assignment_id, kind, minutes_late, reason_text, reported_by, source
  )
  values (
    p_assignment_id, 'delay', p_minutes, nullif(btrim(p_reason_text), ''), auth.uid(), v_source
  )
  returning * into v_notice;

  update public.assignments
  set status = 'delay_notified', updated_by = auth.uid()
  where id = p_assignment_id;

  return v_notice;
end;
$$;

create or replace function public.notify_absence(
  p_assignment_id uuid,
  p_reason_code public.absence_reason default null,
  p_reason_text text default null,
  p_has_certificate boolean default null
)
returns public.attendance_notices
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_source public.attendance_source;
  v_on_behalf boolean;
  v_notice public.attendance_notices;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- Desde 0077 (P26.7b, CR-16): primero se decide si quien llama es el titular. Un dueño o
  -- administrador con rol employee avisando por su propia asignación va por el camino del empleado
  -- (origen employee_app, motivo obligatorio, solo antes del inicio, sin manage_attendance).
  if app.has_role('employee') and v_assignment.employee_id = auth.uid() then
    v_source := 'employee_app';
    v_on_behalf := false;
  elsif app.is_admin() then
    if not app.has_capability('manage_attendance') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
    v_source := 'admin';
    v_on_behalf := true;
  elsif app.has_role('employee') then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no es tuya.',
      hint = 'NOT_YOUR_ASSIGNMENT';
  else
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
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

  -- present/finished: ya hay un check_in registrado -- ni el propio empleado ni el administrador
  -- pueden avisar una ausencia a esta altura (04 sección 6.2 no tiene esa transición).
  if v_assignment.status in ('present', 'finished') then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
  end if;

  if v_assignment.status = 'absence_notified' then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  -- P-073: antes del inicio efectivo para el propio empleado. Decisión de Mike del 26 sep 2026
  -- (P14.0): dueño y administrador con manage_attendance también pueden avisar después del inicio
  -- efectivo, mientras la asignación no tenga inicio registrado (ver 0027).
  if not v_on_behalf and now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  -- Desde 0059 (P19.11a): el motivo es obligatorio solo para el empleado; administración puede
  -- omitirlo, pero tiene que indicar si la ausencia es con o sin certificado.
  if not v_on_behalf and p_reason_code is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo de la ausencia.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_reason_code = 'other' and nullif(btrim(p_reason_text), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo de la ausencia.',
      hint = 'REASON_REQUIRED';
  end if;

  if v_on_behalf and p_has_certificate is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si la ausencia es con certificado o sin certificado.',
      hint = 'CERTIFICATE_REQUIRED';
  end if;

  insert into public.attendance_notices (
    assignment_id, kind, reason_code, reason_text, has_certificate, reported_by, source
  )
  values (
    p_assignment_id, 'absence', p_reason_code, nullif(btrim(p_reason_text), ''),
    case when v_on_behalf then p_has_certificate else null end,
    auth.uid(), v_source
  )
  returning * into v_notice;

  -- La asignación queda absence_notified; el cupo NO se libera (P-073), el administrador decide.
  update public.assignments
  set status = 'absence_notified', updated_by = auth.uid()
  where id = p_assignment_id;

  return v_notice;
end;
$$;

comment on function public.update_task_status(uuid, public.task_status, text) is
  'Cambia el estado de una tarea del turno (04 sección 6.3, 9; 06 sección 9, P-063). E: solo con asignación vigente present en el turno de la tarea, si no TASK_LOCKED; desde 0077 (P26.7b, CR-16) también un dueño o administrador con rol employee que tenga asignación vigente en ese turno sigue este camino del empleado. O, A: siempre, en los turnos en los que no son titulares; cualquier otro rol (supervisor incluido): FORBIDDEN. TASK_NOT_FOUND si no existe. not_done exige motivo (REASON_REQUIRED); not_done_reason se limpia al salir de not_done. Registra status_changed_at/status_changed_by. Sin validación de transición: 04 sección 6.3 permite moverse libremente entre los cuatro estados.';

comment on function public.set_assignment_notes(uuid, text) is
  'Observación del servicio, una por asignación (04 sección 2.3; 06 sección 8; P-062). E: solo su propia asignación vigente y con el turno no completed (SHIFT_COMPLETED si no); desde 0077 (P26.7b, CR-16) también un dueño o administrador con rol employee sobre su propia asignación sigue ese camino; O, A: siempre, en asignaciones de otras personas; cualquier otro caso (supervisor incluido, o empleado sobre una asignación ajena): FORBIDDEN. ASSIGNMENT_NOT_FOUND si no existe. Texto vacío o solo espacios se guarda como null; NOTES_TOO_LONG por encima de 2000 caracteres (decisión menor).';

comment on function public.notify_delay(uuid, integer, text) is
  'Aviso de demora (04 sección 6.2; 06 sección 11; P-072, P-074). E (propia, source = employee_app; desde 0077, P26.7b, CR-16, también un dueño o administrador con rol employee por su propia asignación); O, A + manage_attendance en asignaciones de otras personas (en nombre, reported_by = auth.uid(), source = admin). Solo antes del inicio efectivo, para todos -- TOO_LATE_TO_NOTIFY si no. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT (empleado sobre asignación ajena), FORBIDDEN (supervisor, o admin sin manage_attendance), SHIFT_CANCELLED/SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya present/finished), MINUTES_REQUIRED (minutos obligatorios, 1..600). Asignación -> delay_notified.';

comment on function public.notify_absence(uuid, public.absence_reason, text, boolean) is
  'Aviso de ausencia (04 sección 6.2; 06 sección 11; P-073, P-074). E (propia, solo antes del inicio efectivo; el motivo es obligatorio y p_has_certificate se ignora); desde 0077 (P26.7b, CR-16) también un dueño o administrador con rol employee por su propia asignación sigue este camino (origen employee_app). O, A + manage_attendance en asignaciones de otras personas (en nombre, antes o después del inicio efectivo mientras la asignación no tenga inicio registrado -- ratificado el 26 sep 2026, P14.0; desde 0059, P19.11a, el motivo es opcional y es obligatorio indicar p_has_certificate: con certificado true, sin certificado false). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, FORBIDDEN (supervisor, o admin sin manage_attendance), SHIFT_CANCELLED/SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya present/finished), TOO_LATE_TO_NOTIFY (solo para el propio empleado, después del inicio, o si ya avisó una ausencia), REASON_REQUIRED (motivo obligatorio para el empleado; si es other, también el texto), CERTIFICATE_REQUIRED (administración sin indicar el certificado). Asignación -> absence_notified; el cupo no se libera solo.';
