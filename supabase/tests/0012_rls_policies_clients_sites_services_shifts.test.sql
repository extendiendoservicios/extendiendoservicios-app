-- pgTAP de la migración 0012_rls_policies.sql (DB-014), parte 2: clients, client_contacts,
-- sites, services, shifts. Las demás tablas están en 0012_rls_policies.test.sql (personas y
-- acceso), 0012_rls_policies_assignments_attendance_tasks.test.sql (asignaciones, asistencia,
-- tareas) y 0012_rls_policies_supervisions_ratings_settings.test.sql (supervisiones,
-- calificaciones, configuración, seguridad).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2200000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

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

select plan(22);

-- Fixtures: dos clientes (uno con un turno compartido por S/E, otro sin relación con nadie) -------

insert into public.clients (id, legal_name) values
  ('c2200000-0000-0000-0000-000000000001', 'Cliente con turno'),
  ('c2200000-0000-0000-0000-000000000002', 'Cliente sin relación');

insert into public.client_contacts (id, client_id, name, is_primary) values
  ('c2200000-0000-0000-0000-000000000005', 'c2200000-0000-0000-0000-000000000001', 'Contacto uno', true),
  ('c2200000-0000-0000-0000-000000000006', 'c2200000-0000-0000-0000-000000000002', 'Contacto dos', true);

insert into public.sites (id, client_id, name, address) values
  ('c2200000-0000-0000-0000-000000000011', 'c2200000-0000-0000-0000-000000000001', 'Sede con turno', 'Dirección'),
  ('c2200000-0000-0000-0000-000000000012', 'c2200000-0000-0000-0000-000000000002', 'Sede sin relación', 'Dirección');

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from)
values ('c2200000-0000-0000-0000-000000000021', 'c2200000-0000-0000-0000-000000000001', 'c2200000-0000-0000-0000-000000000011', 'Servicio', array[1]::smallint[], '08:00', '16:00', current_date);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2200000-0000-0000-0000-000000000081', 'test-db014b-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c2200000-0000-0000-0000-000000000082', 'test-db014b-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c2200000-0000-0000-0000-000000000083', 'test-db014b-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Tres')),
  ('c2200000-0000-0000-0000-000000000084', 'test-db014b-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cuatro')),
  ('c2200000-0000-0000-0000-000000000085', 'test-db014b-empleado-afuera@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Afuera'));

insert into public.user_roles (profile_id, role) values
  ('c2200000-0000-0000-0000-000000000081', 'owner'),
  ('c2200000-0000-0000-0000-000000000082', 'admin'),
  ('c2200000-0000-0000-0000-000000000083', 'supervisor'),
  ('c2200000-0000-0000-0000-000000000084', 'employee'),
  ('c2200000-0000-0000-0000-000000000085', 'employee');

insert into public.employees (profile_id, dni) values
  ('c2200000-0000-0000-0000-000000000083', '52200083'),
  ('c2200000-0000-0000-0000-000000000084', '52200084'),
  ('c2200000-0000-0000-0000-000000000085', '52200085');

-- Turno del cliente/sede "con turno", supervisado por S, con E asignado; el cliente/sede "sin
-- relación" no tiene ningún turno en este fixture.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2200000-0000-0000-0000-000000000041', 'c2200000-0000-0000-0000-000000000001', 'c2200000-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 1);

insert into public.assignments (shift_id, employee_id)
values ('c2200000-0000-0000-0000-000000000041', 'c2200000-0000-0000-0000-000000000084');

insert into public.supervisions (shift_id, supervisor_id)
values ('c2200000-0000-0000-0000-000000000041', 'c2200000-0000-0000-0000-000000000083');

-- ---------------------------------------------------------------------------------------------
-- 1. clients
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014b-owner@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.clients
    where id = any(array['c2200000-0000-0000-0000-000000000001'::uuid, 'c2200000-0000-0000-0000-000000000002'])),
  array['c2200000-0000-0000-0000-000000000001', 'c2200000-0000-0000-0000-000000000002']::uuid[],
  'clients: owner ve los dos clientes del fixture'
);

select tests.as_user('test-db014b-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.clients
    where id = any(array['c2200000-0000-0000-0000-000000000001'::uuid, 'c2200000-0000-0000-0000-000000000002'])),
  array['c2200000-0000-0000-0000-000000000001']::uuid[],
  'clients: supervisora ve solo el cliente de su turno supervisado'
);

select tests.as_user('test-db014b-empleado@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.clients
    where id = any(array['c2200000-0000-0000-0000-000000000001'::uuid, 'c2200000-0000-0000-0000-000000000002'])),
  array['c2200000-0000-0000-0000-000000000001']::uuid[],
  'clients: empleado ve solo el cliente de su turno'
);

select tests.as_user('test-db014b-empleado-afuera@example.com');
select is(
  (select count(*)::int from public.clients
    where id = any(array['c2200000-0000-0000-0000-000000000001'::uuid, 'c2200000-0000-0000-0000-000000000002'])),
  0,
  'clients: empleado sin turno en ninguno de los dos clientes no ve ninguno'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. client_contacts (decisión de Mike, distinta de clients/sites: acá el empleado NO entra --
-- ver la nota de arquitectura al principio de 0012_rls_policies.sql)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014b-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.client_contacts
    where id = any(array['c2200000-0000-0000-0000-000000000005'::uuid, 'c2200000-0000-0000-0000-000000000006'])),
  array['c2200000-0000-0000-0000-000000000005']::uuid[],
  'client_contacts: supervisora ve solo el contacto del cliente de su turno supervisado'
);

select tests.as_user('test-db014b-empleado@example.com');
select is(
  (select count(*)::int from public.client_contacts
    where id = any(array['c2200000-0000-0000-0000-000000000005'::uuid, 'c2200000-0000-0000-0000-000000000006'])),
  0,
  'client_contacts: el empleado NO ve ningún contacto, ni siquiera del cliente de su propio turno (decisión de Mike: los datos de contacto no los necesita)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. sites
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014b-owner@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.sites
    where id = any(array['c2200000-0000-0000-0000-000000000011'::uuid, 'c2200000-0000-0000-0000-000000000012'])),
  array['c2200000-0000-0000-0000-000000000011', 'c2200000-0000-0000-0000-000000000012']::uuid[],
  'sites: owner ve las dos sedes del fixture'
);

select tests.as_user('test-db014b-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.sites
    where id = any(array['c2200000-0000-0000-0000-000000000011'::uuid, 'c2200000-0000-0000-0000-000000000012'])),
  array['c2200000-0000-0000-0000-000000000011']::uuid[],
  'sites: supervisora ve solo la sede de su turno supervisado'
);

select tests.as_user('test-db014b-empleado@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.sites
    where id = any(array['c2200000-0000-0000-0000-000000000011'::uuid, 'c2200000-0000-0000-0000-000000000012'])),
  array['c2200000-0000-0000-0000-000000000011']::uuid[],
  'sites: empleado ve solo la sede de su turno'
);

select tests.as_user('test-db014b-empleado-afuera@example.com');
select is(
  (select count(*)::int from public.sites
    where id = any(array['c2200000-0000-0000-0000-000000000011'::uuid, 'c2200000-0000-0000-0000-000000000012'])),
  0,
  'sites: empleado sin turno en ninguna de las dos sedes no ve ninguna'
);

set local role anon;
select is((select count(*)::int from public.sites), 0, 'sites: anon no lee ninguna fila');
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 4. services (04 sección 7.2: "O, A. | O, A." -- sin acceso S ni E)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014b-owner@example.com');
select is(
  (select count(*)::int from public.services where id = 'c2200000-0000-0000-0000-000000000021'),
  1,
  'services: owner ve el servicio'
);

select tests.as_user('test-db014b-admin@example.com');
select is(
  (select count(*)::int from public.services where id = 'c2200000-0000-0000-0000-000000000021'),
  1,
  'services: admin ve el servicio'
);

select tests.as_user('test-db014b-supervisora@example.com');
select is(
  (select count(*)::int from public.services where id = 'c2200000-0000-0000-0000-000000000021'),
  0,
  'services: la supervisora no ve servicios, aunque supervise un turno de ese cliente'
);

select tests.as_user('test-db014b-empleado@example.com');
select is(
  (select count(*)::int from public.services where id = 'c2200000-0000-0000-0000-000000000021'),
  0,
  'services: el empleado no ve servicios'
);

set local role postgres;

select tests.as_user('test-db014b-admin@example.com');
select lives_ok(
  $$update public.services set notes = 'ajustado por admin' where id = 'c2200000-0000-0000-0000-000000000021'$$,
  'services: admin puede escribir'
);
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 5. shifts (04 sección 7.2: "O, A: todos. S, E: sus turnos. | RPC.")
-- ---------------------------------------------------------------------------------------------

-- Segundo turno, del cliente/sede "sin relación", para verificar que ni S ni E lo ven.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2200000-0000-0000-0000-000000000042', 'c2200000-0000-0000-0000-000000000002', 'c2200000-0000-0000-0000-000000000012', current_date, '08:00', '16:00', 1);

select tests.as_user('test-db014b-owner@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.shifts
    where id = any(array['c2200000-0000-0000-0000-000000000041'::uuid, 'c2200000-0000-0000-0000-000000000042'])),
  array['c2200000-0000-0000-0000-000000000041', 'c2200000-0000-0000-0000-000000000042']::uuid[],
  'shifts: owner ve los dos turnos del fixture'
);

select tests.as_user('test-db014b-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.shifts
    where id = any(array['c2200000-0000-0000-0000-000000000041'::uuid, 'c2200000-0000-0000-0000-000000000042'])),
  array['c2200000-0000-0000-0000-000000000041']::uuid[],
  'shifts: supervisora ve solo el turno que supervisa'
);

select tests.as_user('test-db014b-empleado@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.shifts
    where id = any(array['c2200000-0000-0000-0000-000000000041'::uuid, 'c2200000-0000-0000-0000-000000000042'])),
  array['c2200000-0000-0000-0000-000000000041']::uuid[],
  'shifts: empleado ve solo el turno donde tiene asignación'
);

select tests.as_user('test-db014b-empleado-afuera@example.com');
select is(
  (select count(*)::int from public.shifts
    where id = any(array['c2200000-0000-0000-0000-000000000041'::uuid, 'c2200000-0000-0000-0000-000000000042'])),
  0,
  'shifts: empleado sin asignación en ninguno de los dos turnos no ve ninguno'
);

-- Sin RPC todavía (fase 10/11): ningún rol puede escribir directo (sin política de insert).
prepare shifts_insert_direct as
  insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
  values ('c2200000-0000-0000-0000-000000000001', 'c2200000-0000-0000-0000-000000000011', current_date + 1, '08:00', '12:00', 1);

select throws_ok(
  'shifts_insert_direct',
  '42501',
  null,
  'shifts: un empleado no puede insertar un turno directo (sin política, solo RPC en fases futuras)'
);

set local role postgres;

select tests.as_user('test-db014b-admin@example.com');

prepare shifts_insert_direct_admin as
  insert into public.shifts (client_id, site_id, shift_date, start_time, end_time, required_staff)
  values ('c2200000-0000-0000-0000-000000000001', 'c2200000-0000-0000-0000-000000000011', current_date + 1, '08:00', '12:00', 1);

select throws_ok(
  'shifts_insert_direct_admin',
  '42501',
  null,
  'shifts: tampoco un admin puede insertar un turno directo (todavía sin RPC, 04 sección 7.2: "RPC")'
);

set local role postgres;

select * from finish();

rollback;
