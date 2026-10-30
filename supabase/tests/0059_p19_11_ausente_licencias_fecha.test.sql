-- pgTAP de la migración 0059_p19_11_ausente_licencias_fecha.sql (P19.11a, reunión del 19 oct 2026):
--   1. «Ausente» con / sin certificado: attendance_notices.has_certificate, notify_absence
--      (el empleado sigue obligado a dar motivo; administración puede omitirlo pero tiene que
--      indicar el certificado), last_notice_has_certificate en las vistas.
--   2. Las licencias bloquean la asignación en todos los caminos (assign_employee, create_shift,
--      create_shift_series, generate_shifts) y get_leave_conflicts.
--   3. update_shift_time(p_date): cambiar la fecha solo si el turno no empezó, revalidando
--      licencia y superposición; get_shift_date_warnings.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f5900000-...'. Todas las fechas de prueba son de 2199 (nada depende de la
-- hora ni de la medianoche de Argentina).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0059;
grant usage on schema tests_0059 to authenticated, anon;

create or replace function tests_0059.as_user(p_email text)
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
    raise exception 'tests_0059.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0059.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0059.err_hint(p_sql text)
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

grant execute on function tests_0059.err_hint(text) to authenticated, anon;

create or replace function tests_0059.err_message(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

grant execute on function tests_0059.err_message(text) to authenticated, anon;

select plan(64);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'attendance_notices', 'has_certificate', 'attendance_notices.has_certificate');
select has_column('public', 'v_assignments_board', 'last_notice_has_certificate', 'v_assignments_board.last_notice_has_certificate');
select has_column('public', 'v_my_day', 'last_notice_has_certificate', 'v_my_day.last_notice_has_certificate');
select has_column('public', 'v_my_history', 'last_notice_has_certificate', 'v_my_history.last_notice_has_certificate');
select has_function('public', 'notify_absence', array['uuid', 'absence_reason', 'text', 'boolean'], 'notify_absence(uuid, absence_reason, text, boolean)');
select hasnt_function('public', 'notify_absence', array['uuid', 'absence_reason', 'text'], 'ya no existe notify_absence de tres parámetros');
select has_function('public', 'update_shift_time', array['uuid', 'time', 'time', 'boolean', 'date'], 'update_shift_time con p_date');
select hasnt_function('public', 'update_shift_time', array['uuid', 'time', 'time', 'boolean'], 'ya no existe update_shift_time de cuatro parámetros');
select has_function('public', 'get_leave_conflicts', array['uuid', 'date', 'date'], 'get_leave_conflicts');
select has_function('public', 'get_shift_date_warnings', array['uuid', 'date', 'time', 'time'], 'get_shift_date_warnings');
select ok(
  not has_function_privilege('anon', 'public.notify_absence(uuid, absence_reason, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.notify_absence(uuid, absence_reason, text, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.get_leave_conflicts(uuid, date, date)', 'execute')
    and has_function_privilege('authenticated', 'public.get_leave_conflicts(uuid, date, date)', 'execute')
    and not has_function_privilege('anon', 'public.update_shift_time(uuid, time, time, boolean, date)', 'execute')
    and has_function_privilege('authenticated', 'public.update_shift_time(uuid, time, time, boolean, date)', 'execute')
    and not has_function_privilege('anon', 'public.get_shift_date_warnings(uuid, date, time, time)', 'execute')
    and has_function_privilege('authenticated', 'public.get_shift_date_warnings(uuid, date, time, time)', 'execute'),
  'grants: anon no, authenticated sí'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f5900000-0000-0000-0000-000000000001', 'Cliente de ausente y licencias', 'active', 0);

insert into public.sites (id, client_id, name, address, status) values
  ('f5900000-0000-0000-0000-000000000011', 'f5900000-0000-0000-0000-000000000001', 'Sede de ausente y licencias', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f5900000-0000-0000-0000-000000000081', 'test-db059-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Cincuentanueve')),
  ('f5900000-0000-0000-0000-000000000082', 'test-db059-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConAsistencia')),
  ('f5900000-0000-0000-0000-000000000083', 'test-db059-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinAsistencia')),
  ('f5900000-0000-0000-0000-000000000084', 'test-db059-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f5900000-0000-0000-0000-000000000085', 'test-db059-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('f5900000-0000-0000-0000-000000000091', 'test-db059-ea@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Libre')),
  ('f5900000-0000-0000-0000-000000000092', 'test-db059-eb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Ocupado')),
  ('f5900000-0000-0000-0000-000000000093', 'test-db059-ec@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Licencia')),
  ('f5900000-0000-0000-0000-000000000094', 'test-db059-ed@example.com', jsonb_build_object('first_name', 'Dora', 'last_name', 'Disponible'));

insert into public.user_roles (profile_id, role) values
  ('f5900000-0000-0000-0000-000000000081', 'owner'),
  ('f5900000-0000-0000-0000-000000000082', 'admin'),
  ('f5900000-0000-0000-0000-000000000083', 'admin'),
  ('f5900000-0000-0000-0000-000000000084', 'supervisor'),
  ('f5900000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f5900000-0000-0000-0000-000000000082', 'manage_attendance', true),
  ('f5900000-0000-0000-0000-000000000082', 'generate_shifts', true);

insert into public.employees (profile_id, dni, status) values
  ('f5900000-0000-0000-0000-000000000084', '95900084', 'active'),
  ('f5900000-0000-0000-0000-000000000085', '95900085', 'active'),
  ('f5900000-0000-0000-0000-000000000091', '95900091', 'active'),
  ('f5900000-0000-0000-0000-000000000092', '95900092', 'active'),
  ('f5900000-0000-0000-0000-000000000093', '95900093', 'active'),
  ('f5900000-0000-0000-0000-000000000094', '95900094', 'active');

-- Carla (93): licencia del 2199-07-10 al 2199-07-20 y del 2199-09-10 al 2199-09-12.
-- Dora (94): licencia abierta desde 2199-12-01.
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f5900000-0000-0000-0000-000000000093', '2199-07-10', '2199-07-20', 'Licencia de prueba 0059'),
  ('f5900000-0000-0000-0000-000000000093', '2199-09-10', '2199-09-12', 'Licencia de prueba 0059 (septiembre)'),
  ('f5900000-0000-0000-0000-000000000094', '2199-12-01', null, 'Licencia abierta de prueba 0059');

-- S1: 2199-07-05, para los avisos de ausencia (dotación 3: Ana, Beto y la empleada 85).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f5900000-0000-0000-0000-000000000041', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-05', '08:00', '12:00', 3, 'scheduled');
insert into public.assignments (id, shift_id, employee_id) values
  ('f5900000-0000-0000-0000-000000000051', 'f5900000-0000-0000-0000-000000000041', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-000000000052', 'f5900000-0000-0000-0000-000000000041', 'f5900000-0000-0000-0000-000000000092'),
  ('f5900000-0000-0000-0000-000000000053', 'f5900000-0000-0000-0000-000000000041', 'f5900000-0000-0000-0000-000000000085');

-- Turnos de Ana para get_leave_conflicts:
--   S7 2199-07-15 (programado, vigente)      -> conflicto
--   S8 2199-07-16 (cancelado)                -> no
--   S9 2199-07-17 (finalizado)               -> no
--   S10 2199-07-18 (asignación quitada)      -> no
--   S11 2020-01-15 (ya pasó)                 -> no
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f5900000-0000-0000-0000-000000000047', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-15', '08:00', '10:00', 1, 'scheduled'),
  ('f5900000-0000-0000-0000-000000000049', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-17', '08:00', '10:00', 1, 'completed'),
  ('f5900000-0000-0000-0000-00000000004a', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-18', '08:00', '10:00', 1, 'scheduled'),
  ('f5900000-0000-0000-0000-00000000004b', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2020-01-15', '08:00', '10:00', 1, 'scheduled');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f5900000-0000-0000-0000-000000000048', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-16', '08:00', '10:00', 1, 'cancelled', now(), 'f5900000-0000-0000-0000-000000000081', 'Prueba');
insert into public.assignments (shift_id, employee_id) values
  ('f5900000-0000-0000-0000-000000000047', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-000000000048', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-000000000049', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-00000000004b', 'f5900000-0000-0000-0000-000000000091');
insert into public.assignments (shift_id, employee_id, removed_at, removed_by, removed_reason) values
  ('f5900000-0000-0000-0000-00000000004a', 'f5900000-0000-0000-0000-000000000091', now(), 'f5900000-0000-0000-0000-000000000081', 'Prueba');

-- 1. Ausente con certificado ---------------------------------------------------------------------

-- Restricciones de la tabla (insertando como postgres).
prepare n_emp_sin_motivo as
  insert into public.attendance_notices (assignment_id, kind, source)
  values ('f5900000-0000-0000-0000-000000000051', 'absence', 'employee_app');
select throws_ok('n_emp_sin_motivo', '23514', null, 'restricción: una ausencia de la app del empleado exige reason_code');

prepare n_admin_sin_motivo as
  insert into public.attendance_notices (assignment_id, kind, source, has_certificate)
  values ('f5900000-0000-0000-0000-000000000051', 'absence', 'admin', true);
select lives_ok('n_admin_sin_motivo', 'restricción: una ausencia cargada por administración puede no tener reason_code');
delete from public.attendance_notices where assignment_id = 'f5900000-0000-0000-0000-000000000051';

prepare n_demora_con_certificado as
  insert into public.attendance_notices (assignment_id, kind, minutes_late, source, has_certificate)
  values ('f5900000-0000-0000-0000-000000000051', 'delay', 10, 'admin', true);
select throws_ok('n_demora_con_certificado', '23514', null, 'restricción: has_certificate solo en ausencias');

-- El empleado sigue obligado a dar motivo.
select tests_0059.as_user('test-db059-empleado@example.com');

select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000053')$$),
  'REASON_REQUIRED',
  'notify_absence: el empleado sin motivo -> REASON_REQUIRED'
);
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000053', null, null, true)$$),
  'REASON_REQUIRED',
  'notify_absence: el empleado sin motivo, aunque mande el certificado -> REASON_REQUIRED'
);

-- El empleado manda p_has_certificate: se ignora (queda null).
select is(
  (public.notify_absence('f5900000-0000-0000-0000-000000000053', 'illness', null, true)).has_certificate,
  null::boolean,
  'notify_absence: desde la app del empleado, has_certificate se ignora (null)'
);

-- Administración.
select tests_0059.as_user('test-db059-admin-sin@example.com');
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000051', null, null, true)$$),
  'FORBIDDEN',
  'notify_absence: admin sin manage_attendance -> FORBIDDEN'
);

select tests_0059.as_user('test-db059-supervisora@example.com');
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000051', null, null, true)$$),
  'FORBIDDEN',
  'notify_absence: supervisor -> FORBIDDEN'
);

select tests_0059.as_user('test-db059-admin@example.com');
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000051')$$),
  'CERTIFICATE_REQUIRED',
  'notify_absence: administración sin indicar el certificado -> CERTIFICATE_REQUIRED'
);
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000051', 'illness')$$),
  'CERTIFICATE_REQUIRED',
  'notify_absence: administración con motivo pero sin certificado -> CERTIFICATE_REQUIRED'
);
select is(
  tests_0059.err_hint($$select public.notify_absence('f5900000-0000-0000-0000-000000000051', 'other', null, true)$$),
  'REASON_REQUIRED',
  'notify_absence: administración con motivo "other" sin texto -> REASON_REQUIRED'
);

-- Con certificado y sin motivo: se acepta.
select is(
  (select row(n.has_certificate, n.reason_code is null, n.source::text)::text
   from public.notify_absence('f5900000-0000-0000-0000-000000000051', null, null, true) n),
  '(t,t,admin)',
  'notify_absence: administración, con certificado y sin motivo -> se registra (motivo opcional)'
);
select is(
  (select status::text from public.assignments where id = 'f5900000-0000-0000-0000-000000000051'),
  'absence_notified',
  'notify_absence: la asignación pasa a absence_notified'
);
-- Sin certificado y con motivo.
select is(
  (select row(n.has_certificate, n.reason_code::text, n.reason_text)::text
   from public.notify_absence('f5900000-0000-0000-0000-000000000052', 'other', 'Cuidado de un familiar', false) n),
  '(f,other,"Cuidado de un familiar")',
  'notify_absence: administración, sin certificado y con motivo -> se registra'
);

-- Las vistas lo muestran.
select tests_0059.as_user('test-db059-owner@example.com');
select is(
  (select array_agg(last_notice_has_certificate::text order by employee_first_name)
   from public.v_assignments_board where shift_id = 'f5900000-0000-0000-0000-000000000041'),
  array['true', 'false', null]::text[],
  'v_assignments_board: last_notice_has_certificate (Ana con, Beto sin, la empleada sin dato)'
);

-- 2. Licencias bloquean ------------------------------------------------------------------------

-- get_leave_conflicts primero (antes de crear turnos nuevos con Ana).
select tests_0059.as_user('test-db059-supervisora@example.com');
select is(
  tests_0059.err_hint($$select * from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-10', date '2199-07-20')$$),
  'FORBIDDEN',
  'get_leave_conflicts: un supervisor no puede (FORBIDDEN)'
);
select tests_0059.as_user('test-db059-empleado@example.com');
select is(
  tests_0059.err_hint($$select * from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-10', date '2199-07-20')$$),
  'FORBIDDEN',
  'get_leave_conflicts: un empleado no puede (FORBIDDEN)'
);

select tests_0059.as_user('test-db059-admin@example.com');
select is(
  (select array_agg(shift_id order by shift_date) from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-10', date '2199-07-20')),
  array['f5900000-0000-0000-0000-000000000047']::uuid[],
  'get_leave_conflicts: solo el turno vigente del período (sin cancelados, finalizados, asignaciones quitadas ni pasados)'
);
select is(
  (select row(shift_date::text, start_time::text, end_time::text, client_name, site_name, shift_status::text)::text
   from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-10', date '2199-07-20')),
  '(2199-07-15,08:00:00,10:00:00,"Cliente de ausente y licencias","Sede de ausente y licencias",scheduled)',
  'get_leave_conflicts: devuelve fecha, horario, cliente, sede y estado'
);
select is(
  (select array_agg(shift_id order by shift_date) from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-01', null)),
  array['f5900000-0000-0000-0000-000000000041', 'f5900000-0000-0000-0000-000000000047']::uuid[],
  'get_leave_conflicts: licencia abierta (ends_on null) toma todo desde la fecha de inicio'
);
select is(
  (select count(*)::int from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2020-01-01', date '2020-01-31')),
  0,
  'get_leave_conflicts: los turnos que ya pasaron no son conflicto'
);
select is(
  tests_0059.err_hint($$select * from public.get_leave_conflicts('f5900000-0000-0000-0000-000000000091', date '2199-07-20', date '2199-07-10')$$),
  'INVALID_DATE_RANGE',
  'get_leave_conflicts: fin anterior al inicio -> INVALID_DATE_RANGE'
);

-- assign_employee: Carla de licencia -> error, sin asignación.
set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f5900000-0000-0000-0000-000000000042', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-07-12', '10:00', '12:00', 2, 'scheduled'),
  ('f5900000-0000-0000-0000-000000000043', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-12-15', '10:00', '12:00', 1, 'scheduled');
select tests_0059.as_user('test-db059-owner@example.com');

select is(
  tests_0059.err_hint($$select public.assign_employee('f5900000-0000-0000-0000-000000000042', 'f5900000-0000-0000-0000-000000000093')$$),
  'ON_LEAVE',
  'assign_employee: empleado de licencia -> error ON_LEAVE (ya no es advertencia)'
);
select is(
  tests_0059.err_message($$select public.assign_employee('f5900000-0000-0000-0000-000000000042', 'f5900000-0000-0000-0000-000000000093')$$),
  'El empleado está de licencia ese día.',
  'assign_employee: mensaje en español con voseo'
);
select is(
  (select count(*)::int from public.assignments where shift_id = 'f5900000-0000-0000-0000-000000000042'),
  0,
  'assign_employee: no quedó ninguna asignación'
);
select is(
  tests_0059.err_hint($$select public.assign_employee('f5900000-0000-0000-0000-000000000043', 'f5900000-0000-0000-0000-000000000094')$$),
  'ON_LEAVE',
  'assign_employee: licencia abierta (ends_on null) también bloquea'
);
select is(
  (public.assign_employee('f5900000-0000-0000-0000-000000000042', 'f5900000-0000-0000-0000-000000000091') -> 'warnings'),
  '[]'::jsonb,
  'assign_employee: un empleado sin licencia se asigna normalmente'
);

-- Una licencia dada de baja lógica no bloquea.
set local role postgres;
update public.employee_leaves set deleted_at = now()
 where employee_id = 'f5900000-0000-0000-0000-000000000094';
select tests_0059.as_user('test-db059-owner@example.com');
select is(
  (public.assign_employee('f5900000-0000-0000-0000-000000000043', 'f5900000-0000-0000-0000-000000000094') -> 'assignment' ->> 'status'),
  'expected',
  'assign_employee: una licencia dada de baja (deleted_at) no bloquea'
);

-- create_shift: Carla rechazada con ON_LEAVE, Ana asignada, el turno se crea.
select set_config('t.c1', public.create_shift(
  'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011',
  date '2199-07-13', time '14:00', time '16:00', 2::smallint, null, null, false, true,
  array['f5900000-0000-0000-0000-000000000093', 'f5900000-0000-0000-0000-000000000091']::uuid[])::text, true);
select is(
  (select e ->> 'code' from jsonb_array_elements(current_setting('t.c1')::jsonb -> 'rejected') e),
  'ON_LEAVE',
  'create_shift: la empleada de licencia queda rechazada con code ON_LEAVE'
);
select is(
  (select array_agg(e ->> 'employee_id') from jsonb_array_elements(current_setting('t.c1')::jsonb -> 'assigned') e),
  array['f5900000-0000-0000-0000-000000000091'],
  'create_shift: el turno se crea y asigna al resto (Ana)'
);

-- create_shift_series: Carla rechazada solo en la fecha de licencia (2199-07-15).
select set_config('t.s1', public.create_shift_series(
  'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011',
  time '18:00', time '20:00', 2::smallint, date '2199-07-08', date '2199-07-22',
  array[extract(dow from date '2199-07-15')::smallint], null, false, null, false, true,
  array['f5900000-0000-0000-0000-000000000093', 'f5900000-0000-0000-0000-000000000091']::uuid[])::text, true);
select is(
  (select jsonb_agg(c ->> 'shift_date' order by c ->> 'shift_date') from jsonb_array_elements(current_setting('t.s1')::jsonb -> 'created') c where jsonb_array_length(c -> 'rejected') > 0),
  '["2199-07-15"]'::jsonb,
  'create_shift_series: Carla queda rechazada solo en la fecha en que está de licencia'
);
select is(
  (select jsonb_array_length(current_setting('t.s1')::jsonb -> 'created')),
  3,
  'create_shift_series: se crean los tres turnos igual'
);

-- generate_shifts con fijos: Ana y Carla; Carla no se asigna el 14 (licencia).
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f5900000-0000-0000-0000-000000000031', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', 'Servicio con fijos 0059',
   array[extract(dow from date '2199-07-14')::smallint], '21:00', '23:00', 2, '2199-07-01', '2199-07-31', 'active');
select tests_0059.as_user('test-db059-admin@example.com');
select public.set_service_fixed_employees('f5900000-0000-0000-0000-000000000031', array[
  'f5900000-0000-0000-0000-000000000091', 'f5900000-0000-0000-0000-000000000093']::uuid[]);
select set_config('t.g1', public.generate_shifts(2199, 7)::text, true);
select is(
  (select array_agg(e ->> 'shift_date' || ' ' || (e ->> 'code') || ' ' || (e ->> 'employee_id') order by e ->> 'shift_date')
   from jsonb_array_elements(current_setting('t.g1')::jsonb -> 'unassigned') e
   where e ->> 'service_id' = 'f5900000-0000-0000-0000-000000000031'),
  array['2199-07-14 ON_LEAVE f5900000-0000-0000-0000-000000000093'],
  'generate_shifts: el fijo de licencia no se asigna (ON_LEAVE) y se informa'
);
select is(
  (select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id
   where s.service_id = 'f5900000-0000-0000-0000-000000000031' and a.removed_at is null
     and a.employee_id = 'f5900000-0000-0000-0000-000000000091'),
  (select count(*)::int from public.shifts s where s.service_id = 'f5900000-0000-0000-0000-000000000031'),
  'generate_shifts: Ana queda asignada en todos los turnos del servicio'
);

-- 3. Cambiar la fecha del turno ----------------------------------------------------------------

set local role postgres;
-- Disponibilidad de Dora: solo un día de la semana distinto del 2199-09-30.
insert into public.employee_availability (employee_id, weekday, start_time, end_time) values
  ('f5900000-0000-0000-0000-000000000094', ((extract(dow from date '2199-09-02')::int + 1) % 7)::smallint, '00:00', '23:59');
insert into public.holidays (holiday_date, name) values (date '2199-09-08', 'Feriado de prueba 0059');

-- D1 (09-01, Ana) para mover; D3 (09-03, 09:00-11:00, Ana) para provocar la superposición.
-- D4 (09-05, Carla) para la licencia del 09-10..09-12; D5 (09-20, Beto, con fichaje).
-- D6 (09-22, en curso); W1 (09-30, Dora, para las advertencias).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f5900000-0000-0000-0000-000000000061', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-01', '08:00', '12:00', 1, 'assigned'),
  ('f5900000-0000-0000-0000-000000000063', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-03', '09:00', '11:00', 1, 'assigned'),
  ('f5900000-0000-0000-0000-000000000064', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-05', '08:00', '12:00', 1, 'assigned'),
  ('f5900000-0000-0000-0000-000000000065', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-20', '08:00', '12:00', 1, 'assigned'),
  ('f5900000-0000-0000-0000-000000000066', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-22', '08:00', '12:00', 1, 'in_progress'),
  ('f5900000-0000-0000-0000-000000000067', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', '2199-09-30', '08:00', '12:00', 1, 'assigned');
insert into public.assignments (id, shift_id, employee_id) values
  ('f5900000-0000-0000-0000-000000000071', 'f5900000-0000-0000-0000-000000000061', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-000000000073', 'f5900000-0000-0000-0000-000000000063', 'f5900000-0000-0000-0000-000000000091'),
  ('f5900000-0000-0000-0000-000000000074', 'f5900000-0000-0000-0000-000000000064', 'f5900000-0000-0000-0000-000000000093'),
  ('f5900000-0000-0000-0000-000000000075', 'f5900000-0000-0000-0000-000000000065', 'f5900000-0000-0000-0000-000000000092'),
  ('f5900000-0000-0000-0000-000000000076', 'f5900000-0000-0000-0000-000000000066', 'f5900000-0000-0000-0000-000000000092'),
  ('f5900000-0000-0000-0000-000000000077', 'f5900000-0000-0000-0000-000000000067', 'f5900000-0000-0000-0000-000000000094');
-- Fichaje en D5 (el turno "empezó" aunque su estado siga assigned).
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  ('f5900000-0000-0000-0000-000000000075', 'check_in', timestamptz '2199-09-20 11:00:00+00', 'employee_app', 'f5900000-0000-0000-0000-000000000092');

-- Permisos.
select tests_0059.as_user('test-db059-supervisora@example.com');
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000061', time '08:00', time '12:00', false, date '2199-09-02')$$),
  'FORBIDDEN',
  'update_shift_time con fecha: un supervisor no puede (FORBIDDEN)'
);
select tests_0059.as_user('test-db059-empleado@example.com');
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000061', time '08:00', time '12:00', false, date '2199-09-02')$$),
  'FORBIDDEN',
  'update_shift_time con fecha: un empleado no puede (FORBIDDEN)'
);
select is(
  tests_0059.err_hint($$select public.get_shift_date_warnings('f5900000-0000-0000-0000-000000000061', date '2199-09-02')$$),
  'FORBIDDEN',
  'get_shift_date_warnings: un empleado no puede (FORBIDDEN)'
);

select tests_0059.as_user('test-db059-admin@example.com');

-- Superposición en la fecha nueva: Ana ya tiene D3 el 09-03 de 09:00 a 11:00.
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000061', time '08:00', time '12:00', false, date '2199-09-03')$$),
  'ASSIGNMENT_OVERLAP',
  'update_shift_time: la fecha nueva deja a Ana superpuesta -> ASSIGNMENT_OVERLAP'
);
select is(
  (select shift_date::text from public.shifts where id = 'f5900000-0000-0000-0000-000000000061'),
  '2199-09-01',
  'update_shift_time: el intento fallido no movió el turno'
);

-- Licencia en la fecha nueva: Carla está de licencia del 09-10 al 09-12.
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000064', time '08:00', time '12:00', false, date '2199-09-11')$$),
  'ON_LEAVE',
  'update_shift_time: un asignado de licencia en la fecha nueva -> ON_LEAVE'
);
select ok(
  tests_0059.err_message($$select public.update_shift_time('f5900000-0000-0000-0000-000000000064', time '08:00', time '12:00', false, date '2199-09-11')$$) like '%Carla Licencia%',
  'update_shift_time: ON_LEAVE nombra a quien está de licencia'
);

-- Turno que ya empezó: hay un fichaje.
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000065', time '08:00', time '12:00', false, date '2199-09-21')$$),
  'SHIFT_STARTED',
  'update_shift_time: con un fichaje en sus asignaciones no se puede cambiar la fecha (SHIFT_STARTED)'
);
-- Turno en curso, sin fichajes cargados: tampoco.
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000066', time '08:00', time '12:00', false, date '2199-09-23')$$),
  'SHIFT_STARTED',
  'update_shift_time: un turno en curso no admite cambio de fecha (SHIFT_STARTED)'
);
-- Mismo día (p_date igual a la fecha actual) y solo el horario: sigue andando.
select is(
  (select end_time::text from public.update_shift_time('f5900000-0000-0000-0000-000000000065', time '08:00', time '13:00', false, date '2199-09-20')),
  '13:00:00',
  'update_shift_time: p_date igual a la fecha actual no cuenta como cambio de fecha'
);
select is(
  (select end_time::text from public.update_shift_time('f5900000-0000-0000-0000-000000000065', time '08:00', time '14:00')),
  '14:00:00',
  'update_shift_time: sin p_date funciona como antes'
);

-- Cambio válido de fecha: se mueve el turno y la asignación acompaña.
select is(
  (select shift_date::text from public.update_shift_time('f5900000-0000-0000-0000-000000000061', time '09:00', time '12:30', false, date '2199-09-02')),
  '2199-09-02',
  'update_shift_time: cambia la fecha (y el horario) de un turno que no empezó'
);
select is(
  (select a.shift_date::text || ' ' || lower(a."window")::text from public.assignments a where a.id = 'f5900000-0000-0000-0000-000000000071'),
  '2199-09-02 ' || (timestamp '2199-09-02 09:00' at time zone 'America/Argentina/Buenos_Aires')::text,
  'update_shift_time: la asignación recalcula su fecha y su ventana de fichaje'
);
select is(
  (select starts_at from public.shifts where id = 'f5900000-0000-0000-0000-000000000061'),
  (timestamp '2199-09-02 09:00' at time zone 'America/Argentina/Buenos_Aires'),
  'update_shift_time: starts_at se regenera con la fecha nueva'
);
-- A terminar con fecha nueva.
select is(
  (select row(shift_date::text, open_ended, end_time::text)::text from public.update_shift_time('f5900000-0000-0000-0000-000000000061', time '09:00', null, true, date '2199-09-04')),
  '(2199-09-04,t,23:59:00)',
  'update_shift_time: un turno «A terminar» también cambia de fecha (fin 23:59)'
);

-- Servicio: no se puede mover a un día en que el servicio ya tiene turno.
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f5900000-0000-0000-0000-000000000032', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', 'Servicio de dos días 0059',
   array[1]::smallint[], '05:00', '06:00', 1, '2199-10-01', '2199-10-31', 'active');
insert into public.shifts (id, client_id, site_id, service_id, shift_date, start_time, end_time, required_staff, status) values
  ('f5900000-0000-0000-0000-000000000068', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', 'f5900000-0000-0000-0000-000000000032', '2199-10-05', '05:00', '06:00', 1, 'scheduled'),
  ('f5900000-0000-0000-0000-000000000069', 'f5900000-0000-0000-0000-000000000001', 'f5900000-0000-0000-0000-000000000011', 'f5900000-0000-0000-0000-000000000032', '2199-10-06', '05:00', '06:00', 1, 'scheduled');
select tests_0059.as_user('test-db059-admin@example.com');
select is(
  tests_0059.err_hint($$select public.update_shift_time('f5900000-0000-0000-0000-000000000068', time '05:00', time '06:00', false, date '2199-10-06')$$),
  'SHIFT_DATE_TAKEN',
  'update_shift_time: el servicio ya tiene un turno en la fecha nueva -> SHIFT_DATE_TAKEN'
);

-- Advertencias.
select is(
  (public.get_shift_date_warnings('f5900000-0000-0000-0000-000000000067', date '2199-09-08') -> 'warnings'),
  '["HOLIDAY", "OUTSIDE_AVAILABILITY"]'::jsonb,
  'get_shift_date_warnings: feriado y Dora fuera de su disponibilidad'
);
select is(
  (public.get_shift_date_warnings('f5900000-0000-0000-0000-000000000067', date '2199-09-08') -> 'outside_availability' -> 0 ->> 'employee_name'),
  'Dora Disponible',
  'get_shift_date_warnings: nombra a quien queda fuera de disponibilidad'
);
select is(
  (public.get_shift_date_warnings('f5900000-0000-0000-0000-000000000061', date '2199-09-09') -> 'warnings'),
  '[]'::jsonb,
  'get_shift_date_warnings: sin feriado ni disponibilidad declarada -> sin advertencias'
);

select * from finish();

rollback;
