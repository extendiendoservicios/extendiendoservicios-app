-- pgTAP de las migraciones 0054_p22_1b_privacidad_coordenadas.sql y 0055 (P22.1b, B-40 y B-28): ni el
-- supervisor ni el empleado leen las coordenadas, la precisión ni el motivo de la corrección de un
-- fichaje, por tabla, vistas o RPC; el dueño y los administradores los leen por la RPC
-- get_attendance_location y por las vistas (la tabla está cerrada para todos los usuarios de la
-- API). Se prueba con los privilegios reales del rol authenticated y el JWT de cada rol.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e5400000-...'.

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


select plan(59);

-- Estructura y privilegios de columna -------------------------------------------------------------

select has_function('public', 'get_attendance_location', array['text', 'uuid'], 'existe get_attendance_location');
select has_function('app', 'attendance_position', array['text', 'uuid'], 'existe app.attendance_position');

select ok(
  not has_table_privilege('authenticated', 'public.attendance_records', 'select')
  and not has_table_privilege('authenticated', 'public.supervision_attendance', 'select'),
  'authenticated no tiene select de tabla sobre attendance_records ni supervision_attendance (solo por columna)'
);
select is(
  (select array_agg(c.column_name::text order by c.column_name)
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'attendance_records'
     and not has_column_privilege('authenticated', 'public.attendance_records', c.column_name, 'select')),
  array['accuracy_m', 'geo_override_by', 'geo_override_reason', 'latitude', 'longitude'],
  'attendance_records: las columnas sin select para authenticated son exactamente las cinco protegidas'
);
select is(
  (select array_agg(c.column_name::text order by c.column_name)
   from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'supervision_attendance'
     and not has_column_privilege('authenticated', 'public.supervision_attendance', c.column_name, 'select')),
  array['accuracy_m', 'geo_override_by', 'geo_override_reason', 'latitude', 'longitude'],
  'supervision_attendance: las columnas sin select para authenticated son exactamente las cinco protegidas'
);
select ok(
  has_column_privilege('authenticated', 'public.attendance_records', 'recorded_at', 'select')
  and has_column_privilege('authenticated', 'public.attendance_records', 'geo_override_at', 'select')
  and has_column_privilege('authenticated', 'public.supervision_attendance', 'geo_status', 'select'),
  'el resto de las columnas conserva el select (recorded_at, geo_override_at, geo_status)'
);
select ok(
  not has_table_privilege('anon', 'public.attendance_records', 'select')
  and not has_column_privilege('anon', 'public.attendance_records', 'latitude', 'select')
  and not has_table_privilege('anon', 'public.supervision_attendance', 'select')
  and not has_table_privilege('anon', 'public.attendance_corrections', 'select'),
  'anon no lee las tablas de asistencia ni attendance_corrections'
);
select ok(
  not has_function_privilege('anon', 'public.get_attendance_location(text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.get_attendance_location(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.attendance_position(text, uuid)', 'execute'),
  'get_attendance_location y app.attendance_position: execute para authenticated y no para anon'
);

-- 0055: service_role también consulta las vistas que llaman a la función, sin ver coordenadas.
select ok(
  has_function_privilege('service_role', 'app.attendance_position(text, uuid)', 'execute'),
  'service_role puede ejecutar app.attendance_position (las vistas de administración la llaman)'
);
-- Fixtures ----------------------------------------------------------------------------------------

update public.company_settings set geofence_radius_m = 150, geofence_max_accuracy_m = 150 where id = 1;

insert into public.clients (id, legal_name, status) values
  ('e5400000-0000-0000-0000-000000000001', 'Cliente de privacidad', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, geofence_radius_m, status) values
  ('e5400000-0000-0000-0000-000000000011', 'e5400000-0000-0000-0000-000000000001', 'Sede P1', 'Dirección 1', -34.603700, -58.381600, null, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5400000-0000-0000-0000-000000000081', 'test-db054-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Privacidad')),
  ('e5400000-0000-0000-0000-000000000082', 'test-db054-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Privacidad')),
  ('e5400000-0000-0000-0000-000000000084', 'test-db054-super@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Privacidad')),
  ('e5400000-0000-0000-0000-000000000085', 'test-db054-super-otro@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Ajeno')),
  ('e5400000-0000-0000-0000-000000000091', 'test-db054-emp-a@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'A'));

insert into public.user_roles (profile_id, role) values
  ('e5400000-0000-0000-0000-000000000081', 'owner'),
  ('e5400000-0000-0000-0000-000000000082', 'admin'),
  ('e5400000-0000-0000-0000-000000000084', 'supervisor'),
  ('e5400000-0000-0000-0000-000000000085', 'supervisor'),
  ('e5400000-0000-0000-0000-000000000091', 'employee');

insert into public.employees (profile_id, dni) values
  ('e5400000-0000-0000-0000-000000000084', '95400084'),
  ('e5400000-0000-0000-0000-000000000085', '95400085'),
  ('e5400000-0000-0000-0000-000000000091', '95400091');

-- Turno de hoy 201 (empleado A asignado; supervisa el supervisor 084). El supervisor 085 no supervisa nada.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
values ('e5400000-0000-0000-0000-000000000201', 'e5400000-0000-0000-0000-000000000001', 'e5400000-0000-0000-0000-000000000011', app.today(), '08:00', '16:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('e5400000-0000-0000-0000-000000000301', 'e5400000-0000-0000-0000-000000000201', 'e5400000-0000-0000-0000-000000000091');
update public.assignments set status = 'present' where id = 'e5400000-0000-0000-0000-000000000301';

-- Inicio de A: fuera de zona, con coordenadas, ya marcado como válido por el dueño (con motivo) y con la hora corregida.
insert into public.attendance_records (
  id, assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
  geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m,
  geo_override_by, geo_override_at, geo_override_reason, time_corrected_at
) values (
  'e5400000-0000-0000-0000-000000000501', 'e5400000-0000-0000-0000-000000000301', 'check_in', tests.t(0.25),
  -34.593700, -58.381600, 12.5, 'employee_app', 'e5400000-0000-0000-0000-000000000091',
  'outside', null, 1112, 150,
  'e5400000-0000-0000-0000-000000000081', tests.t(0.5), 'Motivo reservado de la corrección', tests.t(0.5)
);

insert into public.attendance_corrections (id, attendance_record_id, kind, reason, corrected_by) values
  ('e5400000-0000-0000-0000-000000000701', 'e5400000-0000-0000-0000-000000000501', 'geo', 'Motivo reservado de la corrección', 'e5400000-0000-0000-0000-000000000081');

-- Supervisión en curso del supervisor 084 sobre el turno 201, con su inicio.
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e5400000-0000-0000-0000-000000000401', 'e5400000-0000-0000-0000-000000000201', 'e5400000-0000-0000-0000-000000000084', 'in_progress');
insert into public.supervision_attendance (
  id, supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
  geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m
) values (
  'e5400000-0000-0000-0000-000000000601', 'e5400000-0000-0000-0000-000000000401', 'check_in', tests.t(0.3),
  -34.603800, -58.381600, 8.0, 'valid', null, 11, 150
);

-- Supervisor: no lee la posición de los empleados -----------------------------------------------------

select tests.as_user('test-db054-super@example.com');

select is(
  (select count(*)::int from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'),
  1,
  'supervisor: sigue viendo el fichaje del empleado de su turno (la RLS no cambió)'
);
select results_eq(
  $$select geo_status::text, site_distance_m, (geo_override_at is not null) from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  $$values ('outside'::text, 1112, true)$$,
  'supervisor: lee las columnas sin protección (validación, distancia, marca de corrección)'
);
select throws_ok(
  $$select latitude from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no puede leer attendance_records.latitude'
);
select throws_ok(
  $$select longitude from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no puede leer attendance_records.longitude'
);
select throws_ok(
  $$select accuracy_m from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no puede leer attendance_records.accuracy_m'
);
select throws_ok(
  $$select geo_override_reason from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no puede leer attendance_records.geo_override_reason'
);
select throws_ok(
  $$select geo_override_by from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no puede leer attendance_records.geo_override_by'
);
select throws_ok(
  $$select * from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: select * de attendance_records falla (PostgREST select=* también)'
);
select throws_ok(
  $$select a.* from public.attendance_records a where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: no hay forma de traer la fila entera con alias'
);
select throws_ok(
  $$select latitude from public.supervision_attendance where id = 'e5400000-0000-0000-0000-000000000601'$$,
  '42501', null, 'supervisor: tampoco lee supervision_attendance.latitude (ni la propia)'
);
select throws_ok(
  $$select geo_override_reason from public.supervision_attendance where id = 'e5400000-0000-0000-0000-000000000601'$$,
  '42501', null, 'supervisor: no puede leer supervision_attendance.geo_override_reason'
);
select throws_ok(
  $$select * from public.supervision_attendance where id = 'e5400000-0000-0000-0000-000000000601'$$,
  '42501', null, 'supervisor: select * de supervision_attendance falla'
);
select throws_ok(
  $$select to_jsonb(ar) from public.attendance_records ar where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'supervisor: to_jsonb de la fila entera tampoco pasa'
);

-- vistas
select lives_ok(
  $$select * from public.v_assignments_board$$,
  'supervisor: select * de v_assignments_board funciona (la vista no depende de privilegios de columna del que consulta)'
);
select is(
  (select count(*)::int from public.v_assignments_board where check_in_accuracy_m is not null or check_out_accuracy_m is not null),
  0,
  'supervisor: v_assignments_board no trae ninguna precisión de fichaje (todas null)'
);
select is(
  (select count(*)::int from public.v_presence_today),
  0,
  'supervisor: v_presence_today no devuelve filas'
);
select results_eq(
  $$select check_in_geo_status::text, check_in_accuracy_m from public.v_supervisions_admin where id = 'e5400000-0000-0000-0000-000000000401'$$,
  $$values ('valid'::text, null::numeric)$$,
  'supervisor: v_supervisions_admin muestra la validación de su supervisión y la precisión en null'
);

-- RPC
select throws_ok(
  $$select public.get_attendance_location('attendance', 'e5400000-0000-0000-0000-000000000501')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'supervisor: get_attendance_location = FORBIDDEN'
);
select throws_ok(
  $$select public.get_attendance_location('supervision', 'e5400000-0000-0000-0000-000000000601')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'supervisor: get_attendance_location de su propia supervisión = FORBIDDEN'
);
select is(
  (select count(*)::int from app.attendance_position('attendance', 'e5400000-0000-0000-0000-000000000501')),
  0,
  'supervisor: app.attendance_position no devuelve filas'
);

-- attendance_corrections
select is(
  (select count(*)::int from public.attendance_corrections),
  0,
  'supervisor: no ve filas de attendance_corrections'
);

-- Otro supervisor (sin turnos): ni la fila
select tests.as_user('test-db054-super-otro@example.com');
select is(
  (select count(*)::int from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'),
  0,
  'supervisor ajeno: no ve el fichaje (la RLS por turno sigue vigente)'
);

-- Empleado: ve su fichaje pero no el motivo de la corrección ---------------------------------------------

select tests.as_user('test-db054-emp-a@example.com');

select results_eq(
  $$select geo_status::text, (geo_override_at is not null), (time_corrected_at is not null) from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  $$values ('outside'::text, true, true)$$,
  'empleado: ve que su fichaje fue corregido (marcas sin motivo)'
);
select throws_ok(
  $$select geo_override_reason from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'empleado: no puede leer geo_override_reason'
);
select throws_ok(
  $$select geo_override_by from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'empleado: no puede leer geo_override_by'
);
select throws_ok(
  $$select latitude, longitude, accuracy_m from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'empleado: tampoco lee las coordenadas de la tabla (las toma del GPS en vivo)'
);
select throws_ok(
  $$select * from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'empleado: select * de attendance_records falla'
);
select is(
  (select count(*)::int from public.attendance_corrections),
  0,
  'empleado: no ve filas de attendance_corrections'
);
select results_eq(
  $$select check_in_geo_status::text, check_in_geo_overridden, check_in_time_corrected from public.v_my_day where assignment_id = 'e5400000-0000-0000-0000-000000000301'$$,
  $$values ('outside'::text, true, true)$$,
  'empleado: v_my_day sigue mostrando su fichaje, con la marca de corrección y sin motivo'
);
select throws_ok(
  $$select public.get_attendance_location('attendance', 'e5400000-0000-0000-0000-000000000501')$$,
  'P0001', 'No tenés permiso para hacer esto.', 'empleado: get_attendance_location = FORBIDDEN'
);
select is(
  (select count(*)::int from public.v_presence_today),
  0,
  'empleado: v_presence_today no devuelve filas'
);
select lives_ok(
  $$select * from public.v_my_history$$,
  'empleado: select * de v_my_history funciona'
);

-- Administración: la tabla está cerrada también para ella; se lee por la vista y la RPC --------------------

select tests.as_user('test-db054-admin@example.com');

select results_eq(
  $$select geo_status::text, site_distance_m, (geo_override_at is not null) from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  $$values ('outside'::text, 1112, true)$$,
  'administrador: lee las columnas sin protección de la tabla'
);
select throws_ok(
  $$select latitude from public.attendance_records where id = 'e5400000-0000-0000-0000-000000000501'$$,
  '42501', null, 'administrador: la lectura directa de latitude también está cerrada (se lee por la RPC o la vista)'
);
select is(
  (select count(*)::int from public.attendance_corrections),
  1,
  'administrador: ve attendance_corrections'
);
select is(
  (select reason from public.attendance_corrections where id = 'e5400000-0000-0000-0000-000000000701'),
  'Motivo reservado de la corrección',
  'administrador: lee el motivo de la corrección en attendance_corrections'
);

select results_eq(
  $$select latitude, longitude, accuracy_m from public.v_presence_today where kind = 'employee' and record_id = 'e5400000-0000-0000-0000-000000000301'$$,
  $$values (-34.593700::numeric(9,6), -58.381600::numeric(9,6), 12.5::numeric(7,1))$$,
  'administrador: v_presence_today trae la posición del fichaje del empleado'
);
select results_eq(
  $$select latitude, longitude, accuracy_m from public.v_presence_today where kind = 'supervisor' and record_id = 'e5400000-0000-0000-0000-000000000401'$$,
  $$values (-34.603800::numeric(9,6), -58.381600::numeric(9,6), 8.0::numeric(7,1))$$,
  'administrador: v_presence_today trae la posición del fichaje del supervisor'
);
select is(
  (select check_in_accuracy_m from public.v_assignments_board where id = 'e5400000-0000-0000-0000-000000000301'),
  12.5::numeric,
  'administrador: v_assignments_board trae la precisión del fichaje'
);
select is(
  (select check_in_accuracy_m from public.v_supervisions_admin where id = 'e5400000-0000-0000-0000-000000000401'),
  8.0::numeric,
  'administrador: v_supervisions_admin trae la precisión del fichaje de la supervisión'
);

select results_eq(
  $$select r ->> 'record_type', (r ->> 'latitude')::numeric, (r ->> 'longitude')::numeric, (r ->> 'accuracy_m')::numeric,
           r ->> 'geo_status', (r ->> 'distance_m')::int, (r ->> 'geofence_radius_m')::int,
           (r ->> 'site_latitude')::numeric, (r ->> 'site_longitude')::numeric, (r ->> 'site_radius_m')::int,
           (r ->> 'geo_overridden')::boolean, r ->> 'site_name'
    from (select public.get_attendance_location('attendance', 'e5400000-0000-0000-0000-000000000501') as r) x$$,
  $$values ('attendance'::text, -34.593700::numeric, -58.381600::numeric, 12.5::numeric,
            'outside'::text, 1112, 150, -34.603700::numeric, -58.381600::numeric, 150, true, 'Sede P1'::text)$$,
  'administrador: get_attendance_location devuelve la posición del fichaje y la sede (radio vigente)'
);
select results_eq(
  $$select r ->> 'record_type', (r ->> 'latitude')::numeric, r ->> 'kind'
    from (select public.get_attendance_location('supervision', 'e5400000-0000-0000-0000-000000000601') as r) x$$,
  $$values ('supervision'::text, -34.603800::numeric, 'check_in'::text)$$,
  'administrador: get_attendance_location también lee fichajes de supervisión'
);
select throws_ok(
  $$select public.get_attendance_location('otro', 'e5400000-0000-0000-0000-000000000501')$$,
  'P0001', 'El tipo de registro no es válido.', 'get_attendance_location: tipo inválido = INVALID_RECORD_TYPE'
);
select throws_ok(
  $$select public.get_attendance_location(null, 'e5400000-0000-0000-0000-000000000501')$$,
  'P0001', 'El tipo de registro no es válido.', 'get_attendance_location: tipo nulo = INVALID_RECORD_TYPE'
);
select throws_ok(
  $$select public.get_attendance_location('attendance', 'e5400000-0000-0000-0000-0000000009ff')$$,
  'P0001', 'No encontramos ese registro.', 'get_attendance_location: registro inexistente = RECORD_NOT_FOUND'
);

-- El dueño también -------------------------------------------------------------------------------------

select tests.as_user('test-db054-owner@example.com');

select is(
  (select (public.get_attendance_location('attendance', 'e5400000-0000-0000-0000-000000000501') ->> 'latitude')::numeric),
  -34.593700::numeric,
  'dueño: get_attendance_location devuelve la posición'
);
select is(
  (select count(*)::int from public.v_presence_today where record_id in ('e5400000-0000-0000-0000-000000000301', 'e5400000-0000-0000-0000-000000000401')),
  2,
  'dueño: v_presence_today trae las dos filas de personas'
);
select throws_ok(
  $$select longitude from public.supervision_attendance where id = 'e5400000-0000-0000-0000-000000000601'$$,
  '42501', null, 'dueño: la lectura directa de longitude de supervision_attendance está cerrada'
);

-- Consulta completa del tablero como administrador (sin errores de privilegio) ---------------------------

select tests.as_user('test-db054-admin@example.com');
select lives_ok(
  $$select count(*) from public.v_assignments_board where shift_id = 'e5400000-0000-0000-0000-000000000201'$$,
  'administrador: v_assignments_board se consulta completa sin errores de privilegio'
);

-- service_role (Edge Function y scripts) consulta las vistas de administración (0055).
set local role service_role;
select lives_ok(
  $$select (select count(*) from public.v_presence_today) + (select count(*) from public.v_assignments_board) + (select count(*) from public.v_supervisions_admin)$$,
  'service_role consulta las tres vistas de administración sin error de privilegio'
);

set local role postgres;

select * from finish();

rollback;
