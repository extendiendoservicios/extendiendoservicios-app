-- pgTAP de la migración 0070_p25_1_insumos_y_stock.sql (P25.1, módulo E), tercera parte: movimientos.
--   1. Ingreso: precios guardados en cada línea (IS-22), actualización del costo (IS-23), historial.
--   2. Validaciones del ingreso y devolución (IS-08). 3. Ajustes con motivo (IS-10).
--   4-6. Retiros del empleado, del coordinador y en nombre de otro (IS-11, IS-12, IS-20, IS-21,
--        IS-28): turnos y sedes permitidos, mensaje sin cantidad para quien no es administración.
--   7. El stock nunca queda negativo, también con retiros que compiten.
--   8. Anulación y contramovimiento enlazado (IS-13, IS-27). 9. Inmutabilidad.
--   10. Vistas de movimientos y de consumo por cliente (IS-18, IS-24). 11. Sin capacidad no se mueve.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500003-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0070d;
grant usage on schema tests_0070d to authenticated, anon;

create or replace function tests_0070d.as_user(p_email text)
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
    raise exception 'tests_0070d.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0070d.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0070d.err_hint(p_sql text)
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

grant execute on function tests_0070d.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0070d.err_msg(p_sql text)
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

grant execute on function tests_0070d.err_msg(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e2500003-...). Todo lo que depende de «hoy» usa app.today() (fechas de los
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
  ('e2500003-0000-0000-0000-000000000001', 'test-db0070mov-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Insumos')),
  ('e2500003-0000-0000-0000-000000000002', 'test-db0070mov-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConStock')),
  ('e2500003-0000-0000-0000-000000000003', 'test-db0070mov-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500003-0000-0000-0000-000000000004', 'test-db0070mov-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500003-0000-0000-0000-000000000005', 'test-db0070mov-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500003-0000-0000-0000-000000000006', 'test-db0070mov-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500003-0000-0000-0000-000000000001', 'owner'),
  ('e2500003-0000-0000-0000-000000000002', 'admin'),
  ('e2500003-0000-0000-0000-000000000003', 'admin'),
  ('e2500003-0000-0000-0000-000000000004', 'supervisor'),
  ('e2500003-0000-0000-0000-000000000005', 'employee'),
  ('e2500003-0000-0000-0000-000000000006', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500003-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500003-0000-0000-0000-000000000003', 'manage_users', true),
  ('e2500003-0000-0000-0000-000000000003', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500003-0000-0000-0000-000000000004', '92503004', 'active'),
  ('e2500003-0000-0000-0000-000000000005', '92503005', 'active'),
  ('e2500003-0000-0000-0000-000000000006', '92503006', 'active');

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('e2500003-0000-0000-0000-0000000000c1', 'Cliente Insumos Uno SA', 'Cliente Uno', 'active', 0),
  ('e2500003-0000-0000-0000-0000000000c2', 'Cliente Insumos Dos SA', null, 'active', 0);

insert into public.sites (id, client_id, name, address, status) values
  ('e2500003-0000-0000-0000-0000000000a1', 'e2500003-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500003-0000-0000-0000-0000000000a2', 'e2500003-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500003-0000-0000-0000-0000000000a3', 'e2500003-0000-0000-0000-0000000000c1', 'Sede Tres', 'Calle 3', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500003-0000-0000-0000-000000000b01', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500003-0000-0000-0000-000000000b02', 'e2500003-0000-0000-0000-0000000000c2', 'e2500003-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500003-0000-0000-0000-000000000b03', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('e2500003-0000-0000-0000-000000000b04', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500003-0000-0000-0000-000000000b05', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500003-0000-0000-0000-000000000b06', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today() - 2, '08:00', '12:00', 1, 'completed');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500003-0000-0000-0000-000000000b07', 'e2500003-0000-0000-0000-0000000000c1', 'e2500003-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500003-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500003-0000-0000-0000-000000000b01', 'e2500003-0000-0000-0000-000000000005'),
  ('e2500003-0000-0000-0000-000000000b02', 'e2500003-0000-0000-0000-000000000006'),
  ('e2500003-0000-0000-0000-000000000b03', 'e2500003-0000-0000-0000-000000000005'),
  ('e2500003-0000-0000-0000-000000000b04', 'e2500003-0000-0000-0000-000000000005'),
  ('e2500003-0000-0000-0000-000000000b05', 'e2500003-0000-0000-0000-000000000005'),
  ('e2500003-0000-0000-0000-000000000b06', 'e2500003-0000-0000-0000-000000000005'),
  ('e2500003-0000-0000-0000-000000000b07', 'e2500003-0000-0000-0000-000000000005');

insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('e2500003-0000-0000-0000-000000000004', 'e2500003-0000-0000-0000-0000000000a2', 'e2500003-0000-0000-0000-000000000001');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500003-0000-0000-0000-0000000000d1', 'Test Emov categoría uno', 10),
  ('e2500003-0000-0000-0000-0000000000d2', 'Test Emov categoría dos', 20);

-- Artículos de la prueba: arrancan en cero; el stock entra por registrar ingresos (RPC).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500003-0000-0000-0000-0000000000e1', 'TM-001', 'Test lavandina', '1 L', 'e2500003-0000-0000-0000-0000000000d1', 5, 100.00, 150.00),
  ('e2500003-0000-0000-0000-0000000000e2', 'TM-002', 'Test detergente', '5 L', 'e2500003-0000-0000-0000-0000000000d1', null, 200.00, 300.00),
  ('e2500003-0000-0000-0000-0000000000e3', 'TM-003', 'Test bolsas', 'paquete x 10', 'e2500003-0000-0000-0000-0000000000d2', 2, 50.50, 80.00);

-- Atajos de las fixtures: artículo n, turno n, sede n y usuario n.
create function tests_0070d.sid(n integer) returns uuid language sql immutable as $$ select ('e2500003-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests_0070d.shid(n integer) returns uuid language sql immutable as $$ select ('e2500003-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests_0070d.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500003-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests_0070d.uid(n integer) returns uuid language sql immutable as $$ select ('e2500003-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0070d.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070d.sid(p_n), 'qty', p_qty) $$;
create function tests_0070d.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070d.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests_0070d.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0070d.sid(p_n) $$;

grant execute on all functions in schema tests_0070d to authenticated, anon;

select plan(123);

-- ---------------------------------------------------------------------------------------------
-- 1. Ingreso: precios del momento (IS-22) y actualización del costo (IS-23)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-admin@example.com');

select is(
  (select public.register_stock_entry(
     jsonb_build_array(tests_0070d.lc(1, 10, 90, true), tests_0070d.l(2, 4), tests_0070d.l(3, 20)),
     '  Proveedor Uno ', 'R-0001-123', 'Ingreso de prueba'
   ) -> 'movement' ->> 'kind'),
  'entry',
  'el ingreso devuelve el movimiento kind entry'
);

select is(tests_0070d.stock(1), 10, 'el ingreso suma 10 a la lavandina');
select is(tests_0070d.stock(2), 4, 'el ingreso suma 4 al detergente');

set local role postgres;

select is(
  (select cost_price from public.supplies where id = tests_0070d.sid(1)),
  90.00::numeric,
  'update_cost = true con un costo distinto: el costo vigente pasa a 90,00 (IS-23)'
);
select is(
  (select count(*)::integer from public.supply_price_changes
   where supply_id = tests_0070d.sid(1) and source = 'entry' and old_cost_price = 100.00 and new_cost_price = 90.00
     and old_sale_price = 150.00 and new_sale_price = 150.00),
  1,
  'el cambio de costo por el ingreso queda en el historial con el valor anterior y el nuevo'
);
select is(
  (select count(*)::integer from public.security_events
   where event_type = 'supply_price_changed' and details ->> 'supply_id' = tests_0070d.sid(1)::text),
  1,
  'el cambio de precio queda en security_events'
);
select results_eq(
  $$select l.unit_cost, l.unit_sale, l.stock_after
    from public.stock_movement_lines l join public.stock_movements m on m.id = l.movement_id
    where m.kind = 'entry' and l.supply_id = tests_0070d.sid(1)$$,
  $$values (90.00::numeric, 150.00::numeric, 10)$$,
  'la línea guarda el costo indicado, la venta vigente y el stock resultante'
);
select results_eq(
  $$select l.unit_cost, l.unit_sale
    from public.stock_movement_lines l join public.stock_movements m on m.id = l.movement_id
    where m.kind = 'entry' and l.supply_id = tests_0070d.sid(2)$$,
  $$values (200.00::numeric, 300.00::numeric)$$,
  'sin costo indicado la línea guarda el costo y la venta vigentes'
);
select results_eq(
  $$select supplier, document_number, note, recorded_by from public.stock_movements where kind = 'entry' and recorded_by = tests_0070d.uid(2) and supplier is not null$$,
  $$values ('Proveedor Uno'::text, 'R-0001-123'::text, 'Ingreso de prueba'::text, tests_0070d.uid(2))$$,
  'proveedor, comprobante y nota se guardan sin espacios de los extremos, y recorded_by es quien lo cargó'
);

select tests_0070d.as_user('test-db0070mov-admin@example.com');

-- Cambiar precios: el historial crece y lo ya movido conserva el precio de su momento.
select is(
  (select cost_price from public.set_supply_prices(tests_0070d.sid(1), 120, 180)),
  120.00::numeric,
  'set_supply_prices devuelve la fila con el costo nuevo'
);

set local role postgres;

select is(
  (select count(*)::integer from public.supply_price_changes
   where supply_id = tests_0070d.sid(1) and source = 'manual' and old_cost_price = 90.00 and new_cost_price = 120.00
     and old_sale_price = 150.00 and new_sale_price = 180.00 and changed_by = tests_0070d.uid(2)),
  1,
  'el cambio manual de precios queda en el historial (quién, anterior y nuevo)'
);
select results_eq(
  $$select l.unit_cost, l.unit_sale
    from public.stock_movement_lines l join public.stock_movements m on m.id = l.movement_id
    where m.kind = 'entry' and l.supply_id = tests_0070d.sid(1)$$,
  $$values (90.00::numeric, 150.00::numeric)$$,
  'lo histórico no se recalcula: la línea del ingreso conserva 90,00 y 150,00 (IS-22)'
);

select tests_0070d.as_user('test-db0070mov-admin@example.com');

select is(
  (select cost_price from public.set_supply_prices(tests_0070d.sid(1), 120, 180)),
  120.00::numeric,
  'repetir los mismos precios no falla'
);

set local role postgres;

select is(
  (select count(*)::integer from public.supply_price_changes where supply_id = tests_0070d.sid(1) and source = 'manual'),
  1,
  'repetir los mismos precios no agrega otra fila al historial'
);

select tests_0070d.as_user('test-db0070mov-admin@example.com');

select is(tests_0070d.err_hint($$select public.set_supply_prices(tests_0070d.sid(1), -1, 10)$$), 'INVALID_PRICE', 'precio negativo: INVALID_PRICE');
select is(tests_0070d.err_hint($$select public.set_supply_prices(tests_0070d.sid(1), 10.005, 10)$$), 'INVALID_PRICE', 'más de dos decimales: INVALID_PRICE (IS-34)');
select is(tests_0070d.err_hint($$select public.set_supply_prices(tests_0070d.sid(1), null, 10)$$), 'INVALID_PRICE', 'precio nulo: INVALID_PRICE');
select is(tests_0070d.err_hint($$select public.set_supply_prices(gen_random_uuid(), 1, 1)$$), 'SUPPLY_NOT_FOUND', 'artículo inexistente: SUPPLY_NOT_FOUND');

-- ---------------------------------------------------------------------------------------------
-- 2. Validaciones del ingreso
-- ---------------------------------------------------------------------------------------------

select is(tests_0070d.err_hint($$select public.register_stock_entry('[]'::jsonb)$$), 'INVALID_LINES', 'ingreso sin líneas: INVALID_LINES');
select is(tests_0070d.err_hint($$select public.register_stock_entry(null)$$), 'INVALID_LINES', 'ingreso con líneas nulas: INVALID_LINES');
select is(tests_0070d.err_hint($$select public.register_stock_entry('{"a": 1}'::jsonb)$$), 'INVALID_LINES', 'líneas que no son un arreglo: INVALID_LINES');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 0)))$$), 'INVALID_QTY', 'cantidad 0: INVALID_QTY');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, -3)))$$), 'INVALID_QTY', 'cantidad negativa en un ingreso: INVALID_QTY');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1.5)))$$), 'INVALID_QTY', 'cantidad con decimales: INVALID_QTY (unidades enteras, IS-02)');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1), tests_0070d.l(1, 2)))$$), 'DUPLICATE_SUPPLY', 'artículo repetido: DUPLICATE_SUPPLY');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(jsonb_build_object('supply_id', gen_random_uuid(), 'qty', 1)))$$), 'SUPPLY_NOT_FOUND', 'artículo inexistente: SUPPLY_NOT_FOUND');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.lc(1, 1, -5, false)))$$), 'INVALID_PRICE', 'costo negativo: INVALID_PRICE');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(jsonb_build_object('supply_id', 'no-es-uuid', 'qty', 1)))$$), 'INVALID_LINES', 'supply_id mal formado: INVALID_LINES');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1)), p_kind => 'withdrawal')$$), 'INVALID_KIND', 'tipo distinto de ingreso o devolución: INVALID_KIND');
select is(tests_0070d.stock(1), 10, 'los ingresos rechazados no tocaron el stock');

select is(
  (select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 2)), p_kind => 'return') -> 'movement' ->> 'kind'),
  'return',
  'una devolución es un ingreso de tipo return (IS-08)'
);
select is(tests_0070d.stock(1), 12, 'la devolución suma al stock');

-- ---------------------------------------------------------------------------------------------
-- 3. Ajustes (IS-10)
-- ---------------------------------------------------------------------------------------------

select is(
  (select public.adjust_stock(tests_0070d.sid(2), 2, 'count', 'Faltaba cargar') -> 'lines' -> 0 ->> 'stock_after'),
  '6',
  'ajuste +2: stock resultante 6 en la línea'
);
select is(
  (select public.adjust_stock(tests_0070d.sid(2), -1, 'breakage') -> 'movement' ->> 'reason'),
  'breakage',
  'ajuste -1 por rotura (la nota es opcional con ese motivo)'
);
select is(tests_0070d.stock(2), 5, 'el stock del detergente quedó en 5');
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(2), -100, 'expired')$$), 'INSUFFICIENT_STOCK', 'un ajuste que deja el stock negativo: INSUFFICIENT_STOCK');
select ok(
  tests_0070d.err_msg($$select public.adjust_stock(tests_0070d.sid(2), -100, 'expired')$$) like '%hay 5%',
  'la administración sí ve cuánto hay en el mensaje'
);
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(2), 1, null)$$), 'REASON_REQUIRED', 'ajuste sin motivo: REASON_REQUIRED');
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(2), 1, 'other')$$), 'NOTE_REQUIRED', 'motivo «otro» sin nota: NOTE_REQUIRED');
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(2), 0, 'count')$$), 'INVALID_QTY', 'ajuste de 0: INVALID_QTY');
select is(tests_0070d.err_hint($$select public.adjust_stock(gen_random_uuid(), 1, 'count')$$), 'SUPPLY_NOT_FOUND', 'ajuste de un artículo inexistente: SUPPLY_NOT_FOUND');
select is(tests_0070d.stock(2), 5, 'los ajustes rechazados no tocaron el stock');

-- ---------------------------------------------------------------------------------------------
-- 4. Retiros del empleado (IS-11 a IS-13, IS-20, IS-28)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-emp-a@example.com');

select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 3)), tests_0070d.shid(1), null, 'Para el turno de hoy') -> 'movement' ->> 'kind'),
  'withdrawal',
  'la empleada retira con su turno de hoy'
);

select ok(
  not ((select public.register_withdrawal(jsonb_build_array(tests_0070d.l(3, 1)), tests_0070d.shid(4)) -> 'lines' -> 0) ? 'unit_cost')
  and not ((select public.register_withdrawal(jsonb_build_array(tests_0070d.l(3, 1)), tests_0070d.shid(3)) -> 'lines' -> 0) ? 'stock_after'),
  'lo que devuelve el retiro no trae precios ni stock resultante (IS-20); turnos de mañana y de +5 días permitidos'
);

select is(tests_0070d.stock(1), 9, 'el retiro descuenta el stock en el momento (12 - 3)');

set local role postgres;

select results_eq(
  $$select m.person_id, m.recorded_by, m.shift_id, m.site_id, l.qty_delta, l.unit_cost, l.unit_sale, l.stock_after
    from public.stock_movements m join public.stock_movement_lines l on l.movement_id = m.id
    where m.kind = 'withdrawal' and l.supply_id = tests_0070d.sid(1)$$,
  $$values (tests_0070d.uid(5), tests_0070d.uid(5), tests_0070d.shid(1), tests_0070d.siteid(1), -3, 120.00::numeric, 180.00::numeric, 9)$$,
  'el retiro guarda quién retira, el turno, la sede (la del turno) y el costo y la venta del momento (120 y 180)'
);

select tests_0070d.as_user('test-db0070mov-emp-a@example.com');

select is(
  tests_0070d.err_msg($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 100)), tests_0070d.shid(1))$$),
  'No alcanza el stock de Test lavandina 1 L. Consultá en la oficina.',
  'stock insuficiente: el mensaje del empleado no dice cuánto hay (IS-20, IS-28)'
);
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 100)), tests_0070d.shid(1))$$), 'INSUFFICIENT_STOCK', 'stock insuficiente: INSUFFICIENT_STOCK');
select is(tests_0070d.stock(1), 9, 'el retiro rechazado no tocó el stock');

select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(2))$$), 'SHIFT_NOT_ALLOWED', 'el turno de otro empleado: SHIFT_NOT_ALLOWED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(5))$$), 'SHIFT_NOT_ALLOWED', 'un turno a +10 días: SHIFT_NOT_ALLOWED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(6))$$), 'SHIFT_NOT_ALLOWED', 'un turno de hace 2 días: SHIFT_NOT_ALLOWED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(7))$$), 'SHIFT_NOT_AVAILABLE', 'un turno cancelado: SHIFT_NOT_AVAILABLE');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), gen_random_uuid())$$), 'SHIFT_NOT_FOUND', 'un turno inexistente: SHIFT_NOT_FOUND');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)))$$), 'SHIFT_OR_SITE_REQUIRED', 'sin turno ni sede: SHIFT_OR_SITE_REQUIRED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), null, tests_0070d.siteid(1))$$), 'NOTE_REQUIRED', 'sede sin turno y sin observación: NOTE_REQUIRED (IS-12)');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), null, tests_0070d.siteid(2), 'reposición')$$), 'SITE_NOT_ALLOWED', 'una sede donde no trabaja: SITE_NOT_ALLOWED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1), tests_0070d.siteid(3))$$), 'SITE_SHIFT_MISMATCH', 'sede distinta de la del turno: SITE_SHIFT_MISMATCH');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), null, gen_random_uuid(), 'x')$$), 'SITE_NOT_FOUND', 'sede inexistente: SITE_NOT_FOUND');
select is(tests_0070d.err_hint($$select public.register_withdrawal('[]'::jsonb, tests_0070d.shid(1))$$), 'INVALID_LINES', 'retiro sin líneas: INVALID_LINES');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 0)), tests_0070d.shid(1))$$), 'INVALID_QTY', 'retiro de cantidad 0: INVALID_QTY');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, -2)), tests_0070d.shid(1))$$), 'INVALID_QTY', 'retiro de cantidad negativa: INVALID_QTY');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1), tests_0070d.l(1, 1)), tests_0070d.shid(1))$$), 'DUPLICATE_SUPPLY', 'retiro con un artículo repetido: DUPLICATE_SUPPLY');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), null, tests_0070d.siteid(1), 'Reposición de la semana') -> 'movement' ->> 'site_id'),
  tests_0070d.siteid(1)::text,
  'sede de sus asignaciones con observación: anda (IS-12)'
);
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1), null, null, tests_0070d.uid(6))$$), 'FORBIDDEN', 'un empleado no retira en nombre de otro: FORBIDDEN');

-- Un artículo desactivado no se puede retirar.
set local role postgres;
insert into public.supplies (id, code, name, category_id, active) values (tests_0070d.sid(7), 'TM-007', 'Test desactivado', 'e2500003-0000-0000-0000-0000000000d1', false);
select tests_0070d.as_user('test-db0070mov-emp-a@example.com');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(7, 1)), tests_0070d.shid(1))$$), 'SUPPLY_INACTIVE', 'retirar un artículo desactivado: SUPPLY_INACTIVE');

-- Empleado B: no es su turno.
select tests_0070d.as_user('test-db0070mov-emp-b@example.com');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1))$$), 'SHIFT_NOT_ALLOWED', 'el empleado B no usa el turno de la empleada A');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(2)) -> 'movement' ->> 'person_id'),
  tests_0070d.uid(6)::text,
  'el empleado B retira con su turno'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Retiros del coordinador (IS-28, CJ-25)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-coord@example.com');

select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(2, 2)), null, tests_0070d.siteid(3), 'Reposición de la semana') -> 'movement' ->> 'person_id'),
  tests_0070d.uid(4)::text,
  'el coordinador retira para cualquier sede activa con observación'
);
select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1)) -> 'movement' ->> 'shift_id'),
  tests_0070d.shid(1)::text,
  'el coordinador elige el turno de cualquiera (hoy)'
);
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(5))$$), 'SHIFT_NOT_ALLOWED', 'el coordinador tampoco pasa de los 7 días: SHIFT_NOT_ALLOWED');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(7))$$), 'SHIFT_NOT_AVAILABLE', 'el coordinador no usa un turno cancelado');
select is(
  tests_0070d.err_msg($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1000)), tests_0070d.shid(1))$$),
  'No alcanza el stock de Test lavandina 1 L. Consultá en la oficina.',
  'el coordinador tampoco ve cuánto hay'
);

-- ---------------------------------------------------------------------------------------------
-- 6. Retiro en nombre de otra persona (IS-11, IS-21)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-admin@example.com');

select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1))$$), 'PERSON_REQUIRED', 'la administración sin rol de empleado tiene que indicar quién retira: PERSON_REQUIRED');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(6), null, 'Cargado por la oficina', tests_0070d.uid(5)) -> 'movement' ->> 'person_id'),
  tests_0070d.uid(5)::text,
  'la administración carga un retiro de un turno pasado a nombre de la empleada'
);
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1), null, null, tests_0070d.uid(1))$$), 'PERSON_NOT_FOUND', 'a nombre del dueño (ni empleado ni coordinador): PERSON_NOT_FOUND');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(7), null, null, tests_0070d.uid(5))$$), 'SHIFT_NOT_AVAILABLE', 'a nombre de otro con un turno cancelado: SHIFT_NOT_AVAILABLE');
select ok(
  tests_0070d.err_msg($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1000)), tests_0070d.shid(1), null, null, tests_0070d.uid(5))$$) like '%hay %',
  'la administración sí ve cuánto hay cuando no alcanza'
);

select tests_0070d.as_user('test-db0070mov-admin-sin@example.com');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1), null, null, tests_0070d.uid(5))$$), 'FORBIDDEN', 'el administrador sin manage_stock no retira en nombre de otro: FORBIDDEN');

select tests_0070d.as_user('test-db0070mov-owner@example.com');
select is(
  (select public.register_withdrawal(jsonb_build_array(tests_0070d.l(1, 1)), tests_0070d.shid(1), null, null, tests_0070d.uid(5)) -> 'movement' ->> 'recorded_by'),
  tests_0070d.uid(1)::text,
  'el dueño tiene manage_stock implícita: retira en nombre de otro (recorded_by = dueño)'
);

-- ---------------------------------------------------------------------------------------------
-- 7. Stock nunca negativo, también con retiros que compiten (serializados por el bloqueo)
-- ---------------------------------------------------------------------------------------------

set local role postgres;
insert into public.supplies (id, code, name, presentation, category_id, cost_price, sale_price) values
  (tests_0070d.sid(4), 'TM-004', 'Test escasez', '1 u', 'e2500003-0000-0000-0000-0000000000d1', 10.00, 15.00);

select tests_0070d.as_user('test-db0070mov-admin@example.com');
select public.register_stock_entry(jsonb_build_array(tests_0070d.l(4, 5)));

select tests_0070d.as_user('test-db0070mov-emp-a@example.com');
select public.register_withdrawal(jsonb_build_array(tests_0070d.l(4, 3)), tests_0070d.shid(1));
select tests_0070d.as_user('test-db0070mov-emp-b@example.com');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(4, 3)), tests_0070d.shid(2))$$), 'INSUFFICIENT_STOCK', 'el segundo retiro que no alcanza falla: INSUFFICIENT_STOCK');
select is(tests_0070d.stock(4), 2, 'queda el stock que dejó el primero (5 - 3)');
select public.register_withdrawal(jsonb_build_array(tests_0070d.l(4, 2)), tests_0070d.shid(2));
select is(tests_0070d.stock(4), 0, 'se puede retirar justo lo que hay: queda en cero');
select is(tests_0070d.err_hint($$select public.register_withdrawal(jsonb_build_array(tests_0070d.l(4, 1)), tests_0070d.shid(2))$$), 'INSUFFICIENT_STOCK', 'con stock cero no se retira nada');

set local role postgres;
select is((select min(stock_after) from public.stock_movement_lines)::integer >= 0, true, 'ninguna línea de movimiento dejó stock negativo');
select is((select count(*)::integer from public.supplies where stock_qty < 0), 0, 'ningún artículo tiene stock negativo');
select throws_ok(
  $$update public.supplies set stock_qty = -1 where id = tests_0070d.sid(4)$$,
  '23514',
  null,
  'la restricción supplies_stock_qty_check rechaza un stock negativo'
);

-- Un test de pgTAP corre en una sola sesión y no puede competir de verdad: se verifica que el
-- núcleo bloquee las filas de los artículos en orden de id antes de calcular (IS-13).
select ok(
  (select prosrc from pg_proc where oid = 'app.stock_post_movement(public.stock_movement_kind, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text, text, public.stock_adjustment_reason, text, uuid, uuid)'::regprocedure) ~ 'order by s\.id\s+for update of s',
  'el núcleo bloquea los artículos en orden de id (order by s.id for update)'
);
select ok(
  (select prosrc from pg_proc where oid = 'public.register_stock_count(timestamptz, jsonb, uuid, text, text)'::regprocedure) ~ 'order by s\.id\s+for update of s',
  'el control también bloquea los artículos en orden de id'
);

-- ---------------------------------------------------------------------------------------------
-- 8. Anulación y contramovimiento (IS-13, IS-27)
-- ---------------------------------------------------------------------------------------------

-- Retiro de la empleada A de 2 detergentes (artículo 2) y su anulación.
select tests_0070d.as_user('test-db0070mov-emp-a@example.com');
select public.register_withdrawal(jsonb_build_array(tests_0070d.l(2, 1)), tests_0070d.shid(1), null, 'Retiro que se anula');

set local role postgres;
select is(tests_0070d.stock(2), 2, 'detergente: 5 - 2 (coordinador) - 1 (empleada) = 2');

create temporary table t_void on commit drop as
select m.id as movement_id from public.stock_movements m
where m.kind = 'withdrawal' and m.note = 'Retiro que se anula';
grant select on t_void to authenticated;

select tests_0070d.as_user('test-db0070mov-emp-a@example.com');
select is(tests_0070d.err_hint($$select public.void_stock_movement((select movement_id from t_void), 'No debería')$$), 'FORBIDDEN', 'un empleado no anula: FORBIDDEN');
select tests_0070d.as_user('test-db0070mov-admin-sin@example.com');
select is(tests_0070d.err_hint($$select public.void_stock_movement((select movement_id from t_void), 'No debería')$$), 'FORBIDDEN', 'el administrador sin manage_stock no anula: FORBIDDEN');

select tests_0070d.as_user('test-db0070mov-admin@example.com');
select is(tests_0070d.err_hint($$select public.void_stock_movement((select movement_id from t_void), '   ')$$), 'REASON_REQUIRED', 'anular sin motivo: REASON_REQUIRED');
select is(tests_0070d.err_hint($$select public.void_stock_movement(gen_random_uuid(), 'Motivo')$$), 'MOVEMENT_NOT_FOUND', 'anular un movimiento inexistente: MOVEMENT_NOT_FOUND');

select is(
  (select public.void_stock_movement((select movement_id from t_void), 'Se cargó dos veces') -> 'movement' ->> 'void_reason'),
  'Se cargó dos veces',
  'la anulación devuelve el original con el motivo'
);
select is(tests_0070d.stock(2), 3, 'la anulación devuelve la cantidad al stock (2 + 1)');

set local role postgres;

select results_eq(
  $$select r.kind::text, r.reverses_id, r.person_id, r.shift_id, r.site_id, r.note, l.qty_delta, l.unit_cost, l.unit_sale, l.stock_after
    from public.stock_movements r join public.stock_movement_lines l on l.movement_id = r.id
    where r.reverses_id = (select movement_id from t_void)$$,
  $$values ('reversal'::text, (select movement_id from t_void), tests_0070d.uid(5), tests_0070d.shid(1), tests_0070d.siteid(1), 'Se cargó dos veces'::text, 1, 200.00::numeric, 300.00::numeric, 3)$$,
  'el contramovimiento está enlazado, hereda persona, turno y sede, y usa el costo y la venta del original'
);
select results_eq(
  $$select voided_by, voided_at is not null from public.stock_movements where id = (select movement_id from t_void)$$,
  $$values (tests_0070d.uid(2), true)$$,
  'el original queda marcado como anulado por quien anuló'
);
select is(
  (select count(*)::integer from public.security_events where event_type = 'stock_movement_voided' and actor_id = tests_0070d.uid(2)),
  1,
  'la anulación queda en security_events'
);

select tests_0070d.as_user('test-db0070mov-admin@example.com');
select is(tests_0070d.err_hint($$select public.void_stock_movement((select movement_id from t_void), 'Otra vez')$$), 'MOVEMENT_ALREADY_VOIDED', 'anular dos veces: MOVEMENT_ALREADY_VOIDED');
select is(
  tests_0070d.err_hint($$select public.void_stock_movement((select r.id from public.stock_movements r where r.reverses_id = (select movement_id from t_void)), 'Anular la anulación')$$),
  'MOVEMENT_NOT_VOIDABLE',
  'una anulación no se anula: MOVEMENT_NOT_VOIDABLE'
);
select is(
  tests_0070d.err_hint($$select public.void_stock_movement((select m.id from public.stock_movements m where m.kind = 'adjustment' limit 1), 'Anular un ajuste')$$),
  'MOVEMENT_NOT_VOIDABLE',
  'un ajuste no se anula (se corrige con otro ajuste): MOVEMENT_NOT_VOIDABLE'
);

-- Anular un ingreso cuyo stock ya se usó.
select is(
  tests_0070d.err_hint($$select public.void_stock_movement((select m.id from public.stock_movements m join public.stock_movement_lines l on l.movement_id = m.id where m.kind = 'entry' and l.supply_id = tests_0070d.sid(4)), 'Error de carga')$$),
  'VOID_INSUFFICIENT_STOCK',
  'anular un ingreso cuyo stock ya se retiró: VOID_INSUFFICIENT_STOCK'
);

-- Anular una devolución que sí se puede revertir (la lavandina tiene stock de sobra).
select is(
  (select public.void_stock_movement(
     (select m.id from public.stock_movements m join public.stock_movement_lines l on l.movement_id = m.id
      where m.kind = 'return' and l.supply_id = tests_0070d.sid(1) limit 1),
     'Devolución duplicada') -> 'reversal' -> 'lines' -> 0 ->> 'qty_delta'),
  '-2',
  'anular una devolución resta lo que había entrado (-2 en el contramovimiento)'
);

-- ---------------------------------------------------------------------------------------------
-- 9. Inmutabilidad (IS-27)
-- ---------------------------------------------------------------------------------------------

set local role postgres;

select is(tests_0070d.err_hint($$update public.stock_movements set note = 'cambiada' where kind = 'entry'$$), 'MOVEMENT_IMMUTABLE', 'un movimiento no se edita (ni siquiera como postgres)');
select is(tests_0070d.err_hint($$delete from public.stock_movements where kind = 'entry'$$), 'MOVEMENT_IMMUTABLE', 'un movimiento no se borra');
select is(tests_0070d.err_hint($$update public.stock_movement_lines set qty_delta = qty_delta + 1$$), 'MOVEMENT_IMMUTABLE', 'una línea no se edita');
select is(tests_0070d.err_hint($$delete from public.stock_movement_lines$$), 'MOVEMENT_IMMUTABLE', 'una línea no se borra');
select is(tests_0070d.err_hint($$update public.stock_movements set voided_at = null, voided_by = null, void_reason = null where voided_at is not null$$), 'MOVEMENT_IMMUTABLE', 'la marca de anulación no se saca');
select is(tests_0070d.err_hint($$update public.stock_movements set void_reason = 'otro motivo' where voided_at is not null$$), 'MOVEMENT_IMMUTABLE', 'el motivo de una anulación no se cambia');
select is(tests_0070d.err_hint($$update public.supply_price_changes set new_cost_price = 1$$), 'MOVEMENT_IMMUTABLE', 'el historial de precios no se edita');
select is(tests_0070d.err_hint($$delete from public.supply_price_changes$$), 'MOVEMENT_IMMUTABLE', 'el historial de precios no se borra');

-- ---------------------------------------------------------------------------------------------
-- 10. Vistas de administración: movimientos y consumo por cliente (IS-18, IS-24)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-admin-sin@example.com');

select results_eq(
  $$select person_name, client_name, site_name, shift_date, qty_delta, unit_cost, unit_sale, line_cost, line_sale
    from public.v_stock_movements_admin
    where kind = 'withdrawal' and supply_id = tests_0070d.sid(2) and voided_at is null$$,
  $$values ('Coordi Nadora'::text, 'Cliente Uno'::text, 'Sede Tres'::text, null::date, -2, 200.00::numeric, 300.00::numeric, -400.00::numeric, -600.00::numeric)$$,
  'v_stock_movements_admin (la ve un administrador sin la capacidad): persona, cliente, sede, precios y totales de la línea'
);
select is(
  (select count(*)::integer from public.v_stock_movements_admin where voided_at is not null and supply_id = tests_0070d.sid(2) and void_reason = 'Se cargó dos veces' and voided_by_name = 'Admin ConStock'),
  1,
  'el retiro anulado figura como anulado, con el motivo y quién anuló'
);
select is(
  (select count(*)::integer from public.v_stock_movements_admin where kind = 'reversal' and supply_id = tests_0070d.sid(2)),
  1,
  'el contramovimiento aparece como reversal'
);
select results_eq(
  $$select site_name, qty, cost_total, sale_total
    from public.v_supply_consumption_by_client
    where supply_id = tests_0070d.sid(2) and client_id = 'e2500003-0000-0000-0000-0000000000c1'$$,
  $$values ('Sede Tres'::text, 2, 400.00::numeric, 600.00::numeric)$$,
  'consumo por cliente: solo cuenta lo retirado y no anulado (2 u a costo 400 y a venta 600; el retiro anulado no suma)'
);
select is(
  (select day from public.v_supply_consumption_by_client where supply_id = tests_0070d.sid(2) and client_id = 'e2500003-0000-0000-0000-0000000000c1'),
  app.today(),
  'el día del consumo es la fecha de Argentina del retiro'
);

-- ---------------------------------------------------------------------------------------------
-- 11. Sin la capacidad no se mueve stock (IS-21)
-- ---------------------------------------------------------------------------------------------

select tests_0070d.as_user('test-db0070mov-admin-sin@example.com');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1)))$$), 'FORBIDDEN', 'sin manage_stock: no registra ingresos');
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(1), 1, 'count')$$), 'FORBIDDEN', 'sin manage_stock: no ajusta');
select is(tests_0070d.err_hint($$select public.set_supply_prices(tests_0070d.sid(1), 1, 1)$$), 'FORBIDDEN', 'sin manage_stock: no cambia precios');
select tests_0070d.as_user('test-db0070mov-emp-a@example.com');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1)))$$), 'FORBIDDEN', 'un empleado no registra ingresos');
select is(tests_0070d.err_hint($$select public.adjust_stock(tests_0070d.sid(1), 1, 'count')$$), 'FORBIDDEN', 'un empleado no ajusta');
select tests_0070d.as_user('test-db0070mov-coord@example.com');
select is(tests_0070d.err_hint($$select public.register_stock_entry(jsonb_build_array(tests_0070d.l(1, 1)))$$), 'FORBIDDEN', 'un coordinador no registra ingresos');

select * from finish();

rollback;
