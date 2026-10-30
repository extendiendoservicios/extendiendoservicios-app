-- pgTAP de la migración 0070_p25_1_insumos_y_stock.sql (P25.1, módulo E), quinta parte: permisos y vistas.
--   anon y grants; lectura por rol (dueño, administrador con y sin manage_stock, coordinador,
--   empleados): tablas solo de administración (IS-20, IS-21); v_stock_admin (IS-05); catálogo sin
--   precios ni cantidades; mis retiros y mis avisos; avisos de faltante y su resolución (IS-29);
--   get_stock_summary (IS-30); turnos y sedes que se pueden elegir (IS-28, CJ-25).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500004-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0070e;
grant usage on schema tests_0070e to authenticated, anon;

create or replace function tests_0070e.as_user(p_email text)
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
    raise exception 'tests_0070e.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0070e.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0070e.err_hint(p_sql text)
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

grant execute on function tests_0070e.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0070e.err_msg(p_sql text)
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

grant execute on function tests_0070e.err_msg(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e2500004-...). Todo lo que depende de «hoy» usa app.today() (fechas de los
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
  ('e2500004-0000-0000-0000-000000000001', 'test-db0070per-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Insumos')),
  ('e2500004-0000-0000-0000-000000000002', 'test-db0070per-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConStock')),
  ('e2500004-0000-0000-0000-000000000003', 'test-db0070per-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500004-0000-0000-0000-000000000004', 'test-db0070per-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500004-0000-0000-0000-000000000005', 'test-db0070per-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500004-0000-0000-0000-000000000006', 'test-db0070per-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500004-0000-0000-0000-000000000001', 'owner'),
  ('e2500004-0000-0000-0000-000000000002', 'admin'),
  ('e2500004-0000-0000-0000-000000000003', 'admin'),
  ('e2500004-0000-0000-0000-000000000004', 'supervisor'),
  ('e2500004-0000-0000-0000-000000000005', 'employee'),
  ('e2500004-0000-0000-0000-000000000006', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500004-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500004-0000-0000-0000-000000000003', 'manage_users', true),
  ('e2500004-0000-0000-0000-000000000003', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500004-0000-0000-0000-000000000004', '92504004', 'active'),
  ('e2500004-0000-0000-0000-000000000005', '92504005', 'active'),
  ('e2500004-0000-0000-0000-000000000006', '92504006', 'active');

insert into public.clients (id, legal_name, trade_name, status) values
  ('e2500004-0000-0000-0000-0000000000c1', 'Cliente Insumos Uno SA', 'Cliente Uno', 'active'),
  ('e2500004-0000-0000-0000-0000000000c2', 'Cliente Insumos Dos SA', null, 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500004-0000-0000-0000-0000000000a1', 'e2500004-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500004-0000-0000-0000-0000000000a2', 'e2500004-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500004-0000-0000-0000-0000000000a3', 'e2500004-0000-0000-0000-0000000000c1', 'Sede Tres', 'Calle 3', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500004-0000-0000-0000-000000000b01', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500004-0000-0000-0000-000000000b02', 'e2500004-0000-0000-0000-0000000000c2', 'e2500004-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500004-0000-0000-0000-000000000b03', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('e2500004-0000-0000-0000-000000000b04', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500004-0000-0000-0000-000000000b05', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500004-0000-0000-0000-000000000b06', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today() - 2, '08:00', '12:00', 1, 'completed');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500004-0000-0000-0000-000000000b07', 'e2500004-0000-0000-0000-0000000000c1', 'e2500004-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500004-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500004-0000-0000-0000-000000000b01', 'e2500004-0000-0000-0000-000000000005'),
  ('e2500004-0000-0000-0000-000000000b02', 'e2500004-0000-0000-0000-000000000006'),
  ('e2500004-0000-0000-0000-000000000b03', 'e2500004-0000-0000-0000-000000000005'),
  ('e2500004-0000-0000-0000-000000000b04', 'e2500004-0000-0000-0000-000000000005'),
  ('e2500004-0000-0000-0000-000000000b05', 'e2500004-0000-0000-0000-000000000005'),
  ('e2500004-0000-0000-0000-000000000b06', 'e2500004-0000-0000-0000-000000000005'),
  ('e2500004-0000-0000-0000-000000000b07', 'e2500004-0000-0000-0000-000000000005');

insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('e2500004-0000-0000-0000-000000000004', 'e2500004-0000-0000-0000-0000000000a2', 'e2500004-0000-0000-0000-000000000001');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500004-0000-0000-0000-0000000000d1', 'Test Eper categoría uno', 10),
  ('e2500004-0000-0000-0000-0000000000d2', 'Test Eper categoría dos', 20);

-- Artículos de la prueba: arrancan en cero; el stock entra por registrar ingresos (RPC).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500004-0000-0000-0000-0000000000e1', 'TP-001', 'Test lavandina', '1 L', 'e2500004-0000-0000-0000-0000000000d1', 5, 100.00, 150.00),
  ('e2500004-0000-0000-0000-0000000000e2', 'TP-002', 'Test detergente', '5 L', 'e2500004-0000-0000-0000-0000000000d1', null, 200.00, 300.00),
  ('e2500004-0000-0000-0000-0000000000e3', 'TP-003', 'Test bolsas', 'paquete x 10', 'e2500004-0000-0000-0000-0000000000d2', 2, 50.50, 80.00);

-- Atajos de las fixtures: artículo n, turno n, sede n y usuario n.
create function tests_0070e.sid(n integer) returns uuid language sql immutable as $$ select ('e2500004-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests_0070e.shid(n integer) returns uuid language sql immutable as $$ select ('e2500004-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests_0070e.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500004-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests_0070e.uid(n integer) returns uuid language sql immutable as $$ select ('e2500004-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0070e.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070e.sid(p_n), 'qty', p_qty) $$;
create function tests_0070e.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070e.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests_0070e.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0070e.sid(p_n) $$;

grant execute on all functions in schema tests_0070e to authenticated, anon;

select plan(73);

set local role postgres;

-- Cuenta las filas que la sesión actual puede leer (con su RLS).
create function tests_0070e.rows(p_rel text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ' || p_rel into n;
  return n;
end;
$$;
grant execute on function tests_0070e.rows(text) to authenticated, anon;

create temporary table t_sum (label text primary key, s jsonb) on commit drop;
grant all on t_sum to authenticated;

-- Preparación: stock por ingresos y retiros reales (hora del servidor).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price, stock_qty) values
  (tests_0070e.sid(4), 'TP-004', 'Test sin stock', '1 u', 'e2500004-0000-0000-0000-0000000000d1', null, 10.00, 15.00, 0);
insert into public.supplies (id, code, name, category_id, active) values
  (tests_0070e.sid(5), 'TP-005', 'Test inactivo', 'e2500004-0000-0000-0000-0000000000d1', false);

select app.stock_post_movement('entry', tests_0070e.uid(2),
  jsonb_build_array(
    jsonb_build_object('supply_id', tests_0070e.sid(1), 'qty_delta', 6),
    jsonb_build_object('supply_id', tests_0070e.sid(2), 'qty_delta', 12),
    jsonb_build_object('supply_id', tests_0070e.sid(3), 'qty_delta', 1)));
select app.stock_post_movement('withdrawal', tests_0070e.uid(5),
  jsonb_build_array(jsonb_build_object('supply_id', tests_0070e.sid(1), 'qty_delta', -1)),
  p_person_id => tests_0070e.uid(5), p_shift_id => tests_0070e.shid(1), p_site_id => tests_0070e.siteid(1), p_note => 'Retiro de A');
select app.stock_post_movement('withdrawal', tests_0070e.uid(6),
  jsonb_build_array(jsonb_build_object('supply_id', tests_0070e.sid(2), 'qty_delta', -1)),
  p_person_id => tests_0070e.uid(6), p_shift_id => tests_0070e.shid(2), p_site_id => tests_0070e.siteid(2), p_note => 'Retiro de B');
select app.stock_post_movement('withdrawal', tests_0070e.uid(2),
  jsonb_build_array(jsonb_build_object('supply_id', tests_0070e.sid(2), 'qty_delta', -1)),
  p_person_id => tests_0070e.uid(5), p_shift_id => tests_0070e.shid(1), p_site_id => tests_0070e.siteid(1), p_note => 'Cargado por la oficina para A');

insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by)
values (tests_0070e.sid(1), 90, 100, 140, 150, 'manual', tests_0070e.uid(2));

insert into public.stock_counts (id, counted_at, reviewer_name, created_by) values
  ('e2500004-0000-0000-0000-0000000000f2', now() - interval '1 hour', 'Revisora', tests_0070e.uid(2));
insert into public.stock_count_lines (count_id, supply_id, system_qty, counted_qty, difference) values
  ('e2500004-0000-0000-0000-0000000000f2', tests_0070e.sid(3), 1, 1, 0);

insert into public.supply_shortage_reports (id, reported_by, supply_id, comment) values
  ('e2500004-0000-0000-0000-0000000000f3', tests_0070e.uid(5), tests_0070e.sid(1), 'Se está terminando');
insert into public.supply_shortage_reports (id, reported_by, description) values
  ('e2500004-0000-0000-0000-0000000000f4', tests_0070e.uid(6), 'Guantes talle M');

select is(tests_0070e.stock(1), 5, 'preparación: lavandina 5 (mínimo 5: amarillo)');
select is(tests_0070e.stock(2), 10, 'preparación: detergente 10 (sin mínimo)');
select is(tests_0070e.stock(3), 1, 'preparación: bolsas 1 (mínimo 2: amarillo)');

-- ---------------------------------------------------------------------------------------------
-- 1. anon y grants
-- ---------------------------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from unnest(array[
      'supply_categories', 'supplies', 'supply_price_changes', 'stock_counts', 'stock_count_lines',
      'stock_movements', 'stock_movement_lines', 'supply_shortage_reports',
      'v_supply_catalog', 'v_stock_admin', 'v_stock_movements_admin', 'v_stock_counts_admin',
      'v_supply_consumption_by_client', 'v_my_withdrawals', 'v_my_shortage_reports',
      'v_withdrawal_shift_options', 'v_withdrawal_site_options'
    ]) as t(name)
    where has_table_privilege('anon', 'public.' || t.name, 'select')
       or has_table_privilege('anon', 'public.' || t.name, 'insert')
       or has_table_privilege('anon', 'public.' || t.name, 'update')
       or has_table_privilege('anon', 'public.' || t.name, 'delete')
  ),
  'anon no tiene ningún privilegio sobre las tablas ni las vistas del módulo'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      'supply_categories', 'supplies', 'supply_price_changes', 'stock_counts', 'stock_count_lines',
      'stock_movements', 'stock_movement_lines', 'supply_shortage_reports'
    ]) as t(name)
    where has_table_privilege('authenticated', 'public.' || t.name, 'insert')
       or has_table_privilege('authenticated', 'public.' || t.name, 'update')
       or has_table_privilege('authenticated', 'public.' || t.name, 'delete')
       or not has_table_privilege('authenticated', 'public.' || t.name, 'select')
  ),
  'authenticated solo lee las tablas del módulo (todo se escribe por RPC)'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      'upsert_supply(text, text, uuid, text, integer, numeric, numeric, text, text, uuid)',
      'set_supply_active(uuid, boolean)',
      'set_supply_prices(uuid, numeric, numeric)',
      'upsert_supply_category(text, integer, boolean, uuid)',
      'register_stock_entry(jsonb, text, text, text, public.stock_movement_kind)',
      'adjust_stock(uuid, integer, public.stock_adjustment_reason, text)',
      'register_withdrawal(jsonb, uuid, uuid, text, uuid)',
      'void_stock_movement(uuid, text)',
      'register_stock_count(timestamptz, jsonb, uuid, text, text)',
      'report_supply_shortage(uuid, text, uuid, uuid, text)',
      'resolve_supply_shortage(uuid, text)',
      'get_stock_summary()'
    ]) as f(sig)
    where has_function_privilege('anon', 'public.' || f.sig, 'execute')
       or not has_function_privilege('authenticated', 'public.' || f.sig, 'execute')
  ),
  'las doce RPC del módulo las ejecuta authenticated y no anon'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      'stock_post_movement(public.stock_movement_kind, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text, text, public.stock_adjustment_reason, text, uuid, uuid)',
      'stock_movement_json(uuid, boolean)',
      'stock_lines_normalize(jsonb, integer, boolean)',
      'resolve_stock_place(uuid, uuid, boolean)',
      'supply_stock_at(uuid, timestamptz)',
      'supply_log_price_change(uuid, numeric, numeric, numeric, numeric, text, uuid)'
    ]) as f(sig)
    where has_function_privilege('authenticated', 'app.' || f.sig, 'execute')
       or has_function_privilege('anon', 'app.' || f.sig, 'execute')
  ),
  'el núcleo y los auxiliares del esquema app no los ejecuta ni authenticated ni anon'
);
select ok(
  not has_function_privilege('anon', 'app.supply_catalog()', 'execute')
  and not has_function_privilege('anon', 'app.withdrawal_shift_options()', 'execute')
  and not has_function_privilege('anon', 'app.withdrawal_site_options()', 'execute')
  and not has_function_privilege('anon', 'app.my_withdrawals()', 'execute')
  and not has_function_privilege('anon', 'app.my_shortage_reports()', 'execute')
  and has_function_privilege('authenticated', 'app.supply_catalog()', 'execute'),
  'las funciones de definidor de las vistas del celular no las ejecuta anon'
);

-- ---------------------------------------------------------------------------------------------
-- 2. Lectura por rol: administración lee todo; empleados y coordinadores, nada de las tablas (IS-20)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-admin-sin@example.com');

select ok(
  (select min(tests_0070e.rows(r)) from unnest(array[
     'public.supply_categories', 'public.supplies', 'public.supply_price_changes', 'public.stock_counts',
     'public.stock_count_lines', 'public.stock_movements', 'public.stock_movement_lines',
     'public.supply_shortage_reports', 'public.v_stock_admin', 'public.v_stock_movements_admin',
     'public.v_stock_counts_admin', 'public.v_supply_consumption_by_client'
   ]) as r) > 0,
  'un administrador SIN manage_stock ve toda la sección: tablas y vistas con filas (IS-21)'
);

select tests_0070e.as_user('test-db0070per-owner@example.com');
select ok(
  (select min(tests_0070e.rows(r)) from unnest(array[
     'public.supply_categories', 'public.supplies', 'public.supply_price_changes', 'public.stock_counts',
     'public.stock_count_lines', 'public.stock_movements', 'public.stock_movement_lines',
     'public.supply_shortage_reports', 'public.v_stock_admin', 'public.v_stock_movements_admin',
     'public.v_stock_counts_admin', 'public.v_supply_consumption_by_client'
   ]) as r) > 0,
  'el dueño ve toda la sección'
);

select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select is(
  (select sum(tests_0070e.rows(r))::integer from unnest(array[
     'public.supply_categories', 'public.supplies', 'public.supply_price_changes', 'public.stock_counts',
     'public.stock_count_lines', 'public.stock_movements', 'public.stock_movement_lines',
     'public.supply_shortage_reports', 'public.v_stock_admin', 'public.v_stock_movements_admin',
     'public.v_stock_counts_admin', 'public.v_supply_consumption_by_client'
   ]) as r),
  0,
  'una empleada no lee ninguna tabla ni vista de administración: ni precios, ni cantidades, ni retiros (IS-20)'
);
select tests_0070e.as_user('test-db0070per-emp-b@example.com');
select is(
  (select sum(tests_0070e.rows(r))::integer from unnest(array[
     'public.supply_categories', 'public.supplies', 'public.supply_price_changes', 'public.stock_counts',
     'public.stock_count_lines', 'public.stock_movements', 'public.stock_movement_lines',
     'public.supply_shortage_reports', 'public.v_stock_admin', 'public.v_stock_movements_admin',
     'public.v_stock_counts_admin', 'public.v_supply_consumption_by_client'
   ]) as r),
  0,
  'un empleado tampoco lee los retiros de otro ni los suyos por las tablas'
);
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is(
  (select sum(tests_0070e.rows(r))::integer from unnest(array[
     'public.supply_categories', 'public.supplies', 'public.supply_price_changes', 'public.stock_counts',
     'public.stock_count_lines', 'public.stock_movements', 'public.stock_movement_lines',
     'public.supply_shortage_reports', 'public.v_stock_admin', 'public.v_stock_movements_admin',
     'public.v_stock_counts_admin', 'public.v_supply_consumption_by_client'
   ]) as r),
  0,
  'un coordinador no lee ninguna tabla ni vista de administración'
);

-- ---------------------------------------------------------------------------------------------
-- 3. v_stock_admin: estados y valor a costo (IS-05, IS-24, IS-25)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-admin-sin@example.com');

select results_eq(
  $$select code, status, stock_value from public.v_stock_admin where code like 'TE-%' and active order by code$$,
  $$values ('TP-001'::text, 'low'::text, 500.00::numeric),
           ('TP-002', 'ok', 2000.00),
           ('TP-003', 'low', 50.50),
           ('TP-004', 'empty', 0.00)$$,
  'estado y valor a costo: igual al mínimo = low (amarillo), sin mínimo = ok, cero = empty (rojo)'
);
select is(
  (select active from public.v_stock_admin where code = 'TP-005'),
  false,
  'v_stock_admin incluye los inactivos (el filtro es del cliente)'
);

-- ---------------------------------------------------------------------------------------------
-- 4. v_supply_catalog: sin precios ni cantidades (IS-20)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-emp-a@example.com');

select columns_are(
  'public', 'v_supply_catalog',
  array['id', 'code', 'name', 'presentation', 'category_id', 'category_name', 'category_sort_order', 'image_path', 'out_of_stock'],
  'v_supply_catalog no trae precios, stock ni mínimos: solo out_of_stock'
);
select results_eq(
  $$select code, out_of_stock from public.v_supply_catalog where code like 'TE-%' order by code$$,
  $$values ('TP-001'::text, false), ('TP-002', false), ('TP-003', false), ('TP-004', true)$$,
  'la empleada ve el catálogo activo (sin el inactivo) con out_of_stock solo donde el stock es cero'
);
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is(
  (select count(*)::integer from public.v_supply_catalog where code like 'TE-%'),
  4,
  'el coordinador también ve el catálogo'
);
select tests_0070e.as_user('test-db0070per-admin-sin@example.com');
select is(
  (select count(*)::integer from public.v_supply_catalog where code like 'TE-%'),
  4,
  'la administración también lo ve'
);

-- Una persona desactivada deja de ver el catálogo y de poder retirar (ventana de revocación).
set local role postgres;
update public.profiles set is_active = false where id = tests_0070e.uid(6);
select tests_0070e.as_user('test-db0070per-emp-b@example.com');
select is((select count(*)::integer from public.v_supply_catalog where code like 'TE-%'), 0, 'un empleado desactivado no ve el catálogo');
select is((select count(*)::integer from public.v_withdrawal_shift_options), 0, 'ni los turnos para retirar');
select is(tests_0070e.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070e.l(2, 1)), tests_0070e.shid(2))$$), 'FORBIDDEN', 'ni puede retirar: FORBIDDEN');
set local role postgres;
select set_config('request.jwt.claims', '', true);
update public.profiles set is_active = true where id = tests_0070e.uid(6);

-- ---------------------------------------------------------------------------------------------
-- 5. Mis retiros (IS-20)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-emp-a@example.com');

select columns_are(
  'public', 'v_my_withdrawals',
  array['movement_id', 'recorded_at', 'recorded_by', 'registered_by_name', 'on_behalf', 'shift_id', 'shift_date', 'start_time', 'end_time',
        'client_id', 'client_name', 'site_id', 'site_name', 'note', 'voided_at', 'void_reason', 'total_qty', 'lines'],
  'v_my_withdrawals no trae precios'
);
select results_eq(
  $$select note, on_behalf, registered_by_name, total_qty, client_name, site_name
    from public.v_my_withdrawals order by note$$,
  $$values ('Cargado por la oficina para A'::text, true, 'Admin ConStock'::text, 1, 'Cliente Uno'::text, 'Sede Uno'::text),
           ('Retiro de A', false, null, 1, 'Cliente Uno', 'Sede Uno')$$,
  'la empleada ve solo sus retiros, también el que cargó la oficina a su nombre (on_behalf, con quién lo cargó)'
);
select is(
  (select count(*)::integer from public.v_my_withdrawals where note = 'Retiro de B'),
  0,
  'la empleada no ve el retiro de otro empleado'
);
select ok(
  (select not (lines::text like '%unit_cost%' or lines::text like '%unit_sale%' or lines::text like '%stock%')
          and (lines -> 0 ->> 'qty') = '1'
          and (lines -> 0 ->> 'name') is not null
   from public.v_my_withdrawals where note = 'Retiro de A'),
  'las líneas de mis retiros llevan artículo y cantidad, sin precios ni stock'
);
select tests_0070e.as_user('test-db0070per-emp-b@example.com');
select results_eq(
  $$select note from public.v_my_withdrawals$$,
  $$values ('Retiro de B'::text)$$,
  'el empleado B ve solo el suyo'
);
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is((select count(*)::integer from public.v_my_withdrawals), 0, 'el coordinador no ve retiros ajenos (no tiene propios)');
select tests_0070e.as_user('test-db0070per-admin@example.com');
select is((select count(*)::integer from public.v_my_withdrawals), 0, 'la administración no ve retiros de otros por esta vista (para eso está v_stock_movements_admin)');

-- ---------------------------------------------------------------------------------------------
-- 6. Avisos de faltante (IS-14, IS-29)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-emp-a@example.com');

select results_eq(
  $$select status::text, reported_by, supply_id, site_id, shift_id
    from public.report_supply_shortage(tests_0070e.sid(2), null, tests_0070e.shid(1), null, '  Queda poco ')$$,
  $$values ('open'::text, tests_0070e.uid(5), tests_0070e.sid(2), tests_0070e.siteid(1), tests_0070e.shid(1))$$,
  'avisar un faltante de un artículo del catálogo con un turno propio: abierto, con la sede del turno'
);
select is(
  (select description from public.report_supply_shortage(null, '  Esponjas verdes ', null, tests_0070e.siteid(1), null)),
  'Esponjas verdes',
  'avisar un faltante con texto libre y una sede propia'
);
select is((select count(*)::integer from public.report_supply_shortage(tests_0070e.sid(3))), 1, 'turno y sede son opcionales');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(2), 'y también texto')$$), 'SHORTAGE_TARGET_REQUIRED', 'artículo y texto a la vez: SHORTAGE_TARGET_REQUIRED');
select is(tests_0070e.err_hint($$select public.report_supply_shortage()$$), 'SHORTAGE_TARGET_REQUIRED', 'ni artículo ni texto: SHORTAGE_TARGET_REQUIRED');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(null, '   ')$$), 'SHORTAGE_TARGET_REQUIRED', 'texto en blanco: SHORTAGE_TARGET_REQUIRED');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(5))$$), 'SUPPLY_NOT_FOUND', 'un artículo desactivado: SUPPLY_NOT_FOUND');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(gen_random_uuid())$$), 'SUPPLY_NOT_FOUND', 'un artículo inexistente: SUPPLY_NOT_FOUND');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(1), null, tests_0070e.shid(2))$$), 'SHIFT_NOT_ALLOWED', 'con el turno de otro: SHIFT_NOT_ALLOWED');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(1), null, null, tests_0070e.siteid(2))$$), 'SITE_NOT_ALLOWED', 'con una sede donde no trabaja: SITE_NOT_ALLOWED');

select tests_0070e.as_user('test-db0070per-coord@example.com');
select is(
  (select site_id from public.report_supply_shortage(null, 'Papel higiénico', null, tests_0070e.siteid(2))),
  tests_0070e.siteid(2),
  'el coordinador avisa con cualquier sede'
);

select tests_0070e.as_user('test-db0070per-admin@example.com');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(1))$$), 'FORBIDDEN', 'la administración no avisa faltantes: FORBIDDEN');
select tests_0070e.as_user('test-db0070per-owner@example.com');
select is(tests_0070e.err_hint($$select public.report_supply_shortage(tests_0070e.sid(1))$$), 'FORBIDDEN', 'el dueño tampoco: FORBIDDEN');

select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select columns_are(
  'public', 'v_my_shortage_reports',
  array['id', 'supply_id', 'supply_code', 'supply_name', 'description', 'shift_id', 'shift_date', 'start_time', 'end_time',
        'site_id', 'site_name', 'client_name', 'comment', 'status', 'created_at', 'resolved_at', 'resolved_by_name', 'resolution_note'],
  'v_my_shortage_reports: columnas'
);
select is((select count(*)::integer from public.v_my_shortage_reports), 4, 'la empleada ve sus cuatro avisos (el preparado y los tres que hizo)');
select is((select count(*)::integer from public.v_my_shortage_reports where description = 'Guantes talle M'), 0, 'no ve los avisos de otro');
select is(
  (select supply_name from public.v_my_shortage_reports where comment = 'Queda poco'),
  'Test detergente 5 L',
  'el aviso de un artículo muestra su nombre con la presentación'
);
select tests_0070e.as_user('test-db0070per-emp-b@example.com');
select results_eq(
  $$select description from public.v_my_shortage_reports$$,
  $$values ('Guantes talle M'::text)$$,
  'el empleado B ve solo su aviso'
);
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is((select count(*)::integer from public.v_my_shortage_reports), 1, 'el coordinador ve solo el suyo');

-- Resolver: dueño y administradores, con o sin la capacidad (IS-21).
select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select is(tests_0070e.err_hint($$select public.resolve_supply_shortage('e2500004-0000-0000-0000-0000000000f3', 'Se compró')$$), 'FORBIDDEN', 'un empleado no resuelve avisos: FORBIDDEN');
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is(tests_0070e.err_hint($$select public.resolve_supply_shortage('e2500004-0000-0000-0000-0000000000f3', 'Se compró')$$), 'FORBIDDEN', 'un coordinador no resuelve avisos: FORBIDDEN');

select tests_0070e.as_user('test-db0070per-admin-sin@example.com');
select is(tests_0070e.err_hint($$select public.resolve_supply_shortage('e2500004-0000-0000-0000-0000000000f3', '   ')$$), 'NOTE_REQUIRED', 'resolver sin nota: NOTE_REQUIRED');
select is(tests_0070e.err_hint($$select public.resolve_supply_shortage(gen_random_uuid(), 'Se compró')$$), 'SHORTAGE_NOT_FOUND', 'aviso inexistente: SHORTAGE_NOT_FOUND');
select results_eq(
  $$select status::text, resolved_by, resolution_note, resolved_at is not null
    from public.resolve_supply_shortage('e2500004-0000-0000-0000-0000000000f3', ' Se compró ')$$,
  $$values ('resolved'::text, tests_0070e.uid(3), 'Se compró'::text, true)$$,
  'un administrador SIN manage_stock resuelve el aviso con una nota (IS-21)'
);
select is(tests_0070e.err_hint($$select public.resolve_supply_shortage('e2500004-0000-0000-0000-0000000000f3', 'Otra vez')$$), 'SHORTAGE_ALREADY_RESOLVED', 'resolver dos veces: SHORTAGE_ALREADY_RESOLVED');

select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select results_eq(
  $$select status::text, resolution_note, resolved_by_name from public.v_my_shortage_reports where comment = 'Se está terminando'$$,
  $$values ('resolved'::text, 'Se compró'::text, 'Admin SinStock'::text)$$,
  'la empleada ve el aviso resuelto con la nota y quién lo resolvió'
);
select is(
  (select status::text from app.my_shortage_reports() limit 1),
  'open',
  'abiertos primero'
);

-- ---------------------------------------------------------------------------------------------
-- 7. get_stock_summary (IS-30)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select is(tests_0070e.err_hint($$select public.get_stock_summary()$$), 'FORBIDDEN', 'un empleado no lee el resumen de stock: FORBIDDEN');
select tests_0070e.as_user('test-db0070per-coord@example.com');
select is(tests_0070e.err_hint($$select public.get_stock_summary()$$), 'FORBIDDEN', 'un coordinador no lee el resumen de stock: FORBIDDEN');

select tests_0070e.as_user('test-db0070per-admin-sin@example.com');
insert into t_sum values ('antes', public.get_stock_summary());

select ok(
  (select s ? 'open_reports' and s ? 'open_shortages' and s ? 'out_of_stock' and s ? 'below_min' from t_sum where label = 'antes'),
  'el resumen trae avisos abiertos, avisos por artículo, sin stock y bajo mínimo'
);

set local role postgres;
-- Tres avisos del mismo artículo y dos del mismo texto (distinto en mayúsculas): 5 avisos, 2 por artículo.
insert into public.supply_shortage_reports (reported_by, supply_id) values
  (tests_0070e.uid(5), tests_0070e.sid(4)), (tests_0070e.uid(6), tests_0070e.sid(4)), (tests_0070e.uid(5), tests_0070e.sid(4));
insert into public.supply_shortage_reports (reported_by, description) values
  (tests_0070e.uid(5), 'Trapos zzz'), (tests_0070e.uid(6), '  TRAPOS ZZZ ');
-- Un artículo con mínimo cero y stock cero: cuenta como sin stock, no como bajo mínimo.
insert into public.supplies (id, code, name, category_id, min_qty) values
  (tests_0070e.sid(6), 'TP-006', 'Test mínimo cero', 'e2500004-0000-0000-0000-0000000000d1', 0);
-- La lavandina sube sobre su mínimo (5): sale de «bajo mínimo». El artículo sin stock recibe 3.
update public.supplies set stock_qty = 6 where id = tests_0070e.sid(1);
update public.supplies set stock_qty = 3 where id = tests_0070e.sid(4);

select tests_0070e.as_user('test-db0070per-admin-sin@example.com');
insert into t_sum values ('despues', public.get_stock_summary());

select is(
  (select (d.s ->> 'open_reports')::integer - (a.s ->> 'open_reports')::integer from t_sum a, t_sum d where a.label = 'antes' and d.label = 'despues'),
  5,
  'avisos abiertos: +5'
);
select is(
  (select (d.s ->> 'open_shortages')::integer - (a.s ->> 'open_shortages')::integer from t_sum a, t_sum d where a.label = 'antes' and d.label = 'despues'),
  2,
  'avisos contados por artículo: +2 (el artículo repetido cuenta una vez, el texto repetido una vez)'
);
select is(
  (select (d.s ->> 'out_of_stock')::integer - (a.s ->> 'out_of_stock')::integer from t_sum a, t_sum d where a.label = 'antes' and d.label = 'despues'),
  0,
  'sin stock: +1 (mínimo cero con stock cero) -1 (el que recibió 3) = 0'
);
select is(
  (select (d.s ->> 'below_min')::integer - (a.s ->> 'below_min')::integer from t_sum a, t_sum d where a.label = 'antes' and d.label = 'despues'),
  -1,
  'bajo mínimo: -1 (la lavandina subió sobre el mínimo); el de mínimo cero no cuenta como bajo mínimo'
);

-- ---------------------------------------------------------------------------------------------
-- 8. Turnos y sedes que se pueden elegir (IS-28, CJ-25)
-- ---------------------------------------------------------------------------------------------

select tests_0070e.as_user('test-db0070per-emp-a@example.com');
select results_eq(
  $$select shift_id from public.v_withdrawal_shift_options where shift_id::text like 'e2500004-%' order by shift_date, start_time$$,
  $$values (tests_0070e.shid(1)), (tests_0070e.shid(3)), (tests_0070e.shid(4))$$,
  'la empleada elige entre sus turnos de hoy, mañana y +5 días (no los de otro, ni +10, ni pasados, ni cancelados)'
);
select results_eq(
  $$select site_id from public.v_withdrawal_site_options where site_id::text like 'e2500004-%'$$,
  $$values (tests_0070e.siteid(1))$$,
  'la empleada elige entre las sedes de sus asignaciones'
);
select tests_0070e.as_user('test-db0070per-emp-b@example.com');
select results_eq(
  $$select shift_id from public.v_withdrawal_shift_options where shift_id::text like 'e2500004-%'$$,
  $$values (tests_0070e.shid(2))$$,
  'el empleado B solo tiene su turno'
);
select results_eq(
  $$select site_id from public.v_withdrawal_site_options where site_id::text like 'e2500004-%'$$,
  $$values (tests_0070e.siteid(2))$$,
  'y su sede'
);

select tests_0070e.as_user('test-db0070per-coord@example.com');
select results_eq(
  $$select shift_id from public.v_withdrawal_shift_options where shift_id::text like 'e2500004-%' order by is_priority desc, shift_date, start_time, shift_id$$,
  $$values (tests_0070e.shid(2)), (tests_0070e.shid(1)), (tests_0070e.shid(3)), (tests_0070e.shid(4))$$,
  'el coordinador ve todos los turnos de hoy a +7 días; «Mis sedes» (la sede dos) primero'
);
select is(
  (select shift_id from app.withdrawal_shift_options() where shift_id::text like 'e2500004-%' limit 1),
  tests_0070e.shid(2),
  'la función ya devuelve primero el turno de su sede preferida'
);
select results_eq(
  $$select is_priority, priority_kind from public.v_withdrawal_shift_options where shift_id = tests_0070e.shid(2)$$,
  $$values (true, 'site'::text)$$,
  'el turno de la sede preferida viene marcado (priority_kind = site)'
);
select is(
  (select is_priority from public.v_withdrawal_shift_options where shift_id = tests_0070e.shid(1)),
  false,
  'los demás no'
);
select results_eq(
  $$select site_id from public.v_withdrawal_site_options where site_id::text like 'e2500004-%' order by is_priority desc, site_name$$,
  $$values (tests_0070e.siteid(2)), (tests_0070e.siteid(3)), (tests_0070e.siteid(1))$$,
  'el coordinador elige entre todas las sedes activas, la preferida primero'
);

select tests_0070e.as_user('test-db0070per-admin@example.com');
select results_eq(
  $$select shift_id from public.v_withdrawal_shift_options where shift_id::text like 'e2500004-%' order by shift_date, start_time, shift_id$$,
  $$values (tests_0070e.shid(6)), (tests_0070e.shid(1)), (tests_0070e.shid(2)), (tests_0070e.shid(3)), (tests_0070e.shid(4))$$,
  'la administración (retiro en nombre de otro) ve de 30 días atrás a +7: incluye el pasado, no +10 ni cancelados'
);

select * from finish();

rollback;
