-- pgTAP de la migración 0003_profiles_roles_capabilities.sql (DB-003, DB-005).
--
-- Cubre: estructura y restricciones de profiles/user_roles/admin_capabilities, RLS habilitada
-- (todavía sin políticas: llegan en 0012, DB-014), los triggers app.handle_new_user() y
-- app.prevent_last_owner_removal(), y una comprobación de que "RLS habilitada + cero
-- políticas" deniega a `authenticated` (sanity check del diseño, ver nota de seguridad en la
-- migración). Las funciones de permisos y el hook del token tienen su propio archivo
-- (0003_profiles_roles_capabilities_permissions.test.sql), porque necesitan tests.as_user.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- Estructura --------------------------------------------------------------------------------

select has_table('public', 'profiles', 'existe public.profiles');
select has_table('public', 'user_roles', 'existe public.user_roles');
select has_table('public', 'admin_capabilities', 'existe public.admin_capabilities');

select columns_are(
  'public', 'profiles',
  array[
    'id', 'first_name', 'last_name', 'contact_email', 'phone', 'avatar_path',
    'location_consent_at', 'last_seen_changes_at', 'is_active',
    'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'
  ],
  'profiles tiene exactamente las columnas de 04 sección 2.1'
);

select columns_are(
  'public', 'user_roles',
  array['profile_id', 'role', 'granted_by', 'granted_at'],
  'user_roles tiene exactamente las columnas de 04 sección 2.1'
);

select columns_are(
  'public', 'admin_capabilities',
  array['profile_id', 'capability', 'enabled', 'updated_by', 'updated_at'],
  'admin_capabilities tiene exactamente las columnas de 04 sección 2.1'
);

select has_pk('public', 'profiles', 'profiles tiene primary key');
select col_is_pk('public', 'user_roles', array['profile_id', 'role'], 'user_roles: PK (profile_id, role)');
select col_is_pk('public', 'admin_capabilities', array['profile_id', 'capability'], 'admin_capabilities: PK (profile_id, capability)');

select col_not_null('public', 'profiles', 'first_name', 'profiles.first_name not null');
select col_not_null('public', 'profiles', 'last_name', 'profiles.last_name not null');
select col_not_null('public', 'profiles', 'is_active', 'profiles.is_active not null');
select col_default_is('public', 'profiles', 'is_active', 'true', 'profiles.is_active default true');
select col_default_is('public', 'profiles', 'created_at', 'now()', 'profiles.created_at default now()');

select col_not_null('public', 'user_roles', 'profile_id', 'user_roles.profile_id not null');
select col_not_null('public', 'user_roles', 'role', 'user_roles.role not null');
select col_default_is('public', 'user_roles', 'granted_at', 'now()', 'user_roles.granted_at default now()');

select col_not_null('public', 'admin_capabilities', 'profile_id', 'admin_capabilities.profile_id not null');
select col_not_null('public', 'admin_capabilities', 'capability', 'admin_capabilities.capability not null');
select col_not_null('public', 'admin_capabilities', 'enabled', 'admin_capabilities.enabled not null');
select col_default_is('public', 'admin_capabilities', 'updated_at', 'now()', 'admin_capabilities.updated_at default now()');

select has_index('public', 'profiles', 'profiles_last_name_first_name_idx', 'profiles: índice de búsqueda por nombre (04 sección 8)');

-- Claves foráneas: se consulta pg_constraint directo (no information_schema): la vista
-- information_schema.constraint_column_usage no lista la tabla referenciada cuando el rol
-- actual no es dueño de esa tabla (es el caso de auth.users, de supabase_auth_admin),
-- verificado en App_dev -- da vacío ahí aunque pg_constraint sí tiene la fila. --------------

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and confrelid = 'auth.users'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (id) REFERENCES auth.users(id)'
  ),
  'profiles.id referencia auth.users.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (profile_id) REFERENCES profiles(id)'
  ),
  'user_roles.profile_id referencia public.profiles.id'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_capabilities'::regclass
      and contype = 'f'
      and confrelid = 'public.profiles'::regclass
      and pg_get_constraintdef(oid) = 'FOREIGN KEY (profile_id) REFERENCES profiles(id)'
  ),
  'admin_capabilities.profile_id referencia public.profiles.id'
);

-- RLS habilitada (sin políticas todavía, ver nota de seguridad de la migración) --------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles tiene RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass),
  'user_roles tiene RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_capabilities'::regclass),
  'admin_capabilities tiene RLS habilitada'
);

-- Triggers (existencia; el comportamiento de app.set_updated_at ya se probó en 0001) ---------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles' and t.tgname = 'trg_set_updated_at'
  ),
  'profiles tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'admin_capabilities' and t.tgname = 'trg_set_updated_at'
  ),
  'admin_capabilities tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'trg_handle_new_user'
  ),
  'auth.users tiene el trigger trg_handle_new_user'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_roles' and t.tgname = 'trg_prevent_last_owner_removal'
  ),
  'user_roles tiene el trigger trg_prevent_last_owner_removal'
);

-- app.handle_new_user(): insertar en auth.users crea la fila de profiles -------------------

insert into auth.users (id, email, raw_user_meta_data)
values (
  'a0000000-0000-0000-0000-000000000003',
  'test-db003-newuser@example.com',
  jsonb_build_object('first_name', 'Noelia', 'last_name', 'Fernández')
);

select is(
  (select first_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
  'Noelia',
  'handle_new_user: copia first_name de raw_user_meta_data'
);
select is(
  (select last_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
  'Fernández',
  'handle_new_user: copia last_name de raw_user_meta_data'
);
select is(
  (select is_active from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
  true,
  'handle_new_user: is_active nace en true'
);
select ok(
  (select deleted_at is null from public.profiles where id = 'a0000000-0000-0000-0000-000000000003'),
  'handle_new_user: deleted_at nace en null'
);

-- app.handle_new_user(): sin raw_user_meta_data, nombre y apellido quedan en '' (no bloquea
-- el alta; ver comentario de la función en la migración) -------------------------------------

insert into auth.users (id, email)
values ('a0000000-0000-0000-0000-000000000004', 'test-db003-nometadata@example.com');

select is(
  (select first_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000004'),
  '',
  'handle_new_user: sin metadata, first_name queda en cadena vacía'
);
select is(
  (select last_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000004'),
  '',
  'handle_new_user: sin metadata, last_name queda en cadena vacía'
);

-- app.prevent_last_owner_removal(): último owner -------------------------------------------

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-0000-0000-000000000001', 'test-db003-owner-a@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'A')),
  ('a0000000-0000-0000-0000-000000000002', 'test-db003-owner-b@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'B')),
  ('a0000000-0000-0000-0000-000000000005', 'test-db003-supervisor@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'C'));

insert into public.user_roles (profile_id, role) values
  ('a0000000-0000-0000-0000-000000000001', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', 'owner'),
  ('a0000000-0000-0000-0000-000000000005', 'supervisor');

-- Neutraliza cualquier otro owner preexistente (por ejemplo, el owner real que agregue el
-- seed de DB-019 más adelante) para que el resto de esta sección pruebe el trigger de forma
-- determinística, sin depender de cuántos owners haya en la base al momento de correr los
-- tests. Seguro: si no hay ninguno (el estado de hoy), no borra nada; si hay uno, la
-- eliminación no dispara LAST_OWNER porque en este punto ya existen los dos owners de este
-- test. Toda la transacción termina en rollback: no deja rastro en ningún caso.
delete from public.user_roles
where role = 'owner'
  and profile_id not in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');

select lives_ok(
  $$delete from public.user_roles where profile_id = 'a0000000-0000-0000-0000-000000000001' and role = 'owner'$$,
  'permite quitar el rol owner a una persona cuando queda otro owner'
);

select lives_ok(
  $$delete from public.user_roles where profile_id = 'a0000000-0000-0000-0000-000000000005' and role = 'supervisor'$$,
  'permite quitar un rol que no es owner sin restricción'
);

prepare trg_delete_last_owner as
  delete from public.user_roles where profile_id = 'a0000000-0000-0000-0000-000000000002' and role = 'owner';

select throws_ok(
  'trg_delete_last_owner',
  'P0001',
  'No se puede quitar al último dueño.',
  'rechaza borrar el rol owner de la última persona que lo tiene'
);

prepare trg_update_last_owner as
  update public.user_roles set role = 'admin' where profile_id = 'a0000000-0000-0000-0000-000000000002' and role = 'owner';

select throws_ok(
  'trg_update_last_owner',
  'P0001',
  'No se puede quitar al último dueño.',
  'rechaza cambiar el rol owner de la última persona que lo tiene'
);

-- RLS habilitada + cero políticas deniega a authenticated (sanity check, ver nota de --------
-- seguridad de la migración; las políticas reales llegan en 0012, DB-014) --------------------

set local role authenticated;

select is(
  (select count(*)::int from public.profiles),
  0,
  'profiles: sin políticas, authenticated no ve ninguna fila'
);
select is(
  (select count(*)::int from public.user_roles),
  0,
  'user_roles: sin políticas, authenticated no ve ninguna fila'
);
select is(
  (select count(*)::int from public.admin_capabilities),
  0,
  'admin_capabilities: sin políticas, authenticated no ve ninguna fila'
);

select * from finish();

rollback;
