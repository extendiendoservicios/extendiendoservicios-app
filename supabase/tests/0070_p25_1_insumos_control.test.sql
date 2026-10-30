-- pgTAP de la migración 0070_p25_1_insumos_y_stock.sql (P25.1, módulo E), cuarta parte: control de stock.
--   register_stock_count (IS-16, IS-31): la diferencia se calcula contra el stock a la hora del
--   control, un solo movimiento «count» con las diferencias, filas en blanco intactas, revisor
--   (persona o nombre), validaciones, permisos e inmutabilidad.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'e2500001-...'. Los usuarios, turnos, clientes y artículos de la prueba los crea
-- este mismo archivo; no depende del seed ni del orden de ejecución. Los turnos usan fechas
-- relativas a app.today() (no hay instantes armados con «ahora ± horas» salvo donde el caso lo pide:
-- el control a una hora pasada, que se mide contra now() y no contra el reloj del día).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0070b;
grant usage on schema tests_0070b to authenticated, anon;

create or replace function tests_0070b.as_user(p_email text)
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
    raise exception 'tests_0070b.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0070b.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0070b.err_hint(p_sql text)
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

grant execute on function tests_0070b.err_hint(text) to authenticated, anon;

-- Devuelve el mensaje del error; null si anduvo.
create or replace function tests_0070b.err_msg(p_sql text)
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

grant execute on function tests_0070b.err_msg(text) to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Fixtures (prefijo e2500001-...). Todo lo que depende de «hoy» usa app.today() (fechas de los
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
  ('e2500001-0000-0000-0000-000000000001', 'test-db0070ctl-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Insumos')),
  ('e2500001-0000-0000-0000-000000000002', 'test-db0070ctl-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConStock')),
  ('e2500001-0000-0000-0000-000000000003', 'test-db0070ctl-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinStock')),
  ('e2500001-0000-0000-0000-000000000004', 'test-db0070ctl-coord@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('e2500001-0000-0000-0000-000000000005', 'test-db0070ctl-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Empleada')),
  ('e2500001-0000-0000-0000-000000000006', 'test-db0070ctl-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('e2500001-0000-0000-0000-000000000001', 'owner'),
  ('e2500001-0000-0000-0000-000000000002', 'admin'),
  ('e2500001-0000-0000-0000-000000000003', 'admin'),
  ('e2500001-0000-0000-0000-000000000004', 'supervisor'),
  ('e2500001-0000-0000-0000-000000000005', 'employee'),
  ('e2500001-0000-0000-0000-000000000006', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500001-0000-0000-0000-000000000002', 'manage_stock', true),
  ('e2500001-0000-0000-0000-000000000003', 'manage_users', true),
  ('e2500001-0000-0000-0000-000000000003', 'manage_stock', false);

insert into public.employees (profile_id, dni, status) values
  ('e2500001-0000-0000-0000-000000000004', '92501004', 'active'),
  ('e2500001-0000-0000-0000-000000000005', '92501005', 'active'),
  ('e2500001-0000-0000-0000-000000000006', '92501006', 'active');

insert into public.clients (id, legal_name, trade_name, status) values
  ('e2500001-0000-0000-0000-0000000000c1', 'Cliente Insumos Uno SA', 'Cliente Uno', 'active'),
  ('e2500001-0000-0000-0000-0000000000c2', 'Cliente Insumos Dos SA', null, 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500001-0000-0000-0000-0000000000a1', 'e2500001-0000-0000-0000-0000000000c1', 'Sede Uno', 'Calle 1', 'active'),
  ('e2500001-0000-0000-0000-0000000000a2', 'e2500001-0000-0000-0000-0000000000c2', 'Sede Dos', 'Calle 2', 'active'),
  ('e2500001-0000-0000-0000-0000000000a3', 'e2500001-0000-0000-0000-0000000000c1', 'Sede Tres', 'Calle 3', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500001-0000-0000-0000-000000000b01', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500001-0000-0000-0000-000000000b02', 'e2500001-0000-0000-0000-0000000000c2', 'e2500001-0000-0000-0000-0000000000a2', app.today(), '08:00', '12:00', 1, 'scheduled'),
  ('e2500001-0000-0000-0000-000000000b03', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('e2500001-0000-0000-0000-000000000b04', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today() + 5, '08:00', '12:00', 1, 'scheduled'),
  ('e2500001-0000-0000-0000-000000000b05', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today() + 10, '08:00', '12:00', 1, 'scheduled'),
  ('e2500001-0000-0000-0000-000000000b06', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today() - 2, '08:00', '12:00', 1, 'completed');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2500001-0000-0000-0000-000000000b07', 'e2500001-0000-0000-0000-0000000000c1', 'e2500001-0000-0000-0000-0000000000a1', app.today() + 1, '14:00', '18:00', 1, 'cancelled', now(), 'e2500001-0000-0000-0000-000000000001', 'Cancelado para la prueba');

insert into public.assignments (shift_id, employee_id) values
  ('e2500001-0000-0000-0000-000000000b01', 'e2500001-0000-0000-0000-000000000005'),
  ('e2500001-0000-0000-0000-000000000b02', 'e2500001-0000-0000-0000-000000000006'),
  ('e2500001-0000-0000-0000-000000000b03', 'e2500001-0000-0000-0000-000000000005'),
  ('e2500001-0000-0000-0000-000000000b04', 'e2500001-0000-0000-0000-000000000005'),
  ('e2500001-0000-0000-0000-000000000b05', 'e2500001-0000-0000-0000-000000000005'),
  ('e2500001-0000-0000-0000-000000000b06', 'e2500001-0000-0000-0000-000000000005'),
  ('e2500001-0000-0000-0000-000000000b07', 'e2500001-0000-0000-0000-000000000005');

insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('e2500001-0000-0000-0000-000000000004', 'e2500001-0000-0000-0000-0000000000a2', 'e2500001-0000-0000-0000-000000000001');

insert into public.supply_categories (id, name, sort_order) values
  ('e2500001-0000-0000-0000-0000000000d1', 'Test Ectl categoría uno', 10),
  ('e2500001-0000-0000-0000-0000000000d2', 'Test Ectl categoría dos', 20);

-- Artículos de la prueba: arrancan en cero; el stock entra por registrar ingresos (RPC).
insert into public.supplies (id, code, name, presentation, category_id, min_qty, cost_price, sale_price) values
  ('e2500001-0000-0000-0000-0000000000e1', 'TC-001', 'Test lavandina', '1 L', 'e2500001-0000-0000-0000-0000000000d1', 5, 100.00, 150.00),
  ('e2500001-0000-0000-0000-0000000000e2', 'TC-002', 'Test detergente', '5 L', 'e2500001-0000-0000-0000-0000000000d1', null, 200.00, 300.00),
  ('e2500001-0000-0000-0000-0000000000e3', 'TC-003', 'Test bolsas', 'paquete x 10', 'e2500001-0000-0000-0000-0000000000d2', 2, 50.50, 80.00);

-- Atajos de las fixtures: artículo n, turno n, sede n y usuario n.
create function tests_0070b.sid(n integer) returns uuid language sql immutable as $$ select ('e2500001-0000-0000-0000-0000000000e' || n)::uuid $$;
create function tests_0070b.shid(n integer) returns uuid language sql immutable as $$ select ('e2500001-0000-0000-0000-000000000b0' || n)::uuid $$;
create function tests_0070b.siteid(n integer) returns uuid language sql immutable as $$ select ('e2500001-0000-0000-0000-0000000000a' || n)::uuid $$;
create function tests_0070b.uid(n integer) returns uuid language sql immutable as $$ select ('e2500001-0000-0000-0000-00000000000' || n)::uuid $$;
-- Línea {supply_id, qty} y línea de ingreso con costo.
create function tests_0070b.l(p_n integer, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070b.sid(p_n), 'qty', p_qty) $$;
create function tests_0070b.lc(p_n integer, p_qty numeric, p_cost numeric, p_update boolean) returns jsonb language sql immutable as $$
  select jsonb_build_object('supply_id', tests_0070b.sid(p_n), 'qty', p_qty, 'unit_cost', p_cost, 'update_cost', p_update) $$;
create function tests_0070b.stock(p_n integer) returns integer language sql stable security definer as $$
  select stock_qty from public.supplies where id = tests_0070b.sid(p_n) $$;

grant execute on all functions in schema tests_0070b to authenticated, anon;

select plan(50);

-- Historia preparada con hora explícita (solo el seed y los tests pueden pasar la hora al núcleo;
-- las RPC siempre usan now()). Instantes relativos a now(), que dentro de la transacción es fijo:
--   hace 3 h: ingresos (lavandina 10, detergente 6, bolsas 4, escasez 5)
--   hace 2 h: retiro de 2 lavandinas
--   hace 1 h: HORA DEL CONTROL
--   hace 30 min: retiro de 3 lavandinas y retiro de 5 unidades de escasez (todas)
set local role postgres;

create temporary table t_count_result (r jsonb) on commit drop;
create temporary table t_count_result2 (r jsonb) on commit drop;
grant all on t_count_result, t_count_result2 to authenticated;

insert into public.supplies (id, code, name, presentation, category_id, cost_price, sale_price) values
  (tests_0070b.sid(5), 'TC-005', 'Test escasez total', '1 u', 'e2500001-0000-0000-0000-0000000000d1', 10.00, 15.00);

select app.stock_post_movement('entry', tests_0070b.uid(2),
  jsonb_build_array(
    jsonb_build_object('supply_id', tests_0070b.sid(1), 'qty_delta', 10),
    jsonb_build_object('supply_id', tests_0070b.sid(2), 'qty_delta', 6),
    jsonb_build_object('supply_id', tests_0070b.sid(3), 'qty_delta', 4),
    jsonb_build_object('supply_id', tests_0070b.sid(5), 'qty_delta', 5)),
  'normal', now() - interval '3 hours');

select app.stock_post_movement('withdrawal', tests_0070b.uid(2),
  jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'qty_delta', -2)),
  'normal', now() - interval '2 hours',
  p_person_id => tests_0070b.uid(5), p_shift_id => tests_0070b.shid(1), p_site_id => tests_0070b.siteid(1));

select app.stock_post_movement('withdrawal', tests_0070b.uid(2),
  jsonb_build_array(
    jsonb_build_object('supply_id', tests_0070b.sid(1), 'qty_delta', -3),
    jsonb_build_object('supply_id', tests_0070b.sid(5), 'qty_delta', -5)),
  'normal', now() - interval '30 minutes',
  p_person_id => tests_0070b.uid(5), p_shift_id => tests_0070b.shid(1), p_site_id => tests_0070b.siteid(1));

select is(tests_0070b.stock(1), 5, 'preparación: lavandina en 5 (10 - 2 - 3)');
select is(app.supply_stock_at(tests_0070b.sid(1), now() - interval '1 hour'), 8, 'el stock a la hora del control era 8 (sin el retiro posterior)');
select is(app.supply_stock_at(tests_0070b.sid(1), now() - interval '4 hours'), 0, 'antes del primer ingreso el stock era 0');
select is(app.supply_stock_at(tests_0070b.sid(1), now()), 5, 'a la hora actual es el stock actual');

-- ---------------------------------------------------------------------------------------------
-- 1. Permisos y validaciones
-- ---------------------------------------------------------------------------------------------

select tests_0070b.as_user('test-db0070ctl-admin-sin@example.com');
select is(
  tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, 'Revisora')$$),
  'FORBIDDEN', 'el administrador sin manage_stock no carga controles (IS-21)');
select tests_0070b.as_user('test-db0070ctl-emp-a@example.com');
select is(
  tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, 'Revisora')$$),
  'FORBIDDEN', 'un empleado no carga controles (IS-17)');
select tests_0070b.as_user('test-db0070ctl-coord@example.com');
select is(
  tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, 'Revisora')$$),
  'FORBIDDEN', 'un coordinador no carga controles (IS-17)');

select tests_0070b.as_user('test-db0070ctl-admin@example.com');

select is(tests_0070b.err_hint($$select public.register_stock_count(null, jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, 'R')$$), 'COUNT_DATE_REQUIRED', 'sin fecha y hora: COUNT_DATE_REQUIRED');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() + interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, 'R')$$), 'COUNT_IN_FUTURE', 'una hora futura: COUNT_IN_FUTURE');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)))$$), 'REVIEWER_REQUIRED', 'sin revisor: REVIEWER_REQUIRED');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), tests_0070b.uid(2), 'Revisora')$$), 'REVIEWER_REQUIRED', 'una persona y un nombre a la vez: REVIEWER_REQUIRED');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), null, '   ')$$), 'REVIEWER_REQUIRED', 'un nombre en blanco no cuenta como revisor');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7)), gen_random_uuid())$$), 'REVIEWER_NOT_FOUND', 'un revisor que no existe: REVIEWER_NOT_FOUND');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', '[]'::jsonb, null, 'R')$$), 'INVALID_LINES', 'sin líneas: INVALID_LINES');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', -1)), null, 'R')$$), 'INVALID_QTY', 'cantidad contada negativa: INVALID_QTY');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 2.5)), null, 'R')$$), 'INVALID_QTY', 'cantidad contada con decimales: INVALID_QTY');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 1), jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 2)), null, 'R')$$), 'DUPLICATE_SUPPLY', 'un artículo repetido: DUPLICATE_SUPPLY');
select is(tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', gen_random_uuid(), 'counted_qty', 1)), null, 'R')$$), 'SUPPLY_NOT_FOUND', 'un artículo inexistente: SUPPLY_NOT_FOUND');

set local role postgres;
select is((select count(*)::integer from public.stock_counts where created_by = tests_0070b.uid(2)), 0, 'ningún control rechazado dejó filas');
select tests_0070b.as_user('test-db0070ctl-admin@example.com');

-- ---------------------------------------------------------------------------------------------
-- 2. La diferencia se calcula contra el stock a la hora del control (IS-31)
-- ---------------------------------------------------------------------------------------------

insert into t_count_result
select public.register_stock_count(
  now() - interval '1 hour',
  jsonb_build_array(
    jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 7),
    jsonb_build_object('supply_id', tests_0070b.sid(2), 'counted_qty', 6)),
  null, '  Revisora Externa ', 'Control de prueba');

select is((select r -> 'lines' -> 0 ->> 'system_qty' from t_count_result), '8', 'lavandina: el sistema decía 8 a la hora del control (no 5: el retiro posterior no cuenta)');
select is((select r -> 'lines' -> 0 ->> 'difference' from t_count_result), '-1', 'lavandina: contaron 7, la diferencia es -1 (y no -2 ni +2)');
select is((select r -> 'movement' ->> 'kind' from t_count_result), 'count', 'se genera un movimiento kind count');
select is(tests_0070b.stock(1), 4, 'el stock actual queda en lo contado menos lo retirado después: 7 - 3 = 4');
select is(tests_0070b.stock(2), 6, 'detergente: sin diferencia, el stock no cambia');
select is(tests_0070b.stock(3), 4, 'bolsas: no estaba en el control (fila en blanco), no se toca');

set local role postgres;

select results_eq(
  $$select article, system_qty, counted_qty, difference from (
      select l.supply_id as article, l.system_qty, l.counted_qty, l.difference
      from public.stock_count_lines l
      where l.count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)
    ) q order by article$$,
  $$values (tests_0070b.sid(1), 8, 7, -1), (tests_0070b.sid(2), 6, 6, 0)$$,
  'el control guarda una línea por artículo contado, también la que no tiene diferencia, y ninguna de las en blanco'
);
select results_eq(
  $$select l.supply_id, l.qty_delta, l.stock_after
    from public.stock_movements m join public.stock_movement_lines l on l.movement_id = m.id
    where m.kind = 'count' and m.count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)$$,
  $$values (tests_0070b.sid(1), -1, 4)$$,
  'un solo movimiento «count» con solo las diferencias distintas de cero'
);
select results_eq(
  $$select c.reviewer_id, c.reviewer_name, c.notes, c.created_by, c.counted_at <= now() - interval '1 hour'
    from public.stock_counts c where c.id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)$$,
  $$values (null::uuid, 'Revisora Externa'::text, 'Control de prueba'::text, tests_0070b.uid(2), true)$$,
  'el control guarda el revisor escrito (sin espacios de los extremos), las observaciones y quién lo cargó'
);
select is(
  (select m.recorded_at = now() from public.stock_movements m where m.kind = 'count' and m.count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)),
  true,
  'la hora del movimiento la pone el servidor (now()), no la hora indicada del control (ADR-009)'
);
select is(
  (select m.count_id is not null and m.note = 'Control de prueba' from public.stock_movements m where m.kind = 'count' and m.count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)),
  true,
  'el movimiento apunta al control y lleva las observaciones'
);

-- Segundo control a la misma hora, con un revisor de la app y sin diferencias: la historia sigue
-- dando 8 a esa hora aunque ya haya un ajuste posterior.
select tests_0070b.as_user('test-db0070ctl-admin@example.com');

insert into t_count_result2
select public.register_stock_count(
  now() - interval '1 hour',
  jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(1), 'counted_qty', 8)),
  tests_0070b.uid(4), null);

select is((select r -> 'lines' -> 0 ->> 'system_qty' from t_count_result2), '8', 'el stock a esa hora sigue siendo 8 aunque el primer control ya ajustó (el ajuste es posterior)');
select is((select jsonb_typeof(r -> 'movement') from t_count_result2), 'null', 'sin diferencias no hay movimiento (movement null)');
select is(tests_0070b.stock(1), 4, 'sin diferencias el stock no cambia');

set local role postgres;
select is(
  (select reviewer_id from public.stock_counts where id = (select (r -> 'count' ->> 'id')::uuid from t_count_result2)),
  tests_0070b.uid(4),
  'un control con una persona de la app como revisora'
);

-- Los movimientos posteriores dejarían el stock negativo: no se puede cargar.
select tests_0070b.as_user('test-db0070ctl-admin@example.com');
select is(tests_0070b.stock(5), 0, 'escasez total: stock actual 0 (se retiraron las 5 después de la hora del control)');
select is(
  tests_0070b.err_hint($$select public.register_stock_count(now() - interval '1 hour', jsonb_build_array(jsonb_build_object('supply_id', tests_0070b.sid(5), 'counted_qty', 0)), null, 'Revisora')$$),
  'COUNT_INCONSISTENT',
  'contar 0 cuando el sistema decía 5 y después se retiraron las 5 dejaría -5: COUNT_INCONSISTENT'
);
select is(tests_0070b.stock(5), 0, 'el control inconsistente no tocó el stock');

set local role postgres;
select is((select count(*)::integer from public.stock_counts where created_by = tests_0070b.uid(2)), 2, 'el control inconsistente no dejó ninguna fila (solo los dos buenos)');

-- ---------------------------------------------------------------------------------------------
-- 3. Lectura del historial de controles
-- ---------------------------------------------------------------------------------------------

select tests_0070b.as_user('test-db0070ctl-admin-sin@example.com');
select results_eq(
  $$select reviewer_name, lines_count, differences_count, movement_id is not null, created_by_name, jsonb_array_length(lines)
    from public.v_stock_counts_admin
    where count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result)$$,
  $$values ('Revisora Externa'::text, 2, 1, true, 'Admin ConStock'::text, 2)$$,
  'v_stock_counts_admin (la lee un administrador sin la capacidad): revisor, líneas, diferencias, movimiento y quién lo cargó'
);
select is(
  (select reviewer_name from public.v_stock_counts_admin where count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result2)),
  'Coordi Nadora',
  'el revisor persona de la app se muestra por su nombre'
);
select is(
  (select movement_id is null from public.v_stock_counts_admin where count_id = (select (r -> 'count' ->> 'id')::uuid from t_count_result2)),
  true,
  'un control sin diferencias no tiene movimiento'
);

select tests_0070b.as_user('test-db0070ctl-emp-a@example.com');
select is((select count(*)::integer from public.stock_counts), 0, 'un empleado no lee los controles');
select is((select count(*)::integer from public.stock_count_lines), 0, 'un empleado no lee las líneas de los controles');
select is((select count(*)::integer from public.v_stock_counts_admin), 0, 'un empleado no lee v_stock_counts_admin');

-- Inmutables.
set local role postgres;
select is(tests_0070b.err_hint($$update public.stock_counts set notes = 'cambiada'$$), 'MOVEMENT_IMMUTABLE', 'un control no se edita');
select is(tests_0070b.err_hint($$delete from public.stock_counts$$), 'MOVEMENT_IMMUTABLE', 'un control no se borra');
select is(tests_0070b.err_hint($$update public.stock_count_lines set counted_qty = 99$$), 'MOVEMENT_IMMUTABLE', 'una línea de control no se edita');
select is(tests_0070b.err_hint($$delete from public.stock_count_lines$$), 'MOVEMENT_IMMUTABLE', 'una línea de control no se borra');

-- Restricciones de la tabla.
select throws_ok(
  $$insert into public.stock_counts (counted_at, reviewer_id, reviewer_name, created_by) values (now(), null, null, 'e2500001-0000-0000-0000-000000000002')$$,
  '23514', null, 'un control sin revisor viola stock_counts_reviewer_check');
select throws_ok(
  $$insert into public.stock_counts (counted_at, reviewer_id, reviewer_name, created_by) values (now(), 'e2500001-0000-0000-0000-000000000002', 'Alguien', 'e2500001-0000-0000-0000-000000000002')$$,
  '23514', null, 'un control con persona y nombre viola stock_counts_reviewer_check');

select * from finish();

rollback;
