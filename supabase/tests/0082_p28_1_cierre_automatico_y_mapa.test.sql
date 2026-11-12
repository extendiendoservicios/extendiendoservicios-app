-- pgTAP de la migración 0082_p28_1_observaciones_11_nov.sql (P28.1), parte 4:
--   OF-11 app.auto_close_assignments (cierre automático 1 hora después del fin programado),
--         attendance_records.auto_closed y v_assignments_board.check_out_auto_closed.
--   OF-13 v_sites_day_status (por comenzar, en curso y finalizados por sede).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f82d0000-...'. El cierre automático se prueba con fechas pasadas (2000-01-03,
-- lunes) y el parámetro p_now; el mapa, con turnos de hoy que no dependen de la hora (uno a las
-- 00:00, otro a las 23:58 y otros por estado).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0082d;
grant usage on schema tests_0082d to authenticated, anon;

create or replace function tests_0082d.as_user(p_email text)
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
    raise exception 'tests_0082d.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0082d.as_user(text) to authenticated, anon;

create or replace function tests_0082d.err(p_sql text)
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

grant execute on function tests_0082d.err(text) to authenticated, anon;

select plan(35);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'attendance_records', 'auto_closed', 'attendance_records.auto_closed existe');
select col_default_is('public', 'attendance_records', 'auto_closed', 'false', 'auto_closed arranca en false');
select ok(
  has_column_privilege('authenticated', 'public.attendance_records', 'auto_closed', 'select'),
  'authenticated puede leer auto_closed (select por columna de 0054)'
);
select has_column('public', 'v_assignments_board', 'check_out_auto_closed', 'la vista del tablero trae check_out_auto_closed');
select has_view('public', 'v_sites_day_status', 'v_sites_day_status');
select ok(
  not has_function_privilege('authenticated', 'app.auto_close_assignments(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.auto_close_assignments(timestamptz)', 'execute'),
  'el cierre automático no lo puede llamar nadie desde la API'
);
select ok(
  not exists (select 1 from pg_extension where extname = 'pg_cron')
  or exists (select 1 from cron.job where jobname = 'auto-close-assignments' and schedule = '*/15 * * * *'),
  'pg_cron: la tarea auto-close-assignments corre cada 15 minutos'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f82d0000-0000-0000-0000-000000000001', 'Cliente 0082d', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f82d0000-0000-0000-0000-000000000011', 'f82d0000-0000-0000-0000-000000000001', 'Sede cierre 0082d', 'Dirección 82d', -34.6, -58.4, 'active'),
  ('f82d0000-0000-0000-0000-000000000012', 'f82d0000-0000-0000-0000-000000000001', 'Sede por comenzar 0082d', 'Dirección 82d 2', -34.61, -58.41, 'active'),
  ('f82d0000-0000-0000-0000-000000000013', 'f82d0000-0000-0000-0000-000000000001', 'Sede en curso 0082d', 'Dirección 82d 3', -34.62, -58.42, 'active'),
  ('f82d0000-0000-0000-0000-000000000014', 'f82d0000-0000-0000-0000-000000000001', 'Sede finalizada 0082d', 'Dirección 82d 4', -34.63, -58.43, 'active'),
  ('f82d0000-0000-0000-0000-000000000015', 'f82d0000-0000-0000-0000-000000000001', 'Sede sin turnos 0082d', 'Dirección 82d 5', -34.64, -58.44, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f82d0000-0000-0000-0000-000000000081', 'test-db0082d-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Cuatro')),
  ('f82d0000-0000-0000-0000-000000000082', 'test-db0082d-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Cuatro')),
  ('f82d0000-0000-0000-0000-000000000091', 'test-db0082d-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Cuatro')),
  ('f82d0000-0000-0000-0000-0000000000a1', 'test-db0082d-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f82d0000-0000-0000-0000-0000000000a2', 'test-db0082d-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f82d0000-0000-0000-0000-0000000000a3', 'test-db0082d-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera')),
  ('f82d0000-0000-0000-0000-0000000000a4', 'test-db0082d-a4@example.com', jsonb_build_object('first_name', 'Diego', 'last_name', 'Duarte'));

insert into public.user_roles (profile_id, role) values
  ('f82d0000-0000-0000-0000-000000000081', 'owner'),
  ('f82d0000-0000-0000-0000-000000000082', 'admin'),
  ('f82d0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f82d0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f82d0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f82d0000-0000-0000-0000-0000000000a3', 'employee'),
  ('f82d0000-0000-0000-0000-0000000000a4', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f82d0000-0000-0000-0000-000000000091', '98204091', 'active'),
  ('f82d0000-0000-0000-0000-0000000000a1', '98204101', 'active'),
  ('f82d0000-0000-0000-0000-0000000000a2', '98204102', 'active'),
  ('f82d0000-0000-0000-0000-0000000000a3', '98204103', 'active'),
  ('f82d0000-0000-0000-0000-0000000000a4', '98204104', 'active');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f82d0000-0000-0000-0000-000000000082', 'manage_attendance', true);

-- Turnos del lunes 2000-01-03 (en la sede de cierre):
--   S1 08 a 10, Acosta con inicio a las 08:05 y sin fin: se cierra a las 11:00
--   S2 12 a 14 «A terminar», Boutter con inicio y sin fin: no se cierra nunca
--   S3 15 a 17, Cabrera sin inicio: no se cierra (queda ausente)
--   S4 08 a 12 con franja propia de Duarte de 08 a 10 y su inicio a las 08:00: se cierra a las 11:00
-- Y uno de dos semanas antes (1999-12-20, 08 a 10) de Cabrera con inicio y sin fin: fuera de las 48 horas.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, open_ended) values
  ('f82d0000-0000-0000-0000-000000000031', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000011', '2000-01-03', '08:00', '10:00', 1, 'in_progress', false),
  ('f82d0000-0000-0000-0000-000000000032', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000011', '2000-01-03', '12:00', '23:59', 1, 'in_progress', true),
  ('f82d0000-0000-0000-0000-000000000033', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000011', '2000-01-03', '15:00', '17:00', 1, 'assigned', false),
  ('f82d0000-0000-0000-0000-000000000034', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000011', '2000-01-03', '08:00', '12:00', 1, 'in_progress', false),
  ('f82d0000-0000-0000-0000-000000000035', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000011', '1999-12-20', '08:00', '10:00', 1, 'in_progress', false);

insert into public.assignments (id, shift_id, employee_id, start_time, end_time, status) values
  ('f82d0000-0000-0000-0000-000000000101', 'f82d0000-0000-0000-0000-000000000031', 'f82d0000-0000-0000-0000-0000000000a1', null, null, 'present'),
  ('f82d0000-0000-0000-0000-000000000102', 'f82d0000-0000-0000-0000-000000000032', 'f82d0000-0000-0000-0000-0000000000a2', null, null, 'present'),
  ('f82d0000-0000-0000-0000-000000000103', 'f82d0000-0000-0000-0000-000000000033', 'f82d0000-0000-0000-0000-0000000000a3', null, null, 'expected'),
  ('f82d0000-0000-0000-0000-000000000104', 'f82d0000-0000-0000-0000-000000000034', 'f82d0000-0000-0000-0000-0000000000a4', '08:00', '10:00', 'present'),
  ('f82d0000-0000-0000-0000-000000000105', 'f82d0000-0000-0000-0000-000000000035', 'f82d0000-0000-0000-0000-0000000000a3', null, null, 'present');

insert into public.attendance_records (id, assignment_id, kind, recorded_at, source) values
  ('f82d0000-0000-0000-0000-000000000201', 'f82d0000-0000-0000-0000-000000000101', 'check_in', app.local_ts('2000-01-03', '08:05'), 'employee_app'),
  ('f82d0000-0000-0000-0000-000000000202', 'f82d0000-0000-0000-0000-000000000102', 'check_in', app.local_ts('2000-01-03', '12:02'), 'employee_app'),
  ('f82d0000-0000-0000-0000-000000000204', 'f82d0000-0000-0000-0000-000000000104', 'check_in', app.local_ts('2000-01-03', '08:00'), 'employee_app'),
  ('f82d0000-0000-0000-0000-000000000205', 'f82d0000-0000-0000-0000-000000000105', 'check_in', app.local_ts('1999-12-20', '08:00'), 'employee_app');

-- Cierre automático ------------------------------------------------------------------------------

select is(app.auto_close_assignments(app.local_ts('2000-01-03', '10:59')), 0, 'a los 59 minutos del fin programado todavía no cierra nada');
select is(
  (select count(*)::int from public.attendance_records where kind = 'check_out' and assignment_id::text like 'f82d0000%'),
  0, 'sin fines registrados'
);

select is(app.auto_close_assignments(app.local_ts('2000-01-03', '11:00')), 2, 'a la hora del fin programado: cierra las dos asignaciones (la de la franja del turno y la de franja propia)');

select is(
  (select recorded_at from public.attendance_records where assignment_id = 'f82d0000-0000-0000-0000-000000000101' and kind = 'check_out'),
  app.local_ts('2000-01-03', '10:00'), 'el fin es la hora de fin programada del turno'
);
select is(
  (select recorded_at from public.attendance_records where assignment_id = 'f82d0000-0000-0000-0000-000000000104' and kind = 'check_out'),
  app.local_ts('2000-01-03', '10:00'), 'con franja propia, el fin es el de la franja propia (no el del turno, 12:00)'
);
select is(
  (select source::text || ' / ' || coalesce(recorded_by::text, 'sin autor') || ' / ' || auto_closed || ' / ' || reason
   from public.attendance_records where assignment_id = 'f82d0000-0000-0000-0000-000000000101' and kind = 'check_out'),
  'admin / sin autor / true / Cierre automático: no se registró el fin',
  'queda marcado: origen administración, sin autor, auto_closed y el motivo'
);
select is(
  (select geo_status::text || ' / ' || geo_unvalidated_reason::text
   from public.attendance_records where assignment_id = 'f82d0000-0000-0000-0000-000000000101' and kind = 'check_out'),
  'unvalidated / admin_record', 'sin validación por ubicación (como cualquier registro de administración)'
);
select is(
  (select status::text from public.assignments where id = 'f82d0000-0000-0000-0000-000000000101'),
  'finished', 'la asignación queda finished, igual que con el fichaje de fin normal'
);
select is(
  (select status::text from public.shifts where id = 'f82d0000-0000-0000-0000-000000000031'),
  'completed', 'y el turno, que tenía solo esa asignación, pasa a completed'
);
select is(
  (select count(*)::int from public.attendance_records where kind = 'check_out' and assignment_id in ('f82d0000-0000-0000-0000-000000000102', 'f82d0000-0000-0000-0000-000000000103', 'f82d0000-0000-0000-0000-000000000105')),
  0, 'no cierra el turno «A terminar», ni a quien no fichó el inicio, ni lo anterior a las 48 horas'
);
select is(app.auto_close_assignments(app.local_ts('2000-01-03', '11:00')), 0, 'es idempotente: la segunda vez no cierra nada');
select is(app.auto_close_assignments(app.local_ts('2000-01-05', '09:00')), 0, 'y con el paso del tiempo (más de 48 horas) tampoco reescribe lo viejo');

-- Se puede filtrar en Asistencia y corregir ----------------------------------------------------------

select tests_0082d.as_user('test-db0082d-admin@example.com');
select is(
  (select check_out_auto_closed from public.v_assignments_board where id = 'f82d0000-0000-0000-0000-000000000101'),
  true, 'el tablero marca el fin automático'
);
select is(
  (select check_out_source::text || ' / ' || coalesce(check_out_recorded_by::text, 'sin autor') from public.v_assignments_board where id = 'f82d0000-0000-0000-0000-000000000101'),
  'admin / sin autor', 'y se distingue de un fin cargado por una persona'
);
select is(
  (select check_out_auto_closed from public.v_assignments_board where id = 'f82d0000-0000-0000-0000-000000000102'),
  false, 'un fin que no es automático (o que no existe) no se marca'
);
select is(
  (select array_agg(id::text order by id) from public.v_assignments_board where check_out_auto_closed and id::text like 'f82d0000%'),
  array['f82d0000-0000-0000-0000-000000000101', 'f82d0000-0000-0000-0000-000000000104'],
  'se puede filtrar por check_out_auto_closed'
);

select lives_ok(
  $$select public.correct_attendance_time(
      (select id from public.attendance_records where assignment_id = 'f82d0000-0000-0000-0000-000000000101' and kind = 'check_out'),
      app.local_ts('2000-01-03', '09:45'),
      'Salió antes'
    )$$,
  'correct_attendance_time corrige la hora del fin automático'
);
select is(
  (select check_out_at from public.v_assignments_board where id = 'f82d0000-0000-0000-0000-000000000101'),
  app.local_ts('2000-01-03', '09:45'), 'el tablero muestra la hora corregida'
);
select is(
  (select check_out_time_corrected from public.v_assignments_board where id = 'f82d0000-0000-0000-0000-000000000101'),
  true, 'y que fue corregida'
);

-- Sedes por estado en el día (OF-13) ---------------------------------------------------------------------

set local role postgres;
-- Por comenzar: un turno de hoy a las 23:58 y uno ya terminado (00:00 a 00:01).
-- En curso: un turno in_progress. Finalizada: un turno completed y uno cancelado (no cuenta).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82d0000-0000-0000-0000-000000000041', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000012', app.today(), '23:58', '23:59', 1, 'scheduled'),
  ('f82d0000-0000-0000-0000-000000000042', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000012', app.today(), '00:00', '00:01', 1, 'scheduled'),
  ('f82d0000-0000-0000-0000-000000000043', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000013', app.today(), '00:00', '23:59', 1, 'in_progress'),
  ('f82d0000-0000-0000-0000-000000000044', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000014', app.today(), '08:00', '09:00', 1, 'completed');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f82d0000-0000-0000-0000-000000000045', 'f82d0000-0000-0000-0000-000000000001', 'f82d0000-0000-0000-0000-000000000014', app.today(), '10:00', '11:00', 1, 'cancelled', now(), 'f82d0000-0000-0000-0000-000000000081', 'Cancelado');

select tests_0082d.as_user('test-db0082d-a1@example.com');
select is(
  (select count(*)::int from public.v_sites_day_status where site_id::text like 'f82d0000%'),
  0, 'un empleado no ve el estado de las sedes'
);
select tests_0082d.as_user('test-db0082d-sup@example.com');
select is(
  (select count(*)::int from public.v_sites_day_status where site_id::text like 'f82d0000%'),
  0, 'un coordinador tampoco'
);

select tests_0082d.as_user('test-db0082d-admin@example.com');
select is(
  (select array_agg(site_id::text order by site_id) from public.v_sites_day_status where site_id::text like 'f82d0000%'),
  array['f82d0000-0000-0000-0000-000000000012', 'f82d0000-0000-0000-0000-000000000013', 'f82d0000-0000-0000-0000-000000000014'],
  'solo salen las sedes con turnos hoy no cancelados (la sin turnos no)'
);
select is(
  (select upcoming_count || '/' || in_progress_count || '/' || finished_count || '/' || shifts_count || '/' || day_state
   from public.v_sites_day_status where site_id = 'f82d0000-0000-0000-0000-000000000012'),
  '1/0/1/2/upcoming', 'sede con un turno por comenzar y uno terminado: day_state upcoming'
);
select is(
  (select upcoming_count || '/' || in_progress_count || '/' || finished_count || '/' || shifts_count || '/' || day_state
   from public.v_sites_day_status where site_id = 'f82d0000-0000-0000-0000-000000000013'),
  '0/1/0/1/in_progress', 'sede con un turno en curso: day_state in_progress'
);
select is(
  (select upcoming_count || '/' || in_progress_count || '/' || finished_count || '/' || shifts_count || '/' || day_state
   from public.v_sites_day_status where site_id = 'f82d0000-0000-0000-0000-000000000014'),
  '0/0/1/1/finished', 'sede con un turno completado (y uno cancelado que no cuenta): day_state finished'
);
select isnt(
  (select next_starts_at from public.v_sites_day_status where site_id = 'f82d0000-0000-0000-0000-000000000012'),
  null, 'la sede por comenzar informa su próximo inicio'
);
select ok(
  (select latitude is not null and longitude is not null and radius_m is not null from public.v_sites_day_status where site_id = 'f82d0000-0000-0000-0000-000000000012'),
  'y trae la ubicación y el radio'
);

select tests_0082d.as_user('test-db0082d-owner@example.com');
select is(
  (select count(*)::int from public.v_sites_day_status where site_id::text like 'f82d0000%'),
  3, 'el dueño ve lo mismo que el administrador'
);

select * from finish();

rollback;
