-- pgTAP de la migración 0047_p21_1_evidencia.sql (P21.1, módulo H · evidencia fotográfica), parte 2:
-- herencia y edición de requires_photos (servicios, generate_shifts, create_shift, create_shift_series,
-- update_shift_details), plazos de vencimiento, barrido nocturno (RPC internas), storage_usage,
-- delete_service con evidencia y las vistas del celular (v_my_day, v_my_supervisions).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4710000-...'. Las fechas de generación son de mayo y junio de 2199 (fuera del uso
-- real); el turno del celular abarca todo el día de hoy (00:00 a 23:59) para no fallar cerca de la
-- medianoche de Argentina.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0047b;
grant usage on schema tests_0047b to authenticated, anon;

create or replace function tests_0047b.as_user(p_email text)
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
    raise exception 'tests_0047b.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0047b.as_user(text) to authenticated, anon;

create or replace function tests_0047b.hint_of(p_sql text)
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

grant execute on function tests_0047b.hint_of(text) to authenticated, anon;

select plan(47);

-- Estructura -----------------------------------------------------------------------------------

select col_default_is('public', 'services', 'requires_photos', 'false', 'services.requires_photos arranca en false');
select col_not_null('public', 'shifts', 'requires_photos', 'shifts.requires_photos es obligatorio');
select col_default_is('public', 'company_settings', 'photo_retention_days', '60', 'plazo de fotos: 60 días');
select col_default_is('public', 'company_settings', 'video_retention_days', '30', 'plazo de videos: 30 días');
select is(
  (select photo_retention_days::text || '/' || video_retention_days::text from public.company_settings where id = 1) is not null,
  true, 'company_settings tiene la fila única con los plazos'
);
select throws_ok(
  $$update public.company_settings set photo_retention_days = 6 where id = 1$$,
  '23514', null, 'el plazo de fotos no puede ser menor a 7'
);
select throws_ok(
  $$update public.company_settings set video_retention_days = 366 where id = 1$$,
  '23514', null, 'el plazo de videos no puede ser mayor a 365'
);
select ok(
  not has_function_privilege('authenticated', 'public.evidence_cleanup_candidates(integer)', 'execute')
    and not has_function_privilege('anon', 'public.evidence_cleanup_candidates(integer)', 'execute')
    and has_function_privilege('service_role', 'public.evidence_cleanup_candidates(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.evidence_cleanup_mark(uuid[])', 'execute')
    and has_function_privilege('service_role', 'public.evidence_cleanup_mark(uuid[])', 'execute'),
  'grants: el barrido nocturno solo lo ejecuta service_role'
);
select ok(
  has_function_privilege('authenticated', 'public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.update_shift_details(uuid, smallint, text, boolean, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.set_media_retention(integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid, boolean)', 'execute'),
  'grants: las RPC de turnos con requires_photos para authenticated; el helper interno no'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f4710000-0000-0000-0000-000000000001', 'Cliente de evidencia 0047 b', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('f4710000-0000-0000-0000-000000000011', 'f4710000-0000-0000-0000-000000000001', 'Sede 0047 b', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4710000-0000-0000-0000-000000000081', 'test-db0472-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Evidencia')),
  ('f4710000-0000-0000-0000-000000000082', 'test-db0472-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Evidencia')),
  ('f4710000-0000-0000-0000-000000000084', 'test-db0472-sup@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f4710000-0000-0000-0000-000000000091', 'test-db0472-empa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Asignada')),
  ('f4710000-0000-0000-0000-000000000092', 'test-db0472-empb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Otro'));

insert into public.user_roles (profile_id, role) values
  ('f4710000-0000-0000-0000-000000000081', 'owner'),
  ('f4710000-0000-0000-0000-000000000082', 'admin'),
  ('f4710000-0000-0000-0000-000000000084', 'supervisor'),
  ('f4710000-0000-0000-0000-000000000091', 'employee'),
  ('f4710000-0000-0000-0000-000000000092', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f4710000-0000-0000-0000-000000000084', '94710084', 'active'),
  ('f4710000-0000-0000-0000-000000000091', '94710091', 'active'),
  ('f4710000-0000-0000-0000-000000000092', '94710092', 'active');

-- Dos servicios: uno que pide fotos y otro que no.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, requires_photos) values
  ('f4710000-0000-0000-0000-000000000021', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', 'Servicio que pide fotos', array[1]::smallint[], '08:00', '12:00', '2199-01-01', true),
  ('f4710000-0000-0000-0000-000000000022', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', 'Servicio sin fotos', array[1]::smallint[], '13:00', '17:00', '2199-01-01', false);

-- Herencia al generar (H-07) ---------------------------------------------------------------------

select tests_0047b.as_user('test-db0472-owner@example.com');
select public.generate_shifts(2199, 5);
select is(
  (select array[count(*)::text, count(*) filter (where requires_photos)::text] from public.shifts where service_id = 'f4710000-0000-0000-0000-000000000021'),
  array['4', '4'], 'generate_shifts: los turnos del servicio que pide fotos nacen con requires_photos'
);
select is(
  (select count(*) filter (where requires_photos) from public.shifts where service_id = 'f4710000-0000-0000-0000-000000000022'),
  0::bigint, 'generate_shifts: los del servicio sin fotos, no'
);

-- create_shift: hereda, se puede pisar y un turno suelto no pide fotos -------------------------------

select tests_0047b.as_user('test-db0472-admin@example.com');
select is(
  (public.create_shift('f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '2199-05-07', '08:00', '12:00', 1::smallint, 'f4710000-0000-0000-0000-000000000021') -> 'shift' ->> 'requires_photos'),
  'true', 'create_shift con servicio: hereda requires_photos'
);
select is(
  (public.create_shift('f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '2199-05-08', '08:00', '12:00', 1::smallint, 'f4710000-0000-0000-0000-000000000021', p_requires_photos => false) -> 'shift' ->> 'requires_photos'),
  'false', 'create_shift: p_requires_photos false pisa la herencia'
);
select is(
  (public.create_shift('f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '2199-05-09', '08:00', '12:00', 1::smallint) -> 'shift' ->> 'requires_photos'),
  'false', 'create_shift suelto: sin fotos por defecto'
);
select set_config('t.s1', (public.create_shift('f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '2199-05-10', '08:00', '12:00', 1::smallint, p_requires_photos => true) -> 'shift' ->> 'id'), true);
select is(
  (select requires_photos from public.shifts where id = current_setting('t.s1')::uuid),
  true, 'create_shift suelto: se puede marcar que pide fotos'
);
select set_config('t.series', public.create_shift_series(
  'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint,
  '2199-06-01', '2199-06-30', array[2]::smallint[], null, false, null, false, true, null, true)::text, true);
select is(
  (select count(*) from public.shifts s where s.requires_photos and s.id in (
     select (x ->> 'shift_id')::uuid from jsonb_array_elements(current_setting('t.series')::jsonb -> 'created') as x
   )),
  4::bigint, 'create_shift_series con p_requires_photos: todos los turnos de la repetición lo piden'
);

-- update_shift_details ---------------------------------------------------------------------------

select is(
  (public.update_shift_details(current_setting('t.s1')::uuid, 1::smallint, null, null, false)).requires_photos,
  false, 'update_shift_details: p_requires_photos false lo destilda'
);
select is(
  (public.update_shift_details(current_setting('t.s1')::uuid, 1::smallint, null, null, null)).requires_photos,
  false, 'update_shift_details: null no lo cambia'
);
select is(
  (public.update_shift_details(current_setting('t.s1')::uuid, 1::smallint, null, null, true)).requires_photos,
  true, 'update_shift_details: p_requires_photos true lo tilda'
);

-- set_media_retention (H-17) ---------------------------------------------------------------------

select is(
  tests_0047b.hint_of($$select public.set_media_retention(6, null)$$),
  'RETENTION_OUT_OF_RANGE', 'plazo de fotos menor a 7'
);
select is(
  tests_0047b.hint_of($$select public.set_media_retention(null, 366)$$),
  'RETENTION_OUT_OF_RANGE', 'plazo de videos mayor a 365'
);
select is(
  (select array[photo_retention_days::text, video_retention_days::text] from public.set_media_retention(90, null)),
  array['90', '30'], 'el administrador cambia solo el plazo de fotos'
);
select is(
  (select array[photo_retention_days::text, video_retention_days::text] from public.set_media_retention(60, 45)),
  array['60', '45'], 'y los dos a la vez'
);
select tests_0047b.as_user('test-db0472-empa@example.com');
select is(
  tests_0047b.hint_of($$select public.set_media_retention(60, 30)$$),
  'FORBIDDEN', 'un empleado no cambia los plazos'
);
select tests_0047b.as_user('test-db0472-sup@example.com');
select is(
  tests_0047b.hint_of($$select public.set_media_retention(60, 30)$$),
  'FORBIDDEN', 'un supervisor no cambia los plazos'
);
select tests_0047b.as_user('test-db0472-owner@example.com');
select is(
  (select video_retention_days from public.set_media_retention(null, 30)),
  30::smallint, 'el dueño también los cambia'
);

-- Barrido nocturno -------------------------------------------------------------------------------

set local role postgres;

insert into public.assignments (id, shift_id, employee_id)
select 'f4710000-0000-0000-0000-000000000201', s.id, 'f4710000-0000-0000-0000-000000000091'
from public.shifts s where s.id = current_setting('t.s1')::uuid;

insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at, created_at, keep, removed_at, expired_at)
select v.id, current_setting('t.s1')::uuid, 'f4710000-0000-0000-0000-000000000201', 'f4710000-0000-0000-0000-000000000091', v.kind,
       current_setting('t.s1') || '/' || v.id::text || '.jpg', current_setting('t.s1') || '/' || v.id::text || '_thumb.jpg',
       1000, v.confirmed, v.created, v.keep, v.removed, v.expired
from (values
  ('f4710000-0000-0000-0000-0000000000b1'::uuid, 'photo'::public.media_kind, now() - interval '61 days', now() - interval '61 days', false, null::timestamptz, null::timestamptz),
  ('f4710000-0000-0000-0000-0000000000b2'::uuid, 'photo', now() - interval '59 days', now() - interval '59 days', false, null, null),
  ('f4710000-0000-0000-0000-0000000000b3'::uuid, 'video', now() - interval '31 days', now() - interval '31 days', false, null, null),
  ('f4710000-0000-0000-0000-0000000000b4'::uuid, 'video', now() - interval '29 days', now() - interval '29 days', false, null, null),
  ('f4710000-0000-0000-0000-0000000000b5'::uuid, 'photo', now() - interval '100 days', now() - interval '100 days', true, null, null),
  ('f4710000-0000-0000-0000-0000000000b6'::uuid, 'photo', null, now() - interval '25 hours', false, null, null),
  ('f4710000-0000-0000-0000-0000000000b7'::uuid, 'photo', null, now() - interval '1 hour', false, null, null),
  ('f4710000-0000-0000-0000-0000000000b8'::uuid, 'photo', now() - interval '2 days', now() - interval '2 days', false, now() - interval '1 day', null),
  ('f4710000-0000-0000-0000-0000000000b9'::uuid, 'photo', now() - interval '200 days', now() - interval '200 days', false, null, now() - interval '100 days')
) as v(id, kind, confirmed, created, keep, removed, expired);

select is(
  (select jsonb_object_agg(right(media_id::text, 2), reason) from public.evidence_cleanup_candidates(10000) where media_id::text like 'f4710000-%'),
  '{"b1": "expired", "b3": "expired", "b6": "pending_stale", "b8": "removed"}'::jsonb,
  'candidatos: foto de 61 días, video de 31, pendiente de 25 h y quitada; no la de 59 días, ni el video de 29, ni lo conservado, ni la pendiente reciente, ni lo ya borrado'
);

select public.set_media_retention(7, 7);
select is(
  (select jsonb_object_agg(right(media_id::text, 2), reason) from public.evidence_cleanup_candidates(10000) where media_id::text like 'f4710000-%'),
  '{"b1": "expired", "b2": "expired", "b3": "expired", "b4": "expired", "b6": "pending_stale", "b8": "removed"}'::jsonb,
  'un plazo más corto se aplica también a lo guardado antes del cambio (H-17); lo conservado sigue sin vencer'
);
select public.set_media_retention(365, 365);
select is(
  (select jsonb_object_agg(right(media_id::text, 2), reason) from public.evidence_cleanup_candidates(10000) where media_id::text like 'f4710000-%'),
  '{"b6": "pending_stale", "b8": "removed"}'::jsonb,
  'con plazos de 365 días solo quedan la pendiente vieja y la quitada'
);
select public.set_media_retention(60, 30);

select is(
  public.evidence_cleanup_mark(array[
    'f4710000-0000-0000-0000-0000000000b1', 'f4710000-0000-0000-0000-0000000000b6', 'f4710000-0000-0000-0000-0000000000b8'
  ]::uuid[]),
  3, 'mark: marca las tres filas cuyo archivo se borró'
);
select is(
  (select array[(expired_at is not null)::text, (removed_at is not null)::text, (removed_by is null)::text]
   from public.shift_media where id = 'f4710000-0000-0000-0000-0000000000b6'),
  array['true', 'true', 'true'], 'mark: la pendiente abandonada queda quitada por el sistema (removed_by null)'
);
select is(
  (select removed_at is null from public.shift_media where id = 'f4710000-0000-0000-0000-0000000000b1'),
  true, 'mark: la vencida no figura como quitada, solo con expired_at'
);
select is(
  public.evidence_cleanup_mark(array['f4710000-0000-0000-0000-0000000000b1']::uuid[]),
  0, 'mark: volver a marcar no hace nada'
);
select is(
  (select jsonb_object_agg(right(media_id::text, 2), reason) from public.evidence_cleanup_candidates(10000) where media_id::text like 'f4710000-%'),
  '{"b3": "expired"}'::jsonb, 'después de marcar, esas filas ya no son candidatas'
);
select is(
  (select count(*) from public.evidence_cleanup_candidates(1)),
  1::bigint, 'el límite de candidatos se respeta'
);

select tests_0047b.as_user('test-db0472-admin@example.com');
select is(
  tests_0047b.hint_of($$select * from public.evidence_cleanup_candidates(10)$$),
  'SQLSTATE 42501', 'un administrador no puede ejecutar el barrido (solo service_role)'
);

-- storage_usage ----------------------------------------------------------------------------------

set local role postgres;
insert into storage.objects (bucket_id, name, metadata) values
  ('evidence', 'f4710000-prueba/uso.jpg', '{"size": 123456}');

select tests_0047b.as_user('test-db0472-admin@example.com');
select is(
  (public.storage_usage() ->> 'limit_bytes')::bigint,
  1073741824::bigint, 'storage_usage: el tope es 1 GB'
);
select cmp_ok(
  (public.storage_usage() ->> 'total_bytes')::bigint, '>=', 123456::bigint,
  'storage_usage: suma lo guardado'
);
select ok(
  (public.storage_usage() -> 'buckets') @> '[{"bucket": "evidence"}]'::jsonb
    and public.storage_usage() ->> 'level' in ('ok', 'warning', 'critical')
    and (public.storage_usage() ->> 'percent')::numeric >= 0,
  'storage_usage: detalle por bucket, porcentaje y nivel'
);
select tests_0047b.as_user('test-db0472-owner@example.com');
select cmp_ok((public.storage_usage() ->> 'total_bytes')::bigint, '>=', 123456::bigint, 'storage_usage: el dueño también');
select tests_0047b.as_user('test-db0472-empa@example.com');
select is(tests_0047b.hint_of($$select public.storage_usage()$$), 'FORBIDDEN', 'storage_usage: un empleado no');
select tests_0047b.as_user('test-db0472-sup@example.com');
select is(tests_0047b.hint_of($$select public.storage_usage()$$), 'FORBIDDEN', 'storage_usage: un supervisor no');

-- delete_service con evidencia -------------------------------------------------------------------

set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from) values
  ('f4710000-0000-0000-0000-000000000023', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', 'Servicio con evidencia', array[1]::smallint[], '08:00', '12:00', '2199-01-01'),
  ('f4710000-0000-0000-0000-000000000024', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', 'Servicio sin nada', array[1]::smallint[], '08:00', '12:00', '2199-01-01');
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff) values
  ('f4710000-0000-0000-0000-000000000111', 'f4710000-0000-0000-0000-000000000023', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', '2199-07-05', '08:00', '12:00', 1);
insert into public.assignments (id, shift_id, employee_id) values
  ('f4710000-0000-0000-0000-000000000211', 'f4710000-0000-0000-0000-000000000111', 'f4710000-0000-0000-0000-000000000092');
insert into public.shift_media (id, shift_id, assignment_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at) values
  ('f4710000-0000-0000-0000-0000000000c1', 'f4710000-0000-0000-0000-000000000111', 'f4710000-0000-0000-0000-000000000211', 'f4710000-0000-0000-0000-000000000092', 'photo',
   'f4710000-0000-0000-0000-000000000111/f4710000-0000-0000-0000-0000000000c1.jpg',
   'f4710000-0000-0000-0000-000000000111/f4710000-0000-0000-0000-0000000000c1_thumb.jpg', 1000, now());

select tests_0047b.as_user('test-db0472-admin@example.com');
select is(
  (select b ->> 'reasons' from jsonb_array_elements(public.service_delete_preview('f4710000-0000-0000-0000-000000000023') -> 'blocking_shifts') as b),
  '["SHIFT_MEDIA"]', 'service_delete_preview: la evidencia bloquea el borrado'
);
select is(
  tests_0047b.hint_of($$select public.delete_service('f4710000-0000-0000-0000-000000000023')$$),
  'SERVICE_HAS_MEDIA', 'delete_service: un servicio con fotos o videos no se elimina'
);
select is(
  (public.delete_service('f4710000-0000-0000-0000-000000000024') ->> 'service_id'),
  'f4710000-0000-0000-0000-000000000024', 'delete_service: uno sin evidencia se sigue eliminando'
);

-- Vistas del celular -----------------------------------------------------------------------------

set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, requires_photos) values
  ('f4710000-0000-0000-0000-000000000121', 'f4710000-0000-0000-0000-000000000001', 'f4710000-0000-0000-0000-000000000011', app.today(), '00:00', '23:59', 1, 'scheduled', true);
insert into public.assignments (id, shift_id, employee_id) values
  ('f4710000-0000-0000-0000-000000000221', 'f4710000-0000-0000-0000-000000000121', 'f4710000-0000-0000-0000-000000000091');
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('f4710000-0000-0000-0000-000000000321', 'f4710000-0000-0000-0000-000000000121', 'f4710000-0000-0000-0000-000000000084', 'assigned');

insert into public.shift_media (id, shift_id, assignment_id, supervision_id, uploaded_by, kind, storage_path, thumb_path, size_bytes, confirmed_at, removed_at)
select v.id, 'f4710000-0000-0000-0000-000000000121', v.asg, v.sup, v.uploader, v.kind,
       'f4710000-0000-0000-0000-000000000121/' || v.id::text || '.jpg', 'f4710000-0000-0000-0000-000000000121/' || v.id::text || '_thumb.jpg',
       1000, v.confirmed, v.removed
from (values
  ('f4710000-0000-0000-0000-0000000000d1'::uuid, 'photo'::public.media_kind, 'f4710000-0000-0000-0000-000000000221'::uuid, null::uuid, 'f4710000-0000-0000-0000-000000000091'::uuid, now(), null::timestamptz),
  ('f4710000-0000-0000-0000-0000000000d2'::uuid, 'video', 'f4710000-0000-0000-0000-000000000221', null, 'f4710000-0000-0000-0000-000000000091', now(), null),
  ('f4710000-0000-0000-0000-0000000000d3'::uuid, 'photo', 'f4710000-0000-0000-0000-000000000221', null, 'f4710000-0000-0000-0000-000000000091', now(), now()),
  ('f4710000-0000-0000-0000-0000000000d4'::uuid, 'photo', 'f4710000-0000-0000-0000-000000000221', null, 'f4710000-0000-0000-0000-000000000091', null, null),
  ('f4710000-0000-0000-0000-0000000000d5'::uuid, 'photo', null, 'f4710000-0000-0000-0000-000000000321', 'f4710000-0000-0000-0000-000000000084', now(), null)
) as v(id, kind, asg, sup, uploader, confirmed, removed);

select tests_0047b.as_user('test-db0472-empa@example.com');
select is(
  (select array[requires_photos::text, my_photos_count::text, my_videos_count::text, photos_not_allowed::text]
   from public.v_my_day where shift_id = 'f4710000-0000-0000-0000-000000000121'),
  array['true', '1', '1', 'false'],
  'v_my_day: pide fotos, 1 foto y 1 video propios (las quitadas y pendientes no cuentan) y la sede permite fotos'
);
select tests_0047b.as_user('test-db0472-sup@example.com');
select is(
  (select array[requires_photos::text, my_photos_count::text, my_videos_count::text, site_photos_not_allowed::text]
   from public.v_my_supervisions where shift_id = 'f4710000-0000-0000-0000-000000000121'),
  array['true', '1', '0', 'false'],
  'v_my_supervisions: cuenta solo lo que subió el supervisor, no lo del empleado'
);

select * from finish();

rollback;
