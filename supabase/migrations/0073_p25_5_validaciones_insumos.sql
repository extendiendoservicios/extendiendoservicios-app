-- P25.5d · Validación del lado servidor en Insumos (módulo E; IS-36 e IS-37, CONFIRMADAS el 28 oct
-- 2026). Corrige los defectos DEF-P25-01 y DEF-P25-02 que dejó la suite de permisos de P25.5c.
--
-- Contenido, en orden:
--   1. Auxiliar app.check_text_max: tope de largo de los textos libres (DEF-P25-02, hint
--      TEXT_TOO_LONG).
--   2. Núcleo app.stock_post_movement: topes de los textos del movimiento, tope del costo y de la
--      venta por línea (lo que admite numeric(12, 2)) y tope del stock resultante (lo que admite
--      integer), todos como errores de negocio (DEF-P25-01).
--   3. RPC de catálogo: upsert_supply, set_supply_prices y upsert_supply_category.
--   4. RPC de movimientos: register_stock_entry, adjust_stock y void_stock_movement.
--   5. RPC del control: register_stock_count con la ventana de fechas de IS-36.
--   6. RPC de faltantes: report_supply_shortage y resolve_supply_shortage.
--
-- Por qué cambian los TIPOS de algunos parámetros (no los nombres, ni el orden, ni lo que
-- devuelven): PostgREST convierte cada parámetro a su tipo ANTES de llamar a la función. Con
-- `integer`, un 3000000000 falla ahí mismo con 22003; con un enumerado, un valor inexistente
-- falla con 22P02; con `timestamptz`, un texto como «ayer» falla con 22007. La función nunca
-- llega a ejecutarse, así que no hay forma de devolver un P0001 con código si el tipo del
-- parámetro es el estricto. Por eso estos parámetros pasan a `numeric` o `text` y se validan
-- adentro:
--     upsert_supply.p_min_qty                   integer      -> numeric
--     upsert_supply_category.p_sort_order       integer      -> numeric
--     adjust_stock.p_delta                      integer      -> numeric
--     adjust_stock.p_reason                     stock_adjustment_reason -> text
--     register_stock_entry.p_kind               stock_movement_kind     -> text
--     register_stock_count.p_counted_at         timestamptz  -> text
-- Para quien llama por JSON no cambia nada (números y textos ISO 8601 como hasta ahora). Un uuid
-- mal formado en un parámetro uuid sigue dando 22P02 del motor, como en el resto de las RPC de la
-- plataforma.
--
-- Topes (documentados también en docs/database.md, «Insumos y control de stock»):
--   Textos (largo después de recortar espacios): código 40; nombre del artículo 120;
--   presentación 80; notas del artículo 500; nombre de la categoría 60; proveedor 120;
--   comprobante 60; nota del ingreso, del ajuste y observación del retiro 500; motivo de la
--   anulación 500; observaciones del control 500; nombre de quien revisó 120; descripción del
--   aviso de faltante 200; comentario del aviso 500; nota de resolución 500.
--   Números: precios hasta 9.999.999.999,99 (numeric(12, 2)); stock mínimo de 0 a 1.000.000;
--   orden de categoría de -1.000.000 a 1.000.000; cantidad por línea y delta del ajuste hasta
--   1.000.000 en valor absoluto (ya estaba); stock resultante hasta 2.147.483.647 (integer).
--   Fecha del control (IS-36): desde 30 días atrás hasta ahora, con 5 minutos de tolerancia en
--   los dos extremos por el reloj del cliente.

-- ---------------------------------------------------------------------------------------------
-- 1. Tope de largo de los textos libres
-- ---------------------------------------------------------------------------------------------

create function app.check_text_max(p_value text, p_max integer, p_label text)
returns void
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
begin
  if p_value is not null and char_length(btrim(p_value)) > p_max then
    raise exception using errcode = 'P0001',
      message = format('%s: hasta %s caracteres.', p_label, p_max),
      hint = 'TEXT_TOO_LONG';
  end if;
end;
$$;

comment on function app.check_text_max(text, integer, text) is
  'Corta con P0001 / TEXT_TOO_LONG si el texto, sin los espacios de los extremos, supera p_max caracteres (0073, IS-37). p_label es el nombre del campo sin artículo («Descripción»). Interna.';

revoke execute on function app.check_text_max(text, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Núcleo de los movimientos
-- ---------------------------------------------------------------------------------------------

-- Igual que la de 0070 salvo: los textos del movimiento tienen tope; el costo y la venta de una
-- línea no pueden pasar de lo que admite numeric(12, 2); y el stock resultante no puede pasar de
-- lo que admite integer (STOCK_LIMIT).
create or replace function app.stock_post_movement(
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
  v_new bigint;
  v_label text;
  v_new_cost numeric(12, 2);
begin
  -- Textos libres (IS-37).
  perform app.check_text_max(p_supplier, 120, 'Proveedor');
  perform app.check_text_max(p_document_number, 60, 'Comprobante');
  perform app.check_text_max(
    p_note, 500,
    case p_kind
      when 'withdrawal' then 'Observación'
      when 'count' then 'Observaciones del control'
      when 'reversal' then 'Motivo de la anulación'
      else 'Nota'
    end
  );

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

    -- NaN e infinito caen en `> 9999999999.99` (en Postgres, NaN es mayor que todo).
    if (v_cost is not null and (v_cost < 0 or v_cost > 9999999999.99 or v_cost <> round(v_cost, 2)))
       or (v_sale is not null and (v_sale < 0 or v_sale > 9999999999.99 or v_sale <> round(v_sale, 2))) then
      raise exception using errcode = 'P0001', message = 'Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', hint = 'INVALID_PRICE';
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

    -- En bigint para que la suma no desborde antes de poder avisar.
    v_new := r.stock_qty::bigint + r.qty_delta::bigint;

    if v_new > 2147483647 then
      raise exception using errcode = 'P0001',
        message = format('El stock de %s no puede superar las 2.147.483.647 unidades.', v_label),
        hint = 'STOCK_LIMIT';
    end if;

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
      coalesce(r.x_cost, r.cost_price), coalesce(r.x_sale, r.sale_price), v_new::integer
    );

    update public.supplies
    set stock_qty = v_new::integer, cost_price = v_new_cost, updated_by = p_actor
    where id = r.id;
  end loop;

  if v_found <> jsonb_array_length(p_lines) then
    raise exception using errcode = 'P0001', message = 'Alguno de los artículos no existe.', hint = 'SUPPLY_NOT_FOUND';
  end if;

  return v_movement_id;
end;
$$;

comment on function app.stock_post_movement(public.stock_movement_kind, uuid, jsonb, text, timestamptz, uuid, uuid, uuid, text, text, public.stock_adjustment_reason, text, uuid, uuid) is
  'Núcleo del módulo E (0070, validaciones en 0073): crea un movimiento con sus líneas y actualiza supplies.stock_qty con los artículos bloqueados en orden de id. No valida permisos ni reglas por tipo: las RPC públicas lo hacen antes. Guarda en cada línea el costo y la venta del momento (IS-22). Topes (IS-37): proveedor 120, comprobante 60, nota 500; costo y venta de una línea hasta 9.999.999.999,99; cantidad por línea hasta 1.000.000; stock resultante hasta 2.147.483.647. Errores: TEXT_TOO_LONG, INVALID_LINES, INVALID_QTY, INVALID_PRICE, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE, INSUFFICIENT_STOCK (sin la cantidad para quien no es administración, IS-20), STOCK_LIMIT, VOID_INSUFFICIENT_STOCK, COUNT_INCONSISTENT. Interna: no se expone a authenticated.';

-- ---------------------------------------------------------------------------------------------
-- 3. RPC de catálogo
-- ---------------------------------------------------------------------------------------------

drop function public.upsert_supply(text, text, uuid, text, integer, numeric, numeric, text, text, uuid);

create function public.upsert_supply(
  p_code text,
  p_name text,
  p_category_id uuid,
  p_presentation text default null,
  p_min_qty numeric default null,
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
  perform app.check_text_max(v_code, 40, 'Código');
  perform app.check_text_max(v_name, 120, 'Nombre del artículo');
  perform app.check_text_max(p_presentation, 80, 'Presentación');
  perform app.check_text_max(p_notes, 500, 'Notas del artículo');

  -- NaN e infinito caen en el `>` (en Postgres, NaN es mayor que todo).
  if p_min_qty is not null and (p_min_qty < 0 or p_min_qty > 1000000 or p_min_qty <> trunc(p_min_qty)) then
    raise exception using errcode = 'P0001', message = 'El stock mínimo tiene que ser un entero entre 0 y 1.000.000.', hint = 'INVALID_MIN_QTY';
  end if;
  if (p_cost_price is not null and (p_cost_price < 0 or p_cost_price > 9999999999.99 or p_cost_price <> round(p_cost_price, 2)))
     or (p_sale_price is not null and (p_sale_price < 0 or p_sale_price > 9999999999.99 or p_sale_price <> round(p_sale_price, 2))) then
    raise exception using errcode = 'P0001', message = 'Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', hint = 'INVALID_PRICE';
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
        v_id, v_code, v_name, nullif(btrim(p_presentation), ''), p_category_id, p_image_path, p_min_qty::integer,
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
          min_qty = p_min_qty::integer,
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

comment on function public.upsert_supply(text, text, uuid, text, numeric, numeric, numeric, text, text, uuid) is
  'Alta o edición de un artículo (0070, IS-01, IS-02, IS-26; validaciones en 0073). Exige manage_stock (O; A + manage_stock). Sin p_id (o con un id nuevo) crea; con el id de uno existente lo edita con TODOS los campos que llegan (p_presentation, p_min_qty, p_notes y p_image_path en null los vacían). Los precios (p_cost_price, p_sale_price) solo cuentan en el alta; después se cambian con set_supply_prices. No toca stock ni active. p_image_path, si viene, empieza con «{id}/». Topes (IS-37): código 40, nombre 120, presentación 80, notas 500 caracteres; precios de 0 a 9.999.999.999,99 con dos decimales; p_min_qty entero de 0 a 1.000.000 (es numeric para poder avisar con INVALID_MIN_QTY en vez del error del motor). Devuelve la fila de supplies. Errores: FORBIDDEN, CODE_REQUIRED, NAME_REQUIRED, TEXT_TOO_LONG, INVALID_MIN_QTY, INVALID_PRICE, INVALID_IMAGE_PATH, CATEGORY_NOT_FOUND, CATEGORY_INACTIVE, CODE_ALREADY_EXISTS (sin distinguir mayúsculas).';

revoke execute on function public.upsert_supply(text, text, uuid, text, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.upsert_supply(text, text, uuid, text, numeric, numeric, numeric, text, text, uuid) to authenticated, service_role;

create or replace function public.set_supply_prices(p_supply_id uuid, p_cost_price numeric, p_sale_price numeric)
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
     or p_cost_price > 9999999999.99 or p_sale_price > 9999999999.99
     or p_cost_price <> round(p_cost_price, 2) or p_sale_price <> round(p_sale_price, 2) then
    raise exception using errcode = 'P0001', message = 'Los precios tienen que estar entre cero y 9.999.999.999,99, con hasta dos decimales.', hint = 'INVALID_PRICE';
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
  'Cambia el costo y la venta de un artículo (0070, IS-06, IS-22, IS-34; tope en 0073). Exige manage_stock. Precios de 0 a 9.999.999.999,99 con dos decimales. Si no cambia ninguno no escribe nada. Cada cambio queda en supply_price_changes y en security_events (supply_price_changed). Lo ya movido no se recalcula: cada línea guardó el precio del momento. Devuelve la fila. Errores: FORBIDDEN, INVALID_PRICE, SUPPLY_NOT_FOUND.';

drop function public.upsert_supply_category(text, integer, boolean, uuid);

create function public.upsert_supply_category(
  p_name text,
  p_sort_order numeric default 0,
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
  perform app.check_text_max(v_name, 60, 'Nombre de la categoría');
  if p_active is null or p_sort_order is null then
    raise exception using errcode = 'P0001', message = 'Faltan datos de la categoría.', hint = 'INVALID_CATEGORY';
  end if;
  if p_sort_order < -1000000 or p_sort_order > 1000000 or p_sort_order <> trunc(p_sort_order) then
    raise exception using errcode = 'P0001', message = 'El orden de la categoría tiene que ser un entero entre -1.000.000 y 1.000.000.', hint = 'INVALID_SORT_ORDER';
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
      values (v_name, p_sort_order::integer, p_active, auth.uid())
      returning * into v_row;
    else
      update public.supply_categories
      set name = v_name, sort_order = p_sort_order::integer, active = p_active, updated_by = auth.uid()
      where id = p_id
      returning * into v_row;
    end if;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'Ya existe una categoría con ese nombre.', hint = 'CATEGORY_NAME_EXISTS';
  end;

  return v_row;
end;
$$;

comment on function public.upsert_supply_category(text, numeric, boolean, uuid) is
  'Alta (sin p_id) o edición de una categoría (0070, IS-03; validaciones en 0073). Exige manage_stock. Nombre hasta 60 caracteres; p_sort_order entero de -1.000.000 a 1.000.000 (es numeric para poder avisar con INVALID_SORT_ORDER en vez del error del motor). Desactivar pide que no queden artículos activos en la categoría. Devuelve la fila. Errores: FORBIDDEN, NAME_REQUIRED, TEXT_TOO_LONG, INVALID_CATEGORY, INVALID_SORT_ORDER, CATEGORY_NOT_FOUND, CATEGORY_IN_USE, CATEGORY_NAME_EXISTS.';

revoke execute on function public.upsert_supply_category(text, numeric, boolean, uuid) from public, anon;
grant execute on function public.upsert_supply_category(text, numeric, boolean, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. RPC de movimientos
-- ---------------------------------------------------------------------------------------------

drop function public.register_stock_entry(jsonb, text, text, text, public.stock_movement_kind);

create function public.register_stock_entry(
  p_lines jsonb,
  p_supplier text default null,
  p_document_number text default null,
  p_note text default null,
  p_kind text default 'entry'
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
    p_kind::public.stock_movement_kind, auth.uid(), app.stock_lines_normalize(p_lines, 1, true),
    p_supplier => p_supplier, p_document_number => p_document_number, p_note => p_note
  );

  return app.stock_movement_json(v_id, true);
end;
$$;

comment on function public.register_stock_entry(jsonb, text, text, text, text) is
  'Registra un ingreso o una devolución de stock (0070, IS-08, IS-09, IS-22, IS-23; validaciones en 0073). Exige manage_stock. p_lines: [{supply_id, qty (entero de 1 a 1.000.000), unit_cost? (costo unitario de 0 a 9.999.999.999,99 con dos decimales, opcional), update_cost? (true actualiza el costo vigente del artículo si es distinto)}]. p_kind: «entry» (por defecto) o «return»; es text para poder avisar con INVALID_KIND. Proveedor (hasta 120), comprobante (60) y nota (500) opcionales. Cada línea guarda el costo (el indicado o el vigente) y la venta del momento. Devuelve {"movement": <cabecera>, "lines": [{supply_id, code, name, presentation, qty_delta, unit_cost, unit_sale, stock_after}]}. Errores: FORBIDDEN, INVALID_KIND, TEXT_TOO_LONG, INVALID_LINES, INVALID_QTY, INVALID_PRICE, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE, STOCK_LIMIT.';

revoke execute on function public.register_stock_entry(jsonb, text, text, text, text) from public, anon;
grant execute on function public.register_stock_entry(jsonb, text, text, text, text) to authenticated, service_role;

drop function public.adjust_stock(uuid, integer, public.stock_adjustment_reason, text);

create function public.adjust_stock(
  p_supply_id uuid,
  p_delta numeric,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_id uuid;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_capability('manage_stock');

  if p_supply_id is null then
    raise exception using errcode = 'P0001', message = 'Elegí el artículo.', hint = 'SUPPLY_NOT_FOUND';
  end if;
  -- NaN e infinito caen en el `>` (en Postgres, NaN es mayor que todo).
  if p_delta is null or p_delta = 0 or p_delta <> trunc(p_delta) or abs(p_delta) > 1000000 then
    raise exception using errcode = 'P0001', message = 'La cantidad del ajuste tiene que ser un entero distinto de cero, de hasta 1.000.000 en valor absoluto.', hint = 'INVALID_QTY';
  end if;
  if v_reason is null then
    raise exception using errcode = 'P0001', message = 'Elegí el motivo del ajuste.', hint = 'REASON_REQUIRED';
  end if;
  if v_reason not in (select e::text from unnest(enum_range(null::public.stock_adjustment_reason)) as e) then
    raise exception using errcode = 'P0001', message = 'El motivo del ajuste no es válido.', hint = 'INVALID_REASON';
  end if;
  if v_reason = 'other' and nullif(btrim(p_note), '') is null then
    raise exception using errcode = 'P0001', message = 'Con el motivo «Otro» tenés que escribir una observación.', hint = 'NOTE_REQUIRED';
  end if;

  v_id := app.stock_post_movement(
    'adjustment', auth.uid(),
    jsonb_build_array(jsonb_build_object('supply_id', p_supply_id, 'qty_delta', p_delta)),
    p_reason => v_reason::public.stock_adjustment_reason, p_note => p_note
  );

  return app.stock_movement_json(v_id, true);
end;
$$;

comment on function public.adjust_stock(uuid, numeric, text, text) is
  'Ajusta el stock de un artículo con un movimiento «adjustment» (+ o −), motivo obligatorio (0070, IS-10; validaciones en 0073). Exige manage_stock. p_delta: entero distinto de cero, hasta 1.000.000 en valor absoluto (es numeric para poder avisar con INVALID_QTY). p_reason: count, breakage, expired, data_error u other (es text para poder avisar con INVALID_REASON). Con el motivo other la nota es obligatoria; la nota tiene hasta 500 caracteres. Devuelve {"movement", "lines"} como register_stock_entry. Errores: FORBIDDEN, SUPPLY_NOT_FOUND, INVALID_QTY, REASON_REQUIRED, INVALID_REASON, NOTE_REQUIRED, TEXT_TOO_LONG, SUPPLY_INACTIVE, INSUFFICIENT_STOCK (el ajuste negativo no puede dejar el stock bajo cero), STOCK_LIMIT.';

revoke execute on function public.adjust_stock(uuid, numeric, text, text) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, text, text) to authenticated, service_role;

create or replace function public.void_stock_movement(p_movement_id uuid, p_reason text)
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
  perform app.check_text_max(v_reason, 500, 'Motivo de la anulación');

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
  'Anula un ingreso, una devolución o un retiro (0070, IS-13, IS-27; tope en 0073). Exige manage_stock. Motivo obligatorio, hasta 500 caracteres. Crea un contramovimiento kind reversal enlazado (reverses_id) con las cantidades opuestas y el costo y la venta del original, y marca el original con voided_at / voided_by / void_reason. Registra el evento stock_movement_voided. Devuelve {"movement": <original anulado>, "reversal": {"movement", "lines"}}. Errores: FORBIDDEN, REASON_REQUIRED, TEXT_TOO_LONG, MOVEMENT_NOT_FOUND, MOVEMENT_NOT_VOIDABLE, MOVEMENT_ALREADY_VOIDED, VOID_INSUFFICIENT_STOCK (anular un ingreso cuyo stock ya se usó), STOCK_LIMIT.';

-- ---------------------------------------------------------------------------------------------
-- 5. Control de stock: ventana de fechas (IS-36) y topes
-- ---------------------------------------------------------------------------------------------

drop function public.register_stock_count(timestamptz, jsonb, uuid, text, text);

create function public.register_stock_count(
  p_counted_at text,
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
  v_at timestamptz;
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

  if nullif(btrim(p_counted_at), '') is null then
    raise exception using errcode = 'P0001', message = 'Indicá la fecha y la hora del control.', hint = 'COUNT_DATE_REQUIRED';
  end if;
  begin
    v_at := btrim(p_counted_at)::timestamptz;
  exception when others then
    raise exception using errcode = 'P0001',
      message = 'La fecha y la hora del control no son válidas.',
      hint = 'COUNT_DATE_INVALID';
  end;
  -- IS-36: desde 30 días atrás hasta ahora, con 5 minutos de tolerancia en los dos extremos por
  -- el reloj del cliente. «infinity» y «-infinity» también caen acá.
  if v_at > now() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'La fecha y la hora del control no pueden ser futuras.', hint = 'COUNT_IN_FUTURE';
  end if;
  if v_at < now() - interval '30 days' - interval '5 minutes' then
    raise exception using errcode = 'P0001',
      message = 'El control no puede ser de hace más de 30 días. Elegí una fecha más reciente.',
      hint = 'COUNTED_AT_OUT_OF_RANGE';
  end if;

  if num_nonnulls(p_reviewer_id, nullif(btrim(p_reviewer_name), '')) <> 1 then
    raise exception using errcode = 'P0001',
      message = 'Indicá quién revisó: una persona de la app o un nombre escrito, no las dos cosas.',
      hint = 'REVIEWER_REQUIRED';
  end if;
  perform app.check_text_max(p_reviewer_name, 120, 'Nombre de quien revisó');
  perform app.check_text_max(p_notes, 500, 'Observaciones del control');
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
      raise exception using errcode = 'P0001', message = 'Las cantidades contadas tienen que ser enteros entre 0 y 1.000.000.', hint = 'INVALID_QTY';
    end if;
    if v_sid = any (v_ids) then
      raise exception using errcode = 'P0001', message = 'Un artículo no puede repetirse en el mismo control.', hint = 'DUPLICATE_SUPPLY';
    end if;
    v_ids := v_ids || v_sid;
    v_counted := v_counted || jsonb_build_array(jsonb_build_object('supply_id', v_sid, 'counted_qty', v_qty));
  end loop;

  insert into public.stock_counts (counted_at, reviewer_id, reviewer_name, notes, created_by)
  values (v_at, p_reviewer_id, nullif(btrim(p_reviewer_name), ''), nullif(btrim(p_notes), ''), v_uid)
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
    v_system := app.supply_stock_at(r.id, v_at);

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

comment on function public.register_stock_count(text, jsonb, uuid, text, text) is
  'Carga un control de stock (0070, IS-16, IS-31; ventana y topes en 0073, IS-36 e IS-37). Exige manage_stock. p_counted_at: fecha y hora del conteo como texto ISO 8601 (es text para poder avisar con COUNT_DATE_INVALID en vez del error del motor); tiene que estar entre 30 días atrás y ahora, con 5 minutos de tolerancia en los dos extremos. La hora se toma tal cual llega, al minuto que mande la interfaz (IS-31): un movimiento registrado en ese mismo minuto cuenta como posterior al control. Revisor: p_reviewer_id (persona de la app) o p_reviewer_name (nombre escrito, hasta 120 caracteres), uno solo; p_notes hasta 500 caracteres. p_lines: [{supply_id, counted_qty (entero de 0 a 1.000.000)}], solo las filas contadas: las en blanco no se mandan y no se tocan. La diferencia de cada artículo es lo contado menos el stock del sistema a p_counted_at (el actual menos los movimientos posteriores), así un retiro hecho entre el conteo y la carga no cuenta como faltante. Guarda el control con todas sus líneas y UN movimiento kind count con las diferencias distintas de cero (null si no hay ninguna). Devuelve {"count": <fila>, "movement": <cabecera o null>, "lines": [{supply_id, code, name, presentation, system_qty, counted_qty, difference}]}. Errores: FORBIDDEN, COUNT_DATE_REQUIRED, COUNT_DATE_INVALID, COUNT_IN_FUTURE, COUNTED_AT_OUT_OF_RANGE, REVIEWER_REQUIRED, REVIEWER_NOT_FOUND, TEXT_TOO_LONG, INVALID_LINES, INVALID_QTY, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, COUNT_INCONSISTENT (los movimientos posteriores dejarían el stock negativo), STOCK_LIMIT.';

revoke execute on function public.register_stock_count(text, jsonb, uuid, text, text) from public, anon;
grant execute on function public.register_stock_count(text, jsonb, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. Faltantes
-- ---------------------------------------------------------------------------------------------

create or replace function public.report_supply_shortage(
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

  perform app.check_text_max(p_description, 200, 'Descripción');
  perform app.check_text_max(p_comment, 500, 'Comentario');

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
  'Avisa que falta un insumo (0070, IS-14, IS-29; topes en 0073). Solo employee y supervisor (FORBIDDEN si no). Un artículo del catálogo (p_supply_id) o un texto libre (p_description, hasta 200 caracteres), uno solo. Turno o sede y comentario (hasta 500 caracteres) opcionales; turno y sede se validan como en register_withdrawal. Devuelve la fila (status open). Errores: FORBIDDEN, SHORTAGE_TARGET_REQUIRED, TEXT_TOO_LONG, SUPPLY_NOT_FOUND, SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED.';

create or replace function public.resolve_supply_shortage(p_report_id uuid, p_note text)
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
  perform app.check_text_max(p_note, 500, 'Nota de resolución');

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
  'Resuelve un aviso de faltante con una nota (0070, IS-21, IS-29; tope en 0073). Dueño y administradores, sin exigir manage_stock. La nota tiene hasta 500 caracteres. Devuelve la fila. Errores: FORBIDDEN, NOTE_REQUIRED, TEXT_TOO_LONG, SHORTAGE_NOT_FOUND, SHORTAGE_ALREADY_RESOLVED.';
