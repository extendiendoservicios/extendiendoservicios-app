-- P26.7 · Personal administrativo (Docs/Plan_Maestro/modulos/P26_credenciales_y_personal_administrativo.md,
-- sección 3, «Migración 0076»; decisiones CR-16 a CR-19).
--
-- Contenido:
--   1. `app.insert_employee_record`: el insert de la ficha laboral con sus validaciones y códigos de
--      error, sacado de `admin_create_user_records` para que lo usen el alta y `add_employee_record`.
--   2. `admin_create_user_records` (versión vigente de 0060): si los roles incluyen `owner` o `admin`,
--      la ficha laboral es obligatoria (EMPLOYEE_DATA_REQUIRED) y el rol `employee` se suma solo (CR-17).
--   3. `add_employee_record(p_profile_id, p_employee)`: crea la ficha de quien ya existe y no la tiene y
--      suma el rol `employee`. Solo el dueño (CR-18).
--   4. Trigger `trg_guard_employee_termination` sobre `employees`: solo el dueño puede dar de baja (o
--      reactivar) la ficha de un dueño o de un administrador (CR-19).
--
-- No toca datos existentes: solo funciones, un trigger y comentarios. Producción está en uso.
--
-- Lo que se revisó y NO cambia (CR-19):
--   - RLS de `employees` (`employees_update_admin`: O, A), de `employee_availability`,
--     `employee_client_permissions` y `employee_leaves` (`*_write_admin`: O, A) y de `profiles`
--     (`profiles_update_admin`): ya son por rol y no distinguen a quién pertenece la fila, así que un
--     admin ya puede editar disponibilidad, habilitaciones, licencias y ficha de un dueño o de otro admin.
--   - `set_user_roles` (0013): un admin no puede tocar a quien tenga `owner`/`admin` (FORBIDDEN). Si a un
--     dueño o admin se le quita `employee`, la fila de `employees` queda (historial, P-014), igual que
--     con cualquier empleado.
--   - `v_employees` (0011/0040/0061): lee de `employees` sin filtrar por rol; `roles` es el arreglo
--     completo de `user_roles`. Los RPC de asignación validan contra `employees` (fila activa), no contra
--     el rol.
--   - La baja: no hay RPC. Son dos pasos desde la app: Edge `deactivate_user` (ya rechaza a un admin
--     sobre un dueño o admin con `assertCanActOnTarget`) y un `update` de `employees.status`. Ese
--     `update` lo permitía la RLS a cualquier admin: es el hueco que cierra el punto 4.

-- ---------------------------------------------------------------------------------------------
-- 1. app.insert_employee_record
-- ---------------------------------------------------------------------------------------------

-- Mismos campos, validaciones y códigos de error que tenía el alta en 0060 (movidos sin cambios):
-- DNI_IN_USE, EMPLOYEE_NUMBER_IN_USE y VALIDATION_ERROR. El legajo, si no viene, es el máximo + 1
-- (igual que el alta). Devuelve el legajo asignado.
create or replace function app.insert_employee_record(
  p_profile_id uuid,
  p_actor_id uuid,
  p_employee jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_employee_number integer;
  v_constraint text;
begin
  begin
    insert into public.employees (
      profile_id,
      employee_number,
      dni,
      cuil,
      address,
      birth_date,
      hire_date,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_relationship,
      notes,
      created_by
    )
    values (
      p_profile_id,
      coalesce(
        (p_employee ->> 'employee_number')::integer,
        (select coalesce(max(e.employee_number), 0) + 1 from public.employees e)
      ),
      p_employee ->> 'dni',
      nullif(p_employee ->> 'cuil', ''),
      nullif(p_employee ->> 'address', ''),
      nullif(p_employee ->> 'birth_date', '')::date,
      nullif(p_employee ->> 'hire_date', '')::date,
      nullif(p_employee ->> 'emergency_contact_name', ''),
      nullif(p_employee ->> 'emergency_contact_phone', ''),
      nullif(p_employee ->> 'emergency_contact_relationship', ''),
      nullif(p_employee ->> 'notes', ''),
      p_actor_id
    )
    returning employee_number into v_employee_number;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'employees_dni_key' then
        raise exception using
          errcode = 'P0001',
          message = 'Ese DNI ya está registrado.',
          hint = 'DNI_IN_USE';
      elsif v_constraint = 'employees_employee_number_key' then
        raise exception using
          errcode = 'P0001',
          message = 'Ese legajo ya está en uso.',
          hint = 'EMPLOYEE_NUMBER_IN_USE';
      end if;
      raise;
    when check_violation then
      get stacked diagnostics v_constraint = constraint_name;
      raise exception using
        errcode = 'P0001',
        message = case
          when v_constraint = 'employees_dni_format_check' then 'El DNI tiene que tener solo dígitos.'
          when v_constraint = 'employees_cuil_format_check' then 'El CUIL tiene que tener 11 dígitos, sin puntos ni guiones.'
          else 'Los datos de empleado no son válidos.'
        end,
        hint = 'VALIDATION_ERROR';
    when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
      raise exception using
        errcode = 'P0001',
        message = 'Revisá las fechas y el legajo: alguno no tiene un formato válido.',
        hint = 'VALIDATION_ERROR';
  end;

  return v_employee_number;
end;
$$;

comment on function app.insert_employee_record(uuid, uuid, jsonb) is
  'Inserta la ficha laboral (employees) con las validaciones del alta: DNI_IN_USE, EMPLOYEE_NUMBER_IN_USE, VALIDATION_ERROR. Legajo = el pedido o máximo + 1. Uso interno de admin_create_user_records y add_employee_record (0076, P26.7); no se expone a anon ni authenticated.';

revoke execute on function app.insert_employee_record(uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. admin_create_user_records: ficha obligatoria y rol employee para owner/admin (CR-17)
-- ---------------------------------------------------------------------------------------------

-- Misma firma que 0060 (los permisos, solo service_role, se conservan con create or replace).
create or replace function public.admin_create_user_records(
  p_profile_id uuid,
  p_actor_id uuid,
  p_first_name text,
  p_last_name text,
  p_roles public.app_role[],
  p_employee jsonb default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_employee_number integer;
  v_roles public.app_role[];
begin
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá al menos un rol válido.',
      hint = 'VALIDATION_ERROR';
  end if;

  -- CR-17: un dueño o administrador también trabaja, así que lleva ficha laboral y el rol employee.
  v_roles := p_roles;
  if ('owner' = any (p_roles) or 'admin' = any (p_roles)) and not ('employee' = any (p_roles)) then
    v_roles := array_append(p_roles, 'employee'::public.app_role);
  end if;

  if ('employee' = any (v_roles) or 'supervisor' = any (v_roles))
    and (p_employee is null or coalesce(trim(p_employee ->> 'dni'), '') = '')
  then
    raise exception using
      errcode = 'P0001',
      message = 'Para asignar el rol de empleado, coordinador, administrador o dueño hace falta cargar los datos de empleado (al menos el DNI).',
      hint = 'EMPLOYEE_DATA_REQUIRED';
  end if;

  -- Una cuenta retomada puede venir con otro nombre que el del primer intento.
  update public.profiles
  set first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      phone = nullif(trim(p_phone), ''),
      updated_by = p_actor_id
  where id = p_profile_id;

  if p_employee is not null then
    v_employee_number := app.insert_employee_record(p_profile_id, p_actor_id, p_employee);
  end if;

  insert into public.user_roles (profile_id, role, granted_by)
  select p_profile_id, r, p_actor_id
  from unnest(v_roles) as r
  on conflict (profile_id, role) do nothing;

  if 'admin' = any (v_roles) then
    insert into public.admin_capabilities (profile_id, capability, enabled, updated_by)
    select p_profile_id, c, true, p_actor_id
    from unnest(enum_range(null::public.admin_capability)) as c
    on conflict (profile_id, capability) do nothing;
  end if;

  return jsonb_build_object('profile_id', p_profile_id, 'employee_number', v_employee_number);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. add_employee_record (CR-18)
-- ---------------------------------------------------------------------------------------------

-- Completa la ficha laboral de alguien que ya existe (dueños y administradores dados de alta antes
-- de CR-17). Solo el dueño. No hace falta service_role: no toca Auth. Todo en una transacción:
-- ficha + rol employee + evento. El evento es `roles_changed` (el mismo de set_user_roles, con el
-- mismo detalle roles_previous / roles_new) más `employee_record_added = true`, porque el efecto
-- de seguridad es que la persona gana un rol; no hace falta un tipo de evento nuevo.
-- `p_employee` tiene los mismos campos que el alta: dni (obligatorio), employee_number (opcional),
-- cuil, address, birth_date, hire_date, emergency_contact_name, emergency_contact_phone,
-- emergency_contact_relationship, notes.
create function public.add_employee_record(p_profile_id uuid, p_employee jsonb)
returns public.employees
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_profile public.profiles;
  v_roles_previous public.app_role[];
  v_roles_new public.app_role[];
  v_employee public.employees;
begin
  perform app.require_role('owner');

  -- Bloquea el perfil para que dos llamadas simultáneas no creen la ficha dos veces.
  select * into v_profile
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if v_profile.id is null or not v_profile.is_active or v_profile.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona o no está activa.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  if exists (select 1 from public.employees e where e.profile_id = p_profile_id) then
    raise exception using
      errcode = 'P0001',
      message = 'Esa persona ya tiene ficha laboral.',
      hint = 'ALREADY_EMPLOYEE';
  end if;

  if p_employee is null or coalesce(trim(p_employee ->> 'dni'), '') = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Hace falta cargar los datos de empleado (al menos el DNI).',
      hint = 'EMPLOYEE_DATA_REQUIRED';
  end if;

  select coalesce(array_agg(ur.role order by ur.role), array[]::public.app_role[])
    into v_roles_previous
  from public.user_roles ur
  where ur.profile_id = p_profile_id;

  perform app.insert_employee_record(p_profile_id, auth.uid(), p_employee);

  insert into public.user_roles (profile_id, role, granted_by)
  values (p_profile_id, 'employee', auth.uid())
  on conflict (profile_id, role) do nothing;

  select coalesce(array_agg(ur.role order by ur.role), array[]::public.app_role[])
    into v_roles_new
  from public.user_roles ur
  where ur.profile_id = p_profile_id;

  perform app.log_security_event(
    'roles_changed'::public.security_event_type,
    auth.uid(),
    p_profile_id,
    jsonb_build_object(
      'roles_previous', to_jsonb(v_roles_previous),
      'roles_new', to_jsonb(v_roles_new),
      'employee_record_added', true
    )
  );

  select * into v_employee from public.employees e where e.profile_id = p_profile_id;
  return v_employee;
end;
$$;

comment on function public.add_employee_record(uuid, jsonb) is
  'Crea la ficha laboral de una persona activa que no la tiene y le suma el rol employee, en una transacción (0076, P26.7, CR-18). Solo el dueño (FORBIDDEN). PROFILE_NOT_FOUND (no existe o no está activa), ALREADY_EMPLOYEE, EMPLOYEE_DATA_REQUIRED (sin DNI), DNI_IN_USE, EMPLOYEE_NUMBER_IN_USE, VALIDATION_ERROR. Legajo = el pedido o máximo + 1. Evento roles_changed con employee_record_added. Devuelve la fila de employees.';

revoke execute on function public.add_employee_record(uuid, jsonb) from public, anon;
grant execute on function public.add_employee_record(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Baja de la ficha de un dueño o administrador: solo el dueño (CR-19)
-- ---------------------------------------------------------------------------------------------

-- La baja laboral es un `update` de employees.status / terminated_at (la RLS deja a cualquier admin
-- hacer `update`, porque editar datos laborales no exige manage_users). Para que un admin pueda
-- editar la ficha de un dueño o de otro admin sin poder darlo de baja, este trigger rechaza el cambio
-- de status, terminated_at o deleted_at cuando la persona tiene owner/admin y quien edita no es el
-- dueño. No se mete con quien edita sin sesión de usuario (service_role, migraciones): auth.uid() es
-- nulo. Para empleados comunes no cambia nada.
create function app.guard_employee_termination()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if auth.uid() is not null
    and not app.has_role('owner')
    and (
      new.status is distinct from old.status
      or new.terminated_at is distinct from old.terminated_at
      or new.deleted_at is distinct from old.deleted_at
    )
    and exists (
      select 1 from public.user_roles ur
      where ur.profile_id = old.profile_id and ur.role in ('owner', 'admin')
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'Solo el dueño puede dar de baja a un dueño o a un administrador.',
      hint = 'FORBIDDEN';
  end if;
  return new;
end;
$$;

comment on function app.guard_employee_termination() is
  'Trigger BEFORE UPDATE en employees (0076, P26.7, CR-19): si la persona tiene rol owner o admin, solo el dueño puede cambiar status, terminated_at o deleted_at (FORBIDDEN). Sin sesión de usuario (service_role, migraciones) no actúa.';

revoke execute on function app.guard_employee_termination() from public, anon, authenticated;

create trigger trg_guard_employee_termination
before update on public.employees
for each row execute function app.guard_employee_termination();
