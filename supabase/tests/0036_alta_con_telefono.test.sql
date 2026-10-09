-- pgTAP de la migración 0036_alta_con_telefono.sql: admin_create_user_records guarda el
-- teléfono del alta en profiles.phone (antes se perdía).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c3600000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3600000-0000-0000-0000-000000000001', 'test-0036-actor@example.com', jsonb_build_object('first_name', 'Actor', 'last_name', 'Dueño')),
  ('c3600000-0000-0000-0000-000000000002', 'test-0036-con-telefono@example.com', jsonb_build_object('first_name', 'Con', 'last_name', 'Telefono')),
  ('c3600000-0000-0000-0000-000000000003', 'test-0036-sin-telefono@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Telefono'));

insert into public.user_roles (profile_id, role) values
  ('c3600000-0000-0000-0000-000000000001', 'owner');

select hasnt_function(
  'public', 'admin_create_user_records',
  array['uuid', 'uuid', 'text', 'text', 'app_role[]', 'jsonb'],
  'la firma de 0035 sin teléfono ya no existe'
);

select public.admin_create_user_records(
  'c3600000-0000-0000-0000-000000000002', 'c3600000-0000-0000-0000-000000000001',
  'Con', 'Telefono', array['employee']::public.app_role[],
  jsonb_build_object('dni', '90360002', 'employee_number', 90360002),
  ' 2477 123456 '
);
select is(
  (select phone from public.profiles where id = 'c3600000-0000-0000-0000-000000000002'),
  '2477 123456',
  'el teléfono del alta queda en el perfil, sin espacios a los costados'
);

select public.admin_create_user_records(
  'c3600000-0000-0000-0000-000000000003', 'c3600000-0000-0000-0000-000000000001',
  'Sin', 'Telefono', array['employee']::public.app_role[],
  jsonb_build_object('dni', '90360003', 'employee_number', 90360003),
  ''
);
select is(
  (select phone from public.profiles where id = 'c3600000-0000-0000-0000-000000000003'),
  null,
  'un teléfono vacío queda en null'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'authenticated sigue sin poder ejecutarla'
);

select * from finish();

rollback;
