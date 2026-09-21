-- DB-016 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base, P04.5 tramo B)
--
-- Buckets `avatars` y `branding` con las políticas de 04_Modelo_de_Datos.md sección 7.3 y
-- ADR-016. Los buckets de fotos de evidencia (módulo H) no se crean (04 sección 7.3, cierre).
--
-- `storage.objects` ya tiene RLS habilitada de fábrica en todo proyecto Supabase (no la
-- habilita esta migración); acá solo se agregan las políticas de los dos buckets nuevos, sobre
-- las mismas funciones de `app` que ya usa `0012_rls_policies.sql` (`app.is_admin()`).
--
-- Rutas y límites (04 sección 7.3, ADR-016):
--   - `avatars`: `{profile_id}/{uuid}.jpg`, máximo 2 MB, redimensionado a 512 px en el cliente
--     (el límite de tamaño y el tipo MIME se verifican en el servidor, el recorte/redimensión es
--     responsabilidad del cliente, la base no la puede exigir). Lectura pública (PROPUESTO en 04,
--     URL no adivinable); escritura del propio usuario (primer segmento del path = su
--     `profile_id`) o de owner/admin.
--   - `branding`: `logo.{ext}`, máximo 1 MB. Lectura pública; escritura de owner y admin
--     (04 sección 7.2/7.3, P-117: "admin o dueños").
--
-- `allowed_mime_types` de `branding` (decisión menor, el modelo dice "logo.{ext}" sin fijar
-- cuáles): se admite el conjunto habitual de formatos de logo (PNG, JPEG, SVG, WebP), documentado
-- en el reporte de la tarea.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- avatars
-- ---------------------------------------------------------------------------------------------

-- Lectura pública (04 sección 7.3): además de que el bucket es `public = true` (sirve el objeto
-- sin pasar por RLS en la ruta `/object/public/...`), se agrega la política de select para que
-- las operaciones de API (`.list()`, `.from().download()`) también funcionen.
create policy avatars_select_public
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

-- Escritura: propio (primer segmento del path = su profile_id) o owner/admin. `storage.foldername`
-- devuelve los segmentos de carpeta del path como arreglo; `[1]` es `{profile_id}`.
create policy avatars_insert_own_or_admin
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (app.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy avatars_update_own_or_admin
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (app.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  )
  with check (
    bucket_id = 'avatars'
    and (app.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

create policy avatars_delete_own_or_admin
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (app.is_admin() or (storage.foldername(name))[1] = auth.uid()::text)
  );

-- ---------------------------------------------------------------------------------------------
-- branding
-- ---------------------------------------------------------------------------------------------

create policy branding_select_public
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'branding');

-- Escritura: owner y admin, sin distinción de capacidad (04 sección 7.2: "O (A puede subir
-- logo: P-117 dice 'admin o dueños'; se otorga a O y A)").
create policy branding_write_admin
  on storage.objects for all to authenticated
  using (bucket_id = 'branding' and app.is_admin())
  with check (bucket_id = 'branding' and app.is_admin());
