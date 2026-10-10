-- pgTAP de la migración 0039_p19_6c_foto_de_clientes.sql (P19.6 paquete C, AJ2-06): columna
-- clients.photo_path, bucket client-photos con sus políticas y v_clients con photo_path al final.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'c4390000-...'. Las filas de storage.objects son solo metadata. El delete SQL
-- directo lo bloquea storage.protect_delete(), por eso la política de delete se verifica en
-- pg_policies (ver nota de 0014_storage_buckets.test.sql).

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

select plan(15);

-- Estructura -----------------------------------------------------------------------------------

select col_type_is('public', 'clients', 'photo_path', 'text', 'clients.photo_path es text');
select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.clients'::regclass and attnum > 0 and not attisdropped
   order by attnum desc limit 1),
  'photo_path', 'clients.photo_path es la última columna'
);
select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.v_clients'::regclass and attnum > 0 and not attisdropped
   order by attnum desc limit 1),
  'photo_path', 'v_clients: photo_path al final'
);
select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.v_clients'::regclass and attnum = 1),
  'id', 'v_clients: no se reordenó (id sigue primero)'
);
select is((select public from storage.buckets where id = 'client-photos'), true, 'client-photos: bucket público');
select is((select file_size_limit from storage.buckets where id = 'client-photos'), 2097152::bigint, 'client-photos: límite 2 MB');
select is((select allowed_mime_types from storage.buckets where id = 'client-photos'), array['image/jpeg'], 'client-photos: solo image/jpeg');

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'client_photos_delete_admin' and cmd = 'DELETE'
  ),
  'client_photos_delete_admin: existe'
);

-- Fixtures: owner, admin, empleado y supervisor sin turnos --------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c4390000-0000-0000-0000-000000000001', 'test-aj206-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c4390000-0000-0000-0000-000000000002', 'test-aj206-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c4390000-0000-0000-0000-000000000003', 'test-aj206-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Tres')),
  ('c4390000-0000-0000-0000-000000000004', 'test-aj206-supervisor@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Cuatro'));

insert into public.user_roles (profile_id, role) values
  ('c4390000-0000-0000-0000-000000000001', 'owner'),
  ('c4390000-0000-0000-0000-000000000002', 'admin'),
  ('c4390000-0000-0000-0000-000000000003', 'employee'),
  ('c4390000-0000-0000-0000-000000000004', 'supervisor');

insert into public.clients (id, legal_name) values
  ('c4390000-0000-0000-0000-0000000000c1', 'Cliente Foto AJ206 SA');

-- Admin: sube, lee y actualiza ------------------------------------------------------------------

select tests.as_user('test-aj206-admin@example.com');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('client-photos', 'c4390000-0000-0000-0000-0000000000c1/foto.jpg', auth.uid())$$,
  'admin: puede subir la foto de un cliente'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'client-photos'),
  1, 'admin: ve el objeto'
);
select lives_ok(
  $$update public.clients set photo_path = 'c4390000-0000-0000-0000-0000000000c1/foto.jpg'
    where id = 'c4390000-0000-0000-0000-0000000000c1'$$,
  'admin: puede guardar photo_path en el cliente'
);

-- Empleado: ni sube ni lee --------------------------------------------------------------------

select tests.as_user('test-aj206-empleado@example.com');

prepare emp_insert as
  insert into storage.objects (bucket_id, name, owner)
  values ('client-photos', 'c4390000-0000-0000-0000-0000000000c1/otra.jpg', auth.uid());
select throws_ok('emp_insert', '42501', null, 'empleado: NO puede subir foto de cliente (42501)');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'client-photos'),
  0, 'empleado: no ve objetos del bucket'
);

-- Supervisor sin turnos de ese cliente: ni sube ni lee ------------------------------------------

select tests.as_user('test-aj206-supervisor@example.com');

prepare sup_insert as
  insert into storage.objects (bucket_id, name, owner)
  values ('client-photos', 'c4390000-0000-0000-0000-0000000000c1/sup.jpg', auth.uid());
select throws_ok('sup_insert', '42501', null, 'supervisor: NO puede subir foto de cliente (42501)');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'client-photos'),
  0, 'supervisor sin turnos del cliente: no ve la foto'
);

select * from finish();

rollback;
