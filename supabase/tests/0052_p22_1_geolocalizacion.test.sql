-- pgTAP de la migración 0052_p22_1_geolocalizacion.sql (P22.1, módulo B1, B-02 a B-10 y B-36 a
-- B-37): estructura, geo_distance_m y geo_evaluate en los límites (justo en el borde, precisión
-- 150 contra 151, sede sin coordenadas), la validación que calculan record_check_in/
-- record_check_out/supervision_check_in/supervision_check_out (radio general y radio propio de la
-- sede), el motivo opcional, la validación congelada al cambiar el radio y las coordenadas de la
-- sede, admin_record_attendance y que la supervisión valide contra la sede supervisada.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e5200000-...'.
--
-- Fechas: los turnos son de `app.today()` (las RPC exigen fecha del turno = hoy) y el único
-- instante que usa el archivo es `now()` de la transacción, igual para las RPC y para los
-- asserts: no depende de la hora a la que corra ni de la medianoche de Argentina.
--
-- Sede de referencia S1 (-34.6037, -58.3816). A 0.001 grado de latitud hay 111,1949 m (radio
-- terrestre 6 371 000 m); a 0.01, 1111,9493 m.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0052a;
grant usage on schema tests_0052a to authenticated, anon;

create or replace function tests_0052a.as_user(p_email text)
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
    raise exception 'tests_0052a.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0052a.as_user(text) to authenticated, anon;

select plan(69);

-- Estructura --------------------------------------------------------------------------------------

select enum_has_labels('public', 'geo_status', array['valid', 'outside', 'unvalidated'], 'geo_status tiene sus tres valores');
select enum_has_labels(
  'public', 'geo_unvalidated_reason',
  array['no_location', 'site_without_coords', 'admin_record', 'low_accuracy'],
  'geo_unvalidated_reason tiene sus cuatro motivos'
);
select has_column('public', 'company_settings', 'geofence_radius_m', 'company_settings.geofence_radius_m');
select has_column('public', 'company_settings', 'geofence_max_accuracy_m', 'company_settings.geofence_max_accuracy_m');
select has_column('public', 'company_settings', 'location_consent_updated_at', 'company_settings.location_consent_updated_at');
select has_column('public', 'sites', 'geofence_radius_m', 'sites.geofence_radius_m');
select has_column('public', 'attendance_records', 'geo_status', 'attendance_records.geo_status');
select has_column('public', 'supervision_attendance', 'geo_override_reason', 'supervision_attendance.geo_override_reason');
select has_function('public', 'record_check_in', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'record_check_in con p_outside_reason');
select has_function('public', 'record_check_out', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'record_check_out con p_outside_reason');
select has_function('public', 'supervision_check_in', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'supervision_check_in con p_outside_reason');
select has_function('public', 'supervision_check_out', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'supervision_check_out con p_outside_reason');
select hasnt_function('public', 'record_check_in', array['uuid', 'numeric', 'numeric', 'numeric'], 'no queda la sobrecarga vieja de record_check_in');
select is(
  (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('record_check_in', 'record_check_out', 'supervision_check_in', 'supervision_check_out')),
  4,
  'cada RPC de fichaje existe una sola vez (sin sobrecargas que confundan a PostgREST)'
);

-- Valores por defecto de la configuración (en App_dev el radio puede haberse tocado a mano, así que
-- se prueba el valor de la columna y no el de la fila).
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'company_settings' and column_name = 'geofence_radius_m'),
  '150',
  'el radio general vale 150 por defecto'
);
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'company_settings' and column_name = 'geofence_max_accuracy_m'),
  '150',
  'el tope de precisión vale 150 por defecto'
);

-- geo_distance_m y geo_evaluate -------------------------------------------------------------------

select is(
  round(public.geo_distance_m(-34.6037, -58.3816, -34.6027, -58.3816)::numeric, 4),
  111.1949::numeric,
  'geo_distance_m: 0.001 grado de latitud = 111,1949 m (radio terrestre 6 371 000 m)'
);
select is(public.geo_distance_m(-34.6037, -58.3816, -34.6037, -58.3816), 0::double precision, 'geo_distance_m: mismo punto = 0');
select is(public.geo_distance_m(null, -58.3816, -34.6037, -58.3816), null, 'geo_distance_m: argumento nulo = nulo');

-- Casos numéricos (los copia P22.2 en geoEvaluate): sede (-34.6037, -58.3816), tope 150.
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3816, 10, -34.6037, -58.3816, 150, 150)$$,
  $$values ('valid'::text, null::text, 0)$$,
  'geo_evaluate: en el mismo punto con precisión 10 = valid, 0 m'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6027, -58.3816, 11.2, -34.6037, -58.3816, 100, 150)$$,
  $$values ('valid'::text, null::text, 111)$$,
  'geo_evaluate: borde, 111,19 m <= 100 + 11,2 = valid'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6027, -58.3816, 11.1, -34.6037, -58.3816, 100, 150)$$,
  $$values ('outside'::text, null::text, 111)$$,
  'geo_evaluate: borde, 111,19 m > 100 + 11,1 = outside'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3816, 150, -34.6037, -58.3816, 150, 150)$$,
  $$values ('valid'::text, null::text, 0)$$,
  'geo_evaluate: precisión 150 (justo el tope) = valid'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3816, 151, -34.6037, -58.3816, 150, 150)$$,
  $$values ('unvalidated'::text, 'low_accuracy'::text, 0)$$,
  'geo_evaluate: precisión 151 y los círculos se tocan = unvalidated / low_accuracy'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.5937, -58.3816, 151, -34.6037, -58.3816, 150, 150)$$,
  $$values ('outside'::text, null::text, 1112)$$,
  'geo_evaluate: precisión 151 y los círculos no se tocan (1111,95 m > 301) = outside'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6017, -58.3816, 150, -34.6037, -58.3816, 100, 150)$$,
  $$values ('valid'::text, null::text, 222)$$,
  'geo_evaluate: 222,39 m <= 100 + 150 y precisión 150 = valid'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6017, -58.3816, 151, -34.6037, -58.3816, 100, 150)$$,
  $$values ('unvalidated'::text, 'low_accuracy'::text, 222)$$,
  'geo_evaluate: 222,39 m <= 100 + 151 y precisión 151 = unvalidated / low_accuracy'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3806, 45, -34.6037, -58.3816, 50, 150)$$,
  $$values ('valid'::text, null::text, 92)$$,
  'geo_evaluate: desplazamiento en longitud, 91,52 m <= 50 + 45 = valid, redondeado a 92 m'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3806, 5, -34.6037, -58.3816, 50, 150)$$,
  $$values ('outside'::text, null::text, 92)$$,
  'geo_evaluate: desplazamiento en longitud, 91,52 m > 50 + 5 = outside'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.5956, -58.3816, 20, -34.6037, -58.3816, 1000, 150)$$,
  $$values ('valid'::text, null::text, 901)$$,
  'geo_evaluate: radio 1000, 900,68 m = valid, 901 m'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(null, null, null, -34.6037, -58.3816, 150, 150)$$,
  $$values ('unvalidated'::text, 'no_location'::text, null::integer)$$,
  'geo_evaluate: sin coordenadas del fichaje = unvalidated / no_location'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3816, null, -34.6037, -58.3816, 150, 150)$$,
  $$values ('unvalidated'::text, 'no_location'::text, null::integer)$$,
  'geo_evaluate: coordenadas sin precisión = unvalidated / no_location'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(-34.6037, -58.3816, 10, null, null, 150, 150)$$,
  $$values ('unvalidated'::text, 'site_without_coords'::text, null::integer)$$,
  'geo_evaluate: sede sin coordenadas = unvalidated / site_without_coords'
);
select results_eq(
  $$select status::text, reason::text, distance_m from public.geo_evaluate(null, null, null, null, null, 150, 150)$$,
  $$values ('unvalidated'::text, 'no_location'::text, null::integer)$$,
  'geo_evaluate: sin ubicación y sede sin coordenadas = no_location (gana el primero)'
);
select is(
  (select provolatile::text from pg_proc where oid = 'public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer)'::regprocedure),
  'i',
  'geo_evaluate es inmutable'
);

-- Fixtures ----------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('e5200000-0000-0000-0000-000000000001', 'Cliente de geolocalización', 'active', 0);

-- S1: con coordenadas, radio general. S2: sin coordenadas. S3: radio propio de 60 m, 1112 m al norte.
insert into public.sites (id, client_id, name, address, latitude, longitude, geofence_radius_m, status) values
  ('e5200000-0000-0000-0000-000000000011', 'e5200000-0000-0000-0000-000000000001', 'Sede S1', 'Dirección 1', -34.603700, -58.381600, null, 'active'),
  ('e5200000-0000-0000-0000-000000000012', 'e5200000-0000-0000-0000-000000000001', 'Sede S2 sin coordenadas', 'Dirección 2', null, null, null, 'active'),
  ('e5200000-0000-0000-0000-000000000013', 'e5200000-0000-0000-0000-000000000001', 'Sede S3 radio propio', 'Dirección 3', -34.593700, -58.381600, 60, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5200000-0000-0000-0000-000000000081', 'test-db052-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Geo')),
  ('e5200000-0000-0000-0000-000000000082', 'test-db052-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Geo')),
  ('e5200000-0000-0000-0000-000000000083', 'test-db052-super@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Geo')),
  ('e5200000-0000-0000-0000-000000000091', 'test-db052-emp-a@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'A')),
  ('e5200000-0000-0000-0000-000000000092', 'test-db052-emp-b@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'B')),
  ('e5200000-0000-0000-0000-000000000093', 'test-db052-emp-c@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'C')),
  ('e5200000-0000-0000-0000-000000000094', 'test-db052-emp-d@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'D')),
  ('e5200000-0000-0000-0000-000000000095', 'test-db052-emp-e@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'E')),
  ('e5200000-0000-0000-0000-000000000096', 'test-db052-emp-f@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'F')),
  ('e5200000-0000-0000-0000-000000000097', 'test-db052-emp-g@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'G'));

insert into public.user_roles (profile_id, role) values
  ('e5200000-0000-0000-0000-000000000081', 'owner'),
  ('e5200000-0000-0000-0000-000000000082', 'admin'),
  ('e5200000-0000-0000-0000-000000000083', 'supervisor'),
  ('e5200000-0000-0000-0000-000000000091', 'employee'),
  ('e5200000-0000-0000-0000-000000000092', 'employee'),
  ('e5200000-0000-0000-0000-000000000093', 'employee'),
  ('e5200000-0000-0000-0000-000000000094', 'employee'),
  ('e5200000-0000-0000-0000-000000000095', 'employee'),
  ('e5200000-0000-0000-0000-000000000096', 'employee'),
  ('e5200000-0000-0000-0000-000000000097', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e5200000-0000-0000-0000-000000000082', 'manage_attendance', true);

insert into public.employees (profile_id, dni) values
  ('e5200000-0000-0000-0000-000000000083', '95200083'),
  ('e5200000-0000-0000-0000-000000000091', '95200091'),
  ('e5200000-0000-0000-0000-000000000092', '95200092'),
  ('e5200000-0000-0000-0000-000000000093', '95200093'),
  ('e5200000-0000-0000-0000-000000000094', '95200094'),
  ('e5200000-0000-0000-0000-000000000095', '95200095'),
  ('e5200000-0000-0000-0000-000000000096', '95200096'),
  ('e5200000-0000-0000-0000-000000000097', '95200097');

-- Un turno de hoy por caso (08:00 a 16:00). Turnos 201..204, 206 y 207 en S1; 205 en S2; 208 en S3.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select
  s.id::uuid, 'e5200000-0000-0000-0000-000000000001', s.site_id::uuid, app.today(), '08:00', '16:00', 1, 'scheduled'
from (values
  ('e5200000-0000-0000-0000-000000000201', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000202', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000203', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000204', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000205', 'e5200000-0000-0000-0000-000000000012'),
  ('e5200000-0000-0000-0000-000000000206', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000207', 'e5200000-0000-0000-0000-000000000011'),
  ('e5200000-0000-0000-0000-000000000208', 'e5200000-0000-0000-0000-000000000013')
) as s (id, site_id);

insert into public.assignments (id, shift_id, employee_id) values
  ('e5200000-0000-0000-0000-000000000301', 'e5200000-0000-0000-0000-000000000201', 'e5200000-0000-0000-0000-000000000091'),
  ('e5200000-0000-0000-0000-000000000302', 'e5200000-0000-0000-0000-000000000202', 'e5200000-0000-0000-0000-000000000092'),
  ('e5200000-0000-0000-0000-000000000303', 'e5200000-0000-0000-0000-000000000203', 'e5200000-0000-0000-0000-000000000093'),
  ('e5200000-0000-0000-0000-000000000304', 'e5200000-0000-0000-0000-000000000204', 'e5200000-0000-0000-0000-000000000094'),
  ('e5200000-0000-0000-0000-000000000305', 'e5200000-0000-0000-0000-000000000205', 'e5200000-0000-0000-0000-000000000095'),
  ('e5200000-0000-0000-0000-000000000306', 'e5200000-0000-0000-0000-000000000206', 'e5200000-0000-0000-0000-000000000096'),
  ('e5200000-0000-0000-0000-000000000308', 'e5200000-0000-0000-0000-000000000208', 'e5200000-0000-0000-0000-000000000097');

-- Dos supervisiones del supervisor: una de la sede S1 (turno 207) y otra de la sede S3 (turno 208).
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e5200000-0000-0000-0000-000000000401', 'e5200000-0000-0000-0000-000000000207', 'e5200000-0000-0000-0000-000000000083', 'assigned'),
  ('e5200000-0000-0000-0000-000000000402', 'e5200000-0000-0000-0000-000000000208', 'e5200000-0000-0000-0000-000000000083', 'assigned');

-- Radio y tope generales conocidos (la fila de App_dev puede haberse editado a mano).
update public.company_settings set geofence_radius_m = 150, geofence_max_accuracy_m = 150 where id = 1;

-- Empleado A: dentro de la zona, con el radio general (150 m) ------------------------------------

select tests_0052a.as_user('test-db052-emp-a@example.com');

select is(
  (select geo_status::text from public.record_check_in('e5200000-0000-0000-0000-000000000301', -34.6037, -58.3816, 10)),
  'valid',
  'record_check_in: en la sede y con buena precisión devuelve geo_status = valid'
);

select results_eq(
  $$select geo_status::text, geo_unvalidated_reason::text, site_distance_m, geofence_radius_m, outside_reason
    from public.attendance_records where assignment_id = 'e5200000-0000-0000-0000-000000000301' and kind = 'check_in'$$,
  $$values ('valid'::text, null::text, 0, 150::smallint, null::text)$$,
  'el inicio de A queda valid, a 0 m y con el radio vigente de 150 m'
);

-- Empleado B: fuera de la zona, con motivo ---------------------------------------------------------

select tests_0052a.as_user('test-db052-emp-b@example.com');

select is(
  (select geo_status::text from public.record_check_in('e5200000-0000-0000-0000-000000000302', -34.5937, -58.3816, 20, '  El GPS no anda en el subsuelo  ')),
  'outside',
  'record_check_in: a 1112 m con precisión 20 devuelve outside (no se bloquea)'
);

select results_eq(
  $$select geo_status::text, site_distance_m, geofence_radius_m, outside_reason
    from public.attendance_records where assignment_id = 'e5200000-0000-0000-0000-000000000302' and kind = 'check_in'$$,
  $$values ('outside'::text, 1112, 150::smallint, 'El GPS no anda en el subsuelo'::text)$$,
  'el inicio de B queda outside a 1112 m, con el motivo recortado'
);

-- Empleado C: precisión insuficiente ---------------------------------------------------------------

select tests_0052a.as_user('test-db052-emp-c@example.com');

select results_eq(
  $$select geo_status::text, geo_unvalidated_reason::text, site_distance_m
    from public.record_check_in('e5200000-0000-0000-0000-000000000303', -34.6037, -58.3816, 151)$$,
  $$values ('unvalidated'::text, 'low_accuracy'::text, 0)$$,
  'record_check_in: precisión 151 con los círculos tocándose = unvalidated / low_accuracy'
);

-- Empleado D: sin ubicación ------------------------------------------------------------------------

select tests_0052a.as_user('test-db052-emp-d@example.com');

select throws_ok(
  $$select * from public.record_check_in('e5200000-0000-0000-0000-000000000304', null, null, null, repeat('x', 301))$$,
  'P0001',
  'El motivo es demasiado largo (máximo 300 caracteres).',
  'record_check_in: un motivo de 301 caracteres = OUTSIDE_REASON_TOO_LONG'
);

select throws_ok(
  $$select * from public.record_check_in('e5200000-0000-0000-0000-000000000304', -34.6037, null, null)$$,
  'P0001',
  'Si mandás la ubicación, tiene que venir completa.',
  'record_check_in: coordenadas incompletas siguen rechazadas'
);

select results_eq(
  $$select geo_status::text, geo_unvalidated_reason::text, site_distance_m, geofence_radius_m, outside_reason
    from public.record_check_in('e5200000-0000-0000-0000-000000000304', null, null, null, 'No importa este motivo')$$,
  $$values ('unvalidated'::text, 'no_location'::text, null::integer, 150::smallint, null::text)$$,
  'record_check_in: sin ubicación = unvalidated / no_location (radio vigente guardado, motivo descartado)'
);

-- Empleado E: sede sin coordenadas ---------------------------------------------------------------

select tests_0052a.as_user('test-db052-emp-e@example.com');

select results_eq(
  $$select geo_status::text, geo_unvalidated_reason::text, site_distance_m
    from public.record_check_in('e5200000-0000-0000-0000-000000000305', -34.6037, -58.3816, 10)$$,
  $$values ('unvalidated'::text, 'site_without_coords'::text, null::integer)$$,
  'record_check_in: sede sin coordenadas = unvalidated / site_without_coords'
);

-- Empleado G: sede con radio propio (60 m), a 111,19 m con precisión 50 (turno 208, sede S3) ---------

select tests_0052a.as_user('test-db052-emp-g@example.com');

select results_eq(
  $$select geo_status::text, site_distance_m, geofence_radius_m
    from public.record_check_in('e5200000-0000-0000-0000-000000000308', -34.5927, -58.3816, 50)$$,
  $$values ('outside'::text, 111, 60::smallint)$$,
  'record_check_in: la sede S3 usa su radio propio (60 + 50 < 111,19 m = outside, radio guardado 60)'
);

-- Validación congelada (B-08) ----------------------------------------------------------------------
-- Se cambian el radio general y las coordenadas de S1 y los fichajes ya guardados no se mueven.

set local role postgres;
update public.company_settings set geofence_radius_m = 50 where id = 1;
update public.sites set latitude = -34.500000 where id = 'e5200000-0000-0000-0000-000000000011';

select results_eq(
  $$select geo_status::text, site_distance_m, geofence_radius_m
    from public.attendance_records where assignment_id = 'e5200000-0000-0000-0000-000000000301' and kind = 'check_in'$$,
  $$values ('valid'::text, 0, 150::smallint)$$,
  'cambiar el radio y las coordenadas de la sede no recalcula el inicio de A (sigue valid, 0 m, 150 m)'
);

select tests_0052a.as_user('test-db052-emp-a@example.com');

select results_eq(
  $$select geo_status::text, site_distance_m, geofence_radius_m
    from public.record_check_out('e5200000-0000-0000-0000-000000000301', -34.6037, -58.3816, 10)$$,
  $$values ('outside'::text, 11531, 50::smallint)$$,
  'el fin de A se evalúa con el radio y las coordenadas nuevos (50 m, sede movida: outside a 11 722 m)'
);

select results_eq(
  $$select geo_status::text, geofence_radius_m from public.attendance_records
    where assignment_id = 'e5200000-0000-0000-0000-000000000301' order by kind$$,
  $$values ('valid'::text, 150::smallint), ('outside'::text, 50::smallint)$$,
  'inicio y fin de A guardan, cada uno, el radio vigente de su momento'
);

-- Se restituye la sede para los casos siguientes.
set local role postgres;
update public.sites set latitude = -34.603700 where id = 'e5200000-0000-0000-0000-000000000011';
update public.company_settings set geofence_radius_m = 150 where id = 1;

-- Empleado B: fin fuera de zona y el motivo se descarta si el resultado no es outside -------------

select tests_0052a.as_user('test-db052-emp-b@example.com');

select results_eq(
  $$select geo_status::text, outside_reason from public.record_check_out(
      'e5200000-0000-0000-0000-000000000302', -34.6037, -58.3816, 10, 'Esto no se guarda')$$,
  $$values ('valid'::text, null::text)$$,
  'record_check_out: dentro de la zona = valid y el motivo informado se descarta'
);

-- Supervisor: valida contra la sede supervisada (B-07) -----------------------------------------------

-- Desde P24.1 (0063) supervision_check_in y supervision_check_out ya no se pueden ejecutar: el inicio
-- es take_supervision y el fin es complete_supervision, que evalúan la sede con el mismo
-- app.geo_for_site (el flujo completo está en 0063_p24_1_supervision_libre.test.sql). Acá se
-- conserva la cobertura de la lógica de sede: radio general, radio propio, sin ubicación y el tope
-- del motivo.
set local role postgres;

-- Parado en S3 (-34.5937) contra la sede S1: queda fuera de zona.
select results_eq(
  $$select status::text, distance_m, radius_m
    from app.geo_for_site('e5200000-0000-0000-0000-000000000011', -34.5937, -58.3816, 10)$$,
  $$values ('outside'::text, 1112, 150::smallint)$$,
  'validación de sede de la supervisión: parado en otra sede queda outside contra la sede supervisada (S1)'
);

select results_eq(
  $$select status::text, distance_m, radius_m
    from app.geo_for_site('e5200000-0000-0000-0000-000000000013', -34.5937, -58.3816, 10)$$,
  $$values ('valid'::text, 0, 60::smallint)$$,
  'validación de sede de la supervisión: la misma posición contra la sede S3 es valid, con el radio propio de S3'
);

select results_eq(
  $$select status::text, reason::text, distance_m
    from app.geo_for_site('e5200000-0000-0000-0000-000000000013', null, null, null)$$,
  $$values ('unvalidated'::text, 'no_location'::text, null::integer)$$,
  'validación de sede de la supervisión: sin ubicación = unvalidated / no_location'
);

select throws_ok(
  $$select app.validate_position(1, 1, 1, repeat('x', 301))$$,
  'P0001',
  'El motivo es demasiado largo (máximo 300 caracteres).',
  'validación de la posición de la supervisión: un motivo de 301 caracteres = OUTSIDE_REASON_TOO_LONG'
);

select results_eq(
  $$select status::text, distance_m from app.geo_for_site('e5200000-0000-0000-0000-000000000011', -34.6037, -58.3816, 10)$$,
  $$values ('valid'::text, 0)$$,
  'validación de sede de la supervisión: ya en la sede S1 queda valid'
);

-- admin_record_attendance: origen admin (B-03) -----------------------------------------------------

select tests_0052a.as_user('test-db052-admin@example.com');

select results_eq(
  $$select geo_status::text, geo_unvalidated_reason::text, site_distance_m, geofence_radius_m, latitude
    from public.admin_record_attendance('e5200000-0000-0000-0000-000000000306', 'check_in', null, 'Cargado por el administrador')$$,
  $$values ('unvalidated'::text, 'admin_record'::text, null::integer, null::smallint, null::numeric)$$,
  'admin_record_attendance: el registro de origen admin queda unvalidated / admin_record, sin distancia ni radio'
);

-- Restricciones de la tabla ---------------------------------------------------------------------------

set local role postgres;

select throws_ok(
  $$update public.attendance_records set geo_status = 'valid', geo_unvalidated_reason = 'no_location'
    where assignment_id = 'e5200000-0000-0000-0000-000000000301' and kind = 'check_in'$$,
  '23514',
  null,
  'un registro valid con motivo de sin validar viola el check de geo_unvalidated_reason'
);
select throws_ok(
  $$update public.attendance_records set geo_override_at = now()
    where assignment_id = 'e5200000-0000-0000-0000-000000000301' and kind = 'check_in'$$,
  '23514',
  null,
  'la corrección de la validación exige quién, cuándo y motivo juntos'
);
select throws_ok(
  $$update public.attendance_records set outside_reason = repeat('x', 301)
    where assignment_id = 'e5200000-0000-0000-0000-000000000301' and kind = 'check_in'$$,
  '23514',
  null,
  'outside_reason tiene un tope de 300 caracteres'
);
select throws_ok(
  $$update public.company_settings set geofence_radius_m = 49 where id = 1$$,
  '23514',
  null,
  'company_settings: el radio general no baja de 50 m'
);
select throws_ok(
  $$update public.company_settings set geofence_radius_m = 1001 where id = 1$$,
  '23514',
  null,
  'company_settings: el radio general no pasa de 1000 m'
);
select throws_ok(
  $$update public.sites set geofence_radius_m = 49 where id = 'e5200000-0000-0000-0000-000000000011'$$,
  '23514',
  null,
  'sites: el radio propio no baja de 50 m'
);
select lives_ok(
  $$update public.sites set geofence_radius_m = 1000 where id = 'e5200000-0000-0000-0000-000000000011'$$,
  'sites: el radio propio admite 1000 m'
);

-- Permisos de las funciones -------------------------------------------------------------------------

select ok(
  has_function_privilege('authenticated', 'public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.geo_evaluate(numeric, numeric, numeric, numeric, numeric, integer, integer)', 'execute'),
  'geo_evaluate: authenticated sí, anon no'
);
select ok(
  not has_function_privilege('authenticated', 'app.geo_for_site(uuid, numeric, numeric, numeric)', 'execute'),
  'app.geo_for_site es interna: authenticated no puede ejecutarla'
);
select ok(
  not has_function_privilege('anon', 'public.record_check_in(uuid, numeric, numeric, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.record_check_in(uuid, numeric, numeric, numeric, text)', 'execute'),
  'record_check_in: authenticated sí, anon no'
);
select ok(
  not has_function_privilege('anon', 'public.supervision_check_in(uuid, numeric, numeric, numeric, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.supervision_check_in(uuid, numeric, numeric, numeric, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.supervision_check_out(uuid, numeric, numeric, numeric, text)', 'execute'),
  'supervision_check_in / supervision_check_out: revocadas en 0063 (P24.1), ni authenticated ni anon'
);

-- Roles que no pueden fichar (siguen igual) -----------------------------------------------------------

select tests_0052a.as_user('test-db052-admin@example.com');

select throws_ok(
  $$select * from public.record_check_in('e5200000-0000-0000-0000-000000000301', -34.6037, -58.3816, 10)$$,
  'P0001',
  'No tenés permiso para hacer esto.',
  'record_check_in: un administrador no ficha como empleado'
);

select tests_0052a.as_user('test-db052-emp-f@example.com');

select throws_ok(
  $$select * from public.supervision_check_in('e5200000-0000-0000-0000-000000000401', -34.6037, -58.3816, 10)$$,
  '42501',
  null,
  'supervision_check_in: revocada (0063, P24.1), un empleado tampoco la puede ejecutar'
);

select throws_ok(
  $$select * from public.record_check_in('e5200000-0000-0000-0000-000000000301', -34.6037, -58.3816, 10)$$,
  'P0001',
  'Esa asignación no es tuya.',
  'record_check_in: sigue rechazando la asignación ajena'
);

select * from finish();

rollback;
