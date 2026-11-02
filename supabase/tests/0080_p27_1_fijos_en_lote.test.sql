-- pgTAP de la migración 0080_p27_1_fijos_en_lote.sql (P27.1, OD-11).
--   assignments.from_fixed (lo marca el trigger al asignar a un fijo del servicio) y
--   apply_service_fixed_employees(service_id, from_date): quita los fijos anteriores y asigna los
--   nuevos en los turnos del servicio desde la fecha, sin tocar turnos cancelados, empezados o con
--   fichajes, ni a los agregados a mano; informa actualizados y salteados con su motivo.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f8000000-...'. Los turnos son de días futuros salvo el que «ya empezó», que es de
-- hoy a las 00:00 (siempre pasado), así el resultado no depende de la hora a la que corra el CI.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0080;
grant usage on schema tests_0080 to authenticated, anon;

create or replace function tests_0080.as_user(p_email text)
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
    raise exception 'tests_0080.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0080.as_user(text) to authenticated, anon;

create or replace function tests_0080.err_hint(p_sql text)
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

grant execute on function tests_0080.err_hint(text) to authenticated, anon;

select plan(28);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'assignments', 'from_fixed', 'assignments.from_fixed existe');
select col_not_null('public', 'assignments', 'from_fixed', 'assignments.from_fixed es not null');
select col_default_is('public', 'assignments', 'from_fixed', 'false', 'assignments.from_fixed arranca en false');
select has_trigger('public', 'assignments', 'trg_assignments_mark_from_fixed', 'assignments tiene el trigger que marca el origen fijo');
select has_function('public', 'apply_service_fixed_employees', array['uuid', 'date'], 'apply_service_fixed_employees');
select ok(
  not has_function_privilege('anon', 'public.apply_service_fixed_employees(uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.apply_service_fixed_employees(uuid, date)', 'execute'),
  'grants: authenticated sí, anon no'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f8000000-0000-0000-0000-000000000001', 'Cliente fijos 0080', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f8000000-0000-0000-0000-000000000011', 'f8000000-0000-0000-0000-000000000001', 'Sede fijos 0080', 'Dirección 80', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f8000000-0000-0000-0000-000000000081', 'test-db0080-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Ochenta')),
  ('f8000000-0000-0000-0000-000000000082', 'test-db0080-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Ochenta')),
  ('f8000000-0000-0000-0000-000000000091', 'test-db0080-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Ochenta')),
  ('f8000000-0000-0000-0000-0000000000a1', 'test-db0080-a@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Fija Vieja')),
  ('f8000000-0000-0000-0000-0000000000a2', 'test-db0080-b@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Fijo Nuevo')),
  ('f8000000-0000-0000-0000-0000000000a3', 'test-db0080-c@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'A Mano')),
  ('f8000000-0000-0000-0000-0000000000a4', 'test-db0080-d@example.com', jsonb_build_object('first_name', 'Diego', 'last_name', 'De Licencia'));

insert into public.user_roles (profile_id, role) values
  ('f8000000-0000-0000-0000-000000000081', 'owner'),
  ('f8000000-0000-0000-0000-000000000082', 'admin'),
  ('f8000000-0000-0000-0000-000000000091', 'supervisor'),
  ('f8000000-0000-0000-0000-0000000000a1', 'employee'),
  ('f8000000-0000-0000-0000-0000000000a2', 'employee'),
  ('f8000000-0000-0000-0000-0000000000a3', 'employee'),
  ('f8000000-0000-0000-0000-0000000000a4', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f8000000-0000-0000-0000-000000000091', '98000091', 'active'),
  ('f8000000-0000-0000-0000-0000000000a1', '98000101', 'active'),
  ('f8000000-0000-0000-0000-0000000000a2', '98000102', 'active'),
  ('f8000000-0000-0000-0000-0000000000a3', '98000103', 'active'),
  ('f8000000-0000-0000-0000-0000000000a4', '98000104', 'active');

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', 'Servicio fijos 0080', array[1,2,3,4,5]::smallint[], '08:00', '12:00', 3, app.today(), 'active');

-- Fija de antes: Aldana.
insert into public.service_fixed_employees (service_id, employee_id) values
  ('f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-0000000000a1');

-- Turnos:
--   S1 (+3): Aldana (fija) y Camila (a mano).
--   S2 (+4): Aldana con un fichaje -> se saltea.
--   S3 (+5): Aldana; Diego tiene licencia ese día.
--   S4 (+6): cancelado, con Aldana -> se saltea.
--   S5 (hoy 00:00): ya empezó, con Aldana -> se saltea.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f8000000-0000-0000-0000-000000000031', 'f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', app.today() + 3, '08:00', '12:00', 3, 'scheduled'),
  ('f8000000-0000-0000-0000-000000000032', 'f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', app.today() + 4, '08:00', '12:00', 3, 'scheduled'),
  ('f8000000-0000-0000-0000-000000000033', 'f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', app.today() + 5, '08:00', '12:00', 3, 'scheduled'),
  ('f8000000-0000-0000-0000-000000000035', 'f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', app.today(), '00:00', '00:01', 3, 'scheduled');
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f8000000-0000-0000-0000-000000000034', 'f8000000-0000-0000-0000-000000000021', 'f8000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000011', app.today() + 6, '08:00', '12:00', 3, 'cancelled', now(), 'f8000000-0000-0000-0000-000000000081', 'Cancelado de prueba');

insert into public.assignments (id, shift_id, employee_id) values
  ('f8000000-0000-0000-0000-000000000101', 'f8000000-0000-0000-0000-000000000031', 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000102', 'f8000000-0000-0000-0000-000000000031', 'f8000000-0000-0000-0000-0000000000a3'),
  ('f8000000-0000-0000-0000-000000000103', 'f8000000-0000-0000-0000-000000000032', 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000104', 'f8000000-0000-0000-0000-000000000033', 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000105', 'f8000000-0000-0000-0000-000000000034', 'f8000000-0000-0000-0000-0000000000a1'),
  ('f8000000-0000-0000-0000-000000000106', 'f8000000-0000-0000-0000-000000000035', 'f8000000-0000-0000-0000-0000000000a1');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f8000000-0000-0000-0000-000000000103', 'check_in', now(), 'employee_app');

insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f8000000-0000-0000-0000-0000000000a4', app.today() + 5, app.today() + 5, 'Franco');

-- El trigger marcó el origen -------------------------------------------------------------------

select is(
  (select from_fixed from public.assignments where id = 'f8000000-0000-0000-0000-000000000101'),
  true, 'la asignación de Aldana (fija del servicio) quedó marcada from_fixed'
);
select is(
  (select from_fixed from public.assignments where id = 'f8000000-0000-0000-0000-000000000102'),
  false, 'la de Camila (a mano) no'
);

-- Permisos -------------------------------------------------------------------------------------

select tests_0080.as_user('test-db0080-sup@example.com');
select is(tests_0080.err_hint($$select public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', app.today())$$), 'FORBIDDEN', 'un coordinador no aplica fijos');
select tests_0080.as_user('test-db0080-a@example.com');
select is(tests_0080.err_hint($$select public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', app.today())$$), 'FORBIDDEN', 'un empleado no aplica fijos');

-- Se cambian los fijos: sale Aldana, entran Bruno y Diego.
select tests_0080.as_user('test-db0080-admin@example.com');
select lives_ok(
  $$select public.set_service_fixed_employees('f8000000-0000-0000-0000-000000000021', array['f8000000-0000-0000-0000-0000000000a2'::uuid, 'f8000000-0000-0000-0000-0000000000a4'::uuid])$$,
  'se guardan los fijos nuevos'
);
select is(tests_0080.err_hint($$select public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', null)$$), 'FROM_DATE_REQUIRED', 'la fecha es obligatoria');
select is(tests_0080.err_hint($$select public.apply_service_fixed_employees('f8000000-0000-0000-0000-0000000000ff', app.today())$$), 'SERVICE_NOT_FOUND', 'servicio inexistente');

select set_config('tests_0080.r', public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', app.today())::text, true) is not null as aplicado;

select is((select r ->> 'updated_count' from (select current_setting('tests_0080.r')::jsonb as r) res80), '2', 'turnos actualizados: S1 y S3');
select is((select r ->> 'skipped_count' from (select current_setting('tests_0080.r')::jsonb as r) res80), '3', 'turnos salteados: con fichaje, cancelado y ya empezado');
select is((select r ->> 'partial_count' from (select current_setting('tests_0080.r')::jsonb as r) res80), '1', 'un turno quedó parcial: S3, donde Diego tiene licencia');
select is((select r ->> 'assignments_removed' from (select current_setting('tests_0080.r')::jsonb as r) res80), '2', 'se quitaron las asignaciones de Aldana en S1 y S3');
select is((select r ->> 'assignments_added' from (select current_setting('tests_0080.r')::jsonb as r) res80), '3', 'se asignaron Bruno y Diego en S1 y Bruno en S3');
select is(
  (select jsonb_path_query_first(r -> 'skipped', '$[*] ? (@.scope == "employee")') ->> 'code' from (select current_setting('tests_0080.r')::jsonb as r) res80),
  'ON_LEAVE', 'el empleado salteado dice por qué: ON_LEAVE (mismas reglas que la asignación individual)'
);
select is(
  (select jsonb_path_query_first(r -> 'skipped', '$[*] ? (@.scope == "employee")') ->> 'employee_name' from (select current_setting('tests_0080.r')::jsonb as r) res80),
  'Diego De Licencia', 'y trae su nombre'
);
select is(
  (select array_agg(x ->> 'code' order by x ->> 'code') from (select current_setting('tests_0080.r')::jsonb as r) res80, jsonb_array_elements(r -> 'skipped') x where x ->> 'scope' = 'shift'),
  array['HAS_ATTENDANCE', 'SHIFT_CANCELLED', 'SHIFT_STARTED'],
  'los turnos salteados traen su motivo'
);

set local role postgres;
select is(
  (select array_agg(employee_id::text order by employee_id) from public.assignments where shift_id = 'f8000000-0000-0000-0000-000000000031' and removed_at is null),
  array['f8000000-0000-0000-0000-0000000000a2', 'f8000000-0000-0000-0000-0000000000a3', 'f8000000-0000-0000-0000-0000000000a4'],
  'S1: Bruno y Diego (fijos nuevos) y Camila (a mano, intacta)'
);
select is(
  (select removed_reason from public.assignments where id = 'f8000000-0000-0000-0000-000000000101'),
  'Cambio de los empleados fijos del servicio', 'la asignación de Aldana quedó con baja lógica y motivo'
);
select is(
  (select array_agg(employee_id::text order by employee_id) from public.assignments where shift_id = 'f8000000-0000-0000-0000-000000000033' and removed_at is null),
  array['f8000000-0000-0000-0000-0000000000a2'],
  'S3: solo Bruno (Diego tiene licencia)'
);
select is(
  (select count(*)::integer from public.assignments where id in ('f8000000-0000-0000-0000-000000000103', 'f8000000-0000-0000-0000-000000000105', 'f8000000-0000-0000-0000-000000000106') and removed_at is null),
  3, 'los turnos con fichaje, cancelado y empezado conservan a Aldana'
);
select is(
  (select from_fixed from public.assignments where shift_id = 'f8000000-0000-0000-0000-000000000031' and employee_id = 'f8000000-0000-0000-0000-0000000000a2' and removed_at is null),
  true, 'las asignaciones nuevas de Bruno quedan marcadas como fijas'
);

-- Idempotencia: una segunda vez no cambia nada (S3 sigue parcial por la licencia de Diego).
select tests_0080.as_user('test-db0080-owner@example.com');
select is(
  (select (public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', app.today()) ->> 'updated_count')),
  '0', 'aplicar de nuevo no cambia nada'
);
select is(
  (select (public.apply_service_fixed_employees('f8000000-0000-0000-0000-000000000021', app.today() + 5) ->> 'skipped_count')),
  '1', 'la fecha acota los turnos considerados (desde +5 solo S3 y el cancelado S4 que se saltea)'
);

select * from finish();

rollback;
