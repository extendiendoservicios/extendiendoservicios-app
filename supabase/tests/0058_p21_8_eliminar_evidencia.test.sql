-- pgTAP de la migración 0058_p21_8_eliminar_evidencia.sql (P21.8a, módulo H · evidencia fotográfica):
-- eliminar fotos y videos para liberar espacio (delete_shift_media), «Conservar» de a varias
-- (set_shift_media_keep_many), política de Storage evidence_delete_deleted_admin, motivo 'deleted' del
-- barrido nocturno y columnas nuevas de v_shift_media.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f5800000-...'. El turno de prueba abarca todo el día de hoy (00:00 a 23:59, hora de
-- Argentina); las filas de shift_media se insertan directo (la subida real ya la cubre el test 0047).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  perform set_config('role', 'postgres', true);
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'tests.as_user: no existe auth.users.email = %', p_email;
  end if;
  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'role', 'authenticated')
      )
    )
  ) -> 'claims';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

grant execute on function tests.as_user(text) to authenticated, anon;

-- Devuelve el código estable (hint) del error que levanta la consulta, o null si no falla.
create or replace function tests.hint_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception
  when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return coalesce(nullif(v_hint, ''), 'SQLSTATE ' || sqlstate);
end;
$$;

grant execute on function tests.hint_of(text) to authenticated, anon;

-- Cuántos objetos del bucket evidence borra el delete con la sesión actual (la política de Storage
-- filtra en silencio los que no puede borrar).
create or replace function tests.borrar_objetos(p_like text)
returns bigint
language sql
as $$
  with d as (
    delete from storage.objects where bucket_id = 'evidence' and name like p_like returning 1
  )
  select count(*) from d;
$$;

grant execute on function tests.borrar_objetos(text) to authenticated, anon;

-- Storage protege el borrado directo de storage.objects (solo lo hace la API de Storage); en la prueba
-- lo habilitamos para ejercitar la política de borrado como lo hace la API con la sesión del usuario.
select set_config('storage.allow_delete_query', 'true', true);

select plan(59);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'shift_media', 'deleted_at', 'shift_media tiene deleted_at');
select col_type_is('public', 'shift_media', 'deleted_at', 'timestamp with time zone', 'deleted_at es timestamptz');
select col_is_null('public', 'shift_media', 'deleted_at', 'deleted_at admite null (la mayoría no se eliminó)');
select has_column('public', 'shift_media', 'deleted_by', 'shift_media tiene deleted_by');
select col_is_fk('public', 'shift_media', 'deleted_by', 'deleted_by referencia a profiles');
select ok(
  has_function_privilege('authenticated', 'public.delete_shift_media(uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.delete_shift_media(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.set_shift_media_keep_many(uuid[], boolean)', 'execute')
    and not has_function_privilege('anon', 'public.set_shift_media_keep_many(uuid[], boolean)', 'execute'),
  'grants: delete_shift_media y set_shift_media_keep_many para authenticated y no para anon'
);
select is(
  (select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evidence_delete_deleted_admin'),
  'DELETE', 'Storage: existe la política evidence_delete_deleted_admin (delete)'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_shift_media'::regclass and attnum > 0 and not attisdropped
     and attname in ('deleted_at', 'deleted_by', 'deleted_by_first_name', 'deleted_by_last_name')),
  array['deleted_at', 'deleted_by', 'deleted_by_first_name', 'deleted_by_last_name'],
  'v_shift_media tiene las columnas de quién y cuándo eliminó, en ese orden y al final'
);
select is(
  (select attname::text from pg_attribute where attrelid = 'public.v_shift_media'::regclass and attnum = 29),
  'expires_on', 'v_shift_media conserva el orden original: expires_on sigue siendo la columna 29'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f5800000-0000-0000-0000-000000000001', 'Cliente de evidencia 0058', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('f5800000-0000-0000-0000-000000000011', 'f5800000-0000-0000-0000-000000000001', 'Sede 0058', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f5800000-0000-0000-0000-000000000081', 'test-db058-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Evidencia')),
  ('f5800000-0000-0000-0000-000000000082', 'test-db058-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Evidencia')),
  ('f5800000-0000-0000-0000-000000000084', 'test-db058-supa@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f5800000-0000-0000-0000-000000000091', 'test-db058-empa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Autora'));

insert into public.user_roles (profile_id, role) values
  ('f5800000-0000-0000-0000-000000000081', 'owner'),
  ('f5800000-0000-0000-0000-000000000082', 'admin'),
  ('f5800000-0000-0000-0000-000000000084', 'supervisor'),
  ('f5800000-0000-0000-0000-000000000091', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f5800000-0000-0000-0000-000000000084', '95800084', 'active'),
  ('f5800000-0000-0000-0000-000000000091', '95800091', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, requires_photos) values
  ('f5800000-0000-0000-0000-000000000101', 'f5800000-0000-0000-0000-000000000001', 'f5800000-0000-0000-0000-000000000011', app.today(), '00:00', '23:59', 1, 'scheduled', true);
insert into public.assignments (id, shift_id, employee_id) values
  ('f5800000-0000-0000-0000-000000000201', 'f5800000-0000-0000-0000-000000000101', 'f5800000-0000-0000-0000-000000000091');

-- b1 foto (1000 bytes); b2 video en «Conservar» (2000); b3 foto cuyo archivo ya venció; b4 foto
-- pendiente (sin confirmar); b5 foto y b6 video para «Conservar» múltiple; b7 foto vencida; b8 foto
-- que no se toca (control de la política de Storage).
insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at, keep, kept_by, kept_at, expired_at)
select
  ('f5800000-0000-0000-0000-0000000000' || n)::uuid,
  'f5800000-0000-0000-0000-000000000101',
  'f5800000-0000-0000-0000-000000000201',
  'f5800000-0000-0000-0000-000000000091',
  kind::public.media_kind,
  'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000' || n || ext,
  'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000' || n || '_thumb.jpg',
  size_bytes,
  confirmed_at,
  keep,
  case when keep then 'f5800000-0000-0000-0000-000000000082'::uuid end,
  case when keep then now() end,
  expired_at
from (values
  ('b1', 'photo', '.jpg', 1000, now(), false, null::timestamptz),
  ('b2', 'video', '.mp4', 2000, now(), true, null),
  ('b3', 'photo', '.jpg', 3000, now(), false, now()),
  ('b4', 'photo', '.jpg', 4000, null, false, null),
  ('b5', 'photo', '.jpg', 5000, now(), false, null),
  ('b6', 'video', '.mp4', 6000, now(), false, null),
  ('b7', 'photo', '.jpg', 7000, now(), false, now()),
  ('b8', 'photo', '.jpg', 8000, now(), false, null)
) as t(n, kind, ext, size_bytes, confirmed_at, keep, expired_at);

-- Objetos de Storage de b1, b2 y b8 (archivo y miniatura).
insert into storage.objects (bucket_id, name, metadata)
select 'evidence', p, '{"size": 10}'::jsonb
from (values
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b1.jpg'),
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b1_thumb.jpg'),
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b2.mp4'),
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b2_thumb.jpg'),
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b8.jpg'),
  ('f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b8_thumb.jpg')
) as o(p);

-- delete_shift_media: quién puede ---------------------------------------------------------------

select tests.as_user('test-db058-empa@example.com');
select is(
  tests.hint_of($$select public.delete_shift_media(array['f5800000-0000-0000-0000-0000000000b1']::uuid[])$$),
  'FORBIDDEN', 'eliminar: un empleado (aunque sea el autor) no puede'
);
select tests.as_user('test-db058-supa@example.com');
select is(
  tests.hint_of($$select public.delete_shift_media(array['f5800000-0000-0000-0000-0000000000b1']::uuid[])$$),
  'FORBIDDEN', 'eliminar: un supervisor no puede'
);
set local role postgres;
select is(
  (select count(*) from public.shift_media where id::text like 'f5800000-%' and deleted_at is not null),
  0::bigint, 'eliminar: los rechazos no marcaron nada'
);

-- delete_shift_media: administrador ---------------------------------------------------------------

select tests.as_user('test-db058-admin@example.com');
-- b1 (se elimina), b3 (archivo vencido), b4 (pendiente) y un id inexistente: solo b1 cuenta.
select set_config('t.d1', public.delete_shift_media(array[
  'f5800000-0000-0000-0000-0000000000b1', 'f5800000-0000-0000-0000-0000000000b3',
  'f5800000-0000-0000-0000-0000000000b4', 'f5800000-0000-0000-0000-0000000000ff'
]::uuid[])::text, true);

select is(
  (select array[v ->> 'requested_count', v ->> 'deleted_count', v ->> 'ignored_count', v ->> 'bytes_freed_estimate']
   from (select current_setting('t.d1')::jsonb as v) q),
  array['4', '1', '3', '1000'],
  'eliminar: el administrador elimina; ignora sin error las que no tienen archivo, las pendientes y las inexistentes'
);
select is(
  current_setting('t.d1')::jsonb -> 'deleted_ids',
  '["f5800000-0000-0000-0000-0000000000b1"]'::jsonb,
  'eliminar: devuelve los ids marcados'
);
select is(
  (select array_agg(p order by p collate "C") from jsonb_array_elements_text(current_setting('t.d1')::jsonb -> 'paths') p),
  array[
    'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b1.jpg',
    'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b1_thumb.jpg'
  ],
  'eliminar: devuelve las rutas del archivo y de la miniatura a borrar de Storage'
);

set local role postgres;
select is(
  (select array[(deleted_at is not null)::text, (deleted_by = 'f5800000-0000-0000-0000-000000000082')::text, (removed_at is null)::text, (expired_at is null)::text]
   from public.shift_media where id = 'f5800000-0000-0000-0000-0000000000b1'),
  array['true', 'true', 'true', 'true'],
  'eliminar: marca deleted_at y deleted_by; no toca removed_at ni expired_at (la fila queda como constancia)'
);
select is(
  (select count(*) from public.shift_media where id in (
     'f5800000-0000-0000-0000-0000000000b3', 'f5800000-0000-0000-0000-0000000000b4') and deleted_at is not null),
  0::bigint, 'eliminar: no marca las filas sin archivo ni las pendientes'
);
select is(
  (select count(*) from public.security_events
   where event_type = 'media_deleted' and actor_id = 'f5800000-0000-0000-0000-000000000082'),
  1::bigint, 'eliminar: deja un evento de seguridad media_deleted del administrador'
);
select is(
  (select array[details ->> 'count', details ->> 'bytes_freed_estimate', details -> 'media_ids' ->> 0]
   from public.security_events
   where event_type = 'media_deleted' and actor_id = 'f5800000-0000-0000-0000-000000000082'),
  array['1', '1000', 'f5800000-0000-0000-0000-0000000000b1'],
  'eliminar: el evento registra cantidad, ids y bytes liberados'
);

-- Idempotencia: repetir no vuelve a marcar ni a registrar.
select tests.as_user('test-db058-admin@example.com');
select is(
  (select public.delete_shift_media(array['f5800000-0000-0000-0000-0000000000b1']::uuid[]) ->> 'deleted_count'),
  '0', 'eliminar: repetir la misma eliminación no marca nada (idempotente)'
);
set local role postgres;
select is(
  (select count(*) from public.security_events
   where event_type = 'media_deleted' and actor_id = 'f5800000-0000-0000-0000-000000000082'),
  1::bigint, 'eliminar: una eliminación que no cambia nada no registra evento'
);

-- delete_shift_media: dueño, también lo marcado «Conservar» ----------------------------------------

select tests.as_user('test-db058-owner@example.com');
select is(
  (select public.delete_shift_media(array['f5800000-0000-0000-0000-0000000000b2']::uuid[]) ->> 'bytes_freed_estimate'),
  '2000', 'eliminar: el dueño elimina también un archivo marcado «Conservar»'
);
set local role postgres;
select is(
  (select array[(deleted_at is not null)::text, (deleted_by = 'f5800000-0000-0000-0000-000000000081')::text, keep::text]
   from public.shift_media where id = 'f5800000-0000-0000-0000-0000000000b2'),
  array['true', 'true', 'true'], 'eliminar: la fila «Conservar» queda eliminada por el dueño (keep no cambia)'
);

-- delete_shift_media: lista vacía y tope -----------------------------------------------------------

select tests.as_user('test-db058-admin@example.com');
select is(tests.hint_of($$select public.delete_shift_media('{}'::uuid[])$$), 'MEDIA_IDS_REQUIRED', 'eliminar: lista vacía');
select is(tests.hint_of($$select public.delete_shift_media(null)$$), 'MEDIA_IDS_REQUIRED', 'eliminar: lista nula');
select is(
  tests.hint_of($$select public.delete_shift_media(array(select gen_random_uuid() from generate_series(1, 201)))$$),
  'MEDIA_TOO_MANY', 'eliminar: más de 200 archivos'
);
select is(
  (select public.delete_shift_media(array(select gen_random_uuid() from generate_series(1, 200))) ->> 'requested_count'),
  '200', 'eliminar: 200 archivos exactos entran en el tope'
);

-- v_shift_media ----------------------------------------------------------------------------------

select is(
  (select array[has_file::text, expires_on::text, (deleted_at is not null)::text, deleted_by_first_name, deleted_by_last_name]
   from public.v_shift_media where id = 'f5800000-0000-0000-0000-0000000000b1'),
  array['false', null, 'true', 'Admin', 'Evidencia'],
  'v_shift_media: la eliminada sigue apareciendo, sin archivo, con quién la eliminó'
);
select is(
  (select array[has_file::text, (deleted_at is null)::text, deleted_by_first_name]
   from public.v_shift_media where id = 'f5800000-0000-0000-0000-0000000000b8'),
  array['true', 'true', null], 'v_shift_media: una no eliminada conserva has_file y no trae eliminador'
);
select is(
  (select array[has_file::text, expires_on::text, keep::text, deleted_by_first_name]
   from public.v_shift_media where id = 'f5800000-0000-0000-0000-0000000000b2'),
  array['false', null, 'true', 'Dueña'], 'v_shift_media: la «Conservar» eliminada tampoco tiene archivo'
);
select tests.as_user('test-db058-empa@example.com');
select is(
  (select array[has_file::text, (deleted_at is not null)::text, deleted_by_first_name] from public.v_shift_media where id = 'f5800000-0000-0000-0000-0000000000b1'),
  array['false', 'true', null], 'v_shift_media: la autora ve su foto eliminada como constancia (el nombre de quien eliminó no, por la RLS de profiles)'
);

-- Política de Storage ----------------------------------------------------------------------------

select tests.as_user('test-db058-empa@example.com');
select is(
  tests.borrar_objetos('%0000-0000-0000-0000000000b1%'),
  0::bigint, 'Storage: la autora no borra los objetos de una fila eliminada por administración'
);
select tests.as_user('test-db058-supa@example.com');
select is(
  tests.borrar_objetos('f5800000-%'),
  0::bigint, 'Storage: el supervisor no borra evidencia'
);
set local role postgres;
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence' and name like 'f5800000-%'),
  6::bigint, 'Storage: tras los intentos no autorizados siguen los seis objetos'
);

select tests.as_user('test-db058-admin@example.com');
select is(
  tests.borrar_objetos('%0000-0000-0000-0000000000b8%'),
  0::bigint, 'Storage: el administrador no borra los objetos de una fila que no se eliminó'
);
select is(
  tests.borrar_objetos('%0000-0000-0000-0000000000b1%'),
  2::bigint, 'Storage: el administrador borra archivo y miniatura de una fila eliminada'
);
select tests.as_user('test-db058-owner@example.com');
select is(
  tests.borrar_objetos('%0000-0000-0000-0000000000b2%'),
  2::bigint, 'Storage: el dueño borra los objetos de una fila eliminada (también «Conservar»)'
);
set local role postgres;
select is(
  (select array_agg(name order by name collate "C") from storage.objects where bucket_id = 'evidence' and name like 'f5800000-%'),
  array[
    'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b8.jpg',
    'f5800000-0000-0000-0000-000000000101/f5800000-0000-0000-0000-0000000000b8_thumb.jpg'
  ],
  'Storage: quedan solo los objetos de la fila que no se eliminó'
);

-- Barrido nocturno ------------------------------------------------------------------------------

select is(
  (select reason from public.evidence_cleanup_candidates(10000) where media_id = 'f5800000-0000-0000-0000-0000000000b1'),
  'deleted', 'barrido: una fila eliminada a mano con expired_at nulo es candidata con reason deleted'
);
select is(
  (select reason from public.evidence_cleanup_candidates(10000) where media_id = 'f5800000-0000-0000-0000-0000000000b2'),
  'deleted', 'barrido: también la «Conservar» eliminada (keep no la salva)'
);
select is(
  (select count(*) from public.evidence_cleanup_candidates(10000) where media_id = 'f5800000-0000-0000-0000-0000000000b8'),
  0::bigint, 'barrido: una fila vigente no es candidata'
);
select is(
  public.evidence_cleanup_mark(array['f5800000-0000-0000-0000-0000000000b1']::uuid[]),
  1, 'barrido: marcar la eliminada fija expired_at'
);
select is(
  (select count(*) from public.evidence_cleanup_candidates(10000) where media_id = 'f5800000-0000-0000-0000-0000000000b1'),
  0::bigint, 'barrido: ya marcada deja de ser candidata'
);
select is(
  (select array[has_file::text, (deleted_at is not null)::text] from public.v_shift_media where id = 'f5800000-0000-0000-0000-0000000000b1'),
  array['false', 'true'], 'barrido: la constancia de la eliminación se conserva en la vista'
);

-- set_shift_media_keep_many ------------------------------------------------------------------------

select tests.as_user('test-db058-empa@example.com');
select is(
  tests.hint_of($$select public.set_shift_media_keep_many(array['f5800000-0000-0000-0000-0000000000b5']::uuid[], true)$$),
  'FORBIDDEN', 'conservar varias: un empleado no puede'
);
select tests.as_user('test-db058-supa@example.com');
select is(
  tests.hint_of($$select public.set_shift_media_keep_many(array['f5800000-0000-0000-0000-0000000000b5']::uuid[], true)$$),
  'FORBIDDEN', 'conservar varias: un supervisor no puede'
);

select tests.as_user('test-db058-admin@example.com');
-- b5 y b6 cambian; b3 y b7 (sin archivo), b4 (pendiente), b2 (eliminada) y un inexistente se ignoran.
select is(
  public.set_shift_media_keep_many(array[
    'f5800000-0000-0000-0000-0000000000b5', 'f5800000-0000-0000-0000-0000000000b6',
    'f5800000-0000-0000-0000-0000000000b3', 'f5800000-0000-0000-0000-0000000000b7',
    'f5800000-0000-0000-0000-0000000000b4', 'f5800000-0000-0000-0000-0000000000b2',
    'f5800000-0000-0000-0000-0000000000ff'
  ]::uuid[], true),
  2, 'conservar varias: el administrador marca dos y devuelve cuántas cambió'
);
select is(
  (select array_agg(array[right(id::text, 2), keep::text, (kept_by = 'f5800000-0000-0000-0000-000000000082')::text, (kept_at is not null)::text] order by id)
   from public.shift_media where id in (
     'f5800000-0000-0000-0000-0000000000b5', 'f5800000-0000-0000-0000-0000000000b6')),
  array[array['b5', 'true', 'true', 'true'], array['b6', 'true', 'true', 'true']],
  'conservar varias: deja keep, kept_by y kept_at como la individual'
);
select is(
  (select count(*) from public.shift_media where id in (
     'f5800000-0000-0000-0000-0000000000b3', 'f5800000-0000-0000-0000-0000000000b4',
     'f5800000-0000-0000-0000-0000000000b7') and keep),
  0::bigint, 'conservar varias: ignora las filas sin archivo y las pendientes'
);
select is(
  public.set_shift_media_keep_many(array['f5800000-0000-0000-0000-0000000000b5']::uuid[], true),
  0, 'conservar varias: si ya estaba como se pide no cuenta'
);

select tests.as_user('test-db058-owner@example.com');
select is(
  public.set_shift_media_keep_many(array['f5800000-0000-0000-0000-0000000000b5', 'f5800000-0000-0000-0000-0000000000b6']::uuid[], false),
  2, 'conservar varias: el dueño desmarca dos'
);
select is(
  (select array_agg(array[keep::text, (kept_by is null)::text, (kept_at is null)::text] order by id)
   from public.shift_media where id in (
     'f5800000-0000-0000-0000-0000000000b5', 'f5800000-0000-0000-0000-0000000000b6')),
  array[array['false', 'true', 'true'], array['false', 'true', 'true']],
  'conservar varias: al desmarcar limpia kept_by y kept_at'
);

select is(tests.hint_of($$select public.set_shift_media_keep_many('{}'::uuid[], true)$$), 'MEDIA_IDS_REQUIRED', 'conservar varias: lista vacía');
select is(tests.hint_of($$select public.set_shift_media_keep_many(null, true)$$), 'MEDIA_IDS_REQUIRED', 'conservar varias: lista nula');
select is(
  tests.hint_of($$select public.set_shift_media_keep_many(array(select gen_random_uuid() from generate_series(1, 201)), true)$$),
  'MEDIA_TOO_MANY', 'conservar varias: más de 200 archivos'
);
select is(
  public.set_shift_media_keep_many(array(select gen_random_uuid() from generate_series(1, 200)), true),
  0, 'conservar varias: 200 archivos exactos entran en el tope'
);
select is(
  tests.hint_of($$select public.set_shift_media_keep_many(array['f5800000-0000-0000-0000-0000000000b5']::uuid[], null)$$),
  'KEEP_REQUIRED', 'conservar varias: p_keep nulo no vale'
);

-- set_shift_media_keep (individual): mismo contrato; una eliminada ya no tiene archivo.
select is(
  (select keep from public.set_shift_media_keep('f5800000-0000-0000-0000-0000000000b5', true)),
  true, 'conservar una: la individual sigue andando igual'
);
select is(
  tests.hint_of($$select public.set_shift_media_keep('f5800000-0000-0000-0000-0000000000b1', true)$$),
  'MEDIA_EXPIRED', 'conservar una: una fila eliminada por administración responde MEDIA_EXPIRED'
);

select * from finish();

rollback;
