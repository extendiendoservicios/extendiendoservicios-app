-- =================================================================================================
-- 0078_p27_1_categorias_y_borrado_del_dueno.sql (P27.1, observaciones de los dueños del 2 nov 2026)
--
-- Primera de tres migraciones (0078 a 0080). Contenido:
--
--   1. OD-20: categorías de clientes. Tabla client_categories (nombre único entre las vigentes,
--      orden, baja lógica), clients.category_id (nula; los clientes que ya existen quedan sin
--      categoría), las cuatro categorías iniciales (Edificio, Empresa, Casa, Final de obra) y las
--      RPC upsert_client_category, reorder_client_categories y remove_client_category. La
--      capacidad es la que hoy gobierna a los clientes: dueño o administrador (app.require_admin).
--      v_clients suma category_id y category_name al final.
--   2. OD-22 y OD-23: borrado físico, solo del dueño (excepción a P-014). Para turno, servicio,
--      turnos de un servicio desde una fecha, sede, cliente y empleado hay una función de vista
--      previa (owner_delete_preview_*) que devuelve qué se borra y qué lo frena, y la función de
--      borrado (owner_delete_*), que repite las mismas comprobaciones dentro de la transacción,
--      borra de abajo hacia arriba y deja un evento record_deleted en security_events con una copia
--      JSON de lo borrado. Se borra solo lo que no tiene historia (ver app.shift_history y los
--      bloqueos de cada entidad más abajo). Las claves foráneas (sin cascada) quedan como última
--      red: si apareciera historia entre la comprobación y el borrado, la transacción falla entera.
--
-- Nota técnica: el valor nuevo de security_event_type ('record_deleted') se agrega acá y solo se usa
-- dentro del cuerpo de las funciones (se resuelve al ejecutarlas, ya con el valor confirmado). Mismo
-- criterio que 0032, 0062 y 0069, pero sin archivo aparte porque la numeración 0078 a 0080 está fija.
-- =================================================================================================

alter type public.security_event_type add value if not exists 'record_deleted';

comment on type public.security_event_type is 'Tipo de evento de seguridad registrado en security_events (04 sección 2.6). Incluye admin_action_rejected (0030), name_changed (0032), los de B1 (0052), workday_corrected / workday_auto_closed (0062, P24.1), stock_movement_voided / supply_price_changed (0069, P25.1) y record_deleted (0078, P27.1: borrado físico del dueño, con copia JSON de lo borrado en details).';

-- ---------------------------------------------------------------------------------------------
-- 1. Categorías de clientes (OD-20)
-- ---------------------------------------------------------------------------------------------

create table public.client_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint client_categories_name_check check (name = btrim(name) and char_length(name) between 1 and 60)
);

comment on table public.client_categories is
  'Categorías de clientes (0078, OD-20): Edificio, Empresa, Casa, Final de obra y las que cargue la empresa en Configuración. Cada cliente tiene una (clients.category_id, opcional). name único entre las vigentes sin distinguir mayúsculas; sort_order define el orden del desplegable y de los grupos del listado; deleted_at = baja lógica. Solo escriben las RPC upsert_client_category, reorder_client_categories y remove_client_category; leen dueño y administradores.';

create unique index client_categories_name_key
  on public.client_categories (lower(name))
  where deleted_at is null;

create index client_categories_sort_order_idx
  on public.client_categories (sort_order, name)
  where deleted_at is null;

create trigger trg_set_updated_at
before update on public.client_categories
for each row execute function app.set_updated_at();

alter table public.client_categories enable row level security;

create policy client_categories_select_admin
  on public.client_categories for select to authenticated
  using ((select app.is_admin()));

revoke all on public.client_categories from public, anon, authenticated;
grant select on public.client_categories to authenticated;

alter table public.clients
  add column category_id uuid references public.client_categories (id);

comment on column public.clients.category_id is
  'Categoría del cliente (0078, OD-20). Opcional: los clientes anteriores quedan sin categoría. No admite una categoría dada de baja (trigger trg_clients_check_category).';

create index clients_category_id_idx on public.clients (category_id) where category_id is not null;

-- Los clientes se escriben con inserts y updates directos (RLS: dueño y administrador): la categoría
-- se valida acá para que no se pueda dejar apuntando a una categoría dada de baja.
create function app.check_client_category()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.category_id is not null
    and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
    and not exists (
      select 1 from public.client_categories cc
      where cc.id = new.category_id and cc.deleted_at is null
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'Esa categoría no existe o fue dada de baja.',
      hint = 'CATEGORY_NOT_FOUND';
  end if;

  return new;
end;
$$;

comment on function app.check_client_category() is
  'Trigger de clients (0078, OD-20): rechaza con CATEGORY_NOT_FOUND una category_id inexistente o dada de baja.';

revoke execute on function app.check_client_category() from public, anon, authenticated;

create trigger trg_clients_check_category
before insert or update of category_id on public.clients
for each row execute function app.check_client_category();

-- Categorías iniciales (OD-20). Idempotente: no pisa una categoría que ya exista con ese nombre.
insert into public.client_categories (name, sort_order)
select v.name, v.sort_order
from (values ('Edificio', 1), ('Empresa', 2), ('Casa', 3), ('Final de obra', 4)) as v (name, sort_order)
where not exists (
  select 1 from public.client_categories cc
  where lower(cc.name) = lower(v.name) and cc.deleted_at is null
);

-- 1.1 upsert_client_category: alta (p_id nulo) o cambio de nombre / orden.
create function public.upsert_client_category(
  p_name text,
  p_id uuid default null,
  p_sort_order integer default null
)
returns public.client_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_row public.client_categories;
begin
  perform app.require_admin();

  if v_name = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el nombre de la categoría.',
      hint = 'NAME_REQUIRED';
  end if;

  if char_length(v_name) > 60 then
    raise exception using
      errcode = 'P0001',
      message = 'El nombre de la categoría puede tener hasta 60 caracteres.',
      hint = 'NAME_TOO_LONG';
  end if;

  begin
    if p_id is null then
      insert into public.client_categories (name, sort_order, created_by, updated_by)
      values (
        v_name,
        coalesce(p_sort_order, (select coalesce(max(cc.sort_order), 0) + 1 from public.client_categories cc where cc.deleted_at is null)),
        auth.uid(),
        auth.uid()
      )
      returning * into v_row;
    else
      update public.client_categories
      set name = v_name,
          sort_order = coalesce(p_sort_order, sort_order),
          updated_by = auth.uid()
      where id = p_id and deleted_at is null
      returning * into v_row;

      if v_row.id is null then
        raise exception using
          errcode = 'P0001',
          message = 'No encontramos esa categoría.',
          hint = 'CATEGORY_NOT_FOUND';
      end if;
    end if;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ya existe una categoría con ese nombre.',
        hint = 'CATEGORY_NAME_TAKEN';
  end;

  return v_row;
end;
$$;

comment on function public.upsert_client_category(text, uuid, integer) is
  'Alta (p_id nulo; sin p_sort_order queda al final) o edición (nombre y/o orden) de una categoría de clientes (0078, OD-20). O, A (FORBIDDEN si no). NAME_REQUIRED, NAME_TOO_LONG (60), CATEGORY_NOT_FOUND (p_id inexistente o dado de baja), CATEGORY_NAME_TAKEN (otra vigente con el mismo nombre, sin distinguir mayúsculas). Devuelve la fila.';

-- 1.2 reorder_client_categories: el orden pasa a ser el de la lista (1, 2, 3...).
create function public.reorder_client_categories(p_ids uuid[])
returns setof public.client_categories
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[] := coalesce(p_ids, array[]::uuid[]);
begin
  perform app.require_admin();

  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x)
    or exists (
      select 1 from unnest(v_ids) as x
      where not exists (select 1 from public.client_categories cc where cc.id = x and cc.deleted_at is null)
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'La lista de categorías tiene repetidas o inexistentes.',
      hint = 'CATEGORY_NOT_FOUND';
  end if;

  -- Las de la lista, en ese orden; las que no vienen quedan después, en su orden anterior.
  update public.client_categories cc
  set sort_order = o.new_order,
      updated_by = auth.uid()
  from (
    select cc2.id,
           row_number() over (
             order by coalesce(array_position(v_ids, cc2.id), 1000000), cc2.sort_order, cc2.name
           )::integer as new_order
    from public.client_categories cc2
    where cc2.deleted_at is null
  ) o
  where cc.id = o.id and cc.sort_order is distinct from o.new_order;

  return query
    select * from public.client_categories cc
    where cc.deleted_at is null
    order by cc.sort_order, cc.name;
end;
$$;

comment on function public.reorder_client_categories(uuid[]) is
  'Ordena las categorías vigentes según la lista (0078, OD-20): las de p_ids quedan primero y en ese orden; las que no vienen, después, en su orden anterior. O, A. CATEGORY_NOT_FOUND (repetidas, inexistentes o dadas de baja). Devuelve todas las vigentes ordenadas.';

-- 1.3 remove_client_category: baja lógica. Los clientes que la tenían quedan sin categoría.
create function public.remove_client_category(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.client_categories;
  v_cleared integer;
begin
  perform app.require_admin();

  update public.client_categories
  set deleted_at = now(), updated_by = auth.uid()
  where id = p_id and deleted_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa categoría.',
      hint = 'CATEGORY_NOT_FOUND';
  end if;

  update public.clients
  set category_id = null, updated_by = auth.uid()
  where category_id = p_id;

  get diagnostics v_cleared = row_count;

  return jsonb_build_object('category', to_jsonb(v_row), 'clients_cleared', v_cleared);
end;
$$;

comment on function public.remove_client_category(uuid) is
  'Baja lógica de una categoría de clientes (0078, OD-20). Los clientes que la tenían quedan sin categoría (la cantidad vuelve en clients_cleared, para avisar antes en la pantalla). O, A. CATEGORY_NOT_FOUND. Devuelve {"category": fila, "clients_cleared": n}.';

revoke execute on function public.upsert_client_category(text, uuid, integer) from public, anon;
revoke execute on function public.reorder_client_categories(uuid[]) from public, anon;
revoke execute on function public.remove_client_category(uuid) from public, anon;
grant execute on function public.upsert_client_category(text, uuid, integer) to authenticated, service_role;
grant execute on function public.reorder_client_categories(uuid[]) to authenticated, service_role;
grant execute on function public.remove_client_category(uuid) to authenticated, service_role;

-- 1.4 v_clients: category_id y category_name al final (create or replace; opciones y grants no cambian).
create or replace view public.v_clients
with (security_invoker = true)
as
select
  c.id,
  c.legal_name,
  c.trade_name,
  c.cuit,
  c.admin_address,
  c.latitude,
  c.longitude,
  c.status,
  c.notes,
  coalesce(s.sites_count, 0) as sites_count,
  coalesce(sv.active_services_count, 0) as active_services_count,
  c.created_at,
  c.updated_at,
  c.created_by,
  c.updated_by,
  c.deleted_at,
  c.photo_path,
  c.calendar_color,
  c.category_id,
  cc.name as category_name
from public.clients c
left join public.client_categories cc on cc.id = c.category_id and cc.deleted_at is null
left join lateral (
  select count(*) as sites_count
  from public.sites st
  where st.client_id = c.id
    and st.deleted_at is null
) s on true
left join lateral (
  select count(*) as active_services_count
  from public.services se
  where se.client_id = c.id
    and se.status = 'active'
    and se.deleted_at is null
) sv on true;

comment on column public.v_clients.category_id is
  'Categoría del cliente (0078, OD-20); nula si no tiene.';
comment on column public.v_clients.category_name is
  'Nombre de la categoría vigente del cliente (0078, OD-20); nulo si no tiene (el listado la agrupa en «Sin categoría»).';

-- ---------------------------------------------------------------------------------------------
-- 2. Borrado físico del dueño (OD-22, OD-23): auxiliares
-- ---------------------------------------------------------------------------------------------

-- 2.1 Texto con la cantidad: «1 fichaje» / «3 fichajes».
create function app.od_count(p_count bigint, p_one text, p_many text)
returns text
language sql
immutable
as $$
  select p_count::text || ' ' || case when p_count = 1 then p_one else p_many end;
$$;

comment on function app.od_count(bigint, text, text) is
  'Uso interno (0078): «1 fichaje» / «3 fichajes».';

-- 2.2 Un bloqueo y un renglón de «qué se borra», como jsonb.
create function app.od_blocker(p_code text, p_count bigint, p_message text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('code', p_code, 'count', p_count, 'message', p_message);
$$;

create function app.od_item(p_code text, p_label text, p_count bigint)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('code', p_code, 'label', p_label, 'count', p_count);
$$;

comment on function app.od_blocker(text, bigint, text) is
  'Uso interno (0078): {"code", "count", "message"} de un bloqueo del borrado del dueño.';
comment on function app.od_item(text, text, bigint) is
  'Uso interno (0078): {"code", "label", "count"} de un renglón de «qué se va a borrar».';

-- 2.3 Corta con DELETE_BLOCKED y el detalle de los bloqueos (en `detail`, como texto JSON).
create function app.od_raise_blocked(p_subject text, p_blockers jsonb)
returns void
language plpgsql
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'No se puede eliminar ' || p_subject || '. '
      || (select string_agg(b ->> 'message', ' ') from jsonb_array_elements(p_blockers) b),
    hint = 'DELETE_BLOCKED',
    detail = p_blockers::text;
end;
$$;

comment on function app.od_raise_blocked(text, jsonb) is
  'Uso interno (0078): DELETE_BLOCKED con los mensajes de cada bloqueo; el arreglo completo ({code, count, message}) va en el detalle del error.';

-- 2.4 Confirmación por nombre (OD-23): el nombre escrito tiene que coincidir con el del registro
--     (sin distinguir mayúsculas ni espacios de más). La pantalla lo pide; acá se vuelve a verificar.
create function app.od_check_confirm(p_given text, p_expected text[])
returns void
language plpgsql
immutable
as $$
declare
  v_given text := lower(btrim(regexp_replace(coalesce(p_given, ''), '\s+', ' ', 'g')));
begin
  if v_given = '' or not exists (
    select 1 from unnest(p_expected) e
    where e is not null and lower(btrim(regexp_replace(e, '\s+', ' ', 'g'))) = v_given
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'El nombre que escribiste no coincide. Escribí «' || p_expected[1] || '» tal cual para confirmar.',
      hint = 'CONFIRM_NAME_MISMATCH';
  end if;
end;
$$;

comment on function app.od_check_confirm(text, text[]) is
  'Uso interno (0078, OD-23): CONFIRM_NAME_MISMATCH si p_given (sin mayúsculas ni espacios de más) no es ninguno de los nombres aceptados (el primero es el que se muestra).';

revoke execute on function app.od_count(bigint, text, text) from public, anon, authenticated;
revoke execute on function app.od_blocker(text, bigint, text) from public, anon, authenticated;
revoke execute on function app.od_item(text, text, bigint) from public, anon, authenticated;
revoke execute on function app.od_raise_blocked(text, jsonb) from public, anon, authenticated;
revoke execute on function app.od_check_confirm(text, text[]) from public, anon, authenticated;

-- 2.5 Historia de un turno: cuántas filas de cada tipo cuelgan de él (todas cuentan, también las
--     dadas de baja). Es lo que impide borrarlo.
--       attendance      fichajes (attendance_records de sus asignaciones)
--       notices         avisos de demora / en camino / ausencia (attendance_notices)
--       supervisions    supervisiones, en cualquier estado
--       ratings         calificaciones
--       media           fotos y videos (shift_media, también los dados de baja: dejan archivo)
--       tasks_done      tareas con actividad (estado distinto de «pendiente»)
--       stock           movimientos de stock del turno
--       shortages       avisos de faltante de insumos del turno
create function app.shift_history(p_shift_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'attendance', (select count(*) from public.attendance_records ar
                   join public.assignments a on a.id = ar.assignment_id where a.shift_id = p_shift_id),
    'notices', (select count(*) from public.attendance_notices n
                join public.assignments a on a.id = n.assignment_id where a.shift_id = p_shift_id),
    'supervisions', (select count(*) from public.supervisions s where s.shift_id = p_shift_id),
    'ratings', (select count(*) from public.ratings r
                join public.assignments a on a.id = r.assignment_id where a.shift_id = p_shift_id),
    'media', (select count(*) from public.shift_media m where m.shift_id = p_shift_id),
    'tasks_done', (select count(*) from public.shift_tasks t where t.shift_id = p_shift_id and t.status <> 'pending'),
    'stock', (select count(*) from public.stock_movements sm where sm.shift_id = p_shift_id),
    'shortages', (select count(*) from public.supply_shortage_reports sr where sr.shift_id = p_shift_id)
  );
$$;

comment on function app.shift_history(uuid) is
  'Uso interno (0078, OD-22): conteo de la historia de un turno {attendance, notices, supervisions, ratings, media, tasks_done, stock, shortages}. Un turno con algún conteo mayor que cero no se borra.';

create function app.shift_has_history(p_shift_id uuid)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from jsonb_each_text(app.shift_history(p_shift_id)) h where h.value::bigint > 0
  );
$$;

comment on function app.shift_has_history(uuid) is
  'Uso interno (0078, OD-22): true si el turno tiene historia (algún conteo de app.shift_history mayor que cero).';

-- Bloqueos de un turno como arreglo de {code, count, message}.
create function app.od_shift_blockers(p_shift_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  h jsonb := app.shift_history(p_shift_id);
  v jsonb := '[]'::jsonb;
  n bigint;
begin
  n := (h ->> 'attendance')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_ATTENDANCE', n, 'Este turno tiene ' || app.od_count(n, 'fichaje', 'fichajes') || '.'); end if;
  n := (h ->> 'notices')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_NOTICES', n, 'Este turno tiene ' || app.od_count(n, 'aviso de demora o ausencia', 'avisos de demora o ausencia') || '.'); end if;
  n := (h ->> 'supervisions')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_SUPERVISIONS', n, 'Este turno tiene ' || app.od_count(n, 'supervisión', 'supervisiones') || '.'); end if;
  n := (h ->> 'ratings')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_RATINGS', n, 'Este turno tiene ' || app.od_count(n, 'calificación', 'calificaciones') || '.'); end if;
  n := (h ->> 'media')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_MEDIA', n, 'Este turno tiene ' || app.od_count(n, 'foto o video', 'fotos o videos') || '.'); end if;
  n := (h ->> 'tasks_done')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_DONE_TASKS', n, 'Este turno tiene ' || app.od_count(n, 'tarea ya trabajada', 'tareas ya trabajadas') || '.'); end if;
  n := (h ->> 'stock')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_STOCK', n, 'Este turno tiene ' || app.od_count(n, 'movimiento de stock', 'movimientos de stock') || '.'); end if;
  n := (h ->> 'shortages')::bigint;
  if n > 0 then v := v || app.od_blocker('HAS_SHORTAGES', n, 'Este turno tiene ' || app.od_count(n, 'aviso de faltante', 'avisos de faltante') || '.'); end if;
  return v;
end;
$$;

comment on function app.od_shift_blockers(uuid) is
  'Uso interno (0078, OD-22): bloqueos del borrado de un turno [{code, count, message}] con code HAS_ATTENDANCE, HAS_NOTICES, HAS_SUPERVISIONS, HAS_RATINGS, HAS_MEDIA, HAS_DONE_TASKS, HAS_STOCK o HAS_SHORTAGES.';

-- Borra las filas de un turno sin historia (de abajo hacia arriba) y devuelve su copia y los conteos.
-- No comprueba nada: quien la llama ya verificó que no hay historia.
create function app.od_delete_shift_rows(p_shift_id uuid)
returns jsonb
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_snapshot jsonb;
  v_assignments integer;
  v_tasks integer;
  v_obs integer;
begin
  select jsonb_build_object(
    'shift', to_jsonb(sh),
    'assignments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.assignments a where a.shift_id = sh.id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.position) from public.shift_tasks t where t.shift_id = sh.id), '[]'::jsonb),
    'observation', (select to_jsonb(o) from public.shift_observations o where o.shift_id = sh.id)
  )
  into v_snapshot
  from public.shifts sh
  where sh.id = p_shift_id;

  delete from public.shift_tasks where shift_id = p_shift_id;
  get diagnostics v_tasks = row_count;
  delete from public.shift_observations where shift_id = p_shift_id;
  get diagnostics v_obs = row_count;
  delete from public.assignments where shift_id = p_shift_id;
  get diagnostics v_assignments = row_count;
  delete from public.shifts where id = p_shift_id;

  return jsonb_build_object(
    'snapshot', v_snapshot,
    'assignments', v_assignments,
    'tasks', v_tasks,
    'observations', v_obs
  );
end;
$$;

comment on function app.od_delete_shift_rows(uuid) is
  'Uso interno (0078, OD-22): borra un turno sin historia con sus asignaciones, tareas y observación; devuelve {snapshot, assignments, tasks, observations}. No comprueba la historia: la comprueba quien la llama.';

revoke execute on function app.shift_history(uuid) from public, anon, authenticated;
revoke execute on function app.shift_has_history(uuid) from public, anon, authenticated;
revoke execute on function app.od_shift_blockers(uuid) from public, anon, authenticated;
revoke execute on function app.od_delete_shift_rows(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Turno
-- ---------------------------------------------------------------------------------------------

-- Plan de borrado de un turno: {name, expected, blockers, will_delete}. Nulo si el turno no existe.
create function app.od_plan_shift(p_shift_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_site text;
  v_assignments bigint;
  v_tasks bigint;
  v_obs bigint;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_shift from public.shifts where id = p_shift_id;
  if v_shift.id is null then
    return null;
  end if;

  select s.name into v_site from public.sites s where s.id = v_shift.site_id;

  select count(*) into v_assignments from public.assignments where shift_id = p_shift_id;
  select count(*) into v_tasks from public.shift_tasks where shift_id = p_shift_id;
  select count(*) into v_obs from public.shift_observations where shift_id = p_shift_id;

  v_items := v_items || app.od_item('shift', 'El turno', 1);
  if v_assignments > 0 then v_items := v_items || app.od_item('assignments', 'Asignaciones de empleados', v_assignments); end if;
  if v_tasks > 0 then v_items := v_items || app.od_item('tasks', 'Tareas del checklist', v_tasks); end if;
  if v_obs > 0 then v_items := v_items || app.od_item('observations', 'Observación del turno', v_obs); end if;

  return jsonb_build_object(
    'name', coalesce(v_site, 'Turno') || ' · ' || to_char(v_shift.shift_date, 'DD/MM/YYYY')
      || ' ' || left(v_shift.start_time::text, 5) || ' a ' || left(v_shift.end_time::text, 5),
    'expected', jsonb_build_array(v_site),
    'blockers', app.od_shift_blockers(p_shift_id),
    'will_delete', v_items,
    'extra', jsonb_build_object(
      'shift_date', v_shift.shift_date,
      'status', v_shift.status,
      'service_id', v_shift.service_id,
      'site_name', v_site
    )
  );
end;
$$;

comment on function app.od_plan_shift(uuid) is
  'Uso interno (0078, OD-22): plan de borrado de un turno. Nulo si no existe.';

revoke execute on function app.od_plan_shift(uuid) from public, anon, authenticated;

create function public.owner_delete_preview_shift(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  v_plan := app.od_plan_shift(p_shift_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'shift',
    'id', p_shift_id,
    'name', v_plan ->> 'name',
    'can_delete', jsonb_array_length(v_plan -> 'blockers') = 0,
    'blockers', v_plan -> 'blockers',
    'will_delete', v_plan -> 'will_delete'
  ) || (v_plan -> 'extra');
end;
$$;

comment on function public.owner_delete_preview_shift(uuid) is
  'Vista previa del borrado de un turno (0078, OD-22, OD-23). Solo el dueño (FORBIDDEN si no). SHIFT_NOT_FOUND. Devuelve {"entity": "shift", "id", "name", "can_delete", "blockers": [{code, count, message}], "will_delete": [{code, label, count}], "shift_date", "status", "service_id", "site_name"}. Bloqueos: HAS_ATTENDANCE, HAS_NOTICES, HAS_SUPERVISIONS, HAS_RATINGS, HAS_MEDIA, HAS_DONE_TASKS, HAS_STOCK, HAS_SHORTAGES.';

create function public.owner_delete_shift(p_shift_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_res jsonb;
  v_event public.security_events;
begin
  perform app.require_role('owner');

  perform 1 from public.shifts where id = p_shift_id for update;
  v_plan := app.od_plan_shift(p_shift_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if jsonb_array_length(v_plan -> 'blockers') > 0 then
    perform app.od_raise_blocked('el turno', v_plan -> 'blockers');
  end if;

  v_res := app.od_delete_shift_rows(p_shift_id);

  v_event := app.log_security_event(
    'record_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'entity', 'shift',
      'record_id', p_shift_id,
      'name', v_plan ->> 'name',
      'deleted_counts', jsonb_build_object(
        'shifts', 1,
        'assignments', v_res -> 'assignments',
        'tasks', v_res -> 'tasks',
        'observations', v_res -> 'observations'
      ),
      'snapshot', v_res -> 'snapshot'
    )
  );

  return jsonb_build_object(
    'entity', 'shift',
    'id', p_shift_id,
    'name', v_plan ->> 'name',
    'deleted', jsonb_build_object(
      'shifts', 1,
      'assignments', v_res -> 'assignments',
      'tasks', v_res -> 'tasks',
      'observations', v_res -> 'observations'
    ),
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_shift(uuid) is
  'Borra de verdad un turno sin historia, con sus asignaciones, tareas y observación (0078, OD-22). Solo el dueño (FORBIDDEN si no). SHIFT_NOT_FOUND; DELETE_BLOCKED si tiene fichajes, avisos, supervisiones, calificaciones, evidencia, tareas trabajadas, movimientos de stock o avisos de faltante (los bloqueos van en el detalle del error). Deja un evento record_deleted en security_events con la copia JSON. Devuelve {"entity", "id", "name", "deleted": {shifts, assignments, tasks, observations}, "event_id"}. Excepción deliberada a P-014.';

-- ---------------------------------------------------------------------------------------------
-- 4. Servicio y turnos de un servicio
-- ---------------------------------------------------------------------------------------------

create function app.od_plan_service(p_service_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_shifts bigint;
  v_archived bigint;
  v_fixed bigint;
  v_blockers jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_service from public.services where id = p_service_id;
  if v_service.id is null then
    return null;
  end if;

  select count(*), count(*) filter (where deleted_at is not null)
  into v_shifts, v_archived
  from public.shifts where service_id = p_service_id;

  select count(*) into v_fixed from public.service_fixed_employees where service_id = p_service_id;

  if v_shifts > 0 then
    v_blockers := v_blockers || app.od_blocker(
      'HAS_SHIFTS',
      v_shifts,
      'Este servicio todavía tiene ' || app.od_count(v_shifts, 'turno', 'turnos')
        || case when v_archived > 0 then ' (' || v_archived || ' dados de baja)' else '' end
        || '. Eliminá primero sus turnos.'
    );
  end if;

  v_items := v_items || app.od_item('service', 'El servicio', 1);
  if v_fixed > 0 then v_items := v_items || app.od_item('fixed_employees', 'Empleados fijos del servicio', v_fixed); end if;

  return jsonb_build_object(
    'name', v_service.name,
    'expected', jsonb_build_array(v_service.name),
    'blockers', v_blockers,
    'will_delete', v_items,
    'extra', jsonb_build_object('client_id', v_service.client_id, 'site_id', v_service.site_id, 'shifts_count', v_shifts)
  );
end;
$$;

comment on function app.od_plan_service(uuid) is
  'Uso interno (0078, OD-22): plan de borrado de un servicio. Nulo si no existe.';

revoke execute on function app.od_plan_service(uuid) from public, anon, authenticated;

create function public.owner_delete_preview_service(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  v_plan := app.od_plan_service(p_service_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'service',
    'id', p_service_id,
    'name', v_plan ->> 'name',
    'can_delete', jsonb_array_length(v_plan -> 'blockers') = 0,
    'blockers', v_plan -> 'blockers',
    'will_delete', v_plan -> 'will_delete'
  ) || (v_plan -> 'extra');
end;
$$;

comment on function public.owner_delete_preview_service(uuid) is
  'Vista previa del borrado de un servicio (0078, OD-22, OD-23). Solo el dueño. SERVICE_NOT_FOUND. Devuelve {"entity": "service", "id", "name", "can_delete", "blockers", "will_delete", "client_id", "site_id", "shifts_count"}. Bloqueo: HAS_SHIFTS (le quedan turnos; hay que borrarlos antes, ver owner_delete_service_shifts).';

create function public.owner_delete_service(p_service_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_snapshot jsonb;
  v_fixed integer;
  v_event public.security_events;
begin
  perform app.require_role('owner');

  perform 1 from public.services where id = p_service_id for update;
  v_plan := app.od_plan_service(p_service_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  perform app.od_check_confirm(p_confirm_name, array[v_plan ->> 'name']);

  if jsonb_array_length(v_plan -> 'blockers') > 0 then
    perform app.od_raise_blocked('el servicio', v_plan -> 'blockers');
  end if;

  select jsonb_build_object(
    'service', to_jsonb(s),
    'fixed_employees', coalesce((select jsonb_agg(to_jsonb(f)) from public.service_fixed_employees f where f.service_id = s.id), '[]'::jsonb)
  )
  into v_snapshot
  from public.services s where s.id = p_service_id;

  delete from public.service_fixed_employees where service_id = p_service_id;
  get diagnostics v_fixed = row_count;
  delete from public.services where id = p_service_id;

  v_event := app.log_security_event(
    'record_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'entity', 'service',
      'record_id', p_service_id,
      'name', v_plan ->> 'name',
      'deleted_counts', jsonb_build_object('services', 1, 'fixed_employees', v_fixed),
      'snapshot', v_snapshot
    )
  );

  return jsonb_build_object(
    'entity', 'service',
    'id', p_service_id,
    'name', v_plan ->> 'name',
    'deleted', jsonb_build_object('services', 1, 'fixed_employees', v_fixed),
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_service(uuid, text) is
  'Borra de verdad un servicio sin turnos (0078, OD-22, OD-23). Solo el dueño (FORBIDDEN si no). p_confirm_name: el nombre del servicio, tal como lo escribe la persona (CONFIRM_NAME_MISMATCH si no coincide). SERVICE_NOT_FOUND; DELETE_BLOCKED (HAS_SHIFTS) si le quedan turnos. Borra también sus empleados fijos y deja un evento record_deleted con la copia JSON. Devuelve {"entity", "id", "name", "deleted": {services, fixed_employees}, "event_id"}. No reemplaza a delete_service (0044), que sigue disponible para dueño y administradores y borra el servicio junto con sus turnos sin historia.';

-- Turnos de un servicio desde una fecha: cuáles se borran y cuáles se saltean por tener historia.
create function app.od_plan_service_shifts(p_service_id uuid, p_from_date date)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_deletable jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_assignments bigint := 0;
  v_tasks bigint := 0;
  v_items jsonb := '[]'::jsonb;
  r record;
  v_blockers jsonb;
  v_codes jsonb;
begin
  select * into v_service from public.services where id = p_service_id;
  if v_service.id is null then
    return null;
  end if;

  for r in
    select sh.id, sh.shift_date, sh.start_time, sh.end_time, sh.status
    from public.shifts sh
    where sh.service_id = p_service_id and sh.shift_date >= p_from_date
    order by sh.shift_date, sh.start_time, sh.id
  loop
    v_blockers := app.od_shift_blockers(r.id);

    if jsonb_array_length(v_blockers) = 0 then
      v_deletable := v_deletable || jsonb_build_object('shift_id', r.id, 'shift_date', r.shift_date);
      v_assignments := v_assignments + (select count(*) from public.assignments a where a.shift_id = r.id);
      v_tasks := v_tasks + (select count(*) from public.shift_tasks t where t.shift_id = r.id);
    else
      select coalesce(jsonb_agg(b ->> 'code'), '[]'::jsonb) into v_codes from jsonb_array_elements(v_blockers) b;
      v_skipped := v_skipped || jsonb_build_object(
        'shift_id', r.id,
        'shift_date', r.shift_date,
        'reasons', v_codes,
        'message', (select string_agg(b ->> 'message', ' ') from jsonb_array_elements(v_blockers) b)
      );
    end if;
  end loop;

  if jsonb_array_length(v_deletable) > 0 then
    v_items := v_items || app.od_item('shifts', 'Turnos sin historia', jsonb_array_length(v_deletable));
    if v_assignments > 0 then v_items := v_items || app.od_item('assignments', 'Asignaciones de empleados', v_assignments); end if;
    if v_tasks > 0 then v_items := v_items || app.od_item('tasks', 'Tareas del checklist', v_tasks); end if;
  end if;

  return jsonb_build_object(
    'name', v_service.name,
    'expected', jsonb_build_array(v_service.name),
    'deletable', v_deletable,
    'skipped', v_skipped,
    'will_delete', v_items
  );
end;
$$;

comment on function app.od_plan_service_shifts(uuid, date) is
  'Uso interno (0078, OD-22): turnos de un servicio con fecha >= p_from_date, separados en borrables (sin historia) y salteados (con los códigos y el mensaje de su historia). Nulo si el servicio no existe.';

revoke execute on function app.od_plan_service_shifts(uuid, date) from public, anon, authenticated;

create function public.owner_delete_preview_service_shifts(p_service_id uuid, p_from_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  v_plan := app.od_plan_service_shifts(p_service_id, p_from_date);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'service_shifts',
    'id', p_service_id,
    'name', v_plan ->> 'name',
    'from_date', p_from_date,
    'can_delete', jsonb_array_length(v_plan -> 'deletable') > 0,
    'deletable_count', jsonb_array_length(v_plan -> 'deletable'),
    'skipped_count', jsonb_array_length(v_plan -> 'skipped'),
    'skipped', v_plan -> 'skipped',
    'blockers', '[]'::jsonb,
    'will_delete', v_plan -> 'will_delete'
  );
end;
$$;

comment on function public.owner_delete_preview_service_shifts(uuid, date) is
  'Vista previa de «Eliminar turnos sin historia desde [fecha]» (0078, OD-22, OD-23). Solo el dueño. FROM_DATE_REQUIRED, SERVICE_NOT_FOUND. Devuelve {"entity": "service_shifts", "id", "name", "from_date", "can_delete" (hay al menos un turno borrable), "deletable_count", "skipped_count", "skipped": [{shift_id, shift_date, reasons: [codes de historia], message}], "blockers": [], "will_delete"}. Los turnos con historia no bloquean: se saltean.';

create function public.owner_delete_service_shifts(
  p_service_id uuid,
  p_from_date date,
  p_confirm_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_item jsonb;
  v_res jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_shifts integer := 0;
  v_assignments integer := 0;
  v_tasks integer := 0;
  v_observations integer := 0;
  v_event public.security_events;
begin
  perform app.require_role('owner');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  perform 1 from public.services where id = p_service_id for update;
  v_plan := app.od_plan_service_shifts(p_service_id, p_from_date);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  perform app.od_check_confirm(p_confirm_name, array[v_plan ->> 'name']);

  for v_item in select * from jsonb_array_elements(v_plan -> 'deletable')
  loop
    -- Se vuelve a mirar la historia con el turno trabado: si apareció algo, se saltea.
    perform 1 from public.shifts where id = (v_item ->> 'shift_id')::uuid for update;
    if app.shift_has_history((v_item ->> 'shift_id')::uuid) then
      v_plan := jsonb_set(v_plan, '{skipped}', (v_plan -> 'skipped') || jsonb_build_object(
        'shift_id', v_item ->> 'shift_id', 'shift_date', v_item ->> 'shift_date',
        'reasons', jsonb_build_array('HAS_HISTORY'), 'message', 'El turno acaba de recibir actividad.'
      ));
      continue;
    end if;

    v_res := app.od_delete_shift_rows((v_item ->> 'shift_id')::uuid);
    v_shifts := v_shifts + 1;
    v_assignments := v_assignments + (v_res ->> 'assignments')::integer;
    v_tasks := v_tasks + (v_res ->> 'tasks')::integer;
    v_observations := v_observations + (v_res ->> 'observations')::integer;
    v_snapshots := v_snapshots || jsonb_build_array(v_res -> 'snapshot');
  end loop;

  if v_shifts > 0 then
    v_event := app.log_security_event(
      'record_deleted',
      auth.uid(),
      null,
      jsonb_build_object(
        'entity', 'service_shifts',
        'record_id', p_service_id,
        'name', v_plan ->> 'name',
        'from_date', p_from_date,
        'deleted_counts', jsonb_build_object(
          'shifts', v_shifts, 'assignments', v_assignments, 'tasks', v_tasks, 'observations', v_observations
        ),
        'skipped_count', jsonb_array_length(v_plan -> 'skipped'),
        'snapshot', v_snapshots
      )
    );
  end if;

  return jsonb_build_object(
    'entity', 'service_shifts',
    'id', p_service_id,
    'name', v_plan ->> 'name',
    'from_date', p_from_date,
    'deleted', jsonb_build_object(
      'shifts', v_shifts, 'assignments', v_assignments, 'tasks', v_tasks, 'observations', v_observations
    ),
    'skipped_count', jsonb_array_length(v_plan -> 'skipped'),
    'skipped', v_plan -> 'skipped',
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_service_shifts(uuid, date, text) is
  'Borra de verdad los turnos del servicio con fecha >= p_from_date que no tienen historia (con sus asignaciones, tareas y observaciones) y saltea los que sí (0078, OD-22, OD-23). Solo el dueño. p_confirm_name: el nombre del servicio. FROM_DATE_REQUIRED, SERVICE_NOT_FOUND, CONFIRM_NAME_MISMATCH. No falla si algún turno tiene historia: lo saltea. Si no borra ninguno no deja evento (event_id nulo); si borra, deja un record_deleted con la copia JSON. Devuelve {"entity": "service_shifts", "id", "name", "from_date", "deleted": {shifts, assignments, tasks, observations}, "skipped_count", "skipped": [{shift_id, shift_date, reasons, message}], "event_id"}.';

-- ---------------------------------------------------------------------------------------------
-- 5. Sede
-- ---------------------------------------------------------------------------------------------

create function app.od_plan_site(p_site_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_site public.sites;
  v_services bigint;
  v_services_arch bigint;
  v_shifts bigint;
  v_shifts_arch bigint;
  v_stock bigint;
  v_shortages bigint;
  v_priorities bigint;
  v_templates bigint;
  v_template_items bigint;
  v_blockers jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_site from public.sites where id = p_site_id;
  if v_site.id is null then
    return null;
  end if;

  select count(*), count(*) filter (where deleted_at is not null) into v_services, v_services_arch
  from public.services where site_id = p_site_id;
  select count(*), count(*) filter (where deleted_at is not null) into v_shifts, v_shifts_arch
  from public.shifts where site_id = p_site_id;
  select count(*) into v_stock from public.stock_movements where site_id = p_site_id;
  select count(*) into v_shortages from public.supply_shortage_reports where site_id = p_site_id;
  select count(*) into v_priorities from public.supervisor_priorities where site_id = p_site_id;
  select count(*) into v_templates from public.checklist_templates where site_id = p_site_id;
  select count(*) into v_template_items from public.checklist_template_items i
    join public.checklist_templates t on t.id = i.template_id where t.site_id = p_site_id;

  if v_services > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SERVICES', v_services,
      'Esta sede todavía tiene ' || app.od_count(v_services, 'servicio', 'servicios')
      || case when v_services_arch > 0 then ' (' || v_services_arch || ' dados de baja)' else '' end || '.');
  end if;
  if v_shifts > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SHIFTS', v_shifts,
      'Esta sede todavía tiene ' || app.od_count(v_shifts, 'turno', 'turnos')
      || case when v_shifts_arch > 0 then ' (' || v_shifts_arch || ' dados de baja)' else '' end || '.');
  end if;
  if v_stock > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_STOCK', v_stock,
      'Esta sede tiene ' || app.od_count(v_stock, 'movimiento de stock', 'movimientos de stock') || '.');
  end if;
  if v_shortages > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SHORTAGES', v_shortages,
      'Esta sede tiene ' || app.od_count(v_shortages, 'aviso de faltante', 'avisos de faltante') || '.');
  end if;

  v_items := v_items || app.od_item('site', 'La sede', 1);
  if v_priorities > 0 then v_items := v_items || app.od_item('priorities', 'Coordinadores preferenciales de la sede', v_priorities); end if;
  if v_templates > 0 then v_items := v_items || app.od_item('checklist_templates', 'Plantilla de checklist propia de la sede', v_templates); end if;
  if v_template_items > 0 then v_items := v_items || app.od_item('checklist_template_items', 'Tareas de esa plantilla', v_template_items); end if;

  return jsonb_build_object(
    'name', v_site.name,
    'expected', jsonb_build_array(v_site.name),
    'blockers', v_blockers,
    'will_delete', v_items,
    'extra', jsonb_build_object('client_id', v_site.client_id)
  );
end;
$$;

comment on function app.od_plan_site(uuid) is
  'Uso interno (0078, OD-22): plan de borrado de una sede. Nulo si no existe.';

revoke execute on function app.od_plan_site(uuid) from public, anon, authenticated;

create function public.owner_delete_preview_site(p_site_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  v_plan := app.od_plan_site(p_site_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa sede.',
      hint = 'SITE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'site',
    'id', p_site_id,
    'name', v_plan ->> 'name',
    'can_delete', jsonb_array_length(v_plan -> 'blockers') = 0,
    'blockers', v_plan -> 'blockers',
    'will_delete', v_plan -> 'will_delete'
  ) || (v_plan -> 'extra');
end;
$$;

comment on function public.owner_delete_preview_site(uuid) is
  'Vista previa del borrado de una sede (0078, OD-22, OD-23). Solo el dueño. SITE_NOT_FOUND. Devuelve {"entity": "site", "id", "name", "can_delete", "blockers", "will_delete", "client_id"}. Bloqueos: HAS_SERVICES, HAS_SHIFTS (cuentan también los dados de baja), HAS_STOCK, HAS_SHORTAGES.';

create function public.owner_delete_site(p_site_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_snapshot jsonb;
  v_priorities integer;
  v_items integer;
  v_templates integer;
  v_event public.security_events;
begin
  perform app.require_role('owner');

  perform 1 from public.sites where id = p_site_id for update;
  v_plan := app.od_plan_site(p_site_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa sede.',
      hint = 'SITE_NOT_FOUND';
  end if;

  perform app.od_check_confirm(p_confirm_name, array[v_plan ->> 'name']);

  if jsonb_array_length(v_plan -> 'blockers') > 0 then
    perform app.od_raise_blocked('la sede', v_plan -> 'blockers');
  end if;

  select jsonb_build_object(
    'site', to_jsonb(s),
    'priorities', coalesce((select jsonb_agg(to_jsonb(p)) from public.supervisor_priorities p where p.site_id = s.id), '[]'::jsonb),
    'checklist_templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template', to_jsonb(t),
        'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.checklist_template_items i where i.template_id = t.id), '[]'::jsonb)
      ))
      from public.checklist_templates t where t.site_id = s.id
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.sites s where s.id = p_site_id;

  delete from public.supervisor_priorities where site_id = p_site_id;
  get diagnostics v_priorities = row_count;
  delete from public.checklist_template_items
    where template_id in (select id from public.checklist_templates where site_id = p_site_id);
  get diagnostics v_items = row_count;
  delete from public.checklist_templates where site_id = p_site_id;
  get diagnostics v_templates = row_count;
  delete from public.sites where id = p_site_id;

  v_event := app.log_security_event(
    'record_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'entity', 'site',
      'record_id', p_site_id,
      'name', v_plan ->> 'name',
      'deleted_counts', jsonb_build_object(
        'sites', 1, 'priorities', v_priorities, 'checklist_templates', v_templates, 'checklist_template_items', v_items
      ),
      'snapshot', v_snapshot
    )
  );

  return jsonb_build_object(
    'entity', 'site',
    'id', p_site_id,
    'name', v_plan ->> 'name',
    'deleted', jsonb_build_object(
      'sites', 1, 'priorities', v_priorities, 'checklist_templates', v_templates, 'checklist_template_items', v_items
    ),
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_site(uuid, text) is
  'Borra de verdad una sede sin servicios ni turnos (0078, OD-22, OD-23). Solo el dueño (FORBIDDEN si no). p_confirm_name: el nombre de la sede. SITE_NOT_FOUND, CONFIRM_NAME_MISMATCH, DELETE_BLOCKED (HAS_SERVICES, HAS_SHIFTS, HAS_STOCK, HAS_SHORTAGES). Borra también sus preferencias de coordinadores y su plantilla de checklist propia, y deja un evento record_deleted con la copia JSON. Devuelve {"entity", "id", "name", "deleted": {...}, "event_id"}.';

-- ---------------------------------------------------------------------------------------------
-- 6. Cliente
-- ---------------------------------------------------------------------------------------------

create function app.od_plan_client(p_client_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_client public.clients;
  v_sites bigint;
  v_sites_arch bigint;
  v_services bigint;
  v_services_arch bigint;
  v_shifts bigint;
  v_contacts bigint;
  v_bank bigint;
  v_perms bigint;
  v_priorities bigint;
  v_templates bigint;
  v_template_items bigint;
  v_blockers jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_names jsonb;
begin
  select * into v_client from public.clients where id = p_client_id;
  if v_client.id is null then
    return null;
  end if;

  select count(*), count(*) filter (where deleted_at is not null) into v_sites, v_sites_arch
  from public.sites where client_id = p_client_id;
  select count(*), count(*) filter (where deleted_at is not null) into v_services, v_services_arch
  from public.services where client_id = p_client_id;
  select count(*) into v_shifts from public.shifts where client_id = p_client_id;
  select count(*) into v_contacts from public.client_contacts where client_id = p_client_id;
  select count(*) into v_bank from public.client_bank_details where client_id = p_client_id;
  select count(*) into v_perms from public.employee_client_permissions where client_id = p_client_id;
  select count(*) into v_priorities from public.supervisor_priorities where client_id = p_client_id;
  select count(*) into v_templates from public.checklist_templates where client_id = p_client_id;
  select count(*) into v_template_items from public.checklist_template_items i
    join public.checklist_templates t on t.id = i.template_id where t.client_id = p_client_id;

  if v_sites > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SITES', v_sites,
      'Este cliente todavía tiene ' || app.od_count(v_sites, 'sede', 'sedes')
      || case when v_sites_arch > 0 then ' (' || v_sites_arch || ' dadas de baja)' else '' end || '.');
  end if;
  if v_services > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SERVICES', v_services,
      'Este cliente todavía tiene ' || app.od_count(v_services, 'servicio', 'servicios')
      || case when v_services_arch > 0 then ' (' || v_services_arch || ' dados de baja)' else '' end || '.');
  end if;
  if v_shifts > 0 then
    v_blockers := v_blockers || app.od_blocker('HAS_SHIFTS', v_shifts,
      'Este cliente todavía tiene ' || app.od_count(v_shifts, 'turno', 'turnos') || '.');
  end if;

  v_items := v_items || app.od_item('client', 'El cliente', 1);
  if v_contacts > 0 then v_items := v_items || app.od_item('contacts', 'Contactos', v_contacts); end if;
  if v_bank > 0 then v_items := v_items || app.od_item('bank_details', 'Datos bancarios', v_bank); end if;
  if v_perms > 0 then v_items := v_items || app.od_item('employee_permissions', 'Empleados habilitados para el cliente', v_perms); end if;
  if v_priorities > 0 then v_items := v_items || app.od_item('priorities', 'Coordinadores preferenciales del cliente', v_priorities); end if;
  if v_templates > 0 then v_items := v_items || app.od_item('checklist_templates', 'Plantilla de checklist del cliente', v_templates); end if;
  if v_template_items > 0 then v_items := v_items || app.od_item('checklist_template_items', 'Tareas de esa plantilla', v_template_items); end if;

  v_names := to_jsonb(array_remove(array[v_client.legal_name, v_client.trade_name], null));

  return jsonb_build_object(
    'name', coalesce(v_client.trade_name, v_client.legal_name),
    'expected', v_names,
    'blockers', v_blockers,
    'will_delete', v_items,
    'extra', jsonb_build_object('legal_name', v_client.legal_name, 'trade_name', v_client.trade_name, 'photo_path', v_client.photo_path)
  );
end;
$$;

comment on function app.od_plan_client(uuid) is
  'Uso interno (0078, OD-22): plan de borrado de un cliente. Nulo si no existe. Acepta como confirmación la razón social o el nombre comercial.';

revoke execute on function app.od_plan_client(uuid) from public, anon, authenticated;

create function public.owner_delete_preview_client(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  v_plan := app.od_plan_client(p_client_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'client',
    'id', p_client_id,
    'name', v_plan ->> 'name',
    'can_delete', jsonb_array_length(v_plan -> 'blockers') = 0,
    'blockers', v_plan -> 'blockers',
    'will_delete', v_plan -> 'will_delete'
  ) || (v_plan -> 'extra');
end;
$$;

comment on function public.owner_delete_preview_client(uuid) is
  'Vista previa del borrado de un cliente (0078, OD-22, OD-23). Solo el dueño. CLIENT_NOT_FOUND. Devuelve {"entity": "client", "id", "name" (nombre comercial o razón social), "can_delete", "blockers", "will_delete", "legal_name", "trade_name", "photo_path"}. Bloqueos: HAS_SITES, HAS_SERVICES, HAS_SHIFTS (cuentan también los dados de baja).';

create function public.owner_delete_client(p_client_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_snapshot jsonb;
  v_contacts integer;
  v_bank integer;
  v_perms integer;
  v_priorities integer;
  v_items integer;
  v_templates integer;
  v_photo text;
  v_event public.security_events;
begin
  perform app.require_role('owner');

  perform 1 from public.clients where id = p_client_id for update;
  v_plan := app.od_plan_client(p_client_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  perform app.od_check_confirm(
    p_confirm_name,
    array(select jsonb_array_elements_text(v_plan -> 'expected'))
  );

  if jsonb_array_length(v_plan -> 'blockers') > 0 then
    perform app.od_raise_blocked('el cliente', v_plan -> 'blockers');
  end if;

  select jsonb_build_object(
    'client', to_jsonb(c),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x)) from public.client_contacts x where x.client_id = c.id), '[]'::jsonb),
    'bank_details', coalesce((select jsonb_agg(to_jsonb(x)) from public.client_bank_details x where x.client_id = c.id), '[]'::jsonb),
    'employee_permissions', coalesce((select jsonb_agg(to_jsonb(x)) from public.employee_client_permissions x where x.client_id = c.id), '[]'::jsonb),
    'priorities', coalesce((select jsonb_agg(to_jsonb(x)) from public.supervisor_priorities x where x.client_id = c.id), '[]'::jsonb),
    'checklist_templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template', to_jsonb(t),
        'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.checklist_template_items i where i.template_id = t.id), '[]'::jsonb)
      ))
      from public.checklist_templates t where t.client_id = c.id
    ), '[]'::jsonb)
  )
  into v_snapshot
  from public.clients c where c.id = p_client_id;

  v_photo := v_plan -> 'extra' ->> 'photo_path';

  delete from public.client_contacts where client_id = p_client_id;
  get diagnostics v_contacts = row_count;
  delete from public.client_bank_details where client_id = p_client_id;
  get diagnostics v_bank = row_count;
  delete from public.employee_client_permissions where client_id = p_client_id;
  get diagnostics v_perms = row_count;
  delete from public.supervisor_priorities where client_id = p_client_id;
  get diagnostics v_priorities = row_count;
  delete from public.checklist_template_items
    where template_id in (select id from public.checklist_templates where client_id = p_client_id);
  get diagnostics v_items = row_count;
  delete from public.checklist_templates where client_id = p_client_id;
  get diagnostics v_templates = row_count;
  delete from public.clients where id = p_client_id;

  v_event := app.log_security_event(
    'record_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'entity', 'client',
      'record_id', p_client_id,
      'name', v_plan ->> 'name',
      'deleted_counts', jsonb_build_object(
        'clients', 1, 'contacts', v_contacts, 'bank_details', v_bank, 'employee_permissions', v_perms,
        'priorities', v_priorities, 'checklist_templates', v_templates, 'checklist_template_items', v_items
      ),
      'snapshot', v_snapshot
    )
  );

  return jsonb_build_object(
    'entity', 'client',
    'id', p_client_id,
    'name', v_plan ->> 'name',
    'deleted', jsonb_build_object(
      'clients', 1, 'contacts', v_contacts, 'bank_details', v_bank, 'employee_permissions', v_perms,
      'priorities', v_priorities, 'checklist_templates', v_templates, 'checklist_template_items', v_items
    ),
    'photo_path', v_photo,
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_client(uuid, text) is
  'Borra de verdad un cliente sin sedes, servicios ni turnos (0078, OD-22, OD-23). Solo el dueño (FORBIDDEN si no). p_confirm_name: la razón social o el nombre comercial. CLIENT_NOT_FOUND, CONFIRM_NAME_MISMATCH, DELETE_BLOCKED (HAS_SITES, HAS_SERVICES, HAS_SHIFTS). Borra también sus contactos, datos bancarios, habilitaciones de empleados, preferencias de coordinadores y plantilla de checklist, y deja un evento record_deleted con la copia JSON. Devuelve {"entity", "id", "name", "deleted": {...}, "photo_path" (el archivo de Storage que quedó huérfano, para que la pantalla lo borre), "event_id"}.';

-- ---------------------------------------------------------------------------------------------
-- 7. Empleado
-- ---------------------------------------------------------------------------------------------

-- Referencias a un perfil desde cualquier tabla con clave foránea hacia profiles(id) que NO se
-- borran junto con la persona (autoría created_by / updated_by / *_by de otros registros, etc.).
-- Es la red de seguridad del borrado del empleado: cualquier registro que lo nombre y que no sea
-- uno de los que se borran con él lo frena. Se recorre pg_constraint, así que una tabla nueva queda
-- cubierta sola. security_events se trata aparte (se desvincula).
create function app.profile_foreign_refs(p_profile_id uuid)
returns table (table_name text, column_name text, n bigint)
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  r record;
  v_owner_col text;
  v_sql text;
  v_n bigint;
begin
  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and cardinality(c.conkey) = 1
    order by 1, 2
  loop
    if r.tbl = 'security_events' then
      continue;
    end if;

    -- Tablas cuyas filas de esta persona se borran con ella: columna que la identifica.
    v_owner_col := case r.tbl
      when 'profiles' then 'id'
      when 'employees' then 'profile_id'
      when 'user_roles' then 'profile_id'
      when 'admin_capabilities' then 'profile_id'
      when 'account_credentials' then 'profile_id'
      when 'announcement_reads' then 'profile_id'
      when 'announcement_recipients' then 'profile_id'
      when 'employee_bank_details' then 'profile_id'
      when 'employee_availability' then 'employee_id'
      when 'employee_leaves' then 'employee_id'
      when 'employee_client_permissions' then 'employee_id'
      when 'service_fixed_employees' then 'employee_id'
      when 'supervisor_priorities' then 'supervisor_id'
      when 'assignments' then 'employee_id'
      else null
    end;

    -- Si la columna es la que la identifica, esas filas se borran con ella: no cuentan.
    if v_owner_col = r.col then
      continue;
    end if;

    v_sql := format('select count(*) from %s where %I = $1', r.tbl, r.col)
      || case when v_owner_col is not null then format(' and %I is distinct from $1', v_owner_col) else '' end;

    execute v_sql into v_n using p_profile_id;

    if v_n > 0 then
      table_name := r.tbl;
      column_name := r.col;
      n := v_n;
      return next;
    end if;
  end loop;
end;
$$;

comment on function app.profile_foreign_refs(uuid) is
  'Uso interno (0078, OD-22): tablas y columnas (clave foránea hacia profiles) que todavía nombran a la persona y no se borran con ella. Excluye security_events (se desvincula) y las filas propias de las tablas que se borran junto con el empleado.';

revoke execute on function app.profile_foreign_refs(uuid) from public, anon, authenticated;

create function app.od_plan_employee(p_employee_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
declare
  v_emp public.employees;
  v_prof public.profiles;
  v_name text;
  v_n bigint;
  v_attendance bigint;
  v_notices bigint;
  v_ratings bigint;
  v_media bigint;
  v_supervisions bigint;
  v_workdays bigint;
  v_stock bigint;
  v_counts bigint;
  v_shortages bigint;
  v_hist_assign bigint;
  v_assignments bigint;
  v_blockers jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_refs text;
  v_refs_n bigint;
  r record;
begin
  select * into v_emp from public.employees where profile_id = p_employee_id;
  if v_emp.profile_id is null then
    return null;
  end if;
  select * into v_prof from public.profiles where id = p_employee_id;
  v_name := btrim(v_prof.first_name || ' ' || v_prof.last_name);

  if p_employee_id = auth.uid() then
    v_blockers := v_blockers || app.od_blocker('IS_SELF', 1, 'No podés eliminarte a vos mismo.');
  end if;

  if exists (select 1 from public.user_roles ur where ur.profile_id = p_employee_id and ur.role = 'owner') then
    v_blockers := v_blockers || app.od_blocker('IS_OWNER', 1, 'Esta persona es dueña: no se puede eliminar.');
  end if;

  select count(*) into v_attendance from public.attendance_records ar
    join public.assignments a on a.id = ar.assignment_id where a.employee_id = p_employee_id;
  select count(*) into v_notices from public.attendance_notices n
    join public.assignments a on a.id = n.assignment_id where a.employee_id = p_employee_id;
  select count(*) into v_ratings from public.ratings r2
    join public.assignments a on a.id = r2.assignment_id where a.employee_id = p_employee_id;
  select count(*) into v_media from public.shift_media m
    where m.uploaded_by = p_employee_id
       or m.assignment_id in (select a.id from public.assignments a where a.employee_id = p_employee_id);
  select count(*) into v_supervisions from public.supervisions where supervisor_id = p_employee_id;
  select count(*) into v_workdays from public.supervisor_workdays where supervisor_id = p_employee_id;
  select count(*) into v_stock from public.stock_movements
    where person_id = p_employee_id or recorded_by = p_employee_id;
  select count(*) into v_counts from public.stock_counts where reviewer_id = p_employee_id;
  select count(*) into v_shortages from public.supply_shortage_reports
    where reported_by = p_employee_id or resolved_by = p_employee_id;
  select count(*) into v_hist_assign from public.assignments a
    where a.employee_id = p_employee_id and a.removed_at is null and app.shift_has_history(a.shift_id);
  select count(*) into v_assignments from public.assignments where employee_id = p_employee_id;

  if v_attendance > 0 then v_blockers := v_blockers || app.od_blocker('HAS_ATTENDANCE', v_attendance, 'Esta persona tiene ' || app.od_count(v_attendance, 'fichaje', 'fichajes') || '.'); end if;
  if v_notices > 0 then v_blockers := v_blockers || app.od_blocker('HAS_NOTICES', v_notices, 'Esta persona tiene ' || app.od_count(v_notices, 'aviso de demora o ausencia', 'avisos de demora o ausencia') || '.'); end if;
  if v_ratings > 0 then v_blockers := v_blockers || app.od_blocker('HAS_RATINGS', v_ratings, 'Esta persona tiene ' || app.od_count(v_ratings, 'calificación', 'calificaciones') || '.'); end if;
  if v_media > 0 then v_blockers := v_blockers || app.od_blocker('HAS_MEDIA', v_media, 'Esta persona tiene ' || app.od_count(v_media, 'foto o video', 'fotos o videos') || ' en turnos.'); end if;
  if v_supervisions > 0 then v_blockers := v_blockers || app.od_blocker('HAS_SUPERVISIONS', v_supervisions, 'Esta persona hizo ' || app.od_count(v_supervisions, 'supervisión', 'supervisiones') || '.'); end if;
  if v_workdays > 0 then v_blockers := v_blockers || app.od_blocker('HAS_WORKDAYS', v_workdays, 'Esta persona tiene ' || app.od_count(v_workdays, 'jornada de coordinador', 'jornadas de coordinador') || '.'); end if;
  if v_stock > 0 then v_blockers := v_blockers || app.od_blocker('HAS_STOCK', v_stock, 'Esta persona tiene ' || app.od_count(v_stock, 'movimiento de stock', 'movimientos de stock') || '.'); end if;
  if v_counts > 0 then v_blockers := v_blockers || app.od_blocker('HAS_STOCK_COUNTS', v_counts, 'Esta persona revisó ' || app.od_count(v_counts, 'control de stock', 'controles de stock') || '.'); end if;
  if v_shortages > 0 then v_blockers := v_blockers || app.od_blocker('HAS_SHORTAGES', v_shortages, 'Esta persona tiene ' || app.od_count(v_shortages, 'aviso de faltante', 'avisos de faltante') || '.'); end if;
  if v_hist_assign > 0 then v_blockers := v_blockers || app.od_blocker('HAS_HISTORY_ASSIGNMENTS', v_hist_assign, 'Esta persona está asignada a ' || app.od_count(v_hist_assign, 'turno con historia', 'turnos con historia') || '.'); end if;

  -- Red de seguridad: registros de otras tablas que la nombran (autoría, anuncios archivados, etc.).
  select string_agg(f.table_name || '.' || f.column_name, ', ' order by f.table_name, f.column_name), coalesce(sum(f.n), 0)
  into v_refs, v_refs_n
  from app.profile_foreign_refs(p_employee_id) f;

  if v_refs_n > 0 then
    v_blockers := v_blockers || app.od_blocker(
      'HAS_OTHER_RECORDS',
      v_refs_n,
      'Esta persona figura como autora en ' || app.od_count(v_refs_n, 'registro', 'registros') || ' (' || v_refs || ').'
    );
  end if;

  v_items := v_items || app.od_item('employee', 'La ficha del empleado', 1);
  v_items := v_items || app.od_item('auth_user', 'Su usuario de acceso', 1);
  if v_assignments > 0 then v_items := v_items || app.od_item('assignments', 'Asignaciones a turnos sin historia', v_assignments); end if;
  for r in
    select x.code, x.label, x.n from (
      values
        ('availability', 'Disponibilidad', (select count(*) from public.employee_availability where employee_id = p_employee_id)),
        ('leaves', 'Licencias', (select count(*) from public.employee_leaves where employee_id = p_employee_id)),
        ('client_permissions', 'Clientes habilitados', (select count(*) from public.employee_client_permissions where employee_id = p_employee_id)),
        ('fixed_employees', 'Servicios donde es empleado fijo', (select count(*) from public.service_fixed_employees where employee_id = p_employee_id)),
        ('priorities', 'Sedes y clientes preferenciales', (select count(*) from public.supervisor_priorities where supervisor_id = p_employee_id)),
        ('roles', 'Roles', (select count(*) from public.user_roles where profile_id = p_employee_id)),
        ('capabilities', 'Capacidades de administrador', (select count(*) from public.admin_capabilities where profile_id = p_employee_id)),
        ('bank_details', 'Datos bancarios', (select count(*) from public.employee_bank_details where profile_id = p_employee_id)),
        ('credentials', 'Contraseña guardada', (select count(*) from public.account_credentials where profile_id = p_employee_id)),
        ('announcement_reads', 'Lecturas de anuncios', (select count(*) from public.announcement_reads where profile_id = p_employee_id)),
        ('announcement_recipients', 'Destinos de anuncios', (select count(*) from public.announcement_recipients where profile_id = p_employee_id))
    ) as x (code, label, n)
  loop
    if r.n > 0 then v_items := v_items || app.od_item(r.code, r.label, r.n); end if;
  end loop;

  return jsonb_build_object(
    'name', v_name,
    'expected', jsonb_build_array(v_name, btrim(v_prof.last_name || ' ' || v_prof.first_name)),
    'blockers', v_blockers,
    'will_delete', v_items,
    'extra', jsonb_build_object('employee_number', v_emp.employee_number, 'avatar_path', v_prof.avatar_path)
  );
end;
$$;

comment on function app.od_plan_employee(uuid) is
  'Uso interno (0078, OD-22): plan de borrado de un empleado. Nulo si no existe. Acepta como confirmación «Nombre Apellido» o «Apellido Nombre».';

revoke execute on function app.od_plan_employee(uuid) from public, anon, authenticated;

create function public.owner_delete_preview_employee(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
begin
  perform app.require_role('owner');

  v_plan := app.od_plan_employee(p_employee_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese empleado.',
      hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'entity', 'employee',
    'id', p_employee_id,
    'name', v_plan ->> 'name',
    'can_delete', jsonb_array_length(v_plan -> 'blockers') = 0,
    'blockers', v_plan -> 'blockers',
    'will_delete', v_plan -> 'will_delete'
  ) || (v_plan -> 'extra');
end;
$$;

comment on function public.owner_delete_preview_employee(uuid) is
  'Vista previa del borrado de un empleado (0078, OD-22, OD-23). Solo el dueño. EMPLOYEE_NOT_FOUND. Devuelve {"entity": "employee", "id", "name", "can_delete", "blockers", "will_delete", "employee_number", "avatar_path"}. Bloqueos: IS_SELF, IS_OWNER, HAS_ATTENDANCE, HAS_NOTICES, HAS_RATINGS, HAS_MEDIA, HAS_SUPERVISIONS, HAS_WORKDAYS, HAS_STOCK, HAS_STOCK_COUNTS, HAS_SHORTAGES, HAS_HISTORY_ASSIGNMENTS (asignado a turnos con historia) y HAS_OTHER_RECORDS (figura como autor de otros registros: el mensaje nombra las tablas). La vista previa NO borra el usuario de Auth: eso lo hace la acción delete_user de la Edge Function admin-users.';

-- owner_delete_employee borra todo lo de la base. El usuario de Auth NO se toca acá: lo borra la
-- Edge Function admin-users (acción delete_user) justo después, con la service_role.
create function public.owner_delete_employee(p_employee_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_plan jsonb;
  v_snapshot jsonb;
  v_name text;
  v_counts jsonb := '{}'::jsonb;
  v_n integer;
  v_event public.security_events;
  v_avatar text;
  v_email text;
begin
  perform app.require_role('owner');

  perform 1 from public.employees where profile_id = p_employee_id for update;
  v_plan := app.od_plan_employee(p_employee_id);
  if v_plan is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese empleado.',
      hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  perform app.od_check_confirm(
    p_confirm_name,
    array(select jsonb_array_elements_text(v_plan -> 'expected'))
  );

  if jsonb_array_length(v_plan -> 'blockers') > 0 then
    perform app.od_raise_blocked('a esta persona', v_plan -> 'blockers');
  end if;

  v_name := v_plan ->> 'name';
  v_avatar := v_plan -> 'extra' ->> 'avatar_path';
  select u.email into v_email from auth.users u where u.id = p_employee_id;

  -- Copia de lo que se va a borrar. Sin la contraseña guardada (account_credentials) ni los datos
  -- bancarios: no se replican en el registro de seguridad.
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'employee', to_jsonb(e),
    'auth_email', v_email,
    'roles', coalesce((select jsonb_agg(to_jsonb(x)) from public.user_roles x where x.profile_id = p.id), '[]'::jsonb),
    'capabilities', coalesce((select jsonb_agg(to_jsonb(x)) from public.admin_capabilities x where x.profile_id = p.id), '[]'::jsonb),
    'availability', coalesce((select jsonb_agg(to_jsonb(x)) from public.employee_availability x where x.employee_id = p.id), '[]'::jsonb),
    'leaves', coalesce((select jsonb_agg(to_jsonb(x)) from public.employee_leaves x where x.employee_id = p.id), '[]'::jsonb),
    'client_permissions', coalesce((select jsonb_agg(to_jsonb(x)) from public.employee_client_permissions x where x.employee_id = p.id), '[]'::jsonb),
    'fixed_employees', coalesce((select jsonb_agg(to_jsonb(x)) from public.service_fixed_employees x where x.employee_id = p.id), '[]'::jsonb),
    'priorities', coalesce((select jsonb_agg(to_jsonb(x)) from public.supervisor_priorities x where x.supervisor_id = p.id), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(to_jsonb(x)) from public.assignments x where x.employee_id = p.id), '[]'::jsonb),
    'bank_details_deleted', exists (select 1 from public.employee_bank_details b where b.profile_id = p.id),
    'credentials_deleted', exists (select 1 from public.account_credentials c where c.profile_id = p.id)
  )
  into v_snapshot
  from public.profiles p
  join public.employees e on e.profile_id = p.id
  where p.id = p_employee_id;

  -- Los eventos de seguridad que la nombran (inicios de sesión, altas, etc.) se conservan, pero
  -- desvinculados de la fila (actor_id / target_id son claves foráneas a profiles): queda en
  -- details quién era.
  update public.security_events
  set details = coalesce(details, '{}'::jsonb)
        || jsonb_build_object('actor_deleted', jsonb_build_object('id', p_employee_id, 'name', v_name)),
      actor_id = null
  where actor_id = p_employee_id;

  update public.security_events
  set details = coalesce(details, '{}'::jsonb)
        || jsonb_build_object('target_deleted', jsonb_build_object('id', p_employee_id, 'name', v_name)),
      target_id = null
  where target_id = p_employee_id;

  delete from public.announcement_reads where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('announcement_reads', v_n);
  delete from public.announcement_recipients where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('announcement_recipients', v_n);
  delete from public.employee_availability where employee_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('availability', v_n);
  delete from public.employee_leaves where employee_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('leaves', v_n);
  delete from public.employee_client_permissions where employee_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('client_permissions', v_n);
  delete from public.service_fixed_employees where employee_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('fixed_employees', v_n);
  delete from public.supervisor_priorities where supervisor_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('priorities', v_n);
  delete from public.assignments where employee_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('assignments', v_n);
  delete from public.employee_bank_details where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('bank_details', v_n);
  delete from public.account_credentials where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('credentials', v_n);
  delete from public.admin_capabilities where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('capabilities', v_n);
  delete from public.user_roles where profile_id = p_employee_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('roles', v_n);
  delete from public.employees where profile_id = p_employee_id;
  v_counts := v_counts || jsonb_build_object('employees', 1);
  delete from public.profiles where id = p_employee_id;
  v_counts := v_counts || jsonb_build_object('profiles', 1);

  v_event := app.log_security_event(
    'record_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'entity', 'employee',
      'record_id', p_employee_id,
      'name', v_name,
      'deleted_counts', v_counts,
      'snapshot', v_snapshot
    )
  );

  return jsonb_build_object(
    'entity', 'employee',
    'id', p_employee_id,
    'name', v_name,
    'deleted', v_counts,
    'avatar_path', v_avatar,
    'event_id', v_event.id
  );
end;
$$;

comment on function public.owner_delete_employee(uuid, text) is
  'Borra de verdad a un empleado sin historia: sus asignaciones sin historia, disponibilidad, licencias, habilitaciones, roles, capacidades, contraseña guardada, datos bancarios, la ficha (employees) y el perfil (profiles) (0078, OD-22, OD-23). Solo el dueño (FORBIDDEN si no). p_confirm_name: «Nombre Apellido» o «Apellido Nombre». EMPLOYEE_NOT_FOUND, CONFIRM_NAME_MISMATCH, DELETE_BLOCKED (ver owner_delete_preview_employee). Los eventos de seguridad anteriores de la persona quedan, desvinculados (details.actor_deleted / target_deleted). NO borra el usuario de Auth: lo hace la acción delete_user de admin-users, que es la que se llama desde la pantalla. Deja un evento record_deleted con la copia JSON (sin contraseña ni datos bancarios). Devuelve {"entity", "id", "name", "deleted": {...}, "avatar_path" (archivo de Storage a borrar), "event_id"}.';

-- ---------------------------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.owner_delete_preview_shift(uuid) from public, anon;
revoke execute on function public.owner_delete_shift(uuid) from public, anon;
revoke execute on function public.owner_delete_preview_service(uuid) from public, anon;
revoke execute on function public.owner_delete_service(uuid, text) from public, anon;
revoke execute on function public.owner_delete_preview_service_shifts(uuid, date) from public, anon;
revoke execute on function public.owner_delete_service_shifts(uuid, date, text) from public, anon;
revoke execute on function public.owner_delete_preview_site(uuid) from public, anon;
revoke execute on function public.owner_delete_site(uuid, text) from public, anon;
revoke execute on function public.owner_delete_preview_client(uuid) from public, anon;
revoke execute on function public.owner_delete_client(uuid, text) from public, anon;
revoke execute on function public.owner_delete_preview_employee(uuid) from public, anon;
revoke execute on function public.owner_delete_employee(uuid, text) from public, anon;

grant execute on function public.owner_delete_preview_shift(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_shift(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_preview_service(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_service(uuid, text) to authenticated, service_role;
grant execute on function public.owner_delete_preview_service_shifts(uuid, date) to authenticated, service_role;
grant execute on function public.owner_delete_service_shifts(uuid, date, text) to authenticated, service_role;
grant execute on function public.owner_delete_preview_site(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_site(uuid, text) to authenticated, service_role;
grant execute on function public.owner_delete_preview_client(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_client(uuid, text) to authenticated, service_role;
grant execute on function public.owner_delete_preview_employee(uuid) to authenticated, service_role;
grant execute on function public.owner_delete_employee(uuid, text) to authenticated, service_role;
