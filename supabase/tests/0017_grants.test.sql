-- pgTAP de la migración 0017_grants.sql (DB-017): revocaciones a anon, grants a authenticated,
-- grants por columna (profiles, assignments.notes, company_settings para anon), execute de las
-- RPC de 0013 y alter default privileges para tablas/vistas futuras.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c6100000-...'. La mayor
-- parte de la cobertura de "quién puede leer/escribir qué" después de 0017 ya está en los
-- archivos de 0012 (actualizados en este mismo paquete para reflejar el ACL nuevo); acá van los
-- casos propios de esta migración: el ACL en sí (información de catálogo), el trigger de
-- columnas de profiles y el alter default privileges.

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

select plan(14);

-- 1. anon no tiene ningún privilegio sobre ninguna tabla de negocio, salvo v_public_branding y
--    las tres columnas de company_settings ----------------------------------------------------

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'anon' and table_name <> 'v_public_branding'),
  0,
  'anon: cero privilegios de tabla fuera de v_public_branding (ni siquiera select en otra tabla o vista)'
);

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and grantee = 'anon' and table_name = 'v_public_branding' and privilege_type = 'SELECT'),
  1,
  'anon: exactamente un privilegio (select) sobre v_public_branding'
);

select is(
  (select coalesce(array_agg(column_name::text order by column_name::text), array[]::text[]) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'company_settings' and grantee = 'anon'),
  array['id', 'logo_path', 'name', 'support_phone'],
  'anon: en company_settings, solo las columnas id/logo_path/name/support_phone (0017: id agregada por el where id = 1 de v_public_branding)'
);

-- 2. authenticated: select amplio, sin insert/update/delete en las tablas "RPC only" -------------

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'shifts' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'authenticated: sin insert/update/delete en shifts (tabla "RPC only")'
);

select ok(
  exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'shifts' and grantee = 'authenticated' and privilege_type = 'SELECT'
  ),
  'authenticated: sí tiene select en shifts'
);

select is(
  (select coalesce(array_agg(column_name::text order by column_name::text), array[]::text[]) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'assignments' and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  array['notes'],
  'authenticated: en assignments, update solo de la columna notes'
);

-- 3. execute de las RPC de 0013 -----------------------------------------------------------------

select is(
  (select count(*)::int from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'set_user_roles' and grantee = 'anon'),
  0,
  'anon no tiene execute sobre set_user_roles'
);

select ok(
  exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and routine_name = 'mark_changes_seen' and grantee = 'authenticated'
  ),
  'authenticated sí tiene execute sobre mark_changes_seen'
);

-- 4. trigger de columnas de profiles (candado real, ver 0017_grants.sql punto 5) -----------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c6100000-0000-0000-0000-000000000081', 'test-db017-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('c6100000-0000-0000-0000-000000000082', 'test-db017-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos'));

insert into public.user_roles (profile_id, role) values
  ('c6100000-0000-0000-0000-000000000081', 'employee'),
  ('c6100000-0000-0000-0000-000000000082', 'admin');

select tests.as_user('test-db017-empleado@example.com');

select lives_ok(
  $$update public.profiles set phone = '11-5555-5555' where id = 'c6100000-0000-0000-0000-000000000081'$$,
  'profiles: el propio empleado puede cambiar phone (columna permitida)'
);

prepare profiles_self_forbidden_column as
  update public.profiles set first_name = 'Hackeado' where id = 'c6100000-0000-0000-0000-000000000081';

select throws_ok(
  'profiles_self_forbidden_column', 'P0001', 'Desde tu perfil solo podés editar el email de contacto, el teléfono, la foto y el consentimiento de ubicación.',
  'profiles: el propio empleado NO puede cambiar first_name (trigger app.enforce_profile_self_update_columns)'
);

set local role postgres;

select tests.as_user('test-db017-admin@example.com');

select lives_ok(
  $$update public.profiles set first_name = 'Corregido' where id = 'c6100000-0000-0000-0000-000000000081'$$,
  'profiles: el admin SÍ puede cambiar first_name de otra persona (04 sección 7.2: "O, A: todas las columnas")'
);

set local role postgres;

-- 5. alter default privileges: una tabla nueva (creada dentro de esta transacción, para simular
--    "F6 en adelante") nace sin privilegios para anon y con select para authenticated, sin
--    necesitar ningún grant explícito ------------------------------------------------------------

create table public.c6100000_tabla_futura (id uuid primary key default gen_random_uuid(), valor text);

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'c6100000_tabla_futura' and grantee = 'anon'),
  0,
  'alter default privileges: una tabla nueva de public nace sin ningún privilegio para anon'
);

select ok(
  exists (
    select 1 from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'c6100000_tabla_futura' and grantee = 'authenticated' and privilege_type = 'SELECT'
  ),
  'alter default privileges: una tabla nueva de public nace con select para authenticated'
);

select is(
  (select count(*)::int from information_schema.table_privileges
    where table_schema = 'public' and table_name = 'c6100000_tabla_futura' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'alter default privileges: sin insert/update/delete por defecto (cada migración los agrega si corresponde)'
);

drop table public.c6100000_tabla_futura;

select * from finish();

rollback;
