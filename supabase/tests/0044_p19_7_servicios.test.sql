-- pgTAP de la migración 0044_p19_7_servicios.sql (P19.7 paquete B):
--   - AJ3-05: services.weeks_of_month (check), app.date_matches_weeks_of_month y generate_shifts.
--   - AJ3-01: service_delete_preview y delete_service (permisos, bloqueos, borrado completo,
--     auditoría).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4400000-...'. Meses de prueba: 2199-04 (lunes 1, 8, 15, 22 y 29) y 2199-05
-- (lunes 6, 13, 20 y 27), fuera del uso real.

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

select plan(56);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'services', 'weeks_of_month', 'services.weeks_of_month existe');
select col_type_is('public', 'services', 'weeks_of_month', 'smallint[]', 'weeks_of_month es smallint[]');
select col_is_null('public', 'services', 'weeks_of_month', 'weeks_of_month admite null (todas las semanas)');
select has_function('app', 'date_matches_weeks_of_month', array['date', 'smallint[]'], 'existe app.date_matches_weeks_of_month');
select has_function('public', 'service_delete_preview', array['uuid'], 'existe service_delete_preview(uuid)');
select has_function('public', 'delete_service', array['uuid'], 'existe delete_service(uuid)');
select ok(
  not has_function_privilege('anon', 'public.delete_service(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.service_delete_preview(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.delete_service(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.service_delete_preview(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'app.service_delete_blockers(uuid)', 'execute'),
  'grants: las dos RPC para authenticated, no para anon; el helper interno no se llama desde afuera'
);

-- app.date_matches_weeks_of_month ----------------------------------------------------------------

select is(app.date_matches_weeks_of_month(date '2199-04-15', null), true, 'null = todas las semanas');
select is(app.date_matches_weeks_of_month(date '2199-04-01', array[1]::smallint[]), true, 'día 1 es la 1.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-07', array[1]::smallint[]), true, 'día 7 sigue siendo la 1.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-08', array[1]::smallint[]), false, 'día 8 no es la 1.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-08', array[2]::smallint[]), true, 'día 8 es la 2.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-15', array[3]::smallint[]), true, 'día 15 es la 3.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-22', array[4]::smallint[]), true, 'día 22 es la 4.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-29', array[4]::smallint[]), false, 'día 29 (5.ª ocurrencia) no es la 4.ª');
select is(app.date_matches_weeks_of_month(date '2199-04-29', array[5]::smallint[]), true, 'día 29 es la última');
select is(app.date_matches_weeks_of_month(date '2199-04-22', array[5]::smallint[]), false, 'día 22 no es la última si hay un 29');
select is(app.date_matches_weeks_of_month(date '2199-05-27', array[5]::smallint[]), true, 'día 27 de mayo (4.ª) es también la última');
select is(app.date_matches_weeks_of_month(date '2199-05-27', array[4]::smallint[]), true, 'día 27 de mayo es la 4.ª');
select is(app.date_matches_weeks_of_month(date '2199-02-22', array[5]::smallint[]), true, 'febrero de 28 días: el 22 es la última');
select is(app.date_matches_weeks_of_month(date '2199-04-15', array[1, 5]::smallint[]), false, 'varias semanas: el 15 no está en {1, última}');

-- Check de la columna: se prueba como la base, insertando como postgres
insert into public.clients (id, legal_name, status) values
  ('f4400000-0000-0000-0000-000000000001', 'Cliente de servicios 0044', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('f4400000-0000-0000-0000-000000000011', 'f4400000-0000-0000-0000-000000000001', 'Sede de servicios 0044', 'Dirección 1', 'active');

prepare w_vacio as insert into public.services (client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from)
  values ('f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'x', array[1]::smallint[], '{}'::smallint[], '08:00', '12:00', '2199-01-01');
select throws_ok('w_vacio', '23514', null, 'weeks_of_month vacío no se permite');
prepare w_cero as insert into public.services (client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from)
  values ('f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'x', array[1]::smallint[], array[0]::smallint[], '08:00', '12:00', '2199-01-01');
select throws_ok('w_cero', '23514', null, 'weeks_of_month con 0 no se permite');
prepare w_seis as insert into public.services (client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from)
  values ('f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'x', array[1]::smallint[], array[6]::smallint[], '08:00', '12:00', '2199-01-01');
select throws_ok('w_seis', '23514', null, 'weeks_of_month con 6 no se permite');
prepare w_repetido as insert into public.services (client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from)
  values ('f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'x', array[1]::smallint[], array[1, 1]::smallint[], '08:00', '12:00', '2199-01-01');
select throws_ok('w_repetido', '23514', null, 'weeks_of_month con repetidos no se permite');

-- Fixtures de usuarios -------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4400000-0000-0000-0000-000000000081', 'test-db044-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Servicios')),
  ('f4400000-0000-0000-0000-000000000082', 'test-db044-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f4400000-0000-0000-0000-000000000083', 'test-db044-admin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCapacidad')),
  ('f4400000-0000-0000-0000-000000000084', 'test-db044-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f4400000-0000-0000-0000-000000000085', 'test-db044-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('f4400000-0000-0000-0000-000000000091', 'test-db044-ea@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Libre'));

insert into public.user_roles (profile_id, role) values
  ('f4400000-0000-0000-0000-000000000081', 'owner'),
  ('f4400000-0000-0000-0000-000000000082', 'admin'),
  ('f4400000-0000-0000-0000-000000000083', 'admin'),
  ('f4400000-0000-0000-0000-000000000084', 'supervisor'),
  ('f4400000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f4400000-0000-0000-0000-000000000083', 'generate_shifts', true);

insert into public.employees (profile_id, dni, status) values
  ('f4400000-0000-0000-0000-000000000084', '94400084', 'active'),
  ('f4400000-0000-0000-0000-000000000085', '94400085', 'active'),
  ('f4400000-0000-0000-0000-000000000091', '94400091', 'active');

-- generate_shifts con semanas del mes ------------------------------------------------------------
-- Lunes de abril de 2199: 1, 8, 15, 22 y 29.

insert into public.services (id, client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from) values
  ('f4400000-0000-0000-0000-000000000021', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'Todas las semanas', array[1]::smallint[], null, '08:00', '12:00', '2199-01-01'),
  ('f4400000-0000-0000-0000-000000000022', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'Primer y último lunes', array[1]::smallint[], array[1, 5]::smallint[], '08:00', '12:00', '2199-01-01'),
  ('f4400000-0000-0000-0000-000000000023', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'Segundo y cuarto lunes', array[1]::smallint[], array[2, 4]::smallint[], '08:00', '12:00', '2199-01-01');

select tests.as_user('test-db044-admin-cap@example.com');
select set_config('t.g1', public.generate_shifts(2199, 4)::text, true);

select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000021'),
  array['2199-04-01', '2199-04-08', '2199-04-15', '2199-04-22', '2199-04-29'],
  'generate_shifts: weeks_of_month null genera todos los lunes (comportamiento de siempre)'
);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000022'),
  array['2199-04-01', '2199-04-29'],
  'generate_shifts: {1, 5} genera el primer y el último lunes'
);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000023'),
  array['2199-04-08', '2199-04-22'],
  'generate_shifts: {2, 4} genera el segundo y el cuarto lunes'
);

-- Idempotencia: volver a generar no duplica ni agrega.
select public.generate_shifts(2199, 4);
select is(
  (select count(*)::int from public.shifts where service_id in ('f4400000-0000-0000-0000-000000000021', 'f4400000-0000-0000-0000-000000000022', 'f4400000-0000-0000-0000-000000000023')),
  9,
  'generate_shifts: idempotente (5 + 2 + 2 turnos)'
);

-- Mayo: el 27 es la 4.ª y también la última; un servicio {4, 5} lo genera una sola vez.
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, weeks_of_month, start_time, end_time, valid_from) values
  ('f4400000-0000-0000-0000-000000000024', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'Cuarto y último', array[1]::smallint[], array[4, 5]::smallint[], '08:00', '12:00', '2199-01-01');
select tests.as_user('test-db044-admin-cap@example.com');
select public.generate_shifts(2199, 5);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000024'),
  array['2199-05-27'],
  'generate_shifts: si la 4.ª coincide con la última, un solo turno'
);

-- Editar el servicio no toca los turnos ya generados.
set local role postgres;
update public.services set weeks_of_month = array[3]::smallint[] where id = 'f4400000-0000-0000-0000-000000000022';
select is(
  (select count(*)::int from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000022'),
  2,
  'editar weeks_of_month no toca los turnos ya generados'
);

-- Servicio y turnos para borrar -------------------------------------------------------------------
-- D1: se puede borrar (3 turnos, 1 asignación, tareas, observación, empleado fijo).
-- D2: con fichaje. D3: con supervisión. D4: con aviso de asistencia.

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, required_staff) values
  ('f4400000-0000-0000-0000-000000000031', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D1 borrable', array[2]::smallint[], '08:00', '12:00', '2199-01-01', 2),
  ('f4400000-0000-0000-0000-000000000032', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D2 con fichaje', array[2]::smallint[], '08:00', '12:00', '2199-01-01', 1),
  ('f4400000-0000-0000-0000-000000000033', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D3 con supervisión', array[2]::smallint[], '08:00', '12:00', '2199-01-01', 1),
  ('f4400000-0000-0000-0000-000000000034', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D4 con aviso', array[2]::smallint[], '08:00', '12:00', '2199-01-01', 1);

insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f4400000-0000-0000-0000-000000000101', 'f4400000-0000-0000-0000-000000000031', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-01', '08:00', '12:00', 2, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000102', 'f4400000-0000-0000-0000-000000000031', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-08', '08:00', '12:00', 2, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000103', 'f4400000-0000-0000-0000-000000000031', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-15', '08:00', '12:00', 2, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000201', 'f4400000-0000-0000-0000-000000000032', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-01', '13:00', '17:00', 1, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000202', 'f4400000-0000-0000-0000-000000000032', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-08', '08:00', '12:00', 1, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000301', 'f4400000-0000-0000-0000-000000000033', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-01', '08:00', '12:00', 1, 'scheduled'),
  ('f4400000-0000-0000-0000-000000000401', 'f4400000-0000-0000-0000-000000000034', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', '2199-06-01', '18:00', '22:00', 1, 'scheduled');

update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f4400000-0000-0000-0000-000000000081', cancel_reason = 'Prueba 0044'
  where id = 'f4400000-0000-0000-0000-000000000103';

insert into public.assignments (id, shift_id, employee_id) values
  ('f4400000-0000-0000-0000-000000000111', 'f4400000-0000-0000-0000-000000000101', 'f4400000-0000-0000-0000-000000000091'),
  ('f4400000-0000-0000-0000-000000000211', 'f4400000-0000-0000-0000-000000000201', 'f4400000-0000-0000-0000-000000000091'),
  ('f4400000-0000-0000-0000-000000000411', 'f4400000-0000-0000-0000-000000000401', 'f4400000-0000-0000-0000-000000000091');

insert into public.shift_tasks (shift_id, position, title, is_required) values
  ('f4400000-0000-0000-0000-000000000101', 1, 'Barrer', true),
  ('f4400000-0000-0000-0000-000000000101', 2, 'Trapear', false),
  ('f4400000-0000-0000-0000-000000000102', 1, 'Barrer', true);

insert into public.shift_observations (shift_id, observation) values
  ('f4400000-0000-0000-0000-000000000102', 'Observación de prueba');

insert into public.service_fixed_employees (service_id, employee_id) values
  ('f4400000-0000-0000-0000-000000000031', 'f4400000-0000-0000-0000-000000000091');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f4400000-0000-0000-0000-000000000211', 'check_in', now(), 'employee_app');

insert into public.supervisions (shift_id, supervisor_id) values
  ('f4400000-0000-0000-0000-000000000301', 'f4400000-0000-0000-0000-000000000084');

insert into public.attendance_notices (assignment_id, kind, reason_code, source) values
  ('f4400000-0000-0000-0000-000000000411', 'absence', 'illness', 'employee_app');

-- Permisos ---------------------------------------------------------------------------------------

select tests.as_user('test-db044-empleado@example.com');
prepare prev_emp as select public.service_delete_preview('f4400000-0000-0000-0000-000000000031');
prepare del_emp as select public.delete_service('f4400000-0000-0000-0000-000000000031');
select throws_ok('prev_emp', 'P0001', 'No tenés permiso para hacer esto.', 'preview: un empleado no puede (FORBIDDEN)');
select throws_ok('del_emp', 'P0001', 'No tenés permiso para hacer esto.', 'delete_service: un empleado no puede (FORBIDDEN)');

set local role postgres;
select tests.as_user('test-db044-supervisora@example.com');
select throws_ok('prev_emp', 'P0001', 'No tenés permiso para hacer esto.', 'preview: un supervisor no puede (FORBIDDEN)');
select throws_ok('del_emp', 'P0001', 'No tenés permiso para hacer esto.', 'delete_service: un supervisor no puede (FORBIDDEN)');

set local role postgres;
set local role anon;
select throws_ok('prev_emp', '42501', null, 'preview: anon no tiene permiso de ejecución');
select throws_ok('del_emp', '42501', null, 'delete_service: anon no tiene permiso de ejecución');

-- Vista previa (admin sin capacidades: editar servicios no exige ninguna) -------------------------

set local role postgres;
select tests.as_user('test-db044-admin@example.com');

select is(
  (select public.service_delete_preview('f4400000-0000-0000-0000-000000000031')),
  jsonb_build_object(
    'service_id', 'f4400000-0000-0000-0000-000000000031',
    'service_name', 'D1 borrable',
    'shifts_to_delete', 3,
    'assignments_to_delete', 1,
    'blocking_shifts', '[]'::jsonb,
    'can_delete', true
  ),
  'preview: un admin sin capacidades ve 3 turnos, 1 asignación y nada que bloquee'
);

select is(
  (select public.service_delete_preview('f4400000-0000-0000-0000-000000000032')),
  jsonb_build_object(
    'service_id', 'f4400000-0000-0000-0000-000000000032',
    'service_name', 'D2 con fichaje',
    'shifts_to_delete', 2,
    'assignments_to_delete', 1,
    'blocking_shifts', jsonb_build_array(jsonb_build_object(
      'shift_id', 'f4400000-0000-0000-0000-000000000201', 'shift_date', '2199-06-01', 'reasons', jsonb_build_array('ATTENDANCE_RECORDS'))),
    'can_delete', false
  ),
  'preview: un turno con fichaje bloquea y se informa con su motivo'
);

select is(
  (select public.service_delete_preview('f4400000-0000-0000-0000-000000000033')) -> 'blocking_shifts' -> 0 -> 'reasons',
  '["SUPERVISIONS"]'::jsonb,
  'preview: una supervisión bloquea'
);
select is(
  (select public.service_delete_preview('f4400000-0000-0000-0000-000000000034')) -> 'blocking_shifts' -> 0 -> 'reasons',
  '["ATTENDANCE_NOTICES"]'::jsonb,
  'preview: un aviso de asistencia bloquea'
);

prepare prev_inexistente as select public.service_delete_preview('f4400000-0000-0000-0000-0000000000ff');
select throws_ok('prev_inexistente', 'P0001', 'No encontramos ese servicio.', 'preview: servicio inexistente (SERVICE_NOT_FOUND)');

-- delete_service: bloqueos -----------------------------------------------------------------------

prepare del_d2 as select public.delete_service('f4400000-0000-0000-0000-000000000032');
prepare del_d3 as select public.delete_service('f4400000-0000-0000-0000-000000000033');
prepare del_d4 as select public.delete_service('f4400000-0000-0000-0000-000000000034');
prepare del_inexistente as select public.delete_service('f4400000-0000-0000-0000-0000000000ff');

select throws_ok('del_d2', 'P0001', 'No se puede eliminar: hay turnos de este servicio con fichajes o avisos de asistencia. Dalo de baja en su lugar.', 'delete_service: con fichajes no se borra (SERVICE_HAS_ATTENDANCE)');
select throws_ok('del_d4', 'P0001', 'No se puede eliminar: hay turnos de este servicio con fichajes o avisos de asistencia. Dalo de baja en su lugar.', 'delete_service: con avisos de asistencia no se borra (SERVICE_HAS_ATTENDANCE)');
select throws_ok('del_d3', 'P0001', 'No se puede eliminar: hay turnos de este servicio con supervisiones. Dalo de baja en su lugar.', 'delete_service: con supervisiones no se borra (SERVICE_HAS_SUPERVISIONS)');
select throws_ok('del_inexistente', 'P0001', 'No encontramos ese servicio.', 'delete_service: servicio inexistente (SERVICE_NOT_FOUND)');

select is(
  (select count(*)::int from public.services where id in ('f4400000-0000-0000-0000-000000000032', 'f4400000-0000-0000-0000-000000000033', 'f4400000-0000-0000-0000-000000000034'))
    + (select count(*)::int from public.shifts where service_id in ('f4400000-0000-0000-0000-000000000032', 'f4400000-0000-0000-0000-000000000033', 'f4400000-0000-0000-0000-000000000034')),
  3 + 4,
  'delete_service bloqueado: no se borró nada (3 servicios y 4 turnos intactos)'
);

-- delete_service: borrado completo (admin sin capacidades) --------------------------------------

select set_config('t.d1', public.delete_service('f4400000-0000-0000-0000-000000000031')::text, true);

select is(
  current_setting('t.d1')::jsonb,
  jsonb_build_object('service_id', 'f4400000-0000-0000-0000-000000000031', 'shifts_deleted', 3, 'assignments_deleted', 1),
  'delete_service: informa 3 turnos y 1 asignación borrados'
);

set local role postgres;
select is(
  (select count(*)::int from public.services where id = 'f4400000-0000-0000-0000-000000000031')
    + (select count(*)::int from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000031')
    + (select count(*)::int from public.assignments where id = 'f4400000-0000-0000-0000-000000000111')
    + (select count(*)::int from public.shift_tasks where shift_id in ('f4400000-0000-0000-0000-000000000101', 'f4400000-0000-0000-0000-000000000102'))
    + (select count(*)::int from public.shift_observations where shift_id = 'f4400000-0000-0000-0000-000000000102')
    + (select count(*)::int from public.service_fixed_employees where service_id = 'f4400000-0000-0000-0000-000000000031'),
  0,
  'delete_service: desaparecen el servicio, sus turnos, asignaciones, tareas, observaciones y empleados fijos'
);
select is(
  (select count(*)::int from public.employees where profile_id = 'f4400000-0000-0000-0000-000000000091'),
  1,
  'delete_service: el empleado asignado no se toca'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'f4400000-0000-0000-0000-000000000021'),
  5,
  'delete_service: los turnos de otros servicios no se tocan'
);
select is(
  (select details ->> 'shifts_deleted' from public.security_events
    where event_type = 'service_deleted' and target_id = 'f4400000-0000-0000-0000-000000000031'),
  '3',
  'delete_service: deja el evento service_deleted en security_events'
);
select is(
  (select actor_id from public.security_events
    where event_type = 'service_deleted' and target_id = 'f4400000-0000-0000-0000-000000000031'),
  'f4400000-0000-0000-0000-000000000082'::uuid,
  'delete_service: el evento registra a quien borró'
);

-- Dueño y admin con capacidad también pueden ------------------------------------------------------

set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from) values
  ('f4400000-0000-0000-0000-000000000041', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D5 del dueño', array[3]::smallint[], '08:00', '12:00', '2199-01-01'),
  ('f4400000-0000-0000-0000-000000000042', 'f4400000-0000-0000-0000-000000000001', 'f4400000-0000-0000-0000-000000000011', 'D6 del admin con capacidad', array[3]::smallint[], '08:00', '12:00', '2199-01-01');

select tests.as_user('test-db044-owner@example.com');
select is(
  (select public.delete_service('f4400000-0000-0000-0000-000000000041') ->> 'shifts_deleted'),
  '0',
  'delete_service: el dueño puede (servicio sin turnos)'
);
set local role postgres;
select tests.as_user('test-db044-admin-cap@example.com');
select is(
  (select public.service_delete_preview('f4400000-0000-0000-0000-000000000042') ->> 'can_delete'),
  'true',
  'preview: un admin con capacidades puede'
);
select is(
  (select public.delete_service('f4400000-0000-0000-0000-000000000042') ->> 'service_id'),
  'f4400000-0000-0000-0000-000000000042',
  'delete_service: un admin con capacidades puede'
);

select * from finish();

rollback;
