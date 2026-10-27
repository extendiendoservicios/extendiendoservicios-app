-- pgTAP de la migración 0072_p25_5_retiro_en_nombre_de.sql (P25.5a, módulo E, IS-35).
--   1. Administradora que también es empleada: opciones de administración (-30 a +7, todos los
--      turnos) y retiro en nombre de otra persona; para sí misma siguen las reglas de su rol.
--   2. Administrador que también es coordinador: lo mismo.
--   3. Dueño sin roles operativos. 4. Empleada y coordinadora sin cambios (no ven las opciones de
--      administración y no cargan en nombre de otro). 5. Administrador sin manage_stock.
--   6. Permisos de las vistas y funciones nuevas.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`; fixtures con
-- prefijo 'e2500000-...' creadas acá, relativas a app.today(); no depende del seed.

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

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests.err_hint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;

grant execute on function tests.err_hint(text) to authenticated, anon;

-- Usuarios: 01 dueño, 02 admin+empleada (con manage_stock), 03 admin+coordinador (con manage_stock),
--           04 admin sin manage_stock, 05 coordinadora, 06 empleada A, 07 empleado B.
insert into auth.users (id, email, raw_user_meta_data) values
  ('e2500000-0000-0000-0000-000000000001', 'test-db0072-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Uno')),
  ('e2500000-0000-0000-0000-000000000002', 'test-db0072-admin-emp@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Empleada')),
  ('e2500000-0000-0000-0000-000000000003', 'test-db0072-admin-coord@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Coordinador')),
  ('e2500000-0000-0000-0000-000000000004', 'test-db0072-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500000-0000-0000-0000-000000000005', 'test-db0072-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500000-0000-0000-0000-000000000006', 'test-db0072-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500000-0000-0000-0000-000000000007', 'test-db0072-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500000-0000-0000-0000-000000000001', 'owner'),
  ('e2500000-0000-0000-0000-000000000002', 'admin'),
  ('e2500000-0000-0000-0000-000000000002', 'employee'),
  ('e2500000-0000-0000-0000-000000000003', 'admin'),
  ('e2500000-0000-0000-0000-000000000003', 'supervisor'),
  ('e2500000-0000-0000-0000-000000000004', 'admin'),
  ('e2500000-0000-0000-0000-000000000005', 'supervisor'),
  ('e2500000-0000-0000-0000-000000000006', 'employee'),
  ('e2500000-0000-0000-0000-000000000007', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500000-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500000-0000-0000-0000-000000000003', 'manage_stock', true),
  ('e2500000-0000-0000-0000-000000000004', 'manage_users', true),
  ('e2500000-0000-0000-0000-000000000004', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500000-0000-0000-0000-000000000002', '92720002', 'active'),
  ('e2500000-0000-0000-0000-000000000003', '92720003', 'active'),
  ('e2500000-0000-0000-0000-000000000005', '92720005', 'active'),
  ('e2500000-0000-0000-0000-000000000006', '92720006', 'active'),
  ('e2500000-0000-0000-0000-000000000007', '92720007', 'active');

insert into public.clients (id, legal_name, trade_name, status) values
  ('e2500000-0000-0000-0000-0000000000c1', 'Cliente Retiro Uno SA', 'Cliente Uno', 'active'),
  ('e2500000-0000-0000-0000-0000000000c2', 'Cliente Retiro Dos SA', null, 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500000-0000-0000-0000-0000000000a1', 'e2500000-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500000-0000-0000-0000-0000000000a2', 'e2500000-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500000-0000-0000-0000-0000000000a3', 'e2500000-0000-0000-0000-0000000000c1', 'Sede Inactiva', 'Calle 3', 'inactive');

-- Turnos (fechas relativas a hoy):
--   b1 hoy (A), b2 +5 (A), b3 +10 (A, fuera), b4 -20 (A, completado), b5 -40 (A, fuera),
--   b6 +1 cancelado (A), b7 hoy (admin+empleada 02), b8 -10 (B, completado), b9 hoy (B, sede a2).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500000-0000-0000-0000-000000000b01', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b02', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b03', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b04', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() - 20, '08:00', '12:00', 1, 'completed'),
  ('e2500000-0000-0000-0000-000000000b05', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() - 40, '08:00', '12:00', 1, 'completed'),
  ('e2500000-0000-0000-0000-000000000b07', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today(), '14:00', '18:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b08', 'e2500000-0000-0000-0000-0000000000c2', 'e2500000-0000-0000-0000-0000000000a2', app.today() - 10, '08:00', '12:00', 1, 'completed'),
  ('e2500000-0000-0000-0000-000000000b09', 'e2500000-0000-0000-0000-0000000000c2', 'e2500000-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500000-0000-0000-0000-000000000b06', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500000-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500000-0000-0000-0000-000000000b01', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b02', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b03', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b04', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b05', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b06', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b07', 'e2500000-0000-0000-0000-000000000002'),
  ('e2500000-0000-0000-0000-000000000b08', 'e2500000-0000-0000-0000-000000000007'),
  ('e2500000-0000-0000-0000-000000000b09', 'e2500000-0000-0000-0000-000000000007');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500000-0000-0000-0000-0000000000d1', 'Test 0072 categoría', 10);

insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500000-0000-0000-0000-0000000000e1', 'TR-001', 'Test lavandina', '1 L', 'e2500000-0000-0000-0000-0000000000d1', 5, 100.00, 150.00);

select app.stock_post_movement('entry', 'e2500000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object('supply_id', 'e2500000-0000-0000-0000-0000000000e1', 'qty_delta', 100)));

create function tests.shid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests.uid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-00000000000' || n)::uuid $$;
create function tests.l(p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', 'e2500000-0000-0000-0000-0000000000e1'::uuid, 'qty', p_qty) $$;
-- Turnos de la prueba que ve cada vista (se filtra por prefijo para no depender de otros datos).
create function tests.admin_shifts() returns setof uuid language sql stable as $$
  select shift_id from public.v_withdrawal_shift_options_admin where shift_id::text like 'e2500000-%' $$;
create function tests.role_shifts() returns setof uuid language sql stable as $$
  select shift_id from public.v_withdrawal_shift_options where shift_id::text like 'e2500000-%' $$;

grant execute on all functions in schema tests to authenticated, anon;

select plan(42);

-- ---------------------------------------------------------------------------------------------
-- 1. Administradora que también es empleada (02)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('test-db0072-admin-emp@example.com');

select bag_eq(
  $$select * from tests.admin_shifts()$$,
  $$values (tests.shid(1)), (tests.shid(2)), (tests.shid(4)), (tests.shid(7)), (tests.shid(8)), (tests.shid(9))$$,
  'admin+empleada: las opciones de administración son todos los turnos de -30 a +7 (sin cancelados ni fuera de ventana)'
);
select bag_eq(
  $$select * from tests.role_shifts()$$,
  $$values (tests.shid(7))$$,
  'admin+empleada: v_withdrawal_shift_options sigue siendo solo su turno (sin cambios)'
);
select is(
  (select count(*)::integer from public.v_withdrawal_site_options_admin where site_id::text like 'e2500000-%'),
  2,
  'admin+empleada: las sedes de administración son las activas (la inactiva no)'
);
select is(
  (select count(*)::integer from public.v_withdrawal_site_options where site_id::text like 'e2500000-%'),
  1,
  'admin+empleada: v_withdrawal_site_options sigue siendo solo la sede de su asignación'
);
select ok(
  (select assigned_employee_ids from public.v_withdrawal_shift_options_admin where shift_id = tests.shid(1)) = array[tests.uid(6)],
  'la vista de administración informa las personas asignadas al turno'
);

select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(4), null, null, tests.uid(6)) -> 'movement' ->> 'person_id'),
  tests.uid(6)::text,
  'admin+empleada en nombre de A con un turno de hace 20 días: queda a nombre de A'
);
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(8), null, null, tests.uid(6)) -> 'movement' ->> 'shift_id'),
  tests.shid(8)::text,
  'admin+empleada en nombre de A con un turno que no es de A (el de B): se permite'
);
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), null, tests.siteid(2), 'Reposición', tests.uid(6)) -> 'movement' ->> 'site_id'),
  tests.siteid(2)::text,
  'admin+empleada en nombre de A con una sede donde A no trabaja: se permite'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(5), null, null, tests.uid(6))$$),
  'SHIFT_NOT_ALLOWED', 'en nombre de otro, un turno de hace 40 días: SHIFT_NOT_ALLOWED');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(3), null, null, tests.uid(6))$$),
  'SHIFT_NOT_ALLOWED', 'en nombre de otro, un turno a +10 días: SHIFT_NOT_ALLOWED');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(6), null, null, tests.uid(6))$$),
  'SHIFT_NOT_AVAILABLE', 'en nombre de otro, un turno cancelado: SHIFT_NOT_AVAILABLE');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), null, tests.siteid(3), 'x', tests.uid(6))$$),
  'SITE_NOT_FOUND', 'en nombre de otro, una sede inactiva: SITE_NOT_FOUND');

-- Para sí misma rigen las reglas de su rol.
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(7)) -> 'movement' ->> 'person_id'),
  tests.uid(2)::text,
  'admin+empleada para sí misma con su turno: anda'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(1))$$),
  'SHIFT_NOT_ALLOWED', 'para sí misma, un turno de otra persona: SHIFT_NOT_ALLOWED');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(4), null, null, tests.uid(2))$$),
  'SHIFT_NOT_ALLOWED', 'para sí misma (p_person_id propio), un turno de hace 20 días: SHIFT_NOT_ALLOWED');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), null, tests.siteid(2), 'x')$$),
  'SITE_NOT_ALLOWED', 'para sí misma, una sede donde no trabaja: SITE_NOT_ALLOWED');

-- ---------------------------------------------------------------------------------------------
-- 2. Administrador que también es coordinador (03)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('test-db0072-admin-coord@example.com');

select bag_eq(
  $$select * from tests.admin_shifts()$$,
  $$values (tests.shid(1)), (tests.shid(2)), (tests.shid(4)), (tests.shid(7)), (tests.shid(8)), (tests.shid(9))$$,
  'admin+coordinador: las opciones de administración incluyen -30 a +7'
);
select bag_eq(
  $$select * from tests.role_shifts()$$,
  $$values (tests.shid(1)), (tests.shid(2)), (tests.shid(7)), (tests.shid(9))$$,
  'admin+coordinador: v_withdrawal_shift_options sigue siendo hoy a +7 (sin cambios)'
);
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(8), null, null, tests.uid(6)) -> 'movement' ->> 'person_id'),
  tests.uid(6)::text,
  'admin+coordinador en nombre de A con un turno de hace 10 días: anda'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(5), null, null, tests.uid(6))$$),
  'SHIFT_NOT_ALLOWED', 'admin+coordinador en nombre de otro, un turno de hace 40 días: SHIFT_NOT_ALLOWED');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(9)) -> 'movement' ->> 'person_id'),
  tests.uid(3)::text,
  'admin+coordinador para sí mismo con un turno de hoy: anda'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(8))$$),
  'SHIFT_NOT_ALLOWED', 'admin+coordinador para sí mismo, un turno de hace 10 días: SHIFT_NOT_ALLOWED (regla del coordinador)');

-- ---------------------------------------------------------------------------------------------
-- 3. Dueño sin roles operativos (01)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('test-db0072-owner@example.com');

select is(
  (select count(*)::integer from tests.admin_shifts()),
  6,
  'dueño: ve las opciones de administración'
);
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(4), null, null, tests.uid(7)) -> 'movement' ->> 'person_id'),
  tests.uid(7)::text,
  'dueño en nombre de B con un turno de hace 20 días: anda'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(4))$$),
  'PERSON_REQUIRED', 'dueño para sí mismo (sin rol operativo): PERSON_REQUIRED, sin cambios');

-- ---------------------------------------------------------------------------------------------
-- 4. Empleada y coordinadora: sin cambios y sin opciones de administración
-- ---------------------------------------------------------------------------------------------
select tests.as_user('test-db0072-emp-a@example.com');

select is((select count(*)::integer from public.v_withdrawal_shift_options_admin), 0, 'empleada: cero turnos de administración');
select is((select count(*)::integer from public.v_withdrawal_site_options_admin), 0, 'empleada: cero sedes de administración');
select bag_eq(
  $$select * from tests.role_shifts()$$,
  $$values (tests.shid(1)), (tests.shid(2))$$,
  'empleada: sus turnos de hoy a +7 (sin cambios)'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(1), null, null, tests.uid(7))$$),
  'FORBIDDEN', 'empleada en nombre de otro: FORBIDDEN');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(4))$$),
  'SHIFT_NOT_ALLOWED', 'empleada, un turno de hace 20 días: SHIFT_NOT_ALLOWED (sin cambios)');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(2)) -> 'movement' ->> 'person_id'),
  tests.uid(6)::text,
  'empleada con su turno a +5 días: anda'
);

select tests.as_user('test-db0072-coord@example.com');

select is((select count(*)::integer from public.v_withdrawal_shift_options_admin), 0, 'coordinadora: cero turnos de administración');
select is((select count(*)::integer from public.v_withdrawal_site_options_admin), 0, 'coordinadora: cero sedes de administración');
select bag_eq(
  $$select * from tests.role_shifts()$$,
  $$values (tests.shid(1)), (tests.shid(2)), (tests.shid(7)), (tests.shid(9))$$,
  'coordinadora: todos los turnos de hoy a +7 (sin cambios)'
);
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(1), null, null, tests.uid(6))$$),
  'FORBIDDEN', 'coordinadora en nombre de otro: FORBIDDEN');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(8))$$),
  'SHIFT_NOT_ALLOWED', 'coordinadora, un turno de hace 10 días: SHIFT_NOT_ALLOWED (sin cambios)');

-- ---------------------------------------------------------------------------------------------
-- 5. Administrador sin manage_stock (04)
-- ---------------------------------------------------------------------------------------------
select tests.as_user('test-db0072-admin-sin@example.com');

select is((select count(*)::integer from public.v_withdrawal_shift_options_admin), 0, 'admin sin manage_stock: cero turnos de administración');
select is((select count(*)::integer from public.v_withdrawal_site_options_admin), 0, 'admin sin manage_stock: cero sedes de administración');
select is(tests.err_hint($$select public.register_withdrawal(jsonb_build_array(tests.l(1)), tests.shid(1), null, null, tests.uid(6))$$),
  'FORBIDDEN', 'admin sin manage_stock en nombre de otro: FORBIDDEN');

-- ---------------------------------------------------------------------------------------------
-- 6. Permisos de las vistas y de las funciones
-- ---------------------------------------------------------------------------------------------
set local role postgres;

select ok(
  not has_table_privilege('anon', 'public.v_withdrawal_shift_options_admin', 'select')
  and not has_table_privilege('anon', 'public.v_withdrawal_site_options_admin', 'select')
  and has_table_privilege('authenticated', 'public.v_withdrawal_shift_options_admin', 'select')
  and has_table_privilege('authenticated', 'public.v_withdrawal_site_options_admin', 'select'),
  'las vistas de administración: select para authenticated, nada para anon'
);
select ok(
  not has_function_privilege('anon', 'app.withdrawal_shift_options_admin()', 'execute')
  and not has_function_privilege('anon', 'app.withdrawal_site_options_admin()', 'execute'),
  'las funciones de administración no las ejecuta anon'
);
select ok(
  (select bool_and(coalesce(c.reloptions, '{}') @> array['security_invoker=true'])
   from pg_class c
   where c.oid in ('public.v_withdrawal_shift_options_admin'::regclass, 'public.v_withdrawal_site_options_admin'::regclass)),
  'las dos vistas nuevas son security_invoker'
);

select * from finish();

rollback;
