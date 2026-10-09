-- El teléfono del alta no se guardaba (9 oct 2026, visto por los dueños en producción): el
-- formulario de alta de empleados lo pide, pero ni el cliente ni `admin-users` lo mandaban, así
-- que solo quedaba si después se editaba la ficha. 0035 ya estaba aplicada en App_dev, así que
-- se reemplaza la función con un parámetro más, `p_phone` (al final y con valor por defecto: las
-- llamadas de 0035 siguen valiendo). Guarda `profiles.phone`; vacío queda en null.

drop function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb);

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
      phone = nullif(trim(p_phone), ''),
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

comment on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text) is
  'Solo service_role (Edge Function admin-users, create_user). En una transacción: nombre y teléfono del perfil, ficha de employees (legajo pedido en p_employee.employee_number, o el más alto + 1), roles y, si es admin, las siete capacidades en true. Errores P0001: PROFILE_NOT_FOUND, VALIDATION_ERROR, EMPLOYEE_DATA_REQUIRED, DNI_IN_USE, EMPLOYEE_NUMBER_IN_USE. Devuelve { profile_id, employee_number }. 0035, teléfono en 0036.';

revoke all on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text) from public, anon, authenticated;
grant execute on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text) to service_role;
