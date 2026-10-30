-- pgTAP de la migración 0070_p25_1_insumos_y_stock.sql (P25.1, módulo E), primera parte: estructura.
--   1. Tablas, vistas (security_invoker), las doce RPC (security definer, search_path), tipos de
--      columna, RLS habilitada y solo las políticas de lectura, triggers.
--   2. Restricciones: unicidad sin distinguir mayúsculas, checks de precios y stock, de cada tipo de
--      movimiento, líneas, historial de precios, controles y avisos.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500002-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0070c;
grant usage on schema tests_0070c to authenticated, anon;

create or replace function tests_0070c.as_user(p_email text)
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
    raise exception 'tests_0070c.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0070c.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0070c.err_hint(p_sql text)
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

grant execute on function tests_0070c.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0070c.err_msg(p_sql text)
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

grant execute on function tests_0070c.err_msg(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e2500002-...). Todo lo que depende de «hoy» usa app.today() (fechas de los
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
  ('e2500002-0000-0000-0000-000000000001', 'test-db0070est-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Insumos')),
  ('e2500002-0000-0000-0000-000000000002', 'test-db0070est-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConStock')),
  ('e2500002-0000-0000-0000-000000000003', 'test-db0070est-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500002-0000-0000-0000-000000000004', 'test-db0070est-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500002-0000-0000-0000-000000000005', 'test-db0070est-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500002-0000-0000-0000-000000000006', 'test-db0070est-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500002-0000-0000-0000-000000000001', 'owner'),
  ('e2500002-0000-0000-0000-000000000002', 'admin'),
  ('e2500002-0000-0000-0000-000000000003', 'admin'),
  ('e2500002-0000-0000-0000-000000000004', 'supervisor'),
  ('e2500002-0000-0000-0000-000000000005', 'employee'),
  ('e2500002-0000-0000-0000-000000000006', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500002-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500002-0000-0000-0000-000000000003', 'manage_users', true),
  ('e2500002-0000-0000-0000-000000000003', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500002-0000-0000-0000-000000000004', '92502004', 'active'),
  ('e2500002-0000-0000-0000-000000000005', '92502005', 'active'),
  ('e2500002-0000-0000-0000-000000000006', '92502006', 'active');

insert into public.clients (id, legal_name, trade_name, status) values
  ('e2500002-0000-0000-0000-0000000000c1', 'Cliente Insumos Uno SA', 'Cliente Uno', 'active'),
  ('e2500002-0000-0000-0000-0000000000c2', 'Cliente Insumos Dos SA', null, 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500002-0000-0000-0000-0000000000a1', 'e2500002-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500002-0000-0000-0000-0000000000a2', 'e2500002-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500002-0000-0000-0000-0000000000a3', 'e2500002-0000-0000-0000-0000000000c1', 'Sede Tres', 'Calle 3', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500002-0000-0000-0000-000000000b01', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500002-0000-0000-0000-000000000b02', 'e2500002-0000-0000-0000-0000000000c2', 'e2500002-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500002-0000-0000-0000-000000000b03', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('e2500002-0000-0000-0000-000000000b04', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500002-0000-0000-0000-000000000b05', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500002-0000-0000-0000-000000000b06', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today() - 2, '08:00', '12:00', 1, 'completed');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500002-0000-0000-0000-000000000b07', 'e2500002-0000-0000-0000-0000000000c1', 'e2500002-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500002-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500002-0000-0000-0000-000000000b01', 'e2500002-0000-0000-0000-000000000005'),
  ('e2500002-0000-0000-0000-000000000b02', 'e2500002-0000-0000-0000-000000000006'),
  ('e2500002-0000-0000-0000-000000000b03', 'e2500002-0000-0000-0000-000000000005'),
  ('e2500002-0000-0000-0000-000000000b04', 'e2500002-0000-0000-0000-000000000005'),
  ('e2500002-0000-0000-0000-000000000b05', 'e2500002-0000-0000-0000-000000000005'),
  ('e2500002-0000-0000-0000-000000000b06', 'e2500002-0000-0000-0000-000000000005'),
  ('e2500002-0000-0000-0000-000000000b07', 'e2500002-0000-0000-0000-000000000005');

insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('e2500002-0000-0000-0000-000000000004', 'e2500002-0000-0000-0000-0000000000a2', 'e2500002-0000-0000-0000-000000000001');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500002-0000-0000-0000-0000000000d1', 'Test Eest categoría uno', 10),
  ('e2500002-0000-0000-0000-0000000000d2', 'Test Eest categoría dos', 20);

-- Artículos de la prueba: arrancan en cero; el stock entra por registrar ingresos (RPC).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500002-0000-0000-0000-0000000000e1', 'TS-001', 'Test lavandina', '1 L', 'e2500002-0000-0000-0000-0000000000d1', 5, 100.00, 150.00),
  ('e2500002-0000-0000-0000-0000000000e2', 'TS-002', 'Test detergente', '5 L', 'e2500002-0000-0000-0000-0000000000d1', null, 200.00, 300.00),
  ('e2500002-0000-0000-0000-0000000000e3', 'TS-003', 'Test bolsas', 'paquete x 10', 'e2500002-0000-0000-0000-0000000000d2', 2, 50.50, 80.00);

-- Atajos de las fixtures: artículo n, turno n, sede n y usuario n.
create function tests_0070c.sid(n integer) returns uuid language sql immutable as $$ select ('e2500002-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests_0070c.shid(n integer) returns uuid language sql immutable as $$ select ('e2500002-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests_0070c.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500002-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests_0070c.uid(n integer) returns uuid language sql immutable as $$ select ('e2500002-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0070c.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070c.sid(p_n), 'qty', p_qty) $$;
create function tests_0070c.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070c.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests_0070c.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0070c.sid(p_n) $$;

grant execute on all functions in schema tests_0070c to authenticated, anon;

select plan(83);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 1. Estructura
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'supply_categories', 'existe supply_categories');
select has_table('public', 'supplies', 'existe supplies');
select has_table('public', 'supply_price_changes', 'existe supply_price_changes');
select has_table('public', 'stock_counts', 'existe stock_counts');
select has_table('public', 'stock_count_lines', 'existe stock_count_lines');
select has_table('public', 'stock_movements', 'existe stock_movements');
select has_table('public', 'stock_movement_lines', 'existe stock_movement_lines');
select has_table('public', 'supply_shortage_reports', 'existe supply_shortage_reports');

select has_view('public', 'v_supply_catalog', 'existe v_supply_catalog');
select has_view('public', 'v_stock_admin', 'existe v_stock_admin');
select has_view('public', 'v_stock_movements_admin', 'existe v_stock_movements_admin');
select has_view('public', 'v_stock_counts_admin', 'existe v_stock_counts_admin');
select has_view('public', 'v_supply_consumption_by_client', 'existe v_supply_consumption_by_client');
select has_view('public', 'v_my_withdrawals', 'existe v_my_withdrawals');
select has_view('public', 'v_my_shortage_reports', 'existe v_my_shortage_reports');
select has_view('public', 'v_withdrawal_shift_options', 'existe v_withdrawal_shift_options');
select has_view('public', 'v_withdrawal_site_options', 'existe v_withdrawal_site_options');

select ok(
  (select count(*) = 9 and bool_and(coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true'])
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in (
     'v_supply_catalog', 'v_stock_admin', 'v_stock_movements_admin', 'v_stock_counts_admin',
     'v_supply_consumption_by_client', 'v_my_withdrawals', 'v_my_shortage_reports',
     'v_withdrawal_shift_options', 'v_withdrawal_site_options')),
  'las nueve vistas son security_invoker'
);

select has_function('public', 'upsert_supply', array['text', 'text', 'uuid', 'text', 'integer', 'numeric', 'numeric', 'text', 'text', 'uuid'], 'upsert_supply');
select has_function('public', 'set_supply_active', array['uuid', 'boolean'], 'set_supply_active');
select has_function('public', 'set_supply_prices', array['uuid', 'numeric', 'numeric'], 'set_supply_prices');
select has_function('public', 'upsert_supply_category', array['text', 'integer', 'boolean', 'uuid'], 'upsert_supply_category');
select has_function('public', 'register_stock_entry', array['jsonb', 'text', 'text', 'text', 'stock_movement_kind'], 'register_stock_entry');
select has_function('public', 'adjust_stock', array['uuid', 'integer', 'stock_adjustment_reason', 'text'], 'adjust_stock');
select has_function('public', 'register_withdrawal', array['jsonb', 'uuid', 'uuid', 'text', 'uuid'], 'register_withdrawal');
select has_function('public', 'void_stock_movement', array['uuid', 'text'], 'void_stock_movement');
select has_function('public', 'register_stock_count', array['timestamp with time zone', 'jsonb', 'uuid', 'text', 'text'], 'register_stock_count');
select has_function('public', 'report_supply_shortage', array['uuid', 'text', 'uuid', 'uuid', 'text'], 'report_supply_shortage');
select has_function('public', 'resolve_supply_shortage', array['uuid', 'text'], 'resolve_supply_shortage');
select has_function('public', 'get_stock_summary', array[]::text[], 'get_stock_summary');

select ok(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, app, pg_temp'])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (
     'upsert_supply', 'set_supply_active', 'set_supply_prices', 'upsert_supply_category', 'register_stock_entry',
     'adjust_stock', 'register_withdrawal', 'void_stock_movement', 'register_stock_count',
     'report_supply_shortage', 'resolve_supply_shortage', 'get_stock_summary')),
  'las doce RPC son security definer con search_path = public, app, pg_temp'
);

select col_type_is('public', 'supplies', 'cost_price', 'numeric(12,2)', 'supplies.cost_price es numeric(12,2)');
select col_type_is('public', 'supplies', 'sale_price', 'numeric(12,2)', 'supplies.sale_price es numeric(12,2)');
select col_type_is('public', 'supplies', 'stock_qty', 'integer', 'supplies.stock_qty es entero (unidades enteras, IS-02)');
select col_type_is('public', 'supplies', 'min_qty', 'integer', 'supplies.min_qty es entero');
select col_is_null('public', 'supplies', 'min_qty', 'supplies.min_qty admite nulo (sin aviso)');
select col_type_is('public', 'stock_movement_lines', 'unit_cost', 'numeric(12,2)', 'stock_movement_lines.unit_cost es numeric(12,2)');
select col_type_is('public', 'stock_movements', 'recorded_at', 'timestamp with time zone', 'stock_movements.recorded_at es timestamptz');
select col_type_is('public', 'stock_movements', 'kind', 'stock_movement_kind', 'stock_movements.kind usa la enumeración');
select col_type_is('public', 'supply_shortage_reports', 'status', 'supply_shortage_status', 'supply_shortage_reports.status usa la enumeración');
select col_is_pk('public', 'stock_count_lines', array['count_id', 'supply_id'], 'stock_count_lines: clave (count_id, supply_id)');

select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relrowsecurity
     and c.relname in ('supply_categories', 'supplies', 'supply_price_changes', 'stock_counts', 'stock_count_lines',
                       'stock_movements', 'stock_movement_lines', 'supply_shortage_reports')),
  8,
  'las ocho tablas tienen RLS habilitada'
);

select policies_are('public', 'supplies', array['supplies_select_admin'], 'supplies: solo la política de lectura de administración');
select policies_are('public', 'stock_movements', array['stock_movements_select_admin'], 'stock_movements: sin políticas de escritura (IS-27)');
select policies_are('public', 'stock_movement_lines', array['stock_movement_lines_select_admin'], 'stock_movement_lines: sin políticas de escritura (IS-27)');
select policies_are('public', 'stock_counts', array['stock_counts_select_admin'], 'stock_counts: sin políticas de escritura (IS-27)');
select policies_are('public', 'stock_count_lines', array['stock_count_lines_select_admin'], 'stock_count_lines: sin políticas de escritura (IS-27)');
select policies_are('public', 'supply_categories', array['supply_categories_select_admin'], 'supply_categories: solo lectura de administración');
select policies_are('public', 'supply_price_changes', array['supply_price_changes_select_admin'], 'supply_price_changes: solo lectura de administración');
select policies_are('public', 'supply_shortage_reports', array['supply_shortage_reports_select_admin'], 'supply_shortage_reports: solo lectura de administración');

select ok(
  (select count(*) = 5 from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgname = 'trg_stock_immutable' and not t.tgisinternal
     and c.relname in ('stock_movements', 'stock_movement_lines', 'stock_counts', 'stock_count_lines', 'supply_price_changes')),
  'las cinco tablas inmutables tienen su trigger'
);
select ok(
  (select count(*) = 3 from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgname = 'trg_set_updated_at' and not t.tgisinternal
     and c.relname in ('supply_categories', 'supplies', 'supply_shortage_reports')),
  'las tablas editables tienen el trigger de updated_at'
);

-- ---------------------------------------------------------------------------------------------
-- 2. Restricciones (como postgres, que esquiva la RLS)
-- ---------------------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.supplies (code, name, category_id) values ('ts-001', 'Duplicado', 'e2500002-0000-0000-0000-0000000000d1')$$,
  '23505', null, 'el código de artículo es único sin distinguir mayúsculas'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id) values ('  TS-001 ', 'Duplicado', 'e2500002-0000-0000-0000-0000000000d1')$$,
  '23505', null, 'ni con espacios de los extremos'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id) values ('   ', 'Sin código', 'e2500002-0000-0000-0000-0000000000d1')$$,
  '23514', null, 'el código no puede estar en blanco'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id, cost_price) values ('TS-X1', 'Costo negativo', 'e2500002-0000-0000-0000-0000000000d1', -1)$$,
  '23514', null, 'el costo no puede ser negativo (IS-34)'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id, sale_price) values ('TS-X2', 'Venta negativa', 'e2500002-0000-0000-0000-0000000000d1', -1)$$,
  '23514', null, 'la venta no puede ser negativa (IS-34)'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id, min_qty) values ('TS-X3', 'Mínimo negativo', 'e2500002-0000-0000-0000-0000000000d1', -1)$$,
  '23514', null, 'el mínimo no puede ser negativo'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id, stock_qty) values ('TS-X4', 'Stock negativo', 'e2500002-0000-0000-0000-0000000000d1', -1)$$,
  '23514', null, 'el stock no puede ser negativo'
);
select throws_ok(
  $$insert into public.supplies (code, name, category_id) values ('TS-X5', 'Sin categoría', null)$$,
  '23502', null, 'el artículo exige categoría'
);
select throws_ok(
  $$insert into public.supply_categories (name) values (' TEST Eest categoría UNO ')$$,
  '23505', null, 'el nombre de categoría es único sin distinguir mayúsculas ni espacios'
);

select lives_ok(
  $$update public.supplies set name = 'Test lavandina editada' where id = tests_0070c.sid(1)$$,
  'un artículo se puede editar'
);
select isnt(
  (select updated_at from public.supplies where id = tests_0070c.sid(1)),
  null,
  'el trigger fija updated_at'
);

-- Movimientos
insert into public.stock_movements (id, kind, recorded_by) values
  ('e2500002-0000-0000-0000-0000000000f5', 'entry', 'e2500002-0000-0000-0000-000000000002');

select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by) values ('withdrawal', 'e2500002-0000-0000-0000-000000000002')$$,
  '23514', null, 'un retiro exige persona y sede'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by, person_id, site_id) values ('withdrawal', 'e2500002-0000-0000-0000-000000000002', null, 'e2500002-0000-0000-0000-0000000000a1')$$,
  '23514', null, 'un retiro exige persona'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by) values ('adjustment', 'e2500002-0000-0000-0000-000000000002')$$,
  '23514', null, 'un ajuste exige motivo (IS-10)'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by) values ('count', 'e2500002-0000-0000-0000-000000000002')$$,
  '23514', null, 'un movimiento de control exige el control'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by) values ('reversal', 'e2500002-0000-0000-0000-000000000002')$$,
  '23514', null, 'una anulación exige el movimiento que anula'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by, reverses_id) values ('entry', 'e2500002-0000-0000-0000-000000000002', 'e2500002-0000-0000-0000-0000000000f5')$$,
  '23514', null, 'solo una anulación puede apuntar a otro movimiento'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by, shift_id) values ('entry', 'e2500002-0000-0000-0000-000000000002', 'e2500002-0000-0000-0000-000000000b01')$$,
  '23514', null, 'un turno exige sede'
);
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by, voided_at) values ('entry', 'e2500002-0000-0000-0000-000000000002', now())$$,
  '23514', null, 'la marca de anulación es todo o nada (quién y motivo)'
);

insert into public.stock_movements (kind, recorded_by, reverses_id) values
  ('reversal', 'e2500002-0000-0000-0000-000000000002', 'e2500002-0000-0000-0000-0000000000f5');
select throws_ok(
  $$insert into public.stock_movements (kind, recorded_by, reverses_id) values ('reversal', 'e2500002-0000-0000-0000-000000000002', 'e2500002-0000-0000-0000-0000000000f5')$$,
  '23505', null, 'un movimiento se anula una sola vez (reverses_id único)'
);

-- Líneas
select throws_ok(
  $$insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
    values ('e2500002-0000-0000-0000-0000000000f5', tests_0070c.sid(1), 0, 1, 1, 0)$$,
  '23514', null, 'una línea no puede mover cero unidades'
);
select throws_ok(
  $$insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
    values ('e2500002-0000-0000-0000-0000000000f5', tests_0070c.sid(1), 1, -1, 1, 1)$$,
  '23514', null, 'una línea no puede tener precios negativos'
);
select throws_ok(
  $$insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
    values ('e2500002-0000-0000-0000-0000000000f5', tests_0070c.sid(1), -1, 1, 1, -1)$$,
  '23514', null, 'una línea no puede dejar el stock resultante negativo'
);
insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
values ('e2500002-0000-0000-0000-0000000000f5', tests_0070c.sid(1), 1, 1, 1, 1);
select throws_ok(
  $$insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
    values ('e2500002-0000-0000-0000-0000000000f5', tests_0070c.sid(1), 2, 1, 1, 3)$$,
  '23505', null, 'un artículo aparece una sola vez por movimiento'
);

-- Historial de precios, controles y avisos
select throws_ok(
  $$insert into public.supply_price_changes (supply_id, new_cost_price, new_sale_price, source) values (tests_0070c.sid(1), 1, 1, 'otro')$$,
  '23514', null, 'el origen del cambio de precio es create, manual o entry'
);
insert into public.stock_counts (id, counted_at, reviewer_name, created_by) values
  ('e2500002-0000-0000-0000-0000000000f6', now(), 'Revisora', 'e2500002-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into public.stock_count_lines (count_id, supply_id, system_qty, counted_qty, difference)
    values ('e2500002-0000-0000-0000-0000000000f6', tests_0070c.sid(1), 5, 3, 1)$$,
  '23514', null, 'la diferencia de una línea de control es contado menos sistema'
);
select throws_ok(
  $$insert into public.supply_shortage_reports (reported_by, supply_id, description) values ('e2500002-0000-0000-0000-000000000005', tests_0070c.sid(1), 'y texto')$$,
  '23514', null, 'un aviso es de un artículo o de un texto, no de los dos'
);
select throws_ok(
  $$insert into public.supply_shortage_reports (reported_by) values ('e2500002-0000-0000-0000-000000000005')$$,
  '23514', null, 'un aviso exige artículo o texto'
);
select throws_ok(
  $$insert into public.supply_shortage_reports (reported_by, supply_id, shift_id) values ('e2500002-0000-0000-0000-000000000005', tests_0070c.sid(1), 'e2500002-0000-0000-0000-000000000b01')$$,
  '23514', null, 'un aviso con turno exige sede'
);
select throws_ok(
  $$insert into public.supply_shortage_reports (reported_by, supply_id, status) values ('e2500002-0000-0000-0000-000000000005', tests_0070c.sid(1), 'resolved')$$,
  '23514', null, 'un aviso resuelto exige quién, cuándo y nota'
);
select throws_ok(
  $$insert into public.supply_shortage_reports (reported_by, supply_id, resolved_by) values ('e2500002-0000-0000-0000-000000000005', tests_0070c.sid(1), 'e2500002-0000-0000-0000-000000000002')$$,
  '23514', null, 'un aviso abierto no puede traer datos de resolución'
);

select * from finish();

rollback;
