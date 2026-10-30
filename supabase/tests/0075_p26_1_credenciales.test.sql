-- pgTAP de la migración 0075_p26_1_credenciales.sql (P26.1, CR-09).
--   Cubre: la enumeración credential_source, la estructura y las restricciones de
--   account_credentials, los tipos de evento nuevos de security_events y, sobre todo, que la tabla
--   esté CERRADA: ni anon ni authenticated (dueño, administrador, supervisor, empleado) pueden
--   leerla ni escribirla, que no la exponga ninguna vista ni función y que solo service_role
--   tenga acceso.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'c2600000-...'. Los usuarios los crea este mismo archivo; no depende del seed ni
-- del orden de ejecución.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0075;
grant usage on schema tests_0075 to authenticated, anon;

create or replace function tests_0075.as_user(p_email text)
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
    raise exception 'tests_0075.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0075.as_user(text) to authenticated, anon;

-- Fixtures: un usuario por rol más una persona sin rol de acceso.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c2600000-0000-0000-0000-000000000001', 'test-db0075-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Credenciales')),
  ('c2600000-0000-0000-0000-000000000002', 'test-db0075-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Credenciales')),
  ('c2600000-0000-0000-0000-000000000003', 'test-db0075-sup@example.com', jsonb_build_object('first_name', 'Supervisora', 'last_name', 'Credenciales')),
  ('c2600000-0000-0000-0000-000000000004', 'test-db0075-emp@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Credenciales'));

insert into public.user_roles (profile_id, role) values
  ('c2600000-0000-0000-0000-000000000001', 'owner'),
  ('c2600000-0000-0000-0000-000000000002', 'admin'),
  ('c2600000-0000-0000-0000-000000000003', 'supervisor'),
  ('c2600000-0000-0000-0000-000000000004', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c2600000-0000-0000-0000-000000000002', 'manage_users', true);

insert into public.employees (profile_id, dni, status) values
  ('c2600000-0000-0000-0000-000000000003', '92600003', 'active'),
  ('c2600000-0000-0000-0000-000000000004', '92600004', 'active');

-- Una copia del empleado, cargada como lo haría la función (texto cifrado ficticio, no una clave real).
insert into public.account_credentials (profile_id, ciphertext, iv, key_version, source, set_by) values
  ('c2600000-0000-0000-0000-000000000004', 'Y2lmcmFkby1maWN0aWNpbw==', 'aXYtZmljdGljaW8x', 1, 'created', 'c2600000-0000-0000-0000-000000000001');

select plan(54);

-- ---------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------

select enum_has_labels(
  'public', 'credential_source',
  array['created', 'admin_reset', 'self_change', 'recovery', 'initial_delivery'],
  'credential_source tiene los cinco orígenes de CR-11'
);

select has_table('public', 'account_credentials', 'existe public.account_credentials');
select columns_are(
  'public', 'account_credentials',
  array['profile_id', 'ciphertext', 'iv', 'key_version', 'source', 'set_at', 'set_by'],
  'account_credentials tiene exactamente las columnas de la especificación'
);
select col_is_pk('public', 'account_credentials', 'profile_id', 'profile_id es la clave primaria (una fila por persona)');
select col_is_fk('public', 'account_credentials', 'profile_id', 'profile_id referencia a profiles');
select col_type_is('public', 'account_credentials', 'ciphertext', 'text', 'ciphertext es text (base64)');
select col_type_is('public', 'account_credentials', 'iv', 'text', 'iv es text (base64)');
select col_type_is('public', 'account_credentials', 'source', 'credential_source', 'source usa la enumeración');
select col_not_null('public', 'account_credentials', 'ciphertext', 'ciphertext es obligatorio');
select col_not_null('public', 'account_credentials', 'iv', 'iv es obligatorio');
select col_not_null('public', 'account_credentials', 'source', 'source es obligatorio');

select is(
  (select relrowsecurity from pg_class where oid = 'public.account_credentials'::regclass),
  true,
  'account_credentials tiene RLS habilitada'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'account_credentials'),
  0,
  'account_credentials no tiene ninguna política (nadie la lee por RLS)'
);

-- ---------------------------------------------------------------------------------------------
-- Restricciones
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-000000000004', 'otro', 'otro', 'admin_reset') $$,
  '23505', null, 'una sola fila por persona (clave primaria)'
);
select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-0000000000ff', 'x', 'y', 'created') $$,
  '23503', null, 'no se puede guardar una copia de una persona que no existe (FK)'
);
select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-000000000003', '', 'y', 'created') $$,
  '23514', null, 'ciphertext vacío rechazado'
);
select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-000000000003', 'x', '', 'created') $$,
  '23514', null, 'iv vacío rechazado'
);
select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, key_version, source)
     values ('c2600000-0000-0000-0000-000000000003', 'x', 'y', 0, 'created') $$,
  '23514', null, 'key_version tiene que ser positivo'
);
select throws_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-000000000003', 'x', 'y', 'inventado') $$,
  '22P02', null, 'un origen que no existe en la enumeración se rechaza'
);
select lives_ok(
  $$ insert into public.account_credentials (profile_id, ciphertext, iv, source)
     values ('c2600000-0000-0000-0000-000000000003', 'x', 'y', 'initial_delivery') $$,
  'initial_delivery es un origen válido y key_version arranca en 1'
);
select is(
  (select key_version::int from public.account_credentials where profile_id = 'c2600000-0000-0000-0000-000000000003'),
  1,
  'key_version vale 1 por defecto'
);

-- ---------------------------------------------------------------------------------------------
-- Tipos de evento nuevos de security_events
-- ---------------------------------------------------------------------------------------------

select ok(
  (select enum_range(null::public.security_event_type)::text[] @> array['credentials_viewed', 'password_changed_by_user']),
  'security_event_type tiene credentials_viewed y password_changed_by_user'
);
select lives_ok(
  $$ insert into public.security_events (event_type, actor_id, target_id, details)
     values ('credentials_viewed', 'c2600000-0000-0000-0000-000000000001', 'c2600000-0000-0000-0000-000000000004', '{"status":"ok"}') $$,
  'se puede registrar credentials_viewed'
);
select lives_ok(
  $$ insert into public.security_events (event_type, actor_id, target_id, details)
     values ('password_changed_by_user', 'c2600000-0000-0000-0000-000000000004', 'c2600000-0000-0000-0000-000000000004', '{"origin":"profile"}') $$,
  'se puede registrar password_changed_by_user'
);

-- ---------------------------------------------------------------------------------------------
-- La tabla está cerrada: privilegios
-- ---------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'account_credentials' and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0,
  'anon y authenticated no tienen ningún privilegio sobre la tabla'
);
select ok(not has_table_privilege('anon', 'public.account_credentials', 'select'), 'anon: sin select');
select ok(not has_table_privilege('authenticated', 'public.account_credentials', 'select'), 'authenticated: sin select');
select ok(
  not has_table_privilege('authenticated', 'public.account_credentials', 'insert')
    and not has_table_privilege('authenticated', 'public.account_credentials', 'update')
    and not has_table_privilege('authenticated', 'public.account_credentials', 'delete'),
  'authenticated: sin insert, update ni delete'
);
select ok(
  has_table_privilege('service_role', 'public.account_credentials', 'select')
    and has_table_privilege('service_role', 'public.account_credentials', 'insert')
    and has_table_privilege('service_role', 'public.account_credentials', 'update')
    and has_table_privilege('service_role', 'public.account_credentials', 'delete'),
  'service_role (la Edge Function) puede leer y escribir'
);
select ok(
  not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.account_credentials'::regclass and a.attnum > 0 and not a.attisdropped
      and exists (select 1 from aclexplode(a.attacl) x where x.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))
  ),
  'ni anon ni authenticated tienen privilegios por columna'
);

-- ---------------------------------------------------------------------------------------------
-- Ninguna vista ni función de public / app expone la tabla
-- ---------------------------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_views where schemaname in ('public', 'app') and definition ilike '%account_credentials%'),
  0,
  'ninguna vista menciona account_credentials'
);
select is(
  (select count(*)::int from pg_matviews where schemaname in ('public', 'app') and definition ilike '%account_credentials%'),
  0,
  'ninguna vista materializada menciona account_credentials'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosrc ilike '%account_credentials%'),
  0,
  'ninguna función o RPC de public ni app lee account_credentials'
);

-- ---------------------------------------------------------------------------------------------
-- authenticated, con cada rol: no puede leer ni escribir (permission denied = 42501)
-- ---------------------------------------------------------------------------------------------

select tests_0075.as_user('test-db0075-owner@example.com');
select throws_ok($$ select * from public.account_credentials $$, '42501', null, 'dueño: no lee la tabla');
select throws_ok($$ select ciphertext from public.account_credentials where profile_id = 'c2600000-0000-0000-0000-000000000004' $$, '42501', null, 'dueño: no lee el texto cifrado');
select throws_ok($$ insert into public.account_credentials (profile_id, ciphertext, iv, source) values ('c2600000-0000-0000-0000-000000000001', 'x', 'y', 'created') $$, '42501', null, 'dueño: no inserta');
select throws_ok($$ update public.account_credentials set source = 'admin_reset' $$, '42501', null, 'dueño: no actualiza');
select throws_ok($$ delete from public.account_credentials $$, '42501', null, 'dueño: no borra');

select tests_0075.as_user('test-db0075-admin@example.com');
select throws_ok($$ select * from public.account_credentials $$, '42501', null, 'administrador (manage_users): no lee la tabla');
select throws_ok($$ insert into public.account_credentials (profile_id, ciphertext, iv, source) values ('c2600000-0000-0000-0000-000000000002', 'x', 'y', 'created') $$, '42501', null, 'administrador: no inserta');
select throws_ok($$ update public.account_credentials set source = 'admin_reset' $$, '42501', null, 'administrador: no actualiza');
select throws_ok($$ delete from public.account_credentials $$, '42501', null, 'administrador: no borra');

select tests_0075.as_user('test-db0075-sup@example.com');
select throws_ok($$ select * from public.account_credentials $$, '42501', null, 'supervisor: no lee la tabla');
select throws_ok($$ insert into public.account_credentials (profile_id, ciphertext, iv, source) values ('c2600000-0000-0000-0000-000000000003', 'x', 'y', 'created') $$, '42501', null, 'supervisor: no inserta');
select throws_ok($$ update public.account_credentials set source = 'admin_reset' $$, '42501', null, 'supervisor: no actualiza');
select throws_ok($$ delete from public.account_credentials $$, '42501', null, 'supervisor: no borra');

select tests_0075.as_user('test-db0075-emp@example.com');
select throws_ok($$ select * from public.account_credentials $$, '42501', null, 'empleado: no lee ni su propia fila');
select throws_ok($$ insert into public.account_credentials (profile_id, ciphertext, iv, source) values ('c2600000-0000-0000-0000-000000000004', 'x', 'y', 'created') $$, '42501', null, 'empleado: no inserta');
select throws_ok($$ update public.account_credentials set source = 'admin_reset' $$, '42501', null, 'empleado: no actualiza');
select throws_ok($$ delete from public.account_credentials $$, '42501', null, 'empleado: no borra');

-- anon
set local role anon;
select throws_ok($$ select * from public.account_credentials $$, '42501', null, 'anon: no lee la tabla');
select throws_ok($$ insert into public.account_credentials (profile_id, ciphertext, iv, source) values ('c2600000-0000-0000-0000-000000000004', 'x', 'y', 'created') $$, '42501', null, 'anon: no inserta');
select throws_ok($$ delete from public.account_credentials $$, '42501', null, 'anon: no borra');

-- ---------------------------------------------------------------------------------------------
-- Después de todo eso, la fila del empleado sigue intacta
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select is(
  (select ciphertext || '|' || iv || '|' || source::text from public.account_credentials where profile_id = 'c2600000-0000-0000-0000-000000000004'),
  'Y2lmcmFkby1maWN0aWNpbw==|aXYtZmljdGljaW8x|created',
  'la fila del empleado no cambió'
);

select * from finish();

rollback;
