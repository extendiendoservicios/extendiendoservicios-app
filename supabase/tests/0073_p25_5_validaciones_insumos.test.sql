-- pgTAP de la migración 0073_p25_5_validaciones_insumos.sql (P25.5d, módulo E; IS-36 e IS-37).
--   DEF-P25-01: un valor fuera de rango o mal formado da un P0001 con hint y mensaje en español,
--   no el error crudo del motor. DEF-P25-02: tope de largo de los textos libres. IS-36: el control
--   solo acepta fechas desde 30 días atrás hasta ahora (con 5 minutos de tolerancia).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e25d0000-...'. No depende del seed ni del orden de ejecución. Los instantes
-- se arman con now(), que dentro de la transacción es fijo, así los bordes de la ventana de
-- fechas del control son exactos.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0073;
grant usage on schema tests_0073 to authenticated, anon;

create or replace function tests_0073.as_user(p_email text)
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
    raise exception 'tests_0073.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0073.as_user(text) to authenticated, anon;

-- Devuelve 'SQLSTATE|hint|mensaje' del error, o 'OK' si la sentencia anduvo.
create or replace function tests_0073.err_all(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || '|' || coalesce(v_hint, '') || '|' || sqlerrm;
end;
$$;

grant execute on function tests_0073.err_all(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e25d0000-...)
--   usuarios: 01 dueño, 05 empleada con un turno hoy en la sede a1
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e25d0000-0000-0000-0000-000000000001', 'test-db0073-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Validaciones')),
  ('e25d0000-0000-0000-0000-000000000005', 'test-db0073-emp@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada'));

insert into public.user_roles (profile_id, role) values
  ('e25d0000-0000-0000-0000-000000000001', 'owner'),
  ('e25d0000-0000-0000-0000-000000000005', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('e25d0000-0000-0000-0000-000000000005', '92500905', 'active');

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('e25d0000-0000-0000-0000-0000000000c1', 'Cliente Validaciones SA', 'Cliente V', 'active', 0);

insert into public.sites (id, client_id, name, address, status) values
  ('e25d0000-0000-0000-0000-0000000000a1', 'e25d0000-0000-0000-0000-0000000000c1', 'Sede V', 'Calle 1', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e25d0000-0000-0000-0000-000000000b01', 'e25d0000-0000-0000-0000-0000000000c1', 'e25d0000-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled');

insert into public.assignments (shift_id, employee_id) values
  ('e25d0000-0000-0000-0000-000000000b01', 'e25d0000-0000-0000-0000-000000000005');

insert into public.supply_categories (id, name, sort_order) values
  ('e25d0000-0000-0000-0000-0000000000d1', 'Test V categoría uno', 10);

insert into public.supplies (id, code, name, presentation, category_id, cost_price, sale_price) values
  ('e25d0000-0000-0000-0000-0000000000e1', 'TV-001', 'Test V lavandina', '1 L', 'e25d0000-0000-0000-0000-0000000000d1', 100.00, 150.00),
  ('e25d0000-0000-0000-0000-0000000000e2', 'TV-002', 'Test V detergente', '5 L', 'e25d0000-0000-0000-0000-0000000000d1', 200.00, 300.00);

create function tests_0073.sid(n integer) returns uuid language sql immutable as $$ select ('e25d0000-0000-0000-0000-0000000000e' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0073.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0073.sid(p_n), 'qty', p_qty) $$;
create function tests_0073.lc(p_n integer, p_qty numeric, p_cost numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0073.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost) $$;
-- Líneas de un control: [{supply_id, counted_qty}].
create function tests_0073.cl(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('supply_id', tests_0073.sid(p_n), 'counted_qty', p_qty)) $$;
create function tests_0073.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0073.sid(p_n) $$;

create temporary table t_entry (r jsonb) on commit drop;
create temporary table t_before (s integer) on commit drop;
grant all on t_entry, t_before to authenticated;

grant execute on all functions in schema tests_0073 to authenticated, anon;

select plan(63);

-- ---------------------------------------------------------------------------------------------
-- 1. Estructura: tipos nuevos de los parámetros y auxiliar
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'upsert_supply', array['text', 'text', 'uuid', 'text', 'integer', 'numeric', 'numeric', 'text', 'text', 'uuid'], 'upsert_supply conserva su firma original');
select has_function('public', 'upsert_supply_category', array['text', 'integer', 'boolean', 'uuid'], 'upsert_supply_category conserva su firma original');
select has_function('public', 'register_stock_entry', array['jsonb', 'text', 'text', 'text', 'stock_movement_kind'], 'register_stock_entry conserva su firma original');
select has_function('public', 'adjust_stock', array['uuid', 'integer', 'stock_adjustment_reason', 'text'], 'adjust_stock conserva su firma original');
select has_function('public', 'register_stock_count', array['timestamp with time zone', 'jsonb', 'uuid', 'text', 'text'], 'register_stock_count conserva su firma original');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('upsert_supply', 'upsert_supply_category', 'register_stock_entry', 'adjust_stock', 'register_stock_count')),
  5, 'no quedaron sobrecargas viejas de las cinco RPC'
);
select is(
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('upsert_supply', 'upsert_supply_category', 'register_stock_entry', 'adjust_stock', 'register_stock_count')),
  true, 'las cinco RPC recreadas las ejecuta authenticated y no anon'
);
select is(
  has_function_privilege('authenticated', 'app.check_text_max(text, integer, text)', 'execute'),
  false, 'app.check_text_max no se expone a authenticated'
);

-- ---------------------------------------------------------------------------------------------
-- 2. Catálogo (DEF-P25-01 y DEF-P25-02)
-- ---------------------------------------------------------------------------------------------

select tests_0073.as_user('test-db0073-owner@example.com');

select is(tests_0073.err_all($$select public.upsert_supply('TV-N1', 'Test V n1', 'e25d0000-0000-0000-0000-0000000000d1', p_cost_price => 1e12)$$),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'upsert_supply: costo de 1e12');
select is(tests_0073.err_all($$select public.upsert_supply('TV-N1', 'Test V n1', 'e25d0000-0000-0000-0000-0000000000d1', p_sale_price => 10000000000)$$),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'upsert_supply: venta de 10.000.000.000 (un peso sobre el tope)');
select is(tests_0073.err_all($$select public.upsert_supply('TV-N1', 'Test V n1', 'e25d0000-0000-0000-0000-0000000000d1', p_cost_price => 'NaN'::numeric)$$),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'upsert_supply: costo NaN');
select is(tests_0073.err_all($$select public.upsert_supply('TV-N1', 'Test V n1', 'e25d0000-0000-0000-0000-0000000000d1', p_min_qty => 1000001)$$),
  'P0001|INVALID_MIN_QTY|El stock mínimo tiene que ser un entero entre 0 y 1.000.000.', 'upsert_supply: mínimo un paso sobre el tope');
select is(tests_0073.err_all($$select public.upsert_supply('TV-N1', 'Test V n1', 'e25d0000-0000-0000-0000-0000000000d1', p_min_qty => 1000000, p_cost_price => 9999999999.99, p_sale_price => 9999999999.99)$$),
  'OK', 'upsert_supply: los topes exactos (mínimo 1.000.000 y precios 9.999.999.999,99) se aceptan');
select is(tests_0073.err_all(format($$select public.upsert_supply(%L, 'Test V n2', 'e25d0000-0000-0000-0000-0000000000d1')$$, repeat('x', 41))),
  'P0001|TEXT_TOO_LONG|Código: hasta 40 caracteres.', 'upsert_supply: código de 41 caracteres');
select is(tests_0073.err_all(format($$select public.upsert_supply(%L, 'Test V n2', 'e25d0000-0000-0000-0000-0000000000d1')$$, repeat('x', 40))),
  'OK', 'upsert_supply: código de 40 caracteres');
select is(tests_0073.err_all(format($$select public.upsert_supply('TV-N3', %L, 'e25d0000-0000-0000-0000-0000000000d1')$$, repeat('x', 121))),
  'P0001|TEXT_TOO_LONG|Nombre del artículo: hasta 120 caracteres.', 'upsert_supply: nombre de 121 caracteres');
select is(tests_0073.err_all(format($$select public.upsert_supply('TV-N3', 'Test V n3', 'e25d0000-0000-0000-0000-0000000000d1', p_presentation => %L)$$, repeat('x', 81))),
  'P0001|TEXT_TOO_LONG|Presentación: hasta 80 caracteres.', 'upsert_supply: presentación de 81 caracteres');
select is(tests_0073.err_all(format($$select public.upsert_supply('TV-N3', 'Test V n3', 'e25d0000-0000-0000-0000-0000000000d1', p_notes => %L)$$, repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Notas del artículo: hasta 500 caracteres.', 'upsert_supply: notas de 501 caracteres');
select is(tests_0073.err_all(format($$select public.upsert_supply('TV-N3', %L, 'e25d0000-0000-0000-0000-0000000000d1')$$, repeat(' ', 300) || 'Test V n3' || repeat(' ', 300))),
  'OK', 'upsert_supply: el largo se mide sin los espacios de los extremos');

select is(tests_0073.err_all(format($$select public.set_supply_prices(%L, 10000000000, 1)$$, tests_0073.sid(1))),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'set_supply_prices: costo sobre el tope');
select is(tests_0073.err_all(format($$select public.set_supply_prices(%L, 1, 1e30)$$, tests_0073.sid(1))),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'set_supply_prices: venta de 1e30');
select is(tests_0073.err_all(format($$select public.set_supply_prices(%L, 9999999999.99, 9999999999.99)$$, tests_0073.sid(1))),
  'OK', 'set_supply_prices: los topes exactos se aceptan');

select is(tests_0073.err_all(format($$select public.upsert_supply_category(%L)$$, repeat('x', 61))),
  'P0001|TEXT_TOO_LONG|Nombre de la categoría: hasta 60 caracteres.', 'upsert_supply_category: nombre de 61 caracteres');
select is(tests_0073.err_all($$select public.upsert_supply_category('Test V cat n1', 1000001)$$),
  'P0001|INVALID_SORT_ORDER|El orden de la categoría tiene que ser un entero entre -1.000.000 y 1.000.000.', 'upsert_supply_category: orden un paso sobre el tope');
select is(tests_0073.err_all($$select public.upsert_supply_category('Test V cat n1', -1000000)$$),
  'OK', 'upsert_supply_category: orden en el borde (-1.000.000)');

-- ---------------------------------------------------------------------------------------------
-- 3. Movimientos
-- ---------------------------------------------------------------------------------------------

select is(tests_0073.err_all($$select public.register_stock_entry(jsonb_build_array(tests_0073.lc(1, 1, 1e15)))$$),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'ingreso: costo unitario de 1e15');
select is(tests_0073.err_all($$select public.register_stock_entry(jsonb_build_array(tests_0073.lc(1, 1, 10000000000)))$$),
  'P0001|INVALID_PRICE|Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', 'ingreso: costo unitario sobre el tope');
select is(tests_0073.err_all(format($$select public.register_stock_entry(jsonb_build_array(tests_0073.l(1, 1)), p_supplier => %L)$$, repeat('x', 121))),
  'P0001|TEXT_TOO_LONG|Proveedor: hasta 120 caracteres.', 'ingreso: proveedor de 121 caracteres');
select is(tests_0073.err_all(format($$select public.register_stock_entry(jsonb_build_array(tests_0073.l(1, 1)), p_document_number => %L)$$, repeat('x', 61))),
  'P0001|TEXT_TOO_LONG|Comprobante: hasta 60 caracteres.', 'ingreso: comprobante de 61 caracteres');
select is(tests_0073.err_all(format($$select public.register_stock_entry(jsonb_build_array(tests_0073.l(1, 1)), p_note => %L)$$, repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Nota: hasta 500 caracteres.', 'ingreso: nota de 501 caracteres');
select is(tests_0073.stock(1), 0, 'ningún ingreso rechazado tocó el stock');
select is(tests_0073.err_all(format($$select public.register_stock_entry(jsonb_build_array(tests_0073.l(1, 5)), p_supplier => %L, p_document_number => %L, p_note => %L)$$, repeat('x', 120), repeat('y', 60), repeat('z', 500))),
  'OK', 'ingreso: los topes exactos de proveedor, comprobante y nota se aceptan');

select is(tests_0073.err_all(format($$select public.adjust_stock(%L, 1000001, 'count')$$, tests_0073.sid(1))),
  'P0001|INVALID_QTY|La cantidad del ajuste tiene que ser un entero distinto de cero, de hasta 1.000.000 en valor absoluto.', 'ajuste: delta un paso sobre el tope');
select is(tests_0073.err_all(format($$select public.adjust_stock(%L, 1, null)$$, tests_0073.sid(1))),
  'P0001|REASON_REQUIRED|Elegí el motivo del ajuste.', 'ajuste: sin motivo');
select is(tests_0073.err_all(format($$select public.adjust_stock(%L, 1, 'other', %L)$$, tests_0073.sid(1), repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Nota: hasta 500 caracteres.', 'ajuste: nota de 501 caracteres');
select is(tests_0073.err_all(format($$select public.adjust_stock(%L, 1, 'breakage')$$, tests_0073.sid(1))),
  'OK', 'ajuste: un motivo válido sigue andando');

-- Stock resultante: pasa de lo que admite integer.
select tests_0073.as_user('test-db0073-owner@example.com');
set local role postgres;
update public.supplies set stock_qty = 2147483000 where id = tests_0073.sid(2);
select tests_0073.as_user('test-db0073-owner@example.com');
select is(tests_0073.err_all($$select public.register_stock_entry(jsonb_build_array(tests_0073.l(2, 1000)))$$),
  'P0001|STOCK_LIMIT|El stock de Test V detergente 5 L no puede superar las 2.147.483.647 unidades.', 'ingreso que pasa de 2.147.483.647 unidades: STOCK_LIMIT');
select is(tests_0073.stock(2), 2147483000, 'el ingreso rechazado no tocó el stock');

-- Anulación con motivo largo.
insert into t_entry select public.register_stock_entry(jsonb_build_array(tests_0073.l(1, 1)));
select is(tests_0073.err_all(format($$select public.void_stock_movement(%L, %L)$$, (select r -> 'movement' ->> 'id' from t_entry), repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Motivo de la anulación: hasta 500 caracteres.', 'anulación: motivo de 501 caracteres');

-- ---------------------------------------------------------------------------------------------
-- 4. Control de stock: fecha (IS-36) y topes
-- ---------------------------------------------------------------------------------------------

insert into t_before select tests_0073.stock(1);

select is(tests_0073.err_all($$select public.register_stock_count(null, tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNT_DATE_REQUIRED|Indicá la fecha y la hora del control.', 'control: fecha nula');
select is(tests_0073.err_all($$select public.register_stock_count('1900-01-01T00:00:00-03:00', tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNTED_AT_OUT_OF_RANGE|El control no puede ser de hace más de 30 días. Elegí una fecha más reciente.', 'control: año 1900');
select is(tests_0073.err_all($$select public.register_stock_count('-infinity', tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNTED_AT_OUT_OF_RANGE|El control no puede ser de hace más de 30 días. Elegí una fecha más reciente.', 'control: -infinity');
select is(tests_0073.err_all($$select public.register_stock_count(((now() - interval '30 days') - interval '6 minutes'), tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNTED_AT_OUT_OF_RANGE|El control no puede ser de hace más de 30 días. Elegí una fecha más reciente.', 'control: 30 días y 6 minutos atrás (fuera de la tolerancia)');
select is(tests_0073.err_all($$select public.register_stock_count((now() + interval '10 minutes'), tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNT_IN_FUTURE|La fecha y la hora del control no pueden ser futuras.', 'control: 10 minutos en el futuro');
select is(tests_0073.err_all($$select public.register_stock_count('infinity', tests_0073.cl(1, 3), null, 'Revisora')$$),
  'P0001|COUNT_IN_FUTURE|La fecha y la hora del control no pueden ser futuras.', 'control: infinity');
select is(tests_0073.stock(1), (select s from t_before), 'ningún control rechazado tocó el stock');
select is((select count(*)::integer from public.stock_counts where reviewer_name = 'Revisora'), 0, 'ningún control rechazado quedó guardado');

select is(tests_0073.err_all($$select public.register_stock_count(((now() - interval '30 days') - interval '3 minutes'), tests_0073.cl(1, 3), null, 'Revisora')$$),
  'OK', 'control: 30 días y 3 minutos atrás (dentro de la tolerancia)');
select is(tests_0073.err_all($$select public.register_stock_count((now() + interval '2 minutes'), tests_0073.cl(1, 5), null, 'Revisora')$$),
  'OK', 'control: 2 minutos en el futuro (tolerancia del reloj del cliente)');
select is(tests_0073.err_all($$select public.register_stock_count(to_char((now() - interval '29 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')::timestamptz, tests_0073.cl(1, 5), null, 'Revisora')$$),
  'OK', 'control: ISO 8601 con Z de hace 29 días');
select is(tests_0073.err_all($$select public.register_stock_count((to_char((now() - interval '1 hour') at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00')::timestamptz, tests_0073.cl(1, 5), null, 'Revisora')$$),
  'OK', 'control: ISO 8601 con -03:00');
select is((select count(*)::integer from public.stock_counts where reviewer_name = 'Revisora'), 4, 'los cuatro controles aceptados quedaron guardados');

select is(tests_0073.err_all(format($$select public.register_stock_count((now() - interval '1 hour'), tests_0073.cl(1, 3), null, %L)$$, repeat('x', 121))),
  'P0001|TEXT_TOO_LONG|Nombre de quien revisó: hasta 120 caracteres.', 'control: nombre del revisor de 121 caracteres');
select is(tests_0073.err_all(format($$select public.register_stock_count((now() - interval '1 hour'), tests_0073.cl(1, 3), null, 'Revisora', %L)$$, repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Observaciones del control: hasta 500 caracteres.', 'control: observaciones de 501 caracteres');
select is(tests_0073.err_all($$select public.register_stock_count((now() - interval '1 hour'), tests_0073.cl(1, 1000001), null, 'Revisora')$$),
  'P0001|INVALID_QTY|Las cantidades contadas tienen que ser enteros entre 0 y 1.000.000.', 'control: cantidad contada sobre el tope');

-- ---------------------------------------------------------------------------------------------
-- 5. Retiros y faltantes (como empleada)
-- ---------------------------------------------------------------------------------------------

select tests_0073.as_user('test-db0073-emp@example.com');

select is(tests_0073.err_all(format($$select public.register_withdrawal(jsonb_build_array(tests_0073.l(1, 1)), p_shift_id => 'e25d0000-0000-0000-0000-000000000b01', p_note => %L)$$, repeat('x', 501))),
  'P0001|TEXT_TOO_LONG|Observación: hasta 500 caracteres.', 'retiro: observación de 501 caracteres');
select is(tests_0073.err_all(format($$select public.register_withdrawal(jsonb_build_array(tests_0073.l(1, 1)), p_shift_id => 'e25d0000-0000-0000-0000-000000000b01', p_note => %L)$$, repeat('x', 500))),
  'OK', 'retiro: observación de 500 caracteres');

select is(tests_0073.err_all(format($$select public.report_supply_shortage(p_description => %L)$$, repeat('d', 201))),
  'P0001|TEXT_TOO_LONG|Descripción: hasta 200 caracteres.', 'faltante: descripción de 201 caracteres');
select is(tests_0073.err_all(format($$select public.report_supply_shortage(p_description => %L)$$, repeat('d', 200))),
  'OK', 'faltante: descripción de 200 caracteres');
select is(tests_0073.err_all(format($$select public.report_supply_shortage(p_description => 'Corta', p_comment => %L)$$, repeat('c', 501))),
  'P0001|TEXT_TOO_LONG|Comentario: hasta 500 caracteres.', 'faltante: comentario de 501 caracteres');
select is(tests_0073.err_all(format($$select public.report_supply_shortage(p_supply_id => %L, p_comment => %L)$$, tests_0073.sid(1), repeat('c', 500))),
  'OK', 'faltante: comentario de 500 caracteres');

select tests_0073.as_user('test-db0073-owner@example.com');
select is(tests_0073.err_all(format($$select public.resolve_supply_shortage(%L, %L)$$,
    (select id from public.supply_shortage_reports where description = repeat('d', 200)), repeat('n', 501))),
  'P0001|TEXT_TOO_LONG|Nota de resolución: hasta 500 caracteres.', 'resolver faltante: nota de 501 caracteres');
select is(tests_0073.err_all(format($$select public.resolve_supply_shortage(%L, %L)$$,
    (select id from public.supply_shortage_reports where description = repeat('d', 200)), repeat('n', 500))),
  'OK', 'resolver faltante: nota de 500 caracteres');

select * from finish();

rollback;
