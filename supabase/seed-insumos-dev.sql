-- =================================================================================================
-- Datos de prueba del módulo de insumos y control de stock (módulo E, P25.1) -- SOLO App_dev.
--
--   pnpm db:seed:insumos   (supabase db query --linked -f supabase/seed-insumos-dev.sql)
--
-- Carga 4 categorías, 17 artículos de limpieza inventados (uno discontinuado), con presentaciones,
-- códigos internos, costos, precios de venta, mínimos y stock variado (algunos en cero = rojo,
-- algunos igual o bajo el mínimo = amarillo, algunos sin mínimo), con la historia que lo explica:
-- dos ingresos, retiros de empleados y de una coordinadora, uno cargado por la administración en
-- nombre de otra persona y después anulado, dos ajustes, un control de stock y dos avisos de
-- faltante (uno abierto y uno resuelto).
--
-- Es la ÚNICA fuente de estos datos: `supabase/seed.sql` ya no los carga y `pnpm db:seed:data` corre
-- este archivo a continuación del seed completo. Se puede correr solo, sobre una base que ya tiene
-- clientes, empleados y turnos cualesquiera (por ejemplo las cuentas e2e de App_dev): no trunca ni
-- borra nada fuera de las tablas de insumos, y de esas solo toca lo que él mismo creó.
--
--   * Qué toma de la base: la administración (owner o admin activo), una coordinadora (supervisor
--     activo), tres empleados activos, y turnos o sedes activos. Todo se elige de forma
--     determinista (por correo e id, prefiriendo las cuentas que no son e2e). No crea personas,
--     clientes, sedes ni turnos. Si no hay turno en la ventana, el retiro va a una sede activa y
--     la observación lo aclara.
--   * Qué es «suyo»: los artículos con los 17 códigos de abajo, los movimientos, controles,
--     precios y avisos que cuelgan de esos artículos (más el aviso de texto libre «Cepillo para
--     inodoro» con su comentario) y las categorías con los 4 nombres de abajo si quedaron sin
--     otros artículos. Las tablas de movimientos son inmutables (IS-27): para reemplazar su propia
--     historia el archivo apaga el trigger de inmutabilidad dentro de la transacción y lo vuelve a
--     prender antes de seguir.
--   * Idempotente: se borra lo propio y se vuelve a cargar, en una sola transacción.
--
-- Los movimientos pasan por el mismo núcleo que usan las RPC (app.stock_post_movement), con la
-- hora pasada (las RPC siempre usan now()): así el stock, el stock resultante de cada línea y los
-- precios de cada línea quedan coherentes. Las horas son relativas a «hoy» y nunca van al futuro.
-- Nada de esto va a producción.
-- =================================================================================================

begin;

-- =================================================================================================
-- 0. Salvaguarda de entorno.
--
-- Mismo criterio que supabase/seed.sql (cuentas de Auth que no son de desarrollo frenan todo),
-- ampliado para App_dev, que además tiene las cuentas e2e (dominio reservado example.com). Se
-- acepta la base si TODOS sus usuarios son de los 14 del seed ficticio o del dominio example.com.
-- Cualquier otro correo es gente de verdad (producción) y no se toca nada.
-- =================================================================================================

do $$
declare
  v_ajenos int;
  v_ejemplo text;
begin
  select count(*), min(u.email) into v_ajenos, v_ejemplo
  from auth.users u
  where lower(u.email) not like '%@example.com'
    and lower(u.email) not in (
      'extserviciosapp@gmail.com',
      'andrea.rios@extendiendoservicios.com',
      'paula.lemos@extendiendoservicios.com',
      'noelia.vera@extendiendoservicios.com',
      'maria.gomez@extendiendoservicios.com',
      'juan.perez@extendiendoservicios.com',
      'sofia.ruiz@extendiendoservicios.com',
      'carlos.medina@extendiendoservicios.com',
      'lucia.torres@extendiendoservicios.com',
      'rocio.aguirre@extendiendoservicios.com',
      'valeria.paz@extendiendoservicios.com',
      'diego.fabbri@extendiendoservicios.com',
      'martin.sosa@extendiendoservicios.com',
      'patricia.nunez@extendiendoservicios.com'
    );

  if v_ajenos > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Esta base tiene %s usuario(s) que no son del seed ficticio ni de las cuentas e2e (por ejemplo %s). Los datos de prueba de insumos son solo para App_dev: no se corren acá.',
        v_ajenos, v_ejemplo
      );
  end if;
end $$;

create temporary table tmp_seed_supplies (
  code text primary key,
  category_key text not null,
  name text not null,
  presentation text,
  min_qty integer,
  cost_price numeric(12, 2) not null,
  sale_price numeric(12, 2) not null,
  stock integer not null,
  active boolean not null default true
) on commit drop;

-- La columna `stock` es el stock FINAL esperado: la historia de más abajo lo explica y el bloque
-- de verificación falla si no coincide. DES-004 arranca con el precio viejo y sube en la historia
-- (queda en el historial de precios). QUI-001 arranca con el costo viejo y lo actualiza el
-- segundo ingreso.
insert into tmp_seed_supplies (code, category_key, name, presentation, min_qty, cost_price, sale_price, stock, active)
values
  ('QUI-001', 'quimicos', 'Lavandina', '1 L', 12, 780.00, 1092.00, 24, true),
  ('QUI-002', 'quimicos', 'Lavandina', '5 L', 4, 3900.00, 5460.00, 3, true),
  ('QUI-003', 'quimicos', 'Detergente concentrado', '500 ml', 10, 1200.00, 1680.00, 0, true),
  ('QUI-004', 'quimicos', 'Desengrasante', '5 L', 3, 6200.00, 8680.00, 6, true),
  ('QUI-005', 'quimicos', 'Limpiavidrios con gatillo', '500 ml', 8, 1500.00, 2100.00, 8, true),
  ('DES-001', 'descartables', 'Bolsas de residuo 60 x 90', 'paquete x 10', 15, 1800.00, 2520.00, 40, true),
  ('DES-002', 'descartables', 'Bolsas de residuo 50 x 70', 'paquete x 10', 10, 1500.00, 2100.00, 4, true),
  ('DES-003', 'descartables', 'Papel higiénico 300 m', 'bolsón x 8', 5, 9800.00, 13720.00, 12, true),
  ('DES-004', 'descartables', 'Toalla de papel intercalada', 'caja x 2400', null, 13800.00, 19320.00, 5, true),
  ('DES-005', 'descartables', 'Jabón líquido de manos', '5 L', 3, 5400.00, 7560.00, 0, true),
  ('PRO-001', 'proteccion', 'Guantes de látex talle M', 'caja x 100', 4, 7200.00, 10080.00, 9, true),
  ('PRO-002', 'proteccion', 'Guantes de nitrilo talle L', 'caja x 100', null, 9800.00, 13720.00, 0, true),
  ('PRO-003', 'proteccion', 'Barbijo descartable', 'caja x 50', 3, 3500.00, 4900.00, 2, true),
  ('UTE-001', 'utensilios', 'Esponja doble faz', 'paquete x 10', 6, 2100.00, 2940.00, 14, true),
  ('UTE-002', 'utensilios', 'Trapo de piso', 'unidad', 10, 1300.00, 1820.00, 22, true),
  ('UTE-003', 'utensilios', 'Mopa de algodón 400 g', 'unidad', null, 3600.00, 5040.00, 7, true),
  ('UTE-009', 'utensilios', 'Balde de 10 L (discontinuado)', 'unidad', null, 2500.00, 3500.00, 0, false);

create temporary table tmp_seed_categories (key text primary key, name text not null, sort_order integer not null) on commit drop;
insert into tmp_seed_categories (key, name, sort_order)
values
  ('quimicos', 'Químicos de limpieza', 10),
  ('descartables', 'Descartables', 20),
  ('proteccion', 'Protección personal', 30),
  ('utensilios', 'Utensilios', 40);

-- =================================================================================================
-- 1. Borrado de lo propio (solo tablas de insumos, solo lo que cuelga de los códigos de arriba).
-- =================================================================================================

alter table public.stock_movements disable trigger trg_stock_immutable;
alter table public.stock_movement_lines disable trigger trg_stock_immutable;
alter table public.stock_counts disable trigger trg_stock_immutable;
alter table public.stock_count_lines disable trigger trg_stock_immutable;
alter table public.supply_price_changes disable trigger trg_stock_immutable;

create temporary table tmp_mine_supplies on commit drop as
  select id from public.supplies where code in (select code from tmp_seed_supplies);

create temporary table tmp_mine_movements on commit drop as
  select distinct l.movement_id as id from public.stock_movement_lines l where l.supply_id in (select id from tmp_mine_supplies);

create temporary table tmp_mine_counts on commit drop as
  select distinct m.count_id as id from public.stock_movements m
  where m.id in (select id from tmp_mine_movements) and m.count_id is not null
  union
  select distinct cl.count_id from public.stock_count_lines cl where cl.supply_id in (select id from tmp_mine_supplies);

delete from public.security_events
where target_id in (select id from tmp_mine_supplies union select id from tmp_mine_movements);

delete from public.supply_shortage_reports
where supply_id in (select id from tmp_mine_supplies)
   or (supply_id is null and description = 'Cepillo para inodoro' and comment = 'No hay en el depósito de la sede.');

delete from public.stock_movement_lines where movement_id in (select id from tmp_mine_movements);
delete from public.stock_movements where id in (select id from tmp_mine_movements);
delete from public.stock_count_lines where count_id in (select id from tmp_mine_counts);
delete from public.stock_counts where id in (select id from tmp_mine_counts);
delete from public.supply_price_changes where supply_id in (select id from tmp_mine_supplies);
delete from public.supplies where id in (select id from tmp_mine_supplies);

-- Las categorías propias se van solo si no les quedó ningún artículo (por si alguien cargó uno).
delete from public.supply_categories c
where c.name in (select name from tmp_seed_categories)
  and not exists (select 1 from public.supplies s where s.category_id = c.id);

alter table public.stock_movements enable trigger trg_stock_immutable;
alter table public.stock_movement_lines enable trigger trg_stock_immutable;
alter table public.stock_counts enable trigger trg_stock_immutable;
alter table public.stock_count_lines enable trigger trg_stock_immutable;
alter table public.supply_price_changes enable trigger trg_stock_immutable;

-- =================================================================================================
-- 2. Personas y sedes existentes (nunca se crean).
--    Orden: primero las cuentas que no son e2e, después por correo e id: de forma determinista.
-- =================================================================================================

create temporary table tmp_actors (key text primary key, id uuid not null) on commit drop;

create temporary table tmp_pool_employees on commit drop as
  select row_number() over (order by (lower(u.email) like 'e2e-%'), lower(u.email), p.id) as n, p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.user_roles ur on ur.profile_id = p.id and ur.role = 'employee'
  join public.employees e on e.profile_id = p.id and e.status = 'active' and e.deleted_at is null
  where p.is_active and p.deleted_at is null;

do $$
declare
  v_admin uuid;
  v_coord uuid;
  v_site uuid;
  v_n integer := (select count(*) from tmp_pool_employees);
begin
  select p.id into v_admin
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.user_roles ur on ur.profile_id = p.id and ur.role in ('owner', 'admin')
  where p.is_active and p.deleted_at is null
  order by (lower(u.email) like 'e2e-%'), (ur.role = 'admin'), lower(u.email), p.id
  limit 1;

  select p.id into v_coord
  from public.profiles p
  join auth.users u on u.id = p.id
  join public.user_roles ur on ur.profile_id = p.id and ur.role = 'supervisor'
  where p.is_active and p.deleted_at is null
  order by (lower(u.email) like 'e2e-%'), lower(u.email), p.id
  limit 1;

  select s.id into v_site
  from public.sites s
  where s.status = 'active' and s.deleted_at is null
  order by s.name, s.id
  limit 1;

  if v_admin is null or v_n = 0 or v_site is null then
    raise exception using errcode = 'P0001',
      message = format('Para cargar los insumos hace falta, en la base, al menos una persona de administración activa (hay %s), un empleado activo (hay %s) y una sede activa (hay %s).',
                       case when v_admin is null then 0 else 1 end, v_n, case when v_site is null then 0 else 1 end);
  end if;

  insert into tmp_actors (key, id)
  values
    ('admin', v_admin),
    ('coord', coalesce(v_coord, v_admin)),
    ('coord_site', v_site),
    ('emp_1', (select id from tmp_pool_employees where n = 1)),
    ('emp_2', (select id from tmp_pool_employees where n = ((2 - 1) % v_n) + 1)),
    ('emp_3', (select id from tmp_pool_employees where n = ((3 - 1) % v_n) + 1));
end $$;

-- =================================================================================================
-- 3. Categorías, artículos e historial de precios iniciales.
-- =================================================================================================

insert into public.supply_categories (name, sort_order, active, created_by)
select c.name, c.sort_order, true, (select id from tmp_actors where key = 'admin')
from tmp_seed_categories c
where not exists (select 1 from public.supply_categories x where lower(x.name) = lower(c.name));

insert into public.supplies (code, name, presentation, category_id, min_qty, cost_price, sale_price, active, notes, created_by, created_at)
select s.code, s.name, s.presentation, c.id, s.min_qty, s.cost_price, s.sale_price, s.active,
       case when s.code = 'DES-004' then 'Se compra por caja cerrada.' end,
       (select id from tmp_actors where key = 'admin'),
       app.local_ts(app.today() - 21, '08:30')
from tmp_seed_supplies s
join tmp_seed_categories k on k.key = s.category_key
join public.supply_categories c on lower(c.name) = lower(k.name);

-- Primer precio de cada artículo propio en el historial (source create).
insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
select s.id, null, s.cost_price, null, s.sale_price, 'create',
       (select id from tmp_actors where key = 'admin'), app.local_ts(app.today() - 21, '08:30')
from public.supplies s
where s.code in (select code from tmp_seed_supplies);

-- Atajo: arma las líneas del núcleo a partir de [{code, qty, unit_cost?, update_cost?}].
create function pg_temp.seed_lines(p_lines jsonb, p_sign integer)
returns jsonb
language sql
as $$
  select jsonb_agg(
    jsonb_build_object('supply_id', s.id, 'qty_delta', (x ->> 'qty')::integer * p_sign)
    || case when x ? 'unit_cost'
         then jsonb_build_object('unit_cost', x -> 'unit_cost', 'update_cost', coalesce(x -> 'update_cost', 'false'::jsonb))
         else '{}'::jsonb end
  )
  from jsonb_array_elements(p_lines) as x
  join public.supplies s on s.code = x ->> 'code';
$$;

-- Atajo: un turno existente con una asignación vigente de un empleado activo, el más reciente en o
-- antes de «hoy + días» (hasta 4 días hacia atrás, por los fines de semana). p_skip elige otro de
-- la misma ventana, dando la vuelta si hay pocos. Si no hay ninguno, cae a una sede activa y a un
-- empleado del pozo, sin turno, con una observación que lo aclara.
create function pg_temp.seed_shift(p_days integer, p_skip integer)
returns table (shift_id uuid, site_id uuid, employee_id uuid, shift_date date, obs text)
language plpgsql
as $$
declare
  v_n integer;
  v_sites integer;
begin
  select count(*) into v_n
  from public.shifts sh
  join public.assignments a on a.shift_id = sh.id and a.removed_at is null
  join tmp_pool_employees pe on pe.id = a.employee_id
  where sh.deleted_at is null and sh.status <> 'cancelled'
    and sh.shift_date <= app.today() + p_days and sh.shift_date >= app.today() + p_days - 4;

  if v_n > 0 then
    return query
      select sh.id, sh.site_id, a.employee_id, sh.shift_date, null::text
      from public.shifts sh
      join public.assignments a on a.shift_id = sh.id and a.removed_at is null
      join tmp_pool_employees pe on pe.id = a.employee_id
      where sh.deleted_at is null and sh.status <> 'cancelled'
        and sh.shift_date <= app.today() + p_days and sh.shift_date >= app.today() + p_days - 4
      order by sh.shift_date desc, sh.start_time, sh.id
      offset (p_skip % v_n) limit 1;
  else
    select count(*) into v_sites from public.sites s where s.status = 'active' and s.deleted_at is null;
    return query
      select null::uuid,
             (select s.id from public.sites s where s.status = 'active' and s.deleted_at is null order by s.name, s.id offset (p_skip % v_sites) limit 1),
             (select pe.id from tmp_pool_employees pe where pe.n = (p_skip % (select count(*) from tmp_pool_employees)) + 1),
             app.today() + p_days,
             'Retiro para la sede, sin turno puntual.'::text;
  end if;
end;
$$;

-- Atajo: une la observación propia de la historia con la del turno que no se encontró.
create function pg_temp.seed_note(p_note text, p_obs text)
returns text
language sql
as $$ select nullif(concat_ws(' ', p_note, p_obs), ''); $$;

-- =================================================================================================
-- 4. Historia: movimientos, control de stock y avisos de faltante.
-- =================================================================================================

do $$
declare
  v_admin uuid := (select id from tmp_actors where key = 'admin');
  v_paula uuid := (select id from tmp_actors where key = 'coord');
  v_juan uuid := (select id from tmp_actors where key = 'emp_1');
  v_maria uuid := (select id from tmp_actors where key = 'emp_2');
  v_carlos uuid := (select id from tmp_actors where key = 'emp_3');
  v_site_coord uuid := (select id from tmp_actors where key = 'coord_site');
  v_prev timestamptz := now() - interval '30 days';
  v_at timestamptz;
  v_sh record;
  v_mov uuid;
  v_orig uuid;
  v_count_id uuid := gen_random_uuid();
  v_counted_at timestamptz;
  v_lines jsonb := '[]'::jsonb;
  v_lines_diff jsonb := '[]'::jsonb;
  r record;
  v_system integer;
  v_counted integer;
  v_bad text;
begin
  -- Ingreso 1 (hace 20 días): carga inicial del depósito. Cantidades iniciales = stock final +
  -- lo que sale en la historia (ver el comentario del bloque).
  v_at := app.local_ts(app.today() - 20, '09:00');
  v_mov := app.stock_post_movement('entry', v_admin,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 17), jsonb_build_object('code', 'QUI-002', 'qty', 4),
      jsonb_build_object('code', 'QUI-003', 'qty', 6), jsonb_build_object('code', 'QUI-004', 'qty', 8),
      jsonb_build_object('code', 'QUI-005', 'qty', 11), jsonb_build_object('code', 'DES-001', 'qty', 42),
      jsonb_build_object('code', 'DES-002', 'qty', 9), jsonb_build_object('code', 'DES-003', 'qty', 9),
      jsonb_build_object('code', 'DES-004', 'qty', 5), jsonb_build_object('code', 'DES-005', 'qty', 3),
      jsonb_build_object('code', 'PRO-001', 'qty', 10), jsonb_build_object('code', 'PRO-002', 'qty', 2),
      jsonb_build_object('code', 'PRO-003', 'qty', 1), jsonb_build_object('code', 'UTE-001', 'qty', 15),
      jsonb_build_object('code', 'UTE-002', 'qty', 25), jsonb_build_object('code', 'UTE-003', 'qty', 7)), 1),
    'normal', v_at, p_supplier => 'Distribuidora Limpia Sur S.A.', p_document_number => 'R-0001-00004512',
    p_note => 'Carga inicial del depósito');
  v_prev := v_at;

  -- Ingreso 2 (hace 12 días): reposición con otro proveedor. La lavandina de 1 L se compró a
  -- $ 850 y se actualiza su costo vigente (antes $ 780): queda en el historial de precios.
  v_at := app.local_ts(app.today() - 12, '10:30');
  v_mov := app.stock_post_movement('entry', v_admin,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 12, 'unit_cost', 850.00, 'update_cost', true),
      jsonb_build_object('code', 'DES-003', 'qty', 4), jsonb_build_object('code', 'PRO-003', 'qty', 2)), 1),
    'normal', v_at, p_supplier => 'Química Norte S.R.L.', p_document_number => 'FC-A-0008-00001234');
  -- La venta de la lavandina de 1 L acompaña al costo (cambio manual, mismo momento).
  update public.supplies set sale_price = 1190.00 where code = 'QUI-001';
  insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
  select id, 850.00, 850.00, 1092.00, 1190.00, 'manual', v_admin, v_at + interval '5 minutes' from public.supplies where code = 'QUI-001';
  v_prev := v_at;

  -- Aumento de la toalla de papel (hace 10 días): costo de $ 13.800 a $ 14.500.
  v_at := app.local_ts(app.today() - 10, '11:00');
  update public.supplies set cost_price = 14500.00, sale_price = 20300.00 where code = 'DES-004';
  insert into public.supply_price_changes (supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by, changed_at)
  select id, 13800.00, 14500.00, 19320.00, 20300.00, 'manual', v_admin, v_at from public.supplies where code = 'DES-004';
  v_prev := v_at;

  -- Retiro de un empleado en su turno (hace ~9 días).
  select * into v_sh from pg_temp.seed_shift(-9, 0);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 2), jsonb_build_object('code', 'DES-001', 'qty', 2),
      jsonb_build_object('code', 'UTE-001', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note(null, v_sh.obs));
  v_prev := v_at;

  -- Retiro (hace ~8 días).
  select * into v_sh from pg_temp.seed_shift(-8, 2);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-003', 'qty', 4), jsonb_build_object('code', 'DES-005', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note('Se estaba terminando el detergente', v_sh.obs));
  v_prev := v_at;

  -- Retiro (hace ~7 días).
  select * into v_sh from pg_temp.seed_shift(-7, 4);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-002', 'qty', 1), jsonb_build_object('code', 'DES-002', 'qty', 3),
      jsonb_build_object('code', 'PRO-002', 'qty', 2)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note(null, v_sh.obs));
  v_prev := v_at;

  -- Retiro (hace ~6 días).
  select * into v_sh from pg_temp.seed_shift(-6, 1);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30'));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-005', 'qty', 2), jsonb_build_object('code', 'UTE-002', 'qty', 3),
      jsonb_build_object('code', 'DES-005', 'qty', 2), jsonb_build_object('code', 'PRO-001', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note(null, v_sh.obs));
  v_prev := v_at;

  -- Control de stock (hace 5 días, 17:00), cargado 20 minutos después por Andrea (IS-16, IS-31):
  -- cuatro artículos contados; en el desengrasante falta una unidad, los demás coinciden.
  v_counted_at := greatest(v_prev, app.local_ts(app.today() - 5, '17:00'));
  v_at := v_counted_at + interval '20 minutes';
  insert into public.stock_counts (id, counted_at, reviewer_id, notes, created_at, created_by)
  values (v_count_id, v_counted_at, v_admin, 'Control mensual del depósito', v_at, v_admin);
  for r in
    select s.id, s.code from public.supplies s
    where s.code in ('QUI-004', 'DES-001', 'UTE-002', 'PRO-001') order by s.id
  loop
    v_system := app.supply_stock_at(r.id, v_counted_at);
    v_counted := case when r.code = 'QUI-004' then v_system - 1 else v_system end;
    insert into public.stock_count_lines (count_id, supply_id, system_qty, counted_qty, difference)
    values (v_count_id, r.id, v_system, v_counted, v_counted - v_system);
    if v_counted <> v_system then
      v_lines_diff := v_lines_diff || jsonb_build_array(
        jsonb_build_object('supply_id', r.id, 'qty_delta', v_counted - v_system));
    end if;
  end loop;
  v_mov := app.stock_post_movement('count', v_admin, v_lines_diff, 'count', v_at,
    p_note => 'Control mensual del depósito', p_count_id => v_count_id);
  v_prev := v_at;

  -- Retiro cargado por la administración en nombre de un empleado (hace ~4 días), que después se
  -- anula porque se cargó dos veces (IS-27: contramovimiento enlazado, original «Anulado»).
  select * into v_sh from pg_temp.seed_shift(-4, 3);
  v_at := greatest(v_prev, app.local_ts(v_sh.shift_date, '16:00'));
  v_orig := app.stock_post_movement('withdrawal', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-001', 'qty', 4)), -1),
    'normal', v_at, p_person_id => v_juan, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note('Cargado por la oficina a pedido del empleado', v_sh.obs));
  v_prev := v_at;

  -- Ajuste por rotura (hace 4 días).
  v_at := greatest(v_prev, app.local_ts(app.today() - 4, '17:30'));
  v_mov := app.stock_post_movement('adjustment', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-002', 'qty', -2)), 1),
    'normal', v_at, p_reason => 'breakage', p_note => 'Caja golpeada en el depósito');
  v_prev := v_at;

  -- Anulación del retiro cargado dos veces (hace 3 días) y ajuste por vencimiento.
  v_at := greatest(v_prev, app.local_ts(app.today() - 3, '09:15'));
  v_mov := app.stock_post_movement('reversal', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'DES-001', 'qty', 4)), 1),
    'void', v_at, p_person_id => v_juan,
    p_shift_id => (select shift_id from public.stock_movements where id = v_orig),
    p_site_id => (select site_id from public.stock_movements where id = v_orig),
    p_note => 'Se cargó dos veces', p_reverses_id => v_orig);
  update public.stock_movements
  set voided_at = v_at, voided_by = v_admin, void_reason = 'Se cargó dos veces'
  where id = v_orig;
  v_prev := v_at;

  v_at := greatest(v_prev, app.local_ts(app.today() - 3, '17:30'));
  v_mov := app.stock_post_movement('adjustment', v_admin,
    pg_temp.seed_lines(jsonb_build_array(jsonb_build_object('code', 'QUI-005', 'qty', -1)), 1),
    'normal', v_at, p_reason => 'expired', p_note => 'Un envase vencido');
  v_prev := v_at;

  -- Retiro de la coordinadora para una sede, sin turno puntual (hace 2 días).
  v_at := greatest(v_prev, app.local_ts(app.today() - 2, '08:10'));
  v_mov := app.stock_post_movement('withdrawal', v_paula,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'QUI-001', 'qty', 3), jsonb_build_object('code', 'QUI-003', 'qty', 2)), -1),
    'normal', v_at, p_person_id => v_paula, p_site_id => v_site_coord,
    p_note => 'Reposición de la semana');
  v_prev := v_at;

  -- Retiro (ayer).
  select * into v_sh from pg_temp.seed_shift(-1, 5);
  v_at := least(now(), greatest(v_prev, app.local_ts(v_sh.shift_date, '07:30')));
  v_mov := app.stock_post_movement('withdrawal', v_sh.employee_id,
    pg_temp.seed_lines(jsonb_build_array(
      jsonb_build_object('code', 'DES-003', 'qty', 1), jsonb_build_object('code', 'PRO-003', 'qty', 1),
      jsonb_build_object('code', 'QUI-004', 'qty', 1)), -1),
    'normal', v_at, p_person_id => v_sh.employee_id, p_shift_id => v_sh.shift_id, p_site_id => v_sh.site_id,
    p_note => pg_temp.seed_note(null, v_sh.obs));

  -- El stock final tiene que coincidir con el esperado de la tabla de artículos.
  select string_agg(format('%s: esperado %s, quedó %s', s.code, t.stock, s.stock_qty), '; ')
  into v_bad
  from public.supplies s
  join tmp_seed_supplies t on t.code = s.code
  where s.stock_qty <> t.stock;
  if v_bad is not null then
    raise exception using errcode = 'P0001', message = 'El stock del seed de insumos no coincide: ' || v_bad;
  end if;

  -- Avisos de faltante (IS-14, IS-29): uno abierto de un empleado por el jabón (sin stock), con su
  -- turno de hoy si lo tiene, y uno resuelto de otro, con texto libre.
  insert into public.supply_shortage_reports (reported_by, supply_id, shift_id, site_id, comment, status, created_at, created_by)
  select v_maria, (select id from public.supplies where code = 'DES-005'), sh.id, sh.site_id,
         'Se terminó el jabón del baño de planta baja.', 'open',
         least(now(), app.local_ts(app.today(), '09:20')), v_maria
  from (
    select s2.id, s2.site_id from public.shifts s2
    join public.assignments a on a.shift_id = s2.id and a.removed_at is null and a.employee_id = v_maria
    where s2.shift_date = app.today() and s2.deleted_at is null
    order by s2.start_time limit 1
  ) sh;
  -- Si ese empleado no tiene turno hoy, el aviso se carga sin turno.
  insert into public.supply_shortage_reports (reported_by, supply_id, comment, status, created_at, created_by)
  select v_maria, (select id from public.supplies where code = 'DES-005'),
         'Se terminó el jabón del baño de planta baja.', 'open',
         least(now(), app.local_ts(app.today(), '09:20')), v_maria
  where not exists (select 1 from public.supply_shortage_reports where reported_by = v_maria and status = 'open');

  insert into public.supply_shortage_reports (
    reported_by, description, comment, status, resolved_by, resolved_at, resolution_note, created_at, created_by
  )
  values (
    v_carlos, 'Cepillo para inodoro', 'No hay en el depósito de la sede.', 'resolved', v_admin,
    app.local_ts(app.today() - 5, '11:40'), 'Se compró en la ferretería, llega el jueves.',
    app.local_ts(app.today() - 6, '10:05'), v_carlos
  );
end $$;

commit;
