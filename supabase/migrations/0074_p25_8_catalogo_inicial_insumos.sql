-- =================================================================================================
-- 0074_p25_8_catalogo_inicial_insumos.sql (P25.8, módulo E)
--
-- Catálogo inicial de Insumos para producción. Pedido de los dueños (28 oct 2026): que la sección
-- Insumos arranque con las mismas categorías y artículos del seed de desarrollo
-- (supabase/seed-insumos-dev.sql), con los mismos nombres y presentaciones, y con el stock y los
-- precios en cero, para que solo tengan que editarlos.
--
-- Es una CARGA DE DATOS, no un cambio de esquema: no crea ni modifica tablas, índices, políticas
-- ni funciones.
--
-- Qué carga:
--   * 4 categorías (con su sort_order).
--   * 16 artículos activos. El artículo discontinuado del seed (UTE-009) queda afuera.
--     Todos con costo y venta en 0, stock en 0 (sin movimientos), mínimo nulo (lo define la empresa),
--     sin notas ni imagen y con created_by nulo (la carga la hace el sistema).
--   * La fila de alta del historial de precios (supply_price_changes, source 'create', con
--     changed_by nulo) de cada artículo cargado, igual a la que deja upsert_supply, para que la
--     ficha se vea como la de un alta desde la pantalla.
--
-- Idempotente y sin pisar nada:
--   * Una categoría se inserta solo si no existe otra con el mismo lower(btrim(name))
--     (índice supply_categories_name_key).
--   * Un artículo se inserta solo si no existe otro con el mismo lower(btrim(code))
--     (índice supplies_code_key); en ese caso tampoco se agrega historial de precios.
--   * Si un código ya existe, no se toca nada de ese artículo, ni su categoría, ni su stock.
--
-- Sin efectos colaterales: los únicos triggers de estas tablas son trg_set_updated_at (before
-- update) y trg_stock_immutable en supply_price_changes (before update o delete); ninguno corre
-- con inserts. No se registran eventos en security_events (el alta inicial no lo hace tampoco).
-- =================================================================================================

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
