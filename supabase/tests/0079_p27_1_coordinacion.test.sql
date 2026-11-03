-- pgTAP de la migración 0079_p27_1_coordinacion.sql (P27.1, observaciones de los dueños).
--   OD-08  take_supervision acepta cualquier turno de hoy no cancelado (sin empezar, con el empleado
--          ausente), con la jornada iniciada y sin pausa (CJ-07) y de a una (CJ-08).
--   OD-09  complete_supervision cierra sin calificar.
--   OD-10  Sin unicidad por coordinador y turno: se vuelve al mismo turno con una supervisión nueva;
--          dos coordinadores en el mismo turno; v_supervisor_today elige la abierta.
--   OD-06  admin_end_workday: hora elegida o actual, motivo obligatorio, cierra la pausa abierta y
--          deja «Sin cerrar» la supervisión abierta.
--   OD-07  admin_close_workday_pause, admin_correct_workday_event con el motivo de la pausa y
--          admin_correct_supervision_time, con la traza de CJ-32.
--   OD-05  v_supervisor_workdays_admin: columnas nuevas para la pantalla de jornadas.
--   Permisos: solo manage_attendance (dueño o administrador con la capacidad).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f7900000-...'. Las jornadas de las correcciones son de días pasados (hace 2 días)
-- con horarios fijos, así el resultado no depende de la hora a la que corra el CI; lo que se hace
-- «hoy» ocurre todo en el mismo instante (now() no cambia dentro de la transacción).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0079;
grant usage on schema tests_0079 to authenticated, anon;

create or replace function tests_0079.as_user(p_email text)
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
    raise exception 'tests_0079.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0079.as_user(text) to authenticated, anon;

create or replace function tests_0079.err_hint(p_sql text)
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

grant execute on function tests_0079.err_hint(text) to authenticated, anon;

select plan(95);

-- ---------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------

select hasnt_index('public', 'supervisions', 'supervisions_shift_id_supervisor_id_key', 'se quitó el índice único por (shift_id, supervisor_id) (OD-10)');
select has_index('public', 'supervisions', 'supervisions_shift_id_supervisor_id_idx', 'queda un índice no único por (shift_id, supervisor_id)');
select has_function('public', 'admin_end_workday', array['uuid', 'text', 'timestamp with time zone'], 'admin_end_workday');
select has_function('public', 'admin_close_workday_pause', array['uuid', 'text', 'timestamp with time zone'], 'admin_close_workday_pause');
select has_function('public', 'admin_correct_workday_event', array['uuid', 'text', 'timestamp with time zone', 'boolean', 'text'], 'admin_correct_workday_event con p_pause_reason');
select hasnt_function('public', 'admin_correct_workday_event', array['uuid', 'text', 'timestamp with time zone', 'boolean'], 'la firma vieja de admin_correct_workday_event ya no existe');
select has_function('public', 'admin_correct_supervision_time', array['uuid', 'text', 'timestamp with time zone', 'timestamp with time zone'], 'admin_correct_supervision_time');
select has_column('public', 'v_supervisor_workdays_admin', 'list_status', 'v_supervisor_workdays_admin.list_status');
select has_column('public', 'v_supervisor_workdays_admin', 'open_pause_event_id', 'v_supervisor_workdays_admin.open_pause_event_id');
select has_column('public', 'v_supervisor_workdays_admin', 'open_supervision_id', 'v_supervisor_workdays_admin.open_supervision_id');
select ok(
  not has_function_privilege('anon', 'public.admin_end_workday(uuid, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_end_workday(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_close_workday_pause(uuid, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_close_workday_pause(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_correct_supervision_time(uuid, text, timestamptz, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_correct_supervision_time(uuid, text, timestamptz, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.admin_correct_workday_event(uuid, text, timestamptz, boolean, text)', 'execute'),
  'grants: authenticated sí, anon no'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f7900000-0000-0000-0000-000000000001', 'Cliente de coordinación 0079', 'active', 0);

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f7900000-0000-0000-0000-000000000011', 'f7900000-0000-0000-0000-000000000001', 'Sede 0079', 'Dirección 79', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f7900000-0000-0000-0000-000000000081', 'test-db0079-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Setenta')),
  ('f7900000-0000-0000-0000-000000000082', 'test-db0079-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Con')),
  ('f7900000-0000-0000-0000-000000000083', 'test-db0079-admin2@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Sin')),
  ('f7900000-0000-0000-0000-000000000091', 'test-db0079-sa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Setenta')),
  ('f7900000-0000-0000-0000-000000000092', 'test-db0079-sb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Setenta')),
  ('f7900000-0000-0000-0000-000000000093', 'test-db0079-sc@example.com', jsonb_build_object('first_name', 'Cora', 'last_name', 'Setenta')),
  ('f7900000-0000-0000-0000-000000000094', 'test-db0079-sd@example.com', jsonb_build_object('first_name', 'Dora', 'last_name', 'Setenta')),
  ('f7900000-0000-0000-0000-0000000000a1', 'test-db0079-x@example.com', jsonb_build_object('first_name', 'Ximena', 'last_name', 'Setenta'));

insert into public.user_roles (profile_id, role) values
  ('f7900000-0000-0000-0000-000000000081', 'owner'),
  ('f7900000-0000-0000-0000-000000000082', 'admin'),
  ('f7900000-0000-0000-0000-000000000083', 'admin'),
  ('f7900000-0000-0000-0000-000000000091', 'supervisor'),
  ('f7900000-0000-0000-0000-000000000092', 'supervisor'),
  ('f7900000-0000-0000-0000-000000000093', 'supervisor'),
  ('f7900000-0000-0000-0000-000000000094', 'supervisor'),
  ('f7900000-0000-0000-0000-0000000000a1', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f7900000-0000-0000-0000-000000000082', 'manage_attendance', true);

insert into public.employees (profile_id, dni, status) values
  ('f7900000-0000-0000-0000-000000000091', '97900091', 'active'),
  ('f7900000-0000-0000-0000-000000000092', '97900092', 'active'),
  ('f7900000-0000-0000-0000-000000000093', '97900093', 'active'),
  ('f7900000-0000-0000-0000-000000000094', '97900094', 'active'),
  ('f7900000-0000-0000-0000-0000000000a1', '97900101', 'active');

-- Turnos de hoy: S1 ya empezó con Ximena trabajando; S2 todavía no empezó y Ximena no llegó (nadie
-- fichó); S3 cancelado; S4 es de mañana. Y dos turnos de hace dos días para las jornadas viejas.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f7900000-0000-0000-0000-000000000041', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today(), '00:00', '23:00', 1, 'in_progress'),
  ('f7900000-0000-0000-0000-000000000042', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today(), '22:00', '23:00', 1, 'scheduled'),
  ('f7900000-0000-0000-0000-000000000044', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('f7900000-0000-0000-0000-000000000045', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today() - 2, '08:00', '18:00', 1, 'completed'),
  ('f7900000-0000-0000-0000-000000000046', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today() - 2, '08:00', '18:00', 1, 'completed');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f7900000-0000-0000-0000-000000000043', 'f7900000-0000-0000-0000-000000000001', 'f7900000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'cancelled', now(), 'f7900000-0000-0000-0000-000000000081', 'Cancelado de prueba');

insert into public.assignments (id, shift_id, employee_id) values
  ('f7900000-0000-0000-0000-000000000201', 'f7900000-0000-0000-0000-000000000041', 'f7900000-0000-0000-0000-0000000000a1');

-- Jornada vieja de Ana (hace 2 días): inicio 08:00 y una pausa abierta desde las 10:00 («Se trabó»).
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at) values
  ('f7900000-0000-0000-0000-000000000301', 'f7900000-0000-0000-0000-000000000091', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), null);
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, reason) values
  ('f7900000-0000-0000-0000-000000000311', 'f7900000-0000-0000-0000-000000000301', 'start', app.local_ts(app.today() - 2, '08:00'), null),
  ('f7900000-0000-0000-0000-000000000312', 'f7900000-0000-0000-0000-000000000301', 'pause', app.local_ts(app.today() - 2, '10:00'), 'Se trabó');

-- Jornada vieja de Beto (hace 2 días): inicio 08:00, pausa 12:00 a 12:30 («Almuerzo») y una
-- supervisión abierta desde las 13:00.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at) values
  ('f7900000-0000-0000-0000-000000000302', 'f7900000-0000-0000-0000-000000000092', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), null);
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, reason) values
  ('f7900000-0000-0000-0000-000000000321', 'f7900000-0000-0000-0000-000000000302', 'start', app.local_ts(app.today() - 2, '08:00'), null),
  ('f7900000-0000-0000-0000-000000000322', 'f7900000-0000-0000-0000-000000000302', 'pause', app.local_ts(app.today() - 2, '12:00'), 'Almuerzo'),
  ('f7900000-0000-0000-0000-000000000323', 'f7900000-0000-0000-0000-000000000302', 'resume', app.local_ts(app.today() - 2, '12:30'), null);
insert into public.supervisions (id, shift_id, supervisor_id, status, workday_id, criteria_snapshot) values
  ('f7900000-0000-0000-0000-000000000401', 'f7900000-0000-0000-0000-000000000045', 'f7900000-0000-0000-0000-000000000092', 'in_progress', 'f7900000-0000-0000-0000-000000000302', '[]'::jsonb);
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('f7900000-0000-0000-0000-000000000401', 'check_in', app.local_ts(app.today() - 2, '13:00'));
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, supervision_id) values
  ('f7900000-0000-0000-0000-000000000324', 'f7900000-0000-0000-0000-000000000302', 'supervision_start', app.local_ts(app.today() - 2, '13:00'), 'f7900000-0000-0000-0000-000000000401');

-- Una supervisión cancelada de esa jornada (no se corrige).
insert into public.supervisions (id, shift_id, supervisor_id, status, cancel_reason, workday_id, criteria_snapshot) values
  ('f7900000-0000-0000-0000-000000000402', 'f7900000-0000-0000-0000-000000000046', 'f7900000-0000-0000-0000-000000000092', 'cancelled', 'Descartada por el coordinador', 'f7900000-0000-0000-0000-000000000302', '[]'::jsonb);

-- Jornada vieja de Cora (hace 2 días), cerrada sola.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at, auto_closed) values
  ('f7900000-0000-0000-0000-000000000303', 'f7900000-0000-0000-0000-000000000093', app.today() - 2, app.local_ts(app.today() - 2, '09:00'), app.local_ts(app.today() - 2, '23:55'), true);
insert into public.supervisor_workday_events (workday_id, kind, recorded_at, reason) values
  ('f7900000-0000-0000-0000-000000000303', 'start', app.local_ts(app.today() - 2, '09:00'), null),
  ('f7900000-0000-0000-0000-000000000303', 'end', app.local_ts(app.today() - 2, '23:55'), 'Cierre automático');

-- ---------------------------------------------------------------------------------------------
-- OD-08, OD-09, OD-10: la supervisión de hoy
-- ---------------------------------------------------------------------------------------------

select tests_0079.as_user('test-db0079-sa@example.com');

select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000042')$$),
  'WORKDAY_NOT_STARTED', 'sin jornada iniciada no se supervisa (CJ-07)'
);
select lives_ok($$select public.start_workday(-34.6, -58.4, 9)$$, 'Ana inicia su jornada de hoy');

select is(
  (select public.take_supervision('f7900000-0000-0000-0000-000000000042', -34.6, -58.4, 9)->'supervision'->>'status'),
  'in_progress', 'OD-08: toma un turno que todavía no empezó y donde nadie fichó'
);
select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000041')$$),
  'SUPERVISION_ALREADY_OPEN', 'CJ-08: de a una, hay que cerrar la abierta'
);

-- OD-09: se cierra sin calificar a nadie.
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000042' and supervisor_id = 'f7900000-0000-0000-0000-000000000091'),
     'Sin novedades')).status::text),
  'completed', 'OD-09: complete_supervision cierra sin calificar a nadie'
);
set local role postgres;
select is(
  (select count(*)::integer from public.ratings r join public.supervisions sv on sv.id = r.supervision_id
   where sv.shift_id = 'f7900000-0000-0000-0000-000000000042'),
  0, 'OD-09: sin calificaciones registradas'
);
select is(
  (select count(*)::integer from public.supervision_attendance sa join public.supervisions sv on sv.id = sa.supervision_id
   where sv.shift_id = 'f7900000-0000-0000-0000-000000000042' and sv.supervisor_id = 'f7900000-0000-0000-0000-000000000091' and sa.kind = 'check_out'),
  1, 'cerrar registra el fin igual'
);

-- OD-10: vuelve al mismo turno y abre una supervisión nueva.
select tests_0079.as_user('test-db0079-sa@example.com');
select isnt(
  (select public.take_supervision('f7900000-0000-0000-0000-000000000042', -34.6, -58.4, 9)->'supervision'->>'id'),
  (select id::text from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000042' and supervisor_id = 'f7900000-0000-0000-0000-000000000091' and status = 'completed'),
  'OD-10: vuelve al mismo turno y se abre una supervisión nueva (distinta)'
);
select is(
  (select count(*)::integer from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000042' and supervisor_id = 'f7900000-0000-0000-0000-000000000091'),
  2, 'OD-10: dos supervisiones del mismo coordinador en el mismo turno'
);
select is(
  (select my_supervision_status::text from public.v_supervisor_today where shift_id = 'f7900000-0000-0000-0000-000000000042'),
  'in_progress', 'v_supervisor_today: my_supervision_* es la abierta'
);
select is(
  (select jsonb_array_length(supervisors) from public.v_supervisor_today where shift_id = 'f7900000-0000-0000-0000-000000000042'),
  2, 'v_supervisor_today: supervisors trae las dos pasadas'
);

-- Descartar sigue valiendo para la que no tiene calificaciones.
select is(
  (select (public.discard_supervision(
     (select id from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000042' and supervisor_id = 'f7900000-0000-0000-0000-000000000091' and status = 'in_progress'))).status::text),
  'cancelled', 'discard_supervision sigue valiendo para la supervisión sin calificaciones'
);
select is(
  (select my_supervision_status::text from public.v_supervisor_today where shift_id = 'f7900000-0000-0000-0000-000000000042'),
  'completed', 'v_supervisor_today: sin abierta, my_supervision_* es la última no cancelada'
);

-- Más requisitos que siguen.
select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000043')$$),
  'SHIFT_NOT_SUPERVISABLE', 'un turno cancelado no se supervisa'
);
select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000044')$$),
  'NOT_TODAY', 'un turno de mañana no se supervisa'
);

-- Calificar sigue siendo posible y es una por supervisión (CJ-09): Ana toma el turno que ya empezó.
select lives_ok(
  $$select public.take_supervision('f7900000-0000-0000-0000-000000000041', -34.6, -58.4, 9)$$,
  'Ana toma el turno que ya empezó'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000041' and supervisor_id = 'f7900000-0000-0000-0000-000000000091' and status = 'in_progress'), 'f7900000-0000-0000-0000-000000000201', 4, 'Bien')$$,
  'Ana califica a Ximena (opcional, pero sigue funcionando)'
);

-- Pausa: no se supervisa en pausa (CJ-07). Dos coordinadores en el mismo turno (CJ-05).
select tests_0079.as_user('test-db0079-sb@example.com');
select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000041')$$),
  'WORKDAY_NOT_STARTED', 'Beto no tiene jornada de hoy (la de hace 2 días no cuenta)'
);
select lives_ok($$select public.start_workday()$$, 'Beto inicia su jornada de hoy');
select lives_ok(
  $$select public.take_supervision('f7900000-0000-0000-0000-000000000041')$$,
  'CJ-05: Beto supervisa el mismo turno que Ana, abierta'
);
select is(
  (select count(*)::integer from public.v_supervisor_today where shift_id = 'f7900000-0000-0000-0000-000000000041' and jsonb_array_length(supervisors) = 2),
  1, 'v_supervisor_today: el turno muestra a los dos coordinadores'
);

-- ---------------------------------------------------------------------------------------------
-- OD-06: admin_end_workday con la jornada de hoy (Ana: supervisión abierta; Beto: se pausa antes)
-- ---------------------------------------------------------------------------------------------

select tests_0079.as_user('test-db0079-admin2@example.com');
select is(
  tests_0079.err_hint($$select public.admin_end_workday((select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()), 'Prueba')$$),
  'FORBIDDEN', 'un administrador sin manage_attendance no finaliza jornadas'
);
select tests_0079.as_user('test-db0079-sa@example.com');
select is(
  tests_0079.err_hint($$select public.admin_end_workday((select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()), 'Prueba')$$),
  'FORBIDDEN', 'un coordinador no finaliza la jornada de otro desde la administración'
);

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  tests_0079.err_hint($$select public.admin_end_workday((select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()), '  ')$$),
  'REASON_REQUIRED', 'el motivo es obligatorio'
);
select is(
  tests_0079.err_hint($$select public.admin_end_workday('f7900000-0000-0000-0000-0000000000ff', 'Prueba')$$),
  'WORKDAY_NOT_FOUND', 'jornada inexistente'
);
select is(
  tests_0079.err_hint($$select public.admin_end_workday((select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()), 'Prueba', now() + interval '1 hour')$$),
  'AT_OUT_OF_RANGE', 'la hora de fin no puede ser futura'
);
select is(
  (select public.admin_end_workday(
     (select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()),
     'Se trabó la app')->>'state'),
  'ended', 'OD-06: finaliza la jornada de hoy con la hora actual'
);

set local role postgres;
select ok(
  (select w.corrected and w.ended_at is not null and not w.auto_closed
   from public.supervisor_workdays w where w.supervisor_id = 'f7900000-0000-0000-0000-000000000091' and w.work_date = app.today()),
  'la jornada queda con ended_at y corrected, sin marca de cierre automático'
);
select is(
  (select count(*)::integer from public.supervisions sv
   join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
   where sv.shift_id = 'f7900000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f7900000-0000-0000-0000-000000000091' and sv.status = 'in_progress'),
  1, 'la supervisión abierta se cerró con fin y quedó «Sin cerrar» (in_progress con fin)'
);
select is(
  (select e.reason from public.supervisor_workday_events e
   join public.supervisions sv on sv.id = e.supervision_id
   where sv.shift_id = 'f7900000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f7900000-0000-0000-0000-000000000091' and e.kind = 'supervision_end'),
  'Cierre por la administración', 'el evento supervision_end dice quién lo cerró'
);
select ok(
  (select e.corrected_at is not null and e.correction_reason = 'Se trabó la app'
   from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f7900000-0000-0000-0000-000000000091' and w.work_date = app.today() and e.kind = 'end'),
  'el evento end lleva la traza de CJ-32 (corrected_at y correction_reason)'
);
select is(
  (select details ->> 'action' from public.security_events
   where event_type = 'workday_corrected' and target_id = 'f7900000-0000-0000-0000-000000000091' and details ->> 'action' = 'end_workday'),
  'end_workday', 'queda workday_corrected (end_workday) en security_events'
);

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  tests_0079.err_hint($$select public.admin_end_workday((select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000091' and work_date = app.today()), 'Otra vez')$$),
  'WORKDAY_ENDED', 'una jornada ya finalizada no se finaliza de nuevo'
);

-- Beto, de hoy, se pausa y la administración finaliza estando en pausa (cierra la pausa y la
-- supervisión abierta). Primero tiene que cerrar su supervisión para pausar (CJ-29).
select tests_0079.as_user('test-db0079-sb@example.com');
select is(
  tests_0079.err_hint($$select public.pause_workday('Baño')$$),
  'SUPERVISION_OPEN', 'CJ-29: con una supervisión abierta no se pausa'
);
select lives_ok(
  $$select public.complete_supervision((select id from public.supervisions where shift_id = 'f7900000-0000-0000-0000-000000000041' and supervisor_id = 'f7900000-0000-0000-0000-000000000092'))$$,
  'Beto cierra su supervisión sin calificar a Ximena (OD-09)'
);
select lives_ok($$select public.pause_workday('Baño')$$, 'Beto se pausa');
select is(
  tests_0079.err_hint($$select public.take_supervision('f7900000-0000-0000-0000-000000000042')$$),
  'WORKDAY_PAUSED', 'CJ-07: en pausa no se supervisa'
);

select tests_0079.as_user('test-db0079-owner@example.com');
select is(
  (select public.admin_end_workday(
     (select id from public.supervisor_workdays where supervisor_id = 'f7900000-0000-0000-0000-000000000092' and work_date = app.today()),
     'Se olvidó de volver')->>'state'),
  'ended', 'OD-06: finaliza una jornada que estaba en pausa (el dueño también puede)'
);

-- ---------------------------------------------------------------------------------------------
-- OD-07: cerrar una pausa abierta (Ana, hace 2 días)
-- ---------------------------------------------------------------------------------------------

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  (select open_pause_event_id::text from public.v_supervisor_workdays_admin where id = 'f7900000-0000-0000-0000-000000000301'),
  'f7900000-0000-0000-0000-000000000312', 'v_supervisor_workdays_admin: open_pause_event_id apunta a la pausa abierta'
);
select is(
  (select list_status from public.v_supervisor_workdays_admin where id = 'f7900000-0000-0000-0000-000000000301'),
  'open', 'v_supervisor_workdays_admin: la jornada sin fin está «open»'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000312', '', app.local_ts(app.today() - 2, '10:30'))$$),
  'REASON_REQUIRED', 'cerrar pausa: motivo obligatorio'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000311', 'Prueba', app.local_ts(app.today() - 2, '10:30'))$$),
  'EVENT_NOT_PAUSE', 'cerrar pausa: el evento tiene que ser una pausa'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-0000000000ff', 'Prueba', app.local_ts(app.today() - 2, '10:30'))$$),
  'EVENT_NOT_FOUND', 'cerrar pausa: evento inexistente'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000312', 'Prueba', app.local_ts(app.today() - 2, '09:00'))$$),
  'INVALID_TIME_RANGE', 'cerrar pausa: la reanudación tiene que ser posterior al inicio de la pausa'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000312', 'Prueba', app.local_ts(app.today() - 1, '10:30'))$$),
  'AT_OUT_OF_RANGE', 'cerrar pausa: dentro del día de la jornada'
);
select is(
  (select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000312', 'La app se trabó', app.local_ts(app.today() - 2, '10:30'))->>'state'),
  'running', 'OD-07: cierra la pausa abierta a la hora indicada y la jornada sigue en marcha'
);
select is(
  (select app.workday_pauses('f7900000-0000-0000-0000-000000000301') -> 0 ->> 'minutes'),
  '30', 'la pausa corregida dura 30 minutos y tiene su reanudación'
);
select is(
  tests_0079.err_hint($$select public.admin_close_workday_pause('f7900000-0000-0000-0000-000000000312', 'Otra vez', app.local_ts(app.today() - 2, '11:00'))$$),
  'PAUSE_NOT_OPEN', 'cerrar una pausa que ya está cerrada -> PAUSE_NOT_OPEN'
);
set local role postgres;
select ok(
  (select count(*) = 2 and bool_and(corrected_at is not null and correction_reason = 'La app se trabó')
   from public.supervisor_workday_events where workday_id = 'f7900000-0000-0000-0000-000000000301' and kind in ('pause', 'resume')),
  'la pausa y la reanudación llevan la traza de CJ-32'
);
select ok(
  (select corrected from public.supervisor_workdays where id = 'f7900000-0000-0000-0000-000000000301'),
  'la jornada queda corrected'
);

-- ---------------------------------------------------------------------------------------------
-- OD-07: motivo de la pausa y horas de la supervisión (Beto, hace 2 días)
-- ---------------------------------------------------------------------------------------------

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  tests_0079.err_hint($$select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Prueba')$$),
  'TIME_REQUIRED', 'sin hora ni motivo de pausa -> TIME_REQUIRED'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000321', 'Prueba', null, false, 'Algo')$$),
  'EVENT_NOT_PAUSE', 'el motivo de pausa solo en eventos pause'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Prueba', null, false, repeat('x', 301))$$),
  'REASON_TOO_LONG', 'el motivo de la pausa tiene máximo 300 caracteres'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Prueba', null, false, 'Almuerzo')$$),
  'NO_CHANGES', 'el mismo motivo de pausa -> NO_CHANGES'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Prueba', app.local_ts(app.today() - 2, '12:00'))$$),
  'SAME_TIME', 'la misma hora (solo hora) -> SAME_TIME'
);
select is(
  (select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Lo pidió el dueño', null, false, 'Almuerzo largo')->>'state'),
  'running', 'OD-07: cambia el motivo de la pausa sin tocar la hora'
);
set local role postgres;
select ok(
  (select reason = 'Almuerzo largo' and recorded_at = app.local_ts(app.today() - 2, '12:00') and corrected_from is null
     and corrected_at is not null and correction_reason = 'Lo pidió el dueño'
   from public.supervisor_workday_events where id = 'f7900000-0000-0000-0000-000000000322'),
  'el motivo cambió, la hora no (sin corrected_from) y queda la traza'
);
select ok(
  (select details ->> 'action' = 'correct_pause_reason' and details ->> 'old_pause_reason' = 'Almuerzo' and details ->> 'new_pause_reason' = 'Almuerzo largo'
   from public.security_events where event_type = 'workday_corrected' and details ->> 'event_id' = 'f7900000-0000-0000-0000-000000000322'),
  'security_events guarda el motivo anterior y el nuevo'
);
select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  (select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Sin motivo', null, false, '')->>'state'),
  'running', 'una cadena vacía borra el motivo de la pausa (es opcional)'
);
select is(
  (select public.admin_correct_workday_event('f7900000-0000-0000-0000-000000000322', 'Hora y motivo', app.local_ts(app.today() - 2, '12:05'), false, 'Almuerzo')->>'state'),
  'running', 'se puede cambiar la hora y el motivo en la misma llamada'
);
set local role postgres;
select ok(
  (select reason = 'Almuerzo' and recorded_at = app.local_ts(app.today() - 2, '12:05') and corrected_from = app.local_ts(app.today() - 2, '12:00')
   from public.supervisor_workday_events where id = 'f7900000-0000-0000-0000-000000000322'),
  'hora y motivo cambiados; corrected_from guarda la hora original'
);

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', null, app.local_ts(app.today() - 2, '16:00'))$$),
  'SUPERVISION_NOT_CLOSED', 'no se corrige el fin de una supervisión que no tiene fin'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000402', 'Prueba', app.local_ts(app.today() - 2, '09:00'))$$),
  'SUPERVISION_NOT_EDITABLE', 'una supervisión cancelada no se corrige'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', '', app.local_ts(app.today() - 2, '13:10'))$$),
  'REASON_REQUIRED', 'corregir supervisión: motivo obligatorio'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba')$$),
  'TIME_REQUIRED', 'corregir supervisión: al menos una hora'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-0000000000ff', 'Prueba', app.local_ts(app.today() - 2, '13:10'))$$),
  'SUPERVISION_NOT_FOUND', 'corregir supervisión inexistente'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', app.local_ts(app.today() - 2, '07:00'))$$),
  'INVALID_EVENT_ORDER', 'el inicio de la supervisión no puede quedar antes del inicio de la jornada'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', app.local_ts(app.today() - 1, '09:00'))$$),
  'AT_OUT_OF_RANGE', 'el inicio tiene que caer dentro del día de la jornada'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', app.local_ts(app.today() - 2, '13:00'))$$),
  'SAME_TIME', 'la misma hora -> SAME_TIME'
);

-- La administración finaliza la jornada vieja de Beto a las 17:00: la supervisión queda «Sin cerrar».
select is(
  tests_0079.err_hint($$select public.admin_end_workday('f7900000-0000-0000-0000-000000000302', 'Se fue sin finalizar', app.local_ts(app.today() - 2, '12:10'))$$),
  'AT_BEFORE_LAST_EVENT', 'OD-06: el fin no puede ser anterior al último registro de la jornada'
);
select is(
  (select public.admin_end_workday('f7900000-0000-0000-0000-000000000302', 'Se fue sin finalizar', app.local_ts(app.today() - 2, '17:00'))->>'minutes'),
  '515', 'OD-06: fin a las 17:00; minutos netos = 08:00 a 12:05 (245) + 12:30 a 17:00 (270)'
);
set local role postgres;
select ok(
  (select sv.status = 'in_progress' and co.recorded_at = app.local_ts(app.today() - 2, '17:00')
   from public.supervisions sv
   join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
   where sv.id = 'f7900000-0000-0000-0000-000000000401'),
  'la supervisión abierta de la jornada vieja quedó «Sin cerrar» con el fin a las 17:00'
);
select is(
  (select list_status || '/' || is_open::text || '/' || coalesce(open_supervision_id::text, 'sin')
   from public.v_supervisor_workdays_admin where id = 'f7900000-0000-0000-0000-000000000302'),
  'closed/false/sin', 'v_supervisor_workdays_admin: terminada por la administración -> closed, sin supervisión abierta'
);

-- Corregir las horas de la supervisión (inicio 13:10, fin 16:50).
select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', null, app.local_ts(app.today() - 2, '13:00'))$$),
  'INVALID_TIME_RANGE', 'el fin tiene que ser posterior al inicio'
);
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', null, app.local_ts(app.today() - 2, '18:00'))$$),
  'INVALID_EVENT_ORDER', 'el fin de la supervisión no puede pasar el fin de la jornada'
);
select is(
  (select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Estaba mal cargada', app.local_ts(app.today() - 2, '13:10'), app.local_ts(app.today() - 2, '16:50'))->>'duration_minutes'),
  '220', 'OD-07: corrige inicio y fin (13:10 a 16:50 = 220 minutos informativos)'
);
set local role postgres;
select ok(
  (select ci.recorded_at = app.local_ts(app.today() - 2, '13:10') and co.recorded_at = app.local_ts(app.today() - 2, '16:50')
   from public.supervision_attendance ci
   join public.supervision_attendance co on co.supervision_id = ci.supervision_id and co.kind = 'check_out'
   where ci.supervision_id = 'f7900000-0000-0000-0000-000000000401' and ci.kind = 'check_in'),
  'los registros de la supervisión quedaron con las horas nuevas'
);
select ok(
  (select bool_and(e.corrected_at is not null and e.correction_reason = 'Estaba mal cargada')
     and bool_or(e.kind = 'supervision_start' and e.recorded_at = app.local_ts(app.today() - 2, '13:10') and e.corrected_from = app.local_ts(app.today() - 2, '13:00'))
     and bool_or(e.kind = 'supervision_end' and e.recorded_at = app.local_ts(app.today() - 2, '16:50') and e.corrected_from = app.local_ts(app.today() - 2, '17:00'))
   from public.supervisor_workday_events e
   where e.supervision_id = 'f7900000-0000-0000-0000-000000000401' and e.removed_at is null),
  'los eventos supervision_start y supervision_end llevan la hora nueva, la anterior y el motivo'
);
select ok(
  (select count(*) = 1 from public.security_events
   where event_type = 'workday_corrected' and details ->> 'action' = 'correct_supervision_time' and details ->> 'supervision_id' = 'f7900000-0000-0000-0000-000000000401'),
  'queda workday_corrected (correct_supervision_time) en security_events'
);

-- ---------------------------------------------------------------------------------------------
-- OD-05: la vista para la pantalla de jornadas
-- ---------------------------------------------------------------------------------------------

select tests_0079.as_user('test-db0079-admin@example.com');
select is(
  (select list_status from public.v_supervisor_workdays_admin where id = 'f7900000-0000-0000-0000-000000000303'),
  'auto_closed', 'v_supervisor_workdays_admin: la cerrada sola es auto_closed'
);
select is(
  (select count(*)::integer from public.v_supervisor_workdays_admin
   where supervisor_id in ('f7900000-0000-0000-0000-000000000091', 'f7900000-0000-0000-0000-000000000092', 'f7900000-0000-0000-0000-000000000093')
     and corrected),
  4, 'v_supervisor_workdays_admin: se filtra «corregida» con corrected (las dos de Ana y las dos de Beto, sin la cerrada sola de Cora)'
);
select is(
  (select supervisor_employee_number is not null from public.v_supervisor_workdays_admin where id = 'f7900000-0000-0000-0000-000000000303'),
  true, 'v_supervisor_workdays_admin: trae el legajo'
);
select tests_0079.as_user('test-db0079-sa@example.com');
select is(
  (select count(*)::integer from public.v_supervisor_workdays_admin),
  0, 'un coordinador no ve la vista de administración'
);
select tests_0079.as_user('test-db0079-x@example.com');
select is(
  tests_0079.err_hint($$select public.admin_correct_supervision_time('f7900000-0000-0000-0000-000000000401', 'Prueba', app.local_ts(app.today() - 2, '13:20'))$$),
  'FORBIDDEN', 'un empleado no corrige supervisiones'
);

select * from finish();

rollback;
