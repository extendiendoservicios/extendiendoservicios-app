-- pgTAP de la migración 0026_rpc_attendance.sql (ATT-001 a ATT-004, F13 · App del empleado,
-- P13.1): record_check_in, record_check_out (con y sin ubicación, todos los rechazos), las
-- transiciones de asignación y de turno (incluido un turno con dos empleados), set_assignment_notes
-- por rol y con turno completado, v_my_day por rol (7 días y changed_since_last_seen), y que el
-- empleado no pueda escribir attendance_records directo por PostgREST.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2600000-...'.
--
-- Ojo con las fechas (nota de 12_Registro_de_Progreso.md, "Los pgTAP corren contra App_dev"):
-- a diferencia del resto de las RPC del proyecto, record_check_in/record_check_out dependen de
-- "hoy" (P-068: fecha del turno = hoy, Argentina) y no admiten fechas fijas en 2199 como el resto
-- de los archivos de test. Se usa `app.today()` (la misma función que usan las RPC) para calcular
-- las fechas de los turnos de este archivo, en vez de `current_date`, para no depender de en qué
-- huso horario corre la sesión de psql/pg_prove -- así "hoy" del test es exactamente "hoy" para
-- las RPC. Los empleados de este archivo son fixtures propios (perfiles nuevos), así que un turno
-- con fecha real de hoy no puede chocar con la restricción de exclusión de ningún dato real: esa
-- restricción es por `employee_id`, y ningún empleado real de `App_dev` tiene estos ids.

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

select plan(49);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'record_check_in', array['uuid', 'numeric', 'numeric', 'numeric'], 'existe public.record_check_in(uuid, numeric, numeric, numeric)');
select has_function('public', 'record_check_out', array['uuid', 'numeric', 'numeric', 'numeric'], 'existe public.record_check_out(uuid, numeric, numeric, numeric)');
select has_function('public', 'set_assignment_notes', array['uuid', 'text'], 'existe public.set_assignment_notes(uuid, text)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: un cliente activo con una sede activa; personas con los cuatro roles y varios
-- empleados dedicados a cada caso (para no arrastrar estado de un bloque al siguiente y para no
-- pisar la exclusión de superposición del mismo empleado).
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2600000-0000-0000-0000-000000000001', 'Cliente de asistencia', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2600000-0000-0000-0000-000000000011', 'e2600000-0000-0000-0000-000000000001', 'Sede de asistencia', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2600000-0000-0000-0000-000000000081', 'test-db026-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Asistencia')),
  ('e2600000-0000-0000-0000-000000000082', 'test-db026-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Asistencia')),
  ('e2600000-0000-0000-0000-000000000083', 'test-db026-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Asistencia')),
  ('e2600000-0000-0000-0000-000000000084', 'test-db026-emp-solo@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Solo')),
  ('e2600000-0000-0000-0000-000000000085', 'test-db026-emp-equipo-a@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'EquipoA')),
  ('e2600000-0000-0000-0000-000000000086', 'test-db026-emp-equipo-b@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'EquipoB')),
  ('e2600000-0000-0000-0000-000000000087', 'test-db026-emp-ajeno@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Ajeno')),
  ('e2600000-0000-0000-0000-000000000088', 'test-db026-emp-cancelado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Cancelado')),
  ('e2600000-0000-0000-0000-000000000089', 'test-db026-emp-otro-dia@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'OtroDia')),
  ('e2600000-0000-0000-0000-00000000008a', 'test-db026-emp-quitado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Quitado')),
  ('e2600000-0000-0000-0000-00000000008b', 'test-db026-emp-fin-sin-inicio@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'FinSinInicio')),
  ('e2600000-0000-0000-0000-00000000008c', 'test-db026-emp-coords@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Coords')),
  ('e2600000-0000-0000-0000-00000000008d', 'test-db026-emp-notas-abierto@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'NotasAbierto')),
  ('e2600000-0000-0000-0000-00000000008e', 'test-db026-emp-notas-completado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'NotasCompletado')),
  ('e2600000-0000-0000-0000-00000000008f', 'test-db026-emp-notas-ajeno@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'NotasAjeno')),
  ('e2600000-0000-0000-0000-000000000090', 'test-db026-emp-dia@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'MiDia'));

insert into public.user_roles (profile_id, role) values
  ('e2600000-0000-0000-0000-000000000081', 'owner'),
  ('e2600000-0000-0000-0000-000000000082', 'admin'),
  ('e2600000-0000-0000-0000-000000000083', 'supervisor'),
  ('e2600000-0000-0000-0000-000000000084', 'employee'),
  ('e2600000-0000-0000-0000-000000000085', 'employee'),
  ('e2600000-0000-0000-0000-000000000086', 'employee'),
  ('e2600000-0000-0000-0000-000000000087', 'employee'),
  ('e2600000-0000-0000-0000-000000000088', 'employee'),
  ('e2600000-0000-0000-0000-000000000089', 'employee'),
  ('e2600000-0000-0000-0000-00000000008a', 'employee'),
  ('e2600000-0000-0000-0000-00000000008b', 'employee'),
  ('e2600000-0000-0000-0000-00000000008c', 'employee'),
  ('e2600000-0000-0000-0000-00000000008d', 'employee'),
  ('e2600000-0000-0000-0000-00000000008e', 'employee'),
  ('e2600000-0000-0000-0000-00000000008f', 'employee'),
  ('e2600000-0000-0000-0000-000000000090', 'employee');

insert into public.employees (profile_id, dni) values
  ('e2600000-0000-0000-0000-000000000083', '92600083'),
  ('e2600000-0000-0000-0000-000000000084', '92600084'),
  ('e2600000-0000-0000-0000-000000000085', '92600085'),
  ('e2600000-0000-0000-0000-000000000086', '92600086'),
  ('e2600000-0000-0000-0000-000000000087', '92600087'),
  ('e2600000-0000-0000-0000-000000000088', '92600088'),
  ('e2600000-0000-0000-0000-000000000089', '92600089'),
  ('e2600000-0000-0000-0000-00000000008a', '92600091'),
  ('e2600000-0000-0000-0000-00000000008b', '92600092'),
  ('e2600000-0000-0000-0000-00000000008c', '92600093'),
  ('e2600000-0000-0000-0000-00000000008d', '92600094'),
  ('e2600000-0000-0000-0000-00000000008e', '92600095'),
  ('e2600000-0000-0000-0000-00000000008f', '92600096'),
  ('e2600000-0000-0000-0000-000000000090', '92600090');

-- ---------------------------------------------------------------------------------------------
-- Turnos de hoy (fecha = app.today(), P-068) -----------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno solo (emp-solo, dotación 1): feliz con ubicación, y base de "doble inicio"/"doble fin".
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000101', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '08:00', '16:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000201', 'e2600000-0000-0000-0000-000000000101', 'e2600000-0000-0000-0000-000000000084');

-- Turno de equipo (dos empleados, dotación 2): la transición a completed espera a los dos.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000102', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '09:00', '13:00', 2, 'assigned');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000202', 'e2600000-0000-0000-0000-000000000102', 'e2600000-0000-0000-0000-000000000085'),
  ('e2600000-0000-0000-0000-000000000203', 'e2600000-0000-0000-0000-000000000102', 'e2600000-0000-0000-0000-000000000086');

-- Turno cancelado de hoy (para SHIFT_CANCELLED en record_check_in).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2600000-0000-0000-0000-000000000103', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '10:00', '11:00', 1, 'cancelled', now(), 'e2600000-0000-0000-0000-000000000081', 'Cliente canceló el servicio');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000204', 'e2600000-0000-0000-0000-000000000103', 'e2600000-0000-0000-0000-000000000088');

-- Turno de otro día (mañana) -- NOT_TODAY.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000104', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today() + 1, '08:00', '12:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000205', 'e2600000-0000-0000-0000-000000000104', 'e2600000-0000-0000-0000-000000000089');

-- Asignación quitada (baja lógica) de un turno de hoy -- ASSIGNMENT_NOT_FOUND.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000105', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '14:00', '15:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id, removed_at, removed_by, removed_reason) values
  ('e2600000-0000-0000-0000-000000000206', 'e2600000-0000-0000-0000-000000000105', 'e2600000-0000-0000-0000-00000000008a', now(), 'e2600000-0000-0000-0000-000000000081', 'Se dio de baja para la prueba');

-- Turno para "fin sin inicio" / "doble fin" y coordenadas parciales/fuera de rango.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000106', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '16:30', '18:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000207', 'e2600000-0000-0000-0000-000000000106', 'e2600000-0000-0000-0000-00000000008b');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000107', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '18:15', '19:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000208', 'e2600000-0000-0000-0000-000000000107', 'e2600000-0000-0000-0000-00000000008c');

-- ---------------------------------------------------------------------------------------------
-- record_check_in ------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- ASSIGNMENT_NOT_FOUND: id inexistente.
select tests.as_user('test-db026-emp-solo@example.com');

prepare check_in_not_found as
  select public.record_check_in('00000000-0000-0000-0000-000000000000');

select throws_ok(
  'check_in_not_found', 'P0001', 'No encontramos esa asignación.',
  'record_check_in: id inexistente -> ASSIGNMENT_NOT_FOUND'
);

-- ASSIGNMENT_NOT_FOUND también sobre una asignación quitada.
prepare check_in_removed as
  select public.record_check_in('e2600000-0000-0000-0000-000000000206');

select throws_ok(
  'check_in_removed', 'P0001', 'No encontramos esa asignación.',
  'record_check_in: asignación quitada -> ASSIGNMENT_NOT_FOUND'
);

-- NOT_YOUR_ASSIGNMENT: otro empleado.
select tests.as_user('test-db026-emp-ajeno@example.com');

prepare check_in_ajena as
  select public.record_check_in('e2600000-0000-0000-0000-000000000201');

select throws_ok(
  'check_in_ajena', 'P0001', 'Esa asignación no es tuya.',
  'record_check_in: asignación de otro empleado -> NOT_YOUR_ASSIGNMENT'
);

-- SHIFT_CANCELLED.
select tests.as_user('test-db026-emp-cancelado@example.com');

prepare check_in_cancelado as
  select public.record_check_in('e2600000-0000-0000-0000-000000000204');

select throws_ok(
  'check_in_cancelado', 'P0001', 'Este turno está cancelado.',
  'record_check_in: turno cancelado -> SHIFT_CANCELLED'
);

-- NOT_TODAY.
select tests.as_user('test-db026-emp-otro-dia@example.com');

prepare check_in_otro_dia as
  select public.record_check_in('e2600000-0000-0000-0000-000000000205');

select throws_ok(
  'check_in_otro_dia', 'P0001', 'Este turno no es de hoy.',
  'record_check_in: turno de otro día -> NOT_TODAY'
);

-- COORDINATES_INCOMPLETE: solo latitud.
select tests.as_user('test-db026-emp-coords@example.com');

prepare check_in_coords_incompletas as
  select public.record_check_in('e2600000-0000-0000-0000-000000000208', -34.6);

select throws_ok(
  'check_in_coords_incompletas', 'P0001', 'Si mandás la ubicación, tiene que venir completa.',
  'record_check_in: solo latitud -> COORDINATES_INCOMPLETE'
);

-- COORDINATES_OUT_OF_RANGE: latitud fuera de rango.
prepare check_in_coords_fuera_de_rango as
  select public.record_check_in('e2600000-0000-0000-0000-000000000208', 999, -58.4, 10);

select throws_ok(
  'check_in_coords_fuera_de_rango', 'P0001', 'La ubicación recibida no es válida.',
  'record_check_in: latitud fuera de rango -> COORDINATES_OUT_OF_RANGE'
);

-- Feliz, con ubicación: emp-solo en su turno de dotación 1. El turno pasa a in_progress.
select tests.as_user('test-db026-emp-solo@example.com');

select is(
  (public.record_check_in('e2600000-0000-0000-0000-000000000201', -34.603722, -58.381592, 8.5)).kind::text,
  'check_in',
  'record_check_in: feliz con ubicación, inserta un registro check_in'
);

set local role postgres;

select is(
  (select status::text from public.assignments where id = 'e2600000-0000-0000-0000-000000000201'),
  'present',
  'record_check_in: la asignación pasa a present'
);

select is(
  (select status::text from public.shifts where id = 'e2600000-0000-0000-0000-000000000101'),
  'in_progress',
  'record_check_in: el turno (dotación 1, scheduled) pasa a in_progress con el primer inicio'
);

select is(
  (select latitude from public.attendance_records where assignment_id = 'e2600000-0000-0000-0000-000000000201' and kind = 'check_in'),
  -34.603722,
  'record_check_in: guarda la latitud recibida'
);

-- ALREADY_CHECKED_IN: doble inicio sobre la misma asignación.
select tests.as_user('test-db026-emp-solo@example.com');

prepare check_in_doble as
  select public.record_check_in('e2600000-0000-0000-0000-000000000201');

select throws_ok(
  'check_in_doble', 'P0001', 'Ya registraste el inicio.',
  'record_check_in: doble inicio -> ALREADY_CHECKED_IN'
);

-- Feliz, sin ubicación: turno de equipo, primer empleado. El turno (assigned, dotación 2) pasa a
-- in_progress con el primer inicio, aunque el segundo todavía no marcó nada.
select tests.as_user('test-db026-emp-equipo-a@example.com');

select is(
  (public.record_check_in('e2600000-0000-0000-0000-000000000202')).latitude,
  null,
  'record_check_in: feliz sin ubicación, no guarda coordenadas'
);

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2600000-0000-0000-0000-000000000102'),
  'in_progress',
  'record_check_in: el turno de equipo (assigned) también pasa a in_progress con el primer inicio'
);

-- ---------------------------------------------------------------------------------------------
-- record_check_out ------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- NOT_CHECKED_IN: fin sin inicio previo.
select tests.as_user('test-db026-emp-fin-sin-inicio@example.com');

prepare check_out_sin_inicio as
  select public.record_check_out('e2600000-0000-0000-0000-000000000207');

select throws_ok(
  'check_out_sin_inicio', 'P0001', 'Todavía no registraste el inicio.',
  'record_check_out: sin inicio previo -> NOT_CHECKED_IN'
);

-- NOT_YOUR_ASSIGNMENT.
select tests.as_user('test-db026-emp-ajeno@example.com');

prepare check_out_ajena as
  select public.record_check_out('e2600000-0000-0000-0000-000000000201');

select throws_ok(
  'check_out_ajena', 'P0001', 'Esa asignación no es tuya.',
  'record_check_out: asignación de otro empleado -> NOT_YOUR_ASSIGNMENT'
);

-- Feliz, con ubicación: emp-solo cierra su turno de dotación 1 -> completed (única asignación
-- vigente, ya finished).
select tests.as_user('test-db026-emp-solo@example.com');

select is(
  (public.record_check_out('e2600000-0000-0000-0000-000000000201', -34.603722, -58.381592, 12)).kind::text,
  'check_out',
  'record_check_out: feliz con ubicación, inserta un registro check_out'
);

set local role postgres;

select is(
  (select status::text from public.assignments where id = 'e2600000-0000-0000-0000-000000000201'),
  'finished',
  'record_check_out: la asignación pasa a finished'
);

select is(
  (select status::text from public.shifts where id = 'e2600000-0000-0000-0000-000000000101'),
  'completed',
  'record_check_out: el turno (dotación 1, única asignación) pasa a completed'
);

-- ALREADY_CHECKED_OUT: doble fin.
select tests.as_user('test-db026-emp-solo@example.com');

prepare check_out_doble as
  select public.record_check_out('e2600000-0000-0000-0000-000000000201');

select throws_ok(
  'check_out_doble', 'P0001', 'Ya registraste el fin.',
  'record_check_out: doble fin -> ALREADY_CHECKED_OUT'
);

-- Turno de equipo: el primer empleado cierra y el turno NO se completa porque el segundo todavía
-- no marcó nada (04 sección 6.1: recién completed cuando TODAS las vigentes están finished o
-- absence_notified).
select tests.as_user('test-db026-emp-equipo-a@example.com');

select is(
  (public.record_check_out('e2600000-0000-0000-0000-000000000202')).kind::text,
  'check_out',
  'record_check_out: primer empleado del equipo cierra su asignación'
);

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2600000-0000-0000-0000-000000000102'),
  'in_progress',
  'record_check_out: el turno de equipo sigue in_progress -- falta el segundo empleado'
);

-- Segundo empleado del equipo marca inicio y fin: recién ahí el turno pasa a completed.
select tests.as_user('test-db026-emp-equipo-b@example.com');

select public.record_check_in('e2600000-0000-0000-0000-000000000203');
select public.record_check_out('e2600000-0000-0000-0000-000000000203');

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2600000-0000-0000-0000-000000000102'),
  'completed',
  'record_check_out: con los dos empleados finished, recién ahí el turno de equipo pasa a completed'
);

-- COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE también en record_check_out: se registra el
-- inicio del turno 0107 (emp-coords) y se prueban los dos rechazos antes del fin correcto.
select tests.as_user('test-db026-emp-coords@example.com');

select public.record_check_in('e2600000-0000-0000-0000-000000000208');

prepare check_out_coords_incompletas as
  select public.record_check_out('e2600000-0000-0000-0000-000000000208', -34.6, -58.4);

select throws_ok(
  'check_out_coords_incompletas', 'P0001', 'Si mandás la ubicación, tiene que venir completa.',
  'record_check_out: coordenadas parciales -> COORDINATES_INCOMPLETE'
);

prepare check_out_coords_fuera_de_rango as
  select public.record_check_out('e2600000-0000-0000-0000-000000000208', -34.6, 999, 5);

select throws_ok(
  'check_out_coords_fuera_de_rango', 'P0001', 'La ubicación recibida no es válida.',
  'record_check_out: longitud fuera de rango -> COORDINATES_OUT_OF_RANGE'
);

select is(
  (public.record_check_out('e2600000-0000-0000-0000-000000000208', -34.6, -58.4, 5)).kind::text,
  'check_out',
  'record_check_out: feliz con ubicación después de los rechazos'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- set_assignment_notes --------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno abierto (no completed) para emp-notas-abierto.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000108', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '20:00', '21:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-000000000209', 'e2600000-0000-0000-0000-000000000108', 'e2600000-0000-0000-0000-00000000008d');

-- Turno ya completed para emp-notas-completado.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-000000000109', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '05:00', '06:00', 1, 'completed');
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2600000-0000-0000-0000-00000000020a', 'e2600000-0000-0000-0000-000000000109', 'e2600000-0000-0000-0000-00000000008e', 'finished');

-- ASSIGNMENT_NOT_FOUND.
select tests.as_user('test-db026-emp-notas-abierto@example.com');

prepare notes_not_found as
  select public.set_assignment_notes('00000000-0000-0000-0000-000000000000', 'Todo bien');

select throws_ok(
  'notes_not_found', 'P0001', 'No encontramos esa asignación.',
  'set_assignment_notes: id inexistente -> ASSIGNMENT_NOT_FOUND'
);

-- Feliz: el propio empleado, turno no completed.
select is(
  (public.set_assignment_notes('e2600000-0000-0000-0000-000000000209', 'Sin novedades')).notes,
  'Sin novedades',
  'set_assignment_notes: el empleado carga su propia observación'
);

-- Texto vacío (solo espacios) se guarda como null.
select is(
  (public.set_assignment_notes('e2600000-0000-0000-0000-000000000209', '   ')).notes,
  null,
  'set_assignment_notes: texto vacío se guarda como null'
);

-- NOTES_TOO_LONG.
prepare notes_muy_larga as
  select public.set_assignment_notes('e2600000-0000-0000-0000-000000000209', repeat('a', 2001));

select throws_ok(
  'notes_muy_larga', 'P0001', 'La observación es demasiado larga (máximo 2000 caracteres).',
  'set_assignment_notes: más de 2000 caracteres -> NOTES_TOO_LONG'
);

-- FORBIDDEN: otro empleado sobre una asignación ajena.
select tests.as_user('test-db026-emp-notas-ajeno@example.com');

prepare notes_ajena as
  select public.set_assignment_notes('e2600000-0000-0000-0000-000000000209', 'Intento ajeno');

select throws_ok(
  'notes_ajena', 'P0001', 'No tenés permiso para hacer esto.',
  'set_assignment_notes: empleado sobre asignación ajena -> FORBIDDEN'
);

-- FORBIDDEN: supervisor.
select tests.as_user('test-db026-supervisora@example.com');

prepare notes_supervisor as
  select public.set_assignment_notes('e2600000-0000-0000-0000-000000000209', 'Intento supervisor');

select throws_ok(
  'notes_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'set_assignment_notes: supervisor -> FORBIDDEN'
);

-- SHIFT_COMPLETED: el propio empleado, pero el turno ya terminó.
select tests.as_user('test-db026-emp-notas-completado@example.com');

prepare notes_completado as
  select public.set_assignment_notes('e2600000-0000-0000-0000-00000000020a', 'Demasiado tarde');

select throws_ok(
  'notes_completado', 'P0001', 'Este turno ya terminó.',
  'set_assignment_notes: turno completed -> SHIFT_COMPLETED para el empleado'
);

-- O y A sí pueden, aunque el turno esté completed y aunque la asignación no sea propia.
select tests.as_user('test-db026-owner@example.com');

select is(
  (public.set_assignment_notes('e2600000-0000-0000-0000-00000000020a', 'Cargado por el dueño')).notes,
  'Cargado por el dueño',
  'set_assignment_notes: el owner puede editar aunque el turno esté completed'
);

select tests.as_user('test-db026-admin@example.com');

select is(
  (public.set_assignment_notes('e2600000-0000-0000-0000-00000000020a', 'Cargado por admin')).notes,
  'Cargado por admin',
  'set_assignment_notes: el admin puede editar aunque el turno esté completed'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- v_my_day por rol, 7 días y changed_since_last_seen ---------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Tres turnos para emp-dia: hoy, dentro de los 7 días (límite exacto) y fuera de los 7 días.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2600000-0000-0000-0000-00000000010a', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today(), '07:00', '08:00', 1, 'scheduled'),
  ('e2600000-0000-0000-0000-00000000010b', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today() + 7, '07:00', '08:00', 1, 'scheduled'),
  ('e2600000-0000-0000-0000-00000000010c', 'e2600000-0000-0000-0000-000000000001', 'e2600000-0000-0000-0000-000000000011', app.today() + 8, '07:00', '08:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2600000-0000-0000-0000-00000000020b', 'e2600000-0000-0000-0000-00000000010a', 'e2600000-0000-0000-0000-000000000090'),
  ('e2600000-0000-0000-0000-00000000020c', 'e2600000-0000-0000-0000-00000000010b', 'e2600000-0000-0000-0000-000000000090'),
  ('e2600000-0000-0000-0000-00000000020d', 'e2600000-0000-0000-0000-00000000010c', 'e2600000-0000-0000-0000-000000000090');

select tests.as_user('test-db026-emp-dia@example.com');

select is(
  (select count(*)::int from public.v_my_day),
  2,
  'v_my_day: solo hoy y hasta 7 días -- el turno de 8 días no aparece'
);

select is(
  (select bool_and(is_today = (shift_date = app.today())) from public.v_my_day),
  true,
  'v_my_day: is_today coincide con shift_date = app.today()'
);

-- Otro empleado no ve las asignaciones de emp-dia.
select tests.as_user('test-db026-emp-solo@example.com');

select is(
  (select count(*)::int from public.v_my_day
    where shift_id = any(array['e2600000-0000-0000-0000-00000000010a'::uuid, 'e2600000-0000-0000-0000-00000000010b'])),
  0,
  'v_my_day: un empleado no ve las asignaciones de otro (filtra employee_id = auth.uid())'
);

-- changed_since_last_seen: nunca abrió Hoy (last_seen_changes_at null) -> todo cambiado.
select tests.as_user('test-db026-emp-dia@example.com');

select is(
  (select bool_and(changed_since_last_seen) from public.v_my_day),
  true,
  'v_my_day: changed_since_last_seen es true antes de la primera visita (last_seen_changes_at null, P-092)'
);

select public.mark_changes_seen();

select is(
  (select changed_since_last_seen from public.v_my_day where shift_id = 'e2600000-0000-0000-0000-00000000010a'),
  false,
  'v_my_day: changed_since_last_seen pasa a false después de mark_changes_seen()'
);

-- Un cambio posterior a la visita vuelve a marcar la fila como cambiada. Ojo: dentro de una
-- misma transacción `now()` es constante (transaction timestamp de Postgres, no el reloj de
-- pared) -- el `last_seen_changes_at` que acaba de fijar `mark_changes_seen()` y cualquier
-- `updated_at` que ponga el trigger `app.set_updated_at` en esta misma transacción comparten
-- exactamente el mismo instante (probado: intentarlo con un `update` directo que fuerza
-- `updated_at = now() + interval '1 second'` no sirve, porque el trigger BEFORE UPDATE lo
-- pisa con su propio `now()` de todas formas). Para probar la rama "> last_seen_changes_at" de la
-- fórmula con una llamada real a `set_assignment_notes` (no un `update` a mano), se retrocede
-- `last_seen_changes_at` a una hora antes (como `postgres`, simulando "la última vez que abrió
-- Hoy fue hace un rato") y recién ahí se hace el cambio.
set local role postgres;

update public.profiles
set last_seen_changes_at = now() - interval '1 hour'
where id = 'e2600000-0000-0000-0000-000000000090';

select tests.as_user('test-db026-emp-dia@example.com');

select public.set_assignment_notes('e2600000-0000-0000-0000-00000000020b', 'Aviso para mí misma');

select is(
  (select changed_since_last_seen from public.v_my_day where shift_id = 'e2600000-0000-0000-0000-00000000010a'),
  true,
  'v_my_day: un cambio posterior a last_seen_changes_at vuelve a marcar changed_since_last_seen (P-092)'
);

select is(
  (select check_in_at from public.v_my_day where shift_id = 'e2600000-0000-0000-0000-00000000010a'),
  null,
  'v_my_day: check_in_at es null antes de registrar el inicio'
);

select public.record_check_in('e2600000-0000-0000-0000-00000000020b');

select ok(
  (select check_in_at is not null from public.v_my_day where shift_id = 'e2600000-0000-0000-0000-00000000010a'),
  'v_my_day: check_in_at queda cargado después de record_check_in'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- El empleado no puede insertar ni modificar attendance_records directo por PostgREST -----------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db026-emp-solo@example.com');

prepare attendance_records_insert_directo as
  insert into public.attendance_records (assignment_id, kind, recorded_at, source)
  values ('e2600000-0000-0000-0000-000000000201', 'check_in', now(), 'employee_app');

select throws_ok(
  'attendance_records_insert_directo', '42501', null,
  'attendance_records: un empleado no puede insertar directo (04 sección 7.2: "RPC", sin privilegio de insert para authenticated, 0017_grants.sql)'
);

prepare attendance_records_update_directo as
  update public.attendance_records set latitude = 0 where assignment_id = 'e2600000-0000-0000-0000-000000000201';

select throws_ok(
  'attendance_records_update_directo', '42501', null,
  'attendance_records: un empleado no puede actualizar directo (04 sección 7.2: "RPC", sin privilegio de update para authenticated, 0017_grants.sql)'
);

-- Tampoco puede escribir assignments.notes directo: 0026 revocó el mecanismo de escritura
-- directa que había dejado preparado 0012/0017 (ver el comentario de la migración).
prepare assignments_notes_update_directo as
  update public.assignments set notes = 'Intento directo' where id = 'e2600000-0000-0000-0000-000000000201';

select throws_ok(
  'assignments_notes_update_directo', '42501', null,
  'assignments: un empleado ya no puede actualizar notes directo -- 0026 lo reemplaza por set_assignment_notes'
);

set local role postgres;

select * from finish();

rollback;
