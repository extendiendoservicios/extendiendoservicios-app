-- pgTAP de la migración 0074_p25_8_catalogo_inicial_insumos.sql (P25.8, módulo E): catálogo inicial
--   de Insumos para producción (4 categorías y 16 artículos con stock y precios en cero).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. No depende del
-- seed ni del orden: App_dev ya tiene estos códigos con stock y movimientos, así que el test
-- «aparta» dentro de la transacción lo que exista (les cambia el código y el nombre, que equivale
-- a borrarlo sin tocar las tablas inmutables), corre la carga y verifica lo que la carga insertó.
-- El SQL de la carga se copia en tests.cargar_0074() porque un test no puede leer el archivo de la
-- migración; si cambia uno, tiene que cambiar el otro.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;

create or replace function tests.cargar_0074()
returns void
language plpgsql
as $fn$
begin
insert into public.supply_categories (name, sort_order)
select v.name, v.sort_order
from (
  values
    ('Químicos de limpieza', 10),
    ('Descartables', 20),
    ('Protección personal', 30),
    ('Utensilios', 40)
) as v (name, sort_order)
where not exists (
  select 1 from public.supply_categories c
  where lower(btrim(c.name)) = lower(btrim(v.name))
);

with catalogo (code, category_name, name, presentation) as (
  values
    ('QUI-001', 'Químicos de limpieza', 'Lavandina', '1 L'),
    ('QUI-002', 'Químicos de limpieza', 'Lavandina', '5 L'),
    ('QUI-003', 'Químicos de limpieza', 'Detergente concentrado', '500 ml'),
    ('QUI-004', 'Químicos de limpieza', 'Desengrasante', '5 L'),
    ('QUI-005', 'Químicos de limpieza', 'Limpiavidrios con gatillo', '500 ml'),
    ('DES-001', 'Descartables', 'Bolsas de residuo 60 x 90', 'paquete x 10'),
    ('DES-002', 'Descartables', 'Bolsas de residuo 50 x 70', 'paquete x 10'),
    ('DES-003', 'Descartables', 'Papel higiénico 300 m', 'bolsón x 8'),
    ('DES-004', 'Descartables', 'Toalla de papel intercalada', 'caja x 2400'),
    ('DES-005', 'Descartables', 'Jabón líquido de manos', '5 L'),
    ('PRO-001', 'Protección personal', 'Guantes de látex talle M', 'caja x 100'),
    ('PRO-002', 'Protección personal', 'Guantes de nitrilo talle L', 'caja x 100'),
    ('PRO-003', 'Protección personal', 'Barbijo descartable', 'caja x 50'),
    ('UTE-001', 'Utensilios', 'Esponja doble faz', 'paquete x 10'),
    ('UTE-002', 'Utensilios', 'Trapo de piso', 'unidad'),
    ('UTE-003', 'Utensilios', 'Mopa de algodón 400 g', 'unidad')
),
nuevos as (
  insert into public.supplies (code, name, presentation, category_id, min_qty, cost_price, sale_price, stock_qty, active)
  select k.code, k.name, k.presentation, c.id, null, 0, 0, 0, true
  from catalogo k
  join public.supply_categories c on lower(btrim(c.name)) = lower(btrim(k.category_name))
  where not exists (
    select 1 from public.supplies s
    where lower(btrim(s.code)) = lower(btrim(k.code))
  )
  returning id, cost_price, sale_price
)
insert into public.supply_price_changes (
  supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by
)
select n.id, null, n.cost_price, null, n.sale_price, 'create', null
from nuevos n;

end;
$fn$;

-- Aparta lo que ya exista (App_dev): equivale a borrarlo para probar la carga desde cero.
create or replace function tests.apartar_0074()
returns void
language sql
as $fn$
  update public.supplies
  set code = 'zz-' || code
  where lower(btrim(code)) in (
    'qui-001', 'qui-002', 'qui-003', 'qui-004', 'qui-005', 'des-001', 'des-002', 'des-003', 'des-004',
    'des-005', 'pro-001', 'pro-002', 'pro-003', 'ute-001', 'ute-002', 'ute-003', 'ute-009'
  );
  update public.supply_categories
  set name = 'zz-' || name
  where lower(btrim(name)) in ('químicos de limpieza', 'descartables', 'protección personal', 'utensilios');
$fn$;

select plan(15);

-- Estado previo para comprobar al final que las filas ajenas no cambian.
create temporary table tmp_previo on commit drop as
select s.id, s.code, s.name, s.stock_qty, s.cost_price, s.sale_price
from public.supplies s
where lower(btrim(s.code)) in (
  'qui-001', 'qui-002', 'qui-003', 'qui-004', 'qui-005', 'des-001', 'des-002', 'des-003', 'des-004',
  'des-005', 'pro-001', 'pro-002', 'pro-003', 'ute-001', 'ute-002', 'ute-003', 'ute-009'
);

select tests.apartar_0074();
select tests.cargar_0074();

create temporary table tmp_cat on commit drop as
select * from public.supply_categories where lower(btrim(name)) in ('químicos de limpieza', 'descartables', 'protección personal', 'utensilios');
create temporary table tmp_art on commit drop as
select * from public.supplies where code ~ '^(QUI|DES|PRO|UTE)-[0-9]{3}$' and code <> 'UTE-009';

select is((select count(*)::integer from tmp_cat), 4, 'se cargan las 4 categorías');
select results_eq(
  $$select name, sort_order from tmp_cat order by sort_order$$,
  $$values ('Químicos de limpieza'::text, 10), ('Descartables', 20), ('Protección personal', 30), ('Utensilios', 40)$$,
  'las categorías van con su nombre y su orden'
);
select is((select count(*)::integer from tmp_art), 16, 'se cargan los 16 artículos');
select is((select count(*)::integer from tmp_art where stock_qty = 0 and cost_price = 0 and sale_price = 0 and min_qty is null), 16, 'todos con stock 0, precios 0 y mínimo nulo');
select is((select count(*)::integer from tmp_art where active and notes is null and image_path is null and created_by is null), 16, 'activos, sin notas ni imagen y con created_by nulo');
select is((select count(*)::integer from public.supplies where code = 'UTE-009'), 0, 'UTE-009 (discontinuado) no está');
select results_eq(
  $$select a.code, c.name, a.name, a.presentation from tmp_art a join public.supply_categories c on c.id = a.category_id where a.code in ('QUI-002', 'DES-004', 'UTE-002') order by a.code$$,
  $$values ('DES-004'::text, 'Descartables'::text, 'Toalla de papel intercalada'::text, 'caja x 2400'::text), ('QUI-002', 'Químicos de limpieza', 'Lavandina', '5 L'), ('UTE-002', 'Utensilios', 'Trapo de piso', 'unidad')$$,
  'categoría, nombre y presentación de muestra coinciden con el seed'
);
select is(
  (select count(*)::integer from public.supply_price_changes p join tmp_art a on a.id = p.supply_id
   where p.source = 'create' and p.old_cost_price is null and p.old_sale_price is null
     and p.new_cost_price = 0 and p.new_sale_price = 0 and p.changed_by is null),
  16, 'cada artículo tiene su fila de alta en el historial de precios'
);
select is(
  (select count(*)::integer from public.stock_movement_lines l join tmp_art a on a.id = l.supply_id),
  0, 'sin movimientos de stock'
);

-- Segunda corrida: no duplica nada. Y lo que alguien editó no se pisa.
update public.supplies set name = 'Lavandina editada', sale_price = 99, min_qty = 7, stock_qty = 3 where code = 'QUI-001';
update public.supply_categories set sort_order = 77 where name = 'Descartables';
select tests.cargar_0074();

select is((select count(*)::integer from public.supply_categories where lower(btrim(name)) in ('químicos de limpieza', 'descartables', 'protección personal', 'utensilios')), 4, 'correrla otra vez no duplica categorías');
select is((select count(*)::integer from public.supplies where code ~ '^(QUI|DES|PRO|UTE)-[0-9]{3}$' and code <> 'UTE-009'), 16, 'correrla otra vez no duplica artículos');
select is((select count(*)::integer from public.supply_price_changes p join tmp_art a on a.id = p.supply_id), 16, 'correrla otra vez no duplica el historial de precios');
select results_eq(
  $$select name, sale_price, min_qty, stock_qty from public.supplies where code = 'QUI-001'$$,
  $$values ('Lavandina editada'::text, 99.00::numeric, 7, 3)$$,
  'un artículo con el mismo código no se pisa'
);
select is((select sort_order from public.supply_categories where name = 'Descartables'), 77, 'una categoría existente no se pisa');

-- Lo que había antes (App_dev) quedó intacto, solo apartado.
select is(
  (select count(*)::integer from tmp_previo p join public.supplies s on s.id = p.id
   where s.code = 'zz-' || p.code and s.stock_qty = p.stock_qty and s.cost_price = p.cost_price and s.sale_price = p.sale_price),
  (select count(*)::integer from tmp_previo),
  'los artículos preexistentes conservan stock y precios'
);

select * from finish();

rollback;
