-- pgTAP de la migración 0035_altas_atomicas.sql: admin_find_orphan_account y
-- admin_create_user_records (defecto del 9 oct 2026 en producción: altas que quedaban a medias
-- cuando el legajo provisorio chocaba con uno cargado a mano).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c3500000-...'. Legajos y
-- DNI de prueba en el rango 903500xx, lejos de los datos de App_dev.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(23);

-- Fixtures ----------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3500000-0000-0000-0000-000000000001', 'test-0035-actor@example.com', jsonb_build_object('first_name', 'Actor', 'last_name', 'Dueño')),
  ('c3500000-0000-0000-0000-000000000002', 'test-0035-existente@example.com', jsonb_build_object('first_name', 'Ya', 'last_name', 'Cargada')),
  ('c3500000-0000-0000-0000-000000000003', 'test-0035-a-medias@example.com', jsonb_build_object('first_name', 'Primer', 'last_name', 'Intento')),
  ('c3500000-0000-0000-0000-000000000004', 'test-0035-admin@example.com', jsonb_build_object('first_name', 'Nueva', 'last_name', 'Admin')),
  ('c3500000-0000-0000-0000-000000000005', 'test-0035-inactiva@example.com', jsonb_build_object('first_name', 'Dada', 'last_name', 'DeBaja')),
  ('c3500000-0000-0000-0000-000000000006', 'test-0035-sin-legajo@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Legajo'));

insert into public.user_roles (profile_id, role) values
  ('c3500000-0000-0000-0000-000000000001', 'owner'),
  ('c3500000-0000-0000-0000-000000000002', 'employee');

insert into public.employees (profile_id, employee_number, dni) values
  ('c3500000-0000-0000-0000-000000000002', 90350001, '90350001');

update public.profiles set is_active = false, deleted_at = now()
where id = 'c3500000-0000-0000-0000-000000000005';

-- Existencia y permisos ---------------------------------------------------------------------

select has_function('public', 'admin_find_orphan_account', array['text']);
select has_function('public', 'admin_create_user_records', array['uuid', 'uuid', 'text', 'text', 'app_role[]', 'jsonb', 'text']);

select ok(
  not has_function_privilege('authenticated', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'admin_create_user_records: ni authenticated ni anon la pueden ejecutar'
);
select ok(
  has_function_privilege('service_role', 'public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)', 'execute'),
  'admin_create_user_records: service_role la puede ejecutar'
);
select ok(
  not has_function_privilege('authenticated', 'public.admin_find_orphan_account(text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_find_orphan_account(text)', 'execute'),
  'admin_find_orphan_account: ni authenticated ni anon la pueden ejecutar'
);
select ok(
  has_function_privilege('service_role', 'public.admin_find_orphan_account(text)', 'execute'),
  'admin_find_orphan_account: service_role la puede ejecutar'
);

-- admin_find_orphan_account -----------------------------------------------------------------

select is(
  public.admin_find_orphan_account('  TEST-0035-A-MEDIAS@example.com '),
  'c3500000-0000-0000-0000-000000000003'::uuid,
  'encuentra la cuenta sin roles ni ficha, sin importar mayúsculas ni espacios'
);
select is(
  public.admin_find_orphan_account('test-0035-existente@example.com'),
  null,
  'una cuenta con roles y ficha no se retoma'
);
select is(
  public.admin_find_orphan_account('test-0035-inactiva@example.com'),
  null,
  'una cuenta dada de baja no se retoma'
);
select is(
  public.admin_find_orphan_account('nadie-0035@example.com'),
  null,
  'un email que no existe devuelve null'
);

-- Legajo repetido: no deja nada a medias -----------------------------------------------------

select throws_ok(
  $$ select public.admin_create_user_records(
       'c3500000-0000-0000-0000-000000000003', 'c3500000-0000-0000-0000-000000000001',
       'Nora', 'Celeste', array['employee']::public.app_role[],
       jsonb_build_object('dni', '90350002', 'employee_number', 90350001)) $$,
  'P0001',
  'Ese legajo ya está en uso.',
  'legajo repetido: EMPLOYEE_NUMBER_IN_USE (antes se informaba como DNI repetido)'
);
select is(
  (select count(*)::int from public.user_roles where profile_id = 'c3500000-0000-0000-0000-000000000003'),
  0,
  'tras el legajo repetido no quedó ningún rol'
);
select is(
  public.admin_find_orphan_account('test-0035-a-medias@example.com'),
  'c3500000-0000-0000-0000-000000000003'::uuid,
  'tras el legajo repetido la cuenta sigue disponible para retomarla'
);

select throws_ok(
  $$ select public.admin_create_user_records(
       'c3500000-0000-0000-0000-000000000003', 'c3500000-0000-0000-0000-000000000001',
       'Nora', 'Celeste', array['employee']::public.app_role[],
       jsonb_build_object('dni', '90350001', 'employee_number', 90350003)) $$,
  'P0001',
  'Ese DNI ya está registrado.',
  'DNI repetido: DNI_IN_USE'
);

select throws_ok(
  $$ select public.admin_create_user_records(
       'c3500000-0000-0000-0000-000000000003', 'c3500000-0000-0000-0000-000000000001',
       'Nora', 'Celeste', array['employee']::public.app_role[], null) $$,
  'P0001',
  'Para asignar el rol de empleado o supervisor hace falta cargar los datos de empleado (al menos el DNI).',
  'rol de empleado sin ficha: EMPLOYEE_DATA_REQUIRED'
);

-- Alta completa con el legajo pedido (retomando la cuenta a medias) ----------------------------

select is(
  public.admin_create_user_records(
    'c3500000-0000-0000-0000-000000000003', 'c3500000-0000-0000-0000-000000000001',
    ' Nora Celeste ', 'O', array['employee', 'supervisor']::public.app_role[],
    jsonb_build_object('dni', '90350003', 'employee_number', 90350003, 'cuil', '', 'birth_date', '1990-05-04')
  ) ->> 'employee_number',
  '90350003',
  'devuelve el legajo pedido'
);
select results_eq(
  $$ select employee_number, dni, cuil, birth_date, created_by from public.employees
     where profile_id = 'c3500000-0000-0000-0000-000000000003' $$,
  $$ values (90350003, '90350003'::text, null::text, '1990-05-04'::date, 'c3500000-0000-0000-0000-000000000001'::uuid) $$,
  'la ficha nace con el legajo pedido; los textos vacíos quedan en null'
);
select results_eq(
  $$ select role::text from public.user_roles
     where profile_id = 'c3500000-0000-0000-0000-000000000003' order by role::text $$,
  $$ values ('employee'), ('supervisor') $$,
  'quedan los dos roles'
);
select results_eq(
  $$ select first_name, last_name from public.profiles where id = 'c3500000-0000-0000-0000-000000000003' $$,
  $$ values ('Nora Celeste'::text, 'O'::text) $$,
  'el perfil toma el nombre del alta nueva, no el del primer intento'
);
select is(
  public.admin_find_orphan_account('test-0035-a-medias@example.com'),
  null,
  'ya completa, la cuenta deja de ser retomable'
);

-- Administrador: siete capacidades -----------------------------------------------------------

select public.admin_create_user_records(
  'c3500000-0000-0000-0000-000000000004', 'c3500000-0000-0000-0000-000000000001',
  'Nueva', 'Admin', array['admin']::public.app_role[], null
);
select is(
  (select count(*)::int from public.admin_capabilities
   where profile_id = 'c3500000-0000-0000-0000-000000000004' and enabled),
  7,
  'un administrador nuevo queda con las siete capacidades activas'
);
select is(
  (select count(*)::int from public.employees where profile_id = 'c3500000-0000-0000-0000-000000000004'),
  0,
  'un administrador sin datos de empleado no tiene ficha'
);

-- Sin legajo pedido: el más alto + 1 --------------------------------------------------------

select is(
  (public.admin_create_user_records(
    'c3500000-0000-0000-0000-000000000006', 'c3500000-0000-0000-0000-000000000001',
    'Sin', 'Legajo', array['employee']::public.app_role[],
    jsonb_build_object('dni', '90350006')
  ) ->> 'employee_number')::int,
  -- Mismo instante que la llamada: el máximo todavía no incluye la ficha que crea la función.
  (select max(employee_number) + 1 from public.employees),
  'sin legajo pedido, toma el más alto + 1'
);

select * from finish();

rollback;
