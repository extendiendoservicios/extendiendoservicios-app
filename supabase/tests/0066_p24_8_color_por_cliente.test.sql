-- pgTAP de la migración 0066_p24_8_color_por_cliente.sql (P24.8, decisión de Mike, maqueta B).
--   clients.calendar_color: columna not null con check 0..11; backfill determinístico (la misma
--   sentencia de la migración, probada sobre clientes de 1990 que quedan primeros en el orden);
--   trigger de asignación (el menos usado, empate al más bajo, valor explícito respetado); solo el
--   dueño y los administradores lo cambian; expuesto en v_shifts_board (client_calendar_color),
--   v_assignments_board (client_calendar_color) y v_clients (calendar_color).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6600000-...'. Dentro de la transacción se llevan todos los clientes
-- existentes al color 11 para que el trigger parta de un estado conocido; el rollback lo deshace.

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


select plan(29);

-- ---------------------------------------------------------------------------------------------
-- 1. Estructura
-- ---------------------------------------------------------------------------------------------

select has_column('public', 'clients', 'calendar_color', 'clients.calendar_color existe');
select col_type_is('public', 'clients', 'calendar_color', 'smallint', 'clients.calendar_color es smallint');
select col_not_null('public', 'clients', 'calendar_color', 'clients.calendar_color es not null');
select has_trigger('public', 'clients', 'trg_assign_calendar_color', 'clients tiene el trigger de asignación');
select ok(
  not has_function_privilege('authenticated', 'app.assign_client_calendar_color()', 'execute')
  and not has_function_privilege('anon', 'app.assign_client_calendar_color()', 'execute'),
  'app.assign_client_calendar_color no la ejecuta ni authenticated ni anon'
);
select col_type_is('public', 'v_clients', 'calendar_color', 'smallint', 'v_clients.calendar_color es smallint');
select col_type_is('public', 'v_shifts_board', 'client_calendar_color', 'smallint', 'v_shifts_board.client_calendar_color es smallint');
select col_type_is('public', 'v_assignments_board', 'client_calendar_color', 'smallint', 'v_assignments_board.client_calendar_color es smallint');
select ok(
  has_table_privilege('authenticated', 'public.v_clients', 'select')
  and has_table_privilege('authenticated', 'public.v_shifts_board', 'select')
  and has_table_privilege('authenticated', 'public.v_assignments_board', 'select')
  and not has_table_privilege('anon', 'public.v_clients', 'select')
  and not has_table_privilege('anon', 'public.v_shifts_board', 'select')
  and not has_table_privilege('anon', 'public.v_assignments_board', 'select'),
  'los grants de las tres vistas se conservan'
);

-- ---------------------------------------------------------------------------------------------
-- 2. Fixtures de usuarios
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6600000-0000-0000-0000-000000000081', 'test-db066-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Color')),
  ('f6600000-0000-0000-0000-000000000082', 'test-db066-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Color')),
  ('f6600000-0000-0000-0000-000000000091', 'test-db066-sup@example.com', jsonb_build_object('first_name', 'Sara', 'last_name', 'Coordina')),
  ('f6600000-0000-0000-0000-000000000093', 'test-db066-emp@example.com', jsonb_build_object('first_name', 'Eva', 'last_name', 'Empleada'));

insert into public.user_roles (profile_id, role) values
  ('f6600000-0000-0000-0000-000000000081', 'owner'),
  ('f6600000-0000-0000-0000-000000000082', 'admin'),
  ('f6600000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6600000-0000-0000-0000-000000000093', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f6600000-0000-0000-0000-000000000091', '96600091', 'active'),
  ('f6600000-0000-0000-0000-000000000093', '96600093', 'active');

-- ---------------------------------------------------------------------------------------------
-- 3. Backfill determinístico (la misma sentencia de la migración)
-- ---------------------------------------------------------------------------------------------

-- 14 clientes de 1990 (quedan primeros en el orden por created_at). Los dos últimos comparten
-- created_at: los desempata el id. Se insertan con color explícito 11 y el backfill los reordena.
insert into public.clients (id, legal_name, status, created_at, calendar_color)
select ('f6600000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       'Cliente de 1990 número ' || n,
       'active',
       case when n >= 13 then timestamptz '1990-01-13 00:00+00' else timestamptz '1990-01-01 00:00+00' + (n || ' days')::interval end,
       11
from generate_series(1, 14) as n;

update public.clients c
set calendar_color = ((r.rn - 1) % 12)::smallint
from (
  select id, row_number() over (order by created_at, id)::integer as rn
  from public.clients
) r
where r.id = c.id;

select results_eq(
  $$select calendar_color::integer from public.clients where legal_name like 'Cliente de 1990 número %' order by created_at, id limit 12$$,
  $$select generate_series(0, 11)$$,
  'backfill: los primeros 12 clientes reciben 0, 1, 2 ... 11 en orden de created_at'
);
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000113'),
  0,
  'backfill: el cliente 13 vuelve a empezar en 0'
);
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000114'),
  1,
  'backfill: el cliente 14, con el mismo created_at que el 13, sigue en 1 (desempata el id)'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Trigger de asignación (partiendo de un estado conocido: todos los clientes en 11)
-- ---------------------------------------------------------------------------------------------

update public.clients set calendar_color = 11;

insert into public.clients (id, legal_name, status)
select ('f6600000-0000-0000-0000-0000000002' || lpad(n::text, 2, '0'))::uuid, 'Cliente nuevo ' || n, 'active'
from generate_series(1, 11) as n;

select results_eq(
  $$select calendar_color::integer from public.clients where legal_name like 'Cliente nuevo %' order by id$$,
  $$select generate_series(0, 10)$$,
  'trigger: once altas seguidas toman 0, 1 ... 10 (el menos usado, empate al más bajo)'
);

insert into public.clients (id, legal_name, status) values
  ('f6600000-0000-0000-0000-000000000212', 'Cliente nuevo 12', 'active');
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000212'),
  0,
  'trigger: con 0..10 usados una vez y el 11 muchas, la alta siguiente empata y toma el más bajo (0)'
);

-- Un cliente cerrado y dado de baja lógica cuenta igual: ahora el 0 y el 3 están usados dos veces.
insert into public.clients (id, legal_name, status, deleted_at, calendar_color) values
  ('f6600000-0000-0000-0000-000000000213', 'Cliente de baja', 'closed', now(), 3);
insert into public.clients (id, legal_name, status) values
  ('f6600000-0000-0000-0000-000000000214', 'Cliente nuevo 14', 'active');
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000214'),
  1,
  'trigger: cuentan también los clientes cerrados y de baja (0 y 3 con dos usos, gana el 1)'
);

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f6600000-0000-0000-0000-000000000215', 'Cliente con color explícito', 'active', 7);
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000215'),
  7,
  'trigger: un color explícito se respeta'
);

-- Usos: 0, 1, 3 y 7 dos veces; 2, 4, 5, 6, 8, 9 y 10 una vez; el 11 muchas. Gana el 2.
insert into public.clients (id, legal_name, status) values
  ('f6600000-0000-0000-0000-000000000216', 'Cliente nuevo 16', 'active');
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000216'),
  2,
  'trigger: gana el menos usado y, entre empatados, el más bajo (2)'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Check 0..11 y not null
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.clients (id, legal_name, status, calendar_color) values ('f6600000-0000-0000-0000-000000000217', 'Cliente fuera de paleta', 'active', 12)$$,
  '23514', null, 'check: 12 no es un color válido'
);
select throws_ok(
  $$insert into public.clients (id, legal_name, status, calendar_color) values ('f6600000-0000-0000-0000-000000000218', 'Cliente fuera de paleta', 'active', -1)$$,
  '23514', null, 'check: -1 no es un color válido'
);
select throws_ok(
  $$update public.clients set calendar_color = null where id = 'f6600000-0000-0000-0000-000000000216'$$,
  '23502', null, 'not null: el color no puede quedar vacío'
);

-- ---------------------------------------------------------------------------------------------
-- 6. Quién lo cambia
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db066-owner@example.com');
update public.clients set calendar_color = 4 where id = 'f6600000-0000-0000-0000-000000000216';
set local role postgres;
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000216'),
  4, 'el dueño cambia el color de un cliente'
);

select tests.as_user('test-db066-admin@example.com');
update public.clients set calendar_color = 5 where id = 'f6600000-0000-0000-0000-000000000216';
set local role postgres;
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000216'),
  5, 'el administrador cambia el color de un cliente'
);

select tests.as_user('test-db066-sup@example.com');
update public.clients set calendar_color = 9 where id = 'f6600000-0000-0000-0000-000000000216';
set local role postgres;
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000216'),
  5, 'el coordinador no cambia el color (RLS: 0 filas)'
);

select tests.as_user('test-db066-emp@example.com');
update public.clients set calendar_color = 9 where id = 'f6600000-0000-0000-0000-000000000216';
set local role postgres;
select is(
  (select calendar_color::integer from public.clients where id = 'f6600000-0000-0000-0000-000000000216'),
  5, 'el empleado no cambia el color (RLS: 0 filas)'
);

select tests.as_user('test-db066-admin@example.com');
select throws_ok(
  $$update public.clients set calendar_color = 12 where id = 'f6600000-0000-0000-0000-000000000216'$$,
  '23514', null, 'el administrador tampoco puede salirse de 0..11'
);
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 7. Vistas
-- ---------------------------------------------------------------------------------------------

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f6600000-0000-0000-0000-000000000311', 'f6600000-0000-0000-0000-000000000216', 'Sede de color', 'Dirección 1', -34.6, -58.4, 'active');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6600000-0000-0000-0000-000000000341', 'f6600000-0000-0000-0000-000000000216', 'f6600000-0000-0000-0000-000000000311', app.today(), '08:00', '12:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id, status) values
  ('f6600000-0000-0000-0000-000000000351', 'f6600000-0000-0000-0000-000000000341', 'f6600000-0000-0000-0000-000000000093', 'expected');

select tests.as_user('test-db066-admin@example.com');
select is(
  (select client_calendar_color::integer from public.v_shifts_board where id = 'f6600000-0000-0000-0000-000000000341'),
  5, 'v_shifts_board trae client_calendar_color'
);
select is(
  (select client_calendar_color::integer from public.v_assignments_board where id = 'f6600000-0000-0000-0000-000000000351'),
  5, 'v_assignments_board trae client_calendar_color'
);
select is(
  (select calendar_color::integer from public.v_clients where id = 'f6600000-0000-0000-0000-000000000216'),
  5, 'v_clients trae calendar_color'
);
select is(
  (select count(*)::integer from public.v_clients where calendar_color is null),
  0, 'v_clients no tiene clientes sin color'
);

select * from finish();

rollback;
