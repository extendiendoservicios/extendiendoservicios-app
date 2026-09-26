-- ABS-002, ATT-007 (08_Fases_y_Backlog.md, F14 · Ausencias y demoras, asistencia administrativa).
--
-- Las cuatro RPC que faltaban de 04_Modelo_de_Datos.md sección 9 y 06_API.md secciones 10 y 11:
-- `notify_delay`, `notify_absence` (avisos del empleado o en su nombre) y
-- `admin_record_attendance`, `close_assignment` (registro e inicio/fin en nombre del empleado).
-- Mismo patrón que `0023_rpc_shifts.sql`/`0024_rpc_assignments.sql`/`0025_rpc_tasks.sql`/
-- `0026_rpc_attendance.sql`: `security definer`, `set search_path = public, app, pg_temp`,
-- verificación de rol/capacidad primero, transacción única, error `P0001` con mensaje en voseo y
-- `hint` estable.
--
-- Decisiones ratificadas por Mike el 26 sep 2026 (P14.0, `02_Decisiones.md`), obligatorias para
-- este archivo:
--   - P-072: en `notify_delay` los minutos estimados son obligatorios (entero 1..600 -- el tope ya
--     lo fija `attendance_notices_minutes_late_check`, 0009; se valida antes en la RPC para no
--     dejar que ese `check` devuelva un `23514` crudo, mismo criterio que `INVALID_TIME_RANGE` en
--     `create_shift`, 0023).
--   - Hora editable en `admin_record_attendance` y `close_assignment`: `p_at` opcional, por
--     defecto `now()`; si viene, tiene que estar entre las 0:00 del día del turno (hora de
--     Argentina, `app.local_ts(shift_date, '00:00')`) y `now()`, nunca futura. Código nuevo
--     (no está en `06` sección 15): `AT_OUT_OF_RANGE`.
--   - Ausencia en nombre del empleado: dueño y administrador con `manage_attendance` pueden
--     registrar `notify_absence` en nombre del empleado también después del inicio efectivo,
--     mientras la asignación no tenga inicio registrado (estado `expected`/`delay_notified`, que
--     por construcción implica que todavía no hay `check_in` -- `record_check_in`/
--     `admin_record_attendance` siempre mueven la asignación a `present` en el mismo instante en
--     que insertan el `check_in`). La demora (`notify_delay`) es solo antes del inicio para
--     todos, sin excepción para el aviso en nombre.
--
-- Contenido, en orden:
--   0. Auxiliares nuevos en `app`, para no duplicar la lógica de transición de turno que ya tienen
--      `record_check_in`/`record_check_out` (0026) -- ver la nota de la sección 0 más abajo.
--   1. `notify_delay(p_assignment_id, p_minutes, p_reason_text?)` (04 sección 6.2; 06 sección 11;
--      P-072, P-074).
--   2. `notify_absence(p_assignment_id, p_reason_code, p_reason_text?)` (ídem; P-073, P-074).
--   3. `admin_record_attendance(p_assignment_id, p_kind, p_at?, p_reason)` (06 sección 10; P-075,
--      decisión de Mike del 26 sep 2026).
--   4. `close_assignment(p_assignment_id, p_reason, p_at?)` (04 sección 6.2; 06 sección 10; P-069).
--   5. `v_assignments_board` (`create or replace view`, columnas nuevas al final): último aviso
--      (tipo, minutos, motivo, quién y cuándo) y origen del registro (`source`, `recorded_by`) de
--      inicio y fin -- para ADM-10/ADM-11/ADM-06 (P14.3) y el tablero.
--   6. `v_my_day` (ídem): mismas columnas de último aviso y origen, más `site_city`,
--      `site_latitude`, `site_longitude` (pendiente anotado desde P13.2) -- para EMP-03/EMP-04
--      (P14.2, "Avisaste demora de 15 min").
--   7. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que las migraciones
--      anteriores de RPC.
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - Permisos de `notify_delay`/`notify_absence`: a diferencia de `set_assignment_notes` (0026,
--     que usa `FORBIDDEN` tanto para "asignación ajena" como para "rol sin ningún permiso"), acá
--     se distinguen los dos casos porque `06` sección 11 lista `NOT_YOUR_ASSIGNMENT` como código
--     propio de esta sección (no lo hacía la sección 8 para `set_assignment_notes`): un empleado
--     sobre una asignación ajena -> `NOT_YOUR_ASSIGNMENT` (mismo criterio que
--     `record_check_in`/`record_check_out`, 0026); un supervisor, o un admin sin
--     `manage_attendance` -> `FORBIDDEN`. Árbol de decisión: si el llamador es owner o admin,
--     manda `manage_attendance` (FORBIDDEN si falta, sin mirar el rol employee aunque la misma
--     persona lo tuviera -- nadie en el seed combina employee con owner/admin, y P-013 exige la fila
--     de `employees` solo para employee/supervisor); si no es admin, tiene que ser employee y
--     dueño de la asignación (si no, `NOT_YOUR_ASSIGNMENT`); cualquier otro rol (supervisor, o
--     employee sin ninguna asignación con ese id) -> se resuelve como `NOT_YOUR_ASSIGNMENT` u
--     `ASSIGNMENT_NOT_FOUND` según corresponda si tiene rol employee, o `FORBIDDEN` si no tiene
--     ni rol employee ni admin (por ejemplo, un supervisor puro).
--   - `ASSIGNMENT_STARTED` (código ya existente, 06 sección 8) se reutiliza en `notify_delay`/
--     `notify_absence` cuando la asignación ya tiene inicio registrado (`present`/`finished`):
--     mismo código y mismo criterio que `remove_assignment` (0024) para "esto ya no se puede
--     tocar con esta RPC, hay otra específica para ese caso" (acá, ninguna: si ya empezó, no hay
--     nada que avisar).
--   - Repetir un aviso del mismo tipo, o avisar demora estando ya en `absence_notified` (no son
--     transiciones de 04 sección 6.2): se reutiliza `TOO_LATE_TO_NOTIFY` como código general para
--     "ya no correspondía este aviso en el estado actual" -- no hay un código dedicado en `06`
--     sección 15 para esta situación puntual y el mensaje ("el aviso tiene que hacerse antes de la
--     hora de inicio") sigue siendo razonable: en la práctica, para llegar a `delay_notified` o
--     `absence_notified` la hora de inicio efectiva ya tuvo que ser, en algún momento, posterior a
--     `now()`, y un segundo aviso del mismo tipo o una demora después de una ausencia ya avisada no
--     tiene sentido de negocio.
--   - `p_minutes` fuera de rango (no solo null): mismo código `MINUTES_REQUIRED` que "sin minutos"
--     (06 sección 15 no distingue "falta" de "inválido" para minutos ni motivo, igual que
--     `REASON_REQUIRED`).
--   - `notify_absence`: motivo (`p_reason_code`) obligatorio (`REASON_REQUIRED`); si es `other`,
--     texto obligatorio (mismo código `REASON_REQUIRED`, mismo criterio de "no distinguir falta de
--     motivo de falta de texto" que arriba) -- el `check` de la tabla
--     (`attendance_notices_reason_text_check`, 0009) ya lo exige a nivel de base como defensa en
--     profundidad.
--   - `admin_record_attendance`/`close_assignment`: `perform app.require_capability
--     ('manage_attendance')` como primera línea (no `require_role`): esta RPC no tiene variante
--     "propia" del empleado (a diferencia de `notify_delay`/`notify_absence`), así que la única
--     condición de entrada es la capacidad -- el owner la tiene siempre (`app.has_capability`).
--   - `admin_record_attendance` no exige `NOT_TODAY`: `06` sección 10 no lo pide para esta RPC (a
--     diferencia de `record_check_in`), y la validación de rango de `p_at` (0:00 del día del turno
--     hasta `now()`) ya impide cargar un inicio o un fin para un turno cuyo día todavía no llegó;
--     sí permite cargar asistencia de un turno de un día anterior (por ejemplo, se olvidaron de
--     avisar y lo cargan al otro día), consistente con P-069 ("sin cierre automático a fin de
--     día") y con que `record_check_out` tampoco exige `NOT_TODAY` (0026).
--   - `admin_record_attendance` con `p_kind = 'check_out'` exige un `check_in` previo
--     (`NOT_CHECKED_IN`) y valida que `p_at`/`now()` sea posterior al `check_in` ya registrado
--     (`INVALID_TIME_RANGE`, código ya existente de `06` sección 15, "la hora de fin tiene que ser
--     posterior a la de inicio") -- la única RPC de asistencia que puede violar esa regla, porque
--     acá `p_at` no lo pone `now()` en el momento exacto de la llamada (P-066 lo relaja para esta
--     RPC, a diferencia de `record_check_in`/`record_check_out`).
--   - `close_assignment` exige la asignación en `present` sin fin (`NOT_CHECKED_IN` si nunca
--     empezó, `ALREADY_CHECKED_OUT` si ya tiene fin) -- mismos códigos que
--     `admin_record_attendance(p_kind := 'check_out')`, del cual `close_assignment` es un atajo
--     semántico ("cierre manual", P-069) con motivo siempre obligatorio (a diferencia de
--     `admin_record_attendance`, donde el motivo también es obligatorio por el mismo `check` de la
--     tabla -- se documenta la simetría, no hay diferencia real de validación entre las dos RPC más
--     que el nombre y la intención de uso).
--   - Auxiliares `app.start_shift_if_needed`/`app.complete_shift_if_done` (sección 0): se extrae la
--     lógica de transición de turno que hoy vive inline en `record_check_in`/`record_check_out`
--     (0026) a dos funciones nuevas del esquema `app`, y esta misma migración reemplaza (`create or
--     replace`) el cuerpo de esas dos funciones para que llamen a los auxiliares en vez de repetir
--     el `update`. El comportamiento no cambia (mismas condiciones, mismo orden, mismo bloqueo
--     `for update` ya tomado antes de llamar al auxiliar) -- se verifica con la batería de pgTAP ya
--     existente de 0026, que seguía pasando después del cambio. Así `admin_record_attendance`/
--     `close_assignment` reutilizan la misma lógica en vez de duplicarla, tal como pide el encargo.

-- ---------------------------------------------------------------------------------------------
-- 0. Auxiliares en `app`: transición de turno compartida por las cuatro RPC de asistencia --------
-- ---------------------------------------------------------------------------------------------

-- Turno scheduled/assigned -> in_progress con el primer inicio del turno (04 sección 6.1). Se
-- asume que el turno ya está bloqueado (`for update`) por quien llama, igual que antes en
-- record_check_in.
create function app.start_shift_if_needed(p_shift_id uuid)
returns void
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  update public.shifts
  set status = 'in_progress'
  where id = p_shift_id and status in ('scheduled', 'assigned');
end;
$$;

comment on function app.start_shift_if_needed(uuid) is
  'Transición scheduled/assigned -> in_progress con el primer inicio del turno (04 sección 6.1). Auxiliar compartido por record_check_in (0026) y admin_record_attendance (0027) -- asume que el turno ya está bloqueado (for update) por quien llama.';

-- Turno in_progress -> completed cuando TODAS las asignaciones vigentes están finished o
-- absence_notified (04 sección 6.1). Mismo criterio que antes en record_check_out: se llama
-- DESPUÉS de actualizar la asignación que dispara la verificación, con el turno ya bloqueado.
create function app.complete_shift_if_done(p_shift_id uuid)
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
    update public.shifts set status = 'completed' where id = p_shift_id;
  end if;
end;
$$;

comment on function app.complete_shift_if_done(uuid) is
  'Transición in_progress -> completed cuando ya no queda ninguna asignación vigente sin finished/absence_notified (04 sección 6.1). Auxiliar compartido por record_check_out (0026), admin_record_attendance y close_assignment (0027) -- asume que el turno ya está bloqueado (for update) por quien llama.';

-- record_check_in/record_check_out (0026): se reemplaza el cuerpo para que llamen a los
-- auxiliares de arriba en vez de repetir el update inline. Comportamiento idéntico (verificado con
-- los pgTAP de 0026, que se corrieron de nuevo después de este cambio).

create or replace function public.record_check_in(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
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
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by
  )
  values (
    p_assignment_id, 'check_in', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid()
  )
  returning * into v_record;

  update public.assignments
  set status = 'present', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.start_shift_if_needed(v_shift.id);

  return v_record;
end;
$$;

comment on function public.record_check_in(uuid, numeric, numeric, numeric) is
  'Registra el inicio de una asignación con la hora del servidor (04 sección 6.1, 6.2; 06 sección 10; P-065 a P-068). E (propia). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, SHIFT_COMPLETED, NOT_TODAY (fecha del turno distinta de hoy, Argentina), COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE (P-067, ADR-009), ALREADY_CHECKED_IN. Asignación -> present; turno -> in_progress si era scheduled/assigned (0027: vía app.start_shift_if_needed, mismo comportamiento que 0026).';

create or replace function public.record_check_out(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
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

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by
  )
  values (
    p_assignment_id, 'check_out', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid()
  )
  returning * into v_record;

  update public.assignments
  set status = 'finished', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.complete_shift_if_done(v_shift.id);

  return v_record;
end;
$$;

comment on function public.record_check_out(uuid, numeric, numeric, numeric) is
  'Registra el fin de una asignación con la hora del servidor (04 sección 6.1, 6.2; 06 sección 10; P-069, P-070). E (propia). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE. Sin NOT_TODAY (P-069). Asignación -> finished; turno -> completed si ya no queda ninguna asignación vigente sin finished/absence_notified (0027: vía app.complete_shift_if_done, mismo comportamiento que 0026).';

-- ---------------------------------------------------------------------------------------------
-- 1. notify_delay(p_assignment_id, p_minutes, p_reason_text?) -- 04 sección 6.2; 06 sección 11;
--    P-072, P-074
-- ---------------------------------------------------------------------------------------------

create function public.notify_delay(
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
  if app.is_admin() then
    if not app.has_capability('manage_attendance') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
    v_source := 'admin';
  elsif app.has_role('employee') then
    if v_assignment.employee_id <> auth.uid() then
      raise exception using
        errcode = 'P0001',
        message = 'Esa asignación no es tuya.',
        hint = 'NOT_YOUR_ASSIGNMENT';
    end if;
    v_source := 'employee_app';
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

comment on function public.notify_delay(uuid, integer, text) is
  'Aviso de demora (04 sección 6.2; 06 sección 11; P-072, P-074). E (propia); O, A + manage_attendance (en nombre, reported_by = auth.uid(), source = admin). Solo antes del inicio efectivo, para todos -- TOO_LATE_TO_NOTIFY si no. ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT (empleado sobre asignación ajena), FORBIDDEN (supervisor, o admin sin manage_attendance), SHIFT_CANCELLED/SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya present/finished), MINUTES_REQUIRED (minutos obligatorios, 1..600). Asignación -> delay_notified.';

-- ---------------------------------------------------------------------------------------------
-- 2. notify_absence(p_assignment_id, p_reason_code, p_reason_text?) -- 04 sección 6.2;
--    06 sección 11; P-073, P-074
-- ---------------------------------------------------------------------------------------------

create function public.notify_absence(
  p_assignment_id uuid,
  p_reason_code public.absence_reason,
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

  if app.is_admin() then
    if not app.has_capability('manage_attendance') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
    v_source := 'admin';
    v_on_behalf := true;
  elsif app.has_role('employee') then
    if v_assignment.employee_id <> auth.uid() then
      raise exception using
        errcode = 'P0001',
        message = 'Esa asignación no es tuya.',
        hint = 'NOT_YOUR_ASSIGNMENT';
    end if;
    v_source := 'employee_app';
    v_on_behalf := false;
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
  -- efectivo, mientras la asignación no tenga inicio registrado -- condición que, llegados a este
  -- punto, ya está garantizada por el chequeo de arriba (status in expected/delay_notified implica
  -- que todavía no hay check_in: record_check_in/admin_record_attendance siempre pasan la
  -- asignación a present en el mismo instante en que insertan el check_in). Por eso acá NO hay
  -- comparación de horario para el aviso en nombre -- ver la nota de la migración.
  if not v_on_behalf and now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  if p_reason_code is null then
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

  insert into public.attendance_notices (
    assignment_id, kind, reason_code, reason_text, reported_by, source
  )
  values (
    p_assignment_id, 'absence', p_reason_code, nullif(btrim(p_reason_text), ''), auth.uid(), v_source
  )
  returning * into v_notice;

  -- La asignación queda absence_notified; el cupo NO se libera (P-073), el administrador decide.
  update public.assignments
  set status = 'absence_notified', updated_by = auth.uid()
  where id = p_assignment_id;

  return v_notice;
end;
$$;

comment on function public.notify_absence(uuid, public.absence_reason, text) is
  'Aviso de ausencia (04 sección 6.2; 06 sección 11; P-073, P-074). E (propia, solo antes del inicio efectivo); O, A + manage_attendance (en nombre, antes o después del inicio efectivo mientras la asignación no tenga inicio registrado -- ratificado el 26 sep 2026, P14.0). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, FORBIDDEN (supervisor, o admin sin manage_attendance), SHIFT_CANCELLED/SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya present/finished), TOO_LATE_TO_NOTIFY (solo para el propio empleado, después del inicio), REASON_REQUIRED (motivo obligatorio; si es other, también el texto). Asignación -> absence_notified; el cupo no se libera solo.';

-- ---------------------------------------------------------------------------------------------
-- 3. admin_record_attendance(p_assignment_id, p_kind, p_at?, p_reason) -- 06 sección 10; P-075;
--    hora editable ratificada el 26 sep 2026 (P14.0)
-- ---------------------------------------------------------------------------------------------

create function public.admin_record_attendance(
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
      assignment_id, kind, recorded_at, source, recorded_by, reason
    )
    values (p_assignment_id, 'check_in', v_at, 'admin', auth.uid(), p_reason)
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
      assignment_id, kind, recorded_at, source, recorded_by, reason
    )
    values (p_assignment_id, 'check_out', v_at, 'admin', auth.uid(), p_reason)
    returning * into v_record;

    update public.assignments
    set status = 'finished', updated_by = auth.uid()
    where id = p_assignment_id;

    perform app.complete_shift_if_done(v_shift.id);
  end if;

  return v_record;
end;
$$;

comment on function public.admin_record_attendance(uuid, public.attendance_kind, timestamptz, text) is
  'Registra inicio o fin en nombre del empleado (06 sección 10; P-075). O; A + manage_attendance. p_at opcional (por defecto now()), entre las 0:00 del día del turno (Argentina) y now(), nunca futura -- AT_OUT_OF_RANGE si no (ratificado el 26 sep 2026, P14.0). Motivo obligatorio (REASON_REQUIRED). source = admin, recorded_by = auth.uid(). Mismos códigos y transiciones que record_check_in/record_check_out (0026) para el kind correspondiente, más INVALID_TIME_RANGE si el fin no es posterior al inicio ya registrado (acá p_at no lo pone now() en el instante exacto de la llamada, a diferencia de esas dos RPC).';

-- ---------------------------------------------------------------------------------------------
-- 4. close_assignment(p_assignment_id, p_reason, p_at?) -- 04 sección 6.2; 06 sección 10; P-069
-- ---------------------------------------------------------------------------------------------

-- Atajo semántico de admin_record_attendance(p_kind := 'check_out') para el "cierre manual" de
-- P-069 (asignación present sin fin, olvido del empleado o del administrador). Misma validación
-- de rango de p_at y mismas transiciones; se mantiene como función propia (no un alias de la de
-- arriba) porque 06 sección 10 la lista como una RPC con su propio nombre y mensaje de intención
-- ("cierre manual"), y porque el encargo pide sumarle p_at de forma independiente.
create function public.close_assignment(
  p_assignment_id uuid,
  p_reason text,
  p_at timestamptz default null
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

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

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

  v_at := coalesce(p_at, now());
  v_min_at := app.local_ts(v_shift.shift_date, '00:00'::time);

  if v_at < v_min_at or v_at > now() then
    raise exception using
      errcode = 'P0001',
      message = 'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if v_at <= v_check_in.recorded_at then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, source, recorded_by, reason
  )
  values (p_assignment_id, 'check_out', v_at, 'admin', auth.uid(), p_reason)
  returning * into v_record;

  update public.assignments
  set status = 'finished', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.complete_shift_if_done(v_shift.id);

  return v_record;
end;
$$;

comment on function public.close_assignment(uuid, text, timestamptz) is
  'Cierre manual de una asignación present sin fin (04 sección 6.2; 06 sección 10; P-069). O; A + manage_attendance. Motivo siempre obligatorio (REASON_REQUIRED). p_at opcional (por defecto now()), mismo rango que admin_record_attendance (AT_OUT_OF_RANGE) -- agregado por el encargo P14.1 sobre la firma original de 06 sección 10. NOT_CHECKED_IN si nunca empezó, ALREADY_CHECKED_OUT si ya tiene fin, INVALID_TIME_RANGE si la hora de fin no es posterior al inicio registrado. Inserta check_out con source = admin; turno -> completed si corresponde.';

-- ---------------------------------------------------------------------------------------------
-- 5. v_assignments_board (create or replace, columnas nuevas al final) --------------------------
-- ---------------------------------------------------------------------------------------------

-- Se agrega, al final de las columnas de 0011: origen y responsable de inicio/fin (source,
-- recorded_by de attendance_records) y el último aviso de la asignación (attendance_notices,
-- el de created_at más reciente) -- para ADM-10/ADM-11/ADM-06 (P14.3) y el tablero, sin repetir
-- columnas ya existentes ni cambiar su orden (Postgres exige que create or replace view conserve
-- las columnas existentes en el mismo orden y con el mismo tipo).
create or replace view public.v_assignments_board
with (security_invoker = true)
as
select
  a.id,
  a.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  a.employee_id,
  p.first_name as employee_first_name,
  p.last_name as employee_last_name,
  p.avatar_path as employee_avatar_path,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  case
    when ci.recorded_at is not null and ci.recorded_at > lower(a."window")
      then round(extract(epoch from (ci.recorded_at - lower(a."window"))) / 60)::int
    else null
  end as minutes_late,
  case
    when co.recorded_at is not null and co.recorded_at < upper(a."window")
      then round(extract(epoch from (upper(a."window") - co.recorded_at)) / 60)::int
    else null
  end as minutes_early_leave,
  case
    when a.status in ('expected', 'delay_notified') and now() > lower(a."window")
      then 'no_record'
    else a.status::text
  end as display_status,
  a.removed_at,
  a.removed_by,
  a.removed_reason,
  a.created_at,
  a.updated_at,
  a.created_by,
  a.updated_by,
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
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source, an.created_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true;

comment on view public.v_assignments_board is
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status agrega no_record (P-071); minutes_early_leave (P-076) y minutes_late (simetría, decisión menor) comparan contra la franja efectiva (assignments."window"). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027): origen y responsable de cada registro (employee_app/auth.uid() propio, o admin/quien lo cargó en nombre, P-075). last_notice_*: último aviso de la asignación (attendance_notices más reciente por created_at), null si nunca avisó nada. Incluye asignaciones quitadas (removed_at not null): la fila queda para historia (04 sección 2.3). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 6. v_my_day (create or replace, columnas nuevas al final) -------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Mismo criterio que el punto anterior: se agregan site_city/site_latitude/site_longitude
-- (pendiente anotado desde P13.2), el origen de inicio/fin y el último aviso propio, para que
-- EMP-03/EMP-04 (P14.2, "Avisaste demora de 15 min") no necesiten una segunda consulta.
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
    greatest(coalesce(a.updated_at, a.created_at), coalesce(sh.updated_at, sh.created_at))
    > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
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
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. changed_since_last_seen compara el último cambio de la asignación/turno contra profiles.last_seen_changes_at (P-092); is_today distingue el bloque "hoy en detalle" de la lista simple de próximos días (P-093). check_in_at/check_out_at (0026, ATT-003) son la hora registrada de inicio y fin, si existen. site_city/site_latitude/site_longitude (0027, pendiente de P13.2): datos de la sede para mostrar mapa/ciudad sin una segunda consulta. check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by y last_notice_* (0027): origen del registro y último aviso propio, para "Avisaste demora de 15 min" (P14.2). Filtra employee_id = auth.uid() en la definición (no solo por RLS): es la vista de "mi día", no la de compañeros. security_invoker: además queda sujeta a la RLS de assignments/shifts/attendance_records/attendance_notices (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 7. Grants: execute a authenticated, revocado de public/anon (mismo patrón que 0023/0024/0025/0026)
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.notify_delay(uuid, integer, text) from public, anon;
grant execute on function public.notify_delay(uuid, integer, text) to authenticated;

revoke execute on function public.notify_absence(uuid, public.absence_reason, text) from public, anon;
grant execute on function public.notify_absence(uuid, public.absence_reason, text) to authenticated;

revoke execute on function public.admin_record_attendance(uuid, public.attendance_kind, timestamptz, text) from public, anon;
grant execute on function public.admin_record_attendance(uuid, public.attendance_kind, timestamptz, text) to authenticated;

revoke execute on function public.close_assignment(uuid, text, timestamptz) from public, anon;
grant execute on function public.close_assignment(uuid, text, timestamptz) to authenticated;
