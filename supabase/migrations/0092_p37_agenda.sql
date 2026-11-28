-- 0092_p37_agenda.sql
-- P37.1: sección «Agenda», la pizarra mensual de dueños y administradores (AG-01..AG-20).
--
--   1. Tabla agenda_items (eventos del calendario, bloques de «Nuevos» y notas) con RLS de solo
--      lectura para dueño y administradores. Se escribe únicamente con las RPC.
--   2. Tabla agenda_employee_colors (color de borde y relleno por empleado, AG-16).
--   3. RPC (solo owner y admin): save_agenda_item, delete_agenda_item, set_agenda_item_resolved,
--      duplicate_agenda_item_to_next_month, mark_agenda_item_client, set_agenda_employee_color.
--
-- La pizarra es efímera: el borrado es físico (AG-14). La lista diaria de empleados (AG-15) se
-- arma en el front con las vistas y RPC ya existentes; esta migración no la toca.

-- ---------------------------------------------------------------------------------------------
-- 1. agenda_items
-- ---------------------------------------------------------------------------------------------

create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  month date not null,
  day date,
  slot smallint,
  position int not null default 0,
  -- evento
  work_type text,
  time_text text,
  place text,
  client_person text,
  people text,
  -- nuevo
  place_name text,
  client_name text,
  address text,
  days_hours text,
  budget numeric(14,2),
  -- evento y nuevo
  observation text,
  -- nota
  body text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  border_color smallint,
  fill_color smallint,
  fill_before_resolved smallint,
  client_id uuid references public.clients (id) on delete set null,
  copied_from uuid references public.agenda_items (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint agenda_items_kind_check check (kind in ('evento', 'nuevo', 'nota')),
  constraint agenda_items_month_check check (month = date_trunc('month', month)::date),
  constraint agenda_items_day_check check (
    (kind = 'evento' and day is not null and date_trunc('month', day)::date = month)
    or (kind <> 'evento' and day is null)
  ),
  constraint agenda_items_slot_check check (
    (kind = 'nuevo' and slot is not null and slot between 0 and 6)
    or (kind <> 'nuevo' and slot is null)
  ),
  constraint agenda_items_border_color_check check (border_color is null or border_color between 0 and 19),
  constraint agenda_items_fill_color_check check (fill_color is null or fill_color between 0 and 20),
  constraint agenda_items_fill_before_check check (fill_before_resolved is null or fill_before_resolved between 0 and 19)
);

comment on table public.agenda_items is
  'Pizarra mensual de la Agenda (0092, P37, AG-01): eventos del calendario, bloques de «Nuevos» y notas, en una sola tabla con kind. Una sola pizarra compartida por dueños y administradores. Efímera: el borrado es físico (AG-14). Solo se lee por RLS (owner o admin) y se escribe con las RPC.';
comment on column public.agenda_items.kind is 'evento (celda del calendario), nuevo (bloque de «Nuevos») o nota.';
comment on column public.agenda_items.month is 'Primer día del mes al que pertenece el elemento.';
comment on column public.agenda_items.day is 'Día del evento (dentro de month). Solo para kind = evento; null en los demás.';
comment on column public.agenda_items.slot is 'Columna de «Nuevos», de 0 a 6. Solo para kind = nuevo; null en los demás.';
comment on column public.agenda_items.position is 'Orden entre los elementos del mismo día (eventos), columna (nuevos) o mes (notas).';
comment on column public.agenda_items.work_type is 'Evento: Trabajo (Final de obra, Reunión, Presupuesto, Turno o texto libre).';
comment on column public.agenda_items.time_text is 'Evento: Hora, texto libre.';
comment on column public.agenda_items.place is 'Evento: Lugar, texto libre (sin vínculo con sedes, AG-07).';
comment on column public.agenda_items.client_person is 'Evento: Cliente o persona, texto libre.';
comment on column public.agenda_items.people is 'Evento: Personas, texto libre (varias).';
comment on column public.agenda_items.place_name is 'Nuevo: Nombre del lugar.';
comment on column public.agenda_items.client_name is 'Nuevo: Cliente.';
comment on column public.agenda_items.address is 'Nuevo: Dirección.';
comment on column public.agenda_items.days_hours is 'Nuevo: Días y horario.';
comment on column public.agenda_items.budget is 'Nuevo: Presupuesto en pesos.';
comment on column public.agenda_items.observation is 'Evento y nuevo: Observación.';
comment on column public.agenda_items.body is 'Nota: texto del renglón.';
comment on column public.agenda_items.resolved is 'Check «Resuelto». Lo cambia set_agenda_item_resolved (o mark_agenda_item_client).';
comment on column public.agenda_items.resolved_at is 'Instante en que se marcó como resuelto; null si no lo está.';
comment on column public.agenda_items.border_color is 'Color de borde: índice 0 a 19 de la paleta de la Agenda; null = sin color.';
comment on column public.agenda_items.fill_color is 'Color de relleno: índice 0 a 19 de la paleta; null = sin color. El valor 20 es el «verde resuelto» de la plataforma (el verde de éxito): lo pone set_agenda_item_resolved al resolver, no es un color de la paleta.';
comment on column public.agenda_items.fill_before_resolved is 'Relleno (0 a 19 o null) que tenía el elemento antes de resolverse, para devolverlo al destildar.';
comment on column public.agenda_items.client_id is 'Nuevo: cliente creado a partir del bloque (AG-09); null si no se creó.';
comment on column public.agenda_items.copied_from is 'Elemento del que se duplicó al mes siguiente (AG-13); null si es original o si el original se borró.';

create index agenda_items_month_kind_idx on public.agenda_items (month, kind);
create index agenda_items_day_idx on public.agenda_items (day) where day is not null;

create trigger trg_set_updated_at
before update on public.agenda_items
for each row execute function app.set_updated_at();

alter table public.agenda_items enable row level security;

create policy agenda_items_select_admin
  on public.agenda_items
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.agenda_items from public, anon, authenticated;
grant select on public.agenda_items to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. agenda_employee_colors
-- ---------------------------------------------------------------------------------------------

create table public.agenda_employee_colors (
  employee_id uuid primary key references public.employees (profile_id) on delete cascade,
  border_color smallint,
  fill_color smallint,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint agenda_employee_colors_border_check check (border_color is null or border_color between 0 and 19),
  constraint agenda_employee_colors_fill_check check (fill_color is null or fill_color between 0 and 19)
);

comment on table public.agenda_employee_colors is
  'Color de borde y relleno que la dirección le asigna a cada empleado en la lista diaria de la Agenda (0092, AG-16). Una fila por empleado; sin colores no hay fila. Solo se lee por RLS (owner o admin) y se escribe con set_agenda_employee_color.';
comment on column public.agenda_employee_colors.border_color is 'Índice 0 a 19 de la paleta; null = sin color.';
comment on column public.agenda_employee_colors.fill_color is 'Índice 0 a 19 de la paleta; null = sin color.';

create trigger trg_set_updated_at
before update on public.agenda_employee_colors
for each row execute function app.set_updated_at();

alter table public.agenda_employee_colors enable row level security;

create policy agenda_employee_colors_select_admin
  on public.agenda_employee_colors
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.agenda_employee_colors from public, anon, authenticated;
grant select on public.agenda_employee_colors to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. RPC
-- ---------------------------------------------------------------------------------------------

-- Alta (p_id null) o cambio de un elemento. En el cambio no se modifica kind. Los campos de texto
-- vienen en p_fields (claves: work_type, time_text, place, client_person, people, observation para
-- evento; place_name, client_name, address, days_hours, budget, observation para nuevo; body para
-- nota). Las claves ausentes quedan en null (el cambio reemplaza todos los campos del tipo).
create function public.save_agenda_item(
  p_id uuid,
  p_kind text,
  p_month date,
  p_day date,
  p_slot smallint,
  p_position int,
  p_fields jsonb,
  p_border_color smallint,
  p_fill_color smallint
)
returns public.agenda_items
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item public.agenda_items;
  v_kind text;
  v_f jsonb := coalesce(p_fields, '{}'::jsonb);
  v_month date;
  v_day date;
  v_slot smallint;
  v_position int;
  v_work_type text := nullif(btrim(v_f ->> 'work_type'), '');
  v_time_text text := nullif(btrim(v_f ->> 'time_text'), '');
  v_place text := nullif(btrim(v_f ->> 'place'), '');
  v_client_person text := nullif(btrim(v_f ->> 'client_person'), '');
  v_people text := nullif(btrim(v_f ->> 'people'), '');
  v_observation text := nullif(btrim(v_f ->> 'observation'), '');
  v_place_name text := nullif(btrim(v_f ->> 'place_name'), '');
  v_client_name text := nullif(btrim(v_f ->> 'client_name'), '');
  v_address text := nullif(btrim(v_f ->> 'address'), '');
  v_days_hours text := nullif(btrim(v_f ->> 'days_hours'), '');
  v_budget numeric(14,2);
  v_body text := nullif(btrim(v_f ->> 'body'), '');
begin
  perform app.require_role('owner', 'admin');

  if p_id is null then
    v_kind := p_kind;
  else
    select * into v_item from public.agenda_items where id = p_id for update;
    if v_item.id is null then
      raise exception using errcode = 'P0001',
        message = 'No encontramos ese elemento de la agenda.', hint = 'AGENDA_ITEM_NOT_FOUND';
    end if;
    v_kind := v_item.kind;
  end if;

  if v_kind is null or v_kind not in ('evento', 'nuevo', 'nota') then
    raise exception using errcode = 'P0001',
      message = 'El tipo de elemento tiene que ser evento, nuevo o nota.', hint = 'INVALID_AGENDA_KIND';
  end if;

  if (p_border_color is not null and (p_border_color < 0 or p_border_color > 19))
     or (p_fill_color is not null and (p_fill_color < 0 or p_fill_color > 20)) then
    raise exception using errcode = 'P0001',
      message = 'El color tiene que ser un número de 0 a 19.', hint = 'INVALID_COLOR';
  end if;

  begin
    v_budget := nullif(btrim(v_f ->> 'budget'), '')::numeric(14,2);
  exception when others then
    raise exception using errcode = 'P0001',
      message = 'El presupuesto no es un importe válido.', hint = 'INVALID_BUDGET';
  end;
  if v_budget is not null and v_budget < 0 then
    raise exception using errcode = 'P0001',
      message = 'El presupuesto no puede ser negativo.', hint = 'INVALID_BUDGET';
  end if;

  -- Fecha, columna y vacíos según el tipo.
  if v_kind = 'evento' then
    if p_day is null then
      raise exception using errcode = 'P0001',
        message = 'Elegí el día del evento.', hint = 'INVALID_DATE';
    end if;
    v_day := p_day;
    v_month := date_trunc('month', p_day)::date;
    if v_work_type is null and v_time_text is null and v_place is null and v_client_person is null
       and v_people is null and v_observation is null then
      raise exception using errcode = 'P0001',
        message = 'Completá al menos un dato del evento.', hint = 'EMPTY_AGENDA_ITEM';
    end if;
    v_budget := null;
    v_body := null;
    v_place_name := null; v_client_name := null; v_address := null; v_days_hours := null;
  elsif v_kind = 'nuevo' then
    if p_slot is null or p_slot < 0 or p_slot > 6 then
      raise exception using errcode = 'P0001',
        message = 'La columna de Nuevos tiene que ser de 0 a 6.', hint = 'INVALID_SLOT';
    end if;
    v_slot := p_slot;
    v_month := coalesce(date_trunc('month', p_month)::date, v_item.month);
    if v_month is null then
      raise exception using errcode = 'P0001',
        message = 'Elegí el mes.', hint = 'INVALID_DATE';
    end if;
    if v_place_name is null and v_client_name is null and v_address is null and v_days_hours is null
       and v_budget is null and v_observation is null then
      raise exception using errcode = 'P0001',
        message = 'Completá al menos un dato del bloque.', hint = 'EMPTY_AGENDA_ITEM';
    end if;
    v_body := null;
    v_work_type := null; v_time_text := null; v_place := null; v_client_person := null; v_people := null;
  else
    v_month := coalesce(date_trunc('month', p_month)::date, v_item.month);
    if v_month is null then
      raise exception using errcode = 'P0001',
        message = 'Elegí el mes.', hint = 'INVALID_DATE';
    end if;
    if v_body is null or char_length(v_body) > 1000 then
      raise exception using errcode = 'P0001',
        message = 'La nota tiene que tener entre 1 y 1000 caracteres.', hint = 'EMPTY_AGENDA_ITEM';
    end if;
    v_observation := null; v_budget := null;
    v_work_type := null; v_time_text := null; v_place := null; v_client_person := null; v_people := null;
    v_place_name := null; v_client_name := null; v_address := null; v_days_hours := null;
  end if;

  if p_id is null then
    v_position := coalesce(
      p_position,
      (select coalesce(max(i.position), -1) + 1 from public.agenda_items i
        where i.month = v_month and i.kind = v_kind)
    );
    insert into public.agenda_items (
      kind, month, day, slot, position, work_type, time_text, place, client_person, people,
      place_name, client_name, address, days_hours, budget, observation, body,
      border_color, fill_color, created_by, updated_by
    ) values (
      v_kind, v_month, v_day, v_slot, v_position, v_work_type, v_time_text, v_place, v_client_person, v_people,
      v_place_name, v_client_name, v_address, v_days_hours, v_budget, v_observation, v_body,
      p_border_color, p_fill_color, auth.uid(), auth.uid()
    ) returning * into v_item;
  else
    update public.agenda_items
    set month = v_month, day = v_day, slot = v_slot,
        position = coalesce(p_position, position),
        work_type = v_work_type, time_text = v_time_text, place = v_place,
        client_person = v_client_person, people = v_people,
        place_name = v_place_name, client_name = v_client_name, address = v_address,
        days_hours = v_days_hours, budget = v_budget, observation = v_observation, body = v_body,
        border_color = p_border_color, fill_color = p_fill_color,
        updated_by = auth.uid()
    where id = p_id
    returning * into v_item;
  end if;

  return v_item;
end;
$$;

comment on function public.save_agenda_item(uuid, text, date, date, smallint, int, jsonb, smallint, smallint) is
  'Alta (p_id null) o cambio de un elemento de la Agenda (0092, AG-04/05/08/10/11). Solo O, A (FORBIDDEN si no). En el cambio no se modifica kind. Evento: p_day obligatorio (INVALID_DATE), month se deriva de p_day (así se mueve a otro día); Nuevo: p_slot de 0 a 6 (INVALID_SLOT), p_month; Nota: p_month. p_fields (jsonb) trae los textos según el tipo (evento: work_type, time_text, place, client_person, people, observation; nuevo: place_name, client_name, address, days_hours, budget, observation; nota: body); las claves ausentes quedan en null y el cambio reemplaza todos los campos. EMPTY_AGENDA_ITEM si el elemento queda vacío, INVALID_BUDGET, INVALID_AGENDA_KIND, INVALID_COLOR (borde 0 a 19; relleno 0 a 19, o 20 = verde resuelto), AGENDA_ITEM_NOT_FOUND. p_position null: al final en el alta, sin cambio en la edición. No toca resolved. Devuelve la fila.';

revoke execute on function public.save_agenda_item(uuid, text, date, date, smallint, int, jsonb, smallint, smallint) from public, anon;
grant execute on function public.save_agenda_item(uuid, text, date, date, smallint, int, jsonb, smallint, smallint) to authenticated;

create function public.delete_agenda_item(p_id uuid)
returns public.agenda_items
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item public.agenda_items;
begin
  perform app.require_role('owner', 'admin');

  delete from public.agenda_items where id = p_id returning * into v_item;

  if v_item.id is null then
    raise exception using errcode = 'P0001',
      message = 'No encontramos ese elemento de la agenda.', hint = 'AGENDA_ITEM_NOT_FOUND';
  end if;

  return v_item;
end;
$$;

comment on function public.delete_agenda_item(uuid) is
  'Borra de forma definitiva un elemento de la Agenda (0092, AG-14). Solo O, A. AGENDA_ITEM_NOT_FOUND si no existe. Los duplicados que lo tenían como origen quedan con copied_from null. Devuelve la fila borrada.';

revoke execute on function public.delete_agenda_item(uuid) from public, anon;
grant execute on function public.delete_agenda_item(uuid) to authenticated;

-- Marca o desmarca «Resuelto» sobre una fila ya leída (uso interno de las RPC).
create function app.agenda_apply_resolved(p_item public.agenda_items, p_resolved boolean)
returns public.agenda_items
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_item public.agenda_items;
begin
  if p_resolved then
    if p_item.resolved then
      return p_item;
    end if;
    update public.agenda_items
    set resolved = true,
        resolved_at = now(),
        fill_before_resolved = case when p_item.fill_color = 20 then p_item.fill_before_resolved else p_item.fill_color end,
        fill_color = 20,
        updated_by = auth.uid()
    where id = p_item.id
    returning * into v_item;
  else
    update public.agenda_items
    set resolved = false,
        resolved_at = null,
        fill_color = case when p_item.fill_color = 20 then p_item.fill_before_resolved else p_item.fill_color end,
        fill_before_resolved = null,
        updated_by = auth.uid()
    where id = p_item.id
    returning * into v_item;
  end if;
  return v_item;
end;
$$;

comment on function app.agenda_apply_resolved(public.agenda_items, boolean) is
  'Uso interno (0092): aplica la regla del verde resuelto (AG-12). Al resolver guarda el relleno en fill_before_resolved y pone fill_color = 20; al destildar, si el relleno sigue en 20, lo restaura.';

revoke execute on function app.agenda_apply_resolved(public.agenda_items, boolean) from public, anon, authenticated;

create function public.set_agenda_item_resolved(p_id uuid, p_resolved boolean)
returns public.agenda_items
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item public.agenda_items;
begin
  perform app.require_role('owner', 'admin');

  select * into v_item from public.agenda_items where id = p_id for update;
  if v_item.id is null then
    raise exception using errcode = 'P0001',
      message = 'No encontramos ese elemento de la agenda.', hint = 'AGENDA_ITEM_NOT_FOUND';
  end if;

  return app.agenda_apply_resolved(v_item, coalesce(p_resolved, false));
end;
$$;

comment on function public.set_agenda_item_resolved(uuid, boolean) is
  'Marca o desmarca «Resuelto» (0092, AG-12). Solo O, A. Al marcar: fill_before_resolved = fill_color, fill_color = 20 (verde resuelto), resolved_at = now(). Al desmarcar: si fill_color sigue en 20 vuelve a fill_before_resolved (si lo cambiaron a mano, se respeta); limpia resolved_at. Marcar uno ya resuelto no cambia nada. AGENDA_ITEM_NOT_FOUND. Devuelve la fila.';

revoke execute on function public.set_agenda_item_resolved(uuid, boolean) from public, anon;
grant execute on function public.set_agenda_item_resolved(uuid, boolean) to authenticated;

create function public.duplicate_agenda_item_to_next_month(p_id uuid)
returns public.agenda_items
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_src public.agenda_items;
  v_new public.agenda_items;
  v_next date;
  v_day date;
  v_fill smallint;
begin
  perform app.require_role('owner', 'admin');

  select * into v_src from public.agenda_items where id = p_id;
  if v_src.id is null then
    raise exception using errcode = 'P0001',
      message = 'No encontramos ese elemento de la agenda.', hint = 'AGENDA_ITEM_NOT_FOUND';
  end if;

  v_next := (v_src.month + interval '1 month')::date;

  if v_src.kind = 'evento' then
    -- Mismo número de día, o el último del mes siguiente si ese día no existe (31 oct a 30 nov).
    v_day := v_next + (least(
      extract(day from v_src.day)::int,
      extract(day from (v_next + interval '1 month - 1 day'))::int
    ) - 1);
  end if;

  v_fill := case when v_src.resolved and v_src.fill_color = 20 then v_src.fill_before_resolved else v_src.fill_color end;

  insert into public.agenda_items (
    kind, month, day, slot, position, work_type, time_text, place, client_person, people,
    place_name, client_name, address, days_hours, budget, observation, body,
    resolved, resolved_at, border_color, fill_color, fill_before_resolved,
    client_id, copied_from, created_by, updated_by
  ) values (
    v_src.kind, v_next, v_day, v_src.slot,
    (select coalesce(max(i.position), -1) + 1 from public.agenda_items i where i.month = v_next and i.kind = v_src.kind),
    v_src.work_type, v_src.time_text, v_src.place, v_src.client_person, v_src.people,
    v_src.place_name, v_src.client_name, v_src.address, v_src.days_hours, v_src.budget, v_src.observation, v_src.body,
    false, null, v_src.border_color, v_fill, null,
    null, v_src.id, auth.uid(), auth.uid()
  ) returning * into v_new;

  return v_new;
end;
$$;

comment on function public.duplicate_agenda_item_to_next_month(uuid) is
  'Copia un elemento al mes siguiente (0092, AG-13). Solo O, A. La copia sale sin resolver (resolved false, sin resolved_at), con el relleno de antes de resolver si el original estaba en verde, sin client_id, con copied_from = original y position al final. Evento: mismo número de día o el último del mes siguiente (31 oct a 30 nov). Nuevo: misma columna. AGENDA_ITEM_NOT_FOUND. Devuelve la fila nueva.';

revoke execute on function public.duplicate_agenda_item_to_next_month(uuid) from public, anon;
grant execute on function public.duplicate_agenda_item_to_next_month(uuid) to authenticated;

create function public.mark_agenda_item_client(p_id uuid, p_client_id uuid)
returns public.agenda_items
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_item public.agenda_items;
begin
  perform app.require_role('owner', 'admin');

  select * into v_item from public.agenda_items where id = p_id for update;
  if v_item.id is null then
    raise exception using errcode = 'P0001',
      message = 'No encontramos ese elemento de la agenda.', hint = 'AGENDA_ITEM_NOT_FOUND';
  end if;

  if v_item.kind <> 'nuevo' then
    raise exception using errcode = 'P0001',
      message = 'Solo los bloques de Nuevos se pueden vincular a un cliente.', hint = 'INVALID_AGENDA_KIND';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.deleted_at is null) then
    raise exception using errcode = 'P0001',
      message = 'No encontramos a ese cliente.', hint = 'CLIENT_NOT_FOUND';
  end if;

  update public.agenda_items set client_id = p_client_id, updated_by = auth.uid()
  where id = p_id returning * into v_item;

  return app.agenda_apply_resolved(v_item, true);
end;
$$;

comment on function public.mark_agenda_item_client(uuid, uuid) is
  'Vincula un bloque de Nuevos con el cliente creado a partir de él y lo marca como resuelto, con la regla del verde (0092, AG-09). Solo O, A. INVALID_AGENDA_KIND si no es kind nuevo, CLIENT_NOT_FOUND, AGENDA_ITEM_NOT_FOUND. Devuelve la fila.';

revoke execute on function public.mark_agenda_item_client(uuid, uuid) from public, anon;
grant execute on function public.mark_agenda_item_client(uuid, uuid) to authenticated;

create function public.set_agenda_employee_color(
  p_employee_id uuid,
  p_border smallint,
  p_fill smallint
)
returns public.agenda_employee_colors
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.agenda_employee_colors;
begin
  perform app.require_role('owner', 'admin');

  if not exists (
    select 1 from public.employees e where e.profile_id = p_employee_id and e.deleted_at is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'No encontramos a esa persona.', hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  if (p_border is not null and (p_border < 0 or p_border > 19))
     or (p_fill is not null and (p_fill < 0 or p_fill > 19)) then
    raise exception using errcode = 'P0001',
      message = 'El color tiene que ser un número de 0 a 19.', hint = 'INVALID_COLOR';
  end if;

  if p_border is null and p_fill is null then
    delete from public.agenda_employee_colors where employee_id = p_employee_id returning * into v_row;
    return v_row;
  end if;

  insert into public.agenda_employee_colors (employee_id, border_color, fill_color, updated_by)
  values (p_employee_id, p_border, p_fill, auth.uid())
  on conflict (employee_id) do update
    set border_color = excluded.border_color, fill_color = excluded.fill_color, updated_by = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_agenda_employee_color(uuid, smallint, smallint) is
  'Fija el color de borde y relleno de un empleado en la lista de la Agenda (0092, AG-16). Solo O, A. Upsert; si p_border y p_fill son null borra la fila (devuelve la fila borrada, o una fila vacía si no había). EMPLOYEE_NOT_FOUND, INVALID_COLOR (0 a 19).';

revoke execute on function public.set_agenda_employee_color(uuid, smallint, smallint) from public, anon;
grant execute on function public.set_agenda_employee_color(uuid, smallint, smallint) to authenticated;
