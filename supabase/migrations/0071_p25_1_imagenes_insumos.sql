-- P25.1 · Insumos y control de stock (módulo E), tercera de tres migraciones: Storage.
--
-- Bucket privado `supply-images` para la imagen de cada artículo (IS-04, IS-32). Ruta:
-- {supply_id}/{uuid}.webp (el navegador la comprime a lado mayor 1200 px, WebP, como en el módulo
-- H; se admite también JPEG por si el navegador no puede generar WebP).
--
-- Lectura: cualquier usuario autenticado y activo (empleados y coordinadores ven el catálogo con
-- imágenes, IS-20). El bucket es privado: el cliente pide URL firmadas con su sesión.
-- Escritura (subir, reemplazar, borrar): solo con la capacidad manage_stock (el dueño la tiene
-- implícita), IS-21 / IS-32.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supply-images', 'supply-images', false, 2097152, array['image/webp', 'image/jpeg'])
on conflict (id) do nothing;

create policy supply_images_select_authenticated
  on storage.objects for select to authenticated
  using (bucket_id = 'supply-images' and (select app.current_uid()) is not null);

create policy supply_images_insert_manage_stock
  on storage.objects for insert to authenticated
  with check (bucket_id = 'supply-images' and (select app.has_capability('manage_stock')));

create policy supply_images_update_manage_stock
  on storage.objects for update to authenticated
  using (bucket_id = 'supply-images' and (select app.has_capability('manage_stock')))
  with check (bucket_id = 'supply-images' and (select app.has_capability('manage_stock')));

create policy supply_images_delete_manage_stock
  on storage.objects for delete to authenticated
  using (bucket_id = 'supply-images' and (select app.has_capability('manage_stock')));
