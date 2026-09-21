-- pgTAP de la migración 0014_storage_buckets.sql (DB-016): buckets avatars/branding y sus
-- políticas sobre storage.objects (04 sección 7.3, ADR-016).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c4100000-...'. Las filas
-- que este archivo inserta en storage.objects son solo metadata (sin subir contenido real a
-- Storage): alcanza para probar RLS, que es lo que compete a esta migración.
--
-- Nota sobre `delete` (hallazgo verificado en `App_dev`, no documentado en 04): Supabase agrega
-- de fábrica un trigger `storage.protect_delete()` sobre `storage.objects` que rechaza CUALQUIER
-- `delete` SQL directo con "Direct deletion from storage tables is not allowed. Use the Storage
-- API instead.", sin importar el rol ni las políticas RLS -- la Storage API borra por otra vía
-- interna que esquiva ese trigger pero sigue pasando por RLS. Por eso las políticas
-- `avatars_delete_own_or_admin`/de `branding_write_admin` (parte `delete`) no se pueden probar
-- con un `delete` de pgTAP: se verifica que existen y con el `using` esperado consultando
-- `pg_policies`, en vez de ejecutar el `delete`.

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

select plan(19);

-- Estructura de los buckets ------------------------------------------------------------------

select is((select public from storage.buckets where id = 'avatars'), true, 'avatars: bucket público');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 2097152::bigint, 'avatars: límite 2 MB');
select is((select allowed_mime_types from storage.buckets where id = 'avatars'), array['image/jpeg'], 'avatars: solo image/jpeg');

select is((select public from storage.buckets where id = 'branding'), true, 'branding: bucket público');
select is((select file_size_limit from storage.buckets where id = 'branding'), 1048576::bigint, 'branding: límite 1 MB');

-- Políticas de delete: existen, con el using esperado (ver nota de arriba sobre por qué no se
-- prueban con un delete real) ------------------------------------------------------------------

select is(
  (select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'avatars_delete_own_or_admin'),
  $$((bucket_id = 'avatars'::text) AND (is_admin() OR ((storage.foldername(name))[1] = (auth.uid())::text)))$$,
  'avatars_delete_own_or_admin: existe con el using esperado (propio o admin)'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'branding_write_admin' and cmd = 'ALL'
  ),
  'branding_write_admin: existe como for all (cubre también delete), solo admin/owner'
);

-- Fixtures: un owner, un admin y dos empleados -------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c4100000-0000-0000-0000-000000000081', 'test-db016-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c4100000-0000-0000-0000-000000000082', 'test-db016-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c4100000-0000-0000-0000-000000000083', 'test-db016-empleado1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('c4100000-0000-0000-0000-000000000084', 'test-db016-empleado2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos'));

insert into public.user_roles (profile_id, role) values
  ('c4100000-0000-0000-0000-000000000081', 'owner'),
  ('c4100000-0000-0000-0000-000000000082', 'admin'),
  ('c4100000-0000-0000-0000-000000000083', 'employee'),
  ('c4100000-0000-0000-0000-000000000084', 'employee');

-- avatars: el propio empleado puede subir a su propia carpeta ----------------------------------

select tests.as_user('test-db016-empleado1@example.com');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('avatars', 'c4100000-0000-0000-0000-000000000083/foto.jpg', auth.uid())$$,
  'avatars: el empleado puede subir a su propia carpeta ({profile_id}/...)'
);

-- avatars: NO puede subir a la carpeta de otro empleado -----------------------------------------

prepare avatars_insert_other_folder as
  insert into storage.objects (bucket_id, name, owner)
  values ('avatars', 'c4100000-0000-0000-0000-000000000084/foto.jpg', auth.uid());

select throws_ok(
  'avatars_insert_other_folder', '42501', null,
  'avatars: el empleado NO puede subir a la carpeta de otro empleado (42501)'
);

set local role postgres;

-- avatars: admin puede subir/actualizar en la carpeta de cualquiera -----------------------------

select tests.as_user('test-db016-admin@example.com');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('avatars', 'c4100000-0000-0000-0000-000000000084/foto-admin.jpg', auth.uid())$$,
  'avatars: el admin puede subir a la carpeta de cualquier empleado'
);

select lives_ok(
  $$update storage.objects set name = 'c4100000-0000-0000-0000-000000000084/foto-admin-2.jpg'
    where bucket_id = 'avatars' and name = 'c4100000-0000-0000-0000-000000000084/foto-admin.jpg'$$,
  'avatars: el admin puede actualizar un objeto de cualquier carpeta'
);

set local role postgres;

-- avatars: lectura pública (anon y authenticated); en este punto hay 2 objetos (foto.jpg del
-- empleado1, foto-admin-2.jpg del empleado2 subido por el admin) --------------------------------

set local role anon;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  2,
  'avatars: anon puede leer (lectura pública, 04 sección 7.3)'
);

set local role postgres;

select tests.as_user('test-db016-empleado2@example.com');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  2,
  'avatars: cualquier autenticado puede leer, aunque el archivo sea de otra persona (lectura pública)'
);

set local role postgres;

-- avatars: el propio dueño puede actualizar su archivo -------------------------------------------

select tests.as_user('test-db016-empleado1@example.com');

select lives_ok(
  $$update storage.objects set name = 'c4100000-0000-0000-0000-000000000083/foto-2.jpg'
    where bucket_id = 'avatars' and name = 'c4100000-0000-0000-0000-000000000083/foto.jpg'$$,
  'avatars: el propio empleado puede actualizar su archivo'
);

set local role postgres;

-- branding: solo owner/admin escriben ------------------------------------------------------------

select tests.as_user('test-db016-empleado1@example.com');

prepare branding_insert_employee as
  insert into storage.objects (bucket_id, name, owner) values ('branding', 'logo.png', auth.uid());

select throws_ok(
  'branding_insert_employee', '42501', null,
  'branding: un empleado no puede subir el logo'
);

set local role postgres;

select tests.as_user('test-db016-owner@example.com');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('branding', 'logo.png', auth.uid())$$,
  'branding: el owner puede subir el logo'
);

set local role postgres;

select tests.as_user('test-db016-admin@example.com');

select lives_ok(
  $$update storage.objects set name = 'logo.png' where bucket_id = 'branding' and name = 'logo.png'$$,
  'branding: el admin también puede actualizar el logo'
);

set local role postgres;

-- branding: lectura pública -----------------------------------------------------------------------

set local role anon;

select is(
  (select count(*)::int from storage.objects where bucket_id = 'branding'),
  1,
  'branding: anon puede leer (lectura pública)'
);

set local role postgres;

-- anon no puede escribir en ningún bucket ----------------------------------------------------------

set local role anon;

prepare avatars_insert_anon as
  insert into storage.objects (bucket_id, name) values ('avatars', 'anon/foto.jpg');

select throws_ok(
  'avatars_insert_anon', '42501', null,
  'avatars: anon no puede subir nada (sin política de insert para anon)'
);

set local role postgres;

select * from finish();

rollback;
