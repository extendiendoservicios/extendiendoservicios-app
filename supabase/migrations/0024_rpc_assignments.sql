-- ASSIGN-002 a ASSIGN-004 (08_Fases_y_Backlog.md, F11 · Asignaciones y cronograma, P11.1), más
-- la RPC `update_shift_details` que `12_Registro_de_Progreso.md` sección "Pendiente" (P10.3) suma
-- a este paquete.
--
-- Las cuatro RPC de asignaciones y dotación de `04_Modelo_de_Datos.md` sección 9 y
-- `06_API.md` sección 7 y 8: `assign_employee`, `remove_assignment`, `update_assignment_time`,
-- `update_shift_details`. Mismo patrón que `0023_rpc_shifts.sql`: `security definer`,
-- `set search_path = public, app, pg_temp`, `app.require_role`/`app.require_capability` primero,
-- transacción única, error `P0001` con mensaje en voseo y `hint` estable.
--
-- Ratificado por Mike el 25 sep 2026 (P11.0, `02_Decisiones.md`):
--   - P-034: habilitación por cliente ADVIERTE, no bloquea (si la lista está vacía, habilitado
--     para todos).
--   - P-046: franja propia opcional por asignación.
--   - P-054: sin límite de horizonte -- ninguna de estas RPC valida que `shift_date` esté dentro
--     de un rango.
--
-- Contenido, en orden:
--   1. `assign_employee(p_shift_id, p_employee_id, p_start?, p_end?)`: cupo, exclusión (traducida
--      a `ASSIGNMENT_OVERLAP`, mismo criterio que `update_shift_time`, 0023) y las tres
--      advertencias de 06 sección 8 (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`, `ON_LEAVE`).
--      Si completa la dotación, el turno pasa a `assigned` (04 sección 6.1).
--   2. `remove_assignment(p_assignment_id, p_reason)`: baja lógica con motivo. Si la dotación baja
--      de `required_staff`, el turno vuelve a `scheduled`.
--   3. `update_assignment_time(p_assignment_id, p_start?, p_end?)`: franja propia, solo antes del
--      inicio efectivo.
--   4. `update_shift_details(p_shift_id, p_required_staff, p_notes)`: dotación y notas
--      administrativas (`06_API.md` sección 7 traía "editar notas: update `shifts.notes`", que
--      `0012` no permite -- todas las escrituras de `shifts` pasan por RPC; se corrige en ese
--      archivo, ver el reporte de la tarea). Recalcula `scheduled`/`assigned` al cambiar la
--      dotación.
--   5. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que `0023`.
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - "Después del inicio del turno" (06 sección 8, `assign_employee`/exigencia agregada acá
--     también a `remove_assignment`, ver abajo) se interpreta como `now() >= shifts.starts_at`
--     (la hora de reloj, no el estado `in_progress`, que depende de que alguien haya registrado
--     el inicio -- P-068 permite el check-in en cualquier momento del día del turno, así que un
--     turno puede seguir en `scheduled`/`assigned` después de su hora de inicio si todavía nadie
--     marcó presente).
--   - El encargo (P11.1, punto 6) pide un pgTAP de "quitar/asignar después del inicio requiere
--     manage_attendance": `06` sección 8 solo anota la exigencia en la fila de `assign_employee`,
--     pero se aplica el mismo criterio a `remove_assignment` por simetría (quitar a alguien de un
--     turno que ya empezó es una acción tan sensible como agregarlo) y porque el encargo lo pide
--     explícitamente para las dos RPC.
--   - `ASSIGNMENT_STARTED` (asignación con inicio ya registrado, `status in ('present','finished')`)
--     se revisa ANTES que la exigencia de `manage_attendance`: si ya hay un check-in registrado,
--     el mensaje "no se quita, se cierra con `close_assignment`" es más específico que "el turno
--     ya empezó" y no cambia según la capacidad de quien llama.
--   - `ALREADY_ASSIGNED` (código nuevo, no está en `06` sección 15): si el empleado ya tiene una
--     asignación vigente en ESE turno, se distingue explícitamente de `ASSIGNMENT_OVERLAP` (que es
--     "otro turno en ese horario") con un mensaje más preciso, en vez de dejar que la exclusión
--     gist lo capture con un mensaje que hablaría de "otro turno" siendo el mismo.
--   - `ASSIGNMENT_TIME_OUT_OF_SHIFT` (código nuevo, no está en `06` sección 15): la franja propia
--     de una asignación (P-046) tiene que caer dentro de la franja del turno; el modelo pide la
--     regla pero no da el código (04 sección 2.3 solo anota el check de rango interno de la franja
--     propia, `assignments_time_range_check`, que no alcanza para esto).
--   - `ASSIGNMENT_NOT_FOUND` (código nuevo, no está en `06` sección 15): mismo criterio que
--     `SHIFT_NOT_FOUND` (0023) para "esa fila no existe o ya fue dada de baja".
--   - `REQUIRED_STAFF_RANGE` (código nuevo): `update_shift_details` valida el rango 1..10 antes de
--     tocar la fila para no dejar que el `check` de la tabla (`shifts_required_staff_check`)
--     devuelva un `23514` crudo -- mismo criterio que `INVALID_TIME_RANGE` en `create_shift`/
--     `update_shift_time` (0023), que tampoco dependen del `check` de `end_time > start_time`.
--   - `REQUIRED_STAFF_BELOW_ASSIGNED` (código nuevo): "rechaza una dotación menor que los
--     asignados vigentes" (P11.1, punto 4).
--   - `OUTSIDE_AVAILABILITY`: si el empleado no tiene NINGUNA fila en `employee_availability`, no
--     se advierte -- mismo criterio que `employee_client_permissions` vacía = habilitado para
--     todos (P-034); el modelo no lo dice para disponibilidad, pero es la lectura simétrica más
--     razonable ("no declaró nada" no es lo mismo que "declaró que nunca está disponible").
--   - `ON_LEAVE` se evalúa contra `shift_date` (la fecha del turno que se está asignando), no
--     contra "hoy": se puede planificar sin límite de horizonte (P-054) para cualquier mes, así que
--     la pregunta relevante es si el empleado está de licencia EL DÍA del turno, no hoy.
--   - Transiciones `scheduled ↔ assigned` (ASSIGN-004): dentro de cada RPC (`assign_employee`,
--     `remove_assignment`, `update_shift_details`), no con un trigger aparte. Mismo criterio que
--     `cancel_shift` (0023), que también actualiza `supervisions` dentro de la propia función en
--     vez de un trigger: la transacción de la RPC ya tiene todo el contexto (conteos, motivo del
--     cambio) sin necesitar que un trigger vuelva a preguntar "por qué cambió esto"; un trigger
--     sobre `assignments` además correría en cada `insert`/`update`/`delete` de la tabla,
--     incluyendo los que hacen `record_check_in`/`record_check_out`/`notify_*` (F13/F14, todavía no
--     escritas), que no deberían mover `shifts.status` entre `scheduled`/`assigned`.
--   - `update_shift_details` devuelve la fila de `shifts` directamente (no `jsonb` con
--     advertencias): mismo criterio que `update_shift_time`/`cancel_shift` (0023) -- no hay
--     advertencia posible para esta operación.
--
-- Revisión del orquestador (P11.1):
--   - Las cuatro RPC leen el turno con `for update`: el cupo se calcula contando asignaciones, y
--     sin el bloqueo dos `assign_employee` simultáneos sobre el último lugar ven los dos
--     "queda uno" y dejan el turno por encima de `required_staff`. Con el bloqueo, las
--     operaciones sobre un mismo turno se serializan.
--   - `assign_employee` trata como no activo a un empleado con `deleted_at` (baja lógica), aunque
--     su `status` haya quedado en `active`.
--   - `remove_assignment` y `update_assignment_time` rechazan un turno cancelado o finalizado
--     (`SHIFT_CANCELLED`/`SHIFT_COMPLETED`): sus asignaciones quedan para historia (P-049).

-- ---------------------------------------------------------------------------------------------
-- 1. assign_employee(p_shift_id, p_employee_id, p_start?, p_end?) -- 04 sección 9, 06 sección 8,
--    6.1, 6.2, P-033, P-034, P-035, P-046, P-053
-- ---------------------------------------------------------------------------------------------

create function public.assign_employee(
  p_shift_id uuid,
  p_employee_id uuid,
  p_start time default null,
  p_end time default null
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

  begin
    insert into public.assignments (shift_id, employee_id, start_time, end_time, created_by)
    values (p_shift_id, p_employee_id, p_start, p_end, auth.uid())
    returning * into v_assignment;
  exception
    when exclusion_violation then
      raise exception using
        errcode = 'P0001',
        message = 'El empleado ya tiene otro turno en ese horario.',
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  -- Advertencias (P-033, P-034, P-035): no bloquean, se calculan después de insertar para no
  -- repetir las condiciones si en el futuro se necesitan sobre la fila ya creada.
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

  if exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p_employee_id
      and el.deleted_at is null
      and el.starts_on <= v_shift.shift_date
      and (el.ends_on is null or el.ends_on >= v_shift.shift_date)
  ) then
    v_warnings := array_append(v_warnings, 'ON_LEAVE');
  end if;

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

comment on function public.assign_employee(uuid, uuid, time, time) is
  'Asigna un empleado a un turno (04 sección 9, 06 sección 8). O, A (después del inicio del turno: + manage_attendance, SHIFT_STARTED si falta). SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, EMPLOYEE_NOT_ACTIVE, ALREADY_ASSIGNED, SHIFT_FULL, ASSIGNMENT_OVERLAP (exclusión), INVALID_TIME_RANGE/ASSIGNMENT_TIME_OUT_OF_SHIFT para la franja propia (P-046). Devuelve {"assignment": <fila>, "warnings": [...]} con NOT_ENABLED_FOR_CLIENT (P-034), OUTSIDE_AVAILABILITY (P-035), ON_LEAVE (P-033) -- ninguna bloquea. Si completa la dotación, el turno pasa a assigned.';

-- ---------------------------------------------------------------------------------------------
-- 2. remove_assignment(p_assignment_id, p_reason) -- 04 sección 9, 06 sección 8, 6.1, 6.2
-- ---------------------------------------------------------------------------------------------

create function public.remove_assignment(p_assignment_id uuid, p_reason text)
returns public.assignments
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_remaining_count int;
begin
  perform app.require_role('owner', 'admin');

  select * into v_assignment from public.assignments where id = p_assignment_id and removed_at is null;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_assignment.status in ('present', 'finished') then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó: se cierra, no se puede quitar.',
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

  if now() >= v_shift.starts_at and not app.has_capability('manage_attendance') then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya empezó.',
      hint = 'SHIFT_STARTED';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  -- `removed_at is null` otra vez: otra llamada pudo quitarla mientras esta esperaba el bloqueo
  -- del turno.
  update public.assignments
  set removed_at = now(), removed_by = auth.uid(), removed_reason = p_reason
  where id = p_assignment_id and removed_at is null
  returning * into v_assignment;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  select count(*) into v_remaining_count
  from public.assignments a
  where a.shift_id = v_shift.id and a.removed_at is null;

  -- Transición assigned -> scheduled (04 sección 6.1): si esta baja deja la dotación incompleta.
  update public.shifts
  set status = 'scheduled'
  where id = v_shift.id
    and status = 'assigned'
    and v_remaining_count < required_staff;

  return v_assignment;
end;
$$;

comment on function public.remove_assignment(uuid, text) is
  'Baja lógica de una asignación con motivo obligatorio (04 sección 9, 6.2, 06 sección 8). O, A (después del inicio del turno: + manage_attendance, SHIFT_STARTED si falta -- decisión menor, simetría con assign_employee). ASSIGNMENT_NOT_FOUND si no existe o ya fue quitada; ASSIGNMENT_STARTED si ya tiene inicio registrado (present/finished: se cierra con close_assignment, F14, no se quita); REASON_REQUIRED sin motivo. Si la dotación queda incompleta, el turno vuelve a scheduled.';

-- ---------------------------------------------------------------------------------------------
-- 3. update_assignment_time(p_assignment_id, p_start?, p_end?) -- 04 sección 9, 06 sección 8, P-046
-- ---------------------------------------------------------------------------------------------

create function public.update_assignment_time(p_assignment_id uuid, p_start time default null, p_end time default null)
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
    set start_time = p_start, end_time = p_end
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
  'Cambia la franja propia de una asignación (P-046, 06 sección 8). O, A. Solo antes del inicio efectivo (lower(window)) -- ASSIGNMENT_STARTED si ya pasó. ASSIGNMENT_NOT_FOUND, INVALID_TIME_RANGE, ASSIGNMENT_TIME_OUT_OF_SHIFT (fuera de la franja del turno), ASSIGNMENT_OVERLAP si la nueva ventana pisa otra asignación del mismo empleado (exclusion_violation traducido, mismo criterio que update_shift_time, 0023). El trigger app.sync_assignment_window (0007) recalcula la ventana.';

-- ---------------------------------------------------------------------------------------------
-- 4. update_shift_details(p_shift_id, p_required_staff, p_notes) -- 06 sección 7 (corregida),
--    `12_Registro_de_Progreso.md` sección "Pendiente" (P10.3)
-- ---------------------------------------------------------------------------------------------

create function public.update_shift_details(p_shift_id uuid, p_required_staff smallint, p_notes text default null)
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
    end
  where id = p_shift_id
  returning * into v_shift;

  return v_shift;
end;
$$;

comment on function public.update_shift_details(uuid, smallint, text) is
  'Edita la dotación y las notas administrativas de un turno (corrige 06 sección 7, que traía "editar notas: update shifts.notes" -- 0012 no permite escritura directa de shifts, todo pasa por RPC; pendiente anotado en 12_Registro_de_Progreso.md, P10.3). O, A. SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, REQUIRED_STAFF_RANGE (1..10), REQUIRED_STAFF_BELOW_ASSIGNED si p_required_staff queda por debajo de los asignados vigentes. Recalcula scheduled/assigned según la nueva dotación (04 sección 6.1). Devuelve la fila de shifts.';

-- ---------------------------------------------------------------------------------------------
-- 5. Grants: execute a authenticated, revocado de public/anon (mismo patrón que 0023) -----------
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.assign_employee(uuid, uuid, time, time) from public, anon;
grant execute on function public.assign_employee(uuid, uuid, time, time) to authenticated;

revoke execute on function public.remove_assignment(uuid, text) from public, anon;
grant execute on function public.remove_assignment(uuid, text) to authenticated;

revoke execute on function public.update_assignment_time(uuid, time, time) from public, anon;
grant execute on function public.update_assignment_time(uuid, time, time) to authenticated;

revoke execute on function public.update_shift_details(uuid, smallint, text) from public, anon;
grant execute on function public.update_shift_details(uuid, smallint, text) to authenticated;
