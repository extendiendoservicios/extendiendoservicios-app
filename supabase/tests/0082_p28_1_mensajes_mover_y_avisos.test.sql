-- pgTAP de la migración 0082_p28_1_observaciones_11_nov.sql (P28.1), parte 2:
--   OF-08  ASSIGNMENT_OVERLAP y ON_LEAVE dicen con qué chocan (mensaje y `detail` del error) en
--          assign_employee, update_shift_time, update_assignment_time, create_shift y generate_shifts.
--   OF-10  move_assignment (pasar a una persona a otro turno, atómico, con el estado anterior).
--   OF-02  service_overlaps y shift_overlaps_in_site.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f82b0000-...'. Fechas de 2199 (el 2199-07-01 es lunes) para no chocar con datos
-- reales y no depender de la hora de la corrida.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0082b;
grant usage on schema tests_0082b to authenticated, anon;

create or replace function tests_0082b.as_user(p_email text)
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
    raise exception 'tests_0082b.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0082b.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0082b.err(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
  v_msg text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('hint', v_hint, 'message', v_msg, 'detail', v_detail, 'state', sqlstate);
end;
$$;

grant execute on function tests_0082b.err(text) to authenticated, anon;

select plan(57);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f82b0000-0000-0000-0000-000000000001', 'Cliente 0082b SA', 'YPF 0082b', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f82b0000-0000-0000-0000-000000000011', 'f82b0000-0000-0000-0000-000000000001', 'YPF RUTA', 'Dirección 82b', -34.6, -58.4, 'active'),
  ('f82b0000-0000-0000-0000-000000000012', 'f82b0000-0000-0000-0000-000000000001', 'Otra sede', 'Dirección 82b bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f82b0000-0000-0000-0000-000000000081', 'test-db0082b-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Dos')),
  ('f82b0000-0000-0000-0000-000000000082', 'test-db0082b-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('f82b0000-0000-0000-0000-000000000091', 'test-db0082b-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Dos')),
  ('f82b0000-0000-0000-0000-0000000000a1', 'test-db0082b-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f82b0000-0000-0000-0000-0000000000a2', 'test-db0082b-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f82b0000-0000-0000-0000-0000000000a3', 'test-db0082b-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera'));

insert into public.user_roles (profile_id, role) values
  ('f82b0000-0000-0000-0000-000000000081', 'owner'),
  ('f82b0000-0000-0000-0000-000000000082', 'admin'),
  ('f82b0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f82b0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f82b0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f82b0000-0000-0000-0000-0000000000a3', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f82b0000-0000-0000-0000-000000000091', '98202091', 'active'),
  ('f82b0000-0000-0000-0000-0000000000a1', '98202101', 'active'),
  ('f82b0000-0000-0000-0000-0000000000a2', '98202102', 'active'),
  ('f82b0000-0000-0000-0000-0000000000a3', '98202103', 'active');

-- Servicio «YPF RUTA TURNO TARDE»: lunes 15 a 17; uno pausado en el mismo horario y uno de martes.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f82b0000-0000-0000-0000-000000000021', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', 'YPF RUTA TURNO TARDE', array[1]::smallint[], '15:00', '17:00', 1, '2199-01-01', 'active'),
  ('f82b0000-0000-0000-0000-000000000022', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', 'Pausado mismo horario', array[1]::smallint[], '15:00', '17:00', 1, '2199-01-01', 'paused'),
  ('f82b0000-0000-0000-0000-000000000023', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', 'Solo martes', array[2]::smallint[], '15:00', '17:00', 1, '2199-01-01', 'active'),
  ('f82b0000-0000-0000-0000-000000000024', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000012', 'Otra sede lunes', array[1]::smallint[], '15:00', '17:00', 1, '2199-01-01', 'active');

-- Turnos del lunes 2199-07-01 en YPF RUTA: el del servicio (15 a 17, con Acosta), uno manual de
-- 16 a 18 y uno manual de 9 a 10 con Cabrera.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f82b0000-0000-0000-0000-000000000031', 'f82b0000-0000-0000-0000-000000000021', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-01', '15:00', '17:00', 1, 'assigned', true),
  ('f82b0000-0000-0000-0000-000000000032', null, 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-01', '16:00', '18:00', 2, 'scheduled', false),
  ('f82b0000-0000-0000-0000-000000000033', null, 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-01', '09:00', '10:00', 1, 'assigned', false),
  ('f82b0000-0000-0000-0000-000000000034', null, 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-01', '09:30', '11:00', 1, 'scheduled', false);

insert into public.assignments (id, shift_id, employee_id) values
  ('f82b0000-0000-0000-0000-000000000101', 'f82b0000-0000-0000-0000-000000000031', 'f82b0000-0000-0000-0000-0000000000a1'),
  ('f82b0000-0000-0000-0000-000000000102', 'f82b0000-0000-0000-0000-000000000033', 'f82b0000-0000-0000-0000-0000000000a3');

-- Licencia de Boutter del 3 al 10/7 y turno del 5/7.
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f82b0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10', 'Vacaciones');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82b0000-0000-0000-0000-000000000035', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-05', '09:00', '10:00', 1, 'scheduled');

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'move_assignment', array['uuid', 'uuid', 'time', 'time'], 'move_assignment');
select has_function('public', 'service_overlaps', array['uuid', 'smallint[]', 'time', 'time', 'uuid'], 'service_overlaps');
select has_function('public', 'shift_overlaps_in_site', array['uuid', 'date', 'time', 'time', 'uuid'], 'shift_overlaps_in_site');
select ok(
  not has_function_privilege('anon', 'public.move_assignment(uuid, uuid, time, time)', 'execute')
  and has_function_privilege('authenticated', 'public.move_assignment(uuid, uuid, time, time)', 'execute')
  and not has_function_privilege('authenticated', 'app.overlap_conflict(uuid, timestamptz, timestamptz, uuid)', 'execute'),
  'grants: las RPC solo para authenticated; las ayudas internas de app no'
);

-- OF-08: assign_employee -------------------------------------------------------------------------

select tests_0082b.as_user('test-db0082b-admin@example.com');

select set_config('tests_0082b.e1', tests_0082b.err($$select public.assign_employee('f82b0000-0000-0000-0000-000000000032', 'f82b0000-0000-0000-0000-0000000000a1')$$)::text, true) is not null as e1;
select is((select current_setting('tests_0082b.e1')::jsonb ->> 'hint'), 'ASSIGNMENT_OVERLAP', 'asignar a Acosta a un turno que se pisa: ASSIGNMENT_OVERLAP');
select is(
  (select current_setting('tests_0082b.e1')::jsonb ->> 'message'),
  'Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 1/7 de 15:00 a 17:00.',
  'el mensaje dice dónde está: sede, servicio, día y horario'
);
select is(
  (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'conflict_shift_id'),
  'f82b0000-0000-0000-0000-000000000031', 'el detalle trae el turno con el que choca'
);
select is(
  (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'site_name'),
  'YPF RUTA', 'el detalle trae la sede'
);
select is(
  (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'service_name'),
  'YPF RUTA TURNO TARDE', 'el detalle trae el servicio'
);
select is(
  (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'shift_date'),
  '2199-07-01', 'el detalle trae la fecha'
);
select is(
  (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'start_time') || '-' || (select ((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) ->> 'end_time'),
  '15:00:00-17:00:00', 'el detalle trae el horario'
);
select is(
  (select jsonb_array_length(((current_setting('tests_0082b.e1')::jsonb ->> 'detail')::jsonb) -> 'conflicts')),
  1, 'y la lista de choques'
);

select is(
  tests_0082b.err($$select public.assign_employee('f82b0000-0000-0000-0000-000000000034', 'f82b0000-0000-0000-0000-0000000000a3')$$) ->> 'message',
  'Cabrera ya está en YPF RUTA (turno manual) el lun 1/7 de 09:00 a 10:00.',
  'un turno sin servicio se nombra «turno manual»'
);

select set_config('tests_0082b.e2', tests_0082b.err($$select public.assign_employee('f82b0000-0000-0000-0000-000000000035', 'f82b0000-0000-0000-0000-0000000000a2')$$)::text, true) is not null as e2;
select is((select current_setting('tests_0082b.e2')::jsonb ->> 'hint'), 'ON_LEAVE', 'asignar a alguien de licencia: ON_LEAVE');
select is(
  (select current_setting('tests_0082b.e2')::jsonb ->> 'message'),
  'Boutter tiene licencia (Vacaciones) del 3 al 10/7.',
  'el mensaje dice el motivo y el rango de la licencia'
);
select is(
  (select ((current_setting('tests_0082b.e2')::jsonb ->> 'detail')::jsonb) -> 'leaves' -> 0 ->> 'reason'),
  'Vacaciones', 'el detalle trae la licencia'
);

-- OF-08: update_shift_time y update_assignment_time ----------------------------------------------

set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82b0000-0000-0000-0000-000000000036', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-08', '08:00', '09:00', 1, 'assigned'),
  ('f82b0000-0000-0000-0000-000000000037', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-08', '10:00', '11:00', 1, 'assigned'),
  ('f82b0000-0000-0000-0000-000000000038', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-15', '13:00', '15:00', 2, 'assigned'),
  ('f82b0000-0000-0000-0000-000000000039', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-15', '14:00', '15:00', 1, 'assigned');
insert into public.assignments (id, shift_id, employee_id, start_time, end_time) values
  ('f82b0000-0000-0000-0000-000000000103', 'f82b0000-0000-0000-0000-000000000036', 'f82b0000-0000-0000-0000-0000000000a1', null, null),
  ('f82b0000-0000-0000-0000-000000000104', 'f82b0000-0000-0000-0000-000000000037', 'f82b0000-0000-0000-0000-0000000000a1', null, null),
  ('f82b0000-0000-0000-0000-000000000105', 'f82b0000-0000-0000-0000-000000000038', 'f82b0000-0000-0000-0000-0000000000a1', '13:00', '14:00'),
  ('f82b0000-0000-0000-0000-000000000106', 'f82b0000-0000-0000-0000-000000000039', 'f82b0000-0000-0000-0000-0000000000a1', null, null);

select tests_0082b.as_user('test-db0082b-admin@example.com');

select set_config('tests_0082b.e3', tests_0082b.err($$select public.update_shift_time('f82b0000-0000-0000-0000-000000000036', '08:00', '10:30')$$)::text, true) is not null as e3;
select is((select current_setting('tests_0082b.e3')::jsonb ->> 'hint'), 'ASSIGNMENT_OVERLAP', 'update_shift_time: alargar el turno hasta pisar otro: ASSIGNMENT_OVERLAP');
select is(
  (select current_setting('tests_0082b.e3')::jsonb ->> 'message'),
  'Acosta ya está en YPF RUTA (turno manual) el lun 8/7 de 10:00 a 11:00.',
  'update_shift_time: el mensaje dice con qué choca'
);
select is(
  (select ((current_setting('tests_0082b.e3')::jsonb ->> 'detail')::jsonb) ->> 'conflict_shift_id'),
  'f82b0000-0000-0000-0000-000000000037', 'update_shift_time: el detalle trae el turno del choque'
);

select set_config('tests_0082b.e4', tests_0082b.err($$select public.update_assignment_time('f82b0000-0000-0000-0000-000000000105', '13:00', '14:30')$$)::text, true) is not null as e4;
select is((select current_setting('tests_0082b.e4')::jsonb ->> 'hint'), 'ASSIGNMENT_OVERLAP', 'update_assignment_time: ASSIGNMENT_OVERLAP');
select is(
  (select current_setting('tests_0082b.e4')::jsonb ->> 'message'),
  'Acosta ya está en YPF RUTA (turno manual) el lun 15/7 de 14:00 a 15:00.',
  'update_assignment_time: el mensaje dice con qué choca'
);

-- Fecha nueva con licencia: update_shift_time(p_date) nombra a quien está de licencia.
set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82b0000-0000-0000-0000-00000000003a', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-22', '09:00', '10:00', 1, 'assigned');
insert into public.assignments (id, shift_id, employee_id) values
  ('f82b0000-0000-0000-0000-000000000107', 'f82b0000-0000-0000-0000-00000000003a', 'f82b0000-0000-0000-0000-0000000000a2');
select tests_0082b.as_user('test-db0082b-admin@example.com');
select is(
  tests_0082b.err($$select public.update_shift_time('f82b0000-0000-0000-0000-00000000003a', '09:00', '10:00', false, '2199-07-06')$$) ->> 'message',
  'Boutter tiene licencia (Vacaciones) del 3 al 10/7.',
  'update_shift_time: mover de día a una fecha con licencia dice el motivo y el rango'
);

-- OF-08: create_shift con empleados y generate_shifts ---------------------------------------------

select set_config(
  'tests_0082b.r1',
  public.create_shift(
    'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-07-01',
    '15:30', '16:30', 1::smallint, null, null, false, true,
    array['f82b0000-0000-0000-0000-0000000000a1'::uuid]
  )::text,
  true
) is not null as creado;
select is((select current_setting('tests_0082b.r1')::jsonb -> 'rejected' -> 0 ->> 'code'), 'ASSIGNMENT_OVERLAP', 'create_shift: el empleado superpuesto queda en rejected');
select is(
  (select current_setting('tests_0082b.r1')::jsonb -> 'rejected' -> 0 ->> 'message'),
  'Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 1/7 de 15:00 a 17:00.',
  'create_shift: el rechazo dice con qué choca'
);
select is(
  (select current_setting('tests_0082b.r1')::jsonb -> 'rejected' -> 0 -> 'detail' ->> 'conflict_shift_id'),
  'f82b0000-0000-0000-0000-000000000031', 'create_shift: el rechazo trae el detalle con el turno del choque'
);

-- Generación de septiembre (el 2199-09-10 es martes): el fijo Acosta tiene un turno manual ese día.
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f82b0000-0000-0000-0000-000000000025', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000012', 'Servicio generado', array[2]::smallint[], '09:00', '10:00', 1, '2199-09-01', 'active');
insert into public.service_fixed_employees (service_id, employee_id) values
  ('f82b0000-0000-0000-0000-000000000025', 'f82b0000-0000-0000-0000-0000000000a1');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82b0000-0000-0000-0000-00000000003b', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-09-10', '09:00', '10:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('f82b0000-0000-0000-0000-000000000108', 'f82b0000-0000-0000-0000-00000000003b', 'f82b0000-0000-0000-0000-0000000000a1');

select tests_0082b.as_user('test-db0082b-owner@example.com');
select set_config('tests_0082b.g', public.generate_shifts(2199, 9, 'f82b0000-0000-0000-0000-000000000025')::text, true) is not null as generado;
select is((select current_setting('tests_0082b.g')::jsonb ->> 'created'), '4', 'generate_shifts: crea los cuatro martes');
select is((select current_setting('tests_0082b.g')::jsonb ->> 'assigned'), '3', 'y asigna al fijo en los que puede');
select is((select current_setting('tests_0082b.g')::jsonb -> 'unassigned' -> 0 ->> 'code'), 'ASSIGNMENT_OVERLAP', 'el día que se pisa queda en unassigned');
select is(
  (select current_setting('tests_0082b.g')::jsonb -> 'unassigned' -> 0 ->> 'message'),
  'Acosta ya está en YPF RUTA (turno manual) el mar 10/9 de 09:00 a 10:00.',
  'generate_shifts: el mensaje dice con qué choca'
);
select is(
  (select current_setting('tests_0082b.g')::jsonb -> 'unassigned' -> 0 -> 'detail' ->> 'conflict_shift_id'),
  'f82b0000-0000-0000-0000-00000000003b', 'generate_shifts: unassigned trae el detalle con el turno del choque'
);
select is(
  (select current_setting('tests_0082b.g')::jsonb ? 'created_shifts'),
  false, 'generate_shifts no expone el listado interno created_shifts'
);

-- OF-10: move_assignment ----------------------------------------------------------------------------

set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82b0000-0000-0000-0000-000000000051', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-10-01', '09:00', '11:00', 1, 'assigned'),
  ('f82b0000-0000-0000-0000-000000000052', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-10-01', '12:00', '14:00', 1, 'scheduled'),
  ('f82b0000-0000-0000-0000-000000000053', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-10-01', '12:30', '13:00', 1, 'assigned'),
  ('f82b0000-0000-0000-0000-000000000054', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-10-01', '15:00', '16:00', 1, 'scheduled'),
  ('f82b0000-0000-0000-0000-000000000055', 'f82b0000-0000-0000-0000-000000000001', 'f82b0000-0000-0000-0000-000000000011', '2199-10-01', '17:00', '18:00', 1, 'assigned');
insert into public.assignments (id, shift_id, employee_id) values
  ('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000051', 'f82b0000-0000-0000-0000-0000000000a3'),
  ('f82b0000-0000-0000-0000-000000000122', 'f82b0000-0000-0000-0000-000000000053', 'f82b0000-0000-0000-0000-0000000000a3'),
  ('f82b0000-0000-0000-0000-000000000123', 'f82b0000-0000-0000-0000-000000000055', 'f82b0000-0000-0000-0000-0000000000a2');

select tests_0082b.as_user('test-db0082b-sup@example.com');
select is(tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000054')$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no mueve asignaciones');
select tests_0082b.as_user('test-db0082b-a3@example.com');
select is(tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000054')$$) ->> 'hint', 'FORBIDDEN', 'un empleado no mueve asignaciones');

select tests_0082b.as_user('test-db0082b-admin@example.com');
select is(tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-0000000000ff', 'f82b0000-0000-0000-0000-000000000054')$$) ->> 'hint', 'ASSIGNMENT_NOT_FOUND', 'una asignación inexistente');
select is(tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000051')$$) ->> 'hint', 'MOVE_SAME_SHIFT', 'moverla al mismo turno no tiene sentido');
select is(tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000055')$$) ->> 'hint', 'SHIFT_FULL', 'a un turno con la dotación completa: SHIFT_FULL');

-- Cabrera ya está en el turno de 12:30 a 13:00: pasarla al de 12 a 14 la superpone y no se mueve nada.
select set_config('tests_0082b.m1', tests_0082b.err($$select public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000052')$$)::text, true) is not null as m1;
select is((select current_setting('tests_0082b.m1')::jsonb ->> 'hint'), 'ASSIGNMENT_OVERLAP', 'si en el destino se superpone: ASSIGNMENT_OVERLAP');
select is(
  (select current_setting('tests_0082b.m1')::jsonb ->> 'message'),
  'Cabrera ya está en YPF RUTA (turno manual) el mar 1/10 de 12:30 a 13:00.',
  'con el detalle de OF-08'
);
set local role postgres;
select is(
  (select removed_at is null from public.assignments where id = 'f82b0000-0000-0000-0000-000000000121'),
  true, 'la falla no mueve nada: la asignación de origen sigue vigente'
);

-- Movimiento válido: a las 15:00.
select tests_0082b.as_user('test-db0082b-admin@example.com');
select set_config('tests_0082b.m2', public.move_assignment('f82b0000-0000-0000-0000-000000000121', 'f82b0000-0000-0000-0000-000000000054')::text, true) is not null as m2;
select is((select current_setting('tests_0082b.m2')::jsonb -> 'assignment' ->> 'shift_id'), 'f82b0000-0000-0000-0000-000000000054', 'la persona queda en el turno de destino');
select is((select current_setting('tests_0082b.m2')::jsonb -> 'previous' ->> 'shift_id'), 'f82b0000-0000-0000-0000-000000000051', 'devuelve el turno anterior para deshacer');
select is((select current_setting('tests_0082b.m2')::jsonb ->> 'removed_assignment_id'), 'f82b0000-0000-0000-0000-000000000121', 'y la asignación quitada');

set local role postgres;
select is(
  (select removed_reason from public.assignments where id = 'f82b0000-0000-0000-0000-000000000121'),
  'Movido a otro turno', 'la de origen se quitó con su motivo'
);
select is(
  (select status::text from public.shifts where id = 'f82b0000-0000-0000-0000-000000000051'),
  'scheduled', 'el turno de origen vuelve a «sin completar» (scheduled)'
);
select is(
  (select status::text from public.shifts where id = 'f82b0000-0000-0000-0000-000000000054'),
  'assigned', 'y el de destino queda completo (assigned)'
);

-- Deshacer: se vuelve al turno anterior con la franja anterior.
select tests_0082b.as_user('test-db0082b-admin@example.com');
select set_config(
  'tests_0082b.m3',
  public.move_assignment(
    (current_setting('tests_0082b.m2')::jsonb -> 'assignment' ->> 'id')::uuid,
    (current_setting('tests_0082b.m2')::jsonb -> 'previous' ->> 'shift_id')::uuid,
    (current_setting('tests_0082b.m2')::jsonb -> 'previous' ->> 'start_time')::time,
    (current_setting('tests_0082b.m2')::jsonb -> 'previous' ->> 'end_time')::time
  )::text,
  true
) is not null as deshecho;
select is((select current_setting('tests_0082b.m3')::jsonb -> 'assignment' ->> 'shift_id'), 'f82b0000-0000-0000-0000-000000000051', 'deshacer devuelve a la persona al turno original');

-- OF-02: avisos de duplicados ---------------------------------------------------------------------

select tests_0082b.as_user('test-db0082b-a1@example.com');
select is(tests_0082b.err($$select * from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1]::smallint[], '15:00', '17:00')$$) ->> 'hint', 'FORBIDDEN', 'service_overlaps: un empleado no puede');
select is(tests_0082b.err($$select * from public.shift_overlaps_in_site('f82b0000-0000-0000-0000-000000000011', '2199-07-01', '15:00', '17:00')$$) ->> 'hint', 'FORBIDDEN', 'shift_overlaps_in_site: un empleado no puede');

select tests_0082b.as_user('test-db0082b-admin@example.com');
select is(
  (select array_agg(service_name order by service_name) from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1, 3]::smallint[], '16:00', '18:00')),
  array['YPF RUTA TURNO TARDE'],
  'service_overlaps: solo el servicio activo de la misma sede que coincide en día y horario (no el pausado, ni el de martes, ni el de otra sede)'
);
select is(
  (select common_weekdays from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1, 3]::smallint[], '16:00', '18:00')),
  array[1]::smallint[], 'service_overlaps: informa los días en común'
);
select is(
  (select count(*)::int from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1]::smallint[], '15:00', '17:00', 'f82b0000-0000-0000-0000-000000000021')),
  0, 'service_overlaps: p_except_id deja afuera al servicio que se edita'
);
select is(
  (select count(*)::int from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1]::smallint[], '17:00', '18:00')),
  0, 'service_overlaps: dos franjas contiguas no se superponen'
);
select is(tests_0082b.err($$select * from public.service_overlaps('f82b0000-0000-0000-0000-000000000011', array[1]::smallint[], '18:00', '17:00')$$) ->> 'hint', 'INVALID_TIME_RANGE', 'service_overlaps: el fin tiene que ser posterior al inicio');

select is(
  (select array_agg(shift_id::text order by start_time) from public.shift_overlaps_in_site('f82b0000-0000-0000-0000-000000000011', '2199-07-01', '16:45', '17:30')),
  array['f82b0000-0000-0000-0000-000000000031', 'f82b0000-0000-0000-0000-000000000032'],
  'shift_overlaps_in_site: los turnos de la sede que se pisan (del servicio y manuales)'
);
select is(
  (select service_name from public.shift_overlaps_in_site('f82b0000-0000-0000-0000-000000000011', '2199-07-01', '16:45', '17:30') where shift_id = 'f82b0000-0000-0000-0000-000000000031'),
  'YPF RUTA TURNO TARDE', 'shift_overlaps_in_site: dice el servicio del turno'
);
select is(
  (select count(*)::int from public.shift_overlaps_in_site('f82b0000-0000-0000-0000-000000000011', '2199-07-01', '16:45', '17:30', 'f82b0000-0000-0000-0000-000000000031')),
  1, 'shift_overlaps_in_site: p_except_id deja afuera al turno que se edita'
);
select is(
  (select count(*)::int from public.shift_overlaps_in_site('f82b0000-0000-0000-0000-000000000012', '2199-07-01', '16:45', '17:30')),
  0, 'shift_overlaps_in_site: otra sede no cuenta'
);

select * from finish();

rollback;
