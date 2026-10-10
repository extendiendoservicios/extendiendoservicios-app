-- pgTAP de la migración 0040_p19_6d_banco_y_observacion.sql (P19.6 paquete D):
--   AJ2-04: tablas client_bank_details y employee_bank_details (banco, CBU, alias), sus checks, su
--           RLS por rol y las RPC set_client_bank_details / set_employee_bank_details.
--   AJ2-15: tabla shift_observations (observación del turno + casilla show_in_print) legible solo por administración,
--           v_assignments_board.shift_observation, client_service_summary[].shifts[].observation,
--           create_shift y update_shift_details con la casilla.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4400000-...'.

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

select plan(79);

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'client_bank_details', 'existe public.client_bank_details');
select has_table('public', 'employee_bank_details', 'existe public.employee_bank_details');
select ok((select relrowsecurity from pg_class where oid = 'public.client_bank_details'::regclass), 'client_bank_details tiene RLS habilitada');
select ok((select relrowsecurity from pg_class where oid = 'public.employee_bank_details'::regclass), 'employee_bank_details tiene RLS habilitada');
select is(
  (select array_agg(table_name::text order by table_name) from information_schema.columns
   where table_schema = 'public' and column_name in ('cbu', 'bank_name')),
  array['client_bank_details', 'client_bank_details', 'employee_bank_details', 'employee_bank_details'],
  'ni clients, employees ni ninguna vista tienen columnas de banco o CBU: solo las dos tablas aparte'
);
select ok(
  not has_table_privilege('authenticated', 'public.client_bank_details', 'insert')
    and not has_table_privilege('authenticated', 'public.client_bank_details', 'update')
    and not has_table_privilege('authenticated', 'public.client_bank_details', 'delete')
    and not has_table_privilege('authenticated', 'public.employee_bank_details', 'insert')
    and not has_table_privilege('authenticated', 'public.employee_bank_details', 'update')
    and not has_table_privilege('authenticated', 'public.employee_bank_details', 'delete'),
  'authenticated: sin insert/update/delete en las tablas de banco (se escribe por RPC)'
);
select ok(
  not has_table_privilege('anon', 'public.client_bank_details', 'select')
    and not has_table_privilege('anon', 'public.employee_bank_details', 'select'),
  'anon: sin select en las tablas de banco'
);
select has_table('public', 'shift_observations', 'existe public.shift_observations');
select ok((select relrowsecurity from pg_class where oid = 'public.shift_observations'::regclass), 'shift_observations tiene RLS habilitada');
select col_default_is('public', 'shift_observations', 'show_in_print', 'true', 'shift_observations.show_in_print nace en true');
select ok(
  not has_table_privilege('authenticated', 'public.shift_observations', 'insert')
    and not has_table_privilege('authenticated', 'public.shift_observations', 'update')
    and not has_table_privilege('authenticated', 'public.shift_observations', 'delete')
    and not has_table_privilege('anon', 'public.shift_observations', 'select'),
  'shift_observations: authenticated sin insert/update/delete y anon sin select (se escribe por RPC)'
);
select is(
  (select count(*)::int from public.shifts where notes is not null), 0,
  'shifts.notes quedó vacía (la observación vive en shift_observations)'
);
select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.v_shifts_board'::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1),
  'show_in_print', 'v_shifts_board: show_in_print al final'
);
select is(
  (select attname::text from pg_attribute
   where attrelid = 'public.v_assignments_board'::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1),
  'shift_observation', 'v_assignments_board: shift_observation al final'
);
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name in ('v_my_day', 'v_my_supervisions')
     and column_name in ('show_in_print', 'shift_observation', 'observation')),
  0, 'las vistas del celular (v_my_day, v_my_supervisions) no traen la observación ni la casilla'
);
select has_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text', 'boolean', 'boolean', 'uuid[]'], 'create_shift tiene p_show_in_print');
select has_function('public', 'update_shift_details', array['uuid', 'smallint', 'text', 'boolean'], 'update_shift_details tiene p_show_in_print');
select has_function('public', 'set_client_bank_details', array['uuid', 'text', 'text', 'text'], 'existe set_client_bank_details');
select has_function('public', 'set_employee_bank_details', array['uuid', 'text', 'text', 'text'], 'existe set_employee_bank_details');

-- Fixtures: dueño, administrador, supervisor y dos empleados --------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4400000-0000-0000-0000-000000000001', 'test-aj2d-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('f4400000-0000-0000-0000-000000000002', 'test-aj2d-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('f4400000-0000-0000-0000-000000000003', 'test-aj2d-supervisor@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Tres')),
  ('f4400000-0000-0000-0000-000000000004', 'test-aj2d-emp1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cuatro')),
  ('f4400000-0000-0000-0000-000000000005', 'test-aj2d-emp2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cinco'));

insert into public.user_roles (profile_id, role) values
  ('f4400000-0000-0000-0000-000000000001', 'owner'),
  ('f4400000-0000-0000-0000-000000000002', 'admin'),
  ('f4400000-0000-0000-0000-000000000003', 'supervisor'),
  ('f4400000-0000-0000-0000-000000000004', 'employee'),
  ('f4400000-0000-0000-0000-000000000005', 'employee');

insert into public.employees (profile_id, dni) values
  ('f4400000-0000-0000-0000-000000000003', '94400003'),
  ('f4400000-0000-0000-0000-000000000004', '94400004'),
  ('f4400000-0000-0000-0000-000000000005', '94400005');

insert into public.clients (id, legal_name, status) values
  ('f4400000-0000-0000-0000-0000000000c1', 'Cliente AJ2D Uno SA', 'active'),
  ('f4400000-0000-0000-0000-0000000000c2', 'Cliente AJ2D Dos SA', 'active'),
  ('f4400000-0000-0000-0000-0000000000c3', 'Cliente AJ2D Tres SA', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('f4400000-0000-0000-0000-0000000000a1', 'f4400000-0000-0000-0000-0000000000c1', 'Sede AJ2D', 'Calle 1', 'active');

-- Checks de la base (como postgres, sin pasar por la RPC) --------------------------------------

select throws_ok(
  $$insert into public.client_bank_details (client_id, cbu) values ('f4400000-0000-0000-0000-0000000000c2', '1234')$$,
  '23514', null, 'CBU corto: rechazado por el check'
);
select throws_ok(
  $$insert into public.client_bank_details (client_id, cbu) values ('f4400000-0000-0000-0000-0000000000c2', '017009922000006779737A')$$,
  '23514', null, 'CBU con una letra: rechazado por el check'
);
select throws_ok(
  $$insert into public.client_bank_details (client_id, cbu) values ('f4400000-0000-0000-0000-0000000000c2', '01700992200000677973700')$$,
  '23514', null, 'CBU de 23 dígitos: rechazado por el check'
);
select throws_ok(
  $$insert into public.client_bank_details (client_id, alias) values ('f4400000-0000-0000-0000-0000000000c2', 'corto')$$,
  '23514', null, 'alias de 5 caracteres: rechazado por el check'
);
select throws_ok(
  $$insert into public.client_bank_details (client_id, alias) values ('f4400000-0000-0000-0000-0000000000c2', 'con espacio')$$,
  '23514', null, 'alias con espacio: rechazado por el check'
);
select throws_ok(
  $$insert into public.employee_bank_details (profile_id, cbu) values ('f4400000-0000-0000-0000-000000000004', '12')$$,
  '23514', null, 'employee_bank_details: CBU corto rechazado por el check'
);
select throws_ok(
  $$insert into public.client_bank_details (client_id, bank_name) values ('f4400000-0000-0000-0000-0000000000c2', '   ')$$,
  '23514', null, 'banco de solo espacios: rechazado por el check'
);
select lives_ok(
  $$insert into public.client_bank_details (client_id, bank_name, cbu, alias)
    values ('f4400000-0000-0000-0000-0000000000c3', 'Banco Libre', '0170099220000067797370', 'mi.alias-01')$$,
  'datos válidos: se aceptan'
);

-- RPC de escritura: administrador -------------------------------------------------------------

select tests.as_user('test-aj2d-admin@example.com');

select is(
  (public.set_client_bank_details(
     'f4400000-0000-0000-0000-0000000000c1', '  Banco Nación  ', '01700992 20000067-797370', ' pago.limpieza ')).cbu,
  '0170099220000067797370', 'set_client_bank_details: guarda el CBU solo con dígitos'
);
select is(
  (select bank_name || '|' || alias from public.client_bank_details where client_id = 'f4400000-0000-0000-0000-0000000000c1'),
  'Banco Nación|pago.limpieza', 'set_client_bank_details: recorta banco y alias'
);
select is(
  (public.set_client_bank_details(
     'f4400000-0000-0000-0000-0000000000c1', 'Banco Provincia', '0170099220000067797370', 'pago.limpieza')).bank_name,
  'Banco Provincia', 'set_client_bank_details: una segunda llamada actualiza la misma fila'
);
select is(
  (select count(*)::int from public.client_bank_details where client_id = 'f4400000-0000-0000-0000-0000000000c1'),
  1, 'set_client_bank_details: una sola fila por cliente'
);
select throws_ok(
  $$select public.set_client_bank_details('f4400000-0000-0000-0000-0000000000c1', 'B', '123', null)$$,
  'P0001', 'El CBU tiene que tener exactamente 22 dígitos.', 'set_client_bank_details: INVALID_CBU'
);
select throws_ok(
  $$select public.set_client_bank_details('f4400000-0000-0000-0000-0000000000c1', 'B', null, 'a b')$$,
  'P0001', 'El alias tiene que tener entre 6 y 20 caracteres: letras, números, punto o guion.', 'set_client_bank_details: INVALID_ALIAS'
);
select throws_ok(
  $$select public.set_client_bank_details('f4400000-0000-0000-0000-00000000dead', 'B', null, null)$$,
  'P0001', 'No encontramos a ese cliente.', 'set_client_bank_details: CLIENT_NOT_FOUND'
);
select is(
  (select cbu from public.set_client_bank_details('f4400000-0000-0000-0000-0000000000c1', '', '   ', '')),
  null, 'set_client_bank_details: vacío se guarda como null'
);
select is(
  (public.set_employee_bank_details(
     'f4400000-0000-0000-0000-000000000004', 'Banco Ciudad', '0270099220000067797370', 'emp.uno.01')).cbu,
  '0270099220000067797370', 'set_employee_bank_details: el administrador guarda el CBU de un empleado'
);
select throws_ok(
  $$select public.set_employee_bank_details('f4400000-0000-0000-0000-000000000001', 'B', null, null)$$,
  'P0001', 'No encontramos a esa persona.', 'set_employee_bank_details: PROFILE_NOT_FOUND si la persona no tiene ficha de empleado'
);
select throws_ok(
  $$select public.set_employee_bank_details('f4400000-0000-0000-0000-000000000004', 'B', '99', null)$$,
  'P0001', 'El CBU tiene que tener exactamente 22 dígitos.', 'set_employee_bank_details: INVALID_CBU'
);
select throws_ok(
  $$insert into public.employee_bank_details (profile_id, cbu) values ('f4400000-0000-0000-0000-000000000005', null)$$,
  '42501', null, 'administrador: no escribe la tabla directo (42501), solo por RPC'
);

-- Un tercer dato para que el empleado 2 tenga los suyos
select lives_ok(
  $$select public.set_employee_bank_details('f4400000-0000-0000-0000-000000000005', 'Banco Galicia', '0070099220000067797371', 'emp.dos.02')$$,
  'administrador: guarda los datos del empleado 2'
);

-- Dueño ------------------------------------------------------------------------------------------

select tests.as_user('test-aj2d-owner@example.com');

select lives_ok(
  $$select public.set_client_bank_details('f4400000-0000-0000-0000-0000000000c1', 'Banco Nación', '0170099220000067797370', 'pago.limpieza')$$,
  'dueño: guarda los datos del cliente por RPC'
);
select is(
  (select count(*)::int from public.client_bank_details where client_id in ('f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000c3')),
  2, 'dueño: lee los datos bancarios de los clientes'
);
select is(
  (select count(*)::int from public.employee_bank_details where profile_id in ('f4400000-0000-0000-0000-000000000004', 'f4400000-0000-0000-0000-000000000005')),
  2, 'dueño: lee los datos bancarios de los empleados'
);

-- Escenario de turnos para supervisor y empleados ------------------------------------------------

set local role postgres;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f4400000-0000-0000-0000-000000000051', 'f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1', app.today() + 5, '10:00', '11:00', 2, 'assigned'),
  ('f4400000-0000-0000-0000-000000000052', 'f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1', app.today() - 2, '10:00', '11:00', 1, 'completed'),
  ('f4400000-0000-0000-0000-000000000053', 'f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1', app.today() - 1, '10:00', '11:00', 1, 'completed');

insert into public.shift_observations (shift_id, observation, show_in_print) values
  ('f4400000-0000-0000-0000-000000000051', 'Obs con casilla', true),
  ('f4400000-0000-0000-0000-000000000052', 'Obs impresa', true),
  ('f4400000-0000-0000-0000-000000000053', 'Obs oculta', false);

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f4400000-0000-0000-0000-000000000061', 'f4400000-0000-0000-0000-000000000051', 'f4400000-0000-0000-0000-000000000004', 'expected'),
  ('f4400000-0000-0000-0000-000000000062', 'f4400000-0000-0000-0000-000000000051', 'f4400000-0000-0000-0000-000000000005', 'expected'),
  ('f4400000-0000-0000-0000-000000000063', 'f4400000-0000-0000-0000-000000000052', 'f4400000-0000-0000-0000-000000000004', 'finished'),
  ('f4400000-0000-0000-0000-000000000064', 'f4400000-0000-0000-0000-000000000053', 'f4400000-0000-0000-0000-000000000004', 'finished');

insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('f4400000-0000-0000-0000-000000000071', 'f4400000-0000-0000-0000-000000000051', 'f4400000-0000-0000-0000-000000000003', 'assigned');

-- Supervisor: ve a sus empleados, pero no sus datos bancarios --------------------------------------

select tests.as_user('test-aj2d-supervisor@example.com');

select is(
  (select count(*)::int from public.clients where id = 'f4400000-0000-0000-0000-0000000000c1'),
  1, 'supervisor: SÍ lee la fila del cliente de su turno (el escenario es real: por esa fila no tiene que filtrarse el banco)'
);
select is(
  (select count(*)::int from public.employee_bank_details), 0,
  'supervisor: no lee datos bancarios de empleados, ni de los de su turno'
);
select is(
  (select count(*)::int from public.client_bank_details), 0,
  'supervisor: no lee datos bancarios de clientes'
);
select is(
  (select count(*)::int from public.v_employees where to_jsonb(v_employees)::text ~ '0270099220000067797370|Banco Ciudad'), 0,
  'supervisor: v_employees no trae banco ni CBU'
);
select is(
  (select count(*)::int from public.v_clients where to_jsonb(v_clients)::text ~ '0170099220000067797370|Banco Nación'), 0,
  'supervisor: v_clients no trae banco ni CBU'
);
select throws_ok(
  $$select public.set_client_bank_details('f4400000-0000-0000-0000-0000000000c1', 'X', null, null)$$,
  'P0001', 'No tenés permiso para hacer esto.', 'supervisor: no puede guardar datos bancarios de un cliente'
);
select is(
  (select notes from public.v_shifts_board where id = 'f4400000-0000-0000-0000-000000000051'),
  null, 'supervisor: v_shifts_board no le muestra la observación del turno'
);
select is(
  (select count(*)::int from public.v_shifts_board where id = 'f4400000-0000-0000-0000-000000000051'),
  1, 'supervisor: igual ve el turno en v_shifts_board'
);
select is(
  (select count(*)::int from public.shift_observations), 0,
  'supervisor del turno: no lee shift_observations'
);
select is(
  (select notes from public.shifts where id = 'f4400000-0000-0000-0000-000000000051'),
  null, 'supervisor del turno: shifts.notes está vacía (no hay observación legible por la tabla shifts)'
);

-- Empleado 1: ve solo los suyos ---------------------------------------------------------------------

select tests.as_user('test-aj2d-emp1@example.com');

select is(
  (select cbu from public.employee_bank_details where profile_id = 'f4400000-0000-0000-0000-000000000004'),
  '0270099220000067797370', 'empleado: lee SUS datos bancarios'
);
select is(
  (select count(*)::int from public.employee_bank_details), 1,
  'empleado: no lee los de nadie más (ni los de su compañero de turno)'
);
select is(
  (select count(*)::int from public.client_bank_details), 0,
  'empleado: no lee datos bancarios de clientes'
);
select throws_ok(
  $$select public.set_employee_bank_details('f4400000-0000-0000-0000-000000000004', 'X', null, null)$$,
  'P0001', 'No tenés permiso para hacer esto.', 'empleado: no puede cambiar ni sus propios datos bancarios (solo lectura)'
);
select is(
  (select count(*)::int from public.shift_observations), 0,
  'empleado asignado al turno: no lee shift_observations'
);
select is(
  (select notes from public.shifts where id = 'f4400000-0000-0000-0000-000000000051'),
  null, 'empleado asignado al turno: shifts.notes está vacía'
);
select is(
  (select count(*)::int from public.v_assignments_board where shift_observation is not null),
  0, 'empleado: v_assignments_board no le devuelve ninguna observación de turno'
);

-- Empleado 2 ----------------------------------------------------------------------------------------

select tests.as_user('test-aj2d-emp2@example.com');

select is(
  (select cbu from public.employee_bank_details), '0070099220000067797371',
  'empleado 2: ve solo su propia fila bancaria'
);

-- Observación: RPC de turnos ------------------------------------------------------------------------

select tests.as_user('test-aj2d-admin@example.com');

select is(
  (public.create_shift('f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1',
                       app.today() + 20, '08:00', '12:00', 2::smallint, null, 'Llevar llave') -> 'shift' ->> 'show_in_print'),
  'true', 'create_shift: la casilla nace tildada por defecto'
);
select is(
  (public.create_shift('f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1',
                       app.today() + 21, '08:00', '12:00', 2::smallint, null, 'Solo interna', false, false) -> 'shift' ->> 'show_in_print'),
  'false', 'create_shift: p_show_in_print = false destilda la casilla'
);
select is(
  (select count(*)::int from public.shift_observations o join public.shifts sh on sh.id = o.shift_id where sh.shift_date = app.today() + 20 and o.observation = 'Llevar llave'),
  1, 'create_shift: guarda la observación en shift_observations'
);
select is(
  (select count(*)::int from public.shifts where shift_date in (app.today() + 20, app.today() + 21) and notes is not null), 0,
  'create_shift: no escribe en shifts.notes'
);
select is(
  (select (public.create_shift('f4400000-0000-0000-0000-0000000000c1', 'f4400000-0000-0000-0000-0000000000a1',
                       app.today() + 22, '08:00', '12:00', 2::smallint) -> 'shift' ->> 'notes')),
  null, 'create_shift sin observación: notes null en el objeto devuelto'
);
select is(
  (select (public.update_shift_details('f4400000-0000-0000-0000-000000000051', 2::smallint, 'Obs nueva', false)).notes),
  'Obs nueva', 'update_shift_details: devuelve la observación en notes'
);
select is(
  (select show_in_print from public.shift_observations where shift_id = 'f4400000-0000-0000-0000-000000000051'),
  false, 'update_shift_details: p_show_in_print = false destilda'
);
select is(
  (select notes from public.update_shift_details('f4400000-0000-0000-0000-000000000051', 2::smallint, 'Obs nueva 2')),
  'Obs nueva 2', 'update_shift_details: guarda la observación'
);
select is(
  (select show_in_print from public.shift_observations where shift_id = 'f4400000-0000-0000-0000-000000000051'),
  false, 'update_shift_details: sin el parámetro la casilla no cambia'
);
select is(
  (select count(*)::int from public.update_shift_details('f4400000-0000-0000-0000-000000000051', 2::smallint, 'Obs nueva 2', true) where id is not null),
  1, 'update_shift_details: p_show_in_print = true se acepta'
);
select is(
  (select show_in_print from public.shift_observations where shift_id = 'f4400000-0000-0000-0000-000000000051'),
  true, 'update_shift_details: p_show_in_print = true tilda'
);

select is(
  (select notes from public.v_shifts_board where id = 'f4400000-0000-0000-0000-000000000051'),
  'Obs nueva 2', 'administrador: v_shifts_board muestra la observación'
);
select is(
  (select show_in_print from public.v_shifts_board where id = 'f4400000-0000-0000-0000-000000000051'),
  true, 'administrador: v_shifts_board muestra la casilla'
);

-- Impresión: planilla de asistencia y resumen del cliente ----------------------------------------------

select is(
  (select shift_observation from public.v_assignments_board where id = 'f4400000-0000-0000-0000-000000000063'),
  'Obs impresa', 'administrador: v_assignments_board.shift_observation trae la observación si la casilla está tildada'
);
select is(
  (select shift_observation from public.v_assignments_board where id = 'f4400000-0000-0000-0000-000000000064'),
  null, 'administrador: v_assignments_board.shift_observation es null si la casilla está destildada'
);
select is(
  (public.client_service_summary('f4400000-0000-0000-0000-0000000000c1', app.today() - 3, app.today() - 1) -> 'shifts' -> 0 ->> 'observation'),
  'Obs impresa', 'client_service_summary: el turno con la casilla tildada trae observation'
);
select is(
  (public.client_service_summary('f4400000-0000-0000-0000-0000000000c1', app.today() - 3, app.today() - 1) -> 'shifts' -> 1 ->> 'observation'),
  null, 'client_service_summary: el turno con la casilla destildada trae observation null'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     public.client_service_summary('f4400000-0000-0000-0000-0000000000c1', app.today() - 3, app.today() - 1) -> 'shifts' -> 0) k),
  array['employees', 'end_time', 'observation', 'open_ended', 'planned_minutes', 'shift_date', 'shift_id', 'site_id', 'site_name', 'start_time', 'status', 'worked_minutes'],
  'client_service_summary: cada turno conserva sus campos y suma observation'
);

select * from finish();

rollback;
