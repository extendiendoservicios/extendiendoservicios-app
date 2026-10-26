-- pgTAP de la migración 0067_p24_8_color_por_defecto.sql (corrección de 0066): clients.calendar_color
-- tiene valor por defecto (el menos usado), el trigger cubre el null explícito y el valor explícito
-- se respeta. Convención (ver supabase/tests/README.md): transacción con `rollback`. Fixtures
-- propios: 'f6700000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(7);

select has_function('app', 'next_client_calendar_color', 'existe app.next_client_calendar_color()');
select ok(
  has_function_privilege('authenticated', 'app.next_client_calendar_color()', 'execute')
  and not has_function_privilege('anon', 'app.next_client_calendar_color()', 'execute'),
  'app.next_client_calendar_color la ejecuta authenticated y no anon'
);
select ok(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'clients' and column_name = 'calendar_color') like '%next_client_calendar_color%',
  'clients.calendar_color tiene el valor por defecto de la función'
);

-- Estado conocido: todos los clientes existentes en 11.
update public.clients set calendar_color = 11;

insert into public.clients (id, legal_name, status) values
  ('f6700000-0000-0000-0000-000000000001', 'Cliente por defecto uno', 'active');
select is(
  (select calendar_color::integer from public.clients where id = 'f6700000-0000-0000-0000-000000000001'),
  0, 'un insert sin color toma el menos usado (0)'
);

insert into public.clients (id, legal_name, status) values
  ('f6700000-0000-0000-0000-000000000002', 'Cliente por defecto dos', 'active');
select is(
  (select calendar_color::integer from public.clients where id = 'f6700000-0000-0000-0000-000000000002'),
  1, 'el siguiente toma el 1 (el 0 ya tiene un uso)'
);

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f6700000-0000-0000-0000-000000000003', 'Cliente con null explícito', 'active', null);
select is(
  (select calendar_color::integer from public.clients where id = 'f6700000-0000-0000-0000-000000000003'),
  2, 'un null explícito lo resuelve el trigger (2)'
);

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f6700000-0000-0000-0000-000000000004', 'Cliente con color explícito', 'active', 9);
select is(
  (select calendar_color::integer from public.clients where id = 'f6700000-0000-0000-0000-000000000004'),
  9, 'un valor explícito se respeta'
);

select * from finish();

rollback;
