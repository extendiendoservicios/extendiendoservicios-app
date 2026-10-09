-- Altas de personas sin cuentas a medias (9 oct 2026, defecto visto en producción).
--
-- Qué pasaba: `admin-users` (`create_user`) creaba la cuenta de Auth y después, en pasos sueltos,
-- la fila de `employees` (con un legajo provisorio de `employee_number_seq`) y los roles. Cuando
-- el legajo provisorio coincidía con uno cargado a mano, el insert de `employees` fallaba
-- (unique de `employee_number`), la función lo informaba como "DNI ya registrado" y la cuenta de
-- Auth quedaba creada sin ficha ni roles. El reintento chocaba con "email ya en uso".
--
-- Esta migración agrega dos funciones que solo puede ejecutar `service_role` (la Edge Function):
--   1. `admin_find_orphan_account(p_email)`: id de la cuenta con ese email si quedó a medias
--      (perfil activo, sin roles y sin ficha de empleado), para que el alta la retome en vez de
--      rechazarla. Nada se borra (P-014, P-105).
--   2. `admin_create_user_records(...)`: nombre del perfil, ficha de empleado (con el legajo
--      pedido, o el más alto + 1 si no se pide ninguno: la misma regla que la sugerencia del
--      formulario; la secuencia no sabe de los legajos cargados a mano), roles y capacidades en
--      UNA transacción. Si algo falla no queda nada a medias: la cuenta de Auth queda sin ficha
--      ni roles y el próximo intento la retoma con la función 1.
-- Errores: P0001 con hint estable, como el resto de las RPC (0013): DNI_IN_USE,
-- EMPLOYEE_NUMBER_IN_USE, VALIDATION_ERROR, PROFILE_NOT_FOUND.

-- ---------------------------------------------------------------------------------------------
-- 1. admin_find_orphan_account
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_find_orphan_account(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and p.is_active
    and p.deleted_at is null
    and not exists (select 1 from public.user_roles r where r.profile_id = u.id)
    and not exists (select 1 from public.employees e where e.profile_id = u.id)
  limit 1;
$$;

comment on function public.admin_find_orphan_account(text) is
  'Solo service_role (Edge Function admin-users, create_user). Devuelve el id de la cuenta con ese email si quedó a medias: perfil activo, sin roles y sin ficha de empleado (un alta que falló después de crear la cuenta de Auth). null si no existe o si la cuenta está en uso. 0035.';

revoke all on function public.admin_find_orphan_account(text) from public, anon, authenticated;
grant execute on function public.admin_find_orphan_account(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. admin_create_user_records
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_create_user_records(
  p_profile_id uuid,
  p_actor_id uuid,
  p_first_name text,
  p_last_name text,
  p_roles public.app_role[],
  p_employee jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_employee_number integer;
  v_constraint text;
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

  if ('employee' = any (p_roles) or 'supervisor' = any (p_roles))
    and (p_employee is null or coalesce(trim(p_employee ->> 'dni'), '') = '')
  then
    raise exception using
      errcode = 'P0001',
      message = 'Para asignar el rol de empleado o supervisor hace falta cargar los datos de empleado (al menos el DNI).',
      hint = 'EMPLOYEE_DATA_REQUIRED';
  end if;

  -- Una cuenta retomada puede venir con otro nombre que el del primer intento.
  update public.profiles
  set first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      updated_by = p_actor_id
  where id = p_profile_id;

  if p_employee is not null then
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
  end if;

  insert into public.user_roles (profile_id, role, granted_by)
  select p_profile_id, r, p_actor_id
  from unnest(p_roles) as r
  on conflict (profile_id, role) do nothing;

  if 'admin' = any (p_roles) then
    insert into public.admin_capabilities (profile_id, capability, enabled, updated_by)
    select p_profile_id, c, true, p_actor_id
    from unnest(enum_range(null::public.admin_capability)) as c
    on conflict (profile_id, capability) do nothing;
  end if;

  return jsonb_build_object('profile_id', p_profile_id, 'employee_number', v_employee_number);
end;
$$;

comment on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb) is
  'Solo service_role (Edge Function admin-users, create_user). En una transacción: nombre del perfil, ficha de employees (legajo pedido en p_employee.employee_number, o el más alto + 1), roles y, si es admin, las siete capacidades en true. Errores P0001: PROFILE_NOT_FOUND, VALIDATION_ERROR, EMPLOYEE_DATA_REQUIRED, DNI_IN_USE, EMPLOYEE_NUMBER_IN_USE. Devuelve { profile_id, employee_number }. 0035.';

revoke all on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb) from public, anon, authenticated;
grant execute on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb) to service_role;
