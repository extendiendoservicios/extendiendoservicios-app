-- pgTAP de la migración 0012_rls_policies.sql (DB-014), parte 1: profiles, user_roles,
-- admin_capabilities, employees, employee_client_permissions, employee_availability,
-- employee_leaves. Las demás tablas están en:
--   - 0012_rls_policies_clients_sites_services_shifts.test.sql (clients, client_contacts, sites,
--     services, shifts)
--   - 0012_rls_policies_assignments_attendance_tasks.test.sql (assignments, attendance_records,
--     attendance_notices, checklist_templates, checklist_template_items, shift_tasks)
--   - 0012_rls_policies_supervisions_ratings_settings.test.sql (supervisions,
--     supervision_attendance, ratings, rating_criteria, holidays, company_settings,
--     security_events, y el caso "anon no lee ninguna tabla salvo v_public_branding")
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2100000-...'.
--
-- Patrón de verificación "exactamente las filas esperadas y ni una más" (pedido del encargo):
-- para cada rol se arma el conjunto de ids VISIBLES entre los de este fixture (con
-- `id = any(array[...fixture ids...])`, para no mezclarse con fixtures de otros archivos de test
-- que puedan estar corriendo en paralelo contra el mismo App_dev) y se compara con `is(...)`
-- contra el arreglo esperado, ordenado.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

-- tests.as_user(email) (TEST-002) -- ver supabase/tests/README.md.
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.as_user(p_email text)
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
    raise exception 'tests.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests.as_user(text) to authenticated, anon;

select plan(30);

-- Fixtures: owner, admin, supervisora, dos empleados de un mismo turno supervisado (E1, E2) y un
-- tercer empleado "de afuera" (E3, sin turno compartido con nadie del fixture) --------------------

insert into public.clients (id, legal_name) values ('c2100000-0000-0000-0000-000000000001', 'Cliente RLS 1');
insert into public.sites (id, client_id, name, address)
values ('c2100000-0000-0000-0000-000000000011', 'c2100000-0000-0000-0000-000000000001', 'Sede RLS 1', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2100000-0000-0000-0000-000000000081', 'test-db014-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c2100000-0000-0000-0000-000000000082', 'test-db014-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c2100000-0000-0000-0000-000000000083', 'test-db014-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Tres')),
  ('c2100000-0000-0000-0000-000000000084', 'test-db014-empleado1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('c2100000-0000-0000-0000-000000000085', 'test-db014-empleado2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos')),
  ('c2100000-0000-0000-0000-000000000086', 'test-db014-empleado-afuera@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Afuera'));

insert into public.user_roles (profile_id, role) values
  ('c2100000-0000-0000-0000-000000000081', 'owner'),
  ('c2100000-0000-0000-0000-000000000082', 'admin'),
  ('c2100000-0000-0000-0000-000000000083', 'supervisor'),
  ('c2100000-0000-0000-0000-000000000084', 'employee'),
  ('c2100000-0000-0000-0000-000000000085', 'employee'),
  ('c2100000-0000-0000-0000-000000000086', 'employee');

insert into public.employees (profile_id, dni) values
  ('c2100000-0000-0000-0000-000000000083', '52100083'),
  ('c2100000-0000-0000-0000-000000000084', '52100084'),
  ('c2100000-0000-0000-0000-000000000085', '52100085'),
  ('c2100000-0000-0000-0000-000000000086', '52100086');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c2100000-0000-0000-0000-000000000082', 'manage_users', false);

-- Turno supervisado por la supervisora, con E1 y E2 asignados; E3 no participa de nada de esto.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2100000-0000-0000-0000-000000000041', 'c2100000-0000-0000-0000-000000000001', 'c2100000-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 2);

insert into public.assignments (shift_id, employee_id)
values
  ('c2100000-0000-0000-0000-000000000041', 'c2100000-0000-0000-0000-000000000084'),
  ('c2100000-0000-0000-0000-000000000041', 'c2100000-0000-0000-0000-000000000085');

insert into public.supervisions (shift_id, supervisor_id)
values ('c2100000-0000-0000-0000-000000000041', 'c2100000-0000-0000-0000-000000000083');

-- Ids de referencia para los arreglos esperados -----------------------------------------------

-- (owner, admin, supervisor, e1, e2, e3)

-- ---------------------------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014-owner@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
    where id = any(array[
      'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ]::uuid[])),
  array[
    'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
    'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
    'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
  ]::uuid[],
  'profiles: owner ve las 6 filas del fixture'
);

select tests.as_user('test-db014-admin@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
    where id = any(array[
      'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ]::uuid[])),
  array[
    'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
    'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
    'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
  ]::uuid[],
  'profiles: admin ve las 6 filas del fixture'
);

select tests.as_user('test-db014-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
    where id = any(array[
      'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ]::uuid[])),
  array[
    'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
    'c2100000-0000-0000-0000-000000000085'
  ]::uuid[],
  'profiles: supervisora ve la propia + los empleados de su turno supervisado (E1, E2), no owner/admin/E3'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
    where id = any(array[
      'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ]::uuid[])),
  array['c2100000-0000-0000-0000-000000000084', 'c2100000-0000-0000-0000-000000000085']::uuid[],
  'profiles: empleado 1 ve la propia + su compañero de turno (E2, P-103), no ve a la supervisora (no comparte asignación con ella) ni a owner/admin/E3'
);

select tests.as_user('test-db014-empleado-afuera@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.profiles
    where id = any(array[
      'c2100000-0000-0000-0000-000000000081', 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ]::uuid[])),
  array['c2100000-0000-0000-0000-000000000086']::uuid[],
  'profiles: empleado de afuera (sin turno compartido) solo ve la propia fila'
);

-- Desde 0017_grants.sql (DB-017, tramo B), anon ni siquiera tiene el privilegio de tabla sobre
-- profiles (antes de 0017 el ACL por defecto se lo daba y solo RLS lo bloqueaba, así que el
-- select devolvía 0 filas; ahora corta con permission denied, más estricto).
set local role anon;

prepare profiles_select_anon as select count(*) from public.profiles;

select throws_ok(
  'profiles_select_anon', '42501', null,
  'profiles: anon no tiene ni el privilegio de tabla (0017_grants.sql)'
);

set local role postgres;

-- Update propio: solo la propia fila (with check), solo columnas de contacto (grant de columna +
-- trigger app.enforce_profile_self_update_columns, ambos de 0017_grants.sql, DB-017 tramo B --
-- ver el comentario de esa migración sobre por qué hace falta el trigger además del grant).
select tests.as_user('test-db014-empleado1@example.com');

select lives_ok(
  $$update public.profiles set contact_email = 'empleado1@example.com' where id = 'c2100000-0000-0000-0000-000000000084'$$,
  'profiles: empleado 1 puede actualizar su propia fila'
);

prepare profiles_update_own_first_name as
  update public.profiles set first_name = 'Hackeado' where id = 'c2100000-0000-0000-0000-000000000084';

select throws_ok(
  'profiles_update_own_first_name', 'P0001', 'Desde tu perfil solo podés editar el email de contacto, el teléfono, la foto y el consentimiento de ubicación.',
  'profiles: empleado 1 NO puede cambiar first_name de su propia fila (trigger de 0017_grants.sql)'
);

-- No se puede anidar un WITH con UPDATE dentro de `select is(...)` (Postgres exige que el WITH
-- modificador esté en el nivel superior de la sentencia): se usa una tabla temporal como paso
-- intermedio, creada mientras el rol activo YA es `authenticated` (dueña de la tabla temporal,
-- así no hace falta un grant aparte).
create temporary table c2100000_update_probe (n int) on commit drop;

with upd as (
  update public.profiles set contact_email = 'hackeado@example.com'
  where id = 'c2100000-0000-0000-0000-000000000085'
  returning 1
)
insert into c2100000_update_probe select count(*) from upd;

select is(
  (select n from c2100000_update_probe),
  0,
  'profiles: empleado 1 NO puede actualizar la fila de un compañero (0 filas afectadas, RLS filtra por fila)'
);

set local role postgres;

select is(
  (select contact_email from public.profiles where id = 'c2100000-0000-0000-0000-000000000085'),
  null::text,
  'profiles: el intento de actualizar la fila del compañero no tuvo efecto'
);

-- ---------------------------------------------------------------------------------------------
-- 2. user_roles
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014-owner@example.com');
select is(
  (select count(*)::int from public.user_roles
    where profile_id = any(array[
      'c2100000-0000-0000-0000-000000000081'::uuid, 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ])),
  6,
  'user_roles: owner ve las 6 filas del fixture'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select coalesce(array_agg(role order by role), array[]::public.app_role[]) from public.user_roles
    where profile_id = any(array[
      'c2100000-0000-0000-0000-000000000081'::uuid, 'c2100000-0000-0000-0000-000000000082',
      'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ])),
  array['employee']::public.app_role[],
  'user_roles: empleado 1 ve solo su propia fila (no las de otros, aunque compartan turno)'
);

-- ---------------------------------------------------------------------------------------------
-- 3. admin_capabilities
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014-owner@example.com');
select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2100000-0000-0000-0000-000000000082'),
  1,
  'admin_capabilities: owner ve la fila del admin'
);

select tests.as_user('test-db014-admin@example.com');
select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2100000-0000-0000-0000-000000000082'),
  1,
  'admin_capabilities: el propio admin ve su fila'
);

select tests.as_user('test-db014-supervisora@example.com');
select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c2100000-0000-0000-0000-000000000082'),
  0,
  'admin_capabilities: la supervisora no ve la capacidad del admin'
);

-- ---------------------------------------------------------------------------------------------
-- 4. employees
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014-owner@example.com');
select is(
  (select coalesce(array_agg(profile_id order by profile_id), array[]::uuid[]) from public.employees
    where profile_id = any(array[
      'c2100000-0000-0000-0000-000000000083'::uuid, 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ])),
  array[
    'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
    'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
  ]::uuid[],
  'employees: owner ve las 4 filas del fixture'
);

select tests.as_user('test-db014-supervisora@example.com');
select is(
  (select coalesce(array_agg(profile_id order by profile_id), array[]::uuid[]) from public.employees
    where profile_id = any(array[
      'c2100000-0000-0000-0000-000000000083'::uuid, 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ])),
  array[
    'c2100000-0000-0000-0000-000000000083', 'c2100000-0000-0000-0000-000000000084',
    'c2100000-0000-0000-0000-000000000085'
  ]::uuid[],
  'employees: supervisora ve su propia fila + E1 y E2 (empleados de su turno), no E3'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select coalesce(array_agg(profile_id order by profile_id), array[]::uuid[]) from public.employees
    where profile_id = any(array[
      'c2100000-0000-0000-0000-000000000083'::uuid, 'c2100000-0000-0000-0000-000000000084',
      'c2100000-0000-0000-0000-000000000085', 'c2100000-0000-0000-0000-000000000086'
    ])),
  array['c2100000-0000-0000-0000-000000000084']::uuid[],
  'employees: empleado 1 ve SOLO su propia fila -- ni siquiera la de su compañero E2 (04 sección 7.2: "compañeros vía vista básica", no vía esta tabla)'
);

-- Insert: requiere manage_users (owner siempre, admin solo si tiene la capacidad habilitada).
select tests.as_user('test-db014-admin@example.com');

prepare employees_insert_no_capability as
  insert into public.employees (profile_id, dni) values ('c2100000-0000-0000-0000-000000000086', '99999999');

select throws_ok(
  'employees_insert_no_capability',
  '42501',
  null,
  'employees: admin SIN manage_users no puede insertar (la fila de E3 ya existe, pero igual se verifica el rechazo con un profile_id libre a continuación)'
);

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values ('c2100000-0000-0000-0000-000000000087', 'test-db014-nuevo-empleado@example.com', jsonb_build_object('first_name', 'Nuevo', 'last_name', 'Empleado'));

select tests.as_user('test-db014-admin@example.com');

prepare employees_insert_no_capability_2 as
  insert into public.employees (profile_id, dni) values ('c2100000-0000-0000-0000-000000000087', '52100087');

select throws_ok(
  'employees_insert_no_capability_2',
  '42501',
  null,
  'employees: admin SIN manage_users no puede insertar un empleado nuevo (with check falla, 42501)'
);

set local role postgres;

update public.admin_capabilities set enabled = true
where profile_id = 'c2100000-0000-0000-0000-000000000082' and capability = 'manage_users';

select tests.as_user('test-db014-admin@example.com');

select lives_ok(
  $$insert into public.employees (profile_id, dni) values ('c2100000-0000-0000-0000-000000000087', '52100087')$$,
  'employees: admin CON manage_users habilitada sí puede insertar'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 5. employee_client_permissions, employee_availability, employee_leaves
-- ---------------------------------------------------------------------------------------------

insert into public.employee_client_permissions (employee_id, client_id)
values ('c2100000-0000-0000-0000-000000000084', 'c2100000-0000-0000-0000-000000000001');

insert into public.employee_availability (employee_id, weekday, start_time, end_time)
values ('c2100000-0000-0000-0000-000000000084', 1, '08:00', '16:00');

insert into public.employee_leaves (employee_id, starts_on, ends_on)
values ('c2100000-0000-0000-0000-000000000085', current_date - 3, current_date + 3);

select tests.as_user('test-db014-owner@example.com');
select is(
  (select count(*)::int from public.employee_client_permissions where employee_id = 'c2100000-0000-0000-0000-000000000084'),
  1,
  'employee_client_permissions: owner ve la fila'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select count(*)::int from public.employee_client_permissions where employee_id = 'c2100000-0000-0000-0000-000000000084'),
  1,
  'employee_client_permissions: el propio empleado ve su fila'
);

select tests.as_user('test-db014-empleado2@example.com');
select is(
  (select count(*)::int from public.employee_client_permissions where employee_id = 'c2100000-0000-0000-0000-000000000084'),
  0,
  'employee_client_permissions: otro empleado no ve la fila ajena'
);

select tests.as_user('test-db014-supervisora@example.com');
select is(
  (select count(*)::int from public.employee_availability where employee_id = 'c2100000-0000-0000-0000-000000000084'),
  0,
  'employee_availability: la supervisora NO ve la disponibilidad de un empleado de su turno (04 sección 7.2: "S: no")'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select count(*)::int from public.employee_availability where employee_id = 'c2100000-0000-0000-0000-000000000084'),
  1,
  'employee_availability: el propio empleado ve su disponibilidad'
);

select tests.as_user('test-db014-empleado2@example.com');
select is(
  (select count(*)::int from public.employee_leaves where employee_id = 'c2100000-0000-0000-0000-000000000085'),
  1,
  'employee_leaves: el propio empleado ve su licencia vigente'
);

select tests.as_user('test-db014-empleado1@example.com');
select is(
  (select count(*)::int from public.employee_leaves where employee_id = 'c2100000-0000-0000-0000-000000000085'),
  0,
  'employee_leaves: otro empleado no ve la licencia ajena'
);

set local role postgres;

-- Write: O/A pueden, un empleado no.
select tests.as_user('test-db014-admin@example.com');

select lives_ok(
  $$insert into public.employee_availability (employee_id, weekday, start_time, end_time)
    values ('c2100000-0000-0000-0000-000000000085', 2, '09:00', '13:00')$$,
  'employee_availability: admin puede insertar disponibilidad de un empleado'
);

select tests.as_user('test-db014-empleado1@example.com');

prepare employee_availability_insert_employee as
  insert into public.employee_availability (employee_id, weekday, start_time, end_time)
  values ('c2100000-0000-0000-0000-000000000084', 3, '09:00', '13:00');

select throws_ok(
  'employee_availability_insert_employee',
  '42501',
  null,
  'employee_availability: un empleado no puede insertar su propia disponibilidad directamente (no tiene política de escritura, 04 sección 7.2: "O, A")'
);

set local role postgres;

select * from finish();

rollback;
