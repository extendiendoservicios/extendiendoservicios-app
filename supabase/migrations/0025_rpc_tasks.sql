-- TASK-001 (08_Fases_y_Backlog.md, F12 · Checklists y tareas): las dos RPC de tareas que faltaban
-- de 04_Modelo_de_Datos.md sección 9 y 06_API.md sección 9 -- `clone_checklist_template` y
-- `update_task_status`. `create_shift`, `generate_shifts` y `reload_shift_tasks` (que copian y
-- recargan el checklist del turno) ya se escribieron en `0023_rpc_shifts.sql` (F10); este archivo
-- no las toca.
--
-- Mismo patrón que `0023_rpc_shifts.sql`/`0024_rpc_assignments.sql`: `security definer`,
-- `set search_path = public, app, pg_temp`, `app.require_role`/`app.require_capability` (o su
-- lógica equivalente cuando el permiso depende de datos, como en `update_task_status`) primero,
-- transacción única, error `P0001` con mensaje en voseo y `hint` estable.
--
-- Contenido, en orden:
--   1. `clone_checklist_template(p_client_id, p_site_id)`: crea la plantilla propia de la sede
--      copiando los ítems de la del cliente (P-058).
--   2. `update_task_status(p_task_id, p_status, p_reason?)`: cambia el estado de una tarea del
--      turno (04 sección 6.3).
--   3. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que `0023`/`0024`.
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - Permiso de `clone_checklist_template`: "O; A + edit_checklists" (06 sección 9) es exactamente
--     `app.require_capability('edit_checklists')` (el owner siempre tiene todas las capacidades,
--     `app.has_capability`, 0003/0020) -- mismo criterio que `reload_shift_tasks` (0023).
--   - `CLIENT_NOT_ACTIVE`/`SITE_NOT_ACTIVE` (códigos ya existentes, 06 sección 15) se reutilizan
--     para "el cliente no existe o no está activo" y "la sede no existe, no está activa o no
--     pertenece a ese cliente" -- mismo criterio que `create_shift` (0023): la sede se busca ya
--     filtrada por `client_id = p_client_id`, así que "la sede no pertenece al cliente" cae en el
--     mismo caso que "la sede no existe" o "está inactiva", sin necesidad de un código aparte.
--   - `CLIENT_TEMPLATE_NOT_FOUND` (código nuevo, no está en 06 sección 15): el cliente no tiene una
--     plantilla propia (`site_id is null`) vigente (no borrada) para copiar. El encargo (P12.1)
--     pide definir qué pasa "si el cliente no tiene plantilla"; no hay código en el plan para este
--     caso puntual, así que se acuña uno con el mismo criterio que `SHIFT_NOT_FOUND` (0023): "esa
--     fila no existe todavía". No se exige `is_active = true`: una plantilla desactivada sigue
--     siendo la plantilla del cliente para copiar (desactivarla es un estado de presentación, no
--     una baja lógica -- `is_active` y `deleted_at` son cosas distintas en el modelo, 04 sección
--     2.4); si Mike prefiere exigir `is_active`, es un cambio de una línea.
--   - `SITE_TEMPLATE_EXISTS` (código nuevo, no está en 06 sección 15): la sede ya tiene su propia
--     plantilla (vigente, no borrada, esté activa o no) -- el encargo pide definir qué pasa "si la
--     sede ya tiene plantilla propia". Se verifica ANTES de intentar el insert en vez de dejar que
--     la unicidad parcial de 0008 (`checklist_templates_client_site_key`) lo capture como `23505`
--     crudo, mismo criterio que el resto de las RPC de este proyecto (traducir siempre a un código
--     de dominio con mensaje en voseo).
--   - La plantilla nueva copia el `name` de la del cliente tal cual (sin agregarle "(sede)" ni
--     nada parecido): el modelo no pide un nombre distinto y la pantalla de administración es la
--     que decide cómo mostrarla (F12, fuera de este paquete); Mike puede pedir un sufijo si lo
--     prefiere.
--   - `update_task_status`: el permiso no es un rol/capacidad fijo (06 sección 9: "E (asignación
--     propia present en ese turno), O, A") -- no hay una única llamada a `app.require_role`/
--     `app.require_capability` que lo exprese, así que la función arma su propia rama: admin
--     (owner o admin, `app.is_admin()`) siempre puede; un empleado necesita una asignación vigente
--     en el turno de esa tarea con `status = 'present'` (04 sección 6.3, P-063: "entre su inicio y
--     su fin", que es exactamente la ventana en la que la asignación está en `present` -- arranca
--     en `record_check_in` y termina en `record_check_out`, F13); cualquier otro caso (supervisor,
--     o un rol sin ninguno de los dos) corta con `FORBIDDEN` antes de llegar a `TASK_LOCKED` --
--     `TASK_LOCKED` es específicamente "sos empleado pero no es tu ventana", no "no tenés ningún
--     permiso sobre esto".
--   - `TASK_NOT_FOUND` (código nuevo, no está en 06 sección 15): mismo criterio que
--     `SHIFT_NOT_FOUND`/`ASSIGNMENT_NOT_FOUND` (0023/0024) para "esa fila no existe".
--   - `not_done_reason` se limpia (`null`) cuando el nuevo estado no es `not_done`, sea cual sea el
--     estado anterior: mismo criterio que el check de la tabla (0008,
--     `shift_tasks_not_done_reason_check`), que exige el motivo solo mientras el estado sea
--     `not_done` -- si no se limpiara, una tarea que pasó por `not_done` y volvió a `pending`
--     quedaría con un motivo viejo dando vueltas.
--   - `status_changed_at`/`status_changed_by` se completan siempre que la RPC cambia el estado
--     (incluida una transición "al mismo estado", por ejemplo `not_done -> not_done` para corregir
--     el motivo, 04 sección 6.3: "se permite corregir mientras dure el turno") -- son las columnas
--     de traza específicas del modelo de estados (04 sección 2.4: "quién y cuándo cambió el
--     estado"), independientes de `updated_at`/`updated_by` (que ya pone el trigger genérico
--     `app.set_updated_at`, pero no completa `updated_by`: ninguna RPC de este proyecto lo hace a
--     mano porque no hay trigger para esa columna -- se agrega acá para no perder el dato, mismo
--     criterio que `assign_employee`/`remove_assignment`, que sí completan `created_by`/
--     `removed_by` a mano).
--   - No hay validación de "transición inválida" en `update_task_status`: 04 sección 6.3 permite
--     moverse entre los cuatro estados en cualquier dirección (a diferencia de turnos/asignaciones/
--     supervisiones, que sí tienen movimientos prohibidos); el tipo `task_status` ya acota los
--     valores posibles de `p_status`, así que no hace falta una tabla de transiciones adentro de la
--     función.

-- ---------------------------------------------------------------------------------------------
-- 1. clone_checklist_template(p_client_id, p_site_id) -- 04 sección 9, 06 sección 9, P-058
-- ---------------------------------------------------------------------------------------------

create function public.clone_checklist_template(p_client_id uuid, p_site_id uuid)
returns public.checklist_templates
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client_template public.checklist_templates;
  v_new_template public.checklist_templates;
begin
  perform app.require_capability('edit_checklists');

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status = 'active') then
    raise exception using
      errcode = 'P0001',
      message = 'El cliente no está activo.',
      hint = 'CLIENT_NOT_ACTIVE';
  end if;

  if not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.client_id = p_client_id and s.status = 'active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'La sede no está activa.',
      hint = 'SITE_NOT_ACTIVE';
  end if;

  if exists (
    select 1 from public.checklist_templates ct
    where ct.site_id = p_site_id and ct.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Esta sede ya tiene su propia plantilla de tareas.',
      hint = 'SITE_TEMPLATE_EXISTS';
  end if;

  select * into v_client_template
  from public.checklist_templates ct
  where ct.client_id = p_client_id and ct.site_id is null and ct.deleted_at is null;

  if v_client_template.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Este cliente todavía no tiene una plantilla de tareas para copiar.',
      hint = 'CLIENT_TEMPLATE_NOT_FOUND';
  end if;

  insert into public.checklist_templates (client_id, site_id, name, is_active, created_by)
  values (p_client_id, p_site_id, v_client_template.name, true, auth.uid())
  returning * into v_new_template;

  insert into public.checklist_template_items (
    template_id, position, title, description, is_required, created_by
  )
  select v_new_template.id, i.position, i.title, i.description, i.is_required, auth.uid()
  from public.checklist_template_items i
  where i.template_id = v_client_template.id and i.deleted_at is null
  order by i.position;

  return v_new_template;
end;
$$;

comment on function public.clone_checklist_template(uuid, uuid) is
  'Crea la plantilla propia de una sede copiando los ítems (mismo orden y obligatoriedad) de la plantilla del cliente (04 sección 9, 06 sección 9, P-058). O; A + edit_checklists. CLIENT_NOT_ACTIVE/SITE_NOT_ACTIVE si el cliente o la sede no existen o no están activos (o la sede no pertenece al cliente); SITE_TEMPLATE_EXISTS si la sede ya tiene plantilla propia; CLIENT_TEMPLATE_NOT_FOUND si el cliente no tiene una plantilla para copiar. Devuelve la fila de checklist_templates nueva.';

-- ---------------------------------------------------------------------------------------------
-- 2. update_task_status(p_task_id, p_status, p_reason?) -- 04 sección 6.3, 9; 06 sección 9, P-063
-- ---------------------------------------------------------------------------------------------

create function public.update_task_status(
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

  if app.is_admin() then
    -- Dueño y administrador editan siempre, en cualquier momento del turno (P-063).
    null;
  elsif app.has_role('employee') then
    -- Empleado: solo con asignación vigente en ESE turno y en estado present -- la ventana entre
    -- su inicio (record_check_in) y su fin (record_check_out), F13 (04 sección 6.3, P-063).
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

comment on function public.update_task_status(uuid, public.task_status, text) is
  'Cambia el estado de una tarea del turno (04 sección 6.3, 9; 06 sección 9, P-063). E: solo con asignación vigente present en el turno de la tarea, si no TASK_LOCKED; O, A: siempre; cualquier otro rol (supervisor incluido): FORBIDDEN. TASK_NOT_FOUND si no existe. not_done exige motivo (REASON_REQUIRED); not_done_reason se limpia al salir de not_done. Registra status_changed_at/status_changed_by. Sin validación de transición: 04 sección 6.3 permite moverse libremente entre los cuatro estados.';

-- ---------------------------------------------------------------------------------------------
-- 3. Grants: execute a authenticated, revocado de public/anon (04 sección 7.2, mismo patrón que
--    0023/0024) ------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.clone_checklist_template(uuid, uuid) from public, anon;
grant execute on function public.clone_checklist_template(uuid, uuid) to authenticated;

revoke execute on function public.update_task_status(uuid, public.task_status, text) from public, anon;
grant execute on function public.update_task_status(uuid, public.task_status, text) to authenticated;
