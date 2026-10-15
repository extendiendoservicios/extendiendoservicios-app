-- pgTAP de las migraciones 0052_p22_1_geolocalizacion.sql y 0053_p22_1_correcciones_eventos.sql
-- (P22.1, módulo B1, B-02, B-09, B-22, B-28, B-40 y B-41): attendance_corrections con su RLS,
-- correct_attendance_time, override_geo_validation y set_geofence_radius (permisos por rol y todos
-- los rechazos), el rastro en security_events, location_consent_updated_at, v_presence_today
-- (solo dueño y administradores) y la validación agregada a las vistas de asistencia, del
-- empleado y del supervisor.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e5210000-...'.
--
-- Fechas: los turnos son de `app.today()` y todos los instantes se calculan con `tests.t(p)`, que
-- devuelve la fracción `p` del tramo entre las 0:00 de hoy (Argentina) y el `now()` de la
-- transacción. Así ningún instante cae en el futuro ni antes de la medianoche del día del turno,
-- sin importar a qué hora corra el archivo.

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

create or replace function tests.t(p numeric)
returns timestamptz
language sql
stable
as $$
  select app.local_ts(app.today(), '00:00'::time)
         + (now() - app.local_ts(app.today(), '00:00'::time)) * p;
$$;

grant execute on function tests.t(numeric) to authenticated, anon;

select plan(96);

-- Estructura --------------------------------------------------------------------------------------

select has_table('public', 'attendance_corrections', 'existe attendance_corrections');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.attendance_corrections'::regclass),
  'attendance_corrections tiene RLS habilitada'
);
select is(
  (select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where schemaname = 'public' and tablename = 'attendance_corrections'),
  array['attendance_corrections_select_admin:SELECT'],
  'attendance_corrections tiene solo la política de lectura de administración (sin insert, update ni delete)'
);
select is(
  (select array_agg(privilege_type::text order by privilege_type) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'attendance_corrections' and grantee = 'authenticated'),
  array['SELECT'],
  'authenticated solo tiene SELECT sobre attendance_corrections'
);
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'attendance_corrections' and grantee = 'anon'),
  0,
  'anon no tiene ningún permiso sobre attendance_corrections'
);
select is(
  (select reloptions::text from pg_class where oid = 'public.v_presence_today'::regclass),
  '{security_invoker=true}',
  'v_presence_today es security_invoker'
);
select ok(
  has_table_privilege('authenticated', 'public.v_presence_today', 'select')
  and not has_table_privilege('anon', 'public.v_presence_today', 'select'),
  'authenticated puede leer v_presence_today y anon no'
);
select has_function('public', 'correct_attendance_time', array['uuid', 'timestamptz', 'text'], 'existe correct_attendance_time');
select has_function('public', 'override_geo_validation', array['text', 'uuid', 'text'], 'existe override_geo_validation');
select has_function('public', 'set_geofence_radius', array['integer'], 'existe set_geofence_radius');
select has_column('public', 'v_my_day', 'site_geofence_radius_m', 'v_my_day.site_geofence_radius_m');
select has_column('public', 'v_my_day', 'check_in_geo_status', 'v_my_day.check_in_geo_status');
select has_column('public', 'v_my_history', 'check_out_time_corrected', 'v_my_history.check_out_time_corrected');
select has_column('public', 'v_assignments_board', 'has_outside_geo', 'v_assignments_board.has_outside_geo');
select has_column('public', 'v_my_supervisions', 'check_in_geo_status', 'v_my_supervisions.check_in_geo_status');
select has_column('public', 'v_supervisions_admin', 'check_out_geo_overridden', 'v_supervisions_admin.check_out_geo_overridden');

-- Fixtures ----------------------------------------------------------------------------------------

-- Radio y tope generales conocidos (la fila de App_dev puede haberse editado a mano).
update public.company_settings set geofence_radius_m = 150, geofence_max_accuracy_m = 150 where id = 1;

insert into public.clients (id, legal_name, status) values
  ('e5210000-0000-0000-0000-000000000001', 'Cliente de correcciones', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, geofence_radius_m, status) values
  ('e5210000-0000-0000-0000-000000000011', 'e5210000-0000-0000-0000-000000000001', 'Sede C1', 'Dirección 1', -34.603700, -58.381600, null, 'active'),
  ('e5210000-0000-0000-0000-000000000012', 'e5210000-0000-0000-0000-000000000001', 'Sede C2 radio propio', 'Dirección 2', -34.593700, -58.381600, 300, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5210000-0000-0000-0000-000000000081', 'test-db052c-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Correcciones')),
  ('e5210000-0000-0000-0000-000000000082', 'test-db052c-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Con capacidad')),
  ('e5210000-0000-0000-0000-000000000083', 'test-db052c-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Sin capacidad')),
  ('e5210000-0000-0000-0000-000000000084', 'test-db052c-super@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Correcciones')),
  ('e5210000-0000-0000-0000-000000000091', 'test-db052c-emp-a@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'A')),
  ('e5210000-0000-0000-0000-000000000092', 'test-db052c-emp-b@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'B')),
  ('e5210000-0000-0000-0000-000000000093', 'test-db052c-emp-c@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'C')),
  ('e5210000-0000-0000-0000-000000000094', 'test-db052c-emp-d@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'D')),
  ('e5210000-0000-0000-0000-000000000095', 'test-db052c-emp-e@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'E'));

insert into public.user_roles (profile_id, role) values
  ('e5210000-0000-0000-0000-000000000081', 'owner'),
  ('e5210000-0000-0000-0000-000000000082', 'admin'),
  ('e5210000-0000-0000-0000-000000000083', 'admin'),
  ('e5210000-0000-0000-0000-000000000084', 'supervisor'),
  ('e5210000-0000-0000-0000-000000000091', 'employee'),
  ('e5210000-0000-0000-0000-000000000092', 'employee'),
  ('e5210000-0000-0000-0000-000000000093', 'employee'),
  ('e5210000-0000-0000-0000-000000000094', 'employee'),
  ('e5210000-0000-0000-0000-000000000095', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e5210000-0000-0000-0000-000000000082', 'manage_attendance', true),
  ('e5210000-0000-0000-0000-000000000083', 'manage_attendance', false);

insert into public.employees (profile_id, dni) values
  ('e5210000-0000-0000-0000-000000000084', '95210084'),
  ('e5210000-0000-0000-0000-000000000091', '95210091'),
  ('e5210000-0000-0000-0000-000000000092', '95210092'),
  ('e5210000-0000-0000-0000-000000000093', '95210093'),
  ('e5210000-0000-0000-0000-000000000094', '95210094'),
  ('e5210000-0000-0000-0000-000000000095', '95210095');

-- Turnos de hoy: 201 (A, sede C1), 202 (B, C1), 203 (C, C2), 204 (D, C1, sin fichajes), 205 (supervisión, C1).
-- Turno 206: de ayer (E, C1), con un inicio anterior a la medianoche de hoy.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select
  s.id::uuid, 'e5210000-0000-0000-0000-000000000001', s.site_id::uuid, app.today() + s.dia, '08:00', '16:00', 1, 'scheduled'
from (values
  ('e5210000-0000-0000-0000-000000000201', 'e5210000-0000-0000-0000-000000000011', 0),
  ('e5210000-0000-0000-0000-000000000202', 'e5210000-0000-0000-0000-000000000011', 0),
  ('e5210000-0000-0000-0000-000000000203', 'e5210000-0000-0000-0000-000000000012', 0),
  ('e5210000-0000-0000-0000-000000000204', 'e5210000-0000-0000-0000-000000000011', 0),
  ('e5210000-0000-0000-0000-000000000205', 'e5210000-0000-0000-0000-000000000011', 0),
  ('e5210000-0000-0000-0000-000000000206', 'e5210000-0000-0000-0000-000000000011', -1)
) as s (id, site_id, dia);

insert into public.assignments (id, shift_id, employee_id) values
  ('e5210000-0000-0000-0000-000000000301', 'e5210000-0000-0000-0000-000000000201', 'e5210000-0000-0000-0000-000000000091'),
  ('e5210000-0000-0000-0000-000000000302', 'e5210000-0000-0000-0000-000000000202', 'e5210000-0000-0000-0000-000000000092'),
  ('e5210000-0000-0000-0000-000000000303', 'e5210000-0000-0000-0000-000000000203', 'e5210000-0000-0000-0000-000000000093'),
  ('e5210000-0000-0000-0000-000000000304', 'e5210000-0000-0000-0000-000000000204', 'e5210000-0000-0000-0000-000000000094'),
  ('e5210000-0000-0000-0000-000000000305', 'e5210000-0000-0000-0000-000000000206', 'e5210000-0000-0000-0000-000000000095');

update public.assignments set status = 'finished' where id = 'e5210000-0000-0000-0000-000000000301';
update public.assignments set status = 'present' where id in (
  'e5210000-0000-0000-0000-000000000302', 'e5210000-0000-0000-0000-000000000303', 'e5210000-0000-0000-0000-000000000305'
);

-- Fichajes cargados directo (los valores de validación son los que se quieren probar):
--   A: inicio valid (10 m) a las 0.25 y fin outside (500 m) a las 0.75 del tramo.
--   B: inicio outside (1112 m), sin fin.   C: inicio sin ubicación, sin fin (sede C2).
--   E: inicio de ayer a las 23:00 (antes de la medianoche de hoy), sin fin.
insert into public.attendance_records (
  id, assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
  geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m
) values
  ('e5210000-0000-0000-0000-000000000501', 'e5210000-0000-0000-0000-000000000301', 'check_in', tests.t(0.25), -34.603800, -58.381600, 10, 'employee_app', 'e5210000-0000-0000-0000-000000000091', 'valid', null, 10, 150),
  ('e5210000-0000-0000-0000-000000000502', 'e5210000-0000-0000-0000-000000000301', 'check_out', tests.t(0.75), -34.599200, -58.381600, 10, 'employee_app', 'e5210000-0000-0000-0000-000000000091', 'outside', null, 500, 150),
  ('e5210000-0000-0000-0000-000000000503', 'e5210000-0000-0000-0000-000000000302', 'check_in', tests.t(0.25), -34.593700, -58.381600, 20, 'employee_app', 'e5210000-0000-0000-0000-000000000092', 'outside', null, 1112, 150),
  ('e5210000-0000-0000-0000-000000000504', 'e5210000-0000-0000-0000-000000000303', 'check_in', tests.t(0.25), null, null, null, 'employee_app', 'e5210000-0000-0000-0000-000000000093', 'unvalidated', 'no_location', null, 300),
  ('e5210000-0000-0000-0000-000000000505', 'e5210000-0000-0000-0000-000000000305', 'check_in', app.local_ts(app.today(), '00:00'::time) - interval '1 hour', -34.603700, -58.381600, 10, 'employee_app', 'e5210000-0000-0000-0000-000000000095', 'valid', null, 0, 150);

-- Supervisión en curso con inicio fuera de zona.
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e5210000-0000-0000-0000-000000000401', 'e5210000-0000-0000-0000-000000000205', 'e5210000-0000-0000-0000-000000000084', 'in_progress');
insert into public.supervision_attendance (
  id, supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
  geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m
) values
  ('e5210000-0000-0000-0000-000000000601', 'e5210000-0000-0000-0000-000000000401', 'check_in', tests.t(0.3), -34.593700, -58.381600, 10, 'outside', null, 1112, 150);

-- correct_attendance_time (B-28) --------------------------------------------------------------------

select tests.as_user('test-db052c-owner@example.com');

select is(
  (select recorded_at from public.correct_attendance_time('e5210000-0000-0000-0000-000000000501', tests.t(0.5), 'Se olvidó de fichar al llegar')),
  tests.t(0.5),
  'correct_attendance_time: el dueño cambia la hora del inicio de A'
);

select results_eq(
  $$select (time_corrected_at is not null), geo_status::text, site_distance_m from public.attendance_records where id = 'e5210000-0000-0000-0000-000000000501'$$,
  $$values (true, 'valid'::text, 10)$$,
  'el registro queda marcado como corregido y la validación no se toca'
);

select results_eq(
  $$select kind::text, old_recorded_at = tests.t(0.25), new_recorded_at = tests.t(0.5), reason, corrected_by
    from public.attendance_corrections where attendance_record_id = 'e5210000-0000-0000-0000-000000000501'$$,
  $$values ('time'::text, true, true, 'Se olvidó de fichar al llegar'::text, 'e5210000-0000-0000-0000-000000000081'::uuid)$$,
  'attendance_corrections guarda el valor anterior, el nuevo, el motivo y quién corrigió'
);

set local role postgres;
select is(
  (select count(*)::int from public.security_events
    where event_type = 'attendance_time_corrected'
      and actor_id = 'e5210000-0000-0000-0000-000000000081'
      and target_id = 'e5210000-0000-0000-0000-000000000091'
      and details ->> 'record_id' = 'e5210000-0000-0000-0000-000000000501'),
  1,
  'la corrección de hora queda en security_events (actor, empleado afectado y registro)'
);

select tests.as_user('test-db052c-owner@example.com');

select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000501', app.local_ts(app.today(), '00:00'::time) - interval '1 minute', 'Antes del día')$$,
  'P0001',
  'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
  'correct_attendance_time: antes de las 0:00 del día del turno = AT_OUT_OF_RANGE'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000501', now() + interval '1 hour', 'Futura')$$,
  'P0001',
  'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
  'correct_attendance_time: una hora futura = AT_OUT_OF_RANGE'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000501', tests.t(0.5), 'Igual')$$,
  'P0001',
  'La hora nueva es igual a la actual.',
  'correct_attendance_time: la misma hora = SAME_TIME'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000501', tests.t(0.9), 'Después del fin')$$,
  'P0001',
  'La hora de fin tiene que ser posterior a la de inicio.',
  'correct_attendance_time: un inicio posterior al fin = INVALID_TIME_RANGE'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000502', tests.t(0.4), 'Antes del inicio')$$,
  'P0001',
  'La hora de fin tiene que ser posterior a la de inicio.',
  'correct_attendance_time: un fin anterior al inicio = INVALID_TIME_RANGE'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000503', tests.t(0.2), '   ')$$,
  'P0001',
  'Indicá el motivo.',
  'correct_attendance_time: sin motivo = REASON_REQUIRED'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000503', null, 'Sin hora')$$,
  'P0001',
  'Indicá la hora nueva.',
  'correct_attendance_time: sin hora = TIME_REQUIRED'
);
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-0000000009ff', tests.t(0.2), 'No existe')$$,
  'P0001',
  'No encontramos ese registro.',
  'correct_attendance_time: registro inexistente = RECORD_NOT_FOUND'
);
select is(
  (select count(*)::int from public.attendance_corrections where attendance_record_id in (
    'e5210000-0000-0000-0000-000000000502', 'e5210000-0000-0000-0000-000000000503')),
  0,
  'ninguno de los pedidos rechazados dejó una corrección'
);

-- Un fin también se corrige.
select is(
  (select recorded_at from public.correct_attendance_time('e5210000-0000-0000-0000-000000000502', tests.t(0.8), 'Salió más tarde')),
  tests.t(0.8),
  'correct_attendance_time: el dueño cambia la hora del fin de A'
);

select tests.as_user('test-db052c-admin@example.com');

select is(
  (select recorded_at from public.correct_attendance_time('e5210000-0000-0000-0000-000000000503', tests.t(0.2), 'Llegó antes')),
  tests.t(0.2),
  'correct_attendance_time: un administrador con manage_attendance también corrige'
);

select tests.as_user('test-db052c-admin-sin-cap@example.com');
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000504', tests.t(0.2), 'Sin capacidad')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'correct_attendance_time: administrador sin manage_attendance = FORBIDDEN'
);
select tests.as_user('test-db052c-super@example.com');
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000504', tests.t(0.2), 'Supervisor')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'correct_attendance_time: supervisor = FORBIDDEN'
);
select tests.as_user('test-db052c-emp-c@example.com');
select throws_ok(
  $$select * from public.correct_attendance_time('e5210000-0000-0000-0000-000000000504', tests.t(0.2), 'Empleado')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'correct_attendance_time: empleado = FORBIDDEN'
);

-- override_geo_validation (B-09) --------------------------------------------------------------------

select tests.as_user('test-db052c-admin@example.com');

select results_eq(
  $$select r ->> 'geo_status', (r ->> 'geo_override_at') is not null, r ->> 'geo_override_reason', r ->> 'geo_override_by'
    from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000503', 'Estaba en el subsuelo') r$$,
  $$values ('outside'::text, true, 'Estaba en el subsuelo'::text, 'e5210000-0000-0000-0000-000000000082'::text)$$,
  'override_geo_validation: marca el fichaje fuera de zona de B, el resultado original se conserva'
);

select results_eq(
  $$select kind::text, reason, corrected_by from public.attendance_corrections
    where attendance_record_id = 'e5210000-0000-0000-0000-000000000503' and kind = 'geo'$$,
  $$values ('geo'::text, 'Estaba en el subsuelo'::text, 'e5210000-0000-0000-0000-000000000082'::uuid)$$,
  'la corrección de la validación deja su constancia en attendance_corrections'
);

select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000503', 'Otra vez')$$,
  'P0001', 'Este fichaje ya fue marcado como válido.', 'override_geo_validation: dos veces = GEO_ALREADY_OVERRIDDEN'
);
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000505', 'Ya estaba bien')$$,
  'P0001', 'Este fichaje ya está validado.', 'override_geo_validation: un fichaje valid = GEO_ALREADY_VALID'
);
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000504', '')$$,
  'P0001', 'Indicá el motivo.', 'override_geo_validation: sin motivo = REASON_REQUIRED'
);
select throws_ok(
  $$select * from public.override_geo_validation('otra_cosa', 'e5210000-0000-0000-0000-000000000504', 'Tipo raro')$$,
  'P0001', 'El tipo de registro no es válido.', 'override_geo_validation: tipo desconocido = INVALID_RECORD_TYPE'
);
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-0000000009ff', 'No existe')$$,
  'P0001', 'No encontramos ese registro.', 'override_geo_validation: registro inexistente = RECORD_NOT_FOUND'
);
select throws_ok(
  $$select * from public.override_geo_validation('supervision', 'e5210000-0000-0000-0000-000000000503', 'Tipo equivocado')$$,
  'P0001', 'No encontramos ese registro.', 'override_geo_validation: un id de asistencia no vale como supervisión'
);

select results_eq(
  $$select r ->> 'geo_status', r ->> 'geo_unvalidated_reason', (r ->> 'geo_override_at') is not null
    from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000504', 'Su celular no tenía señal') r$$,
  $$values ('unvalidated'::text, 'no_location'::text, true)$$,
  'override_geo_validation: también marca un fichaje sin validar'
);

select results_eq(
  $$select r ->> 'geo_status', (r ->> 'geo_override_at') is not null
    from public.override_geo_validation('supervision', 'e5210000-0000-0000-0000-000000000601', 'Supervisión en la sede vecina') r$$,
  $$values ('outside'::text, true)$$,
  'override_geo_validation: marca el fichaje de una supervisión'
);

select tests.as_user('test-db052c-admin-sin-cap@example.com');
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000502', 'Sin capacidad')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'override_geo_validation: administrador sin manage_attendance = FORBIDDEN'
);
select tests.as_user('test-db052c-super@example.com');
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000502', 'Supervisor')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'override_geo_validation: supervisor = FORBIDDEN'
);
select tests.as_user('test-db052c-emp-a@example.com');
select throws_ok(
  $$select * from public.override_geo_validation('attendance', 'e5210000-0000-0000-0000-000000000502', 'Empleado')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'override_geo_validation: empleado = FORBIDDEN'
);

set local role postgres;
select is(
  (select count(*)::int from public.security_events
    where event_type = 'geo_validation_overridden'
      and actor_id = 'e5210000-0000-0000-0000-000000000082'
      and details ->> 'record_id' = 'e5210000-0000-0000-0000-000000000503'
      and details ->> 'original_geo_status' = 'outside'),
  1,
  'la corrección de la validación queda en security_events con el estado original'
);
select is(
  (select target_id from public.security_events
    where event_type = 'geo_validation_overridden' and details ->> 'record_id' = 'e5210000-0000-0000-0000-000000000601'),
  'e5210000-0000-0000-0000-000000000084'::uuid,
  'en una supervisión, el evento apunta al supervisor'
);

-- attendance_corrections: quién la lee (B-28, B-40, B-41) -------------------------------------------

select tests.as_user('test-db052c-owner@example.com');
select cmp_ok(
  (select count(*)::int from public.attendance_corrections where attendance_record_id in (
    'e5210000-0000-0000-0000-000000000501', 'e5210000-0000-0000-0000-000000000502',
    'e5210000-0000-0000-0000-000000000503', 'e5210000-0000-0000-0000-000000000504')),
  '=', 5,
  'el dueño lee las cinco correcciones hechas (tres de hora y dos de validación)'
);
select tests.as_user('test-db052c-admin-sin-cap@example.com');
select cmp_ok(
  (select count(*)::int from public.attendance_corrections where attendance_record_id = 'e5210000-0000-0000-0000-000000000501'),
  '=', 1,
  'un administrador lee las correcciones (la lectura no depende de manage_attendance)'
);
select tests.as_user('test-db052c-emp-a@example.com');
select is(
  (select count(*)::int from public.attendance_corrections),
  0,
  'el empleado no ve ninguna corrección, ni las de su propio fichaje'
);
select tests.as_user('test-db052c-super@example.com');
select is(
  (select count(*)::int from public.attendance_corrections),
  0,
  'el supervisor no ve ninguna corrección'
);
select tests.as_user('test-db052c-admin@example.com');
select throws_ok(
  $$delete from public.attendance_corrections$$, '42501', null, 'nadie borra correcciones: ni un administrador'
);
select throws_ok(
  $$update public.attendance_corrections set reason = 'pisado'$$, '42501', null, 'nadie edita correcciones por la API'
);
select throws_ok(
  $$insert into public.attendance_corrections (attendance_record_id, kind, reason, corrected_by)
    values ('e5210000-0000-0000-0000-000000000501', 'geo', 'directo', 'e5210000-0000-0000-0000-000000000082')$$,
  '42501', null, 'nadie inserta correcciones por la API: solo las RPC'
);
set local role anon;
select throws_ok($$select count(*) from public.attendance_corrections$$, '42501', null, 'anon no lee correcciones');

-- Marca de corrección visible para el empleado, sin motivo ------------------------------------------

select tests.as_user('test-db052c-emp-a@example.com');

select results_eq(
  $$select check_in_time_corrected, check_out_time_corrected, check_in_geo_status::text, check_out_geo_status::text,
           check_in_distance_m, check_out_distance_m, site_geofence_radius_m, geofence_max_accuracy_m
    from public.v_my_day where assignment_id = 'e5210000-0000-0000-0000-000000000301'$$,
  $$values (true, true, 'valid'::text, 'outside'::text, 10, 500, 150::smallint, 150::smallint)$$,
  'v_my_day: A ve «corregido» en inicio y fin, su validación y el radio vigente de la sede'
);

select tests.as_user('test-db052c-emp-b@example.com');

select results_eq(
  $$select check_in_geo_status::text, check_in_geo_overridden, check_in_time_corrected, check_out_geo_status::text
    from public.v_my_day where assignment_id = 'e5210000-0000-0000-0000-000000000302'$$,
  $$values ('outside'::text, true, true, null::text)$$,
  'v_my_day: B ve su fichaje fuera de zona con las marcas de validación corregida y de hora corregida'
);

select tests.as_user('test-db052c-emp-c@example.com');

select results_eq(
  $$select site_geofence_radius_m, check_in_geo_status::text, check_in_geo_reason::text
    from public.v_my_day where assignment_id = 'e5210000-0000-0000-0000-000000000303'$$,
  $$values (300::smallint, 'unvalidated'::text, 'no_location'::text)$$,
  'v_my_day: la sede C2 trae su radio propio (300 m)'
);

select is(
  (select count(*)::int from public.v_my_day where assignment_id = 'e5210000-0000-0000-0000-000000000301'),
  0,
  'v_my_day: C no ve la asignación de A'
);

-- Planilla (v_assignments_board) -----------------------------------------------------------------

select tests.as_user('test-db052c-admin@example.com');

select results_eq(
  $$select check_in_geo_status::text, check_out_geo_status::text, check_in_distance_m, check_out_distance_m,
           check_in_geofence_radius_m, check_in_time_corrected, check_out_time_corrected, has_outside_geo
    from public.v_assignments_board where id = 'e5210000-0000-0000-0000-000000000301'$$,
  $$values ('valid'::text, 'outside'::text, 10, 500, 150::smallint, true, true, true)$$,
  'v_assignments_board: A trae su validación, las marcas de corrección y has_outside_geo'
);

select results_eq(
  $$select check_in_geo_status::text, check_in_geo_overridden, has_outside_geo, check_in_record_id
    from public.v_assignments_board where id = 'e5210000-0000-0000-0000-000000000302'$$,
  $$values ('outside'::text, true, false, 'e5210000-0000-0000-0000-000000000503'::uuid)$$,
  'v_assignments_board: B está fuera de zona pero corregido, así que has_outside_geo es falso'
);

select results_eq(
  $$select check_in_geo_status::text, check_in_geo_reason::text, has_outside_geo, check_out_record_id
    from public.v_assignments_board where id = 'e5210000-0000-0000-0000-000000000303'$$,
  $$values ('unvalidated'::text, 'no_location'::text, false, null::uuid)$$,
  'v_assignments_board: C está sin validar por falta de ubicación'
);

select results_eq(
  $$select check_in_geo_status::text, has_outside_geo from public.v_assignments_board where id = 'e5210000-0000-0000-0000-000000000304'$$,
  $$values (null::text, false)$$,
  'v_assignments_board: sin fichajes no hay validación'
);

select results_eq(
  $$select check_in_geo_status::text, check_in_geo_overridden, check_in_outside_reason, check_in_accuracy_m
    from public.v_supervisions_admin where id = 'e5210000-0000-0000-0000-000000000401'$$,
  $$values ('outside'::text, true, null::text, 10.0::numeric)$$,
  'v_supervisions_admin: la supervisión trae la validación y la marca de corrección'
);

select tests.as_user('test-db052c-super@example.com');

select results_eq(
  $$select check_in_geo_status::text, check_in_distance_m, check_in_geo_overridden, site_geofence_radius_m, geofence_max_accuracy_m
    from public.v_my_supervisions where id = 'e5210000-0000-0000-0000-000000000401'$$,
  $$values ('outside'::text, 1112, true, 150::smallint, 150::smallint)$$,
  'v_my_supervisions: el supervisor ve la validación de su supervisión y el radio vigente de la sede'
);

-- set_geofence_radius (B-02) ---------------------------------------------------------------------------

select tests.as_user('test-db052c-owner@example.com');

select is(
  (select geofence_radius_m from public.set_geofence_radius(200)),
  200::smallint,
  'set_geofence_radius: el dueño cambia el radio general'
);

select tests.as_user('test-db052c-admin-sin-cap@example.com');

select is(
  (select geofence_radius_m from public.set_geofence_radius(250)),
  250::smallint,
  'set_geofence_radius: un administrador (aunque no tenga manage_attendance) cambia el radio general'
);

select throws_ok($$select * from public.set_geofence_radius(49)$$, 'P0001', 'El radio tiene que estar entre 50 y 1000 metros.', 'set_geofence_radius: 49 = RADIUS_OUT_OF_RANGE');
select throws_ok($$select * from public.set_geofence_radius(1001)$$, 'P0001', 'El radio tiene que estar entre 50 y 1000 metros.', 'set_geofence_radius: 1001 = RADIUS_OUT_OF_RANGE');
select throws_ok($$select * from public.set_geofence_radius(null)$$, 'P0001', 'El radio tiene que estar entre 50 y 1000 metros.', 'set_geofence_radius: nulo = RADIUS_OUT_OF_RANGE');

select tests.as_user('test-db052c-super@example.com');
select throws_ok($$select * from public.set_geofence_radius(100)$$, 'P0001', 'No tenés permiso para hacer esto.', 'set_geofence_radius: supervisor = FORBIDDEN');
select tests.as_user('test-db052c-emp-a@example.com');
select throws_ok($$select * from public.set_geofence_radius(100)$$, 'P0001', 'No tenés permiso para hacer esto.', 'set_geofence_radius: empleado = FORBIDDEN');
with u as (update public.company_settings set geofence_radius_m = 60 where id = 1 returning 1)
select is(
  (select count(*)::int from u),
  0,
  'el empleado tampoco cambia el radio con un update directo (RLS)'
);

set local role postgres;
select is(
  (select count(*)::int from public.security_events
    where event_type = 'geofence_radius_changed' and details ->> 'scope' = 'company'
      and actor_id in ('e5210000-0000-0000-0000-000000000081', 'e5210000-0000-0000-0000-000000000083')
      and (details ->> 'new') in ('200', '250')),
  2,
  'los dos cambios del radio general quedan en security_events'
);
select is(
  (select geofence_radius_m from public.company_settings where id = 1),
  250::smallint,
  'el radio general quedó en 250 (los rechazados no cambiaron nada)'
);

-- Radio propio de una sede: update directo bajo RLS + rastro ---------------------------------------------

select tests.as_user('test-db052c-admin@example.com');
select lives_ok(
  $$update public.sites set geofence_radius_m = 80 where id = 'e5210000-0000-0000-0000-000000000011'$$,
  'un administrador fija el radio propio de una sede'
);
select tests.as_user('test-db052c-super@example.com');
with u as (update public.sites set geofence_radius_m = 90 where id = 'e5210000-0000-0000-0000-000000000011' returning 1)
select is(
  (select count(*)::int from u),
  0,
  'el supervisor no cambia el radio de una sede (RLS)'
);
set local role postgres;
select is(
  (select count(*)::int from public.security_events
    where event_type = 'geofence_radius_changed' and details ->> 'scope' = 'site'
      and details ->> 'site_id' = 'e5210000-0000-0000-0000-000000000011'
      and details ->> 'old' is null and details ->> 'new' = '80'
      and actor_id = 'e5210000-0000-0000-0000-000000000082'),
  1,
  'el cambio del radio de la sede queda en security_events (actor, sede, valor anterior y nuevo)'
);

-- Texto de consentimiento (B-22) -------------------------------------------------------------------------

set local role postgres;
update public.company_settings set location_consent_updated_at = null where id = 1;

select tests.as_user('test-db052c-admin@example.com');
select throws_ok(
  $$update public.company_settings set location_consent_text = 'Texto del administrador' where id = 1$$,
  'P0001',
  'Solo el dueño puede cambiar el nombre, el teléfono y el consentimiento. Podés cambiar el logo.',
  'el administrador sigue sin poder cambiar el texto de consentimiento'
);

select tests.as_user('test-db052c-owner@example.com');
select lives_ok(
  $$update public.company_settings set support_phone = support_phone where id = 1$$,
  'el dueño guarda la configuración sin tocar el consentimiento'
);
select is(
  (select location_consent_updated_at from public.company_settings where id = 1),
  null,
  'sin cambio en el texto, location_consent_updated_at no se mueve'
);
select lives_ok(
  $$update public.company_settings set location_consent_text = 'Texto nuevo con la validación por ubicación' where id = 1$$,
  'el dueño cambia el texto de consentimiento'
);
select is(
  (select location_consent_updated_at from public.company_settings where id = 1),
  now(),
  'al cambiar el texto, location_consent_updated_at se actualiza'
);

-- v_presence_today (B-11 a B-15, B-40) ---------------------------------------------------------------------

set local role postgres;
update public.company_settings set geofence_radius_m = 150 where id = 1;
update public.sites set geofence_radius_m = null where id = 'e5210000-0000-0000-0000-000000000011';

select tests.as_user('test-db052c-owner@example.com');

select is(
  (select count(*)::int from public.v_presence_today
    where kind = 'employee' and client_id = 'e5210000-0000-0000-0000-000000000001'),
  3,
  'el dueño ve a A, B y C (con inicio hoy); D no ficha y E empezó ayer'
);

select results_eq(
  $$select in_progress, geo_status::text, geo_overridden, distance_m, geofence_radius_m, site_radius_m
    from public.v_presence_today where kind = 'employee' and record_id = 'e5210000-0000-0000-0000-000000000301'$$,
  $$values (false, 'valid'::text, false, 10, 150::smallint, 150::smallint)$$,
  'v_presence_today: A ya terminó (in_progress falso) y muestra el resultado del fichaje de inicio'
);

select results_eq(
  $$select in_progress, geo_status::text, geo_overridden, latitude, longitude
    from public.v_presence_today where kind = 'employee' and record_id = 'e5210000-0000-0000-0000-000000000302'$$,
  $$values (true, 'outside'::text, true, -34.593700::numeric, -58.381600::numeric)$$,
  'v_presence_today: B sigue trabajando, fuera de zona pero corregido, con la posición del inicio'
);

select results_eq(
  $$select in_progress, latitude, geo_status::text, geo_reason::text, site_radius_m
    from public.v_presence_today where kind = 'employee' and record_id = 'e5210000-0000-0000-0000-000000000303'$$,
  $$values (true, null::numeric, 'unvalidated'::text, 'no_location'::text, 300::smallint)$$,
  'v_presence_today: C trabaja sin ubicación y su sede trae el radio propio'
);

select is(
  (select count(*)::int from public.v_presence_today where record_id = 'e5210000-0000-0000-0000-000000000305'),
  0,
  'v_presence_today: un inicio de ayer (antes de la medianoche de hoy) no aparece'
);

select results_eq(
  $$select in_progress, geo_status::text, person_last_name
    from public.v_presence_today where kind = 'supervisor' and record_id = 'e5210000-0000-0000-0000-000000000401'$$,
  $$values (true, 'outside'::text, 'Correcciones'::text)$$,
  'v_presence_today: el supervisor con una supervisión en curso aparece con su propio tipo de fila'
);

select results_eq(
  $$select record_id, site_radius_m from public.v_presence_today
    where kind = 'site' and client_id = 'e5210000-0000-0000-0000-000000000001' order by site_name$$,
  $$values ('e5210000-0000-0000-0000-000000000011'::uuid, 150::smallint), ('e5210000-0000-0000-0000-000000000012'::uuid, 300::smallint)$$,
  'v_presence_today: las dos sedes con turno hoy, con el radio vigente de cada una'
);

select tests.as_user('test-db052c-admin-sin-cap@example.com');
select is(
  (select count(*)::int from public.v_presence_today where client_id = 'e5210000-0000-0000-0000-000000000001'),
  6,
  'un administrador ve las mismas seis filas (tres empleados, un supervisor y dos sedes)'
);

select tests.as_user('test-db052c-super@example.com');
select is(
  (select count(*)::int from public.v_presence_today),
  0,
  'el supervisor no ve v_presence_today, ni siquiera su propia supervisión'
);

select tests.as_user('test-db052c-emp-b@example.com');
select is(
  (select count(*)::int from public.v_presence_today),
  0,
  'el empleado no ve v_presence_today, ni su propia fila'
);

set local role anon;
select throws_ok($$select count(*) from public.v_presence_today$$, '42501', null, 'anon no puede leer v_presence_today');

select * from finish();

rollback;
