-- SUP-002 a SUP-006 (08_Fases_y_Backlog.md, F15 · Supervisiones, P15.1)
--
-- Las siete RPC de supervisión y calificación de 04_Modelo_de_Datos.md sección 9 y 06_API.md
-- secciones 12 y 13, más la versión completa de `v_supervisions_admin`/`v_my_supervisions`
-- (SUP-006, completa lo que faltaba de DB-013 para ADM-13, ADM-15, SUP-02, SUP-03, SUP-07,
-- SUP-08 de `05_Pantallas_y_Navegacion.md`). Mismo patrón que `0023` a `0027`: `security definer`,
-- `set search_path = public, app, pg_temp`, `app.require_role`/`app.require_capability` (o su
-- rama manual cuando el permiso depende de la fila, mismo criterio que `set_assignment_notes`,
-- `0026`), transacción única, error `P0001` con mensaje en voseo y `hint` estable.
--
-- Contenido, en orden:
--   1. `assign_supervision(p_shift_id, p_supervisor_id)`.
--   2. `cancel_supervision(p_supervision_id, p_reason)`.
--   3. `supervision_check_in(p_supervision_id, p_lat?, p_lng?, p_accuracy?)`.
--   4. `supervision_check_out(p_supervision_id, p_lat?, p_lng?, p_accuracy?)`.
--   5. `complete_supervision(p_supervision_id, p_general_notes?)`.
--   6. `mark_supervision_not_done(p_supervision_id, p_reason)`.
--   7. `rate_employee(p_supervision_id, p_assignment_id, p_score, p_comment?)`.
--   8. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que las migraciones
--      anteriores de RPC.
--   9. `v_supervisions_admin`/`v_my_supervisions` (`create or replace`, columnas nuevas al final):
--      franja del turno, `criteria_snapshot`, cantidad de empleados asignados (ADM-13: "calificaciones
--      cargadas / empleados") y, para el supervisor, los datos de sede que le faltaban a SUP-03
--      (contacto, instrucciones de acceso, restricciones, coordenadas) y el inicio real de cada
--      empleado asignado dentro de `assigned_employees`.
--
-- Ratificado por Mike el 27 sep 2026 (P15.0, `02_Decisiones.md`):
--   - P-083: el supervisor crea y edita su calificación mientras la supervisión esté
--     `in_progress` o `completed` y `now() <= greatest(fin previsto del turno, fin registrado de
--     la supervisión)`. Fuera de plazo: `RATING_WINDOW_CLOSED`. Dueño y administrador con
--     `edit_ratings` editan siempre (sin ventana).
--   - `assign_supervision`: si el supervisor también está asignado como empleado (asignación no
--     quitada) en ese turno, advertencia `SUPERVISES_OWN_SHIFT` que NO bloquea (mismo patrón que
--     `NOT_ENABLED_FOR_CLIENT`/`OUTSIDE_AVAILABILITY`/`ON_LEAVE` de `assign_employee`, 0024:
--     `jsonb_build_object('supervision', ..., 'warnings', ...)`).
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - `SHIFT_NOT_SUPERVISABLE` (código de 06 sección 12, sin texto propio ahí): turno cancelado o
--     completado al asignar una supervisión -- mismo criterio que `SHIFT_NOT_EDITABLE` para
--     `shifts` (06 sección 15), pero para el estado del TURNO en el contexto de supervisión.
--   - `SUPERVISION_NOT_FOUND` (código nuevo, no está en 06 sección 15 ni 12): mismo criterio que
--     `SHIFT_NOT_FOUND`/`ASSIGNMENT_NOT_FOUND` para "esa fila no existe" -- 06 sección 12 solo
--     acuñó `NOT_YOUR_SUPERVISION` para "existe pero no es tuya", faltaba el código simétrico para
--     "no existe".
--   - `SUPERVISION_NOT_EDITABLE` (código nuevo, no está en 06 sección 15 ni 12): guarda genérica
--     de "esta supervisión no admite ese cambio en su estado actual" -- mismo criterio que
--     `SHIFT_NOT_EDITABLE`, aplicado a `cancel_supervision`, `mark_supervision_not_done` (fuera de
--     `assigned`/`in_progress`) y a `supervision_check_in`/`supervision_check_out` cuando la
--     supervisión está `not_done`/`cancelled` (o, para el fin, ya `completed`).
--   - `ALREADY_STARTED` (código de 06 sección 12, sin texto propio ahí): se usa en
--     `supervision_check_in` cuando la supervisión ya está `in_progress` o `completed` -- mismo
--     papel que `ALREADY_CHECKED_IN` en `record_check_in` (0026), pero sobre `supervisions.status`
--     en vez de la existencia de una fila, porque acá el estado ya es la fuente de verdad (el
--     `check_in` de la supervisión siempre inserta la fila de `supervision_attendance` y mueve el
--     estado en la misma transacción, así que nunca quedan desincronizados).
--   - `NOT_STARTED` (código de 06 sección 12, sin texto propio ahí): `supervisión.status =
--     'assigned'` al intentar `supervision_check_out` o `complete_supervision` -- "todavía no
--     registraste el inicio", mismo mensaje que `NOT_CHECKED_IN` de asistencia pero con su propio
--     código porque 06 sección 12 ya lo lista.
--   - `ALREADY_ASSIGNED` (reutilizado de 06 sección 15, dominio de `assignments`): traduce el
--     `unique_violation` de `supervisions_shift_id_supervisor_id_key` (0010) cuando el supervisor
--     ya tiene una supervisión no cancelada de ese turno -- 06 sección 12 no acuña un código
--     propio para este choque; se reutiliza el existente en vez de inventar uno nuevo porque el
--     significado es idéntico ("esa persona ya está asignada a esto").
--   - `CANCEL_REASON_REQUIRED`/`REASON_REQUIRED` (reutilizados de 06 sección 15): mismo criterio
--     que `cancel_shift` (`CANCEL_REASON_REQUIRED`, 0023) y `remove_assignment`/`notify_absence`
--     (`REASON_REQUIRED`, 0024/0027) -- `cancel_supervision` usa el primero (motivo de
--     cancelación), `mark_supervision_not_done` el segundo (motivo de no realizada), mismo patrón
--     que el modelo distingue `cancel_reason` de `not_done_reason` en la tabla (0010).
--   - `SELF_RATING_NOT_ALLOWED` (código nuevo, PROPUESTO -- ver la pregunta al final del reporte
--     de la tarea): CB-14 de `08_Fases_y_Backlog.md` ("Supervisor asignado a un turno donde
--     también trabaja como empleado", fila CB-13) pide que `rate_employee` rechace calificar la
--     propia asignación (`assignment.employee_id = supervisor_id`) cuando el supervisor también
--     figura como empleado del mismo turno (P-042, doble función) -- la fila del backlog lo marca
--     "PROPUESTO", no "CONFIRMADO" como el resto de las reglas de esta fase; se implementa igual
--     porque ya trae el detalle de implementación exacto ("RPC rechaza
--     assignment.employee_id = supervisor_id") y dejarlo sin cubrir deja un caso de conflicto de
--     interés documentado sin resolver, pero se anota como pregunta para que Mike lo confirme o lo
--     descarte.
--   - `mark_supervision_not_done` no exige ninguna capacidad para O/A (06 sección 12: "S (propia);
--     O, A", sin capacidad después de la coma, a diferencia de `assign_supervision`/
--     `cancel_supervision` que sí piden `manage_supervisions`) -- mismo criterio que
--     `set_assignment_notes` (0026), que tampoco exige capacidad para el owner/admin en su propia
--     rama de permisos.
--   - `rate_employee` recibe `p_score` como `integer`, no como `smallint` (tipo de
--     `ratings.score`, 0010): PostgREST/`supabase-js` mandan los números del cliente como
--     `integer` y Postgres no resuelve la sobrecarga contra un parámetro `smallint` sin un `cast`
--     explícito del lado del llamador (probado contra `App_dev`: `rate_employee(uuid, uuid, 4)`
--     fallaba con "function ... does not exist" porque el literal `4` es `integer`). El `insert`
--     hace el `cast` de asignación a `smallint` solo, sin que la firma de la función lo necesite.
--   - El upsert de `rate_employee` no fija `updated_by` en el `insert` inicial, solo en la rama
--     `on conflict do update` (mismo criterio que el resto del proyecto: `updated_by` refleja "la
--     última persona que TOCÓ una fila ya existente", nunca quien la creó -- ver `assign_employee`,
--     0024, que tampoco fija `updated_by` en su `insert`).
--   - `supervision_check_in` calcula `criteria_snapshot` con los `rating_criteria` vigentes HOY
--     (`valid_from <= app.today() and (valid_to is null or valid_to >= app.today())`, 04 sección
--     2.5, P-087), ordenados por `position`, como un arreglo de objetos `{id, title, description,
--     position}` -- el modelo no especifica la forma exacta del `jsonb`, es una decisión de
--     implementación (documentada también en el reporte de la tarea).
--
-- Revisión de la propia tarea antes de aplicar:
--   - Las siete RPC bloquean la fila de `supervisions` (o de `shifts`, en `assign_supervision`)
--     con `for update` antes de decidir la transición, mismo criterio de concurrencia que
--     `0023`/`0024`/`0026`.
--   - `cancel_shift` (0023) ya cancela en cascada las supervisiones `assigned`/`in_progress` de un
--     turno cancelado: si alguien intenta `supervision_check_in`/`cancel_supervision`/etc. sobre
--     una supervisión que quedó `cancelled` por esa cascada, cae en `SUPERVISION_NOT_EDITABLE` (o,
--     en `assign_supervision`, en `ALREADY_ASSIGNED` si se reintenta asignar sobre el mismo par
--     antes de que se libere -- la cascada de `cancel_shift` sí cancela la supervisión, liberando
--     el índice único parcial para una nueva).

-- ---------------------------------------------------------------------------------------------
-- 1. assign_supervision(p_shift_id, p_supervisor_id) -- 04 sección 6.4, 9; 06 sección 12; P-078,
--    P-079, P-086; SUPERVISES_OWN_SHIFT ratificada el 27 sep 2026 (P15.0)
-- ---------------------------------------------------------------------------------------------

create function public.assign_supervision(p_shift_id uuid, p_supervisor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_supervision public.supervisions;
  v_warnings text[] := array[]::text[];
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

  -- Supervisor con rol vigente (user_roles, no el JWT del que llama) y activo: perfil sin
  -- desactivar/dar de baja, y fila de employees activa y sin baja lógica (04 sección 2.1: los
  -- roles employee/supervisor exigen fila en employees).
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
      message = 'Ese supervisor no tiene el rol vigente o no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  begin
    insert into public.supervisions (shift_id, supervisor_id, assigned_by, created_by)
    values (p_shift_id, p_supervisor_id, auth.uid(), auth.uid())
    returning * into v_supervision;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese supervisor ya tiene una supervisión asignada a este turno.',
        hint = 'ALREADY_ASSIGNED';
  end;

  -- Advertencia (no bloquea, CONFIRMADO 27 sep 2026 P15.0): el supervisor también está asignado
  -- como empleado (asignación no quitada) en este mismo turno.
  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = p_supervisor_id and a.removed_at is null
  ) then
    v_warnings := array_append(v_warnings, 'SUPERVISES_OWN_SHIFT');
  end if;

  return jsonb_build_object('supervision', to_jsonb(v_supervision), 'warnings', v_warnings);
end;
$$;

comment on function public.assign_supervision(uuid, uuid) is
  'Asigna un supervisor a un turno (04 sección 6.4, 9; 06 sección 12; P-078, P-079). O, A + manage_supervisions. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado o completado), SUPERVISOR_ROLE_REQUIRED (rol vigente y activo), ALREADY_ASSIGNED (unique_violation de supervisions_shift_id_supervisor_id_key, 0010). Devuelve {"supervision": <fila>, "warnings": [...]} con SUPERVISES_OWN_SHIFT si el supervisor también está asignado como empleado en ese turno -- no bloquea (ratificado 27 sep 2026, P15.0).';

-- ---------------------------------------------------------------------------------------------
-- 2. cancel_supervision(p_supervision_id, p_reason) -- 04 sección 6.4, 9; 06 sección 12
-- ---------------------------------------------------------------------------------------------

create function public.cancel_supervision(p_supervision_id uuid, p_reason text)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
begin
  perform app.require_capability('manage_supervisions');

  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_supervision.status not in ('assigned', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'CANCEL_REASON_REQUIRED';
  end if;

  update public.supervisions
  set status = 'cancelled', cancel_reason = p_reason, updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  return v_supervision;
end;
$$;

comment on function public.cancel_supervision(uuid, text) is
  'Cancela una supervisión assigned/in_progress con motivo obligatorio (04 sección 6.4, 9; 06 sección 12). O, A + manage_supervisions. SUPERVISION_NOT_FOUND, SUPERVISION_NOT_EDITABLE (ya completed/not_done/cancelled), CANCEL_REASON_REQUIRED sin motivo.';

-- ---------------------------------------------------------------------------------------------
-- 3. supervision_check_in(p_supervision_id, p_lat?, p_lng?, p_accuracy?) -- 04 sección 6.4, 9,
--    2.5 (criteria_snapshot, P-087); 06 sección 12; ADR-009
-- ---------------------------------------------------------------------------------------------

create function public.supervision_check_in(
  p_supervision_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns public.supervision_attendance
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_shift public.shifts;
  v_criteria jsonb;
  v_record public.supervision_attendance;
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

  if v_supervision.status in ('in_progress', 'completed') then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el inicio de esta supervisión.',
      hint = 'ALREADY_STARTED';
  end if;

  if v_supervision.status in ('not_done', 'cancelled') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  select * into v_shift from public.shifts where id = v_supervision.shift_id;

  -- Fecha del turno = hoy, mismo criterio que record_check_in (P-068, 0026).
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

  -- criteria_snapshot (P-087): criterios de rating_criteria vigentes hoy, ordenados por position.
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

  insert into public.supervision_attendance (supervision_id, kind, recorded_at, latitude, longitude, accuracy_m)
  values (p_supervision_id, 'check_in', now(), p_lat, p_lng, p_accuracy)
  returning * into v_record;

  update public.supervisions
  set status = 'in_progress', criteria_snapshot = v_criteria, updated_by = auth.uid()
  where id = p_supervision_id;

  return v_record;
end;
$$;

comment on function public.supervision_check_in(uuid, numeric, numeric, numeric) is
  'Registra el inicio de una supervisión con la hora del servidor (04 sección 6.4; 06 sección 12; P-041, P-085, P-087). S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, ALREADY_STARTED (in_progress/completed), SUPERVISION_NOT_EDITABLE (not_done/cancelled), NOT_TODAY, COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE (ADR-009). Supervisión -> in_progress, guarda criteria_snapshot con los rating_criteria vigentes hoy.';

-- ---------------------------------------------------------------------------------------------
-- 4. supervision_check_out(p_supervision_id, p_lat?, p_lng?, p_accuracy?) -- 04 sección 6.4, 9;
--    06 sección 12; ADR-009
-- ---------------------------------------------------------------------------------------------

create function public.supervision_check_out(
  p_supervision_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns public.supervision_attendance
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_record public.supervision_attendance;
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

  if exists (
    select 1 from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out'
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

  insert into public.supervision_attendance (supervision_id, kind, recorded_at, latitude, longitude, accuracy_m)
  values (p_supervision_id, 'check_out', now(), p_lat, p_lng, p_accuracy)
  returning * into v_record;

  return v_record;
end;
$$;

comment on function public.supervision_check_out(uuid, numeric, numeric, numeric) is
  'Registra el fin de una supervisión con la hora del servidor (04 sección 6.4; 06 sección 12). S (propia). Requiere inicio (NOT_STARTED si status = assigned; SUPERVISION_NOT_EDITABLE si not_done/cancelled/completed). ALREADY_CHECKED_OUT si ya tiene fin. COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE (ADR-009). No cambia supervisions.status (la transición a completed la hace complete_supervision).';

-- ---------------------------------------------------------------------------------------------
-- 5. complete_supervision(p_supervision_id, p_general_notes?) -- 04 sección 6.4, 9; 06 sección 12
-- ---------------------------------------------------------------------------------------------

create function public.complete_supervision(p_supervision_id uuid, p_general_notes text default null)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
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

  -- Requiere fin registrado (04 sección 6.4: "Requiere fin registrado (supervision_check_out)").
  -- Se permite completar sin calificar a todos; la pantalla lo advierte (04 sección 6.4), así que
  -- acá no se verifica cuántas ratings hay.
  if not exists (
    select 1 from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Registrá primero el fin de la supervisión.',
      hint = 'CHECK_OUT_REQUIRED';
  end if;

  update public.supervisions
  set status = 'completed', general_notes = nullif(btrim(p_general_notes), ''), updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  return v_supervision;
end;
$$;

comment on function public.complete_supervision(uuid, text) is
  'Completa una supervisión in_progress con fin ya registrado (04 sección 6.4; 06 sección 12). S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, NOT_STARTED (status = assigned), SUPERVISION_NOT_EDITABLE (not_done/cancelled/completed), CHECK_OUT_REQUIRED sin fin registrado. Se permite completar sin calificar a todos los empleados del turno (la pantalla lo advierte). Texto vacío o solo espacios de general_notes se guarda como null.';

-- ---------------------------------------------------------------------------------------------
-- 6. mark_supervision_not_done(p_supervision_id, p_reason) -- 04 sección 6.4, 9; 06 sección 12
-- ---------------------------------------------------------------------------------------------

create function public.mark_supervision_not_done(p_supervision_id uuid, p_reason text)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
begin
  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  -- 06 sección 12: "S (propia); O, A" -- sin capacidad adicional para O/A (a diferencia de
  -- assign_supervision/cancel_supervision, que sí piden manage_supervisions), mismo criterio que
  -- set_assignment_notes (0026) para su rama de owner/admin.
  if app.is_admin() then
    null;
  elsif app.has_role('supervisor') and v_supervision.supervisor_id = auth.uid() then
    null;
  elsif app.has_role('supervisor') then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión no es tuya.',
      hint = 'NOT_YOUR_SUPERVISION';
  else
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  if v_supervision.status not in ('assigned', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  update public.supervisions
  set status = 'not_done', not_done_reason = p_reason, updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  return v_supervision;
end;
$$;

comment on function public.mark_supervision_not_done(uuid, text) is
  'Marca una supervisión assigned/in_progress como no realizada, con motivo obligatorio (04 sección 6.4; 06 sección 12). S (propia, NOT_YOUR_SUPERVISION si es de otro supervisor); O, A (sin capacidad adicional); cualquier otro caso: FORBIDDEN. SUPERVISION_NOT_FOUND, SUPERVISION_NOT_EDITABLE (ya completed/not_done/cancelled), REASON_REQUIRED sin motivo.';

-- ---------------------------------------------------------------------------------------------
-- 7. rate_employee(p_supervision_id, p_assignment_id, p_score, p_comment?) -- 04 sección 2.5, 6.4,
--    9; 06 sección 13; P-080, P-081, P-083, P-084; ventana ratificada el 27 sep 2026 (P15.0);
--    autocalificación PROPUESTA (CB-13, 08_Fases_y_Backlog.md)
-- ---------------------------------------------------------------------------------------------

create function public.rate_employee(
  p_supervision_id uuid,
  p_assignment_id uuid,
  p_score integer,
  p_comment text default null
)
returns public.ratings
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_assignment public.assignments;
  v_shift public.shifts;
  v_checkout_at timestamptz;
  v_can_always boolean;
  v_rating public.ratings;
begin
  -- Owner siempre, admin solo con edit_ratings (app.has_capability ya devuelve true para el
  -- owner sin mirar admin_capabilities, 04 sección 5): fuera de esta condición, solo entra el
  -- supervisor de la propia supervisión, dentro del plazo de P-083.
  v_can_always := app.has_capability('edit_ratings');

  select * into v_supervision from public.supervisions where id = p_supervision_id;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if not v_can_always then
    if app.has_role('supervisor') and v_supervision.supervisor_id = auth.uid() then
      null;
    elsif app.has_role('supervisor') then
      raise exception using
        errcode = 'P0001',
        message = 'Esa supervisión no es tuya.',
        hint = 'NOT_YOUR_SUPERVISION';
    else
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
  end if;

  if v_supervision.status not in ('in_progress', 'completed') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no está en curso ni completada.',
      hint = 'SUPERVISION_NOT_ACTIVE';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- 04 sección 2.5: "La asignación debe pertenecer al turno de la supervisión y no estar
  -- quitada" -- un solo código para las dos condiciones (06 sección 13 acuña ASSIGNMENT_NOT_IN_SHIFT
  -- sin distinguir).
  if v_assignment.shift_id <> v_supervision.shift_id or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no pertenece al turno de esta supervisión.',
      hint = 'ASSIGNMENT_NOT_IN_SHIFT';
  end if;

  -- CB-13 (08_Fases_y_Backlog.md, PROPUESTO): el supervisor no puede calificar su propia
  -- asignación cuando también trabaja como empleado del mismo turno (P-042).
  if v_assignment.employee_id = v_supervision.supervisor_id then
    raise exception using
      errcode = 'P0001',
      message = 'No podés calificarte a vos mismo.',
      hint = 'SELF_RATING_NOT_ALLOWED';
  end if;

  if p_score < 1 or p_score > 5 then
    raise exception using
      errcode = 'P0001',
      message = 'El puntaje tiene que ser entre 1 y 5.',
      hint = 'SCORE_OUT_OF_RANGE';
  end if;

  -- Ventana de edición (P-083, ratificada 27 sep 2026 P15.0): solo para la rama del supervisor
  -- (owner/admin con edit_ratings editan siempre, sin este chequeo).
  if not v_can_always then
    select * into v_shift from public.shifts where id = v_supervision.shift_id;

    select sa.recorded_at into v_checkout_at
    from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out';

    if now() > greatest(v_shift.ends_at, coalesce(v_checkout_at, '-infinity'::timestamptz)) then
      raise exception using
        errcode = 'P0001',
        message = 'El plazo para editar esta calificación terminó.',
        hint = 'RATING_WINDOW_CLOSED';
    end if;
  end if;

  insert into public.ratings (supervision_id, assignment_id, score, comment, created_by)
  values (p_supervision_id, p_assignment_id, p_score, nullif(btrim(p_comment), ''), auth.uid())
  on conflict (supervision_id, assignment_id) do update
    set score = excluded.score, comment = excluded.comment, updated_by = auth.uid()
  returning * into v_rating;

  return v_rating;
end;
$$;

comment on function public.rate_employee(uuid, uuid, integer, text) is
  'Upsert de la calificación de un empleado (04 sección 2.5, 6.4, 9; 06 sección 13; P-080, P-081). S (propia, dentro del plazo de P-083); O, A + edit_ratings (siempre, sin ventana). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, FORBIDDEN, SUPERVISION_NOT_ACTIVE (ni in_progress ni completed), ASSIGNMENT_NOT_FOUND, ASSIGNMENT_NOT_IN_SHIFT (de otro turno o quitada), SELF_RATING_NOT_ALLOWED (CB-13, PROPUESTO), SCORE_OUT_OF_RANGE, RATING_WINDOW_CLOSED (now() > greatest(fin previsto del turno, fin registrado de la supervisión), solo para el supervisor). El empleado no ve esta tabla por ninguna vía (P-084, RLS de 0012).';

-- ---------------------------------------------------------------------------------------------
-- 8. Grants: execute a authenticated, revocado de public/anon (mismo patrón que 0023 a 0027) -----
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.assign_supervision(uuid, uuid) from public, anon;
grant execute on function public.assign_supervision(uuid, uuid) to authenticated;

revoke execute on function public.cancel_supervision(uuid, text) from public, anon;
grant execute on function public.cancel_supervision(uuid, text) to authenticated;

revoke execute on function public.supervision_check_in(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.supervision_check_in(uuid, numeric, numeric, numeric) to authenticated;

revoke execute on function public.supervision_check_out(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.supervision_check_out(uuid, numeric, numeric, numeric) to authenticated;

revoke execute on function public.complete_supervision(uuid, text) from public, anon;
grant execute on function public.complete_supervision(uuid, text) to authenticated;

revoke execute on function public.mark_supervision_not_done(uuid, text) from public, anon;
grant execute on function public.mark_supervision_not_done(uuid, text) to authenticated;

revoke execute on function public.rate_employee(uuid, uuid, integer, text) from public, anon;
grant execute on function public.rate_employee(uuid, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. v_supervisions_admin / v_my_supervisions (04 sección 4, SUP-006: completa DB-013 para
--    ADM-13, ADM-15, SUP-02, SUP-03, SUP-07, SUP-08 de 05_Pantallas_y_Navegacion.md) -------------
-- ---------------------------------------------------------------------------------------------

-- `create or replace view`: conserva las columnas existentes en el mismo orden y tipo (0011 ya
-- está aplicada); las columnas nuevas van al final.
--   - start_time/end_time/starts_at/ends_at: franja del turno (ADM-13: "turno (cliente, sede,
--     franja)", que la versión de 0011 no traía).
--   - criteria_snapshot: ADM-15 ("criterios usados").
--   - assigned_employees_count: ADM-13 ("calificaciones cargadas / empleados", junto con el
--     ratings_count que ya existía).
create or replace view public.v_supervisions_admin
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  sv.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  sv.status,
  sv.assigned_by,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(r.ratings_count, 0) as ratings_count,
  r.ratings_avg,
  sv.created_at,
  sv.updated_at,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.criteria_snapshot,
  coalesce(emp.assigned_employees_count, 0) as assigned_employees_count
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = sv.supervisor_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select count(*) as ratings_count, avg(rt.score)::numeric(3, 2) as ratings_avg
  from public.ratings rt
  where rt.supervision_id = sv.id
) r on true
left join lateral (
  select count(*) as assigned_employees_count
  from public.assignments a
  where a.shift_id = sv.shift_id and a.removed_at is null
) emp on true;

comment on view public.v_supervisions_admin is
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). ratings_count/ratings_avg: cantidad y promedio simple del turno (los promedios por empleado son módulo F). start_time/end_time/starts_at/ends_at: franja del turno (0029, SUP-006, ADM-13). criteria_snapshot: criterios vigentes al iniciar (ADM-15). assigned_employees_count: empleados asignados vigentes del turno, para "calificaciones cargadas / empleados" (ADM-13, 0029). security_invoker: visibilidad de filas por RLS de supervisions/shifts/clients/sites/profiles (0012) -- en la práctica solo O/A ven filas.';

-- v_my_supervisions: columnas nuevas al final para SUP-03 (contacto de la sede, instrucciones de
-- acceso, restricciones, coordenadas -- 0007/0026 ya agregaban un subconjunto parecido a
-- v_my_day) y assigned_employees ahora incluye check_in_at por empleado ("e inicio real",
-- SUP-03). check_in_at/check_out_at de la propia supervisión (columnas ya existentes) no cambian.
create or replace view public.v_my_supervisions
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.status,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  sv.criteria_snapshot,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(emp.employees, '[]'::jsonb) as assigned_employees,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions as site_access_instructions,
  si.building_hours as site_building_hours,
  si.phone_restricted as site_phone_restricted,
  si.photos_not_allowed as site_photos_not_allowed,
  si.restrictions_notes as site_restrictions_notes
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select jsonb_agg(
      jsonb_build_object(
        'employee_id', a.employee_id,
        'first_name', p2.first_name,
        'last_name', p2.last_name,
        'status', a.status,
        'check_in_at', ar.recorded_at
      )
      order by p2.last_name, p2.first_name
    ) as employees
  from public.assignments a
  join public.profiles p2 on p2.id = a.employee_id
  left join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
  where a.shift_id = sv.shift_id
    and a.removed_at is null
) emp on true
where sv.supervisor_id = auth.uid();

comment on view public.v_my_supervisions is
  'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", agregado en 0029 para SUP-03). site_city/site_latitude/site_longitude/site_contact_name/site_contact_phone/site_access_instructions/site_building_hours/site_phone_restricted/site_photos_not_allowed/site_restrictions_notes (0029, SUP-006): dirección con enlace a mapas, contacto de la sede, instrucciones de acceso y restricciones que pedía SUP-03 y no traía la versión inicial de 0011. security_invoker: además queda sujeta a la RLS de supervisions/shifts (0012).';
