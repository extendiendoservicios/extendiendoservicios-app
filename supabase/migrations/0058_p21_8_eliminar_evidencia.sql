-- 0058 · P21.8a · Módulo H (evidencia fotográfica): eliminar fotos y videos para liberar espacio.
--
-- Pedido de Mike: en «Fotos y videos» (administración) se pueden elegir varios archivos y hay que
-- poder eliminarlos para liberar espacio. Se borran el archivo y la miniatura de Storage; la fila de
-- shift_media queda como constancia (P-014: nada se borra físicamente) y el turno muestra
-- «Eliminada por X el día Y».
--
-- Contenido:
--   1. security_event_type.media_deleted (se usa recién en las llamadas posteriores a esta migración).
--   2. Columnas shift_media.deleted_at / deleted_by.
--   3. RPC delete_shift_media(p_ids) (O, A): marca las filas y devuelve las rutas a borrar.
--   4. Política de Storage evidence_delete_deleted_admin: O/A borran los objetos de filas eliminadas.
--   5. Barrido nocturno: evidence_cleanup_candidates devuelve también reason 'deleted' (red de
--      seguridad si el borrado del cliente quedó a mitad). La Edge Function evidence-cleanup se
--      actualiza en el mismo paquete.
--   6. RPC set_shift_media_keep_many(p_ids, p_keep) (O, A) para «Conservar» en la selección múltiple;
--      set_shift_media_keep rechaza las eliminadas con MEDIA_EXPIRED.
--   7. Vista v_shift_media: las eliminadas siguen apareciendo (has_file = false) con quién y cuándo.
--
-- No cambian: storage_usage (suma objetos reales), delete_service (sigue rechazando servicios con
-- fotos subidas) ni v_my_day / v_my_supervisions / v_my_history (los contadores cuentan lo subido,
-- también lo que administración eliminó después: el empleado ve la constancia).

alter type public.security_event_type add value if not exists 'media_deleted';

-- ---------------------------------------------------------------------------------------------
-- 1. Columnas
-- ---------------------------------------------------------------------------------------------

-- Nombres: deleted_* (y no removed_*/expired_*) porque son tres hechos distintos: removed_* = la quitó
-- su autor dentro de la ventana (la fila deja de verse); expired_* = vencimiento nocturno o archivo
-- ya borrado; deleted_* = la eliminó administración a mano (la fila se sigue viendo como constancia).
alter table public.shift_media
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

comment on column public.shift_media.deleted_at is
  'Momento en que dueño o administración eliminó el archivo a mano para liberar espacio (0058, P21.8a). La fila queda como constancia (v_shift_media, has_file = false). Distinto de removed_at (lo quita el autor y la fila deja de verse) y de expired_at (momento en que el archivo realmente se borró de Storage: lo fija el barrido nocturno).';
comment on column public.shift_media.deleted_by is
  'Quién eliminó el archivo (0058, P21.8a): dueño o administrador.';

create index shift_media_deleted_by_idx on public.shift_media (deleted_by) where deleted_by is not null;
-- Barrido nocturno: eliminadas a mano cuyo archivo todavía no se confirmó borrado.
create index shift_media_deleted_pending_idx on public.shift_media (deleted_at)
  where deleted_at is not null and expired_at is null;

comment on index public.shift_media_deleted_by_idx is
  'Quién eliminó cada archivo (0058, P21.8a): respalda la clave foránea deleted_by.';
comment on index public.shift_media_deleted_pending_idx is
  'Eliminadas a mano cuyo archivo todavía no se confirmó borrado (0058, P21.8a): las recorre el barrido nocturno (reason deleted).';

-- ---------------------------------------------------------------------------------------------
-- 2. delete_shift_media
-- ---------------------------------------------------------------------------------------------

create function public.delete_shift_media(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_deleted_ids uuid[];
  v_paths text[];
  v_bytes bigint;
  v_max constant integer := 200;
begin
  perform app.require_role('owner', 'admin');

  if p_ids is not null then
    select array_agg(distinct x) into v_ids from unnest(p_ids) as x where x is not null;
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí al menos un archivo para eliminar.',
      hint = 'MEDIA_IDS_REQUIRED';
  end if;

  if cardinality(v_ids) > v_max then
    raise exception using
      errcode = 'P0001',
      message = format('Podés eliminar hasta %s archivos por vez.', v_max),
      hint = 'MEDIA_TOO_MANY';
  end if;

  -- Solo filas confirmadas, no quitadas y con archivo (sin vencer ni eliminar antes). Incluye las
  -- «Conservar». Las demás se ignoran sin error (la operación es idempotente).
  with changed as (
    update public.shift_media
    set deleted_at = now(), deleted_by = v_uid, updated_by = v_uid
    where id = any(v_ids)
      and confirmed_at is not null
      and removed_at is null
      and expired_at is null
      and deleted_at is null
    returning id, storage_path, thumb_path, size_bytes
  )
  select
    coalesce(array_agg(id order by id), '{}'),
    coalesce(array_agg(storage_path order by id) || array_agg(thumb_path order by id), '{}'),
    coalesce(sum(size_bytes), 0)::bigint
  into v_deleted_ids, v_paths, v_bytes
  from changed;

  if cardinality(v_deleted_ids) > 0 then
    perform app.log_security_event(
      'media_deleted'::public.security_event_type,
      v_uid,
      null,
      jsonb_build_object(
        'count', cardinality(v_deleted_ids),
        'media_ids', to_jsonb(v_deleted_ids),
        'bytes_freed_estimate', v_bytes,
        'requested', cardinality(v_ids)
      )
    );
  end if;

  return jsonb_build_object(
    'requested_count', cardinality(v_ids),
    'deleted_count', cardinality(v_deleted_ids),
    'ignored_count', cardinality(v_ids) - cardinality(v_deleted_ids),
    'bytes_freed_estimate', v_bytes,
    'deleted_ids', to_jsonb(v_deleted_ids),
    'paths', to_jsonb(v_paths)
  );
end;
$$;

comment on function public.delete_shift_media(uuid[]) is
  'Elimina varios archivos de evidencia para liberar espacio (0058, P21.8a). Solo O, A (FORBIDDEN si no). MEDIA_IDS_REQUIRED (lista vacía o nula), MEDIA_TOO_MANY (más de 200 ids distintos). Marca deleted_at/deleted_by en las filas confirmadas, no quitadas y con archivo (incluye las «Conservar»); ignora sin error las demás (inexistentes, pendientes, quitadas, vencidas o ya eliminadas). La fila queda como constancia. Registra media_deleted en security_events (cantidad, ids, bytes estimados con size_bytes). Devuelve jsonb {requested_count, deleted_count, ignored_count, bytes_freed_estimate, deleted_ids, paths}: paths son las rutas (archivo y miniatura) que el cliente borra con storage.from(''evidence'').remove(paths); si no llega, lo hace el barrido nocturno (reason deleted).';

revoke execute on function public.delete_shift_media(uuid[]) from public, anon;
grant execute on function public.delete_shift_media(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Política de Storage
-- ---------------------------------------------------------------------------------------------

-- Borrado de objetos de filas eliminadas: dueño y administradores, como evidence_delete_removed_own
-- (0047) lo permite al autor con las suyas quitadas. Solo sirve para objetos cuya fila ya está marcada
-- con delete_shift_media: no se puede borrar evidencia que no pasó por la RPC (que valida y registra).
create policy evidence_delete_deleted_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidence'
    and (select app.is_admin())
    and exists (
      select 1 from public.shift_media m
      where m.deleted_at is not null
        and name in (m.storage_path, m.thumb_path)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 4. Barrido nocturno
-- ---------------------------------------------------------------------------------------------

-- Misma firma y retorno que 0047; suma el motivo 'deleted' (eliminada a mano por administración
-- cuyo archivo todavía no se confirmó borrado). Prioridad: removed, deleted, pending_stale, expired.
create or replace function public.evidence_cleanup_candidates(p_limit integer default 200)
returns table (media_id uuid, storage_path text, thumb_path text, reason text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select m.id, m.storage_path, m.thumb_path,
    case
      when m.removed_at is not null then 'removed'
      when m.deleted_at is not null then 'deleted'
      when m.confirmed_at is null then 'pending_stale'
      else 'expired'
    end
  from public.shift_media m
  cross join public.company_settings cs
  where m.expired_at is null
    and cs.id = 1
    and (
      m.removed_at is not null
      or m.deleted_at is not null
      or (m.confirmed_at is null and m.created_at < now() - interval '24 hours')
      or (
        m.confirmed_at is not null
        and m.keep = false
        and m.created_at < now() - make_interval(
          days => case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end
        )
      )
    )
  order by m.created_at
  limit greatest(coalesce(p_limit, 200), 1);
$$;

comment on function public.evidence_cleanup_candidates(integer) is
  'Interna del barrido nocturno (0047, H-08; 0058 suma deleted): filas cuyo archivo hay que borrar de Storage, con reason removed, deleted (eliminada a mano por administración y el borrado del cliente no llegó), pending_stale (pendiente de más de 24 h) o expired (plazo vigente de su tipo, salvo keep). Solo service_role.';

-- ---------------------------------------------------------------------------------------------
-- 5. «Conservar» múltiple
-- ---------------------------------------------------------------------------------------------

-- set_shift_media_keep (0047) con un único cambio: una fila eliminada a mano ya no tiene archivo, así
-- que responde MEDIA_EXPIRED igual que una vencida. Mismo contrato; los grants se conservan.
create or replace function public.set_shift_media_keep(p_media_id uuid, p_keep boolean)
returns public.shift_media
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.shift_media;
begin
  perform app.require_role('owner', 'admin');

  if p_keep is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si querés conservar el archivo.',
      hint = 'KEEP_REQUIRED';
  end if;

  select * into v_row from public.shift_media where id = p_media_id for update;
  if v_row.id is null or v_row.confirmed_at is null or v_row.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese archivo.',
      hint = 'MEDIA_NOT_FOUND';
  end if;

  if v_row.expired_at is not null or v_row.deleted_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Ese archivo ya se borró.',
      hint = 'MEDIA_EXPIRED';
  end if;

  update public.shift_media
  set keep = p_keep,
      kept_by = case when p_keep then auth.uid() end,
      kept_at = case when p_keep then now() end,
      updated_by = auth.uid()
  where id = p_media_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_shift_media_keep(uuid, boolean) is
  '«Conservar» o dejar de conservar un archivo (0047, H-08; 0058: las eliminadas a mano también dan MEDIA_EXPIRED). Solo O, A (FORBIDDEN si no). KEEP_REQUIRED (null), MEDIA_NOT_FOUND (no existe, pendiente o quitada), MEDIA_EXPIRED (el archivo ya se borró: venció o lo eliminó administración). Lo conservado no vence. Devuelve la fila de shift_media.';

create function public.set_shift_media_keep_many(p_ids uuid[], p_keep boolean)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count integer;
  v_max constant integer := 200;
begin
  perform app.require_role('owner', 'admin');

  if p_keep is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si querés conservar los archivos.',
      hint = 'KEEP_REQUIRED';
  end if;

  if p_ids is not null then
    select array_agg(distinct x) into v_ids from unnest(p_ids) as x where x is not null;
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí al menos un archivo.',
      hint = 'MEDIA_IDS_REQUIRED';
  end if;

  if cardinality(v_ids) > v_max then
    raise exception using
      errcode = 'P0001',
      message = format('Podés elegir hasta %s archivos por vez.', v_max),
      hint = 'MEDIA_TOO_MANY';
  end if;

  -- Misma regla que set_shift_media_keep sobre las filas confirmadas, no quitadas y con archivo; las
  -- demás se ignoran sin error. Solo toca las que cambian de estado (conserva kept_by/kept_at de las
  -- que ya estaban en «Conservar»).
  update public.shift_media
  set keep = p_keep,
      kept_by = case when p_keep then v_uid end,
      kept_at = case when p_keep then now() end,
      updated_by = v_uid
  where id = any(v_ids)
    and confirmed_at is not null
    and removed_at is null
    and expired_at is null
    and deleted_at is null
    and keep is distinct from p_keep;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

comment on function public.set_shift_media_keep_many(uuid[], boolean) is
  '«Conservar» o dejar de conservar varios archivos a la vez (0058, P21.8a), para la selección múltiple de la galería. Solo O, A (FORBIDDEN si no). KEEP_REQUIRED (p_keep nulo), MEDIA_IDS_REQUIRED (lista vacía o nula), MEDIA_TOO_MANY (más de 200 ids distintos). Aplica a las filas confirmadas, no quitadas y con archivo (sin vencer ni eliminar); ignora sin error las demás. Devuelve cuántas filas cambiaron de estado (las que ya estaban como se pide no cuentan).';

revoke execute on function public.set_shift_media_keep_many(uuid[], boolean) from public, anon;
grant execute on function public.set_shift_media_keep_many(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Vista v_shift_media
-- ---------------------------------------------------------------------------------------------

-- Mismas columnas y orden que 0047; las nuevas van al final. Las eliminadas siguen apareciendo como
-- constancia (has_file = false, expires_on null).
create or replace view public.v_shift_media
with (security_invoker = true)
as
select
  m.id,
  m.shift_id,
  sh.shift_date,
  sh.client_id,
  coalesce(cl.trade_name, cl.legal_name) as client_name,
  sh.site_id,
  si.name as site_name,
  m.assignment_id,
  m.supervision_id,
  m.uploaded_by,
  pr.first_name as uploader_first_name,
  pr.last_name as uploader_last_name,
  case when m.supervision_id is not null then 'supervisor' else 'employee' end as uploader_role,
  m.kind,
  m.storage_path,
  m.thumb_path,
  m.size_bytes,
  m.width,
  m.height,
  m.duration_s,
  m.captured_at,
  m.created_at,
  m.keep,
  m.kept_by,
  m.kept_at,
  m.expired_at,
  (m.expired_at is null and m.deleted_at is null) as has_file,
  case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end as retention_days,
  case
    when m.keep or m.expired_at is not null or m.deleted_at is not null then null
    else (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date
         + (case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end)::int
  end as expires_on,
  m.deleted_at,
  m.deleted_by,
  dpr.first_name as deleted_by_first_name,
  dpr.last_name as deleted_by_last_name
from public.shift_media m
cross join public.company_settings cs
left join public.shifts sh on sh.id = m.shift_id
left join public.v_clients_basic cl on cl.id = sh.client_id
left join public.sites si on si.id = sh.site_id
left join public.profiles pr on pr.id = m.uploaded_by
left join public.profiles dpr on dpr.id = m.deleted_by
where cs.id = 1
  and m.confirmed_at is not null
  and m.removed_at is null;

comment on view public.v_shift_media is
  'Fotos y videos confirmados y no quitados de los turnos, con turno, cliente, sede y autor, para la sección «Fotos y videos» y sus filtros (0047, H-09). expires_on = fecha (Argentina) de creación + plazo vigente de su tipo (H-17); null si está en «Conservar», si el archivo ya se borró (expired_at) o si lo eliminó administración (deleted_at). has_file = false cuando venció o se eliminó: queda la constancia. 0058: deleted_at, deleted_by y deleted_by_first_name/deleted_by_last_name dicen quién y cuándo eliminó («Eliminada por X el día Y»). uploader_role: supervisor si subió desde una supervisión. security_invoker: dueño y administradores ven todo; el autor, lo suyo (RLS de shift_media).';
