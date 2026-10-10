-- pgTAP de la migración 0041_p19_6f_asignar_al_crear.sql (P19.6 paquete F, AJ2-17):
--   - create_shift con p_employee_ids: asignados, rechazados con motivo (superposición, inactivo,
--     dotación), advertencias que no bloquean (licencia), duplicados, permisos.
--   - service_fixed_employees: RLS por rol, tope por dotación, set_service_fixed_employees.
--   - generate_shifts: asigna los fijos, saltea e informa los no asignables (licencia,
--     superposición), idempotencia, turnos ya empezados sin fijos.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4100000-...'. Meses de prueba: 2199-05 y 2199-06 (fuera del uso real).

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

select plan(54);

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'service_fixed_employees', 'existe public.service_fixed_employees');
select ok((select relrowsecurity from pg_class where oid = 'public.service_fixed_employees'::regclass), 'service_fixed_employees tiene RLS habilitada');
select col_is_pk('public', 'service_fixed_employees', array['service_id', 'employee_id'], 'service_fixed_employees: PK (service_id, employee_id)');
select has_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text', 'boolean', 'boolean', 'uuid[]'], 'create_shift tiene p_employee_ids al final');
select hasnt_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text', 'boolean', 'boolean'], 'ya no existe create_shift de 10 parámetros');
select has_function('public', 'set_service_fixed_employees', array['uuid', 'uuid[]'], 'existe set_service_fixed_employees(uuid, uuid[])');
select has_function('public', 'assign_employee', array['uuid', 'uuid', 'time', 'time'], 'assign_employee conserva su firma');
select ok(
  not has_function_privilege('anon', 'public.set_service_fixed_employees(uuid, uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.set_service_fixed_employees(uuid, uuid[])', 'execute')
    and not has_function_privilege('authenticated', 'app.assign_employee_core(uuid, uuid, time, time, boolean)', 'execute'),
  'grants: set_service_fixed_employees para authenticated; assign_employee_core no es llamable desde afuera'
);
select ok(
  not has_table_privilege('anon', 'public.service_fixed_employees', 'select'),
  'anon: sin acceso a service_fixed_employees'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f4100000-0000-0000-0000-000000000001', 'Cliente de asignar al crear', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('f4100000-0000-0000-0000-000000000011', 'f4100000-0000-0000-0000-000000000001', 'Sede de asignar al crear', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4100000-0000-0000-0000-000000000081', 'test-db041-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Fijos')),
  ('f4100000-0000-0000-0000-000000000082', 'test-db041-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConGenerar')),
  ('f4100000-0000-0000-0000-000000000084', 'test-db041-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f4100000-0000-0000-0000-000000000085', 'test-db041-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('f4100000-0000-0000-0000-000000000091', 'test-db041-ea@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Libre')),
  ('f4100000-0000-0000-0000-000000000092', 'test-db041-eb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Ocupado')),
  ('f4100000-0000-0000-0000-000000000093', 'test-db041-ec@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Licencia')),
  ('f4100000-0000-0000-0000-000000000094', 'test-db041-ed@example.com', jsonb_build_object('first_name', 'Diego', 'last_name', 'Inactivo')),
  ('f4100000-0000-0000-0000-000000000095', 'test-db041-ee@example.com', jsonb_build_object('first_name', 'Elena', 'last_name', 'Extra')),
  ('f4100000-0000-0000-0000-000000000096', 'test-db041-ef@example.com', jsonb_build_object('first_name', 'Fabi', 'last_name', 'Pasado'));

insert into public.user_roles (profile_id, role) values
  ('f4100000-0000-0000-0000-000000000081', 'owner'),
  ('f4100000-0000-0000-0000-000000000082', 'admin'),
  ('f4100000-0000-0000-0000-000000000084', 'supervisor'),
  ('f4100000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f4100000-0000-0000-0000-000000000082', 'generate_shifts', true);

insert into public.employees (profile_id, dni, status) values
  ('f4100000-0000-0000-0000-000000000084', '94100084', 'active'),
  ('f4100000-0000-0000-0000-000000000085', '94100085', 'active'),
  ('f4100000-0000-0000-0000-000000000091', '94100091', 'active'),
  ('f4100000-0000-0000-0000-000000000092', '94100092', 'active'),
  ('f4100000-0000-0000-0000-000000000093', '94100093', 'active'),
  ('f4100000-0000-0000-0000-000000000094', '94100094', 'terminated'),
  ('f4100000-0000-0000-0000-000000000095', '94100095', 'active'),
  ('f4100000-0000-0000-0000-000000000096', '94100096', 'active');

-- Carla (93) está de licencia del 2199-05-01 al 2199-05-31 y del 2199-06-14 al 2199-06-20.
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f4100000-0000-0000-0000-000000000093', '2199-05-01', '2199-05-31', 'Licencia de prueba 0041'),
  ('f4100000-0000-0000-0000-000000000093', '2199-06-14', '2199-06-20', 'Licencia de prueba 0041 (junio)');

-- Turno previo de Beto (92): 2199-05-04 10:00-14:00 y 2199-06-07 09:00-11:00 (para provocar superposiciones).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f4100000-0000-0000-0000-000000000041', 'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011', '2199-05-04', '10:00', '14:00', 1, 'scheduled'),
  ('f4100000-0000-0000-0000-000000000042', 'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011', '2199-06-07', '09:00', '11:00', 1, 'scheduled');
insert into public.assignments (shift_id, employee_id) values
  ('f4100000-0000-0000-0000-000000000041', 'f4100000-0000-0000-0000-000000000092'),
  ('f4100000-0000-0000-0000-000000000042', 'f4100000-0000-0000-0000-000000000092');

-- create_shift con empleados ------------------------------------------------------------------

select tests.as_user('test-db041-supervisora@example.com');

prepare create_as_supervisor as
  select public.create_shift(
    'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011',
    date '2199-05-04', time '08:00', time '12:00', 2::smallint, null, null, false, true,
    array['f4100000-0000-0000-0000-000000000091']::uuid[]);
select throws_ok('create_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'create_shift con empleados: un supervisor no puede (FORBIDDEN)');

set local role postgres;
select tests.as_user('test-db041-admin@example.com');

-- Dotación 2; pedimos Ana (libre), Beto (superpuesto), Diego (inactivo), Carla (licencia), Elena (sobra),
-- y Ana repetida. Esperado: Ana y Carla asignadas (Carla con ON_LEAVE), Beto/Diego/Elena rechazados.
select set_config('t.c1', public.create_shift(
  'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011',
  date '2199-05-04', time '08:00', time '12:00', 2::smallint, null, null, false, true,
  array[
    'f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000092',
    'f4100000-0000-0000-0000-000000000094', 'f4100000-0000-0000-0000-000000000093',
    'f4100000-0000-0000-0000-000000000095', 'f4100000-0000-0000-0000-000000000091']::uuid[])::text, true);

select is(
  (select array_agg(e ->> 'employee_id' order by o) from jsonb_array_elements(current_setting('t.c1')::jsonb -> 'assigned') with ordinality as t(e, o)),
  array['f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000093'],
  'create_shift: asigna a Ana y a Carla (sin repetir a Ana)'
);
select is(
  (select array_agg(e ->> 'code' order by o) from jsonb_array_elements(current_setting('t.c1')::jsonb -> 'rejected') with ordinality as t(e, o)),
  array['ASSIGNMENT_OVERLAP', 'EMPLOYEE_NOT_ACTIVE', 'SHIFT_FULL'],
  'create_shift: rechaza con su motivo a Beto (superposición), Diego (inactivo) y Elena (dotación completa)'
);
select is(
  current_setting('t.c1')::jsonb -> 'rejected' -> 0 ->> 'employee_name',
  'Beto Ocupado',
  'create_shift: cada rechazado trae employee_name'
);
select is(
  current_setting('t.c1')::jsonb -> 'rejected' -> 0 ->> 'message',
  'El empleado ya tiene otro turno en ese horario.',
  'create_shift: cada rechazado trae el mensaje de la misma validación que la asignación manual'
);
select is(
  current_setting('t.c1')::jsonb -> 'assigned' -> 1 -> 'warnings',
  '["ON_LEAVE"]'::jsonb,
  'create_shift: la licencia advierte y no bloquea (igual que assign_employee)'
);
select is(
  current_setting('t.c1')::jsonb -> 'shift' ->> 'status',
  'assigned',
  'create_shift: con la dotación completa el turno nace assigned'
);
select is(
  (select count(*)::int from public.assignments where shift_id = (current_setting('t.c1')::jsonb -> 'shift' ->> 'id')::uuid and removed_at is null),
  2,
  'create_shift: quedan exactamente 2 asignaciones vigentes (la dotación no se supera)'
);
select is(
  current_setting('t.c1')::jsonb -> 'warnings',
  '[]'::jsonb,
  'create_shift: los warnings del turno no se mezclan con los de las asignaciones'
);

-- Sin empleados: contrato anterior más listas vacías.
select set_config('t.c2', public.create_shift(
  'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011',
  date '2199-05-11', time '08:00', time '12:00', 1::smallint)::text, true);
select is(current_setting('t.c2')::jsonb -> 'assigned', '[]'::jsonb, 'create_shift sin empleados: assigned vacío');
select is(current_setting('t.c2')::jsonb -> 'rejected', '[]'::jsonb, 'create_shift sin empleados: rejected vacío');
select is(current_setting('t.c2')::jsonb -> 'shift' ->> 'status', 'scheduled', 'create_shift sin empleados: el turno nace scheduled');

-- Dotación 2 con un solo empleado: el turno queda scheduled.
select set_config('t.c3', public.create_shift(
  'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011',
  date '2199-05-18', time '08:00', time '12:00', 2::smallint, null, null, false, true,
  array['f4100000-0000-0000-0000-000000000091']::uuid[])::text, true);
select is(current_setting('t.c3')::jsonb -> 'shift' ->> 'status', 'scheduled', 'create_shift: dotación 2 con un asignado queda scheduled');

-- Un turno inválido no asigna nada y falla entero (INVALID_TIME_RANGE).
prepare create_bad_range as
  select public.create_shift(
    'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011',
    date '2199-05-25', time '12:00', time '08:00', 1::smallint, null, null, false, true,
    array['f4100000-0000-0000-0000-000000000091']::uuid[]);
select throws_ok('create_bad_range', 'P0001', 'La hora de fin tiene que ser posterior a la de inicio.', 'create_shift: rango inválido sigue fallando antes de asignar');

-- assign_employee (envoltorio) sigue igual.
select is(
  (public.assign_employee(
    (current_setting('t.c3')::jsonb -> 'shift' ->> 'id')::uuid,
    'f4100000-0000-0000-0000-000000000095') -> 'warnings'),
  '[]'::jsonb,
  'assign_employee sigue funcionando por el envoltorio'
);

-- Empleados fijos: permisos y RLS -------------------------------------------------------------

set local role postgres;

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f4100000-0000-0000-0000-000000000031', 'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011', 'Servicio con fijos',
   array[extract(dow from date '2199-06-07')::smallint], '08:00', '12:00', 3, '2199-06-01', 'active');

select tests.as_user('test-db041-supervisora@example.com');
prepare fixed_as_supervisor as
  select public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array['f4100000-0000-0000-0000-000000000091']::uuid[]);
select throws_ok('fixed_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'set_service_fixed_employees: un supervisor no puede (FORBIDDEN)');

select tests.as_user('test-db041-empleado@example.com');
prepare fixed_as_employee as
  select public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array['f4100000-0000-0000-0000-000000000091']::uuid[]);
select throws_ok('fixed_as_employee', 'P0001', 'No tenés permiso para hacer esto.', 'set_service_fixed_employees: un empleado no puede (FORBIDDEN)');

prepare fixed_direct_insert_employee as
  insert into public.service_fixed_employees (service_id, employee_id)
  values ('f4100000-0000-0000-0000-000000000031', 'f4100000-0000-0000-0000-000000000091');
select throws_ok('fixed_direct_insert_employee', '42501', null, 'service_fixed_employees: un empleado no inserta directo (RLS)');

set local role postgres;
select tests.as_user('test-db041-admin@example.com');

select is(
  (public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array[
     'f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000092',
     'f4100000-0000-0000-0000-000000000093', 'f4100000-0000-0000-0000-000000000091']::uuid[]) -> 'employee_ids') ?& array[
     'f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000092', 'f4100000-0000-0000-0000-000000000093'],
  true,
  'set_service_fixed_employees: el admin fija tres empleados (sin repetir)'
);
select is(
  (select count(*)::int from public.service_fixed_employees where service_id = 'f4100000-0000-0000-0000-000000000031'),
  3, 'service_fixed_employees: quedaron 3 filas'
);

prepare fixed_over_staff as
  select public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array[
    'f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000092',
    'f4100000-0000-0000-0000-000000000093', 'f4100000-0000-0000-0000-000000000095']::uuid[]);
select throws_ok('fixed_over_staff', 'P0001', 'Los empleados fijos no pueden ser más que la dotación del servicio (3).', 'set_service_fixed_employees: más fijos que la dotación -> FIXED_EXCEEDS_STAFF');

prepare fixed_inactive as
  select public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array['f4100000-0000-0000-0000-000000000094']::uuid[]);
select throws_ok('fixed_inactive', 'P0001', 'Hay un empleado que no está activo.', 'set_service_fixed_employees: empleado inactivo -> EMPLOYEE_NOT_ACTIVE');

prepare fixed_no_service as
  select public.set_service_fixed_employees('f4100000-0000-0000-0000-0000000000ff', array[]::uuid[]);
select throws_ok('fixed_no_service', 'P0001', 'No encontramos ese servicio.', 'set_service_fixed_employees: servicio inexistente -> SERVICE_NOT_FOUND');

prepare fixed_direct_over as
  insert into public.service_fixed_employees (service_id, employee_id)
  values ('f4100000-0000-0000-0000-000000000031', 'f4100000-0000-0000-0000-000000000095');
select throws_ok('fixed_direct_over', 'P0001', 'Los empleados fijos no pueden ser más que la dotación del servicio (3).', 'service_fixed_employees: el insert directo también respeta la dotación (trigger)');

prepare lower_staff as
  update public.services set required_staff = 2 where id = 'f4100000-0000-0000-0000-000000000031';
select throws_ok('lower_staff', 'P0001', 'El servicio tiene más empleados fijos que la dotación pedida. Sacá fijos antes de bajarla.', 'services: bajar la dotación por debajo de los fijos se rechaza');

-- Reemplazo de la lista.
select is(
  (public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array['f4100000-0000-0000-0000-000000000091']::uuid[]) -> 'employee_ids'),
  '["f4100000-0000-0000-0000-000000000091"]'::jsonb,
  'set_service_fixed_employees: reemplaza la lista'
);
select is(
  (select count(*)::int from public.service_fixed_employees where service_id = 'f4100000-0000-0000-0000-000000000031'),
  1, 'service_fixed_employees: tras reemplazar queda una sola fila'
);

-- Lectura por rol.
select ok((select count(*) from public.service_fixed_employees) >= 1, 'RLS: el admin ve los fijos');
select tests.as_user('test-db041-owner@example.com');
select ok((select count(*) from public.service_fixed_employees) >= 1, 'RLS: el owner ve los fijos');
select tests.as_user('test-db041-supervisora@example.com');
select is((select count(*)::int from public.service_fixed_employees), 0, 'RLS: el supervisor no ve los fijos');
select tests.as_user('test-db041-empleado@example.com');
select is((select count(*)::int from public.service_fixed_employees), 0, 'RLS: el empleado no ve los fijos');

-- generate_shifts con fijos -------------------------------------------------------------------

set local role postgres;
select tests.as_user('test-db041-admin@example.com');

-- Fijos del servicio: Ana (libre), Beto (superpuesto el 2199-06-07), Carla (licencia 14 al 20 de junio).
select public.set_service_fixed_employees('f4100000-0000-0000-0000-000000000031', array[
  'f4100000-0000-0000-0000-000000000091', 'f4100000-0000-0000-0000-000000000092', 'f4100000-0000-0000-0000-000000000093']::uuid[]);

select set_config('t.g1', public.generate_shifts(2199, 6)::text, true);

select is(
  (select count(*)::int from jsonb_array_elements(current_setting('t.g1')::jsonb -> 'unassigned') e
   where e ->> 'service_id' = 'f4100000-0000-0000-0000-000000000031'),
  2,
  'generate_shifts: informa exactamente dos fijos sin asignar (Beto y Carla)'
);
select is(
  (select array_agg(e ->> 'employee_id' || ' ' || (e ->> 'code') || ' ' || (e ->> 'shift_date') order by e ->> 'shift_date')
   from jsonb_array_elements(current_setting('t.g1')::jsonb -> 'unassigned') e
   where e ->> 'service_id' = 'f4100000-0000-0000-0000-000000000031'),
  array[
    'f4100000-0000-0000-0000-000000000092 ASSIGNMENT_OVERLAP 2199-06-07',
    'f4100000-0000-0000-0000-000000000093 ON_LEAVE 2199-06-14'],
  'generate_shifts: Beto por superposición el 7 y Carla por licencia el 14'
);
select ok(
  (select bool_and(e ? 'shift_id' and e ? 'employee_name' and e ? 'message')
   from jsonb_array_elements(current_setting('t.g1')::jsonb -> 'unassigned') e),
  'generate_shifts: cada no asignado trae shift_id, employee_name y message'
);
select is(
  (select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id
   where s.service_id = 'f4100000-0000-0000-0000-000000000031' and a.removed_at is null),
  (select 3 * count(*)::int - 2 from public.shifts where service_id = 'f4100000-0000-0000-0000-000000000031'),
  'generate_shifts: asigna los tres fijos a cada turno salvo los dos que no se pudieron'
);
select is(
  (select count(*)::int from public.shifts s
   where s.service_id = 'f4100000-0000-0000-0000-000000000031' and s.status = 'assigned'),
  (select count(*)::int - 2 from public.shifts where service_id = 'f4100000-0000-0000-0000-000000000031'),
  'generate_shifts: los turnos completos pasan a assigned y los dos con un faltante quedan scheduled'
);
select ok((current_setting('t.g1')::jsonb ->> 'assigned')::int >= 1, 'generate_shifts: informa la cantidad de asignaciones hechas');
select is((current_setting('t.g1')::jsonb ->> 'past_without_fixed')::int, 0, 'generate_shifts: ningún turno de junio 2199 es pasado');

-- Idempotencia: la segunda corrida no crea, no asigna, no informa.
select set_config('t.g2', public.generate_shifts(2199, 6)::text, true);
select is((current_setting('t.g2')::jsonb ->> 'created')::int, 0, 'generate_shifts: segunda corrida no crea turnos');
select is((current_setting('t.g2')::jsonb ->> 'assigned')::int, 0, 'generate_shifts: segunda corrida no asigna nada (no duplica)');
select is(current_setting('t.g2')::jsonb -> 'unassigned', '[]'::jsonb, 'generate_shifts: segunda corrida no informa pendientes');

-- Un turno ya empezado no recibe fijos: mes anterior al actual con un servicio de todos los días.
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f4100000-0000-0000-0000-000000000032', 'f4100000-0000-0000-0000-000000000001', 'f4100000-0000-0000-0000-000000000011', 'Servicio del mes pasado',
   array[0, 1, 2, 3, 4, 5, 6]::smallint[], '08:00', '12:00', 1,
   date_trunc('month', app.today() - interval '1 month')::date,
   (date_trunc('month', app.today())::date - 1), 'active');
insert into public.service_fixed_employees (service_id, employee_id) values
  ('f4100000-0000-0000-0000-000000000032', 'f4100000-0000-0000-0000-000000000096');

select tests.as_user('test-db041-admin@example.com');
select set_config('t.g3', public.generate_shifts(
  extract(year from date_trunc('month', app.today() - interval '1 month'))::int,
  extract(month from date_trunc('month', app.today() - interval '1 month'))::int)::text, true);

select ok(
  (select count(*) from public.shifts where service_id = 'f4100000-0000-0000-0000-000000000032') >= 28,
  'generate_shifts: crea los turnos del servicio del mes pasado'
);
select is(
  (select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id
   where s.service_id = 'f4100000-0000-0000-0000-000000000032'),
  0,
  'generate_shifts: los turnos ya empezados no reciben fijos'
);
select ok((current_setting('t.g3')::jsonb ->> 'past_without_fixed')::int >= 28, 'generate_shifts: informa past_without_fixed');

-- Permisos de generate_shifts sin cambios.
select tests.as_user('test-db041-supervisora@example.com');
prepare generate_as_supervisor as select public.generate_shifts(2199, 7);
select throws_ok('generate_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'generate_shifts: un supervisor sigue sin poder (FORBIDDEN)');

select * from finish();

rollback;
