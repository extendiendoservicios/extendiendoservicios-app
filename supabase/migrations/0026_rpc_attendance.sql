-- ATT-001, ATT-002 (08_Fases_y_Backlog.md, F13 · App del empleado, P13.1): las RPC de asistencia
-- que faltaban de 04_Modelo_de_Datos.md sección 9 y 06_API.md sección 8 y 10 -- `record_check_in`,
-- `record_check_out` y `set_assignment_notes`. Las RPC de avisos y de asistencia administrativa
-- (`notify_delay`, `notify_absence`, `admin_record_attendance`, `close_assignment`) son F14, no
-- este archivo.
--
-- Mismo patrón que `0023_rpc_shifts.sql`/`0024_rpc_assignments.sql`/`0025_rpc_tasks.sql`:
-- `security definer`, `set search_path = public, app, pg_temp`, verificación de rol/pertenencia
-- primero, transacción única, error `P0001` con mensaje en voseo y `hint` estable.
--
-- Contenido, en orden:
--   1. `record_check_in(p_assignment_id, p_lat?, p_lng?, p_accuracy?)` (04 sección 6.1, 6.2;
--      06 sección 10; P-065 a P-068, ADR-009).
--   2. `record_check_out(p_assignment_id, p_lat?, p_lng?, p_accuracy?)` (ídem; P-069, P-070).
--   3. `set_assignment_notes(p_assignment_id, p_notes)` (04 sección 2.3; 06 sección 8; P-062,
--      P-063). Reemplaza el mecanismo de escritura directa por PostgREST que había dejado
--      preparado `0012_rls_policies.sql`/`0017_grants.sql` (política `assignments_update_own_notes`
--      y `grant update (notes)`) -- ver la nota de la sección 3 más abajo.
--   4. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que las migraciones
--      anteriores de RPC.
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - Coordenadas (P-067, ADR-009): "todas o ninguna" -- si se manda alguna de las tres
--     (`p_lat`/`p_lng`/`p_accuracy`) sin las otras dos, se rechaza con un código nuevo,
--     `COORDINATES_INCOMPLETE` (no está en `06` sección 15: la app pide el permiso una sola vez y
--     manda las tres juntas o ninguna, así que un pedido parcial es un error del cliente, no una
--     situación real de uso). Rangos válidos con otro código nuevo, `COORDINATES_OUT_OF_RANGE`:
--     latitud -90..90, longitud -180..180, precisión >= 0 -- mismos límites físicos que cualquier
--     GPS, el modelo no da un rango explícito para `attendance_records.latitude/longitude/
--     accuracy_m` (04 sección 2.3), solo el tipo (`numeric(9,6)`/`numeric(7,1)`).
--   - `NOT_YOUR_ASSIGNMENT` (código ya listado en `06` sección 10) se usa cuando la asignación
--     existe pero no es del empleado que llama; `ASSIGNMENT_NOT_FOUND` (código de `06` sección 8,
--     reutilizado acá porque `06` sección 10 no acuña uno propio) cuando no existe o fue quitada
--     (`removed_at is not null`) -- mismo criterio de distinción que `assign_employee`/
--     `remove_assignment` (0024) entre "no existe" y "no es tuya".
--   - `SHIFT_COMPLETED` se agrega como guarda extra en `record_check_in` (no está en la lista de
--     verificaciones de `06` sección 10 para esta RPC, que solo pide "turno no cancelado"): un
--     turno pasa a `completed` únicamente cuando TODAS sus asignaciones vigentes ya están
--     `finished`/`absence_notified` (04 sección 6.1), así que en la práctica nunca debería quedar
--     una asignación en `expected`/`delay_notified`/`absence_notified` con el turno ya
--     `completed` -- se agrega la guarda igual, por defensa en profundidad y por simetría con el
--     resto de las RPC de este proyecto (todas verifican `SHIFT_CANCELLED`/`SHIFT_COMPLETED`
--     juntos), reutilizando el código existente.
--   - "Fecha del turno = hoy" (P-068, `NOT_TODAY`) se verifica SOLO en `record_check_in`, tal cual
--     `06` sección 10 lo redacta ("Verifica: ... fecha del turno = hoy (Argentina)" está en la fila
--     de `record_check_in`, no en la de `record_check_out`). Es a propósito y no un olvido del
--     encargo: P-069 dice "sin cierre automático a fin de día", así que una asignación que sigue
--     `present` puede cerrarse un día después de la fecha del turno (por ejemplo, un turno nocturno
--     que termina pasada la medianoche, o un empleado que se olvida de marcar la salida hasta el
--     otro día) -- exigir `NOT_TODAY` también en el fin reintroduciría por la ventana el cierre
--     forzado que P-069 rechaza explícitamente. `record_check_out` no compara `shift_date` contra
--     nada.
--   - "Fin posterior al inicio" (04 sección 6.2) no se verifica con una comparación explícita en
--     `record_check_out`: los dos instantes los pone `now()` del lado del servidor (P-066) en
--     momentos distintos de la misma sesión, así que el fin es, por construcción, posterior al
--     inicio salvo que el reloj del servidor retroceda entre una llamada y la otra -- un caso que
--     ninguna otra RPC de este proyecto contempla (Postgres no da esa garantía por contrato, pero
--     tampoco hay un código de dominio para ese escenario en `06` sección 15, y agregar una
--     comparación no cambiaría el resultado en la práctica).
--   - `set_assignment_notes`: mismo árbol de permisos que `update_task_status` (0025) -- admin
--     (owner o admin) siempre puede; empleado solo sobre su propia asignación vigente
--     (`removed_at is null`) y con el turno no `completed` (P-063: "Dueño y administrador pueden
--     editar en cualquier momento"); cualquier otro caso (supervisor incluido, `06` sección 8 no lo
--     lista) corta con `FORBIDDEN`. Empleado sobre una asignación ajena también corta con
--     `FORBIDDEN` (no con `NOT_YOUR_ASSIGNMENT`): a diferencia de `record_check_in`/
--     `record_check_out` (donde la propiedad de la asignación es la única condición de la RPC),
--     acá "no es tu asignación" y "sos un rol sin ningún permiso sobre esta RPC" son la misma rama
--     de la función (mismo criterio que `update_task_status`, que tampoco distingue "sin
--     asignación" de "con asignación ajena" -- las dos caen en `TASK_LOCKED`).
--   - Texto vacío o solo espacios se guarda como `null` (pedido explícito del encargo P13.1):
--     `nullif(btrim(p_notes), '')`, mismo criterio que `attendance_notices.reason_text`/
--     `shifts.notes` en el resto del proyecto (nunca se distingue "cadena vacía" de "sin dato").
--   - Largo máximo: 2000 caracteres, con un `check` en la tabla (defensa en profundidad, mismo
--     criterio que las restricciones de formato agregadas en `0016_hardening.sql`) y una
--     verificación previa en la RPC con un código nuevo, `NOTES_TOO_LONG` (no está en `06`
--     sección 15: el modelo pide "un campo de texto" sin acotar el largo, P-062; 2000 caracteres
--     es una decisión menor -- alcanza para una observación de un turno sin permitir un abuso del
--     campo, y es coherente con el resto de los campos de texto libre del proyecto, que tampoco
--     tienen tope hoy pero tampoco se usan para textos largos).
--   - Se reemplaza la escritura directa por PostgREST de `assignments.notes` que dejaron
--     preparadas `0012_rls_policies.sql` (política `assignments_update_own_notes`) y
--     `0017_grants.sql` (`grant update (notes) on public.assignments to authenticated`): en aquel
--     momento (P04.5/P07.1) `set_assignment_notes` todavía no existía como RPC (recién se decide
--     en `06` sección 8, y P-062 "por asignación" se ratifica hoy, P13.0) y la única vía "E: update
--     de notes propia" documentada era esa política. Con la RPC ya escrita, mantener las dos vías
--     abiertas dejaría que el frontend del empleado escribiera `assignments.notes` sin pasar por
--     `nullif`/el tope de 2000 caracteres, y sin darle a O/A ninguna forma de tocar esa columna
--     (la política vieja solo cubre `employee`) -- esta migración `drop`ea esa política y revoca
--     ese grant de columna, dejando `set_assignment_notes` como única vía de escritura, igual que
--     el resto de columnas de `assignments` (04 sección 7.2: "RPC" para todo lo demás de esta
--     tabla). Documentado también como pregunta resuelta en el reporte de la tarea, por si Mike
--     prefiere el criterio anterior.

-- ---------------------------------------------------------------------------------------------
-- 1. record_check_in(p_assignment_id, p_lat?, p_lng?, p_accuracy?) -- 04 sección 6.1, 6.2;
--    06 sección 10; P-065 a P-068, ADR-009
-- ---------------------------------------------------------------------------------------------

create function public.record_check_in(
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

  -- P-068: en cualquier momento del día del turno, hora de Argentina -- sin ventanas ni
  -- tolerancias.
  if v_shift.shift_date <> app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no es de hoy.',
      hint = 'NOT_TODAY';
  end if;

  -- Coordenadas: las tres o ninguna (P-067, ADR-009).
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

  -- Transición expected/delay_notified/absence_notified -> present (04 sección 6.2).
  update public.assignments
  set status = 'present', updated_by = auth.uid()
  where id = p_assignment_id;

  -- Transición scheduled/assigned -> in_progress, primer inicio del turno (04 sección 6.1).
  update public.shifts
  set status = 'in_progress'
  where id = v_shift.id and status in ('scheduled', 'assigned');

  return v_record;
end;
$$;

comment on function public.record_check_in(uuid, numeric, numeric, numeric) is
  'Registra el inicio de una asignación con la hora del servidor (04 sección 6.1, 6.2; 06 sección 10; P-065 a P-068). E (propia). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, SHIFT_COMPLETED, NOT_TODAY (fecha del turno distinta de hoy, Argentina), COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE (P-067, ADR-009), ALREADY_CHECKED_IN. Asignación -> present; turno -> in_progress si era scheduled/assigned.';

-- ---------------------------------------------------------------------------------------------
-- 2. record_check_out(p_assignment_id, p_lat?, p_lng?, p_accuracy?) -- 04 sección 6.1, 6.2;
--    06 sección 10; P-069, P-070
-- ---------------------------------------------------------------------------------------------

create function public.record_check_out(
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
  v_remaining_count int;
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

  -- Transición present -> finished (04 sección 6.2).
  update public.assignments
  set status = 'finished', updated_by = auth.uid()
  where id = p_assignment_id;

  -- Transición in_progress -> completed cuando TODAS las asignaciones vigentes del turno están
  -- finished o absence_notified (04 sección 6.1). Se cuenta después de la actualización de arriba,
  -- con el turno bloqueado (for update) para serializar contra otro check-out simultáneo de un
  -- compañero del mismo turno.
  select count(*) into v_remaining_count
  from public.assignments a
  where a.shift_id = v_shift.id
    and a.removed_at is null
    and a.status not in ('finished', 'absence_notified');

  if v_remaining_count = 0 then
    update public.shifts set status = 'completed' where id = v_shift.id;
  end if;

  return v_record;
end;
$$;

comment on function public.record_check_out(uuid, numeric, numeric, numeric) is
  'Registra el fin de una asignación con la hora del servidor (04 sección 6.1, 6.2; 06 sección 10; P-069, P-070). E (propia). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE. Sin NOT_TODAY (P-069: sin cierre automático a fin de día, el fin puede registrarse un día después de la fecha del turno). Asignación -> finished; turno -> completed si ya no queda ninguna asignación vigente sin finished/absence_notified.';

-- ---------------------------------------------------------------------------------------------
-- 3. set_assignment_notes(p_assignment_id, p_notes) -- 04 sección 2.3; 06 sección 8; P-062, P-063
-- ---------------------------------------------------------------------------------------------

-- Tope de largo (decisión menor, ver nota de arriba): 2000 caracteres. `check` en la tabla como
-- defensa en profundidad, además de la verificación previa en la RPC (mismo criterio que otras
-- restricciones agregadas después de crear la tabla, 0016_hardening.sql).
alter table public.assignments
  add constraint assignments_notes_length_check check (notes is null or char_length(notes) <= 2000);

comment on column public.assignments.notes is
  'Observación del servicio, una por asignación (P-062). null si está vacía; máximo 2000 caracteres (assignments_notes_length_check). Se escribe solo con set_assignment_notes (0026, ATT-002) -- reemplaza el mecanismo de escritura directa por PostgREST que había dejado preparado 0012/0017 (ver el comentario al principio de esta migración).';

-- Se retira el mecanismo de escritura directa por PostgREST que había dejado preparado
-- 0012_rls_policies.sql (la RPC set_assignment_notes es, de acá en más, la única vía de
-- escritura de esta columna -- ver la nota al principio de esta migración).
drop policy if exists assignments_update_own_notes on public.assignments;

-- Y el grant de columna correspondiente (0017_grants.sql).
revoke update (notes) on public.assignments from authenticated;

create function public.set_assignment_notes(p_assignment_id uuid, p_notes text)
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

  if app.is_admin() then
    -- Dueño y administrador editan siempre, en cualquier momento (P-063).
    null;
  elsif app.has_role('employee') then
    -- Empleado: solo su propia asignación vigente, mientras el turno no esté completed.
    if v_assignment.employee_id <> auth.uid() or v_assignment.removed_at is not null then
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

comment on function public.set_assignment_notes(uuid, text) is
  'Observación del servicio, una por asignación (04 sección 2.3; 06 sección 8; P-062). E: solo su propia asignación vigente y con el turno no completed (SHIFT_COMPLETED si no); O, A: siempre; cualquier otro caso (supervisor incluido, o empleado sobre una asignación ajena): FORBIDDEN. ASSIGNMENT_NOT_FOUND si no existe. Texto vacío o solo espacios se guarda como null; NOTES_TOO_LONG por encima de 2000 caracteres (decisión menor).';

-- ---------------------------------------------------------------------------------------------
-- 4. Grants: execute a authenticated, revocado de public/anon (mismo patrón que 0023/0024/0025)
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.record_check_in(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.record_check_in(uuid, numeric, numeric, numeric) to authenticated;

revoke execute on function public.record_check_out(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.record_check_out(uuid, numeric, numeric, numeric) to authenticated;

revoke execute on function public.set_assignment_notes(uuid, text) from public, anon;
grant execute on function public.set_assignment_notes(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. v_my_day (04 sección 4, ATT-003): agrega inicio y fin registrados -------------------------
-- ---------------------------------------------------------------------------------------------

-- `create or replace view` (0011_views.sql ya está aplicada): se agregan check_in_at/check_out_at
-- al final, mismas columnas que las de v_assignments_board (0011) para no repetir la lógica de
-- cálculo -- faltaban en la definición original porque, cuando se escribió 0011, todavía no
-- existían record_check_in/record_check_out (nacen recién en esta migración, F13). El resto de
-- las columnas queda idéntico a 0011 (Postgres exige que create or replace view conserve las
-- columnas existentes en el mismo orden y con el mismo tipo).
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
  co.recorded_at as check_out_at
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
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.status <> 'cancelled'
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. changed_since_last_seen compara el último cambio de la asignación/turno contra profiles.last_seen_changes_at (P-092); is_today distingue el bloque "hoy en detalle" de la lista simple de próximos días (P-093). check_in_at/check_out_at (0026, ATT-003) son la hora registrada de inicio y fin, si existen. Filtra employee_id = auth.uid() en la definición (no solo por RLS): es la vista de "mi día", no la de compañeros. security_invoker: además queda sujeta a la RLS de assignments/shifts (0012, DB-014).';
