-- P25.1 · Insumos y control de stock (módulo E, acordado con Mike el 26 oct 2026; ver
-- Docs/Plan_Maestro/modulos/E_insumos_y_stock.md, decisiones IS-01 a IS-34, todas CONFIRMADAS).
-- Segunda de tres migraciones: la primera (0069) agrega las enumeraciones y la tercera (0071) el
-- bucket de imágenes.
--
-- Contenido, en orden:
--   1. Tablas: supply_categories, supplies, supply_price_changes, stock_counts, stock_count_lines,
--      stock_movements, stock_movement_lines y supply_shortage_reports, con índices, RLS (solo
--      lectura para la administración; todo se escribe por RPC) y grants.
--   2. Inmutabilidad (IS-27): un movimiento, sus líneas, los controles y el historial de precios
--      no se editan ni se borran; lo único que se escribe sobre un movimiento es la marca de
--      anulación, una sola vez.
--   3. Auxiliares del esquema `app`: nombre de persona, stock a una hora, historial de precios,
--      y el núcleo que mueve el stock (app.stock_post_movement).
--   4. Funciones de definidor que alimentan las vistas de empleados y coordinadores: catálogo sin
--      precios ni cantidades (IS-20), turnos y sedes que se pueden elegir (IS-28), mis retiros y
--      mis avisos.
--   5. RPC de catálogo: upsert_supply, set_supply_active, set_supply_prices y
--      upsert_supply_category.
--   6. RPC de movimientos: register_stock_entry, adjust_stock, register_withdrawal y
--      void_stock_movement.
--   7. RPC del control: register_stock_count (IS-31).
--   8. RPC de faltantes: report_supply_shortage y resolve_supply_shortage; y get_stock_summary
--      (tarjetas del Resumen, IS-30).
--   9. Vistas: v_supply_catalog, v_stock_admin, v_stock_movements_admin, v_stock_counts_admin,
--      v_supply_consumption_by_client, v_my_withdrawals, v_my_shortage_reports,
--      v_withdrawal_shift_options y v_withdrawal_site_options.
--
-- Reglas que atraviesan todo el archivo:
--   - El stock nunca queda negativo: `supplies.stock_qty` tiene `check (>= 0)` y las RPC bloquean
--     las filas de `supplies` involucradas en orden de `id` (select ... order by id for update)
--     antes de calcular, así que dos retiros simultáneos se serializan y el segundo ve el stock ya
--     descontado.
--   - La hora de cada registro la pone now() dentro de la función (ADR-009). Las fechas («hoy»,
--     «próximos 7 días») se calculan en hora de Argentina con app.today() (ADR-019).
--   - Empleados y coordinadores no leen precios, cantidades totales ni retiros ajenos (IS-20): las
--     tablas son legibles solo por dueño y administradores, y lo que ve el celular pasa por
--     funciones de definidor que filtran por la sesión.

-- ---------------------------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------------------------

-- 1.1 supply_categories (IS-03)
create table public.supply_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint supply_categories_name_check check (btrim(name) <> '')
);

comment on table public.supply_categories is
  'Categorías de insumos (0070, IS-03): una por artículo, para ordenar y filtrar. Nunca se borran (P-014): se desactivan, y solo si no tienen artículos activos. Las escribe upsert_supply_category.';

create unique index supply_categories_name_key on public.supply_categories (lower(btrim(name)));

create trigger trg_set_updated_at
before update on public.supply_categories
for each row execute function app.set_updated_at();

-- 1.2 supplies (IS-02, IS-04, IS-05, IS-06, IS-26)
create table public.supplies (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  presentation text,
  category_id uuid not null references public.supply_categories (id),
  image_path text,
  min_qty integer,
  cost_price numeric(12, 2) not null default 0,
  sale_price numeric(12, 2) not null default 0,
  stock_qty integer not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint supplies_code_check check (btrim(code) <> ''),
  constraint supplies_name_check check (btrim(name) <> ''),
  constraint supplies_min_qty_check check (min_qty is null or min_qty >= 0),
  constraint supplies_cost_price_check check (cost_price >= 0),
  constraint supplies_sale_price_check check (sale_price >= 0),
  constraint supplies_stock_qty_check check (stock_qty >= 0)
);

comment on table public.supplies is
  'Catálogo de insumos (0070, módulo E). Cada presentación es un artículo con su código y su stock, en unidades enteras (IS-02). stock_qty solo lo escriben las RPC de movimientos, nunca un update directo, y nunca baja de cero. Un artículo no se borra (P-014): se desactiva, y solo con stock en cero (IS-26). Solo lo leen dueño y administradores: empleados y coordinadores usan v_supply_catalog.';
comment on column public.supplies.code is 'Código interno. Único sin distinguir mayúsculas ni espacios de los extremos (supplies_code_key); se puede corregir (IS-26).';
comment on column public.supplies.presentation is 'Presentación (500 ml, 1 L, caja x 12...). Opcional.';
comment on column public.supplies.image_path is 'Ruta de la imagen en el bucket supply-images ({supply_id}/{uuid}.webp), una por artículo y opcional (IS-04, IS-32).';
comment on column public.supplies.min_qty is 'Stock mínimo opcional (IS-05). Nulo = sin aviso amarillo. Con stock igual o menor al mínimo, la fila es «low»; con stock cero es «empty», haya o no mínimo (IS-25).';
comment on column public.supplies.cost_price is 'Precio de costo vigente, en pesos con dos decimales (IS-06, IS-34). Cada cambio queda en supply_price_changes y cada línea de movimiento guarda el que regía (IS-22).';
comment on column public.supplies.sale_price is 'Precio de venta vigente, en pesos con dos decimales (IS-06, IS-34).';
comment on column public.supplies.stock_qty is 'Unidades en stock. Solo las RPC lo escriben (con el artículo bloqueado). check >= 0.';

create unique index supplies_code_key on public.supplies (lower(btrim(code)));
create index supplies_category_id_idx on public.supplies (category_id);
create index supplies_active_name_idx on public.supplies (active, name);

create trigger trg_set_updated_at
before update on public.supplies
for each row execute function app.set_updated_at();

-- 1.3 supply_price_changes (IS-22)
create table public.supply_price_changes (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies (id),
  old_cost_price numeric(12, 2),
  new_cost_price numeric(12, 2) not null,
  old_sale_price numeric(12, 2),
  new_sale_price numeric(12, 2) not null,
  source text not null default 'manual',
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  constraint supply_price_changes_source_check check (source in ('create', 'manual', 'entry'))
);

comment on table public.supply_price_changes is
  'Historial de precios de un artículo (0070, IS-22): quién, cuándo, valor anterior y nuevo. old_* es nulo en la fila de alta (source create). source: create (alta del artículo), manual (set_supply_prices) o entry (el ingreso actualizó el costo, IS-23). No se edita ni se borra.';

create index supply_price_changes_supply_id_idx on public.supply_price_changes (supply_id, changed_at desc);

-- 1.4 stock_counts y stock_count_lines (IS-15, IS-16, IS-31)
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  counted_at timestamptz not null,
  reviewer_id uuid references public.profiles (id),
  reviewer_name text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.profiles (id),
  constraint stock_counts_reviewer_check check (
    num_nonnulls(reviewer_id, nullif(btrim(reviewer_name), '')) = 1
  )
);

comment on table public.stock_counts is
  'Control de stock cargado desde la planilla (0070, IS-16, IS-31). counted_at es la fecha y hora del conteo; el revisor es una persona de la app (reviewer_id) o un nombre escrito (reviewer_name), uno solo. created_at / created_by: cuándo y quién lo cargó. El movimiento «Control de stock» con las diferencias apunta acá por stock_movements.count_id. No se edita ni se borra.';

create index stock_counts_counted_at_idx on public.stock_counts (counted_at desc);

create table public.stock_count_lines (
  count_id uuid not null references public.stock_counts (id),
  supply_id uuid not null references public.supplies (id),
  system_qty integer not null,
  counted_qty integer not null,
  difference integer not null,
  primary key (count_id, supply_id),
  constraint stock_count_lines_qty_check check (system_qty >= 0 and counted_qty >= 0),
  constraint stock_count_lines_difference_check check (difference = counted_qty - system_qty)
);

comment on table public.stock_count_lines is
  'Líneas de un control (0070, IS-31): por artículo, el stock del sistema a la hora del control (descontando los movimientos posteriores), lo contado y la diferencia. Las filas en blanco de la planilla no se cargan. No se edita ni se borra.';

create index stock_count_lines_supply_id_idx on public.stock_count_lines (supply_id);

-- 1.5 stock_movements y stock_movement_lines (IS-09 a IS-13, IS-22, IS-27)
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  kind public.stock_movement_kind not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles (id),
  person_id uuid references public.profiles (id),
  shift_id uuid references public.shifts (id),
  site_id uuid references public.sites (id),
  supplier text,
  document_number text,
  reason public.stock_adjustment_reason,
  note text,
  count_id uuid references public.stock_counts (id),
  reverses_id uuid references public.stock_movements (id),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  constraint stock_movements_withdrawal_check check (
    kind <> 'withdrawal' or (person_id is not null and site_id is not null)
  ),
  constraint stock_movements_adjustment_check check (kind <> 'adjustment' or reason is not null),
  constraint stock_movements_count_check check (kind <> 'count' or count_id is not null),
  constraint stock_movements_reversal_check check (
    (kind = 'reversal') = (reverses_id is not null)
  ),
  constraint stock_movements_shift_site_check check (shift_id is null or site_id is not null),
  constraint stock_movements_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  )
);

comment on table public.stock_movements is
  'Cabecera de un movimiento de stock (0070, módulo E): ingreso, devolución, retiro, ajuste, control de stock o anulación. recorded_at lo pone now() dentro de la RPC (ADR-009). Retiro: person_id es quien retira y recorded_by quien lo cargó (puede ser la administración en nombre de otra persona); siempre tiene site_id y, si corresponde a un turno puntual, shift_id (IS-12). Anulación (IS-27): un contramovimiento kind reversal con reverses_id al original, que queda con voided_at / voided_by / void_reason; hereda persona, turno y sede del original. No se edita ni se borra: lo único que se escribe sobre una fila es la marca de anulación, una vez.';
comment on column public.stock_movements.person_id is 'Quien retira (retiro y su anulación). Nulo en los demás tipos.';
comment on column public.stock_movements.reason is 'Motivo del ajuste (IS-10). Obligatorio en kind adjustment.';
comment on column public.stock_movements.count_id is 'Control de stock del que sale este movimiento (kind count).';
comment on column public.stock_movements.reverses_id is 'Movimiento que anula (kind reversal). Único: un movimiento se anula una sola vez.';

create index stock_movements_recorded_at_idx on public.stock_movements (recorded_at desc);
create index stock_movements_person_id_idx on public.stock_movements (person_id, recorded_at desc) where person_id is not null;
create index stock_movements_shift_id_idx on public.stock_movements (shift_id) where shift_id is not null;
create index stock_movements_site_id_idx on public.stock_movements (site_id, recorded_at desc) where site_id is not null;
create index stock_movements_kind_idx on public.stock_movements (kind, recorded_at desc);
create index stock_movements_count_id_idx on public.stock_movements (count_id) where count_id is not null;
create unique index stock_movements_reverses_id_key on public.stock_movements (reverses_id) where reverses_id is not null;

create table public.stock_movement_lines (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.stock_movements (id),
  supply_id uuid not null references public.supplies (id),
  qty_delta integer not null,
  unit_cost numeric(12, 2) not null,
  unit_sale numeric(12, 2) not null,
  stock_after integer not null,
  constraint stock_movement_lines_qty_check check (qty_delta <> 0),
  constraint stock_movement_lines_prices_check check (unit_cost >= 0 and unit_sale >= 0),
  constraint stock_movement_lines_stock_after_check check (stock_after >= 0),
  constraint stock_movement_lines_movement_supply_key unique (movement_id, supply_id)
);

comment on table public.stock_movement_lines is
  'Líneas de un movimiento de stock (0070). qty_delta con signo (ingreso y devolución positivos, retiro negativo; ajuste y control, el que corresponda). unit_cost y unit_sale guardan el costo y la venta vigentes en ese momento (IS-22): si el precio cambia después, lo histórico no se recalcula. stock_after es el stock del artículo justo después de la línea. Un artículo aparece una sola vez por movimiento. No se edita ni se borra.';

create index stock_movement_lines_supply_id_idx on public.stock_movement_lines (supply_id, movement_id);

-- 1.6 supply_shortage_reports (IS-14, IS-29)
create table public.supply_shortage_reports (
  id uuid primary key default gen_random_uuid(),
  reported_by uuid not null references public.profiles (id),
  supply_id uuid references public.supplies (id),
  description text,
  shift_id uuid references public.shifts (id),
  site_id uuid references public.sites (id),
  comment text,
  status public.supply_shortage_status not null default 'open',
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint supply_shortage_reports_target_check check (
    num_nonnulls(supply_id, nullif(btrim(description), '')) = 1
  ),
  constraint supply_shortage_reports_shift_site_check check (shift_id is null or site_id is not null),
  constraint supply_shortage_reports_resolved_check check (
    (status = 'open' and resolved_by is null and resolved_at is null and resolution_note is null)
    or (status = 'resolved' and resolved_by is not null and resolved_at is not null and nullif(btrim(resolution_note), '') is not null)
  )
);

comment on table public.supply_shortage_reports is
  'Avisos de faltante de insumo (0070, IS-14, IS-29). Un artículo del catálogo (supply_id) o un texto libre (description), uno solo; turno o sede y comentario, opcionales. Abierto o Resuelto, con la nota de quien lo resolvió. No hay pedidos de reposición. Un artículo puede tener varios avisos abiertos. Los escribe report_supply_shortage y resolve_supply_shortage; no se borran (P-014).';

create index supply_shortage_reports_status_idx on public.supply_shortage_reports (status, created_at desc);
create index supply_shortage_reports_reported_by_idx on public.supply_shortage_reports (reported_by, created_at desc);
create index supply_shortage_reports_supply_id_idx on public.supply_shortage_reports (supply_id) where supply_id is not null;

create trigger trg_set_updated_at
before update on public.supply_shortage_reports
for each row execute function app.set_updated_at();

-- 1.7 RLS y grants: solo lectura para dueño y administradores. Sin políticas de insert, update ni
--     delete: todo lo escribe una RPC (security definer). Empleados y coordinadores no leen nada
--     de estas tablas (IS-20): usan las vistas de la sección 9.
alter table public.supply_categories enable row level security;
alter table public.supplies enable row level security;
alter table public.supply_price_changes enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movement_lines enable row level security;
alter table public.supply_shortage_reports enable row level security;

create policy supply_categories_select_admin on public.supply_categories for select to authenticated using (app.is_admin());
create policy supplies_select_admin on public.supplies for select to authenticated using (app.is_admin());
create policy supply_price_changes_select_admin on public.supply_price_changes for select to authenticated using (app.is_admin());
create policy stock_counts_select_admin on public.stock_counts for select to authenticated using (app.is_admin());
create policy stock_count_lines_select_admin on public.stock_count_lines for select to authenticated using (app.is_admin());
create policy stock_movements_select_admin on public.stock_movements for select to authenticated using (app.is_admin());
create policy stock_movement_lines_select_admin on public.stock_movement_lines for select to authenticated using (app.is_admin());
create policy supply_shortage_reports_select_admin on public.supply_shortage_reports for select to authenticated using (app.is_admin());

revoke all on public.supply_categories from public, anon, authenticated;
revoke all on public.supplies from public, anon, authenticated;
revoke all on public.supply_price_changes from public, anon, authenticated;
revoke all on public.stock_counts from public, anon, authenticated;
revoke all on public.stock_count_lines from public, anon, authenticated;
revoke all on public.stock_movements from public, anon, authenticated;
revoke all on public.stock_movement_lines from public, anon, authenticated;
revoke all on public.supply_shortage_reports from public, anon, authenticated;

grant select on public.supply_categories to authenticated;
grant select on public.supplies to authenticated;
grant select on public.supply_price_changes to authenticated;
grant select on public.stock_counts to authenticated;
grant select on public.stock_count_lines to authenticated;
grant select on public.stock_movements to authenticated;
grant select on public.stock_movement_lines to authenticated;
grant select on public.supply_shortage_reports to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Inmutabilidad (IS-27)
-- ---------------------------------------------------------------------------------------------

create function app.stock_immutable_guard()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  -- Única escritura permitida: marcar la anulación de un movimiento, una sola vez, sin tocar nada más.
  if tg_table_name = 'stock_movements' and tg_op = 'UPDATE' then
    if old.voided_at is null
       and new.voided_at is not null
       and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason')
           = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
      return new;
    end if;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'Los movimientos de stock, los controles y el historial de precios no se editan ni se borran.',
    hint = 'MOVEMENT_IMMUTABLE';
end;
$$;

comment on function app.stock_immutable_guard() is
  'Trigger BEFORE UPDATE OR DELETE de las tablas inmutables del módulo E (IS-27). Rechaza todo salvo la marca de anulación de stock_movements (voided_at / voided_by / void_reason, una vez). Corre también para postgres: solo TRUNCATE (seed de desarrollo) lo esquiva.';

create trigger trg_stock_immutable before update or delete on public.stock_movements
for each row execute function app.stock_immutable_guard();
create trigger trg_stock_immutable before update or delete on public.stock_movement_lines
for each row execute function app.stock_immutable_guard();
create trigger trg_stock_immutable before update or delete on public.stock_counts
for each row execute function app.stock_immutable_guard();
create trigger trg_stock_immutable before update or delete on public.stock_count_lines
for each row execute function app.stock_immutable_guard();
create trigger trg_stock_immutable before update or delete on public.supply_price_changes
for each row execute function app.stock_immutable_guard();

revoke execute on function app.stock_immutable_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Auxiliares del esquema app
-- ---------------------------------------------------------------------------------------------

-- 3.1 Stock de un artículo a una hora (IS-31): el stock actual menos lo que se movió después. Lo
--     llaman las RPC con el artículo ya bloqueado, para que el resultado no cambie en el medio.
create function app.supply_stock_at(p_supply_id uuid, p_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select s.stock_qty - coalesce((
    select sum(l.qty_delta)
    from public.stock_movement_lines l
    join public.stock_movements m on m.id = l.movement_id
    where l.supply_id = s.id and m.recorded_at > p_at
  ), 0)::integer
  from public.supplies s
  where s.id = p_supply_id;
$$;

comment on function app.supply_stock_at(uuid, timestamptz) is
  'Stock del artículo a la hora indicada (0070, IS-31): stock_qty actual menos la suma de qty_delta de los movimientos con recorded_at posterior. Interna: no se expone a authenticated.';

revoke execute on function app.supply_stock_at(uuid, timestamptz) from public, anon, authenticated;

-- 3.2 Historial de precios (IS-22) y evento de seguridad. No actualiza supplies: lo hace quien la llama.
create function app.supply_log_price_change(
  p_supply_id uuid,
  p_old_cost numeric,
  p_new_cost numeric,
  p_old_sale numeric,
  p_new_sale numeric,
  p_source text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.supply_price_changes (
    supply_id, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, changed_by
  )
  values (p_supply_id, p_old_cost, p_new_cost, p_old_sale, p_new_sale, p_source, p_actor);

  if p_source <> 'create' then
    perform app.log_security_event(
      'supply_price_changed',
      p_actor,
      null,
      jsonb_build_object(
        'supply_id', p_supply_id,
        'source', p_source,
        'old_cost_price', p_old_cost,
        'new_cost_price', p_new_cost,
        'old_sale_price', p_old_sale,
        'new_sale_price', p_new_sale
      )
    );
  end if;
end;
$$;

comment on function app.supply_log_price_change(uuid, numeric, numeric, numeric, numeric, text, uuid) is
  'Inserta una fila en supply_price_changes y, salvo en el alta, registra el evento supply_price_changed (0070, IS-22). Interna.';

revoke execute on function app.supply_log_price_change(uuid, numeric, numeric, numeric, numeric, text, uuid) from public, anon, authenticated;

-- 3.3 Núcleo que mueve el stock. Valida las líneas, crea la cabecera, bloquea los artículos en
--     orden de id, calcula el stock nuevo (nunca negativo), guarda en cada línea el costo y la
--     venta del momento (IS-22) y actualiza supplies.stock_qty. Las RPC públicas validan permisos
--     y reglas de cada tipo antes de llamarla; el seed de desarrollo la llama con una hora
--     pasada.
--
--   p_lines: arreglo jsonb de {supply_id, qty_delta (entero con signo), unit_cost?, unit_sale?,
--            update_cost?}. unit_cost / unit_sale: si faltan, rige el precio vigente.
--            update_cost = true (solo ingreso y devolución): además de guardar el costo en la
--            línea, lo vuelve el costo vigente del artículo (IS-23).
--   p_mode:  normal | void | count. Solo cambia el texto y el código del error si el stock no
--            alcanza.
create function app.stock_post_movement(
  p_kind public.stock_movement_kind,
  p_actor uuid,
  p_lines jsonb,
  p_mode text default 'normal',
  p_recorded_at timestamptz default null,
  p_person_id uuid default null,
  p_shift_id uuid default null,
  p_site_id uuid default null,
  p_supplier text default null,
  p_document_number text default null,
  p_reason public.stock_adjustment_reason default null,
  p_note text default null,
  p_count_id uuid default null,
  p_reverses_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_movement_id uuid;
  v_elem jsonb;
  v_sid uuid;
  v_qty numeric;
  v_cost numeric;
  v_sale numeric;
  v_ids uuid[] := '{}';
  v_found integer := 0;
  r record;
  v_new integer;
  v_label text;
  v_new_cost numeric(12, 2);
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'Agregá al menos un artículo.', hint = 'INVALID_LINES';
  end if;

  for v_elem in select e.value from jsonb_array_elements(p_lines) as e loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception using errcode = 'P0001', message = 'Hay un artículo con un formato que no se entiende.', hint = 'INVALID_LINES';
    end if;

    begin
      v_sid := (v_elem ->> 'supply_id')::uuid;
      v_qty := (v_elem ->> 'qty_delta')::numeric;
      v_cost := (v_elem ->> 'unit_cost')::numeric;
      v_sale := (v_elem ->> 'unit_sale')::numeric;
      perform (v_elem ->> 'update_cost')::boolean;
    exception when others then
      raise exception using errcode = 'P0001', message = 'Hay un artículo, una cantidad o un costo con un formato que no se entiende.', hint = 'INVALID_LINES';
    end;

    if v_sid is null then
      raise exception using errcode = 'P0001', message = 'Falta indicar el artículo de una de las líneas.', hint = 'INVALID_LINES';
    end if;

    if v_qty is null or v_qty = 0 or v_qty <> trunc(v_qty) or abs(v_qty) > 1000000 then
      raise exception using errcode = 'P0001', message = 'Las cantidades tienen que ser números enteros distintos de cero.', hint = 'INVALID_QTY';
    end if;

    if (p_kind in ('entry', 'return') and v_qty < 0) or (p_kind = 'withdrawal' and v_qty > 0) then
      raise exception using errcode = 'P0001', message = 'La cantidad tiene el signo equivocado para este tipo de movimiento.', hint = 'INVALID_QTY';
    end if;

    if (v_cost is not null and (v_cost < 0 or v_cost <> round(v_cost, 2)))
       or (v_sale is not null and (v_sale < 0 or v_sale <> round(v_sale, 2))) then
      raise exception using errcode = 'P0001', message = 'Los precios tienen que ser mayores o iguales a cero y con hasta dos decimales.', hint = 'INVALID_PRICE';
    end if;

    if v_sid = any (v_ids) then
      raise exception using errcode = 'P0001', message = 'Un artículo no puede repetirse en el mismo movimiento.', hint = 'DUPLICATE_SUPPLY';
    end if;
    v_ids := v_ids || v_sid;
  end loop;

  insert into public.stock_movements (
    kind, recorded_at, recorded_by, person_id, shift_id, site_id, supplier, document_number,
    reason, note, count_id, reverses_id
  )
  values (
    p_kind, coalesce(p_recorded_at, now()), p_actor, p_person_id, p_shift_id, p_site_id,
    nullif(btrim(p_supplier), ''), nullif(btrim(p_document_number), ''),
    p_reason, nullif(btrim(p_note), ''), p_count_id, p_reverses_id
  )
  returning id into v_movement_id;

  -- Bloqueo en orden de id (order by + for update): dos movimientos simultáneos que tocan los
  -- mismos artículos se serializan sin deadlock, y el segundo calcula sobre el stock ya
  -- descontado por el primero.
  for r in
    select s.id, s.name, s.presentation, s.stock_qty, s.cost_price, s.sale_price, s.active,
           x.qty_delta, x.unit_cost as x_cost, x.unit_sale as x_sale, x.update_cost
    from jsonb_to_recordset(p_lines) as x (supply_id uuid, qty_delta numeric, unit_cost numeric, unit_sale numeric, update_cost boolean)
    join public.supplies s on s.id = x.supply_id
    order by s.id
    for update of s
  loop
    v_found := v_found + 1;
    v_label := r.name || coalesce(' ' || nullif(btrim(r.presentation), ''), '');

    if p_mode = 'normal' and p_kind in ('entry', 'return', 'withdrawal', 'adjustment') and not r.active then
      raise exception using errcode = 'P0001',
        message = format('El artículo %s está desactivado.', v_label),
        hint = 'SUPPLY_INACTIVE';
    end if;

    v_new := r.stock_qty + r.qty_delta::integer;

    if v_new < 0 then
      if p_mode = 'void' then
        raise exception using errcode = 'P0001',
          message = format('No se puede anular: el stock de %s (hay %s) no alcanza para revertir este movimiento.', v_label, r.stock_qty),
          hint = 'VOID_INSUFFICIENT_STOCK';
      elsif p_mode = 'count' then
        raise exception using errcode = 'P0001',
          message = format('El control deja el stock de %s en negativo al sumar los movimientos posteriores a la hora indicada. Revisá la hora o la cantidad contada.', v_label),
          hint = 'COUNT_INCONSISTENT';
      elsif app.is_admin() then
        raise exception using errcode = 'P0001',
          message = format('No alcanza el stock de %s: hay %s y se quieren sacar %s.', v_label, r.stock_qty, abs(r.qty_delta::integer)),
          hint = 'INSUFFICIENT_STOCK';
      else
        -- Empleados y coordinadores no ven cuánto hay (IS-20, IS-28).
        raise exception using errcode = 'P0001',
          message = format('No alcanza el stock de %s. Consultá en la oficina.', v_label),
          hint = 'INSUFFICIENT_STOCK';
      end if;
    end if;

    v_new_cost := r.cost_price;
    if coalesce(r.update_cost, false) and p_kind in ('entry', 'return')
       and r.x_cost is not null and r.x_cost <> r.cost_price then
      v_new_cost := r.x_cost;
      perform app.supply_log_price_change(r.id, r.cost_price, v_new_cost, r.sale_price, r.sale_price, 'entry', p_actor);
    end if;

    insert into public.stock_movement_lines (movement_id, supply_id, qty_delta, unit_cost, unit_sale, stock_after)
    values (
      v_movement_id, r.id, r.qty_delta::integer,
      coalesce(r.x_cost, r.cost_price), coalesce(r.x_sale, r.sale_price), v_new
    );

    update public.supplies
    set stock_qty = v_new, cost_price = v_new_cost, updated_by = p_actor
    where id = r.id;
  end loop;

  if v_found <> jsonb_array_length(p_lines) then
    raise exception using errcode = 'P0001', message = 'Alguno de los artículos no existe.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  return v_movement_id;
end;
$$;

comment on function app.stock_post_movement(public.stock_movement_kind, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text, text, public.stock_adjustment_reason, text, uuid, uuid) is
  'Núcleo del módulo E (0070): crea un movimiento con sus líneas y actualiza supplies.stock_qty con los artículos bloqueados en orden de id. No valida permisos ni reglas por tipo: las RPC públicas lo hacen antes. Guarda en cada línea el costo y la venta del momento (IS-22). Errores: INVALID_LINES, INVALID_QTY, INVALID_PRICE, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE, INSUFFICIENT_STOCK (sin la cantidad para quien no es administración, IS-20), VOID_INSUFFICIENT_STOCK, COUNT_INCONSISTENT. Interna: no se expone a authenticated.';

revoke execute on function app.stock_post_movement(public.stock_movement_kind, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text, text, public.stock_adjustment_reason, text, uuid, uuid) from public, anon, authenticated;

-- 3.4 Respuesta de las RPC de movimientos: {"movement": <cabecera>, "lines": [...]}. Con precios y
--     stock resultante solo cuando la pide quien tiene que verlos (administración).
create function app.stock_movement_json(p_movement_id uuid, p_with_prices boolean)
returns jsonb
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'movement', to_jsonb(m),
    'lines', coalesce((
      select jsonb_agg(
        case when p_with_prices then
          jsonb_build_object(
            'supply_id', s.id, 'code', s.code, 'name', s.name, 'presentation', s.presentation,
            'qty_delta', l.qty_delta, 'unit_cost', l.unit_cost, 'unit_sale', l.unit_sale, 'stock_after', l.stock_after
          )
        else
          jsonb_build_object(
            'supply_id', s.id, 'code', s.code, 'name', s.name, 'presentation', s.presentation,
            'qty', abs(l.qty_delta), 'qty_delta', l.qty_delta
          )
        end
        order by s.name, s.code
      )
      from public.stock_movement_lines l
      join public.supplies s on s.id = l.supply_id
      where l.movement_id = m.id
    ), '[]'::jsonb)
  )
  from public.stock_movements m
  where m.id = p_movement_id;
$$;

comment on function app.stock_movement_json(uuid, boolean) is
  'Arma {"movement", "lines"} de un movimiento para devolver desde las RPC (0070). Con p_with_prices = false (retiros) las líneas llevan solo artículo y cantidad, sin precios ni stock resultante (IS-20). Interna.';

revoke execute on function app.stock_movement_json(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Funciones de definidor para empleados y coordinadores (IS-20, IS-28)
-- ---------------------------------------------------------------------------------------------

-- 4.1 Catálogo sin precios ni cantidades: solo artículos activos y out_of_stock.
create function app.supply_catalog()
returns table (
  id uuid,
  code text,
  name text,
  presentation text,
  category_id uuid,
  category_name text,
  category_sort_order integer,
  image_path text,
  out_of_stock boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    s.id,
    s.code,
    s.name,
    s.presentation,
    s.category_id,
    c.name,
    c.sort_order,
    s.image_path,
    (s.stock_qty = 0)
  from public.supplies s
  join public.supply_categories c on c.id = s.category_id
  where app.current_uid() is not null
    and (app.is_admin() or app.has_role('employee') or app.has_role('supervisor'))
    and s.active
  order by c.sort_order, c.name, s.name, s.code;
$$;

comment on function app.supply_catalog() is
  'Catálogo de insumos activos para empleados, coordinadores y administración (0070, IS-20): sin precios, sin cantidades y sin mínimos; solo out_of_stock. Definidor: lee supplies sin pasar por la RLS, que es solo de administración. Interna: la lee v_supply_catalog.';

revoke execute on function app.supply_catalog() from public, anon;
grant execute on function app.supply_catalog() to authenticated, service_role;

-- 4.2 Turnos que puede elegir quien retira (IS-28). Empleado: los suyos (asignación vigente) de
--     hoy y los próximos 7 días. Coordinador (rol supervisor): todos de hoy y los próximos 7
--     días, con «Mis sedes» primero (CJ-25). Administración que no es ni empleado ni coordinador
--     (retiro en nombre de otra persona): todos, de 30 días atrás a 7 adelante.
create function app.withdrawal_shift_options()
returns table (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  open_ended boolean,
  shift_status public.shift_status,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  is_assigned boolean,
  priority_kind text,
  is_priority boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with me as (
    select
      app.current_uid() as uid,
      app.has_role('supervisor') as is_coord,
      app.has_role('employee') as is_emp,
      app.is_admin() as is_adm
  )
  select
    sh.id,
    sh.shift_date,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.open_ended,
    sh.status,
    sh.client_id,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name),
    sh.site_id,
    si.name,
    (
      exists (
        select 1 from public.assignments a
        where a.shift_id = sh.id and a.employee_id = me.uid and a.removed_at is null
      )
      or exists (
        select 1 from public.supervisions sv
        where sv.shift_id = sh.id and sv.supervisor_id = me.uid and sv.status <> 'cancelled'
      )
    ),
    pr.kind,
    (pr.kind is not null)
  from me
  cross join public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  left join lateral (
    select case
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = me.uid and sp.removed_at is null and sp.site_id = sh.site_id
      ) then 'site'
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = me.uid and sp.removed_at is null and sp.client_id = sh.client_id
      ) then 'client'
    end as kind
  ) pr on true
  where me.uid is not null
    and sh.deleted_at is null
    and sh.status <> 'cancelled'
    and (
      (me.is_coord and sh.shift_date between app.today() and app.today() + 7)
      or (
        not me.is_coord and me.is_emp
        and sh.shift_date between app.today() and app.today() + 7
        and exists (
          select 1 from public.assignments a
          where a.shift_id = sh.id and a.employee_id = me.uid and a.removed_at is null
        )
      )
      or (
        not me.is_coord and not me.is_emp and me.is_adm
        and sh.shift_date between app.today() - 30 and app.today() + 7
      )
    )
  order by (pr.kind is not null) desc, sh.shift_date, sh.start_time, 9, 11;
$$;

comment on function app.withdrawal_shift_options() is
  'Turnos que la sesión puede elegir al retirar insumos o avisar un faltante (0070, IS-28). Empleado: sus turnos (asignación vigente) de hoy a +7 días. Coordinador: todos de hoy a +7 días, con is_priority (Mis sedes, CJ-25) primero. Administración sin rol de empleado ni coordinador: todos de -30 a +7 días. Sin turnos cancelados ni dados de baja. Definidor. Interna: la lee v_withdrawal_shift_options y la usan las RPC para validar.';

revoke execute on function app.withdrawal_shift_options() from public, anon;
grant execute on function app.withdrawal_shift_options() to authenticated, service_role;

-- 4.3 Sedes que se pueden elegir cuando el retiro no es de un turno puntual (IS-12). Coordinador y
--     administración: todas las sedes activas. Empleado: las sedes donde tiene o tuvo asignaciones.
create function app.withdrawal_site_options()
returns table (
  site_id uuid,
  site_name text,
  client_id uuid,
  client_name text,
  priority_kind text,
  is_priority boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  with me as (
    select
      app.current_uid() as uid,
      app.has_role('supervisor') as is_coord,
      app.has_role('employee') as is_emp,
      app.is_admin() as is_adm
  )
  select
    si.id,
    si.name,
    si.client_id,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name),
    pr.kind,
    (pr.kind is not null)
  from me
  cross join public.sites si
  join public.clients cl on cl.id = si.client_id
  left join lateral (
    select case
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = me.uid and sp.removed_at is null and sp.site_id = si.id
      ) then 'site'
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = me.uid and sp.removed_at is null and sp.client_id = si.client_id
      ) then 'client'
    end as kind
  ) pr on true
  where me.uid is not null
    and si.deleted_at is null and si.status = 'active'
    and cl.deleted_at is null and cl.status = 'active'
    and (
      me.is_coord
      or (not me.is_emp and me.is_adm)
      or (
        me.is_emp
        and exists (
          select 1
          from public.assignments a
          join public.shifts sh on sh.id = a.shift_id
          where a.employee_id = me.uid and a.removed_at is null
            and sh.site_id = si.id and sh.deleted_at is null
        )
      )
    )
  order by (pr.kind is not null) desc, 4, 2;
$$;

comment on function app.withdrawal_site_options() is
  'Sedes que la sesión puede elegir al retirar sin turno puntual o al avisar un faltante (0070, IS-12, IS-28). Coordinador y administración: todas las sedes activas de clientes activos, con is_priority primero. Empleado: las sedes de sus asignaciones. Definidor. Interna: la lee v_withdrawal_site_options y la usan las RPC para validar.';

revoke execute on function app.withdrawal_site_options() from public, anon;
grant execute on function app.withdrawal_site_options() to authenticated, service_role;

-- 4.4 Mis retiros (IS-20): los retiros donde la sesión es quien retira, con sus líneas sin precios.
create function app.my_withdrawals()
returns table (
  movement_id uuid,
  recorded_at timestamptz,
  recorded_by uuid,
  registered_by_name text,
  on_behalf boolean,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  note text,
  voided_at timestamptz,
  void_reason text,
  total_qty integer,
  lines jsonb
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    m.id,
    m.recorded_at,
    m.recorded_by,
    case when m.recorded_by <> m.person_id then pr.first_name || ' ' || pr.last_name end,
    (m.recorded_by <> m.person_id),
    m.shift_id,
    sh.shift_date,
    sh.start_time,
    sh.end_time,
    si.client_id,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name),
    m.site_id,
    si.name,
    m.note,
    m.voided_at,
    m.void_reason,
    (select coalesce(sum(-l.qty_delta), 0)::integer from public.stock_movement_lines l where l.movement_id = m.id),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('supply_id', s.id, 'code', s.code, 'name', s.name, 'presentation', s.presentation, 'qty', -l.qty_delta)
        order by s.name, s.code
      )
      from public.stock_movement_lines l
      join public.supplies s on s.id = l.supply_id
      where l.movement_id = m.id
    ), '[]'::jsonb)
  from public.stock_movements m
  join public.sites si on si.id = m.site_id
  join public.clients cl on cl.id = si.client_id
  left join public.shifts sh on sh.id = m.shift_id
  left join public.profiles pr on pr.id = m.recorded_by
  where m.kind = 'withdrawal'
    and m.person_id = app.current_uid()
  order by m.recorded_at desc;
$$;

comment on function app.my_withdrawals() is
  'Retiros de insumos de la sesión (0070, IS-20): solo donde person_id es quien consulta, con artículo y cantidad pero sin precios ni stock. Incluye los anulados (voided_at) y los que cargó la administración en nombre de la persona (on_behalf). Definidor. Interna: la lee v_my_withdrawals.';

revoke execute on function app.my_withdrawals() from public, anon;
grant execute on function app.my_withdrawals() to authenticated, service_role;

-- 4.5 Mis avisos de faltante (IS-29).
create function app.my_shortage_reports()
returns table (
  id uuid,
  supply_id uuid,
  supply_code text,
  supply_name text,
  description text,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  site_id uuid,
  site_name text,
  client_name text,
  comment text,
  status public.supply_shortage_status,
  created_at timestamptz,
  resolved_at timestamptz,
  resolved_by_name text,
  resolution_note text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    r.id,
    r.supply_id,
    s.code,
    s.name || coalesce(' ' || nullif(btrim(s.presentation), ''), ''),
    r.description,
    r.shift_id,
    sh.shift_date,
    sh.start_time,
    sh.end_time,
    r.site_id,
    si.name,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name),
    r.comment,
    r.status,
    r.created_at,
    r.resolved_at,
    rp.first_name || ' ' || rp.last_name,
    r.resolution_note
  from public.supply_shortage_reports r
  left join public.supplies s on s.id = r.supply_id
  left join public.shifts sh on sh.id = r.shift_id
  left join public.sites si on si.id = r.site_id
  left join public.clients cl on cl.id = si.client_id
  left join public.profiles rp on rp.id = r.resolved_by
  where r.reported_by = app.current_uid()
  order by (r.status = 'open') desc, r.created_at desc;
$$;

comment on function app.my_shortage_reports() is
  'Avisos de faltante de la sesión (0070, IS-29): abiertos primero, con el estado y la nota de resolución. Definidor (lee supplies, que es solo de administración). Interna: la lee v_my_shortage_reports.';

revoke execute on function app.my_shortage_reports() from public, anon;
grant execute on function app.my_shortage_reports() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4 bis. Auxiliares de las RPC
-- ---------------------------------------------------------------------------------------------

-- Pasa las líneas que manda el cliente ({supply_id, qty, unit_cost?, update_cost?}, cantidad
-- positiva) al formato del núcleo ({supply_id, qty_delta con signo, ...}). p_keep_cost deja pasar
-- el costo unitario y la marca de actualizar el costo (solo el ingreso); en un retiro el cliente
-- no puede mandar precios.
create function app.stock_lines_normalize(p_lines jsonb, p_sign integer, p_keep_cost boolean)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_e jsonb;
  v_o jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'Agregá al menos un artículo.', hint = 'INVALID_LINES';
  end if;

  for v_e in select e.value from jsonb_array_elements(p_lines) as e loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception using errcode = 'P0001', message = 'Hay un artículo con un formato que no se entiende.', hint = 'INVALID_LINES';
    end if;

    begin
      v_o := jsonb_build_object(
        'supply_id', v_e -> 'supply_id',
        'qty_delta', to_jsonb(p_sign * (v_e ->> 'qty')::numeric)
      );
    exception when others then
      raise exception using errcode = 'P0001', message = 'Hay una cantidad con un formato que no se entiende.', hint = 'INVALID_LINES';
    end;

    if p_keep_cost then
      v_o := v_o || jsonb_build_object('unit_cost', v_e -> 'unit_cost', 'update_cost', v_e -> 'update_cost');
    end if;

    v_out := v_out || jsonb_build_array(v_o);
  end loop;

  return v_out;
end;
$$;

comment on function app.stock_lines_normalize(jsonb, integer, boolean) is
  'Convierte las líneas {supply_id, qty, unit_cost?, update_cost?} que manda el cliente al formato del núcleo (qty_delta con signo). Interna (0070).';

revoke execute on function app.stock_lines_normalize(jsonb, integer, boolean) from public, anon, authenticated;

-- Resuelve el lugar de un retiro o de un aviso: devuelve la sede (la del turno si hay turno) o
-- null si no se indicó nada. p_restricted = true limita a lo que la sesión puede elegir (IS-28:
-- v_withdrawal_shift_options / v_withdrawal_site_options); false es la administración cargando en
-- nombre de otra persona, que puede usar cualquier turno vigente o sede activa.
create function app.resolve_stock_place(p_shift_id uuid, p_site_id uuid, p_restricted boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;

    if v_shift.id is null then
      raise exception using errcode = 'P0001', message = 'El turno no existe.', hint = 'SHIFT_NOT_FOUND';
    end if;

    if v_shift.status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'El turno está cancelado.', hint = 'SHIFT_NOT_AVAILABLE';
    end if;

    if p_restricted and not exists (
      select 1 from app.withdrawal_shift_options() o where o.shift_id = p_shift_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'Ese turno no está entre los que podés elegir (hoy y los próximos 7 días).',
        hint = 'SHIFT_NOT_ALLOWED';
    end if;

    if p_site_id is not null and p_site_id <> v_shift.site_id then
      raise exception using errcode = 'P0001', message = 'La sede no es la del turno elegido.', hint = 'SITE_SHIFT_MISMATCH';
    end if;

    return v_shift.site_id;
  end if;

  if p_site_id is not null then
    if not exists (
      select 1
      from public.sites si
      join public.clients cl on cl.id = si.client_id
      where si.id = p_site_id and si.deleted_at is null and si.status = 'active'
        and cl.deleted_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'La sede no existe o está inactiva.', hint = 'SITE_NOT_FOUND';
    end if;

    if p_restricted and not exists (
      select 1 from app.withdrawal_site_options() o where o.site_id = p_site_id
    ) then
      raise exception using errcode = 'P0001', message = 'Esa sede no está entre las que podés elegir.', hint = 'SITE_NOT_ALLOWED';
    end if;

    return p_site_id;
  end if;

  return null;
end;
$$;

comment on function app.resolve_stock_place(uuid, uuid, boolean) is
  'Valida el turno o la sede de un retiro o de un aviso de faltante y devuelve la sede (0070, IS-12, IS-28). Errores: SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED. Interna.';

revoke execute on function app.resolve_stock_place(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. RPC de catálogo (IS-01, IS-21, IS-26)
-- ---------------------------------------------------------------------------------------------

-- upsert_supply: alta (sin p_id, o con un id que todavía no existe: el cliente puede generarlo
-- para subir la imagen antes) o edición. Los precios solo se fijan en el alta (el costo y la venta
-- iniciales, por defecto 0); para cambiarlos después está set_supply_prices. Tampoco toca el
-- stock ni el estado activo.
create function public.upsert_supply(
  p_code text,
  p_name text,
  p_category_id uuid,
  p_presentation text default null,
  p_min_qty integer default null,
  p_cost_price numeric default null,
  p_sale_price numeric default null,
  p_notes text default null,
  p_image_path text default null,
  p_id uuid default null
)
returns public.supplies
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_code text := nullif(btrim(p_code), '');
  v_name text := nullif(btrim(p_name), '');
  v_old public.supplies;
  v_cat public.supply_categories;
  v_row public.supplies;
begin
  perform app.require_capability('manage_stock');

  if v_code is null then
    raise exception using errcode = 'P0001', message = 'Indicá el código interno.', hint = 'CODE_REQUIRED';
  end if;
  if v_name is null then
    raise exception using errcode = 'P0001', message = 'Indicá el nombre del artículo.', hint = 'NAME_REQUIRED';
  end if;
  if p_min_qty is not null and p_min_qty < 0 then
    raise exception using errcode = 'P0001', message = 'El stock mínimo no puede ser negativo.', hint = 'INVALID_MIN_QTY';
  end if;
  if (p_cost_price is not null and (p_cost_price < 0 or p_cost_price <> round(p_cost_price, 2)))
     or (p_sale_price is not null and (p_sale_price < 0 or p_sale_price <> round(p_sale_price, 2))) then
    raise exception using errcode = 'P0001', message = 'Los precios tienen que ser mayores o iguales a cero y con hasta dos decimales.', hint = 'INVALID_PRICE';
  end if;
  if p_image_path is not null and (left(p_image_path, length(v_id::text) + 1) <> v_id::text || '/' or length(p_image_path) > 300) then
    raise exception using errcode = 'P0001', message = 'La imagen tiene que estar en la carpeta del artículo.', hint = 'INVALID_IMAGE_PATH';
  end if;

  select * into v_cat from public.supply_categories where id = p_category_id;
  if v_cat.id is null then
    raise exception using errcode = 'P0001', message = 'La categoría no existe.', hint = 'CATEGORY_NOT_FOUND';
  end if;

  select * into v_old from public.supplies where id = v_id for update;

  if v_old.id is not null and v_old.category_id <> p_category_id and not v_cat.active then
    raise exception using errcode = 'P0001', message = 'La categoría está desactivada.', hint = 'CATEGORY_INACTIVE';
  end if;
  if v_old.id is null and not v_cat.active then
    raise exception using errcode = 'P0001', message = 'La categoría está desactivada.', hint = 'CATEGORY_INACTIVE';
  end if;

  begin
    if v_old.id is null then
      insert into public.supplies (
        id, code, name, presentation, category_id, image_path, min_qty, cost_price, sale_price, notes, created_by
      )
      values (
        v_id, v_code, v_name, nullif(btrim(p_presentation), ''), p_category_id, p_image_path, p_min_qty,
        coalesce(p_cost_price, 0), coalesce(p_sale_price, 0), nullif(btrim(p_notes), ''), auth.uid()
      )
      returning * into v_row;

      perform app.supply_log_price_change(v_row.id, null, v_row.cost_price, null, v_row.sale_price, 'create', auth.uid());
    else
      update public.supplies
      set code = v_code,
          name = v_name,
          presentation = nullif(btrim(p_presentation), ''),
          category_id = p_category_id,
          image_path = p_image_path,
          min_qty = p_min_qty,
          notes = nullif(btrim(p_notes), ''),
          updated_by = auth.uid()
      where id = v_id
      returning * into v_row;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'Ya existe un artículo con ese código.', hint = 'CODE_ALREADY_EXISTS';
  end;

  return v_row;
end;
$$;

comment on function public.upsert_supply(text, text, uuid, text, integer, numeric, numeric, text, text, uuid) is
  'Alta o edición de un artículo (0070, IS-01, IS-02, IS-26). Exige manage_stock (O; A + manage_stock). Sin p_id (o con un id nuevo) crea; con el id de uno existente lo edita con TODOS los campos que llegan (p_presentation, p_min_qty, p_notes y p_image_path en null los vacían). Los precios (p_cost_price, p_sale_price) solo cuentan en el alta; después se cambian con set_supply_prices. No toca stock ni active. p_image_path, si viene, empieza con «{id}/». Devuelve la fila de supplies. Errores: FORBIDDEN, CODE_REQUIRED, NAME_REQUIRED, INVALID_MIN_QTY, INVALID_PRICE, INVALID_IMAGE_PATH, CATEGORY_NOT_FOUND, CATEGORY_INACTIVE, CODE_ALREADY_EXISTS (sin distinguir mayúsculas).';

revoke execute on function public.upsert_supply(text, text, uuid, text, integer, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.upsert_supply(text, text, uuid, text, integer, numeric, numeric, text, text, uuid) to authenticated, service_role;

create function public.set_supply_active(p_supply_id uuid, p_active boolean)
returns public.supplies
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.supplies;
  v_cat_active boolean;
begin
  perform app.require_capability('manage_stock');

  if p_active is null then
    raise exception using errcode = 'P0001', message = 'Indicá si el artículo queda activo o desactivado.', hint = 'INVALID_ACTIVE';
  end if;

  select * into v_row from public.supplies where id = p_supply_id for update;
  if v_row.id is null then
    raise exception using errcode = 'P0001', message = 'El artículo no existe.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  if v_row.active = p_active then
    return v_row;
  end if;

  if not p_active and v_row.stock_qty <> 0 then
    raise exception using errcode = 'P0001',
      message = 'Para desactivar el artículo, primero ajustá el stock a cero.',
      hint = 'STOCK_NOT_ZERO';
  end if;

  if p_active then
    select c.active into v_cat_active from public.supply_categories c where c.id = v_row.category_id;
    if not coalesce(v_cat_active, false) then
      raise exception using errcode = 'P0001', message = 'La categoría del artículo está desactivada.', hint = 'CATEGORY_INACTIVE';
    end if;
  end if;

  update public.supplies set active = p_active, updated_by = auth.uid()
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_supply_active(uuid, boolean) is
  'Activa o desactiva un artículo (0070, IS-26). Exige manage_stock. Para desactivar el stock tiene que estar en cero. Devuelve la fila. Errores: FORBIDDEN, INVALID_ACTIVE, SUPPLY_NOT_FOUND, STOCK_NOT_ZERO, CATEGORY_INACTIVE (al reactivar).';

revoke execute on function public.set_supply_active(uuid, boolean) from public, anon;
grant execute on function public.set_supply_active(uuid, boolean) to authenticated, service_role;

create function public.set_supply_prices(p_supply_id uuid, p_cost_price numeric, p_sale_price numeric)
returns public.supplies
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.supplies;
  v_old public.supplies;
begin
  perform app.require_capability('manage_stock');

  if p_cost_price is null or p_sale_price is null
     or p_cost_price < 0 or p_sale_price < 0
     or p_cost_price <> round(p_cost_price, 2) or p_sale_price <> round(p_sale_price, 2) then
    raise exception using errcode = 'P0001', message = 'Los precios tienen que ser mayores o iguales a cero y con hasta dos decimales.', hint = 'INVALID_PRICE';
  end if;

  select * into v_old from public.supplies where id = p_supply_id for update;
  if v_old.id is null then
    raise exception using errcode = 'P0001', message = 'El artículo no existe.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  if v_old.cost_price = p_cost_price and v_old.sale_price = p_sale_price then
    return v_old;
  end if;

  update public.supplies
  set cost_price = p_cost_price, sale_price = p_sale_price, updated_by = auth.uid()
  where id = v_old.id
  returning * into v_row;

  perform app.supply_log_price_change(
    v_old.id, v_old.cost_price, v_row.cost_price, v_old.sale_price, v_row.sale_price, 'manual', auth.uid()
  );

  return v_row;
end;
$$;

comment on function public.set_supply_prices(uuid, numeric, numeric) is
  'Cambia el costo y la venta de un artículo (0070, IS-06, IS-22, IS-34). Exige manage_stock. Si no cambia ninguno no escribe nada. Cada cambio queda en supply_price_changes y en security_events (supply_price_changed). Lo ya movido no se recalcula: cada línea guardó el precio del momento. Devuelve la fila. Errores: FORBIDDEN, INVALID_PRICE, SUPPLY_NOT_FOUND.';

revoke execute on function public.set_supply_prices(uuid, numeric, numeric) from public, anon;
grant execute on function public.set_supply_prices(uuid, numeric, numeric) to authenticated, service_role;

create function public.upsert_supply_category(
  p_name text,
  p_sort_order integer default 0,
  p_active boolean default true,
  p_id uuid default null
)
returns public.supply_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_old public.supply_categories;
  v_row public.supply_categories;
begin
  perform app.require_capability('manage_stock');

  if v_name is null then
    raise exception using errcode = 'P0001', message = 'Indicá el nombre de la categoría.', hint = 'NAME_REQUIRED';
  end if;
  if p_active is null or p_sort_order is null then
    raise exception using errcode = 'P0001', message = 'Faltan datos de la categoría.', hint = 'INVALID_CATEGORY';
  end if;

  if p_id is not null then
    select * into v_old from public.supply_categories where id = p_id for update;
    if v_old.id is null then
      raise exception using errcode = 'P0001', message = 'La categoría no existe.', hint = 'CATEGORY_NOT_FOUND';
    end if;

    if v_old.active and not p_active and exists (
      select 1 from public.supplies s where s.category_id = p_id and s.active
    ) then
      raise exception using errcode = 'P0001',
        message = 'La categoría tiene artículos activos. Pasalos a otra categoría o desactivalos antes.',
        hint = 'CATEGORY_IN_USE';
    end if;
  end if;

  begin
    if v_old.id is null then
      insert into public.supply_categories (name, sort_order, active, created_by)
      values (v_name, p_sort_order, p_active, auth.uid())
      returning * into v_row;
    else
      update public.supply_categories
      set name = v_name, sort_order = p_sort_order, active = p_active, updated_by = auth.uid()
      where id = p_id
      returning * into v_row;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'Ya existe una categoría con ese nombre.', hint = 'CATEGORY_NAME_EXISTS';
  end;

  return v_row;
end;
$$;

comment on function public.upsert_supply_category(text, integer, boolean, uuid) is
  'Alta (sin p_id) o edición de una categoría (0070, IS-03). Exige manage_stock. Desactivar pide que no queden artículos activos en la categoría. Devuelve la fila. Errores: FORBIDDEN, NAME_REQUIRED, INVALID_CATEGORY, CATEGORY_NOT_FOUND, CATEGORY_IN_USE, CATEGORY_NAME_EXISTS.';

revoke execute on function public.upsert_supply_category(text, integer, boolean, uuid) from public, anon;
grant execute on function public.upsert_supply_category(text, integer, boolean, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. RPC de movimientos (IS-09 a IS-13, IS-22, IS-23, IS-27, IS-28)
-- ---------------------------------------------------------------------------------------------

-- register_stock_entry: ingreso (o devolución, IS-08). Proveedor, comprobante y nota son
-- opcionales (IS-09). Cada línea: {supply_id, qty (entero > 0), unit_cost? (opcional),
-- update_cost? (true: además de guardar el costo en la línea, lo vuelve el costo vigente, IS-23)}.
create function public.register_stock_entry(
  p_lines jsonb,
  p_supplier text default null,
  p_document_number text default null,
  p_note text default null,
  p_kind public.stock_movement_kind default 'entry'
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid;
begin
  perform app.require_capability('manage_stock');

  if p_kind is null or p_kind not in ('entry', 'return') then
    raise exception using errcode = 'P0001', message = 'El tipo tiene que ser ingreso o devolución.', hint = 'INVALID_KIND';
  end if;

  v_id := app.stock_post_movement(
    p_kind, auth.uid(), app.stock_lines_normalize(p_lines, 1, true),
    p_supplier => p_supplier, p_document_number => p_document_number, p_note => p_note
  );

  return app.stock_movement_json(v_id, true);
end;
$$;

comment on function public.register_stock_entry(jsonb, text, text, text, public.stock_movement_kind) is
  'Registra un ingreso o una devolución de stock (0070, IS-08, IS-09, IS-22, IS-23). Exige manage_stock. p_lines: [{supply_id, qty (entero > 0), unit_cost? (costo unitario, opcional), update_cost? (true actualiza el costo vigente del artículo si es distinto)}]. p_kind: entry (por defecto) o return. Proveedor, comprobante y nota opcionales. Cada línea guarda el costo (el indicado o el vigente) y la venta del momento. Devuelve {"movement": <cabecera>, "lines": [{supply_id, code, name, presentation, qty_delta, unit_cost, unit_sale, stock_after}]}. Errores: FORBIDDEN, INVALID_KIND, INVALID_LINES, INVALID_QTY, INVALID_PRICE, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE.';

revoke execute on function public.register_stock_entry(jsonb, text, text, text, public.stock_movement_kind) from public, anon;
grant execute on function public.register_stock_entry(jsonb, text, text, text, public.stock_movement_kind) to authenticated, service_role;

create function public.adjust_stock(
  p_supply_id uuid,
  p_delta integer,
  p_reason public.stock_adjustment_reason,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid;
begin
  perform app.require_capability('manage_stock');

  if p_supply_id is null then
    raise exception using errcode = 'P0001', message = 'Elegí el artículo.', hint = 'SUPPLY_NOT_FOUND';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception using errcode = 'P0001', message = 'La cantidad del ajuste tiene que ser un entero distinto de cero.', hint = 'INVALID_QTY';
  end if;
  if p_reason is null then
    raise exception using errcode = 'P0001', message = 'Elegí el motivo del ajuste.', hint = 'REASON_REQUIRED';
  end if;
  if p_reason = 'other' and nullif(btrim(p_note), '') is null then
    raise exception using errcode = 'P0001', message = 'Con el motivo «Otro» tenés que escribir una observación.', hint = 'NOTE_REQUIRED';
  end if;

  v_id := app.stock_post_movement(
    'adjustment', auth.uid(),
    jsonb_build_array(jsonb_build_object('supply_id', p_supply_id, 'qty_delta', p_delta)),
    p_reason => p_reason, p_note => p_note
  );

  return app.stock_movement_json(v_id, true);
end;
$$;

comment on function public.adjust_stock(uuid, integer, public.stock_adjustment_reason, text) is
  'Ajusta el stock de un artículo con un movimiento «adjustment» (+ o −), motivo obligatorio (0070, IS-10). Exige manage_stock. Con el motivo other la nota es obligatoria. Devuelve {"movement", "lines"} como register_stock_entry. Errores: FORBIDDEN, SUPPLY_NOT_FOUND, INVALID_QTY, REASON_REQUIRED, NOTE_REQUIRED, SUPPLY_INACTIVE, INSUFFICIENT_STOCK (el ajuste negativo no puede dejar el stock bajo cero).';

revoke execute on function public.adjust_stock(uuid, integer, public.stock_adjustment_reason, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, public.stock_adjustment_reason, text) to authenticated, service_role;

-- register_withdrawal: retiro (IS-11 a IS-13, IS-28). Sin p_person_id (o el propio) retira la
-- sesión: tiene que ser empleado o coordinador, y solo puede elegir los turnos y sedes de
-- v_withdrawal_shift_options / v_withdrawal_site_options. Con p_person_id de otra persona carga la
-- administración en su nombre: exige manage_stock y puede usar cualquier turno vigente o sede
-- activa. Sin turno, la sede lleva una observación obligatoria.
create function public.register_withdrawal(
  p_lines jsonb,
  p_shift_id uuid default null,
  p_site_id uuid default null,
  p_note text default null,
  p_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := app.current_uid();
  v_self boolean;
  v_person uuid;
  v_site uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'No tenés permiso para hacer esto.', hint = 'FORBIDDEN';
  end if;

  v_self := (p_person_id is null or p_person_id = v_uid);

  if v_self then
    if not (app.has_role('employee') or app.has_role('supervisor')) then
      if app.is_admin() then
        raise exception using errcode = 'P0001', message = 'Indicá quién retira.', hint = 'PERSON_REQUIRED';
      end if;
      raise exception using errcode = 'P0001', message = 'No tenés permiso para hacer esto.', hint = 'FORBIDDEN';
    end if;
    v_person := v_uid;
  else
    perform app.require_capability('manage_stock');

    if not exists (
      select 1
      from public.profiles p
      where p.id = p_person_id and p.is_active and p.deleted_at is null
        and exists (
          select 1 from public.user_roles ur
          where ur.profile_id = p.id and ur.role in ('employee', 'supervisor')
        )
    ) then
      raise exception using errcode = 'P0001',
        message = 'La persona no existe, está inactiva o no es empleado ni coordinador.',
        hint = 'PERSON_NOT_FOUND';
    end if;
    v_person := p_person_id;
  end if;

  if p_shift_id is null and p_site_id is null then
    raise exception using errcode = 'P0001', message = 'Elegí el turno o la sede para la que retirás.', hint = 'SHIFT_OR_SITE_REQUIRED';
  end if;

  v_site := app.resolve_stock_place(p_shift_id, p_site_id, v_self);

  if p_shift_id is null and nullif(btrim(p_note), '') is null then
    raise exception using errcode = 'P0001',
      message = 'Si no elegís un turno, escribí una observación (por ejemplo, «reposición de la semana»).',
      hint = 'NOTE_REQUIRED';
  end if;

  v_id := app.stock_post_movement(
    'withdrawal', v_uid, app.stock_lines_normalize(p_lines, -1, false),
    p_person_id => v_person, p_shift_id => p_shift_id, p_site_id => v_site, p_note => p_note
  );

  -- Sin precios ni stock resultante: lo que vuelve lo ve también el celular (IS-20).
  return app.stock_movement_json(v_id, false);
end;
$$;

comment on function public.register_withdrawal(jsonb, uuid, uuid, text, uuid) is
  'Registra un retiro de insumos y descuenta el stock en el momento (0070, IS-11 a IS-13, IS-28). Sin p_person_id (o el propio): retira la sesión, que tiene que ser empleado o coordinador (FORBIDDEN si no; PERSON_REQUIRED si es administración sin esos roles) y elige entre sus opciones (turno de v_withdrawal_shift_options o sede de v_withdrawal_site_options). Con p_person_id de otra persona: la administración carga en su nombre (manage_stock; la persona tiene que ser empleado o coordinador activo) con cualquier turno vigente o sede activa. p_lines: [{supply_id, qty (entero > 0)}]. Sin turno, p_note es obligatoria. Devuelve {"movement": <cabecera>, "lines": [{supply_id, code, name, presentation, qty, qty_delta}]}, sin precios ni stock. Errores: FORBIDDEN, PERSON_REQUIRED, PERSON_NOT_FOUND, SHIFT_OR_SITE_REQUIRED, SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED, NOTE_REQUIRED, INVALID_LINES, INVALID_QTY, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE, INSUFFICIENT_STOCK («No alcanza el stock de X. Consultá en la oficina.», sin la cantidad para quien no es administración).';

revoke execute on function public.register_withdrawal(jsonb, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.register_withdrawal(jsonb, uuid, uuid, text, uuid) to authenticated, service_role;

-- void_stock_movement: anulación (IS-13, IS-27). Genera un contramovimiento enlazado y marca el
-- original como anulado. Solo ingresos, devoluciones y retiros; un ajuste se corrige con otro
-- ajuste. Las líneas del contramovimiento llevan el costo y la venta del original.
create function public.void_stock_movement(p_movement_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_m public.stock_movements;
  v_lines jsonb;
  v_rev uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_capability('manage_stock');

  if v_reason is null then
    raise exception using errcode = 'P0001', message = 'Indicá el motivo de la anulación.', hint = 'REASON_REQUIRED';
  end if;

  select * into v_m from public.stock_movements where id = p_movement_id for update;
  if v_m.id is null then
    raise exception using errcode = 'P0001', message = 'El movimiento no existe.', hint = 'MOVEMENT_NOT_FOUND';
  end if;

  if v_m.kind not in ('entry', 'return', 'withdrawal') then
    raise exception using errcode = 'P0001',
      message = 'Solo se pueden anular ingresos, devoluciones y retiros. Un ajuste se corrige con otro ajuste.',
      hint = 'MOVEMENT_NOT_VOIDABLE';
  end if;

  if v_m.voided_at is not null then
    raise exception using errcode = 'P0001', message = 'Ese movimiento ya está anulado.', hint = 'MOVEMENT_ALREADY_VOIDED';
  end if;

  select jsonb_agg(jsonb_build_object(
    'supply_id', l.supply_id, 'qty_delta', -l.qty_delta, 'unit_cost', l.unit_cost, 'unit_sale', l.unit_sale
  ))
  into v_lines
  from public.stock_movement_lines l
  where l.movement_id = v_m.id;

  v_rev := app.stock_post_movement(
    'reversal', auth.uid(), v_lines, 'void',
    p_person_id => v_m.person_id, p_shift_id => v_m.shift_id, p_site_id => v_m.site_id,
    p_note => v_reason, p_reverses_id => v_m.id
  );

  update public.stock_movements
  set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
  where id = v_m.id
  returning * into v_m;

  perform app.log_security_event(
    'stock_movement_voided', auth.uid(), v_m.person_id,
    jsonb_build_object('movement_id', v_m.id, 'kind', v_m.kind, 'reversal_id', v_rev, 'reason', v_reason)
  );

  return jsonb_build_object('movement', to_jsonb(v_m), 'reversal', app.stock_movement_json(v_rev, true));
end;
$$;

comment on function public.void_stock_movement(uuid, text) is
  'Anula un ingreso, una devolución o un retiro (0070, IS-13, IS-27). Exige manage_stock. Motivo obligatorio. Crea un contramovimiento kind reversal enlazado (reverses_id) con las cantidades opuestas y el costo y la venta del original, y marca el original con voided_at / voided_by / void_reason. Registra el evento stock_movement_voided. Devuelve {"movement": <original anulado>, "reversal": {"movement", "lines"}}. Errores: FORBIDDEN, REASON_REQUIRED, MOVEMENT_NOT_FOUND, MOVEMENT_NOT_VOIDABLE, MOVEMENT_ALREADY_VOIDED, VOID_INSUFFICIENT_STOCK (anular un ingreso cuyo stock ya se usó).';

revoke execute on function public.void_stock_movement(uuid, text) from public, anon;
grant execute on function public.void_stock_movement(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. RPC del control (IS-15, IS-16, IS-31)
-- ---------------------------------------------------------------------------------------------

-- register_stock_count: carga el control impreso. p_lines: [{supply_id, counted_qty (entero >= 0)}]
-- solo con las filas que se contaron (las en blanco no se mandan y no se tocan). La diferencia de
-- cada artículo es lo contado menos el stock del sistema a p_counted_at (descontando los
-- movimientos posteriores). Se guarda el control con todas sus líneas y un único movimiento
-- «count» con las diferencias distintas de cero.
create function public.register_stock_count(
  p_counted_at timestamptz,
  p_lines jsonb,
  p_reviewer_id uuid default null,
  p_reviewer_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_count public.stock_counts;
  v_elem jsonb;
  v_sid uuid;
  v_qty numeric;
  v_ids uuid[] := '{}';
  v_counted jsonb := '[]'::jsonb;
  v_diffs jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
  v_movement uuid;
  v_found integer := 0;
  v_system integer;
  r record;
begin
  perform app.require_capability('manage_stock');

  if p_counted_at is null then
    raise exception using errcode = 'P0001', message = 'Indicá la fecha y la hora del control.', hint = 'COUNT_DATE_REQUIRED';
  end if;
  if p_counted_at > now() then
    raise exception using errcode = 'P0001', message = 'La fecha y la hora del control no pueden ser futuras.', hint = 'COUNT_IN_FUTURE';
  end if;
  if num_nonnulls(p_reviewer_id, nullif(btrim(p_reviewer_name), '')) <> 1 then
    raise exception using errcode = 'P0001',
      message = 'Indicá quién revisó: una persona de la app o un nombre escrito, no las dos cosas.',
      hint = 'REVIEWER_REQUIRED';
  end if;
  if p_reviewer_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_reviewer_id and p.is_active and p.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'La persona que revisó no existe o está inactiva.', hint = 'REVIEWER_NOT_FOUND';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = 'P0001', message = 'Cargá al menos un artículo contado.', hint = 'INVALID_LINES';
  end if;

  for v_elem in select e.value from jsonb_array_elements(p_lines) as e loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception using errcode = 'P0001', message = 'Hay un artículo con un formato que no se entiende.', hint = 'INVALID_LINES';
    end if;
    begin
      v_sid := (v_elem ->> 'supply_id')::uuid;
      v_qty := (v_elem ->> 'counted_qty')::numeric;
    exception when others then
      raise exception using errcode = 'P0001', message = 'Hay un artículo o una cantidad con un formato que no se entiende.', hint = 'INVALID_LINES';
    end;
    if v_sid is null then
      raise exception using errcode = 'P0001', message = 'Falta indicar el artículo de una de las líneas.', hint = 'INVALID_LINES';
    end if;
    if v_qty is null or v_qty < 0 or v_qty <> trunc(v_qty) or v_qty > 1000000 then
      raise exception using errcode = 'P0001', message = 'Las cantidades contadas tienen que ser enteros mayores o iguales a cero.', hint = 'INVALID_QTY';
    end if;
    if v_sid = any (v_ids) then
      raise exception using errcode = 'P0001', message = 'Un artículo no puede repetirse en el mismo control.', hint = 'DUPLICATE_SUPPLY';
    end if;
    v_ids := v_ids || v_sid;
    v_counted := v_counted || jsonb_build_array(jsonb_build_object('supply_id', v_sid, 'counted_qty', v_qty));
  end loop;

  insert into public.stock_counts (counted_at, reviewer_id, reviewer_name, notes, created_by)
  values (p_counted_at, p_reviewer_id, nullif(btrim(p_reviewer_name), ''), nullif(btrim(p_notes), ''), v_uid)
  returning * into v_count;

  -- Artículos bloqueados en orden de id antes de calcular el stock a esa hora.
  for r in
    select s.id, s.code, s.name, s.presentation, x.counted_qty
    from jsonb_to_recordset(v_counted) as x (supply_id uuid, counted_qty numeric)
    join public.supplies s on s.id = x.supply_id
    order by s.id
    for update of s
  loop
    v_found := v_found + 1;
    v_system := app.supply_stock_at(r.id, p_counted_at);

    insert into public.stock_count_lines (count_id, supply_id, system_qty, counted_qty, difference)
    values (v_count.id, r.id, v_system, r.counted_qty::integer, r.counted_qty::integer - v_system);

    if r.counted_qty::integer <> v_system then
      v_diffs := v_diffs || jsonb_build_array(
        jsonb_build_object('supply_id', r.id, 'qty_delta', r.counted_qty::integer - v_system)
      );
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'supply_id', r.id, 'code', r.code, 'name', r.name, 'presentation', r.presentation,
      'system_qty', v_system, 'counted_qty', r.counted_qty::integer, 'difference', r.counted_qty::integer - v_system
    ));
  end loop;

  if v_found <> jsonb_array_length(v_counted) then
    raise exception using errcode = 'P0001', message = 'Alguno de los artículos no existe.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  if jsonb_array_length(v_diffs) > 0 then
    v_movement := app.stock_post_movement(
      'count', v_uid, v_diffs, 'count',
      p_note => p_notes, p_count_id => v_count.id
    );
  end if;

  return jsonb_build_object(
    'count', to_jsonb(v_count),
    'movement', case when v_movement is null then null else (app.stock_movement_json(v_movement, true) -> 'movement') end,
    'lines', v_result
  );
end;
$$;

comment on function public.register_stock_count(timestamptz, jsonb, uuid, text, text) is
  'Carga un control de stock (0070, IS-16, IS-31). Exige manage_stock. p_counted_at: fecha y hora del conteo (no futura). Revisor: p_reviewer_id (persona de la app) o p_reviewer_name (nombre escrito), uno solo. p_lines: [{supply_id, counted_qty (entero >= 0)}], solo las filas contadas: las en blanco no se mandan y no se tocan. La diferencia de cada artículo es lo contado menos el stock del sistema a p_counted_at (el actual menos los movimientos posteriores), así un retiro hecho entre el conteo y la carga no cuenta como faltante. Guarda el control con todas sus líneas y UN movimiento kind count con las diferencias distintas de cero (null si no hay ninguna). Devuelve {"count": <fila>, "movement": <cabecera o null>, "lines": [{supply_id, code, name, presentation, system_qty, counted_qty, difference}]}. Errores: FORBIDDEN, COUNT_DATE_REQUIRED, COUNT_IN_FUTURE, REVIEWER_REQUIRED, REVIEWER_NOT_FOUND, INVALID_LINES, INVALID_QTY, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, COUNT_INCONSISTENT (los movimientos posteriores dejarían el stock negativo).';

revoke execute on function public.register_stock_count(timestamptz, jsonb, uuid, text, text) from public, anon;
grant execute on function public.register_stock_count(timestamptz, jsonb, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 8. Faltantes y Resumen (IS-14, IS-29, IS-30)
-- ---------------------------------------------------------------------------------------------

create function public.report_supply_shortage(
  p_supply_id uuid default null,
  p_description text default null,
  p_shift_id uuid default null,
  p_site_id uuid default null,
  p_comment text default null
)
returns public.supply_shortage_reports
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_site uuid;
  v_row public.supply_shortage_reports;
begin
  perform app.require_role('employee', 'supervisor');

  if num_nonnulls(p_supply_id, nullif(btrim(p_description), '')) <> 1 then
    raise exception using errcode = 'P0001',
      message = 'Elegí un artículo del catálogo o escribí cuál falta, una sola de las dos cosas.',
      hint = 'SHORTAGE_TARGET_REQUIRED';
  end if;

  if p_supply_id is not null and not exists (
    select 1 from public.supplies s where s.id = p_supply_id and s.active
  ) then
    raise exception using errcode = 'P0001', message = 'El artículo no existe o está desactivado.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  v_site := app.resolve_stock_place(p_shift_id, p_site_id, true);

  insert into public.supply_shortage_reports (
    reported_by, supply_id, description, shift_id, site_id, comment, created_by
  )
  values (
    auth.uid(), p_supply_id, nullif(btrim(p_description), ''), p_shift_id, v_site,
    nullif(btrim(p_comment), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.report_supply_shortage(uuid, text, uuid, uuid, text) is
  'Avisa que falta un insumo (0070, IS-14, IS-29). Solo employee y supervisor (FORBIDDEN si no). Un artículo del catálogo (p_supply_id) o un texto libre (p_description), uno solo. Turno o sede y comentario opcionales; turno y sede se validan como en register_withdrawal. Devuelve la fila (status open). Errores: FORBIDDEN, SHORTAGE_TARGET_REQUIRED, SUPPLY_NOT_FOUND, SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED.';

revoke execute on function public.report_supply_shortage(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.report_supply_shortage(uuid, text, uuid, uuid, text) to authenticated, service_role;

-- resolve_supply_shortage: dueño y administradores, con o sin manage_stock (IS-21).
create function public.resolve_supply_shortage(p_report_id uuid, p_note text)
returns public.supply_shortage_reports
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.supply_shortage_reports;
begin
  perform app.require_admin();

  if nullif(btrim(p_note), '') is null then
    raise exception using errcode = 'P0001',
      message = 'Escribí una nota de resolución (por ejemplo, «Se compró» o «Hay en el depósito»).',
      hint = 'NOTE_REQUIRED';
  end if;

  select * into v_row from public.supply_shortage_reports where id = p_report_id for update;
  if v_row.id is null then
    raise exception using errcode = 'P0001', message = 'El aviso no existe.', hint = 'SHORTAGE_NOT_FOUND';
  end if;
  if v_row.status = 'resolved' then
    raise exception using errcode = 'P0001', message = 'Ese aviso ya está resuelto.', hint = 'SHORTAGE_ALREADY_RESOLVED';
  end if;

  update public.supply_shortage_reports
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(),
      resolution_note = btrim(p_note), updated_by = auth.uid()
  where id = p_report_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.resolve_supply_shortage(uuid, text) is
  'Resuelve un aviso de faltante con una nota (0070, IS-21, IS-29). Dueño y administradores, sin exigir manage_stock. Devuelve la fila. Errores: FORBIDDEN, NOTE_REQUIRED, SHORTAGE_NOT_FOUND, SHORTAGE_ALREADY_RESOLVED.';

revoke execute on function public.resolve_supply_shortage(uuid, text) from public, anon;
grant execute on function public.resolve_supply_shortage(uuid, text) to authenticated, service_role;

-- get_stock_summary: tarjetas del Resumen y número de la barra lateral (IS-30, IS-33).
create function public.get_stock_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform app.require_admin();

  select jsonb_build_object(
    'open_reports', (select count(*) from public.supply_shortage_reports r where r.status = 'open'),
    'open_shortages', (
      select count(distinct coalesce(r.supply_id::text, 'text:' || lower(btrim(r.description))))
      from public.supply_shortage_reports r
      where r.status = 'open'
    ),
    'out_of_stock', (select count(*) from public.supplies s where s.active and s.stock_qty = 0),
    'below_min', (
      select count(*) from public.supplies s
      where s.active and s.min_qty is not null and s.stock_qty > 0 and s.stock_qty <= s.min_qty
    )
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.get_stock_summary() is
  'Contadores del módulo E para el Resumen y la barra lateral (0070, IS-30, IS-33). Solo O, A (FORBIDDEN si no; no exige manage_stock). Devuelve {"open_reports": avisos abiertos, "open_shortages": avisos abiertos contados por artículo (varios avisos del mismo artículo cuentan uno; los de texto libre, por texto), "out_of_stock": artículos activos con stock cero, "below_min": artículos activos con mínimo y stock entre 1 y el mínimo}. Tarjeta «Stock bajo»: «out_of_stock sin stock · below_min bajo mínimo».';

revoke execute on function public.get_stock_summary() from public, anon;
grant execute on function public.get_stock_summary() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 9. Vistas (todas con security_invoker = true)
-- ---------------------------------------------------------------------------------------------

-- 9.1 v_supply_catalog (IS-20): catálogo para empleados y coordinadores, sin precios ni cantidades.
create view public.v_supply_catalog with (security_invoker = true) as
select * from app.supply_catalog();

comment on view public.v_supply_catalog is
  'Catálogo de insumos activos para empleados, coordinadores y administración (0070, IS-20). Columnas: id, code, name, presentation, category_id, category_name, category_sort_order, image_path, out_of_stock (stock cero: «Sin stock», no se puede elegir). Nunca trae precios, stock ni mínimos. Ordenada por categoría y nombre.';

-- 9.2 v_stock_admin (IS-05, IS-24, IS-25): stock con estado y valor a costo. Solo administración.
create view public.v_stock_admin with (security_invoker = true) as
select
  s.id,
  s.code,
  s.name,
  s.presentation,
  s.category_id,
  c.name as category_name,
  c.sort_order as category_sort_order,
  s.image_path,
  s.min_qty,
  s.cost_price,
  s.sale_price,
  s.stock_qty,
  (s.stock_qty * s.cost_price)::numeric(14, 2) as stock_value,
  case
    when s.stock_qty = 0 then 'empty'
    when s.min_qty is not null and s.stock_qty <= s.min_qty then 'low'
    else 'ok'
  end as status,
  s.active,
  s.notes,
  s.created_at,
  s.updated_at
from public.supplies s
join public.supply_categories c on c.id = s.category_id;

comment on view public.v_stock_admin is
  'Stock de cada artículo para dueño y administradores (0070, IS-05, IS-24, IS-25), con la RLS de supplies. status: empty (stock cero, fila roja, haya o no mínimo), low (hay mínimo y el stock es igual o menor, fila amarilla) u ok. stock_value = stock_qty × cost_price (valor a costo). Incluye inactivos (active): el filtro «Incluir inactivos» es del cliente.';

-- 9.3 v_stock_movements_admin (IS-18, IS-22): una fila por línea de movimiento, con persona,
--     turno, cliente, sede, precios y anulación. Alimenta Movimientos, las fichas y Excel.
create view public.v_stock_movements_admin with (security_invoker = true) as
select
  m.id as movement_id,
  l.id as line_id,
  m.kind,
  m.recorded_at,
  m.recorded_by,
  rb.first_name || ' ' || rb.last_name as recorded_by_name,
  m.person_id,
  pp.first_name || ' ' || pp.last_name as person_name,
  m.shift_id,
  sh.shift_date,
  sh.start_time,
  sh.end_time,
  si.client_id,
  coalesce(nullif(cl.trade_name, ''), cl.legal_name) as client_name,
  m.site_id,
  si.name as site_name,
  m.supplier,
  m.document_number,
  m.reason,
  m.note,
  m.count_id,
  sc.counted_at as count_counted_at,
  coalesce(rp.first_name || ' ' || rp.last_name, sc.reviewer_name) as count_reviewer_name,
  m.reverses_id,
  m.voided_at,
  m.voided_by,
  vb.first_name || ' ' || vb.last_name as voided_by_name,
  m.void_reason,
  l.supply_id,
  s.code as supply_code,
  s.name as supply_name,
  s.presentation as supply_presentation,
  s.category_id,
  l.qty_delta,
  l.unit_cost,
  l.unit_sale,
  (l.qty_delta * l.unit_cost)::numeric(14, 2) as line_cost,
  (l.qty_delta * l.unit_sale)::numeric(14, 2) as line_sale,
  l.stock_after
from public.stock_movements m
join public.stock_movement_lines l on l.movement_id = m.id
join public.supplies s on s.id = l.supply_id
left join public.profiles rb on rb.id = m.recorded_by
left join public.profiles pp on pp.id = m.person_id
left join public.profiles vb on vb.id = m.voided_by
left join public.shifts sh on sh.id = m.shift_id
left join public.sites si on si.id = m.site_id
left join public.clients cl on cl.id = si.client_id
left join public.stock_counts sc on sc.id = m.count_id
left join public.profiles rp on rp.id = sc.reviewer_id;

comment on view public.v_stock_movements_admin is
  'Movimientos de stock línea por línea para dueño y administradores (0070, IS-18, IS-22, IS-27). Filtros del cliente: fecha (recorded_at), kind, person_id, supply_id, client_id, site_id. qty_delta con signo; unit_cost / unit_sale / line_cost / line_sale son los del momento. voided_at no nulo = «Anulado»; reverses_id no nulo = es la anulación de otro movimiento. Para un control: count_counted_at y count_reviewer_name.';

-- 9.4 v_stock_counts_admin (IS-16): historial de controles con sus diferencias.
create view public.v_stock_counts_admin with (security_invoker = true) as
select
  c.id as count_id,
  c.counted_at,
  c.reviewer_id,
  coalesce(rp.first_name || ' ' || rp.last_name, c.reviewer_name) as reviewer_name,
  c.notes,
  c.created_at,
  c.created_by,
  cb.first_name || ' ' || cb.last_name as created_by_name,
  (select m.id from public.stock_movements m where m.count_id = c.id) as movement_id,
  (select count(*) from public.stock_count_lines l where l.count_id = c.id)::integer as lines_count,
  (select count(*) from public.stock_count_lines l where l.count_id = c.id and l.difference <> 0)::integer as differences_count,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'supply_id', s.id, 'code', s.code, 'name', s.name, 'presentation', s.presentation,
        'system_qty', l.system_qty, 'counted_qty', l.counted_qty, 'difference', l.difference
      )
      order by s.code
    )
    from public.stock_count_lines l
    join public.supplies s on s.id = l.supply_id
    where l.count_id = c.id
  ), '[]'::jsonb) as lines
from public.stock_counts c
left join public.profiles rp on rp.id = c.reviewer_id
left join public.profiles cb on cb.id = c.created_by;

comment on view public.v_stock_counts_admin is
  'Controles de stock cargados, para dueño y administradores (0070, IS-16, IS-31): fecha y hora del conteo, revisor (persona o nombre escrito), quién lo cargó y cuándo, cantidad de líneas y de diferencias, el movimiento «count» que generó (null si no hubo diferencias) y las líneas en jsonb [{supply_id, code, name, presentation, system_qty, counted_qty, difference}].';

-- 9.5 v_supply_consumption_by_client (IS-24): retiros netos de anulaciones, por día, cliente, sede
--     y artículo. Un retiro anulado no cuenta (la anulación es total). El período lo recorta el
--     cliente sobre `day` (fecha de Argentina del retiro) y suma.
create view public.v_supply_consumption_by_client with (security_invoker = true) as
select
  (m.recorded_at at time zone 'America/Argentina/Buenos_Aires')::date as day,
  si.client_id,
  coalesce(nullif(cl.trade_name, ''), cl.legal_name) as client_name,
  m.site_id,
  si.name as site_name,
  l.supply_id,
  s.code as supply_code,
  s.name as supply_name,
  s.presentation as supply_presentation,
  s.category_id,
  sum(-l.qty_delta)::integer as qty,
  sum(-l.qty_delta * l.unit_cost)::numeric(14, 2) as cost_total,
  sum(-l.qty_delta * l.unit_sale)::numeric(14, 2) as sale_total
from public.stock_movements m
join public.stock_movement_lines l on l.movement_id = m.id
join public.supplies s on s.id = l.supply_id
join public.sites si on si.id = m.site_id
join public.clients cl on cl.id = si.client_id
where m.kind = 'withdrawal'
  and m.voided_at is null
group by
  (m.recorded_at at time zone 'America/Argentina/Buenos_Aires')::date,
  si.client_id, cl.trade_name, cl.legal_name, m.site_id, si.name,
  l.supply_id, s.code, s.name, s.presentation, s.category_id;

comment on view public.v_supply_consumption_by_client is
  'Consumo de insumos por cliente (0070, IS-24), solo dueño y administradores. Una fila por día (fecha de Argentina del retiro), cliente, sede y artículo, con los retiros netos de anulaciones (los anulados no cuentan): qty en unidades, cost_total y sale_total con el costo y la venta guardados en cada línea (IS-22). El período, el cliente y la sede los filtra el cliente sobre day, client_id y site_id.';

-- 9.6 Vistas del celular: mis retiros, mis avisos y lo que se puede elegir.
create view public.v_my_withdrawals with (security_invoker = true) as
select * from app.my_withdrawals();

comment on view public.v_my_withdrawals is
  'Mis retiros de insumos (0070, IS-20): los que retiré yo o que la administración cargó a mi nombre (on_behalf). Con turno, cliente y sede, observación, anulación (voided_at, void_reason) y las líneas [{supply_id, code, name, presentation, qty}] sin precios. Más recientes primero.';

create view public.v_my_shortage_reports with (security_invoker = true) as
select * from app.my_shortage_reports();

comment on view public.v_my_shortage_reports is
  'Mis avisos de faltante (0070, IS-29): abiertos primero, con el artículo (supply_name con presentación) o el texto libre (description), turno o sede, comentario, estado y, si se resolvió, quién y la nota.';

create view public.v_withdrawal_shift_options with (security_invoker = true) as
select * from app.withdrawal_shift_options();

comment on view public.v_withdrawal_shift_options is
  'Turnos que puedo elegir al retirar insumos o avisar un faltante (0070, IS-28). Empleado: los míos de hoy a +7 días. Coordinador: todos de hoy a +7 días, con is_priority (Mis sedes) primero. Administración sin rol de empleado ni coordinador (retiro en nombre de otra persona): todos de -30 a +7 días. is_assigned: tengo asignación o supervisión en ese turno.';

create view public.v_withdrawal_site_options with (security_invoker = true) as
select * from app.withdrawal_site_options();

comment on view public.v_withdrawal_site_options is
  'Sedes que puedo elegir al retirar sin turno puntual (0070, IS-12). Empleado: las de mis asignaciones. Coordinador y administración: todas las sedes activas de clientes activos, con is_priority (Mis sedes) primero.';

revoke all on public.v_supply_catalog from public, anon, authenticated;
revoke all on public.v_stock_admin from public, anon, authenticated;
revoke all on public.v_stock_movements_admin from public, anon, authenticated;
revoke all on public.v_stock_counts_admin from public, anon, authenticated;
revoke all on public.v_supply_consumption_by_client from public, anon, authenticated;
revoke all on public.v_my_withdrawals from public, anon, authenticated;
revoke all on public.v_my_shortage_reports from public, anon, authenticated;
revoke all on public.v_withdrawal_shift_options from public, anon, authenticated;
revoke all on public.v_withdrawal_site_options from public, anon, authenticated;

grant select on public.v_supply_catalog to authenticated;
grant select on public.v_stock_admin to authenticated;
grant select on public.v_stock_movements_admin to authenticated;
grant select on public.v_stock_counts_admin to authenticated;
grant select on public.v_supply_consumption_by_client to authenticated;
grant select on public.v_my_withdrawals to authenticated;
grant select on public.v_my_shortage_reports to authenticated;
grant select on public.v_withdrawal_shift_options to authenticated;
grant select on public.v_withdrawal_site_options to authenticated;
