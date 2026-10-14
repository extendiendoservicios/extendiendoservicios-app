-- pgTAP de la migración 0056_p22_4b_resumen_y_consentimiento.sql (P22.4b, módulo B1):
--   1. client_service_summary trae por empleado la validación por ubicación del inicio y del fin
--      (estado, motivo, distancia y marca de corrección), sin coordenadas (B-20, B-40).
--   2. accept_location_consent() / revoke_location_consent(): hora del servidor, solo para quien
--      llama, permisos por rol.
--
-- Convención (ver supabase/tests/README.md): una transacción que termina en `rollback`.
-- Prefijo de fixtures propio de este archivo: 'e5600000-...'.

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

create or replace function tests.err_hint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;

grant execute on function tests.err_hint(text) to authenticated, anon;

select plan(32);

-- Fixtures ----------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e5600000-0000-0000-0000-000000000001', 'Cliente del resumen geo', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('e5600000-0000-0000-0000-000000000011', 'e5600000-0000-0000-0000-000000000001', 'Sede R1', 'Dirección 1', -34.603700, -58.381600, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5600000-0000-0000-0000-000000000081', 'test-db056-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Geo')),
  ('e5600000-0000-0000-0000-000000000082', 'test-db056-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Geo')),
  ('e5600000-0000-0000-0000-000000000084', 'test-db056-super@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Geo')),
  ('e5600000-0000-0000-0000-000000000091', 'test-db056-emp-a@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Valida')),
  ('e5600000-0000-0000-0000-000000000092', 'test-db056-emp-b@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Fuera')),
  ('e5600000-0000-0000-0000-000000000093', 'test-db056-emp-c@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Corregida')),
  ('e5600000-0000-0000-0000-000000000094', 'test-db056-emp-d@example.com', jsonb_build_object('first_name', 'Dani', 'last_name', 'SinInicio'));

insert into public.user_roles (profile_id, role) values
  ('e5600000-0000-0000-0000-000000000081', 'owner'),
  ('e5600000-0000-0000-0000-000000000082', 'admin'),
  ('e5600000-0000-0000-0000-000000000084', 'supervisor'),
  ('e5600000-0000-0000-0000-000000000091', 'employee'),
  ('e5600000-0000-0000-0000-000000000092', 'employee'),
  ('e5600000-0000-0000-0000-000000000093', 'employee'),
  ('e5600000-0000-0000-0000-000000000094', 'employee');

insert into public.employees (profile_id, dni) values
  ('e5600000-0000-0000-0000-000000000084', '95600084'),
  ('e5600000-0000-0000-0000-000000000091', '95600091'),
  ('e5600000-0000-0000-0000-000000000092', '95600092'),
  ('e5600000-0000-0000-0000-000000000093', '95600093'),
  ('e5600000-0000-0000-0000-000000000094', '95600094');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
values ('e5600000-0000-0000-0000-000000000201', 'e5600000-0000-0000-0000-000000000001', 'e5600000-0000-0000-0000-000000000011', app.today(), '00:01', '23:00', 4, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('e5600000-0000-0000-0000-000000000301', 'e5600000-0000-0000-0000-000000000201', 'e5600000-0000-0000-0000-000000000091'),
  ('e5600000-0000-0000-0000-000000000302', 'e5600000-0000-0000-0000-000000000201', 'e5600000-0000-0000-0000-000000000092'),
  ('e5600000-0000-0000-0000-000000000303', 'e5600000-0000-0000-0000-000000000201', 'e5600000-0000-0000-0000-000000000093'),
  ('e5600000-0000-0000-0000-000000000304', 'e5600000-0000-0000-0000-000000000201', 'e5600000-0000-0000-0000-000000000094');
update public.assignments set status = 'present'
where id in ('e5600000-0000-0000-0000-000000000301', 'e5600000-0000-0000-0000-000000000302', 'e5600000-0000-0000-0000-000000000303');

-- A: inicio válido (11 m) y fin fuera de zona (350 m).
-- B: inicio fuera de zona (1250 m), sin fin.
-- C: inicio fuera de zona corregido por el dueño.
-- D: sin inicio.
insert into public.attendance_records (
  id, assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by,
  geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m,
  geo_override_by, geo_override_at, geo_override_reason
) values
  ('e5600000-0000-0000-0000-000000000501', 'e5600000-0000-0000-0000-000000000301', 'check_in', now() - interval '3 minutes',
   -34.603800, -58.381600, 8.0, 'employee_app', 'e5600000-0000-0000-0000-000000000091',
   'valid', null, 11, 150, null, null, null),
  ('e5600000-0000-0000-0000-000000000502', 'e5600000-0000-0000-0000-000000000301', 'check_out', now() - interval '2 minutes',
   -34.600500, -58.381600, 8.0, 'employee_app', 'e5600000-0000-0000-0000-000000000091',
   'outside', null, 350, 150, null, null, null),
  ('e5600000-0000-0000-0000-000000000503', 'e5600000-0000-0000-0000-000000000302', 'check_in', now() - interval '3 minutes',
   -34.592500, -58.381600, 9.0, 'employee_app', 'e5600000-0000-0000-0000-000000000092',
   'outside', null, 1250, 150, null, null, null),
  ('e5600000-0000-0000-0000-000000000504', 'e5600000-0000-0000-0000-000000000303', 'check_in', now() - interval '3 minutes',
   -34.592500, -58.381600, 9.0, 'employee_app', 'e5600000-0000-0000-0000-000000000093',
   'outside', null, 1250, 150,
   'e5600000-0000-0000-0000-000000000081', now() - interval '1 minute', 'Estaba en la puerta');

-- Estructura y permisos ---------------------------------------------------------------------------

select has_function('public', 'accept_location_consent', array[]::text[], 'existe accept_location_consent()');
select has_function('public', 'revoke_location_consent', array[]::text[], 'existe revoke_location_consent()');
select ok(
  (select prosecdef from pg_proc where oid = 'public.accept_location_consent()'::regprocedure)
  and (select prosecdef from pg_proc where oid = 'public.revoke_location_consent()'::regprocedure),
  'las dos RPC de consentimiento son security definer'
);
select ok(
  (select proconfig::text like '%search_path=public, app, pg_temp%' from pg_proc where oid = 'public.accept_location_consent()'::regprocedure),
  'accept_location_consent fija el search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_location_consent()', 'execute')
  and has_function_privilege('service_role', 'public.accept_location_consent()', 'execute')
  and has_function_privilege('authenticated', 'public.revoke_location_consent()', 'execute')
  and has_function_privilege('service_role', 'public.revoke_location_consent()', 'execute')
  and not has_function_privilege('anon', 'public.accept_location_consent()', 'execute')
  and not has_function_privilege('anon', 'public.revoke_location_consent()', 'execute'),
  'consentimiento: execute para authenticated y service_role, no para anon'
);
select ok(
  has_function_privilege('authenticated', 'public.client_service_summary(uuid, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.client_service_summary(uuid, date, date)', 'execute'),
  'client_service_summary conserva sus permisos (authenticated sí, anon no)'
);

-- Resumen: validación por ubicación ---------------------------------------------------------------

select tests.as_user('test-db056-admin@example.com');

create temp table res as
select public.client_service_summary('e5600000-0000-0000-0000-000000000001', app.today(), app.today()) as r;
grant all on res to authenticated;

create temp table emps as
select e as emp
from res, jsonb_array_elements(r -> 'shifts' -> 0 -> 'employees') e;
grant all on emps to authenticated;

select is((select count(*)::int from emps), 4, 'resumen: el turno trae las cuatro asignaciones');

select results_eq(
  $$select emp ->> 'check_in_geo_status', emp ->> 'check_in_distance_m', emp ->> 'check_in_geo_overridden',
           emp ->> 'check_out_geo_status', emp ->> 'check_out_distance_m', emp ->> 'check_out_geo_overridden'
    from emps where emp ->> 'last_name' = 'Valida'$$,
  $$values ('valid'::text, '11'::text, 'false'::text, 'outside'::text, '350'::text, 'false'::text)$$,
  'resumen: fichaje válido en el inicio y fuera de zona (350 m) en el fin'
);
select results_eq(
  $$select emp ->> 'check_in_geo_status', emp ->> 'check_in_distance_m', emp ->> 'check_in_geo_overridden'
    from emps where emp ->> 'last_name' = 'Fuera'$$,
  $$values ('outside'::text, '1250'::text, 'false'::text)$$,
  'resumen: inicio fuera de zona con la distancia'
);
select ok(
  (select emp -> 'check_out_geo_status' = 'null'::jsonb and emp -> 'check_out_distance_m' = 'null'::jsonb
          and emp -> 'check_out_geo_overridden' = 'false'::jsonb
   from emps where emp ->> 'last_name' = 'Fuera'),
  'resumen: sin fin, estado y distancia de check_out_* son null y overridden es false'
);
select results_eq(
  $$select emp ->> 'check_in_geo_status', emp ->> 'check_in_geo_overridden'
    from emps where emp ->> 'last_name' = 'Corregida'$$,
  $$values ('outside'::text, 'true'::text)$$,
  'resumen: el override queda marcado (el front muestra «Validado (corregido)»)'
);
select ok(
  (select emp -> 'check_in_geo_status' = 'null'::jsonb and emp -> 'check_in_distance_m' = 'null'::jsonb
          and emp -> 'check_in_geo_overridden' = 'false'::jsonb and emp -> 'check_in_geo_reason' = 'null'::jsonb
   from emps where emp ->> 'last_name' = 'SinInicio'),
  'resumen: sin inicio, estado, motivo y distancia son null y overridden es false'
);
select ok(
  (select bool_and(emp ? 'check_in_geo_reason' and emp ? 'check_out_geo_reason') from emps),
  'resumen: cada empleado trae las claves de motivo de inicio y de fin'
);
select is(
  (select count(*)::int from emps, jsonb_object_keys(emp) k
   where k ~* '(latitude|longitude|lat|lng|accuracy)'),
  0,
  'resumen: ningún empleado trae claves de coordenadas ni de precisión'
);
select is(
  (select array_agg(distinct k order by k) from res, jsonb_object_keys(r -> 'shifts' -> 0) k
   where k ~* '(latitude|longitude|lat|lng|accuracy)'),
  null::text[],
  'resumen: el turno tampoco trae coordenadas'
);
select ok(
  (select r::text !~* '(latitude|longitude|accuracy)' from res),
  'resumen: el jsonb completo no menciona latitud, longitud ni precisión'
);
select ok(
  (select (r -> 'totals' ->> 'shifts_done')::int = 1 and (r -> 'totals' ->> 'employees_count')::int = 3 from res),
  'resumen: los totales previos no cambiaron (1 turno, 3 empleados con inicio)'
);

select tests.as_user('test-db056-owner@example.com');
select is(
  jsonb_array_length(public.client_service_summary('e5600000-0000-0000-0000-000000000001', app.today(), app.today()) -> 'shifts' -> 0 -> 'employees'),
  4,
  'resumen: el dueño también puede consultarlo'
);

select tests.as_user('test-db056-super@example.com');
select is(
  tests.err_hint($$select public.client_service_summary('e5600000-0000-0000-0000-000000000001', app.today(), app.today())$$),
  'FORBIDDEN',
  'resumen: el supervisor no lo consulta (FORBIDDEN)'
);
select tests.as_user('test-db056-emp-a@example.com');
select is(
  tests.err_hint($$select public.client_service_summary('e5600000-0000-0000-0000-000000000001', app.today(), app.today())$$),
  'FORBIDDEN',
  'resumen: el empleado no lo consulta (FORBIDDEN)'
);

-- Consentimiento ----------------------------------------------------------------------------------

-- Preparación sin sesión: con los claims del último as_user, el guardia de profiles (0030) frena
-- el cambio de location_consent_at de otra persona.
set local role postgres;
select set_config('request.jwt.claims', '', true);
update public.profiles set location_consent_at = '2020-01-01T00:00:00Z'
where id = 'e5600000-0000-0000-0000-000000000092';
update public.profiles set location_consent_at = null
where id = 'e5600000-0000-0000-0000-000000000091';

select tests.as_user('test-db056-emp-a@example.com');
select is(
  public.accept_location_consent(),
  now(),
  'accept_location_consent devuelve la hora del servidor (now())'
);
set local role postgres;
select is(
  (select location_consent_at from public.profiles where id = 'e5600000-0000-0000-0000-000000000091'),
  now(),
  'el consentimiento guardado es la hora del servidor'
);
select is(
  (select location_consent_at from public.profiles where id = 'e5600000-0000-0000-0000-000000000092'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'no toca el perfil de otra persona'
);
-- 0057: la RPC no toca updated_by (el guardia de perfil propio lo bloquea para quien no es admin).
select tests.as_user('test-db056-super@example.com');
select lives_ok($$select public.accept_location_consent()$$, 'accept_location_consent corre para el supervisor (0057)');
set local role postgres;
select set_config('request.jwt.claims', '', true);

select tests.as_user('test-db056-emp-a@example.com');
select lives_ok($$select public.revoke_location_consent()$$, 'revoke_location_consent corre para el empleado');
set local role postgres;
select is(
  (select location_consent_at from public.profiles where id = 'e5600000-0000-0000-0000-000000000091'),
  null::timestamptz,
  'revoke_location_consent deja null el consentimiento propio'
);
select is(
  (select location_consent_at from public.profiles where id = 'e5600000-0000-0000-0000-000000000092'),
  '2020-01-01T00:00:00Z'::timestamptz,
  'revocar tampoco toca a otra persona'
);

-- Cualquier rol con sesión lo hace sobre sí mismo.
select tests.as_user('test-db056-super@example.com');
select lives_ok($$select public.accept_location_consent()$$, 'el supervisor acepta su propio consentimiento');
select tests.as_user('test-db056-admin@example.com');
select lives_ok($$select public.accept_location_consent()$$, 'el administrador acepta su propio consentimiento');
set local role postgres;
select is(
  (select count(*)::int from public.profiles
   where id in ('e5600000-0000-0000-0000-000000000082', 'e5600000-0000-0000-0000-000000000084')
     and location_consent_at = now()),
  2,
  'supervisor y administrador quedaron con su propia hora de servidor'
);

-- Sin claims de usuario (auth.uid() nulo) no hay a quién guardarle el consentimiento.
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select is(
  tests.err_hint($$select public.accept_location_consent()$$),
  'FORBIDDEN',
  'sin usuario en el JWT: FORBIDDEN'
);
set local role postgres;

-- anon: sin permiso de ejecución.
set local role anon;
select is(
  tests.err_hint($$select public.accept_location_consent()$$),
  '42501',
  'anon: permission denied al aceptar el consentimiento'
);
set local role postgres;

select * from finish();

rollback;
