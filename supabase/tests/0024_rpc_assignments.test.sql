-- pgTAP de la migración 0024_rpc_assignments.sql (ASSIGN-002 a ASSIGN-004, ASSIGN-006, F11 ·
-- Asignaciones y cronograma, P11.1): assign_employee, remove_assignment, update_assignment_time,
-- update_shift_details, las transiciones scheduled <-> assigned y los permisos por rol.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2400000-...'. Fechas en
-- 2199 para los turnos "normales" (fuera del rango real de uso, ver `12_Registro_de_Progreso.md`
-- sección "Pendiente"); los turnos que necesitan estar "ya empezados" (SHIFT_STARTED /
-- ASSIGNMENT_STARTED) usan `current_date - 1` con franja `00:00-23:59`, calculada en SQL (no un
-- literal), así siempre quedan en el pasado sin importar cuándo corra el test -- service_id nulo
-- en todos los turnos de este archivo, así que no interfiere con la unicidad
-- (service_id, shift_date), que solo aplica a turnos generados por un servicio.

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

select plan(48);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'assign_employee', array['uuid', 'uuid', 'time', 'time'], 'existe public.assign_employee(...)');
select has_function('public', 'remove_assignment', array['uuid', 'text'], 'existe public.remove_assignment(uuid, text)');
select has_function('public', 'update_assignment_time', array['uuid', 'time', 'time'], 'existe public.update_assignment_time(uuid, time, time)');
select has_function('public', 'update_shift_details', array['uuid', 'smallint', 'text'], 'existe public.update_shift_details(uuid, smallint, text)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: dos clientes (para NOT_ENABLED_FOR_CLIENT), una sede, personas con los cuatro roles
-- y las capacidades relevantes (manage_attendance), y varios empleados con distintas condiciones
-- (sin restricciones, licencia vigente, disponibilidad declarada para otro día, inactivo).
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2400000-0000-0000-0000-000000000001', 'Cliente de asignaciones', 'active'),
  ('e2400000-0000-0000-0000-000000000002', 'Otro cliente de asignaciones', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e2400000-0000-0000-0000-000000000011', 'e2400000-0000-0000-0000-000000000001', 'Sede de asignaciones', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2400000-0000-0000-0000-000000000081', 'test-db024-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Asig')),
  ('e2400000-0000-0000-0000-000000000082', 'test-db024-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('e2400000-0000-0000-0000-000000000083', 'test-db024-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('e2400000-0000-0000-0000-000000000084', 'test-db024-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e2400000-0000-0000-0000-000000000085', 'test-db024-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('e2400000-0000-0000-0000-000000000091', 'test-db024-e-sin-restricciones@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Restricciones')),
  ('e2400000-0000-0000-0000-000000000092', 'test-db024-e-no-habilitado@example.com', jsonb_build_object('first_name', 'No', 'last_name', 'Habilitado')),
  ('e2400000-0000-0000-0000-000000000093', 'test-db024-e-fuera-disp@example.com', jsonb_build_object('first_name', 'Fuera', 'last_name', 'Disponibilidad')),
  ('e2400000-0000-0000-0000-000000000094', 'test-db024-e-licencia@example.com', jsonb_build_object('first_name', 'De', 'last_name', 'Licencia')),
  ('e2400000-0000-0000-0000-000000000095', 'test-db024-e-inactivo@example.com', jsonb_build_object('first_name', 'Ex', 'last_name', 'Empleado')),
  ('e2400000-0000-0000-0000-000000000096', 'test-db024-e-full-1@example.com', jsonb_build_object('first_name', 'Full', 'last_name', 'Uno')),
  ('e2400000-0000-0000-0000-000000000097', 'test-db024-e-full-2@example.com', jsonb_build_object('first_name', 'Full', 'last_name', 'Dos')),
  ('e2400000-0000-0000-0000-000000000098', 'test-db024-e-overlap@example.com', jsonb_build_object('first_name', 'Over', 'last_name', 'Lap'));

insert into public.user_roles (profile_id, role) values
  ('e2400000-0000-0000-0000-000000000081', 'owner'),
  ('e2400000-0000-0000-0000-000000000082', 'admin'),
  ('e2400000-0000-0000-0000-000000000083', 'admin'),
  ('e2400000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2400000-0000-0000-0000-000000000085', 'employee');

-- admin-con-cap tiene manage_attendance; admin-sin-cap no.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2400000-0000-0000-0000-000000000082', 'manage_attendance', true),
  ('e2400000-0000-0000-0000-000000000083', 'manage_attendance', false);

insert into public.employees (profile_id, dni, status) values
  ('e2400000-0000-0000-0000-000000000084', '92400084', 'active'),
  ('e2400000-0000-0000-0000-000000000085', '92400085', 'active'),
  ('e2400000-0000-0000-0000-000000000091', '92400091', 'active'),
  ('e2400000-0000-0000-0000-000000000092', '92400092', 'active'),
  ('e2400000-0000-0000-0000-000000000093', '92400093', 'active'),
  ('e2400000-0000-0000-0000-000000000094', '92400094', 'active'),
  ('e2400000-0000-0000-0000-000000000095', '92400095', 'terminated'),
  ('e2400000-0000-0000-0000-000000000096', '92400096', 'active'),
  ('e2400000-0000-0000-0000-000000000097', '92400097', 'active'),
  ('e2400000-0000-0000-0000-000000000098', '92400098', 'active');

-- e-no-habilitado (0092) solo está habilitado para el OTRO cliente (0002): al asignarlo al turno
-- del cliente 0001 tiene que advertir NOT_ENABLED_FOR_CLIENT (P-034).
insert into public.employee_client_permissions (employee_id, client_id) values
  ('e2400000-0000-0000-0000-000000000092', 'e2400000-0000-0000-0000-000000000002');

-- e-fuera-disp (0093) solo declaró disponibilidad los domingos (0) de 00:00 a 01:00: el turno de
-- prueba (2199-04-02, martes) cae fuera -> OUTSIDE_AVAILABILITY (P-035).
insert into public.employee_availability (employee_id, weekday, start_time, end_time) values
  ('e2400000-0000-0000-0000-000000000093', 0, '00:00', '01:00');

-- e-licencia (0094) está de licencia abierta desde 2199-01-01: cualquier turno de 2199 cae
-- dentro -> ON_LEAVE (P-033).
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('e2400000-0000-0000-0000-000000000094', '2199-01-01', null, 'Licencia de prueba 0024');

-- ---------------------------------------------------------------------------------------------
-- assign_employee -------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-02', '08:00', '12:00', 2, 'scheduled');

-- Permisos: un supervisor y un empleado no pueden llamarla.
select tests.as_user('test-db024-supervisora@example.com');

prepare assign_as_supervisor as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'assign_employee: supervisor no puede (FORBIDDEN)');

select tests.as_user('test-db024-empleado@example.com');

prepare assign_as_employee as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_as_employee', 'P0001', 'No tenés permiso para hacer esto.', 'assign_employee: empleado no puede (FORBIDDEN)');

set local role postgres;

-- Empleado inactivo -> EMPLOYEE_NOT_ACTIVE.
select tests.as_user('test-db024-owner@example.com');

prepare assign_inactive as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000095');

select throws_ok('assign_inactive', 'P0001', 'Ese empleado no está activo.', 'assign_employee: empleado terminated -> EMPLOYEE_NOT_ACTIVE');

-- Franja propia fuera de la del turno -> ASSIGNMENT_TIME_OUT_OF_SHIFT.
prepare assign_out_of_shift as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000091', '07:00', '10:00');

select throws_ok('assign_out_of_shift', 'P0001', 'La franja de la asignación tiene que estar dentro de la del turno.', 'assign_employee: franja propia antes del inicio del turno -> ASSIGNMENT_TIME_OUT_OF_SHIFT');

-- Alta correcta sin advertencias (empleado sin restricciones).
select is(
  (public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000091') ->> 'warnings')::jsonb,
  '[]'::jsonb,
  'assign_employee: sin advertencias para un empleado sin restricciones'
);

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2400000-0000-0000-0000-000000000041'),
  'scheduled',
  'assign_employee: con una sola asignación (dotación 2) el turno sigue scheduled'
);

-- Ya asignado a este turno -> ALREADY_ASSIGNED.
select tests.as_user('test-db024-owner@example.com');

prepare assign_already as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_already', 'P0001', 'Ese empleado ya está asignado a este turno.', 'assign_employee: mismo empleado, mismo turno -> ALREADY_ASSIGNED');

-- Advertencia NOT_ENABLED_FOR_CLIENT: el segundo lugar del turno lo completa y trae la advertencia.
select is(
  (public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000092') ->> 'warnings')::jsonb,
  '["NOT_ENABLED_FOR_CLIENT"]'::jsonb,
  'assign_employee: empleado habilitado solo para otro cliente -> advierte NOT_ENABLED_FOR_CLIENT (no bloquea, P-034)'
);

set local role postgres;

-- Con las dos asignaciones vigentes, la dotación (2) se completó -> el turno pasa a assigned.
select is(
  (select status::text from public.shifts where id = 'e2400000-0000-0000-0000-000000000041'),
  'assigned',
  'assign_employee: al completar la dotación, el turno pasa a assigned (04 sección 6.1)'
);

-- Cupo lleno -> SHIFT_FULL.
select tests.as_user('test-db024-owner@example.com');

prepare assign_full as
  select public.assign_employee('e2400000-0000-0000-0000-000000000041', 'e2400000-0000-0000-0000-000000000096');

select throws_ok('assign_full', 'P0001', 'El turno ya tiene la dotación completa.', 'assign_employee: dotación completa -> SHIFT_FULL');

set local role postgres;

-- Turno aparte, dotación 1, para probar OUTSIDE_AVAILABILITY y ON_LEAVE por separado.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000043', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-02', '14:00', '16:00', 1, 'scheduled'),
  ('e2400000-0000-0000-0000-000000000044', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-02', '17:00', '19:00', 1, 'scheduled');

select tests.as_user('test-db024-owner@example.com');

select is(
  (public.assign_employee('e2400000-0000-0000-0000-000000000043', 'e2400000-0000-0000-0000-000000000093') ->> 'warnings')::jsonb,
  '["OUTSIDE_AVAILABILITY"]'::jsonb,
  'assign_employee: disponibilidad declarada solo otro día -> advierte OUTSIDE_AVAILABILITY (P-035)'
);

select is(
  (public.assign_employee('e2400000-0000-0000-0000-000000000044', 'e2400000-0000-0000-0000-000000000094') ->> 'warnings')::jsonb,
  '["ON_LEAVE"]'::jsonb,
  'assign_employee: empleado de licencia vigente el día del turno -> advierte ON_LEAVE (P-033)'
);

set local role postgres;

-- ASSIGNMENT_OVERLAP: mismo empleado, dos turnos que se pisan en horario.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000045', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-03', '08:00', '12:00', 1, 'scheduled'),
  ('e2400000-0000-0000-0000-000000000046', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-03', '11:00', '15:00', 1, 'scheduled');

select tests.as_user('test-db024-owner@example.com');

select public.assign_employee('e2400000-0000-0000-0000-000000000045', 'e2400000-0000-0000-0000-000000000098');

prepare assign_overlap as
  select public.assign_employee('e2400000-0000-0000-0000-000000000046', 'e2400000-0000-0000-0000-000000000098');

select throws_ok('assign_overlap', 'P0001', 'El empleado ya tiene otro turno en ese horario.', 'assign_employee: dos turnos que se pisan para el mismo empleado -> ASSIGNMENT_OVERLAP');

set local role postgres;

-- SHIFT_STARTED: turno ya empezado (ayer, 00:00-23:59, siempre en el pasado). Un admin sin
-- manage_attendance no puede asignar; uno con la capacidad sí.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2400000-0000-0000-0000-000000000047', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011',
       (current_date - 1), '00:00'::time, '23:59'::time, 1, 'scheduled';

select tests.as_user('test-db024-admin-sin-cap@example.com');

prepare assign_shift_started_no_cap as
  select public.assign_employee('e2400000-0000-0000-0000-000000000047', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_shift_started_no_cap', 'P0001', 'El turno ya empezó.', 'assign_employee: turno ya empezó, admin sin manage_attendance -> SHIFT_STARTED');

select tests.as_user('test-db024-admin-con-cap@example.com');

select isnt(
  (public.assign_employee('e2400000-0000-0000-0000-000000000047', 'e2400000-0000-0000-0000-000000000091') -> 'assignment' ->> 'id'),
  null,
  'assign_employee: turno ya empezó, admin CON manage_attendance sí puede asignar'
);

set local role postgres;

-- SHIFT_CANCELLED / SHIFT_COMPLETED.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2400000-0000-0000-0000-000000000048', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-05', '08:00', '12:00', 1, 'cancelled', now(), 'e2400000-0000-0000-0000-000000000081', 'motivo de prueba');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000049', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-05', '13:00', '17:00', 1, 'completed');

select tests.as_user('test-db024-owner@example.com');

prepare assign_cancelled as
  select public.assign_employee('e2400000-0000-0000-0000-000000000048', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_cancelled', 'P0001', 'Este turno está cancelado.', 'assign_employee: turno cancelado -> SHIFT_CANCELLED');

prepare assign_completed as
  select public.assign_employee('e2400000-0000-0000-0000-000000000049', 'e2400000-0000-0000-0000-000000000091');

select throws_ok('assign_completed', 'P0001', 'Este turno ya terminó.', 'assign_employee: turno finalizado -> SHIFT_COMPLETED');

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- remove_assignment -------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Turno con dotación 2 y las dos asignaciones vigentes (ya en assigned, ver arriba): quitar una
-- devuelve el turno a scheduled.
select tests.as_user('test-db024-owner@example.com');

prepare remove_no_reason as
  select public.remove_assignment(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000041' and employee_id = 'e2400000-0000-0000-0000-000000000092'),
    ''
  );

select throws_ok('remove_no_reason', 'P0001', 'Indicá el motivo.', 'remove_assignment: motivo vacío -> REASON_REQUIRED');

select is(
  (public.remove_assignment(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000041' and employee_id = 'e2400000-0000-0000-0000-000000000092'),
    'Ya no hace falta'
  )).removed_reason,
  'Ya no hace falta',
  'remove_assignment: baja lógica con motivo se aplica'
);

set local role postgres;

select is(
  (select status::text from public.shifts where id = 'e2400000-0000-0000-0000-000000000041'),
  'scheduled',
  'remove_assignment: al quedar incompleta la dotación, el turno vuelve a scheduled (04 sección 6.1)'
);

-- ASSIGNMENT_NOT_FOUND: la que acabamos de quitar, o cualquier id inexistente.
select tests.as_user('test-db024-owner@example.com');

prepare remove_not_found as
  select public.remove_assignment('00000000-0000-0000-0000-000000000000', 'motivo');

select throws_ok('remove_not_found', 'P0001', 'No encontramos esa asignación.', 'remove_assignment: id inexistente -> ASSIGNMENT_NOT_FOUND');

set local role postgres;

-- ASSIGNMENT_STARTED: asignación con check_in registrado (status present) no se puede quitar.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
select 'e2400000-0000-0000-0000-000000000050', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011',
       (current_date - 1), '00:00'::time, '23:59'::time, 1, 'in_progress';

insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2400000-0000-0000-0000-000000000051', 'e2400000-0000-0000-0000-000000000050', 'e2400000-0000-0000-0000-000000000096', 'present');

select tests.as_user('test-db024-admin-con-cap@example.com');

prepare remove_started as
  select public.remove_assignment('e2400000-0000-0000-0000-000000000051', 'motivo');

select throws_ok('remove_started', 'P0001', 'La asignación ya empezó: se cierra, no se puede quitar.', 'remove_assignment: status present -> ASSIGNMENT_STARTED (se usa close_assignment, F14)');

set local role postgres;

-- SHIFT_STARTED en remove_assignment: turno ya empezado, asignación todavía expected, admin sin
-- manage_attendance no puede quitarla; con la capacidad sí.
insert into public.assignments (id, shift_id, employee_id) values
  ('e2400000-0000-0000-0000-000000000052', 'e2400000-0000-0000-0000-000000000050', 'e2400000-0000-0000-0000-000000000097');

select tests.as_user('test-db024-admin-sin-cap@example.com');

prepare remove_shift_started_no_cap as
  select public.remove_assignment('e2400000-0000-0000-0000-000000000052', 'motivo');

select throws_ok('remove_shift_started_no_cap', 'P0001', 'El turno ya empezó.', 'remove_assignment: turno ya empezó, admin sin manage_attendance -> SHIFT_STARTED');

select tests.as_user('test-db024-admin-con-cap@example.com');

select isnt(
  (public.remove_assignment('e2400000-0000-0000-0000-000000000052', 'motivo')).removed_at,
  null,
  'remove_assignment: turno ya empezó, admin CON manage_attendance sí puede quitar'
);

set local role postgres;

-- Un turno cancelado conserva sus asignaciones (cancel_shift, 0023, no las toca): verificado acá
-- en el flujo completo de asignar -> cancelar.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000053', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-06', '08:00', '12:00', 1, 'scheduled');

select tests.as_user('test-db024-owner@example.com');

select public.assign_employee('e2400000-0000-0000-0000-000000000053', 'e2400000-0000-0000-0000-000000000091');
select public.cancel_shift('e2400000-0000-0000-0000-000000000053', 'Motivo de cancelación de prueba 0024');

set local role postgres;

select is(
  (select removed_at from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000053'),
  null::timestamptz,
  'cancel_shift + assign_employee: un turno cancelado conserva su asignación (no se toca, P-049)'
);

-- ---------------------------------------------------------------------------------------------
-- update_assignment_time -----------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000061', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-07', '08:00', '16:00', 1, 'scheduled');

select tests.as_user('test-db024-owner@example.com');

select public.assign_employee('e2400000-0000-0000-0000-000000000061', 'e2400000-0000-0000-0000-000000000091');

-- Un empleado no puede llamarla.
select tests.as_user('test-db024-empleado@example.com');

prepare update_assignment_time_as_employee as
  select public.update_assignment_time(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000061'),
    '09:00', '11:00'
  );

select throws_ok('update_assignment_time_as_employee', 'P0001', 'No tenés permiso para hacer esto.', 'update_assignment_time: empleado no puede (FORBIDDEN)');

set local role postgres;

select tests.as_user('test-db024-owner@example.com');

-- Franja propia fuera de la del turno -> ASSIGNMENT_TIME_OUT_OF_SHIFT.
prepare update_assignment_time_out_of_shift as
  select public.update_assignment_time(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000061'),
    '07:00', '11:00'
  );

select throws_ok('update_assignment_time_out_of_shift', 'P0001', 'La franja de la asignación tiene que estar dentro de la del turno.', 'update_assignment_time: franja fuera del turno -> ASSIGNMENT_TIME_OUT_OF_SHIFT');

-- Cambio válido.
select is(
  (public.update_assignment_time(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000061'),
    '09:00', '11:00'
  )).start_time::text,
  '09:00:00',
  'update_assignment_time: franja propia dentro del turno se aplica'
);

set local role postgres;

-- ASSIGNMENT_OVERLAP: mover la franja propia hace que se pise con otra asignación del mismo
-- empleado.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000062', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-07', '10:00', '18:00', 1, 'scheduled');

select tests.as_user('test-db024-owner@example.com');

select public.assign_employee('e2400000-0000-0000-0000-000000000062', 'e2400000-0000-0000-0000-000000000091', '12:00', '14:00');

prepare update_assignment_time_overlap as
  select public.update_assignment_time(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000061'),
    '11:00', '13:00'
  );

select throws_ok('update_assignment_time_overlap', 'P0001', 'El empleado ya tiene otro turno en ese horario.', 'update_assignment_time: nueva franja pisa otra asignación del mismo empleado -> ASSIGNMENT_OVERLAP');

set local role postgres;

-- ASSIGNMENT_STARTED: la franja ya empezó (turno de "ayer").
insert into public.assignments (id, shift_id, employee_id) values
  ('e2400000-0000-0000-0000-000000000063', 'e2400000-0000-0000-0000-000000000050', 'e2400000-0000-0000-0000-000000000098');

select tests.as_user('test-db024-owner@example.com');

prepare update_assignment_time_started as
  select public.update_assignment_time('e2400000-0000-0000-0000-000000000063', '10:00', '12:00');

select throws_ok('update_assignment_time_started', 'P0001', 'La asignación ya empezó.', 'update_assignment_time: franja efectiva ya empezó -> ASSIGNMENT_STARTED');

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- update_shift_details ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2400000-0000-0000-0000-000000000071', 'e2400000-0000-0000-0000-000000000001', 'e2400000-0000-0000-0000-000000000011', '2199-04-08', '08:00', '12:00', 2, 'scheduled');

insert into public.assignments (shift_id, employee_id) values
  ('e2400000-0000-0000-0000-000000000071', 'e2400000-0000-0000-0000-000000000091'),
  ('e2400000-0000-0000-0000-000000000071', 'e2400000-0000-0000-0000-000000000096');

update public.shifts set status = 'assigned' where id = 'e2400000-0000-0000-0000-000000000071';

-- Un supervisor no puede llamarla.
select tests.as_user('test-db024-supervisora@example.com');

prepare update_details_as_supervisor as
  select public.update_shift_details('e2400000-0000-0000-0000-000000000071', 2::smallint, 'nota');

select throws_ok('update_details_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.', 'update_shift_details: supervisor no puede (FORBIDDEN)');

set local role postgres;

select tests.as_user('test-db024-owner@example.com');

-- Fuera de rango -> REQUIRED_STAFF_RANGE.
prepare update_details_out_of_range as
  select public.update_shift_details('e2400000-0000-0000-0000-000000000071', 0::smallint, null);

select throws_ok('update_details_out_of_range', 'P0001', 'La dotación tiene que ser entre 1 y 10 personas.', 'update_shift_details: dotación fuera de 1..10 -> REQUIRED_STAFF_RANGE');

-- Por debajo de los asignados vigentes (hay 2) -> REQUIRED_STAFF_BELOW_ASSIGNED.
prepare update_details_below_assigned as
  select public.update_shift_details('e2400000-0000-0000-0000-000000000071', 1::smallint, null);

select throws_ok('update_details_below_assigned', 'P0001', 'No podés bajar la dotación por debajo de la cantidad de personas ya asignadas.', 'update_shift_details: dotación menor que los asignados -> REQUIRED_STAFF_BELOW_ASSIGNED');

-- Subir la dotación a 3 (con solo 2 asignados) devuelve el turno a scheduled.
select is(
  (public.update_shift_details('e2400000-0000-0000-0000-000000000071', 3::smallint, 'Se necesita una persona más')).status::text,
  'scheduled',
  'update_shift_details: al subir la dotación por encima de los asignados, el turno vuelve a scheduled'
);

set local role postgres;

select is(
  (select notes from public.shifts where id = 'e2400000-0000-0000-0000-000000000071'),
  'Se necesita una persona más',
  'update_shift_details: guarda las notas administrativas'
);

-- Bajarla de nuevo a 2 (igual a los asignados) vuelve a completar la dotación -> assigned.
select tests.as_user('test-db024-owner@example.com');

select is(
  (public.update_shift_details('e2400000-0000-0000-0000-000000000071', 2::smallint, null)).status::text,
  'assigned',
  'update_shift_details: al bajar la dotación hasta igualar los asignados, el turno pasa a assigned'
);

set local role postgres;

-- SHIFT_CANCELLED / SHIFT_COMPLETED / SHIFT_NOT_FOUND.
select tests.as_user('test-db024-owner@example.com');

prepare update_details_not_found as
  select public.update_shift_details('00000000-0000-0000-0000-000000000000', 1::smallint, null);

select throws_ok('update_details_not_found', 'P0001', 'No encontramos ese turno.', 'update_shift_details: turno inexistente -> SHIFT_NOT_FOUND');

prepare update_details_cancelled as
  select public.update_shift_details('e2400000-0000-0000-0000-000000000048', 1::smallint, null);

select throws_ok('update_details_cancelled', 'P0001', 'Este turno está cancelado.', 'update_shift_details: turno cancelado -> SHIFT_CANCELLED');

prepare update_details_completed as
  select public.update_shift_details('e2400000-0000-0000-0000-000000000049', 1::smallint, null);

select throws_ok('update_details_completed', 'P0001', 'Este turno ya terminó.', 'update_shift_details: turno finalizado -> SHIFT_COMPLETED');

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- Revisión del orquestador (P11.1): empleado dado de baja lógica, y quitar o reprogramar en un
-- turno cancelado o finalizado (sus asignaciones quedan para historia, P-049).
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2400000-0000-0000-0000-000000000099', 'test-db024-e-dado-de-baja@example.com', jsonb_build_object('first_name', 'Dado', 'last_name', 'DeBaja'));

-- status sigue en 'active', pero la fila tiene baja lógica.
insert into public.employees (profile_id, dni, status, deleted_at) values
  ('e2400000-0000-0000-0000-000000000099', '92400099', 'active', now());

-- Asignación en el turno finalizado (0049), cargada directo: por RPC no se puede.
insert into public.assignments (id, shift_id, employee_id) values
  ('e2400000-0000-0000-0000-000000000149', 'e2400000-0000-0000-0000-000000000049', 'e2400000-0000-0000-0000-000000000097');

select tests.as_user('test-db024-owner@example.com');

prepare assign_deleted_employee as
  select public.assign_employee('e2400000-0000-0000-0000-000000000071', 'e2400000-0000-0000-0000-000000000099');

select throws_ok('assign_deleted_employee', 'P0001', 'Ese empleado no está activo.', 'assign_employee: empleado con baja lógica (status active) -> EMPLOYEE_NOT_ACTIVE');

prepare remove_in_cancelled as
  select public.remove_assignment(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000053'),
    'motivo de prueba'
  );

select throws_ok('remove_in_cancelled', 'P0001', 'Este turno está cancelado.', 'remove_assignment: turno cancelado -> SHIFT_CANCELLED (la asignación queda para historia)');

prepare update_time_in_cancelled as
  select public.update_assignment_time(
    (select id from public.assignments where shift_id = 'e2400000-0000-0000-0000-000000000053'),
    '09:00'::time,
    null
  );

select throws_ok('update_time_in_cancelled', 'P0001', 'Este turno está cancelado.', 'update_assignment_time: turno cancelado -> SHIFT_CANCELLED');

prepare remove_in_completed as
  select public.remove_assignment('e2400000-0000-0000-0000-000000000149', 'motivo de prueba');

select throws_ok('remove_in_completed', 'P0001', 'Este turno ya terminó.', 'remove_assignment: turno finalizado -> SHIFT_COMPLETED');

prepare update_time_in_completed as
  select public.update_assignment_time('e2400000-0000-0000-0000-000000000149', '09:00'::time, null);

select throws_ok('update_time_in_completed', 'P0001', 'Este turno ya terminó.', 'update_assignment_time: turno finalizado -> SHIFT_COMPLETED');

set local role postgres;

select * from finish();

rollback;
