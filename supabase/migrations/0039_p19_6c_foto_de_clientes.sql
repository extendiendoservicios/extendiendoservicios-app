-- P19.6 paquete C, AJ2-06 «foto de clientes» (base de datos).
--
--   1. `clients.photo_path`: ruta de la foto dentro del bucket `client-photos` (mismo criterio
--      que `profiles.avatar_path`: se guarda la ruta, no la URL). Va al final de la tabla.
--   2. Bucket `client-photos` (decisión: bucket propio y no una carpeta de `avatars`, porque
--      las políticas de `avatars` se apoyan en que el primer segmento sea un profile_id y las
--      de acá en que sea un client_id; separarlos evita mezclar los dos criterios). Mismo
--      límite y tipo que `avatars`: 2 MB, solo image/jpeg (el front redimensiona a JPEG).
--      Ruta: `{client_id}/{uuid}.jpg`. Bucket público, como `avatars`: las URL son
--      no adivinables y se sirven por /object/public; el listado por API sí está restringido.
--   3. Políticas sobre storage.objects:
--        - lectura (API): owner/admin y el supervisor de turnos de ese cliente (las mismas
--          personas a las que la RLS de `clients` les da la fila; el empleado solo lee el
--          nombre por v_clients_basic y no recibe la foto);
--        - escritura/borrado: owner/admin (mismo criterio que editar clientes).
--   4. `v_clients` expone `photo_path` al final. `v_clients_basic` y `v_search` no se tocan
--      (el empleado no ve la foto; el buscador no la necesita).

alter table public.clients add column photo_path text;

comment on column public.clients.photo_path is
  'Ruta de la foto del cliente en el bucket client-photos ({client_id}/{uuid}.jpg). Null si no tiene (AJ2-06, 0039).';

-- ---------------------------------------------------------------------------------------------
-- Bucket y políticas
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy client_photos_select_admin_or_supervisor
  on storage.objects for select to authenticated
  using (
    bucket_id = 'client-photos'
    and (
      (select app.is_admin())
      or (
        (select app.has_role('supervisor'))
        and (storage.foldername(name))[1] in (select x::text from app.supervised_client_ids() as x)
      )
    )
  );

create policy client_photos_insert_admin
  on storage.objects for insert to authenticated
  with check (bucket_id = 'client-photos' and (select app.is_admin()));

create policy client_photos_update_admin
  on storage.objects for update to authenticated
  using (bucket_id = 'client-photos' and (select app.is_admin()))
  with check (bucket_id = 'client-photos' and (select app.is_admin()));

create policy client_photos_delete_admin
  on storage.objects for delete to authenticated
  using (bucket_id = 'client-photos' and (select app.is_admin()));

-- ---------------------------------------------------------------------------------------------
-- v_clients: photo_path al final (create or replace no permite reordenar)
-- ---------------------------------------------------------------------------------------------

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
  c.photo_path
from public.clients c
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

comment on view public.v_clients is
  'Listado de clientes con conteo de sedes y servicios activos (06_API.md sección 4). sites_count: sedes vigentes (deleted_at is null), sin filtrar por estado activa/inactiva. photo_path (0039, AJ2-06): ruta de la foto en el bucket client-photos, al final. security_invoker: visibilidad de filas por RLS de clients (0012, DB-014).';
