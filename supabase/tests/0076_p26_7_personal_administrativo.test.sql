-- pgTAP de la migración 0076_p26_7_personal_administrativo.sql (P26.7, CR-16 a CR-19):
--   1. Alta de administrador / dueño: ficha laboral obligatoria y rol employee que se suma solo.
--   2. add_employee_record: solo el dueño; ALREADY_EMPLOYEE, PROFILE_NOT_FOUND, DNI_IN_USE, etc.
--   3. CR-19: un admin edita los datos laborales de un dueño, pero no lo puede dar de baja; el dueño sí.
--   4. set_user_roles: quitar employee a un dueño/admin deja la fila (historial).
--
-- Convención (ver supabase/tests/README.md): todo corre en una transacción que termina en
-- `rollback`. Prefijo de fixtures propio: 'c7600000-...'. DNI y legajos de prueba en el rango 907600xx.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0076;
grant usage on schema tests_0076 to authenticated, anon;

create or replace function tests_0076.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  perform set_config('role', 'postgres', true);
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'tests_0076.as_user: no existe auth.users.email = %', p_email;
  end if;
  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'role', 'authenticated')
      )
    )
  ) -> 'claims';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;
grant execute on function tests_0076.as_user(text) to authenticated, anon;

-- Devuelve el hint (código estable) del error que produce la sentencia, o 'OK' si no falla.
create or replace function tests_0076.hint_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(v_hint, 'SQLSTATE ' || sqlstate);
end;
$$;
grant execute on function tests_0076.hint_of(text) to authenticated, anon;

select plan(51);

-- Fixtures ------------------------------------------------------------------------------------
-- 01 dueño (actor), 02 admin (todas las capacidades), 03 dueño B con ficha, 04 admin B con ficha,
-- 05 empleado común con ficha, 06 administrador viejo sin ficha, 07 cuenta nueva (alta), 08 cuenta
-- nueva (alta de dueño), 09 perfil inactivo, 10 cuenta nueva sin ficha (alta fallida).

insert into auth.users (id, email, raw_user_meta_data) values
  ('c7600000-0000-0000-0000-000000000001', 'test-0076-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Actor')),
  ('c7600000-0000-0000-0000-000000000002', 'test-0076-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Actor')),
  ('c7600000-0000-0000-0000-000000000003', 'test-0076-owner-b@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'ConFicha')),
  ('c7600000-0000-0000-0000-000000000004', 'test-0076-admin-b@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConFicha')),
  ('c7600000-0000-0000-0000-000000000005', 'test-0076-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Comun')),
  ('c7600000-0000-0000-0000-000000000006', 'test-0076-admin-viejo@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinFicha')),
  ('c7600000-0000-0000-0000-000000000007', 'test-0076-alta-admin@example.com', jsonb_build_object('first_name', 'Alta', 'last_name', 'Admin')),
  ('c7600000-0000-0000-0000-000000000008', 'test-0076-alta-owner@example.com', jsonb_build_object('first_name', 'Alta', 'last_name', 'Dueño')),
  ('c7600000-0000-0000-0000-000000000009', 'test-0076-inactivo@example.com', jsonb_build_object('first_name', 'Dado', 'last_name', 'DeBaja')),
  ('c7600000-0000-0000-0000-000000000010', 'test-0076-alta-sin-ficha@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Ficha'));

insert into public.user_roles (profile_id, role) values
  ('c7600000-0000-0000-0000-000000000001', 'owner'),
  ('c7600000-0000-0000-0000-000000000002', 'admin'),
  ('c7600000-0000-0000-0000-000000000003', 'owner'),
  ('c7600000-0000-0000-0000-000000000003', 'employee'),
  ('c7600000-0000-0000-0000-000000000004', 'admin'),
  ('c7600000-0000-0000-0000-000000000004', 'employee'),
  ('c7600000-0000-0000-0000-000000000005', 'employee'),
  ('c7600000-0000-0000-0000-000000000006', 'admin'),
  ('c7600000-0000-0000-0000-000000000009', 'admin');

insert into public.admin_capabilities (profile_id, capability, enabled)
select p, c, true
from unnest(array['c7600000-0000-0000-0000-000000000002', 'c7600000-0000-0000-0000-000000000004',
                  'c7600000-0000-0000-0000-000000000006']::uuid[]) as p,
     unnest(enum_range(null::public.admin_capability)) as c;

insert into public.employees (profile_id, employee_number, dni) values
  ('c7600000-0000-0000-0000-000000000003', 90760001, '90760001'),
  ('c7600000-0000-0000-0000-000000000004', 90760002, '90760002'),
  ('c7600000-0000-0000-0000-000000000005', 90760003, '90760003');

update public.profiles set is_active = false
where id = 'c7600000-0000-0000-0000-000000000009';

insert into public.clients (id, legal_name, calendar_color) values ('c7600000-0000-0000-0000-0000000000c1', 'Cliente 0076', 0);

-- Estructura y permisos -----------------------------------------------------------------------

select has_function('public', 'add_employee_record', array['uuid', 'jsonb']);
select has_function('app', 'insert_employee_record', array['uuid', 'uuid', 'jsonb']);
select has_function('app', 'guard_employee_termination', array[]::text[]);
select has_trigger('public', 'employees', 'trg_guard_employee_termination', 'employees tiene el candado de la baja de dueños y administradores');
select ok(
  has_function_privilege('authenticated', 'public.add_employee_record(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.add_employee_record(uuid, jsonb)', 'execute'),
  'add_employee_record: authenticated sí, anon no'
);
select ok(
  not has_function_privilege('authenticated', 'app.insert_employee_record(uuid, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'app.insert_employee_record(uuid, uuid, jsonb)', 'execute'),
  'insert_employee_record es interna: ni authenticated ni anon'
);
select ok(
  has_function_privilege('service_role', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'admin_create_user_records conserva sus permisos: solo service_role'
);

-- 1. Alta de administrador / dueño (CR-17) ----------------------------------------------------

select is(
  tests_0076.hint_of($$ select public.admin_create_user_records(
    'c7600000-0000-0000-0000-000000000010', 'c7600000-0000-0000-0000-000000000001',
    'Sin', 'Ficha', array['admin']::public.app_role[], null) $$),
  'EMPLOYEE_DATA_REQUIRED',
  'alta de administrador sin ficha: EMPLOYEE_DATA_REQUIRED'
);
select is(
  tests_0076.hint_of($$ select public.admin_create_user_records(
    'c7600000-0000-0000-0000-000000000010', 'c7600000-0000-0000-0000-000000000001',
    'Sin', 'Ficha', array['owner']::public.app_role[], null) $$),
  'EMPLOYEE_DATA_REQUIRED',
  'alta de dueño sin ficha: EMPLOYEE_DATA_REQUIRED'
);
select is(
  tests_0076.hint_of($$ select public.admin_create_user_records(
    'c7600000-0000-0000-0000-000000000010', 'c7600000-0000-0000-0000-000000000001',
    'Sin', 'Ficha', array['admin']::public.app_role[], jsonb_build_object('dni', '  ')) $$),
  'EMPLOYEE_DATA_REQUIRED',
  'alta de administrador con DNI vacío: EMPLOYEE_DATA_REQUIRED'
);
select is(
  (select count(*)::int from public.user_roles where profile_id = 'c7600000-0000-0000-0000-000000000010')
  + (select count(*)::int from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000010')
  + (select count(*)::int from public.admin_capabilities where profile_id = 'c7600000-0000-0000-0000-000000000010'),
  0,
  'las altas rechazadas no dejan roles, ficha ni capacidades (la cuenta se puede retomar)'
);

select is(
  public.admin_create_user_records(
    'c7600000-0000-0000-0000-000000000007', 'c7600000-0000-0000-0000-000000000001',
    'Alta', 'Admin', array['admin']::public.app_role[],
    jsonb_build_object('dni', '90760007', 'employee_number', 90760007)
  ) ->> 'employee_number',
  '90760007',
  'alta de administrador con ficha: devuelve el legajo pedido'
);
select results_eq(
  $$ select role::text from public.user_roles
     where profile_id = 'c7600000-0000-0000-0000-000000000007' order by role::text $$,
  $$ values ('admin'), ('employee') $$,
  'el administrador queda con admin y employee (se sumó solo)'
);
select is(
  (select count(*)::int from public.admin_capabilities
   where profile_id = 'c7600000-0000-0000-0000-000000000007' and enabled),
  cardinality(enum_range(null::public.admin_capability)),
  'el administrador nuevo conserva todas las capacidades activas'
);
select results_eq(
  $$ select dni, created_by from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000007' $$,
  $$ values ('90760007'::text, 'c7600000-0000-0000-0000-000000000001'::uuid) $$,
  'la ficha del administrador queda creada por quien hizo el alta'
);

select public.admin_create_user_records(
  'c7600000-0000-0000-0000-000000000008', 'c7600000-0000-0000-0000-000000000001',
  'Alta', 'Dueño', array['owner', 'employee']::public.app_role[],
  jsonb_build_object('dni', '90760008')
);
select results_eq(
  $$ select role::text from public.user_roles
     where profile_id = 'c7600000-0000-0000-0000-000000000008' order by role::text $$,
  $$ values ('employee'), ('owner') $$,
  'alta de dueño que ya trae employee: queda con owner y employee, sin duplicar'
);
select is(
  (select employee_number from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000008'),
  (select max(employee_number) from public.employees),
  'sin legajo pedido, el dueño nuevo toma el más alto + 1 (queda como el máximo)'
);

-- 2. add_employee_record (CR-18) ---------------------------------------------------------------

select tests_0076.as_user('test-0076-admin@example.com');
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', jsonb_build_object('dni', '90760006')) $$),
  'FORBIDDEN',
  'un admin (aun con todas las capacidades) no puede completar fichas: FORBIDDEN'
);

select tests_0076.as_user('test-0076-empleado@example.com');
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', jsonb_build_object('dni', '90760006')) $$),
  'FORBIDDEN',
  'un empleado no puede completar fichas: FORBIDDEN'
);

select tests_0076.as_user('test-0076-owner@example.com');
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000005', jsonb_build_object('dni', '90760099')) $$),
  'ALREADY_EMPLOYEE',
  'sobre alguien que ya es empleado: ALREADY_EMPLOYEE'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000003', jsonb_build_object('dni', '90760099')) $$),
  'ALREADY_EMPLOYEE',
  'sobre un dueño que ya tiene ficha: ALREADY_EMPLOYEE'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-0000000000ff', jsonb_build_object('dni', '90760099')) $$),
  'PROFILE_NOT_FOUND',
  'perfil inexistente: PROFILE_NOT_FOUND'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000009', jsonb_build_object('dni', '90760099')) $$),
  'PROFILE_NOT_FOUND',
  'perfil inactivo: PROFILE_NOT_FOUND'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', null) $$),
  'EMPLOYEE_DATA_REQUIRED',
  'sin datos: EMPLOYEE_DATA_REQUIRED'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', jsonb_build_object('dni', '90760003')) $$),
  'DNI_IN_USE',
  'DNI repetido: DNI_IN_USE'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', jsonb_build_object('dni', '90760006', 'employee_number', 90760003)) $$),
  'EMPLOYEE_NUMBER_IN_USE',
  'legajo repetido: EMPLOYEE_NUMBER_IN_USE'
);
select is(
  tests_0076.hint_of($$ select public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006', jsonb_build_object('dni', 'abc')) $$),
  'VALIDATION_ERROR',
  'DNI con letras: VALIDATION_ERROR'
);
select is(
  (select count(*)::int from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000006'),
  0,
  'los intentos fallidos no dejaron ficha'
);

select is(
  (select (public.add_employee_record(
    'c7600000-0000-0000-0000-000000000006',
    jsonb_build_object('dni', '90760006', 'cuil', '', 'hire_date', '2026-03-01', 'notes', 'Administración')
  )).employee_number),
  -- Mismo instante que la llamada: el máximo todavía no incluye la ficha que crea la función.
  (select max(employee_number) + 1 from public.employees),
  'el dueño completa la ficha de un administrador viejo: legajo = el más alto + 1'
);

select tests_0076.as_user('test-0076-owner@example.com');
select results_eq(
  $$ select dni, cuil, hire_date, notes, status::text, created_by from public.employees
     where profile_id = 'c7600000-0000-0000-0000-000000000006' $$,
  $$ values ('90760006'::text, null::text, '2026-03-01'::date, 'Administración'::text, 'active'::text,
             'c7600000-0000-0000-0000-000000000001'::uuid) $$,
  'la ficha quedó con los datos, los vacíos en null y activa'
);
select results_eq(
  $$ select role::text from public.user_roles
     where profile_id = 'c7600000-0000-0000-0000-000000000006' order by role::text $$,
  $$ values ('admin'), ('employee') $$,
  'se sumó el rol employee y se conservó admin'
);
select results_eq(
  $$ select actor_id, target_id, details -> 'roles_new', details ->> 'employee_record_added'
     from public.security_events
     where event_type = 'roles_changed' and target_id = 'c7600000-0000-0000-0000-000000000006' $$,
  $$ values ('c7600000-0000-0000-0000-000000000001'::uuid, 'c7600000-0000-0000-0000-000000000006'::uuid,
             '["admin", "employee"]'::jsonb, 'true'::text) $$,
  'se registró el evento roles_changed con employee_record_added'
);
select is(
  (select count(*)::int from public.v_employees where profile_id = 'c7600000-0000-0000-0000-000000000006'),
  1,
  'el administrador completado aparece en v_employees'
);
select results_eq(
  $$ select roles::text[] from public.v_employees where profile_id = 'c7600000-0000-0000-0000-000000000006' $$,
  $$ values (array['admin', 'employee']::text[]) $$,
  'v_employees muestra los dos roles'
);

-- 3. CR-19: un admin edita los datos laborales de un dueño, pero no lo da de baja --------------

select tests_0076.as_user('test-0076-admin@example.com');
select is(
  (select count(*)::int from public.v_employees where profile_id in
    ('c7600000-0000-0000-0000-000000000003', 'c7600000-0000-0000-0000-000000000004')),
  2,
  'el admin ve las fichas del dueño y del otro admin'
);
select lives_ok(
  $$ insert into public.employee_availability (employee_id, weekday, start_time, end_time, created_by)
     values ('c7600000-0000-0000-0000-000000000003', 1, '08:00', '12:00', 'c7600000-0000-0000-0000-000000000002') $$,
  'el admin carga la disponibilidad de un dueño'
);
select lives_ok(
  $$ insert into public.employee_client_permissions (employee_id, client_id, created_by)
     values ('c7600000-0000-0000-0000-000000000004', 'c7600000-0000-0000-0000-0000000000c1', 'c7600000-0000-0000-0000-000000000002') $$,
  'el admin habilita un cliente a otro admin'
);
select lives_ok(
  $$ insert into public.employee_leaves (employee_id, starts_on, ends_on, reason, created_by)
     values ('c7600000-0000-0000-0000-000000000003', '2031-01-10', '2031-01-20', 'Vacaciones', 'c7600000-0000-0000-0000-000000000002') $$,
  'el admin carga una licencia a un dueño'
);
select lives_ok(
  $$ update public.employees set notes = 'Editado por admin', address = 'Calle 1', updated_by = 'c7600000-0000-0000-0000-000000000002'
     where profile_id = 'c7600000-0000-0000-0000-000000000003' $$,
  'el admin edita la ficha de un dueño'
);
-- Sin cambios (0030, DEF-P13): los datos del PERFIL de un dueño o admin (nombre, teléfono, email de
-- contacto) los edita solo el dueño; CR-19 habla de los datos laborales.
select is(
  tests_0076.hint_of($$ update public.profiles set phone = '2477 000111' where id = 'c7600000-0000-0000-0000-000000000003' $$),
  'FORBIDDEN',
  'el admin no edita el perfil (teléfono) de un dueño: regla de 0030, sin cambios'
);

select tests_0076.as_user('test-0076-owner@example.com');
select results_eq(
  $$ select
       (select count(*)::int from public.employee_availability where employee_id = 'c7600000-0000-0000-0000-000000000003'),
       (select count(*)::int from public.employee_client_permissions where employee_id = 'c7600000-0000-0000-0000-000000000004'),
       (select count(*)::int from public.employee_leaves where employee_id = 'c7600000-0000-0000-0000-000000000003'),
       (select notes from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000003') $$,
  $$ values (1, 1, 1, 'Editado por admin'::text) $$,
  'las ediciones del admin quedaron guardadas (disponibilidad, habilitación, licencia y ficha)'
);

select tests_0076.as_user('test-0076-admin@example.com');
select is(
  tests_0076.hint_of($$ update public.employees set status = 'terminated', terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000003' $$),
  'FORBIDDEN',
  'el admin no puede dar de baja a un dueño'
);
select is(
  tests_0076.hint_of($$ update public.employees set status = 'terminated', terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000004' $$),
  'FORBIDDEN',
  'el admin no puede dar de baja a otro admin'
);
select is(
  tests_0076.hint_of($$ update public.employees set terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000003' $$),
  'FORBIDDEN',
  'el admin no puede cargar solo la fecha de baja de un dueño'
);
select is(
  tests_0076.hint_of($$ update public.employees set deleted_at = now()
     where profile_id = 'c7600000-0000-0000-0000-000000000003' $$),
  'FORBIDDEN',
  'el admin no puede borrar lógicamente la ficha de un dueño'
);
select is(
  tests_0076.hint_of($$ update public.employees set status = 'terminated', terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000005' $$),
  'OK',
  'el admin sigue pudiendo dar de baja a un empleado común (sin cambios)'
);
select is(
  tests_0076.hint_of($$ select public.set_user_roles('c7600000-0000-0000-0000-000000000003', array['employee']::public.app_role[]) $$),
  'FORBIDDEN',
  'el admin no puede cambiar roles de un dueño'
);

select tests_0076.as_user('test-0076-owner@example.com');
select is(
  tests_0076.hint_of($$ update public.employees set status = 'terminated', terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000004' $$),
  'OK',
  'el dueño sí puede dar de baja a un admin'
);
select is(
  tests_0076.hint_of($$ update public.employees set status = 'terminated', terminated_at = '2026-10-28'
     where profile_id = 'c7600000-0000-0000-0000-000000000003' $$),
  'OK',
  'el dueño sí puede dar de baja a un dueño'
);

-- 4. set_user_roles: quitar employee deja la fila (historial, P-014) ----------------------------

select tests_0076.as_user('test-0076-owner@example.com');
select is(
  tests_0076.hint_of($$ select public.set_user_roles('c7600000-0000-0000-0000-000000000006', array['admin']::public.app_role[]) $$),
  'OK',
  'el dueño le quita employee a un administrador'
);
select results_eq(
  $$ select
       (select count(*)::int from public.employees where profile_id = 'c7600000-0000-0000-0000-000000000006'),
       (select count(*)::int from public.user_roles where profile_id = 'c7600000-0000-0000-0000-000000000006' and role = 'employee') $$,
  $$ values (1, 0) $$,
  'la fila de employees queda y el rol employee ya no está'
);

select * from finish();

rollback;
