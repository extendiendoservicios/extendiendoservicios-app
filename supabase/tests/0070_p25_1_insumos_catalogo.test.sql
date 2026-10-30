-- pgTAP de la migración 0070_p25_1_insumos_y_stock.sql (P25.1, módulo E), segunda parte: catálogo.
--   upsert_supply, set_supply_active y upsert_supply_category: altas, ediciones, validaciones,
--   baja solo con stock cero (IS-26), categorías (IS-03) y permisos por rol y capacidad (IS-21).
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

create schema if not exists tests_0070a;
grant usage on schema tests_0070a to authenticated, anon;

create or replace function tests_0070a.as_user(p_email text)
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
    raise exception 'tests_0070a.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0070a.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0070a.err_hint(p_sql text)
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

grant execute on function tests_0070a.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0070a.err_msg(p_sql text)
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

grant execute on function tests_0070a.err_msg(text) to authenticated, anon;

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
create function tests_0070a.sid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests_0070a.shid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests_0070a.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests_0070a.uid(n integer) returns uuid language sql immutable as $$ select ('e2500000-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0070a.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070a.sid(p_n), 'qty', p_qty) $$;
create function tests_0070a.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070a.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests_0070a.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0070a.sid(p_n) $$;

grant execute on all functions in schema tests_0070a to authenticated, anon;

select plan(48);

set local role postgres;
create temporary table t_new_supply (id uuid) on commit drop;
create temporary table t_new_cat (id uuid) on commit drop;
grant all on t_new_supply, t_new_cat to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 1. Alta y edición de artículos (IS-01, IS-02, IS-26, IS-34)
-- ---------------------------------------------------------------------------------------------

select tests_0070a.as_user('test-db0070-admin@example.com');

select results_eq(
  $$select code, name, presentation, min_qty, cost_price, sale_price, stock_qty, active, created_by
    from public.upsert_supply(' te-100 ', ' Test nuevo ', 'e2500000-0000-0000-0000-0000000000d1', '2 L', 3, 10.50, 20, 'Notas', null)$$,
  $$values ('te-100'::text, 'Test nuevo'::text, '2 L'::text, 3, 10.50::numeric, 20.00::numeric, 0, true, tests_0070a.uid(2))$$,
  'upsert_supply crea el artículo con código y nombre sin espacios de los extremos, precios iniciales y stock 0'
);

set local role postgres;
select is(
  (select count(*)::integer from public.supply_price_changes
   where supply_id = (select id from public.supplies where lower(code) = 'te-100')
     and source = 'create' and old_cost_price is null and new_cost_price = 10.50 and new_sale_price = 20.00),
  1,
  'el alta deja el primer precio en el historial (source create)'
);
select is(
  (select count(*)::integer from public.security_events where event_type = 'supply_price_changed' and details ->> 'supply_id' = (select id::text from public.supplies where lower(code) = 'te-100')),
  0,
  'el alta no registra evento de cambio de precio'
);

select tests_0070a.as_user('test-db0070-admin@example.com');

select is(
  tests_0070a.err_hint($$select public.upsert_supply('TE-100', 'Otro', 'e2500000-0000-0000-0000-0000000000d1')$$),
  'CODE_ALREADY_EXISTS',
  'el código es único sin distinguir mayúsculas: CODE_ALREADY_EXISTS (IS-26)'
);
select is(
  tests_0070a.err_hint($$select public.upsert_supply('  Te-001  ', 'Otro', 'e2500000-0000-0000-0000-0000000000d1')$$),
  'CODE_ALREADY_EXISTS',
  'tampoco con espacios de los extremos'
);

-- Edición: todos los campos que llegan se reemplazan, los precios y el stock no se tocan.
insert into t_new_supply
select id from public.supplies where lower(code) = 'te-100';

select results_eq(
  $$select code, name, presentation, min_qty, cost_price, sale_price, notes, image_path
    from public.upsert_supply('TE-100B', 'Test renombrado', 'e2500000-0000-0000-0000-0000000000d2', null, null, 999, 999, null, (select id::text from t_new_supply) || '/foto.webp', (select id from t_new_supply))$$,
  $$values ('TE-100B'::text, 'Test renombrado'::text, null::text, null::integer, 10.50::numeric, 20.00::numeric, null::text, ((select id::text from t_new_supply) || '/foto.webp')::text)$$,
  'upsert_supply edita: se puede corregir el código, se vacían los opcionales, se acepta la imagen de su carpeta y los precios que llegan se ignoran'
);

select is(
  tests_0070a.err_hint($$select public.upsert_supply('TE-001', 'Pisa el código', 'e2500000-0000-0000-0000-0000000000d1', null, null, null, null, null, null, (select id from t_new_supply))$$),
  'CODE_ALREADY_EXISTS',
  'corregir el código a uno que ya existe: CODE_ALREADY_EXISTS'
);
select is(
  (select code from public.upsert_supply('TE-100B', 'Mismo código propio', 'e2500000-0000-0000-0000-0000000000d2', null, null, null, null, null, null, (select id from t_new_supply))),
  'TE-100B',
  'guardar con su propio código no choca consigo mismo'
);

select is(
  (select id from public.upsert_supply('TE-101', 'Con id del cliente', 'e2500000-0000-0000-0000-0000000000d1', null, null, null, null, null, null, 'e2500000-0000-0000-0000-0000000000f1')),
  'e2500000-0000-0000-0000-0000000000f1'::uuid,
  'con un p_id que no existe se crea con ese id (el cliente puede subir la imagen antes)'
);

select is(tests_0070a.err_hint($$select public.upsert_supply('  ', 'Sin código', 'e2500000-0000-0000-0000-0000000000d1')$$), 'CODE_REQUIRED', 'código en blanco: CODE_REQUIRED');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', '  ', 'e2500000-0000-0000-0000-0000000000d1')$$), 'NAME_REQUIRED', 'nombre en blanco: NAME_REQUIRED');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', 'e2500000-0000-0000-0000-0000000000d1', null, -1)$$), 'INVALID_MIN_QTY', 'mínimo negativo: INVALID_MIN_QTY');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', 'e2500000-0000-0000-0000-0000000000d1', null, null, -1, 0)$$), 'INVALID_PRICE', 'precio de costo negativo: INVALID_PRICE (IS-34)');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', 'e2500000-0000-0000-0000-0000000000d1', null, null, 0, 1.234)$$), 'INVALID_PRICE', 'más de dos decimales: INVALID_PRICE');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', gen_random_uuid())$$), 'CATEGORY_NOT_FOUND', 'categoría inexistente: CATEGORY_NOT_FOUND');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', null)$$), 'CATEGORY_NOT_FOUND', 'sin categoría: CATEGORY_NOT_FOUND');
select is(
  tests_0070a.err_hint($$select public.upsert_supply('TE-102', 'X', 'e2500000-0000-0000-0000-0000000000d1', null, null, null, null, null, 'otra-carpeta/foto.webp')$$),
  'INVALID_IMAGE_PATH',
  'una imagen fuera de la carpeta del artículo: INVALID_IMAGE_PATH'
);

set local role postgres;
insert into public.supply_categories (id, name, active) values ('e2500000-0000-0000-0000-0000000000d9', 'Test E categoría inactiva', false);
select tests_0070a.as_user('test-db0070-admin@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-103', 'X', 'e2500000-0000-0000-0000-0000000000d9')$$), 'CATEGORY_INACTIVE', 'alta en una categoría desactivada: CATEGORY_INACTIVE');
select is(
  tests_0070a.err_hint($$select public.upsert_supply('TE-100B', 'X', 'e2500000-0000-0000-0000-0000000000d9', null, null, null, null, null, null, (select id from t_new_supply))$$),
  'CATEGORY_INACTIVE',
  'mover un artículo a una categoría desactivada: CATEGORY_INACTIVE'
);

select tests_0070a.as_user('test-db0070-owner@example.com');
select is(
  (select code from public.upsert_supply('TE-104', 'Lo carga el dueño', 'e2500000-0000-0000-0000-0000000000d1')),
  'TE-104',
  'el dueño tiene manage_stock implícita'
);
select tests_0070a.as_user('test-db0070-admin-sin@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-105', 'X', 'e2500000-0000-0000-0000-0000000000d1')$$), 'FORBIDDEN', 'el administrador sin manage_stock no da de alta artículos (IS-21)');
select tests_0070a.as_user('test-db0070-emp-a@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-105', 'X', 'e2500000-0000-0000-0000-0000000000d1')$$), 'FORBIDDEN', 'un empleado no da de alta artículos');
select tests_0070a.as_user('test-db0070-coord@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply('TE-105', 'X', 'e2500000-0000-0000-0000-0000000000d1')$$), 'FORBIDDEN', 'un coordinador no da de alta artículos');

-- ---------------------------------------------------------------------------------------------
-- 2. Baja y reactivación (IS-26)
-- ---------------------------------------------------------------------------------------------

select tests_0070a.as_user('test-db0070-admin@example.com');
select public.register_stock_entry(jsonb_build_array(tests_0070a.l(1, 5)));

select is(tests_0070a.err_hint($$select public.set_supply_active(tests_0070a.sid(1), false)$$), 'STOCK_NOT_ZERO', 'desactivar con stock: STOCK_NOT_ZERO (primero se ajusta)');
select is(tests_0070a.stock(1), 5, 'el artículo sigue activo con su stock');
select public.adjust_stock(tests_0070a.sid(1), -5, 'count', 'Se lleva a cero para desactivar');
select is((select active from public.set_supply_active(tests_0070a.sid(1), false)), false, 'con stock cero se puede desactivar');
select is((select active from public.set_supply_active(tests_0070a.sid(1), false)), false, 'desactivar de nuevo no falla');
select is(
  tests_0070a.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070a.l(1, 1)))$$),
  'SUPPLY_INACTIVE',
  'un artículo desactivado no recibe ingresos: SUPPLY_INACTIVE'
);
select is(
  tests_0070a.err_hint($$select public.adjust_stock(tests_0070a.sid(1), 1, 'count')$$),
  'SUPPLY_INACTIVE',
  'ni ajustes'
);
select is((select active from public.set_supply_active(tests_0070a.sid(1), true)), true, 'se puede reactivar');
select is(tests_0070a.err_hint($$select public.set_supply_active(tests_0070a.sid(1), null)$$), 'INVALID_ACTIVE', 'estado nulo: INVALID_ACTIVE');
select is(tests_0070a.err_hint($$select public.set_supply_active(gen_random_uuid(), false)$$), 'SUPPLY_NOT_FOUND', 'artículo inexistente: SUPPLY_NOT_FOUND');

set local role postgres;
update public.supplies set active = false, category_id = 'e2500000-0000-0000-0000-0000000000d9' where id = tests_0070a.sid(2);
select tests_0070a.as_user('test-db0070-admin@example.com');
select is(tests_0070a.err_hint($$select public.set_supply_active(tests_0070a.sid(2), true)$$), 'CATEGORY_INACTIVE', 'reactivar un artículo cuya categoría está desactivada: CATEGORY_INACTIVE');

select tests_0070a.as_user('test-db0070-admin-sin@example.com');
select is(tests_0070a.err_hint($$select public.set_supply_active(tests_0070a.sid(1), false)$$), 'FORBIDDEN', 'el administrador sin manage_stock no desactiva: FORBIDDEN');
select tests_0070a.as_user('test-db0070-emp-a@example.com');
select is(tests_0070a.err_hint($$select public.set_supply_active(tests_0070a.sid(1), false)$$), 'FORBIDDEN', 'un empleado no desactiva: FORBIDDEN');
select is(tests_0070a.err_hint($$select public.set_supply_prices(tests_0070a.sid(1), 1, 1)$$), 'FORBIDDEN', 'un empleado no cambia precios: FORBIDDEN');

-- ---------------------------------------------------------------------------------------------
-- 3. Categorías (IS-03)
-- ---------------------------------------------------------------------------------------------

select tests_0070a.as_user('test-db0070-admin@example.com');

select results_eq(
  $$select name, sort_order, active, created_by from public.upsert_supply_category('  Test E categoría tres ', 30)$$,
  $$values ('Test E categoría tres'::text, 30, true, tests_0070a.uid(2))$$,
  'upsert_supply_category crea la categoría (nombre sin espacios de los extremos, orden y activa)'
);
select is(tests_0070a.err_hint($$select public.upsert_supply_category('test e CATEGORÍA tres')$$), 'CATEGORY_NAME_EXISTS', 'el nombre es único sin distinguir mayúsculas ni espacios: CATEGORY_NAME_EXISTS');
select is(tests_0070a.err_hint($$select public.upsert_supply_category('   ')$$), 'NAME_REQUIRED', 'nombre en blanco: NAME_REQUIRED');
select is(tests_0070a.err_hint($$select public.upsert_supply_category('X', null)$$), 'INVALID_CATEGORY', 'orden nulo: INVALID_CATEGORY');
select is(tests_0070a.err_hint($$select public.upsert_supply_category('X', 1, true, gen_random_uuid())$$), 'CATEGORY_NOT_FOUND', 'editar una categoría que no existe: CATEGORY_NOT_FOUND');

insert into t_new_cat select id from public.supply_categories where name = 'Test E categoría tres';

select results_eq(
  $$select name, sort_order from public.upsert_supply_category('Test E categoría tres bis', 5, true, (select id from t_new_cat))$$,
  $$values ('Test E categoría tres bis'::text, 5)$$,
  'editar nombre y orden de una categoría'
);
select is(
  tests_0070a.err_hint($$select public.upsert_supply_category('Test E categoría dos', 1, true, (select id from t_new_cat))$$),
  'CATEGORY_NAME_EXISTS',
  'renombrar a un nombre que ya existe: CATEGORY_NAME_EXISTS'
);
select is(
  tests_0070a.err_hint($$select public.upsert_supply_category('Test E categoría uno', 10, false, 'e2500000-0000-0000-0000-0000000000d1')$$),
  'CATEGORY_IN_USE',
  'desactivar una categoría con artículos activos: CATEGORY_IN_USE'
);
select is(
  (select active from public.upsert_supply_category('Test E categoría tres bis', 5, false, (select id from t_new_cat))),
  false,
  'desactivar una categoría sin artículos activos'
);
select is(
  (select active from public.upsert_supply_category('Test E categoría tres bis', 5, true, (select id from t_new_cat))),
  true,
  'y reactivarla'
);

select tests_0070a.as_user('test-db0070-admin-sin@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply_category('Test E otra')$$), 'FORBIDDEN', 'el administrador sin manage_stock no gestiona categorías: FORBIDDEN');
select tests_0070a.as_user('test-db0070-emp-a@example.com');
select is(tests_0070a.err_hint($$select public.upsert_supply_category('Test E otra')$$), 'FORBIDDEN', 'un empleado no gestiona categorías: FORBIDDEN');

select * from finish();

rollback;
