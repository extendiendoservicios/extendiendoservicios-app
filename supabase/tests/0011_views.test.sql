-- pgTAP de la migración 0011_views.sql (DB-013), parte 1: existencia + security_invoker de las
-- diez vistas, y las columnas derivadas de v_employees, v_shifts_board y v_assignments_board.
-- v_my_day, v_supervisions_admin, v_my_supervisions, v_public_branding, v_people_basic, v_clients
-- y v_search están en 0011_views_my_day_supervisions_search.test.sql (archivo separado por
-- tamaño, ver supabase/tests/README.md).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c1500000-...'.
--
-- Nota sobre "ahora": v_shifts_board.display_status = 'upcoming' depende de `now()` en el momento
-- de la corrida. Se arma con app.today()/`now() + interval` (no con una hora fija) para no
-- depender de en qué momento del día se ejecuten los tests. El único caso con un margen de
-- flakiness teórico (no observado) es cuando la corrida cae justo en el último rato antes de la
-- medianoche de Argentina, porque el fin del turno (now()+2h30) podría cruzar al día siguiente;
-- dado que la franja de riesgo es de aproximadamente una hora sobre 24 (~4%) y el efecto sería un
-- error de inserción (constraint end_time > start_time), no un falso positivo de seguridad, se
-- acepta como límite conocido en vez de complicar el fixture.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(32);

-- 1. Las diez vistas existen y son security_invoker = true --------------------------------------

select has_view('public', 'v_employees', 'existe public.v_employees');
select has_view('public', 'v_shifts_board', 'existe public.v_shifts_board');
select has_view('public', 'v_assignments_board', 'existe public.v_assignments_board');
select has_view('public', 'v_my_day', 'existe public.v_my_day');
select has_view('public', 'v_supervisions_admin', 'existe public.v_supervisions_admin');
select has_view('public', 'v_my_supervisions', 'existe public.v_my_supervisions');
select has_view('public', 'v_public_branding', 'existe public.v_public_branding');
select has_view('public', 'v_people_basic', 'existe public.v_people_basic');
select has_view('public', 'v_clients', 'existe public.v_clients');
select has_view('public', 'v_search', 'existe public.v_search');

select ok(
  (
    select 'security_invoker=true' = any(c.reloptions)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_employees'
  ),
  'v_employees: security_invoker = true'
);
select ok(
  (
    select 'security_invoker=true' = any(c.reloptions)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_shifts_board'
  ),
  'v_shifts_board: security_invoker = true'
);
select ok(
  (
    select 'security_invoker=true' = any(c.reloptions)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'v_assignments_board'
  ),
  'v_assignments_board: security_invoker = true'
);

-- Fixtures comunes: cliente, sede, tres empleados -------------------------------------------------

insert into public.clients (id, legal_name) values ('c1500000-0000-0000-0000-000000000001', 'Cliente vistas');
insert into public.sites (id, client_id, name, address)
values ('c1500000-0000-0000-0000-000000000011', 'c1500000-0000-0000-0000-000000000001', 'Sede vistas', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1500000-0000-0000-0000-000000000081', 'test-db013-emp-activo@example.com', jsonb_build_object('first_name', 'Activa', 'last_name', 'Uno')),
  ('c1500000-0000-0000-0000-000000000082', 'test-db013-emp-licencia@example.com', jsonb_build_object('first_name', 'Licencia', 'last_name', 'Dos')),
  ('c1500000-0000-0000-0000-000000000083', 'test-db013-emp-licencia-pasada@example.com', jsonb_build_object('first_name', 'Pasada', 'last_name', 'Tres'));

insert into public.employees (profile_id, dni) values
  ('c1500000-0000-0000-0000-000000000081', '50000081'),
  ('c1500000-0000-0000-0000-000000000082', '50000082'),
  ('c1500000-0000-0000-0000-000000000083', '50000083');

insert into public.user_roles (profile_id, role) values
  ('c1500000-0000-0000-0000-000000000081', 'employee'),
  ('c1500000-0000-0000-0000-000000000081', 'supervisor'),
  ('c1500000-0000-0000-0000-000000000082', 'employee'),
  ('c1500000-0000-0000-0000-000000000083', 'employee');

-- 2. v_employees: effective_status y roles --------------------------------------------------------

select is(
  (select effective_status from public.v_employees where profile_id = 'c1500000-0000-0000-0000-000000000081'),
  'active',
  'v_employees: sin licencia -> effective_status = employees.status (active)'
);

select is(
  (select roles from public.v_employees where profile_id = 'c1500000-0000-0000-0000-000000000081'),
  array['supervisor', 'employee']::public.app_role[],
  'v_employees: roles trae los dos roles de user_roles (orden del enum: supervisor antes que employee)'
);

insert into public.employee_leaves (employee_id, starts_on, ends_on)
values ('c1500000-0000-0000-0000-000000000082', app.today() - 5, app.today() + 5);

select is(
  (select effective_status from public.v_employees where profile_id = 'c1500000-0000-0000-0000-000000000082'),
  'on_leave',
  'v_employees: licencia vigente hoy (starts_on <= hoy <= ends_on) -> effective_status = on_leave'
);

insert into public.employee_leaves (employee_id, starts_on, ends_on)
values ('c1500000-0000-0000-0000-000000000083', app.today() - 20, app.today() - 10);

select is(
  (select effective_status from public.v_employees where profile_id = 'c1500000-0000-0000-0000-000000000083'),
  'active',
  'v_employees: licencia ya terminada (ends_on < hoy) -> effective_status = active, no on_leave'
);

-- 3. v_shifts_board: uncovered, upcoming y los casos que NO disparan ninguno de los dos ------------

-- Turno de ayer, sin ninguna asignación: sin cubrir (hora de inicio pasada, 0 < 2).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1500000-0000-0000-0000-000000000041', 'c1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '12:00', 2);

select is(
  (select display_status from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000041'),
  'uncovered',
  'v_shifts_board: turno de ayer con 0 de 2 asignados -> display_status = uncovered'
);

select is(
  (select assigned_count from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000041'),
  0::bigint,
  'v_shifts_board: assigned_count = 0 sin asignaciones'
);

-- Turno de ayer, dotación completa (1 de 1) pero esa única asignación avisó ausencia: NO se marca
-- sin cubrir (assigned_count = required_staff, aunque haya una ausencia avisada sin reemplazo
-- adicional -- decisión menor documentada en 0011_views.sql).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1500000-0000-0000-0000-000000000042', 'c1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '12:00', 1);

insert into public.assignments (shift_id, employee_id, status)
values ('c1500000-0000-0000-0000-000000000042', 'c1500000-0000-0000-0000-000000000081', 'absence_notified');

select is(
  (select display_status from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000042'),
  'scheduled',
  'v_shifts_board: dotación completa (1 de 1) con esa asignación en absence_notified -> NO uncovered (assigned_count no baja de required_staff)'
);

select is(
  (select absent_count from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000042'),
  1::bigint,
  'v_shifts_board: absent_count cuenta la asignación en absence_notified'
);

-- Turno cancelado, de ayer, sin asignaciones: nunca "sin cubrir" (excluido explícitamente).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason)
values ('c1500000-0000-0000-0000-000000000043', 'c1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '12:00', 2, 'cancelled', now(), 'c1500000-0000-0000-0000-000000000081', 'prueba pgTAP');

select is(
  (select display_status from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000043'),
  'cancelled',
  'v_shifts_board: turno cancelado con 0 de 2 asignados -> NO uncovered, muestra su status real'
);

-- Turno lejos en el futuro: ni uncovered ni upcoming.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1500000-0000-0000-0000-000000000044', 'c1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000011', app.today() + 30, '09:00', '13:00', 1);

select is(
  (select display_status from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000044'),
  'scheduled',
  'v_shifts_board: turno dentro de 30 días -> display_status = su status real (scheduled), no upcoming'
);

-- Turno que empieza dentro de la próxima hora (ver nota de "ahora" al principio del archivo):
-- upcoming = empieza dentro de las próximas 2 horas.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
select
  'c1500000-0000-0000-0000-000000000045',
  'c1500000-0000-0000-0000-000000000001',
  'c1500000-0000-0000-0000-000000000011',
  (target at time zone 'America/Argentina/Buenos_Aires')::date,
  (target at time zone 'America/Argentina/Buenos_Aires')::time,
  ((target + interval '2 hours') at time zone 'America/Argentina/Buenos_Aires')::time,
  1
from (select now() + interval '1 hour' as target) t;

select is(
  (select display_status from public.v_shifts_board where id = 'c1500000-0000-0000-0000-000000000045'),
  'upcoming',
  'v_shifts_board: turno que empieza dentro de 1 hora -> display_status = upcoming'
);

-- 4. v_assignments_board: no_record, minutes_late, minutes_early_leave -----------------------------

-- Turno de hace dos días (arbitrario, ya pasado sin importar la hora del día), sin registro de
-- inicio: no_record.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1500000-0000-0000-0000-000000000046', 'c1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000011', app.today() - 2, '08:00', '16:00', 2);

insert into public.assignments (id, shift_id, employee_id)
values ('c1500000-0000-0000-0000-000000000091', 'c1500000-0000-0000-0000-000000000046', 'c1500000-0000-0000-0000-000000000081');

select is(
  (select display_status from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000091'),
  'no_record',
  'v_assignments_board: expected, hora de inicio pasada, sin check_in -> display_status = no_record'
);

-- Misma fecha, otra asignación: check-in 15 minutos tarde, check-out 20 minutos antes del fin
-- previsto.
insert into public.assignments (id, shift_id, employee_id, status)
values ('c1500000-0000-0000-0000-000000000092', 'c1500000-0000-0000-0000-000000000046', 'c1500000-0000-0000-0000-000000000082', 'finished');

insert into public.attendance_records (assignment_id, kind, recorded_at, source)
values (
  'c1500000-0000-0000-0000-000000000092', 'check_in',
  app.local_ts(app.today() - 2, '08:00') + interval '15 minutes',
  'employee_app'
);
insert into public.attendance_records (assignment_id, kind, recorded_at, source)
values (
  'c1500000-0000-0000-0000-000000000092', 'check_out',
  app.local_ts(app.today() - 2, '16:00') - interval '20 minutes',
  'employee_app'
);

select is(
  (select minutes_late from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000092'),
  15,
  'v_assignments_board: check_in 15 minutos después del inicio previsto -> minutes_late = 15'
);

select is(
  (select minutes_early_leave from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000092'),
  20,
  'v_assignments_board: check_out 20 minutos antes del fin previsto -> minutes_early_leave = 20 (P-076)'
);

select is(
  (select display_status from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000092'),
  'finished',
  'v_assignments_board: con check_in y check_out, status finished, no es no_record'
);

-- Tercera asignación: check-in puntual (no tarde) -> minutes_late null (no negativo).
insert into public.assignments (id, shift_id, employee_id, status)
values ('c1500000-0000-0000-0000-000000000093', 'c1500000-0000-0000-0000-000000000046', 'c1500000-0000-0000-0000-000000000083', 'present');

insert into public.attendance_records (assignment_id, kind, recorded_at, source)
values (
  'c1500000-0000-0000-0000-000000000093', 'check_in',
  app.local_ts(app.today() - 2, '08:00') - interval '5 minutes',
  'employee_app'
);

select is(
  (select minutes_late from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000093'),
  null::int,
  'v_assignments_board: check_in antes del inicio previsto -> minutes_late = null (no negativo)'
);

select is(
  (select minutes_early_leave from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000093'),
  null::int,
  'v_assignments_board: sin check_out -> minutes_early_leave = null'
);

-- effective_start_time / effective_starts_at reflejan la franja del turno cuando la asignación no
-- tiene franja propia.
select is(
  (select effective_start_time from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000091'),
  '08:00'::time,
  'v_assignments_board: effective_start_time = start_time del turno sin franja propia'
);

select is(
  (select effective_starts_at from public.v_assignments_board where id = 'c1500000-0000-0000-0000-000000000091'),
  app.local_ts(app.today() - 2, '08:00'),
  'v_assignments_board: effective_starts_at = lower(window) del turno sin franja propia'
);

select * from finish();

rollback;
