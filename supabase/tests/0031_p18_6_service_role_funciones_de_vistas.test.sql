-- pgTAP de la migración 0031_p18_6_service_role_funciones_de_vistas.sql (P18.6): service_role
-- puede consultar las vistas recortadas y las que dependen de ellas, y las ve completas (como
-- ve las tablas); un `authenticated` común sigue sin ese privilegio.
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`.
-- Prefijo de fixtures: 'e3100000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('e3100000-0000-0000-0000-000000000001', 'test-db031-emp1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('e3100000-0000-0000-0000-000000000002', 'test-db031-emp2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos'));
insert into public.user_roles (profile_id, role) values
  ('e3100000-0000-0000-0000-000000000001', 'employee'),
  ('e3100000-0000-0000-0000-000000000002', 'employee');
insert into public.employees (profile_id, dni) values
  ('e3100000-0000-0000-0000-000000000001', '93100001'),
  ('e3100000-0000-0000-0000-000000000002', '93100002');
insert into public.clients (id, legal_name, status) values
  ('e3100000-0000-0000-0000-000000000101', 'Cliente 0031', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('e3100000-0000-0000-0000-000000000111', 'e3100000-0000-0000-0000-000000000101', 'Sede 0031', 'Calle 31', 'active');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e3100000-0000-0000-0000-000000000201', 'e3100000-0000-0000-0000-000000000101', 'e3100000-0000-0000-0000-000000000111', app.today() + 1, '10:00', '11:00', 2, 'assigned');
insert into public.assignments (id, shift_id, employee_id) values
  ('e3100000-0000-0000-0000-000000000301', 'e3100000-0000-0000-0000-000000000201', 'e3100000-0000-0000-0000-000000000001'),
  ('e3100000-0000-0000-0000-000000000302', 'e3100000-0000-0000-0000-000000000201', 'e3100000-0000-0000-0000-000000000002');

select ok(
  has_function_privilege('service_role', 'app.people_basic()', 'execute')
    and has_function_privilege('service_role', 'app.clients_basic()', 'execute')
    and has_function_privilege('service_role', 'app.shift_peers()', 'execute')
    and has_function_privilege('service_role', 'app.my_shift_ids()', 'execute'),
  'service_role puede ejecutar las funciones de las vistas recortadas'
);
select ok(
  not has_function_privilege('anon', 'app.people_basic()', 'execute')
    and not has_function_privilege('anon', 'app.clients_basic()', 'execute')
    and not has_function_privilege('anon', 'app.shift_peers()', 'execute'),
  'anon sigue sin poder ejecutarlas'
);

-- Como service_role (JWT con role = service_role) ----------------------------------------------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  (select count(*)::int from public.v_people_basic where profile_id in (
    'e3100000-0000-0000-0000-000000000001', 'e3100000-0000-0000-0000-000000000002')),
  2,
  'service_role lee v_people_basic completa'
);
select is(
  (select count(*)::int from public.v_clients_basic where id = 'e3100000-0000-0000-0000-000000000101'),
  1,
  'service_role lee v_clients_basic completa'
);
select is(
  (select count(*)::int from public.v_shift_peers where shift_id = 'e3100000-0000-0000-0000-000000000201'),
  2,
  'service_role lee v_shift_peers completa'
);
select lives_ok(
  $$select count(*) from public.v_my_day$$,
  'service_role consulta v_my_day sin error (filtra por auth.uid(): cero filas)'
);
select lives_ok(
  $$select count(*) from public.v_my_supervisions$$,
  'service_role consulta v_my_supervisions sin error'
);

-- Un authenticated común no se hace pasar por service_role -------------------------------------

set local role postgres;
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object('sub', 'e3100000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

select is(
  (select count(*)::int from public.v_people_basic where profile_id in (
    'e3100000-0000-0000-0000-000000000001', 'e3100000-0000-0000-0000-000000000002')),
  1,
  'un authenticated sin rol en el JWT ve solo su propia fila en v_people_basic'
);
select is(
  (select count(*)::int from public.v_clients_basic where id = 'e3100000-0000-0000-0000-000000000101'),
  0,
  'un authenticated sin rol en el JWT no ve clientes en v_clients_basic'
);
select is(
  (select count(*)::int from public.v_shift_peers where shift_id = 'e3100000-0000-0000-0000-000000000201'),
  0,
  'un authenticated sin rol en el JWT no ve a nadie en v_shift_peers'
);

select * from finish();

rollback;
