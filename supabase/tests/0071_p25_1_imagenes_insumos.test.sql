-- pgTAP de la migración 0071_p25_1_imagenes_insumos.sql (P25.1, módulo E): bucket privado
--   supply-images (IS-32), legible por cualquier usuario autenticado y escribible solo con manage_stock.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500000-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

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

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests.err_msg(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

grant execute on function tests.err_msg(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e2500000-...). Todo lo que depende de «hoy» usa app.today() (fechas de los
-- turnos); ningún instante se arma con «ahora ± horas» salvo donde el caso lo pide (el control a
-- una hora pasada).
--   usuarios: 01 dueño, 02 admin CON manage_stock, 03 admin SIN la capacidad, 04 coordinador,
--             05 empleada A, 06 empleado B
--   clientes: c1 (sedes s1 y s3) y c2 (sede s2). El coordinador prioriza la sede s2.
--   turnos:   hoy en s1 con A; hoy en s2 con B; mañana en s1 con A; +5 en s1 con A;
--             +10 en s1 con A (fuera de ventana); -2 en s1 con A (fuera de ventana);
--             +1 cancelado en s1 con A.
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2500000-0000-0000-0000-000000000001', 'test-db0070-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Insumos')),
  ('e2500000-0000-0000-0000-000000000002', 'test-db0070-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConStock')),
  ('e2500000-0000-0000-0000-000000000003', 'test-db0070-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500000-0000-0000-0000-000000000004', 'test-db0070-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500000-0000-0000-0000-000000000005', 'test-db0070-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500000-0000-0000-0000-000000000006', 'test-db0070-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500000-0000-0000-0000-000000000001', 'owner'),
  ('e2500000-0000-0000-0000-000000000002', 'admin'),
  ('e2500000-0000-0000-0000-000000000003', 'admin'),
  ('e2500000-0000-0000-0000-000000000004', 'supervisor'),
  ('e2500000-0000-0000-0000-000000000005', 'employee'),
  ('e2500000-0000-0000-0000-000000000006', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500000-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500000-0000-0000-0000-000000000003', 'manage_users', true),
  ('e2500000-0000-0000-0000-000000000003', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500000-0000-0000-0000-000000000004', '92500004', 'active'),
  ('e2500000-0000-0000-0000-000000000005', '92500005', 'active'),
  ('e2500000-0000-0000-0000-000000000006', '92500006', 'active');

insert into public.clients (id, legal_name, trade_name, status) values
  ('e2500000-0000-0000-0000-0000000000c1', 'Cliente Insumos Uno SA', 'Cliente Uno', 'active'),
  ('e2500000-0000-0000-0000-0000000000c2', 'Cliente Insumos Dos SA', null, 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500000-0000-0000-0000-0000000000a1', 'e2500000-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500000-0000-0000-0000-0000000000a2', 'e2500000-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500000-0000-0000-0000-0000000000a3', 'e2500000-0000-0000-0000-0000000000c1', 'Sede Tres', 'Calle 3', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500000-0000-0000-0000-000000000b01', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b02', 'e2500000-0000-0000-0000-0000000000c2', 'e2500000-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b03', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b04', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b05', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500000-0000-0000-0000-000000000b06', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() - 2, '08:00', '12:00', 1, 'completed');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500000-0000-0000-0000-000000000b07', 'e2500000-0000-0000-0000-0000000000c1', 'e2500000-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500000-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500000-0000-0000-0000-000000000b01', 'e2500000-0000-0000-0000-000000000005'),
  ('e2500000-0000-0000-0000-000000000b02', 'e2500000-0000-0000-0000-000000000006'),
  ('e2500000-0000-0000-0000-000000000b03', 'e2500000-0000-0000-0000-000000000005'),
  ('e2500000-0000-0000-0000-000000000b04', 'e2500000-0000-0000-0000-000000000005'),
  ('e2500000-0000-0000-0000-000000000b05', 'e2500000-0000-0000-0000-000000000005'),
  ('e2500000-0000-0000-0000-000000000b06', 'e2500000-0000-0000-0000-000000000005'),
  ('e2500000-0000-0000-0000-000000000b07', 'e2500000-0000-0000-0000-000000000005');

insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('e2500000-0000-0000-0000-000000000004', 'e2500000-0000-0000-0000-0000000000a2', 'e2500000-0000-0000-0000-000000000001');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500000-0000-0000-0000-0000000000d1', 'Test E categoría uno', 10),
  ('e2500000-0000-0000-0000-0000000000d2', 'Test E categoría dos', 20);

-- Artículos de la prueba: arrancan en cero; el stock entra por registrar ingresos (RPC).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500000-0000-0000-0000-0000000000e1', 'TE-001', 'Test lavandina', '1 L', 'e2500000-0000-0000-0000-0000000000d1', 5, 100.00, 150.00),
  ('e2500000-0000-0000-0000-0000000000e2', 'TE-002', 'Test detergente', '5 L', 'e2500000-0000-0000-0000-0000000000d1', null, 200.00, 300.00),
  ('e2500000-0000-0000-0000-0000000000e3', 'TE-003', 'Test bolsas', 'paquete x 10', 'e2500000-0000-0000-0000-0000000000d2', 2, 50.50, 80.00);

-- Atajos de las fixtures: artículo n, turno n, sede n y usuario n.
create function tests.sid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests.shid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests.uid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests.sid(p_n), 'qty', p_qty) $$;
create function tests.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests.sid(p_n) $$;

grant execute on all functions in schema tests to authenticated, anon;

select plan(17);

set local role postgres;

-- Ejecuta una sentencia de escritura y devuelve cuántas filas tocó (con la RLS de quien llama).
create function tests.exec_count(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function tests.exec_count(text) to authenticated, anon;

-- Las filas que este archivo inserta en storage.objects son solo metadata (sin contenido real):
-- alcanza para probar la RLS. Un `delete` SQL directo lo rechaza el trigger de Supabase
-- (storage.protect_delete), así que las políticas de borrado se verifican por pg_policies.

select is((select public from storage.buckets where id = 'supply-images'), false, 'supply-images: bucket privado');
select is((select file_size_limit from storage.buckets where id = 'supply-images'), 2097152::bigint, 'supply-images: tope de 2 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'supply-images'),
  array['image/webp', 'image/jpeg'],
  'supply-images: solo WebP y JPEG'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'supply_images_%'),
  4,
  'supply-images tiene cuatro políticas (lectura y escritura por capacidad)'
);
select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'supply_images_delete_manage_stock'),
  'DELETE',
  'existe la política de borrado'
);
select ok(
  (select qual like '%manage_stock%' from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'supply_images_delete_manage_stock'),
  'el borrado exige manage_stock'
);

select tests.as_user('test-db0070-admin@example.com');

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('supply-images', 'e2500000-0000-0000-0000-0000000000e1/foto-1.webp', 'e2500000-0000-0000-0000-000000000002')$$,
  'un administrador con manage_stock sube una imagen'
);
select lives_ok(
  $$update storage.objects set name = 'e2500000-0000-0000-0000-0000000000e1/foto-2.webp' where bucket_id = 'supply-images' and name = 'e2500000-0000-0000-0000-0000000000e1/foto-1.webp'$$,
  'y la puede reemplazar'
);

select tests.as_user('test-db0070-owner@example.com');
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('supply-images', 'e2500000-0000-0000-0000-0000000000e2/foto-1.webp', 'e2500000-0000-0000-0000-000000000001')$$,
  'el dueño sube una imagen (capacidad implícita)'
);

select tests.as_user('test-db0070-admin-sin@example.com');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('supply-images', 'e2500000-0000-0000-0000-0000000000e3/foto-1.webp', 'e2500000-0000-0000-0000-000000000003')$$,
  '42501', null, 'un administrador sin manage_stock no sube imágenes'
);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'supply-images' and name like 'e2500000-%'),
  2,
  'pero sí las lee'
);

select tests.as_user('test-db0070-emp-a@example.com');
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'supply-images' and name like 'e2500000-%'),
  2,
  'una empleada lee las imágenes (IS-20, IS-32)'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('supply-images', 'e2500000-0000-0000-0000-0000000000e3/foto-1.webp', 'e2500000-0000-0000-0000-000000000005')$$,
  '42501', null, 'una empleada no sube imágenes'
);
select is(
  tests.exec_count($$update storage.objects set name = 'e2500000-0000-0000-0000-0000000000e1/hackeada.webp' where bucket_id = 'supply-images' and name like 'e2500000-%'$$),
  0,
  'una empleada no puede reemplazar imágenes (el update no alcanza ninguna fila)'
);

select tests.as_user('test-db0070-coord@example.com');
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'supply-images' and name like 'e2500000-%'),
  2,
  'un coordinador lee las imágenes'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('supply-images', 'e2500000-0000-0000-0000-0000000000e3/foto-1.webp', 'e2500000-0000-0000-0000-000000000004')$$,
  '42501', null, 'un coordinador no sube imágenes'
);

select tests.as_user('test-db0070-emp-a@example.com');
set local role anon;
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'supply-images'),
  0,
  'anon no lee las imágenes (bucket privado)'
);

select * from finish();

rollback;
