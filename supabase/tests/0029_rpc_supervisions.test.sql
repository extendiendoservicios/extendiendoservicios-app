-- pgTAP de la migración 0029_rpc_supervisions.sql (SUP-002 a SUP-007, F15 · Supervisiones,
-- P15.1), reescrito en P24.1 (0063, coordinación libre y jornada): rate_employee y
-- cancel_supervision, la ventana de edición de P-083 (incluido CB-14, "supervisor intenta calificar
-- al día siguiente"), la autocalificación rechazada de CB-13, la negativa del empleado sobre
-- ratings/rate_employee (P-084) y las columnas nuevas de v_supervisions_admin/v_my_supervisions
-- (SUP-006).
--
-- Qué cambió en P24.1: assign_supervision, supervision_check_in, supervision_check_out y
-- mark_supervision_not_done ya no se pueden ejecutar (CJ-01, CJ-26) y complete_supervision exige
-- calificar a todos (CJ-10, CJ-28) y registra el fin. Sus pruebas (asignar, iniciar, terminar,
-- «no realizada» y el cierre viejo) se quitaron de acá: el flujo nuevo (tomar, descartar, cerrar,
-- calificar a todos, dos coordinadores, validación de sede) está en
-- 0063_p24_1_supervision_libre.test.sql y las funciones revocadas se verifican ahí y en
-- 0063_p24_1_jornada_coordinador.test.sql. Las supervisiones de partida de este archivo se cargan
-- directo como postgres, en el estado que cada prueba necesita.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en rollback. Prefijo de fixtures propio de este archivo: 'e2900000-...'.
--
-- Ojo con las fechas: el turno "de ayer" (RATING_WINDOW_CLOSED, CB-14) usa app.today() - 1 a
-- propósito, para que el plazo de P-083 esté siempre vencido sin depender de la hora del día en
-- que corre el test.

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

select plan(34);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'assign_supervision', array['uuid', 'uuid'], 'existe public.assign_supervision(uuid, uuid) (revocada en 0063)');
select has_function('public', 'cancel_supervision', array['uuid', 'text'], 'existe public.cancel_supervision(uuid, text)');
select has_function('public', 'supervision_check_in', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'existe public.supervision_check_in(...) (revocada en 0063)');
select has_function('public', 'supervision_check_out', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'existe public.supervision_check_out(...) (revocada en 0063)');
select has_function('public', 'complete_supervision', array['uuid', 'text', 'numeric', 'numeric', 'numeric', 'text'], 'existe public.complete_supervision(uuid, text, numeric, numeric, numeric, text)');
select has_function('public', 'mark_supervision_not_done', array['uuid', 'text'], 'existe public.mark_supervision_not_done(uuid, text) (revocada en 0063)');
select has_function('public', 'rate_employee', array['uuid', 'uuid', 'integer', 'text'], 'existe public.rate_employee(uuid, uuid, integer, text)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: un cliente con una sede; owner, dos administradores (uno con las capacidades, otro
-- sin ninguna), dos supervisores (uno con relación, otro ajeno), un supervisor con la fila de
-- employees dada de baja (para SUPERVISOR_ROLE_REQUIRED) y tres empleados.
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2900000-0000-0000-0000-000000000001', 'Cliente de supervisiones', 'active');

insert into public.sites (id, client_id, name, address, city, latitude, longitude, contact_name, contact_phone, access_instructions, building_hours, phone_restricted, photos_not_allowed, restrictions_notes, status) values
  ('e2900000-0000-0000-0000-000000000011', 'e2900000-0000-0000-0000-000000000001', 'Sede de supervisiones', 'Dirección 29', 'Buenos Aires', -34.6, -58.4, 'Recepción', '+54 11 4000-0000', 'Timbre 3', 'Lun a vie 7 a 20', true, false, 'No sacar fotos en el depósito', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2900000-0000-0000-0000-000000000081', 'test-db029-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Supervisiones')),
  ('e2900000-0000-0000-0000-000000000082', 'test-db029-admin-full@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Completo')),
  ('e2900000-0000-0000-0000-000000000083', 'test-db029-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('e2900000-0000-0000-0000-000000000084', 'test-db029-supervisora-a@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'A')),
  ('e2900000-0000-0000-0000-000000000085', 'test-db029-supervisora-b@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'B')),
  ('e2900000-0000-0000-0000-000000000086', 'test-db029-supervisor-baja@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Baja')),
  ('e2900000-0000-0000-0000-000000000087', 'test-db029-emp-x@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'X')),
  ('e2900000-0000-0000-0000-000000000088', 'test-db029-emp-y@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Y')),
  ('e2900000-0000-0000-0000-000000000089', 'test-db029-emp-z@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Z'));

insert into public.user_roles (profile_id, role) values
  ('e2900000-0000-0000-0000-000000000081', 'owner'),
  ('e2900000-0000-0000-0000-000000000082', 'admin'),
  ('e2900000-0000-0000-0000-000000000083', 'admin'),
  ('e2900000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2900000-0000-0000-0000-000000000084', 'employee'),
  ('e2900000-0000-0000-0000-000000000085', 'supervisor'),
  ('e2900000-0000-0000-0000-000000000086', 'supervisor'),
  ('e2900000-0000-0000-0000-000000000087', 'employee'),
  ('e2900000-0000-0000-0000-000000000088', 'employee'),
  ('e2900000-0000-0000-0000-000000000089', 'employee');

-- admin-full: manage_supervisions + edit_ratings. admin-sin-cap: ninguna (para FORBIDDEN).
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2900000-0000-0000-0000-000000000082', 'manage_supervisions', true),
  ('e2900000-0000-0000-0000-000000000082', 'edit_ratings', true);

insert into public.employees (profile_id, dni, status) values
  ('e2900000-0000-0000-0000-000000000084', '92900084', 'active'),
  ('e2900000-0000-0000-0000-000000000085', '92900085', 'active'),
  ('e2900000-0000-0000-0000-000000000086', '92900086', 'terminated'),
  ('e2900000-0000-0000-0000-000000000087', '92900087', 'active'),
  ('e2900000-0000-0000-0000-000000000088', '92900088', 'active'),
  ('e2900000-0000-0000-0000-000000000089', '92900089', 'active');

-- Criterios vigentes hoy, para el criteria_snapshot de supervision_check_in.
insert into public.rating_criteria (id, position, title, description, valid_from, valid_to) values
  ('e2900000-0000-0000-0000-0000000000c1', 1, 'Puntualidad', 'Llega a horario', current_date - 10, null),
  ('e2900000-0000-0000-0000-0000000000c2', 2, 'Presentación', null, current_date - 10, null);

-- ---------------------------------------------------------------------------------------------
-- Turnos ---------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- 101: turno de hoy, dotación 1, emp-x asignado. Base de assign_supervision feliz +
-- ALREADY_ASSIGNED + todo el ciclo check_in/check_out/complete/rate_employee feliz.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000101', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today(), '08:00', '16:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2900000-0000-0000-0000-000000000201', 'e2900000-0000-0000-0000-000000000101', 'e2900000-0000-0000-0000-000000000087');

-- 102: turno de hoy, dotación 2, con supervisora-a TAMBIÉN asignada como empleada (CB-13, P-042)
-- y emp-y. Para SUPERVISES_OWN_SHIFT y SELF_RATING_NOT_ALLOWED + calificación feliz a emp-y.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000102', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today(), '09:00', '13:00', 2, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2900000-0000-0000-0000-000000000202', 'e2900000-0000-0000-0000-000000000102', 'e2900000-0000-0000-0000-000000000084'),
  ('e2900000-0000-0000-0000-000000000203', 'e2900000-0000-0000-0000-000000000102', 'e2900000-0000-0000-0000-000000000088');

-- 103: turno de mañana -- NOT_TODAY en supervision_check_in y SUPERVISION_NOT_ACTIVE en
-- rate_employee (supervisión todavía "assigned", nunca se llega a iniciar en este archivo).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000103', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 1, '08:00', '12:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2900000-0000-0000-0000-000000000204', 'e2900000-0000-0000-0000-000000000103', 'e2900000-0000-0000-0000-000000000089');

-- 104: turno cancelado -- SHIFT_NOT_SUPERVISABLE.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('e2900000-0000-0000-0000-000000000104', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today(), '07:00', '08:00', 1, 'cancelled', now(), 'e2900000-0000-0000-0000-000000000081', 'Cliente canceló');

-- 105: turno completado -- SHIFT_NOT_SUPERVISABLE.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000105', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() - 2, '06:00', '07:00', 1, 'completed');

-- 106: turno de AYER (P-083, CB-14: RATING_WINDOW_CLOSED) -- ended_at claramente en el pasado.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000106', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '09:00', 1, 'completed');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2900000-0000-0000-0000-000000000205', 'e2900000-0000-0000-0000-000000000106', 'e2900000-0000-0000-0000-000000000088');

-- 107: turno para cancel_supervision feliz + doble cancelación.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000107', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '08:00', '09:00', 1, 'scheduled');

-- 108: turno para mark_supervision_not_done por la propia supervisora (feliz + permisos).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000108', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '09:00', '10:00', 1, 'scheduled');

-- 109: turno para mark_supervision_not_done por administración (feliz).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000109', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '10:00', '11:00', 1, 'scheduled');

-- 110: turno con SHIFT_NOT_SUPERVISABLE ya cubierto arriba; este es para SUPERVISOR_ROLE_REQUIRED
-- (rol faltante y rol sin persona activa) -- turno válido, el rechazo es sobre el supervisor.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000110', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '11:00', '12:00', 1, 'scheduled');

-- 111: supervisión ya asignada, nunca iniciada -- NOT_STARTED en supervision_check_out y en
-- complete_supervision.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000111', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '12:00', '13:00', 1, 'scheduled');

-- 112: supervisión ya "not_done" (cargada directo) -- SUPERVISION_NOT_EDITABLE en
-- supervision_check_in, supervision_check_out, complete_supervision y cancel_supervision.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000112', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today(), '13:00', '14:00', 1, 'scheduled');

-- 113: supervisión "in_progress" sin check_out, cargada directo -- CHECK_OUT_REQUIRED, y después
-- del check_out feliz de complete_supervision (general_notes vacío -> null).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000113', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today(), '14:00', '15:00', 1, 'scheduled');

-- 114: para ASSIGNMENT_NOT_FOUND/ASSIGNMENT_NOT_IN_SHIFT en rate_employee -- otro turno con otra
-- asignación (emp-z), distinta de la del turno 101/102 que se usa en cada supervisión.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2900000-0000-0000-0000-000000000114', 'e2900000-0000-0000-0000-000000000001', 'e2900000-0000-0000-0000-000000000011', app.today() + 3, '15:00', '16:00', 1, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('e2900000-0000-0000-0000-000000000206', 'e2900000-0000-0000-0000-000000000114', 'e2900000-0000-0000-0000-000000000089');

-- Tabla temporal para guardar el id de cada supervisión que se crea con assign_supervision (los
-- ids los pone gen_random_uuid(), no son fijos como los del resto de las fixtures): se llena
-- SIEMPRE como postgres (bypassrls) apenas se crea cada una, así los tests que simulan un rol sin
-- SELECT sobre esa fila (04 sección 7.2: "S: propias. E: no.") pueden seguir referenciándola por
-- su turno sin que la propia subconsulta de lookup quede bloqueada por RLS y devuelva null (eso
-- daría SUPERVISION_NOT_FOUND en vez del código que el test quiere probar).
create temporary table e2900000_sup_ids (label text primary key, id uuid not null) on commit drop;
grant select, insert on e2900000_sup_ids to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Supervisiones de partida (cargadas directo, como postgres) -------------------------------------
-- ---------------------------------------------------------------------------------------------

-- 101: completada, con sus criterios, inicio y fin (turno de hoy, emp-x).
insert into public.supervisions (id, shift_id, supervisor_id, status, general_notes, criteria_snapshot) values
  ('e2900000-0000-0000-0000-000000000301', 'e2900000-0000-0000-0000-000000000101', 'e2900000-0000-0000-0000-000000000084', 'completed', 'Todo en orden',
   jsonb_build_array(
     jsonb_build_object('id', 'e2900000-0000-0000-0000-0000000000c1', 'title', 'Puntualidad', 'description', 'Llega a horario', 'position', 1),
     jsonb_build_object('id', 'e2900000-0000-0000-0000-0000000000c2', 'title', 'Presentación', 'description', null, 'position', 2)));
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e2900000-0000-0000-0000-000000000301', 'check_in', now()),
  ('e2900000-0000-0000-0000-000000000301', 'check_out', now());

-- 102: en curso, con inicio y fin en now() (constante en la transacción: el plazo de P-083 queda
-- abierto a cualquier hora). La supervisora-a también está asignada como empleada (CB-13, P-042).
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e2900000-0000-0000-0000-000000000302', 'e2900000-0000-0000-0000-000000000102', 'e2900000-0000-0000-0000-000000000084', 'in_progress');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e2900000-0000-0000-0000-000000000302', 'check_in', now()),
  ('e2900000-0000-0000-0000-000000000302', 'check_out', now());

-- 103: turno de mañana, supervisión «assigned» (SUPERVISION_NOT_ACTIVE en rate_employee).
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e2900000-0000-0000-0000-000000000303', 'e2900000-0000-0000-0000-000000000103', 'e2900000-0000-0000-0000-000000000084', 'assigned');

-- 107: «assigned», para cancel_supervision.
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e2900000-0000-0000-0000-000000000307', 'e2900000-0000-0000-0000-000000000107', 'e2900000-0000-0000-0000-000000000084', 'assigned');

insert into e2900000_sup_ids (label, id) values
  ('101', 'e2900000-0000-0000-0000-000000000301'),
  ('102', 'e2900000-0000-0000-0000-000000000302'),
  ('103', 'e2900000-0000-0000-0000-000000000303'),
  ('107', 'e2900000-0000-0000-0000-000000000307');

-- ---------------------------------------------------------------------------------------------
-- cancel_supervision -----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db029-admin-full@example.com');

-- CANCEL_REASON_REQUIRED.
prepare cancel_sup_sin_motivo as
  select public.cancel_supervision(
    (select id from e2900000_sup_ids where label = '107'),
    ''
  );

select throws_ok(
  'cancel_sup_sin_motivo', 'P0001', 'Indicá el motivo.',
  'cancel_supervision: sin motivo -> CANCEL_REASON_REQUIRED'
);

-- Feliz.
select is(
  (public.cancel_supervision(
    (select id from e2900000_sup_ids where label = '107'),
    'Turno reprogramado'
  )).status::text,
  'cancelled',
  'cancel_supervision: feliz -> status = cancelled'
);

-- SUPERVISION_NOT_EDITABLE: ya cancelada.
prepare cancel_sup_doble as
  select public.cancel_supervision(
    (select id from e2900000_sup_ids where label = '107'),
    'Otra vez'
  );

select throws_ok(
  'cancel_sup_doble', 'P0001', 'Esta supervisión no admite ese cambio en su estado actual.',
  'cancel_supervision: doble cancelación -> SUPERVISION_NOT_EDITABLE'
);

-- SUPERVISION_NOT_FOUND.
prepare cancel_sup_not_found as
  select public.cancel_supervision('00000000-0000-0000-0000-000000000000', 'Motivo');

select throws_ok(
  'cancel_sup_not_found', 'P0001', 'No encontramos esa supervisión.',
  'cancel_supervision: id inexistente -> SUPERVISION_NOT_FOUND'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- rate_employee -----------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- FORBIDDEN: empleado.
select tests.as_user('test-db029-emp-x@example.com');

prepare rate_forbidden_empleado as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '101'),
    'e2900000-0000-0000-0000-000000000201',
    4
  );

select throws_ok(
  'rate_forbidden_empleado', 'P0001', 'No tenés permiso para hacer esto.',
  'rate_employee: CRITERIO DE ACEPTACIÓN (P-084) -- un empleado no puede calificar -> FORBIDDEN'
);

-- FORBIDDEN: admin sin edit_ratings y sin rol supervisor.
select tests.as_user('test-db029-admin-sin-cap@example.com');

prepare rate_forbidden_admin as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '101'),
    'e2900000-0000-0000-0000-000000000201',
    4
  );

select throws_ok(
  'rate_forbidden_admin', 'P0001', 'No tenés permiso para hacer esto.',
  'rate_employee: admin sin edit_ratings -> FORBIDDEN'
);

-- NOT_YOUR_SUPERVISION: otra supervisora, sobre la supervisión 102 (todavía in_progress).
select tests.as_user('test-db029-supervisora-b@example.com');

prepare rate_ajena as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000203',
    5
  );

select throws_ok(
  'rate_ajena', 'P0001', 'Esa supervisión no es tuya.',
  'rate_employee: otra supervisora -> NOT_YOUR_SUPERVISION'
);

select tests.as_user('test-db029-supervisora-a@example.com');

-- SUPERVISION_NOT_ACTIVE: supervisión 103, todavía "assigned".
prepare rate_no_activa as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '103'),
    'e2900000-0000-0000-0000-000000000204',
    3
  );

select throws_ok(
  'rate_no_activa', 'P0001', 'Esta supervisión no está en curso ni completada.',
  'rate_employee: supervisión assigned -> SUPERVISION_NOT_ACTIVE'
);

-- ASSIGNMENT_NOT_FOUND.
prepare rate_assignment_not_found as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    '00000000-0000-0000-0000-000000000000',
    4
  );

select throws_ok(
  'rate_assignment_not_found', 'P0001', 'No encontramos esa asignación.',
  'rate_employee: asignación inexistente -> ASSIGNMENT_NOT_FOUND'
);

-- ASSIGNMENT_NOT_IN_SHIFT: asignación de otro turno (114).
prepare rate_assignment_not_in_shift as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000206',
    4
  );

select throws_ok(
  'rate_assignment_not_in_shift', 'P0001', 'Esa asignación no pertenece al turno de esta supervisión.',
  'rate_employee: asignación de otro turno -> ASSIGNMENT_NOT_IN_SHIFT'
);

-- SELF_RATING_NOT_ALLOWED: la propia supervisora, asignada como empleada del mismo turno (CB-13).
prepare rate_self as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000202',
    5
  );

select throws_ok(
  'rate_self', 'P0001', 'No podés calificarte a vos mismo.',
  'rate_employee: autocalificación -> SELF_RATING_NOT_ALLOWED (CB-13, PROPUESTO)'
);

-- SCORE_OUT_OF_RANGE.
prepare rate_score_bajo as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000203',
    0
  );

select throws_ok(
  'rate_score_bajo', 'P0001', 'El puntaje tiene que ser entre 1 y 5.',
  'rate_employee: puntaje 0 -> SCORE_OUT_OF_RANGE'
);

prepare rate_score_alto as
  select public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000203',
    6
  );

select throws_ok(
  'rate_score_alto', 'P0001', 'El puntaje tiene que ser entre 1 y 5.',
  'rate_employee: puntaje 6 -> SCORE_OUT_OF_RANGE'
);

-- Feliz: inserta.
select is(
  (public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000203',
    4,
    'Buen desempeño'
  )).score,
  4::smallint,
  'rate_employee: feliz, inserta la calificación'
);

-- Feliz: upsert (misma supervisión y asignación, cambia puntaje y comentario).
select is(
  (public.rate_employee(
    (select id from e2900000_sup_ids where label = '102'),
    'e2900000-0000-0000-0000-000000000203',
    5,
    'Mejoró'
  )).score,
  5::smallint,
  'rate_employee: upsert, actualiza el puntaje de la misma calificación'
);

set local role postgres;

select is(
  (select count(*)::int from public.ratings
    where supervision_id = (select id from e2900000_sup_ids where label = '102')
      and assignment_id = 'e2900000-0000-0000-0000-000000000203'),
  1,
  'rate_employee: el upsert no duplica la fila (unique (supervision_id, assignment_id), 0010)'
);

select is(
  (select updated_by from public.ratings
    where supervision_id = (select id from e2900000_sup_ids where label = '102')
      and assignment_id = 'e2900000-0000-0000-0000-000000000203'),
  'e2900000-0000-0000-0000-000000000084'::uuid,
  'rate_employee: updated_by queda seteado después de la edición (la propia supervisora)'
);

-- RATING_WINDOW_CLOSED (CB-14: "supervisor intenta calificar al día siguiente") -- supervisión de
-- ayer, con el turno y el check_out también de ayer: el plazo de P-083 está vencido sin importar
-- la hora en que corre este test.
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e2900000-0000-0000-0000-000000000306', 'e2900000-0000-0000-0000-000000000106', 'e2900000-0000-0000-0000-000000000084', 'in_progress');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e2900000-0000-0000-0000-000000000306', 'check_in', app.local_ts(app.today() - 1, '08:00'::time)),
  ('e2900000-0000-0000-0000-000000000306', 'check_out', app.local_ts(app.today() - 1, '09:00'::time));
update public.supervisions set status = 'completed' where id = 'e2900000-0000-0000-0000-000000000306';

select tests.as_user('test-db029-supervisora-a@example.com');

prepare rate_plazo_vencido as
  select public.rate_employee('e2900000-0000-0000-0000-000000000306', 'e2900000-0000-0000-0000-000000000205', 3);

select throws_ok(
  'rate_plazo_vencido', 'P0001', 'El plazo para editar esta calificación terminó.',
  'rate_employee: CB-14, plazo vencido (turno y check_out de ayer) -> RATING_WINDOW_CLOSED'
);

-- El administrador con edit_ratings SÍ puede, siempre (P-083).
select tests.as_user('test-db029-admin-full@example.com');

select is(
  (public.rate_employee('e2900000-0000-0000-0000-000000000306', 'e2900000-0000-0000-0000-000000000205', 3, 'Cargado fuera de plazo por administración')).score,
  3::smallint,
  'rate_employee: O/A con edit_ratings califica aunque el plazo del supervisor ya haya vencido (P-083)'
);

-- SUPERVISION_NOT_FOUND.
prepare rate_supervision_not_found as
  select public.rate_employee('00000000-0000-0000-0000-000000000000', 'e2900000-0000-0000-0000-000000000201', 4);

select throws_ok(
  'rate_supervision_not_found', 'P0001', 'No encontramos esa supervisión.',
  'rate_employee: supervisión inexistente -> SUPERVISION_NOT_FOUND'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- El empleado no ve ratings por ninguna vía (P-084) -- select directo y vía rate_employee ya
-- probado arriba (FORBIDDEN). Esto agrega el lado de lectura sobre una fila que sí existe.
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db029-emp-y@example.com');

select is(
  (select count(*)::int from public.ratings where assignment_id = 'e2900000-0000-0000-0000-000000000203'),
  0,
  'ratings: el empleado calificado no ve su propia calificación por select directo (P-084, RLS de 0012)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- v_supervisions_admin / v_my_supervisions: columnas nuevas de 0029 (SUP-006) --------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db029-owner@example.com');

select is(
  (select start_time from public.v_supervisions_admin where shift_id = 'e2900000-0000-0000-0000-000000000102'),
  '09:00'::time,
  'v_supervisions_admin: start_time del turno (0029, ADM-13)'
);

select is(
  (select assigned_employees_count from public.v_supervisions_admin where shift_id = 'e2900000-0000-0000-0000-000000000102'),
  2::bigint,
  'v_supervisions_admin: assigned_employees_count cuenta los asignados vigentes del turno (0029, ADM-13)'
);

select ok(
  exists (
    select 1 from jsonb_array_elements(
      (select criteria_snapshot from public.v_supervisions_admin where shift_id = 'e2900000-0000-0000-0000-000000000101')
    ) elem
    where elem ->> 'id' = 'e2900000-0000-0000-0000-0000000000c1'
  ),
  'v_supervisions_admin: criteria_snapshot llega a la vista (0029, ADM-15)'
);

-- Un empleado registra su inicio en el turno 101 (fuera del alcance de esta migración, pero
-- necesario para probar check_in_at dentro de assigned_employees).
select tests.as_user('test-db029-emp-x@example.com');
select public.record_check_in('e2900000-0000-0000-0000-000000000201');

select tests.as_user('test-db029-supervisora-a@example.com');

select ok(
  (select (assigned_employees -> 0 ->> 'check_in_at') is not null
    from public.v_my_supervisions where shift_id = 'e2900000-0000-0000-0000-000000000101'),
  'v_my_supervisions: assigned_employees incluye check_in_at por empleado ("inicio real", 0029, SUP-03)'
);

select is(
  (select site_contact_phone from public.v_my_supervisions where shift_id = 'e2900000-0000-0000-0000-000000000101'),
  '+54 11 4000-0000',
  'v_my_supervisions: site_contact_phone (0029, SUP-03)'
);

select is(
  (select site_restrictions_notes from public.v_my_supervisions where shift_id = 'e2900000-0000-0000-0000-000000000101'),
  'No sacar fotos en el depósito',
  'v_my_supervisions: site_restrictions_notes (0029, SUP-03)'
);

set local role postgres;

select * from finish();

rollback;
