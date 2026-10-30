-- pgTAP de la migración 0047_p21_1_evidencia.sql (P21.1, módulo H · evidencia fotográfica), parte 1:
-- estructura, begin/confirm/remove/keep de shift_media, RLS por rol, políticas de Storage y vista
-- v_shift_media. La parte 2 (herencia de requires_photos, plazos, barrido, uso de espacio,
-- delete_service y vistas del celular) está en 0047_p21_1_evidencia_turnos.test.sql.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4700000-...'. Los turnos de prueba abarcan todo el día de hoy (00:00 a 23:59,
-- hora de Argentina) para que la ventana de subida esté abierta a cualquier hora, también cerca de
-- la medianoche; el de «todavía no empezó» es de mañana y el de «ventana cerrada» de hace dos días.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0047a;
grant usage on schema tests_0047a to authenticated, anon;

create or replace function tests_0047a.as_user(p_email text)
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
    raise exception 'tests_0047a.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0047a.as_user(text) to authenticated, anon;

-- Devuelve el código estable (hint) del error que levanta la consulta, o null si no falla.
create or replace function tests_0047a.hint_of(p_sql text)
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

grant execute on function tests_0047a.hint_of(text) to authenticated, anon;

select plan(83);

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'shift_media', 'existe shift_media');
select enum_has_labels('public', 'media_kind', array['photo', 'video'], 'media_kind: photo y video');
select col_type_is('public', 'shift_media', 'size_bytes', 'bigint', 'size_bytes es bigint');
select col_type_is('public', 'shift_media', 'duration_s', 'numeric(6,1)', 'duration_s es numeric(6,1)');
select col_is_null('public', 'shift_media', 'confirmed_at', 'confirmed_at admite null (subida pendiente)');
select col_not_null('public', 'shift_media', 'uploaded_by', 'uploaded_by es obligatorio');
select col_default_is('public', 'shift_media', 'keep', 'false', 'keep arranca en false');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.shift_media'::regclass),
  'shift_media tiene RLS habilitada'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_media' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0::bigint,
  'shift_media no tiene políticas de insert, update ni delete'
);
select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shift_media' and cmd = 'SELECT'),
  2::bigint,
  'shift_media tiene dos políticas de select (administración y autor)'
);
select ok(
  not has_table_privilege('authenticated', 'public.shift_media', 'insert')
    and not has_table_privilege('authenticated', 'public.shift_media', 'update')
    and not has_table_privilege('authenticated', 'public.shift_media', 'delete')
    and has_table_privilege('authenticated', 'public.shift_media', 'select')
    and not has_table_privilege('anon', 'public.shift_media', 'select'),
  'grants de shift_media: authenticated solo select; anon nada'
);
select is(
  (select reloptions from pg_class where oid = 'public.v_shift_media'::regclass),
  array['security_invoker=true'],
  'v_shift_media es security_invoker'
);
select is(
  (select array[public::text, file_size_limit::text, array_to_string(allowed_mime_types, ',')] from storage.buckets where id = 'evidence'),
  array['false', '20971520', 'image/jpeg,video/mp4,video/webm'],
  'bucket evidence: privado, 20 MB, jpeg, mp4 y webm'
);
select is(
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'evidence\_%'),
  5::bigint,
  'Storage: cinco políticas del bucket evidence (2 select, insert y 2 delete: autor y administración, 0058)'
);
select ok(
  has_function_privilege('authenticated', 'public.begin_shift_media(uuid, public.media_kind, text, bigint, bigint, integer, integer, numeric, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.begin_shift_media(uuid, public.media_kind, text, bigint, bigint, integer, integer, numeric, timestamptz)', 'execute')
    and has_function_privilege('authenticated', 'public.confirm_shift_media(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.remove_shift_media(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.set_shift_media_keep(uuid, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.storage_usage()', 'execute')
    and not has_function_privilege('anon', 'public.storage_usage()', 'execute'),
  'grants: las RPC de evidencia para authenticated y no para anon'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f4700000-0000-0000-0000-000000000001', 'Cliente de evidencia 0047', 'active');
insert into public.sites (id, client_id, name, address, status, photos_not_allowed) values
  ('f4700000-0000-0000-0000-000000000011', 'f4700000-0000-0000-0000-000000000001', 'Sede con fotos 0047', 'Dirección 1', 'active', false),
  ('f4700000-0000-0000-0000-000000000012', 'f4700000-0000-0000-0000-000000000001', 'Sede sin fotos 0047', 'Dirección 2', 'active', true);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4700000-0000-0000-0000-000000000081', 'test-db047-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Evidencia')),
  ('f4700000-0000-0000-0000-000000000082', 'test-db047-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Evidencia')),
  ('f4700000-0000-0000-0000-000000000084', 'test-db047-supa@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f4700000-0000-0000-0000-000000000085', 'test-db047-supb@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visorb')),
  ('f4700000-0000-0000-0000-000000000086', 'test-db047-suph@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Cancelada')),
  ('f4700000-0000-0000-0000-000000000091', 'test-db047-empa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Asignada')),
  ('f4700000-0000-0000-0000-000000000092', 'test-db047-empb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Otro')),
  ('f4700000-0000-0000-0000-000000000093', 'test-db047-empc@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Ajena')),
  ('f4700000-0000-0000-0000-000000000094', 'test-db047-empd@example.com', jsonb_build_object('first_name', 'Dani', 'last_name', 'SinFotos')),
  ('f4700000-0000-0000-0000-000000000095', 'test-db047-empe@example.com', jsonb_build_object('first_name', 'Eli', 'last_name', 'Mañana')),
  ('f4700000-0000-0000-0000-000000000096', 'test-db047-empf@example.com', jsonb_build_object('first_name', 'Fede', 'last_name', 'Antes')),
  ('f4700000-0000-0000-0000-000000000097', 'test-db047-empg@example.com', jsonb_build_object('first_name', 'Gabi', 'last_name', 'Cancelado'));

insert into public.user_roles (profile_id, role) values
  ('f4700000-0000-0000-0000-000000000081', 'owner'),
  ('f4700000-0000-0000-0000-000000000082', 'admin'),
  ('f4700000-0000-0000-0000-000000000084', 'supervisor'),
  ('f4700000-0000-0000-0000-000000000085', 'supervisor'),
  ('f4700000-0000-0000-0000-000000000086', 'supervisor'),
  ('f4700000-0000-0000-0000-000000000091', 'employee'),
  ('f4700000-0000-0000-0000-000000000092', 'employee'),
  ('f4700000-0000-0000-0000-000000000093', 'employee'),
  ('f4700000-0000-0000-0000-000000000094', 'employee'),
  ('f4700000-0000-0000-0000-000000000095', 'employee'),
  ('f4700000-0000-0000-0000-000000000096', 'employee'),
  ('f4700000-0000-0000-0000-000000000097', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f4700000-0000-0000-0000-000000000084', '94700084', 'active'),
  ('f4700000-0000-0000-0000-000000000085', '94700085', 'active'),
  ('f4700000-0000-0000-0000-000000000086', '94700086', 'active'),
  ('f4700000-0000-0000-0000-000000000091', '94700091', 'active'),
  ('f4700000-0000-0000-0000-000000000092', '94700092', 'active'),
  ('f4700000-0000-0000-0000-000000000093', '94700093', 'active'),
  ('f4700000-0000-0000-0000-000000000094', '94700094', 'active'),
  ('f4700000-0000-0000-0000-000000000095', '94700095', 'active'),
  ('f4700000-0000-0000-0000-000000000096', '94700096', 'active'),
  ('f4700000-0000-0000-0000-000000000097', '94700097', 'active');

-- 101: hoy todo el día, sede con fotos, pide fotos; empA asignada; supA supervisa; supH tiene una
--      supervisión cancelada.
-- 102: hoy, sede SIN fotos; empD.   103: mañana; empE.   104: hace dos días; empF.
-- 105: hoy, otro turno; empB asignado y supB supervisa.   106: hoy, cancelado; empG.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, requires_photos) values
  ('f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000011', app.today(), '00:00', '23:59', 1, 'scheduled', true),
  ('f4700000-0000-0000-0000-000000000102', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000012', app.today(), '00:00', '23:59', 1, 'scheduled', false),
  ('f4700000-0000-0000-0000-000000000103', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000011', app.today() + 1, '08:00', '12:00', 1, 'scheduled', false),
  ('f4700000-0000-0000-0000-000000000104', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000011', app.today() - 2, '08:00', '09:00', 1, 'completed', false),
  ('f4700000-0000-0000-0000-000000000105', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000011', app.today(), '00:00', '23:59', 1, 'scheduled', false),
  ('f4700000-0000-0000-0000-000000000106', 'f4700000-0000-0000-0000-000000000001', 'f4700000-0000-0000-0000-000000000011', app.today(), '00:00', '23:59', 1, 'scheduled', false);

insert into public.assignments (id, shift_id, employee_id) values
  ('f4700000-0000-0000-0000-000000000201', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000091'),
  ('f4700000-0000-0000-0000-000000000202', 'f4700000-0000-0000-0000-000000000102', 'f4700000-0000-0000-0000-000000000094'),
  ('f4700000-0000-0000-0000-000000000203', 'f4700000-0000-0000-0000-000000000103', 'f4700000-0000-0000-0000-000000000095'),
  ('f4700000-0000-0000-0000-000000000204', 'f4700000-0000-0000-0000-000000000104', 'f4700000-0000-0000-0000-000000000096'),
  ('f4700000-0000-0000-0000-000000000205', 'f4700000-0000-0000-0000-000000000105', 'f4700000-0000-0000-0000-000000000092'),
  ('f4700000-0000-0000-0000-000000000206', 'f4700000-0000-0000-0000-000000000106', 'f4700000-0000-0000-0000-000000000097');

update public.shifts
set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f4700000-0000-0000-0000-000000000081', cancel_reason = 'Cancelado para la prueba'
where id = 'f4700000-0000-0000-0000-000000000106';

insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('f4700000-0000-0000-0000-000000000301', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000084', 'assigned'),
  ('f4700000-0000-0000-0000-000000000302', 'f4700000-0000-0000-0000-000000000105', 'f4700000-0000-0000-0000-000000000085', 'assigned');
insert into public.supervisions (id, shift_id, supervisor_id, status, cancel_reason) values
  ('f4700000-0000-0000-0000-000000000303', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000086', 'cancelled', 'Se canceló');

-- Una foto vieja ya confirmada de empF en el turno de hace dos días (ventana cerrada).
insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at) values
  ('f4700000-0000-0000-0000-000000000a01', 'f4700000-0000-0000-0000-000000000104', 'f4700000-0000-0000-0000-000000000204', 'f4700000-0000-0000-0000-000000000096', 'photo',
   'f4700000-0000-0000-0000-000000000104/f4700000-0000-0000-0000-000000000a01.jpg',
   'f4700000-0000-0000-0000-000000000104/f4700000-0000-0000-0000-000000000a01_thumb.jpg', 1000, now());

-- begin_shift_media: validaciones --------------------------------------------------------------

select tests_0047a.as_user('test-db047-empc@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000)$$),
  'NOT_SHIFT_PARTICIPANT', 'un empleado no asignado al turno no puede subir'
);

select tests_0047a.as_user('test-db047-admin@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000)$$),
  'FORBIDDEN', 'un administrador no puede subir (H-02)'
);
select tests_0047a.as_user('test-db047-owner@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000)$$),
  'FORBIDDEN', 'un dueño no puede subir (H-02)'
);

select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000999', 'photo', 'image/jpeg', 150000, 20000)$$),
  'SHIFT_NOT_FOUND', 'turno inexistente'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'video/mp4', 150000, 20000)$$),
  'MEDIA_INVALID_TYPE', 'una foto tiene que ser image/jpeg'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'video', 'image/jpeg', 150000, 20000, null, null, 10)$$),
  'MEDIA_INVALID_TYPE', 'un video tiene que ser mp4 o webm'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 0, 20000)$$),
  'MEDIA_INVALID_SIZE', 'tamaño cero'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 20971521, 20000)$$),
  'MEDIA_TOO_LARGE', 'más de 20 MB'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'video', 'video/mp4', 3000000, 20000, 854, 480, 31)$$),
  'MEDIA_TOO_LONG', 'un video de más de 30 segundos se rechaza'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'video', 'video/mp4', 3000000, 20000, 854, 480, null)$$),
  'MEDIA_INVALID_DURATION', 'un video sin duración se rechaza'
);

select tests_0047a.as_user('test-db047-empd@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000102', 'photo', 'image/jpeg', 150000, 20000)$$),
  'PHOTOS_NOT_ALLOWED', 'sede con photos_not_allowed: la base rechaza (H-13)'
);
select tests_0047a.as_user('test-db047-empe@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000103', 'photo', 'image/jpeg', 150000, 20000)$$),
  'MEDIA_WINDOW_NOT_OPEN', 'antes del inicio del turno no se puede subir (H-12)'
);
select tests_0047a.as_user('test-db047-empf@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000104', 'photo', 'image/jpeg', 150000, 20000)$$),
  'MEDIA_WINDOW_CLOSED', 'más de 2 horas después del fin no se puede subir (H-12)'
);
select tests_0047a.as_user('test-db047-empg@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000106', 'photo', 'image/jpeg', 150000, 20000)$$),
  'SHIFT_CANCELLED', 'turno cancelado'
);
select tests_0047a.as_user('test-db047-suph@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000)$$),
  'NOT_SHIFT_PARTICIPANT', 'un supervisor con la supervisión cancelada no puede subir'
);
select tests_0047a.as_user('test-db047-supa@example.com');
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000105', 'photo', 'image/jpeg', 150000, 20000)$$),
  'NOT_SHIFT_PARTICIPANT', 'un supervisor no sube a un turno que no supervisa'
);

-- begin_shift_media: flujo feliz del empleado ---------------------------------------------------

select tests_0047a.as_user('test-db047-empa@example.com');
select set_config('t.r1', public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000, 1280, 960, null, now() - interval '1 hour')::text, true);
select set_config('t.m1', current_setting('t.r1')::jsonb -> 'media' ->> 'id', true);

select is(current_setting('t.r1')::jsonb ->> 'bucket', 'evidence', 'begin devuelve el bucket');
select is(
  current_setting('t.r1')::jsonb ->> 'storage_path',
  'f4700000-0000-0000-0000-000000000101/' || current_setting('t.m1') || '.jpg',
  'ruta del archivo: {shift_id}/{media_id}.jpg'
);
select is(
  current_setting('t.r1')::jsonb ->> 'thumb_path',
  'f4700000-0000-0000-0000-000000000101/' || current_setting('t.m1') || '_thumb.jpg',
  'ruta de la miniatura: {shift_id}/{media_id}_thumb.jpg'
);
select is(
  (select array[(assignment_id is not null)::text, (supervision_id is null)::text, (confirmed_at is null)::text, size_bytes::text, uploaded_by::text]
   from public.shift_media where id = current_setting('t.m1')::uuid),
  array['true', 'true', 'true', '170000', 'f4700000-0000-0000-0000-000000000091'],
  'fila pendiente del empleado: con assignment_id, sin confirmar, size = archivo + miniatura'
);

-- Políticas de Storage ---------------------------------------------------------------------------

select lives_ok(
  format(
    $f$insert into storage.objects (bucket_id, name, metadata) values
        ('evidence', %L, '{"size": 150000}'), ('evidence', %L, '{"size": 20000}')$f$,
    current_setting('t.r1')::jsonb ->> 'storage_path', current_setting('t.r1')::jsonb ->> 'thumb_path'
  ),
  'Storage: el autor escribe en las rutas de su fila pendiente'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, metadata) values ('evidence', 'f4700000-0000-0000-0000-000000000101/cualquiera.jpg', '{"size": 10}')$$,
  '42501', null, 'Storage: no se puede escribir en una ruta sin fila pendiente'
);

select tests_0047a.as_user('test-db047-empb@example.com');
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, metadata) values ('evidence', %L, '{"size": 10}')$f$, current_setting('t.r1')::jsonb ->> 'storage_path'),
  '42501', null, 'Storage: otro empleado no escribe en la ruta de una fila ajena'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence' and name like 'f4700000-%'),
  0::bigint, 'Storage: otro empleado no lee archivos ajenos'
);

-- confirm_shift_media ----------------------------------------------------------------------------

select is(
  tests_0047a.hint_of(format($f$select public.confirm_shift_media(%L)$f$, current_setting('t.m1'))),
  'NOT_YOUR_MEDIA', 'confirm: solo el autor'
);

select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  tests_0047a.hint_of($$select public.confirm_shift_media('f4700000-0000-0000-0000-000000000999')$$),
  'MEDIA_NOT_FOUND', 'confirm: fila inexistente'
);
select set_config('t.r2', public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 100, 100)::text, true);
select is(
  tests_0047a.hint_of(format($f$select public.confirm_shift_media(%L)$f$, current_setting('t.r2')::jsonb -> 'media' ->> 'id')),
  'MEDIA_UPLOAD_INCOMPLETE', 'confirm: sin los dos archivos en Storage no confirma'
);
select is(
  (public.confirm_shift_media(current_setting('t.m1')::uuid)).size_bytes,
  170000::bigint, 'confirm: confirma y fija el tamaño real guardado en Storage'
);
select set_config('t.confirmed1', (select confirmed_at::text from public.shift_media where id = current_setting('t.m1')::uuid), true);
select is(
  (select (public.confirm_shift_media(current_setting('t.m1')::uuid)).confirmed_at::text),
  current_setting('t.confirmed1'), 'confirm: confirmar de nuevo no cambia nada'
);
select throws_ok(
  format($f$insert into storage.objects (bucket_id, name, metadata) values ('evidence', %L, '{"size": 10}')$f$, current_setting('t.r1')::jsonb ->> 'storage_path'),
  '42501', null, 'Storage: una fila confirmada ya no admite escritura'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence' and name like 'f4700000-%'),
  2::bigint, 'Storage: el autor lee sus archivos'
);

-- Topes (H-11) -----------------------------------------------------------------------------------

-- Ya hay 2 fotos de empA (m1 confirmada y r2 pendiente): 8 más llegan a 10.
select is(
  (select count(*) from (
     select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 100, 100)
     from generate_series(1, 8)
   ) q),
  8::bigint, 'hasta 10 fotos por persona y turno'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 100, 100)$$),
  'MEDIA_LIMIT_REACHED', 'la foto 11 se rechaza'
);
select is(
  (select count(*) from (
     select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'video', 'video/mp4', 3000000, 20000, 854, 480, 30)
     from generate_series(1, 2)
   ) q),
  2::bigint, 'hasta 2 videos por persona y turno (30 s exactos entran)'
);
select is(
  tests_0047a.hint_of($$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'video', 'video/webm', 3000000, 20000, 854, 480, 5)$$),
  'MEDIA_LIMIT_REACHED', 'el video 3 se rechaza'
);

-- remove_shift_media (H-15) ---------------------------------------------------------------------

select tests_0047a.as_user('test-db047-empb@example.com');
select is(
  tests_0047a.hint_of(format($f$select public.remove_shift_media(%L)$f$, current_setting('t.m1'))),
  'NOT_YOUR_MEDIA', 'remove: solo el autor'
);
select tests_0047a.as_user('test-db047-empf@example.com');
select is(
  tests_0047a.hint_of($$select public.remove_shift_media('f4700000-0000-0000-0000-000000000a01')$$),
  'MEDIA_WINDOW_CLOSED', 'remove: con la ventana cerrada no se puede quitar'
);
select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  (select (public.remove_shift_media(current_setting('t.m1')::uuid)).removed_by::text),
  'f4700000-0000-0000-0000-000000000091', 'remove: el autor quita su foto'
);
select is(
  (select (public.remove_shift_media(current_setting('t.m1')::uuid)).removed_at is not null),
  true, 'remove: quitar de nuevo es inocuo'
);
select lives_ok(
  $$select public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 100, 100)$$,
  'una foto quitada libera un lugar del tope'
);

-- El supervisor sube como supervisor (H-02) ------------------------------------------------------

select tests_0047a.as_user('test-db047-supa@example.com');
select set_config('t.r3', public.begin_shift_media('f4700000-0000-0000-0000-000000000101', 'photo', 'image/jpeg', 150000, 20000)::text, true);
select is(
  (select array[(assignment_id is null)::text, supervision_id::text] from public.shift_media where id = (current_setting('t.r3')::jsonb -> 'media' ->> 'id')::uuid),
  array['true', 'f4700000-0000-0000-0000-000000000301'],
  'el supervisor sube con su supervision_id y sin assignment_id'
);
select is(
  (select count(*) from public.shift_media where uploaded_by <> 'f4700000-0000-0000-0000-000000000084'),
  0::bigint, 'RLS: el supervisor no ve lo que subió el empleado del mismo turno'
);
select is(
  (select count(*) from public.shift_media),
  1::bigint, 'RLS: el supervisor ve solo lo suyo'
);
select throws_ok(
  $$insert into public.shift_media (shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes) values ('f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000201', 'f4700000-0000-0000-0000-000000000084', 'photo', 'x', 'y', 1)$$,
  '42501', null, 'RLS: nadie inserta directo en shift_media'
);
select throws_ok(
  $$update public.shift_media set keep = true$$,
  '42501', null, 'RLS: nadie actualiza directo shift_media'
);
select throws_ok(
  $$delete from public.shift_media$$,
  '42501', null, 'RLS: nadie borra de shift_media'
);

-- RLS de lectura ---------------------------------------------------------------------------------

select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  (select count(*) from public.shift_media where uploaded_by <> 'f4700000-0000-0000-0000-000000000091'),
  0::bigint, 'RLS: el empleado no ve lo ajeno'
);
select cmp_ok((select count(*) from public.shift_media), '>', 0::bigint, 'RLS: el empleado ve lo suyo');

select tests_0047a.as_user('test-db047-empb@example.com');
select is((select count(*) from public.shift_media), 0::bigint, 'RLS: otro empleado del día no ve nada de ese turno');
select tests_0047a.as_user('test-db047-supb@example.com');
select is((select count(*) from public.shift_media), 0::bigint, 'RLS: el supervisor de otro turno no ve nada');

set local role postgres;
select set_config('t.total', (select count(*)::text from public.shift_media), true);
select tests_0047a.as_user('test-db047-admin@example.com');
select is((select count(*)::text from public.shift_media), current_setting('t.total'), 'RLS: el administrador ve todo');
select tests_0047a.as_user('test-db047-owner@example.com');
select is((select count(*)::text from public.shift_media), current_setting('t.total'), 'RLS: el dueño ve todo');
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence' and name like 'f4700000-%'),
  2::bigint, 'Storage: dueño y administradores leen todo el bucket'
);

-- set_shift_media_keep ---------------------------------------------------------------------------

select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  tests_0047a.hint_of(format($f$select public.set_shift_media_keep(%L, true)$f$, current_setting('t.m1'))),
  'FORBIDDEN', 'keep: un empleado no puede conservar'
);
select tests_0047a.as_user('test-db047-supa@example.com');
select is(
  tests_0047a.hint_of(format($f$select public.set_shift_media_keep(%L, true)$f$, current_setting('t.m1'))),
  'FORBIDDEN', 'keep: un supervisor no puede conservar'
);

-- Una confirmada para conservar (la hacemos con permisos de base: la subida real ya se probó).
set local role postgres;
insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at) values
  ('f4700000-0000-0000-0000-000000000a02', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000201', 'f4700000-0000-0000-0000-000000000091', 'photo',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a02.jpg',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a02_thumb.jpg', 2000, now() - interval '5 days'),
  ('f4700000-0000-0000-0000-000000000a03', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000201', 'f4700000-0000-0000-0000-000000000091', 'video',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a03.mp4',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a03_thumb.jpg', 2000, now() - interval '5 days');
insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at, expired_at) values
  ('f4700000-0000-0000-0000-000000000a04', 'f4700000-0000-0000-0000-000000000101', 'f4700000-0000-0000-0000-000000000201', 'f4700000-0000-0000-0000-000000000091', 'photo',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a04.jpg',
   'f4700000-0000-0000-0000-000000000101/f4700000-0000-0000-0000-000000000a04_thumb.jpg', 2000, now() - interval '70 days', now());

select tests_0047a.as_user('test-db047-admin@example.com');
select is(
  (select array[keep::text, (kept_by is not null)::text, (kept_at is not null)::text] from public.set_shift_media_keep('f4700000-0000-0000-0000-000000000a02', true)),
  array['true', 'true', 'true'], 'keep: el administrador conserva un archivo'
);
select is(
  (select array[keep::text, (kept_by is null)::text, (kept_at is null)::text] from public.set_shift_media_keep('f4700000-0000-0000-0000-000000000a02', false)),
  array['false', 'true', 'true'], 'keep: y lo deja de conservar'
);
select is(
  tests_0047a.hint_of($$select public.set_shift_media_keep('f4700000-0000-0000-0000-000000000a04', true)$$),
  'MEDIA_EXPIRED', 'keep: un archivo ya vencido no se puede conservar'
);
select is(
  tests_0047a.hint_of(format($f$select public.set_shift_media_keep(%L, true)$f$, current_setting('t.r2')::jsonb -> 'media' ->> 'id')),
  'MEDIA_NOT_FOUND', 'keep: una subida pendiente no existe todavía'
);
select is(
  tests_0047a.hint_of(format($f$select public.set_shift_media_keep(%L, true)$f$, current_setting('t.m1'))),
  'MEDIA_NOT_FOUND', 'keep: una foto quitada no existe'
);
select is(
  tests_0047a.hint_of($$select public.set_shift_media_keep('f4700000-0000-0000-0000-000000000a02', null)$$),
  'KEEP_REQUIRED', 'keep: null no vale'
);
select is(
  (select keep from public.set_shift_media_keep('f4700000-0000-0000-0000-000000000a03', true)),
  true, 'keep: el dueño o el administrador pueden conservar un video'
);

-- v_shift_media ----------------------------------------------------------------------------------

select is(
  (select count(*) from public.v_shift_media where id in (current_setting('t.m1')::uuid, (current_setting('t.r2')::jsonb -> 'media' ->> 'id')::uuid)),
  0::bigint, 'v_shift_media: no muestra pendientes ni quitadas'
);
select is(
  (select array[client_name, site_name, uploader_first_name, uploader_role, retention_days::text, expires_on::text]
   from public.v_shift_media where id = 'f4700000-0000-0000-0000-000000000a02'),
  array['Cliente de evidencia 0047', 'Sede con fotos 0047', 'Ana', 'employee', '60',
        (app.today() + 60)::text],
  'v_shift_media: une cliente, sede y autor, y calcula expires_on con el plazo vigente'
);
select is(
  (select array[keep::text, expires_on::text, retention_days::text] from public.v_shift_media where id = 'f4700000-0000-0000-0000-000000000a03'),
  array['true', null, '30'], 'v_shift_media: lo conservado no vence (y el video usa el plazo de videos)'
);
select is(
  (select array[has_file::text, expires_on::text] from public.v_shift_media where id = 'f4700000-0000-0000-0000-000000000a04'),
  array['false', null], 'v_shift_media: lo vencido queda como constancia, sin archivo'
);
select is(
  (select uploader_role from public.v_shift_media where id = (current_setting('t.r3')::jsonb -> 'media' ->> 'id')::uuid) is null,
  true, 'v_shift_media: la subida pendiente del supervisor todavía no figura'
);

select tests_0047a.as_user('test-db047-empa@example.com');
select is(
  (select count(*) from public.v_shift_media where uploaded_by <> 'f4700000-0000-0000-0000-000000000091'),
  0::bigint, 'v_shift_media: el empleado solo ve lo suyo'
);

select * from finish();

rollback;
