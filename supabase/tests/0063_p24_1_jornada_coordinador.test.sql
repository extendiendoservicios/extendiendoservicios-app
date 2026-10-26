-- pgTAP de la migración 0063_p24_1_jornada_coordinador.sql (P24.1, coordinación libre y jornada
-- del coordinador, 23 oct 2026), primera parte: la jornada.
--   1. Estructura, privilegios (anon, authenticated, coordenadas) y funciones revocadas.
--   2. RPC de jornada: cada transición y cada bloqueo (CJ-07, CJ-12, CJ-16, CJ-20, CJ-29, CJ-30),
--      la posición opcional y la licencia.
--   3. Minutos: inicio a fin menos pausas, con reapertura (CJ-13, CJ-30) y con pausa abierta.
--   4. Cierre automático (CJ-31): pausa abierta, supervisión abierta («Sin cerrar»), antes de las
--      23:55 no cierra, jornadas de días anteriores, advertencia y su desaparición al corregir.
--   5. Administración (CJ-32): corregir un evento, quitar y agregar pausas, registrar en nombre,
--      validaciones y permisos; prioridades (CJ-03, CJ-24).
--   6. RLS por rol (dueño, administrador, coordinador, empleado) y vistas.
-- La segunda parte (tomar, descartar y cerrar supervisiones) está en
-- 0063_p24_1_supervision_libre.test.sql.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6300000-...'. Los instantes de las fixtures se recortan al día de la jornada
-- con app.local_ts (nunca «ahora ± horas»): el CI puede correr cerca de la medianoche de Argentina.
-- Las jornadas con horarios fijos son de AYER (app.today() - 1), para que ninguna validación
-- «no futura» dependa de la hora del día en que corre el test.

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

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests.err_hint(p_sql text)
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

grant execute on function tests.err_hint(text) to authenticated, anon;

create or replace function tests.err_message(p_sql text)
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

grant execute on function tests.err_message(text) to authenticated, anon;

-- Cantidad de tareas de pg_cron con ese nombre (dinámico: en un entorno sin pg_cron la consulta
-- directa no compilaría).
create or replace function tests.cron_schedule(p_name text)
returns text
language plpgsql
as $$
declare
  v_schedule text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return null;
  end if;
  execute 'select schedule from cron.job where jobname = $1' into v_schedule using p_name;
  return v_schedule;
end;
$$;

create or replace function tests.cron_job_count(p_name text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return -1;
  end if;
  execute 'select count(*)::integer from cron.job where jobname = $1' into v_count using p_name;
  return v_count;
end;
$$;

select plan(177);

-- ---------------------------------------------------------------------------------------------
-- 1. Estructura y privilegios
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'supervisor_priorities', 'existe supervisor_priorities');
select has_table('public', 'supervisor_workdays', 'existe supervisor_workdays');
select has_table('public', 'supervisor_workday_events', 'existe supervisor_workday_events');
select has_column('public', 'supervisions', 'workday_id', 'supervisions.workday_id');
select enum_has_labels(
  'public', 'workday_event_kind',
  array['start', 'pause', 'resume', 'end', 'reopen', 'supervision_start', 'supervision_end'],
  'workday_event_kind'
);
select has_function('app', 'workday_minutes', array['uuid'], 'app.workday_minutes(uuid)');
select has_function('app', 'auto_close_workdays', array['timestamp with time zone'], 'app.auto_close_workdays(timestamptz)');
select has_function('public', 'start_workday', array['numeric', 'numeric', 'numeric'], 'start_workday');
select has_function('public', 'pause_workday', array['text', 'numeric', 'numeric', 'numeric'], 'pause_workday');
select has_function('public', 'resume_workday', array['numeric', 'numeric', 'numeric'], 'resume_workday');
select has_function('public', 'end_workday', array['numeric', 'numeric', 'numeric'], 'end_workday');
select has_function('public', 'reopen_workday', array['numeric', 'numeric', 'numeric'], 'reopen_workday');
select has_function('public', 'admin_correct_workday_event', array['uuid', 'text', 'timestamp with time zone', 'boolean'], 'admin_correct_workday_event');
select has_function('public', 'admin_add_workday_pause', array['uuid', 'timestamp with time zone', 'timestamp with time zone', 'text', 'text'], 'admin_add_workday_pause');
select has_function('public', 'admin_record_workday', array['uuid', 'date', 'timestamp with time zone', 'text', 'timestamp with time zone'], 'admin_record_workday');
select has_function('public', 'set_supervisor_priority', array['uuid', 'uuid', 'uuid'], 'set_supervisor_priority');
select has_function('public', 'remove_supervisor_priority', array['uuid'], 'remove_supervisor_priority');
select has_view('public', 'v_supervisor_status', 'existe v_supervisor_status');
select has_view('public', 'v_supervisor_workdays_admin', 'existe v_supervisor_workdays_admin');
select has_view('public', 'v_my_workdays', 'existe v_my_workdays');

select ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c
   where c.oid in (
     'public.supervisor_priorities'::regclass,
     'public.supervisor_workdays'::regclass,
     'public.supervisor_workday_events'::regclass
   )),
  'RLS habilitada en las tres tablas nuevas'
);

select ok(
  not has_table_privilege('anon', 'public.supervisor_workdays', 'select')
  and not has_table_privilege('anon', 'public.supervisor_priorities', 'select')
  and not has_column_privilege('anon', 'public.supervisor_workday_events', 'recorded_at', 'select')
  and not has_table_privilege('anon', 'public.v_supervisor_status', 'select'),
  'anon no lee tablas ni vistas nuevas'
);
select ok(
  not has_table_privilege('authenticated', 'public.supervisor_workdays', 'insert')
  and not has_table_privilege('authenticated', 'public.supervisor_workdays', 'update')
  and not has_table_privilege('authenticated', 'public.supervisor_workdays', 'delete')
  and not has_table_privilege('authenticated', 'public.supervisor_priorities', 'insert')
  and not has_table_privilege('authenticated', 'public.supervisor_priorities', 'update')
  and not has_table_privilege('authenticated', 'public.supervisor_workday_events', 'insert')
  and not has_table_privilege('authenticated', 'public.supervisor_workday_events', 'update')
  and not has_table_privilege('authenticated', 'public.supervisor_workday_events', 'delete'),
  'authenticated no escribe las tablas nuevas (solo las RPC)'
);
select ok(
  not has_column_privilege('authenticated', 'public.supervisor_workday_events', 'latitude', 'select')
  and not has_column_privilege('authenticated', 'public.supervisor_workday_events', 'longitude', 'select')
  and not has_column_privilege('authenticated', 'public.supervisor_workday_events', 'accuracy_m', 'select')
  and has_column_privilege('authenticated', 'public.supervisor_workday_events', 'recorded_at', 'select')
  and has_column_privilege('authenticated', 'public.supervisor_workday_events', 'has_position', 'select'),
  'las coordenadas de los eventos no tienen select directo (criterio de 0054); el resto sí'
);
select ok(
  not has_function_privilege('anon', 'public.start_workday(numeric, numeric, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.start_workday(numeric, numeric, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.take_supervision(uuid, numeric, numeric, numeric, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_record_workday(uuid, date, timestamptz, text, timestamptz)', 'execute'),
  'grants de las RPC nuevas: anon no, authenticated sí'
);
select ok(
  not has_function_privilege('authenticated', 'public.assign_supervision(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_supervision_not_done(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.supervision_check_in(uuid, numeric, numeric, numeric, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.supervision_check_out(uuid, numeric, numeric, numeric, text)', 'execute')
  and not has_function_privilege('anon', 'public.assign_supervision(uuid, uuid)', 'execute'),
  'assign_supervision, mark_supervision_not_done, supervision_check_in y supervision_check_out ya no se pueden ejecutar'
);
select ok(
  not has_function_privilege('authenticated', 'app.auto_close_workdays(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.auto_close_workdays(timestamptz)', 'execute'),
  'app.auto_close_workdays no la ejecuta ni authenticated ni anon'
);
select cmp_ok(
  tests.cron_job_count('auto-close-workdays'), '<>', 0,
  'pg_cron: la tarea auto-close-workdays existe (o pg_cron no está habilitada en este entorno, -1)'
);
select ok(
  coalesce(tests.cron_schedule('auto-close-workdays') = '55 2 * * *', true),
  'pg_cron: se programa a las 02:55 UTC = 23:55 de Argentina'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f6300000-0000-0000-0000-000000000001', 'Cliente de jornadas uno', 'active'),
  ('f6300000-0000-0000-0000-000000000002', 'Cliente de jornadas dos', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f6300000-0000-0000-0000-000000000011', 'f6300000-0000-0000-0000-000000000001', 'Sede uno', 'Dirección 1', -34.6, -58.4, 'active'),
  ('f6300000-0000-0000-0000-000000000012', 'f6300000-0000-0000-0000-000000000002', 'Sede dos', 'Dirección 2', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6300000-0000-0000-0000-000000000081', 'test-db063-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Jornadas')),
  ('f6300000-0000-0000-0000-000000000082', 'test-db063-admin-full@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Completo')),
  ('f6300000-0000-0000-0000-000000000083', 'test-db063-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f6300000-0000-0000-0000-000000000091', 'test-db063-sa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Coordinadora')),
  ('f6300000-0000-0000-0000-000000000092', 'test-db063-sb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Coordinador')),
  ('f6300000-0000-0000-0000-000000000093', 'test-db063-sl@example.com', jsonb_build_object('first_name', 'Lila', 'last_name', 'Licencia')),
  ('f6300000-0000-0000-0000-000000000094', 'test-db063-sd@example.com', jsonb_build_object('first_name', 'Dario', 'last_name', 'Dadodebaja')),
  ('f6300000-0000-0000-0000-000000000095', 'test-db063-sc@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'PausaAbierta')),
  ('f6300000-0000-0000-0000-000000000096', 'test-db063-se@example.com', jsonb_build_object('first_name', 'Elena', 'last_name', 'DeHoy')),
  ('f6300000-0000-0000-0000-000000000097', 'test-db063-sf@example.com', jsonb_build_object('first_name', 'Fede', 'last_name', 'ConSupervision')),
  ('f6300000-0000-0000-0000-0000000000a1', 'test-db063-emp@example.com', jsonb_build_object('first_name', 'Emi', 'last_name', 'Empleado'));

insert into public.user_roles (profile_id, role) values
  ('f6300000-0000-0000-0000-000000000081', 'owner'),
  ('f6300000-0000-0000-0000-000000000082', 'admin'),
  ('f6300000-0000-0000-0000-000000000083', 'admin'),
  ('f6300000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000092', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000093', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000094', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000095', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000096', 'supervisor'),
  ('f6300000-0000-0000-0000-000000000097', 'supervisor'),
  ('f6300000-0000-0000-0000-0000000000a1', 'employee');

-- admin-full: manage_attendance + manage_supervisions. admin-sin: ninguna (FORBIDDEN).
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f6300000-0000-0000-0000-000000000082', 'manage_attendance', true),
  ('f6300000-0000-0000-0000-000000000082', 'manage_supervisions', true);

insert into public.employees (profile_id, dni, status) values
  ('f6300000-0000-0000-0000-000000000091', '96300091', 'active'),
  ('f6300000-0000-0000-0000-000000000092', '96300092', 'active'),
  ('f6300000-0000-0000-0000-000000000093', '96300093', 'active'),
  ('f6300000-0000-0000-0000-000000000094', '96300094', 'terminated'),
  ('f6300000-0000-0000-0000-000000000095', '96300095', 'active'),
  ('f6300000-0000-0000-0000-000000000096', '96300096', 'active'),
  ('f6300000-0000-0000-0000-000000000097', '96300097', 'active'),
  ('f6300000-0000-0000-0000-0000000000a1', '96300101', 'active');

-- Lila está de licencia hoy (de ayer a mañana).
insert into public.employee_leaves (employee_id, starts_on, ends_on) values
  ('f6300000-0000-0000-0000-000000000093', app.today() - 1, app.today() + 1);

-- Turno de ayer para la supervisión que queda abierta en el cierre automático.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6300000-0000-0000-0000-000000000041', 'f6300000-0000-0000-0000-000000000001', 'f6300000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '12:00', 1, 'in_progress');

-- ---------------------------------------------------------------------------------------------
-- 2. RPC de jornada: transiciones y bloqueos (coordinadora Ana)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db063-sa@example.com');

select is(tests.err_hint($$select public.pause_workday()$$), 'WORKDAY_NOT_STARTED', 'pausar sin jornada iniciada -> WORKDAY_NOT_STARTED');
select is(tests.err_hint($$select public.resume_workday()$$), 'WORKDAY_NOT_STARTED', 'reanudar sin jornada -> WORKDAY_NOT_STARTED');
select is(tests.err_hint($$select public.end_workday()$$), 'WORKDAY_NOT_STARTED', 'finalizar sin jornada -> WORKDAY_NOT_STARTED');
select is(tests.err_hint($$select public.reopen_workday()$$), 'WORKDAY_NOT_STARTED', 'reabrir sin jornada -> WORKDAY_NOT_STARTED');
select is(tests.err_hint($$select public.start_workday(-34.6, null, null)$$), 'COORDINATES_INCOMPLETE', 'iniciar con posición incompleta -> COORDINATES_INCOMPLETE');
select is(tests.err_hint($$select public.start_workday(-134.6, -58.4, 10)$$), 'COORDINATES_OUT_OF_RANGE', 'iniciar con latitud fuera de rango -> COORDINATES_OUT_OF_RANGE');

select is(
  (select public.start_workday(-34.6, -58.4, 12)->>'state'),
  'running',
  'start_workday: la jornada queda en marcha'
);
select is(tests.err_hint($$select public.start_workday()$$), 'WORKDAY_ALREADY_STARTED', 'una jornada por día: segundo inicio -> WORKDAY_ALREADY_STARTED');
select is(tests.err_hint($$select public.resume_workday()$$), 'WORKDAY_NOT_PAUSED', 'reanudar sin pausa -> WORKDAY_NOT_PAUSED');
select is(tests.err_hint($$select public.reopen_workday()$$), 'WORKDAY_NOT_ENDED', 'reabrir una jornada en marcha -> WORKDAY_NOT_ENDED');
select is(tests.err_hint($$select public.pause_workday(repeat('x', 301))$$), 'REASON_TOO_LONG', 'pausar con un motivo de más de 300 caracteres -> REASON_TOO_LONG');

select is(
  (select public.pause_workday('Almuerzo')->>'state'),
  'paused',
  'pause_workday: la jornada queda en pausa'
);
select is(tests.err_hint($$select public.pause_workday()$$), 'WORKDAY_PAUSED', 'pausar dos veces -> WORKDAY_PAUSED');
select is(
  (select public.resume_workday()->>'state'),
  'running',
  'resume_workday: vuelve a estar en marcha'
);
select is(
  (select public.pause_workday()->>'state'),
  'paused',
  'el motivo de la pausa es opcional (CJ-16)'
);
select is(
  (select public.end_workday()->>'state'),
  'ended',
  'end_workday: se puede finalizar estando en pausa'
);
select is(tests.err_hint($$select public.end_workday()$$), 'WORKDAY_ENDED', 'finalizar dos veces -> WORKDAY_ENDED');
select is(tests.err_hint($$select public.pause_workday()$$), 'WORKDAY_ENDED', 'pausar una jornada finalizada -> WORKDAY_ENDED');
select is(tests.err_hint($$select public.resume_workday()$$), 'WORKDAY_ENDED', 'reanudar una jornada finalizada -> WORKDAY_ENDED');
select is(
  (select public.reopen_workday()->>'state'),
  'running',
  'reopen_workday: la jornada finalizada se reabre (CJ-30)'
);

set local role postgres;

select is(
  (select array_agg(e.kind::text order by e.seq)
   from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today()),
  array['start', 'pause', 'resume', 'pause', 'end', 'reopen'],
  'la secuencia de eventos de Ana: start, pause, resume, pause, end, reopen'
);
select is(
  (select e.reason from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today() and e.kind = 'reopen'),
  'Jornada reabierta',
  'el evento de reapertura lleva el motivo «Jornada reabierta»'
);
select is(
  (select e.reason from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today()
   and e.kind = 'pause' order by e.seq limit 1),
  'Almuerzo',
  'el motivo de la pausa se guarda'
);
select ok(
  (select e.has_position and e.latitude = -34.6 and e.longitude = -58.4 and e.accuracy_m = 12
   from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today() and e.kind = 'start')
  and (select not e.has_position and e.latitude is null
   from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today() and e.kind = 'end'),
  'el inicio guarda la posición; el fin, sin posición, queda «sin ubicación» (CJ-20, CJ-33)'
);
select is(
  (select ended_at from public.supervisor_workdays
   where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and work_date = app.today()),
  null,
  'reabrir deja ended_at en nulo'
);

-- Licencia, perfil sin ficha activa y roles que no son coordinador ------------------------------

select tests.as_user('test-db063-sl@example.com');
select is(tests.err_hint($$select public.start_workday()$$), 'ON_LEAVE', 'coordinadora de licencia hoy -> ON_LEAVE (CJ-29)');
select is(
  tests.err_message($$select public.start_workday()$$),
  'Estás de licencia hoy: no podés iniciar la jornada.',
  'mensaje de la licencia'
);

select tests.as_user('test-db063-sd@example.com');
select is(tests.err_hint($$select public.start_workday()$$), 'SUPERVISOR_ROLE_REQUIRED', 'coordinador con la ficha de empleado dada de baja -> SUPERVISOR_ROLE_REQUIRED');

select tests.as_user('test-db063-emp@example.com');
select is(tests.err_hint($$select public.start_workday()$$), 'FORBIDDEN', 'empleado no inicia jornada -> FORBIDDEN');

select tests.as_user('test-db063-admin-full@example.com');
select is(tests.err_hint($$select public.start_workday()$$), 'FORBIDDEN', 'administrador sin rol de coordinador no inicia jornada -> FORBIDDEN');

-- ---------------------------------------------------------------------------------------------
-- 3. Minutos: inicio a fin menos pausas, con reapertura (jornada de ayer de Beto)
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at) values
  ('f6300000-0000-0000-0000-0000000000b1', 'f6300000-0000-0000-0000-000000000092', app.today() - 1,
   app.local_ts(app.today() - 1, '08:00'), app.local_ts(app.today() - 1, '12:00'));

insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, reason) values
  ('f6300000-0000-0000-0000-0000000000e1', 'f6300000-0000-0000-0000-0000000000b1', 'start', app.local_ts(app.today() - 1, '08:00'), null),
  ('f6300000-0000-0000-0000-0000000000e2', 'f6300000-0000-0000-0000-0000000000b1', 'pause', app.local_ts(app.today() - 1, '10:00'), 'Almuerzo'),
  ('f6300000-0000-0000-0000-0000000000e3', 'f6300000-0000-0000-0000-0000000000b1', 'resume', app.local_ts(app.today() - 1, '10:30'), null),
  ('f6300000-0000-0000-0000-0000000000e4', 'f6300000-0000-0000-0000-0000000000b1', 'end', app.local_ts(app.today() - 1, '12:00'), null);

select is(app.workday_minutes('f6300000-0000-0000-0000-0000000000b1'), 210, 'minutos: 08:00 a 12:00 menos una pausa de 30 = 210');
select is(app.workday_state('f6300000-0000-0000-0000-0000000000b1'), 'ended', 'estado de la jornada cerrada: ended');

-- Reapertura a las 14:00 y nuevo fin a las 16:00: el tramo 12:00-14:00 cuenta como pausa.
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, reason) values
  ('f6300000-0000-0000-0000-0000000000e5', 'f6300000-0000-0000-0000-0000000000b1', 'reopen', app.local_ts(app.today() - 1, '14:00'), 'Jornada reabierta'),
  ('f6300000-0000-0000-0000-0000000000e6', 'f6300000-0000-0000-0000-0000000000b1', 'end', app.local_ts(app.today() - 1, '16:00'), null);
update public.supervisor_workdays set ended_at = app.local_ts(app.today() - 1, '16:00')
where id = 'f6300000-0000-0000-0000-0000000000b1';

select is(app.workday_minutes('f6300000-0000-0000-0000-0000000000b1'), 330, 'minutos con reapertura: 210 + 120 = 330 (el hueco 12:00-14:00 es pausa)');
select is(jsonb_array_length(app.workday_pauses('f6300000-0000-0000-0000-0000000000b1')), 2, 'pausas: la pausa y el hueco de la reapertura');
select is(
  (app.workday_pauses('f6300000-0000-0000-0000-0000000000b1') -> 1 ->> 'reason'),
  'Jornada reabierta',
  'el hueco entre el fin y la reapertura lleva el motivo «Jornada reabierta»'
);
select is(
  (app.workday_pauses('f6300000-0000-0000-0000-0000000000b1') -> 1 ->> 'minutes')::integer,
  120,
  'el hueco de la reapertura dura 120 minutos'
);

-- Pausa abierta al final de una jornada ya cerrada: la pausa termina en el fin.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at, ended_at) values
  ('f6300000-0000-0000-0000-0000000000b2', 'f6300000-0000-0000-0000-000000000095', app.today() - 1,
   app.local_ts(app.today() - 1, '09:00'), app.local_ts(app.today() - 1, '13:00'));
insert into public.supervisor_workday_events (workday_id, kind, recorded_at, reason) values
  ('f6300000-0000-0000-0000-0000000000b2', 'start', app.local_ts(app.today() - 1, '09:00'), null),
  ('f6300000-0000-0000-0000-0000000000b2', 'pause', app.local_ts(app.today() - 1, '12:00'), null),
  ('f6300000-0000-0000-0000-0000000000b2', 'end', app.local_ts(app.today() - 1, '13:00'), null);
select is(app.workday_minutes('f6300000-0000-0000-0000-0000000000b2'), 180, 'minutos: una pausa cerrada por el fin no suma (09:00 a 12:00 = 180)');
select is(
  (select (p ->> 'resume_event_id') is null from jsonb_array_elements(app.workday_pauses('f6300000-0000-0000-0000-0000000000b2')) p limit 1),
  true,
  'una pausa cerrada por el fin no tiene evento de reanudación'
);

-- Un evento dado de baja no cuenta.
update public.supervisor_workday_events
set removed_at = now(), removed_by = 'f6300000-0000-0000-0000-000000000082'
where workday_id = 'f6300000-0000-0000-0000-0000000000b2' and kind = 'pause';
select is(app.workday_minutes('f6300000-0000-0000-0000-0000000000b2'), 240, 'minutos: con la pausa dada de baja, 09:00 a 13:00 = 240');
update public.supervisor_workday_events set removed_at = null, removed_by = null
where workday_id = 'f6300000-0000-0000-0000-0000000000b2' and kind = 'pause';

-- La jornada abierta de Ana cuenta hasta ahora (nunca negativa).
select cmp_ok(
  app.workday_minutes((select id from public.supervisor_workdays
                       where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and work_date = app.today())),
  '>=', 0,
  'minutos de una jornada abierta: cuenta hasta ahora y no es negativo'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Cierre automático (CJ-31)
-- ---------------------------------------------------------------------------------------------

-- Carla (pausa abierta, ayer): ya tiene la jornada b2 cerrada a mano; para el cierre automático
-- usamos jornadas abiertas de otras personas.
--   Beto  hoy: abierta, sin eventos extra (se cierra con p_now de las 23:56).
--   Elena ayer: abierta con una pausa abierta.
--   Fede  ayer: abierta con una supervisión abierta.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at) values
  ('f6300000-0000-0000-0000-0000000000b3', 'f6300000-0000-0000-0000-000000000096', app.today() - 1, app.local_ts(app.today() - 1, '09:00')),
  ('f6300000-0000-0000-0000-0000000000b4', 'f6300000-0000-0000-0000-000000000097', app.today() - 1, app.local_ts(app.today() - 1, '08:30')),
  ('f6300000-0000-0000-0000-0000000000b5', 'f6300000-0000-0000-0000-000000000092', app.today(), app.local_ts(app.today(), '00:00') + interval '1 second');
insert into public.supervisor_workday_events (workday_id, kind, recorded_at, reason) values
  ('f6300000-0000-0000-0000-0000000000b3', 'start', app.local_ts(app.today() - 1, '09:00'), null),
  ('f6300000-0000-0000-0000-0000000000b3', 'pause', app.local_ts(app.today() - 1, '12:00'), 'Pausa larga'),
  ('f6300000-0000-0000-0000-0000000000b4', 'start', app.local_ts(app.today() - 1, '08:30'), null),
  ('f6300000-0000-0000-0000-0000000000b5', 'start', app.local_ts(app.today(), '00:00') + interval '1 second', null);

insert into public.supervisions (id, shift_id, supervisor_id, status, workday_id) values
  ('f6300000-0000-0000-0000-0000000000c1', 'f6300000-0000-0000-0000-000000000041', 'f6300000-0000-0000-0000-000000000097', 'in_progress', 'f6300000-0000-0000-0000-0000000000b4');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('f6300000-0000-0000-0000-0000000000c1', 'check_in', app.local_ts(app.today() - 1, '09:00'));
insert into public.supervisor_workday_events (workday_id, kind, recorded_at, supervision_id) values
  ('f6300000-0000-0000-0000-0000000000b4', 'supervision_start', app.local_ts(app.today() - 1, '09:00'), 'f6300000-0000-0000-0000-0000000000c1');

-- Antes de las 23:55 de hoy no cierra la jornada de hoy.
select ok(
  app.auto_close_workdays(app.local_ts(app.today(), '23:54')) >= 2,
  'auto_close_workdays a las 23:54: cierra las de días anteriores (al menos Elena y Fede)'
);
select is(
  (select ended_at from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b5'),
  null,
  'a las 23:54 no se cierra la jornada de hoy'
);
select is(
  (select ended_at from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b3'),
  app.local_ts(app.today() - 1, '23:55'),
  'la jornada de ayer se cierra a las 23:55 de ayer (nunca pasa la medianoche)'
);
select ok(
  (select auto_closed and not corrected from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b3'),
  'la jornada cerrada sola queda marcada auto_closed'
);
select is(
  (select e.reason from public.supervisor_workday_events e
   where e.workday_id = 'f6300000-0000-0000-0000-0000000000b3' and e.kind = 'end'),
  'Cierre automático',
  'el evento de fin lleva el motivo «Cierre automático»'
);
select is(
  app.workday_minutes('f6300000-0000-0000-0000-0000000000b3'),
  180,
  'minutos de la jornada cerrada sola con la pausa abierta: 09:00 a 12:00 = 180 (la pausa termina en el fin)'
);
select is(
  (select status::text from public.supervisions where id = 'f6300000-0000-0000-0000-0000000000c1'),
  'in_progress',
  'la supervisión abierta queda in_progress (Sin cerrar)'
);
select is(
  (select recorded_at from public.supervision_attendance
   where supervision_id = 'f6300000-0000-0000-0000-0000000000c1' and kind = 'check_out'),
  app.local_ts(app.today() - 1, '23:55'),
  'se registra el fin de la supervisión abierta a las 23:55'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where workday_id = 'f6300000-0000-0000-0000-0000000000b4' and kind = 'supervision_end'),
  1,
  'queda el evento supervision_end del cierre'
);
select is(
  (select count(*)::integer from public.security_events
   where event_type = 'workday_auto_closed' and target_id = 'f6300000-0000-0000-0000-000000000097'
     and details ->> 'workday_id' = 'f6300000-0000-0000-0000-0000000000b4'
     and details -> 'unclosed_supervisions' @> '"f6300000-0000-0000-0000-0000000000c1"'::jsonb),
  1,
  'el cierre automático deja un aviso en security_events con la supervisión sin cerrar'
);
select is(
  app.auto_close_workdays(app.local_ts(app.today(), '23:54')),
  0,
  'una segunda corrida a las 23:54 no cierra nada más (idempotente)'
);
-- La jornada cerrada a mano (Beto, ayer; Carla, ayer) no se toca.
select is(
  (select auto_closed from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b1'),
  false,
  'una jornada finalizada por el coordinador no se marca como cerrada automáticamente'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Administración (CJ-32): permisos
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db063-admin-sin@example.com');
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Prueba', app.local_ts(app.today() - 1, '10:15'))$$),
  'FORBIDDEN', 'administrador sin manage_attendance no corrige eventos'
);
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '15:00'), app.local_ts(app.today() - 1, '15:15'), 'Prueba')$$),
  'FORBIDDEN', 'administrador sin manage_attendance no agrega pausas'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), 'Prueba', app.local_ts(app.today() - 2, '12:00'))$$),
  'FORBIDDEN', 'administrador sin manage_attendance no registra jornadas'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-000000000001', null)$$),
  'FORBIDDEN', 'administrador sin manage_supervisions no carga prioridades'
);

select tests.as_user('test-db063-sa@example.com');
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Prueba', app.local_ts(app.today() - 1, '10:15'))$$),
  'FORBIDDEN', 'el coordinador no corrige eventos de jornada'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-000000000001', null)$$),
  'FORBIDDEN', 'el coordinador no se carga prioridades'
);

select tests.as_user('test-db063-emp@example.com');
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), 'Prueba', app.local_ts(app.today() - 2, '12:00'))$$),
  'FORBIDDEN', 'el empleado no registra jornadas'
);

-- Correcciones --------------------------------------------------------------------------------

select tests.as_user('test-db063-admin-full@example.com');

select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', '  ', app.local_ts(app.today() - 1, '10:15'))$$),
  'REASON_REQUIRED', 'corregir sin motivo -> REASON_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Prueba')$$),
  'TIME_REQUIRED', 'corregir sin hora nueva -> TIME_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000ff', 'Prueba', app.local_ts(app.today() - 1, '10:15'))$$),
  'EVENT_NOT_FOUND', 'evento inexistente -> EVENT_NOT_FOUND'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Prueba', app.local_ts(app.today(), '00:00') + interval '1 second')$$),
  'AT_OUT_OF_RANGE', 'una hora fuera del día de la jornada -> AT_OUT_OF_RANGE'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Prueba', app.local_ts(app.today() - 1, '10:00'))$$),
  'SAME_TIME', 'la misma hora -> SAME_TIME'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e3', 'Prueba', app.local_ts(app.today() - 1, '09:00'))$$),
  'INVALID_EVENT_ORDER', 'reanudar antes de la pausa deja la secuencia inválida -> INVALID_EVENT_ORDER'
);
select is(
  tests.err_hint($$select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e1', 'Prueba', null, true)$$),
  'EVENT_NOT_REMOVABLE', 'solo se quitan pausas -> EVENT_NOT_REMOVABLE'
);
select is(
  (select recorded_at from public.supervisor_workday_events where id = 'f6300000-0000-0000-0000-0000000000e3'),
  app.local_ts(app.today() - 1, '10:30'),
  'una corrección rechazada no cambia nada'
);

-- Una supervisión suelta: el evento supervision_start no se corrige.
select is(
  tests.err_hint(format(
    $$select public.admin_correct_workday_event(%L, 'Prueba', app.local_ts(app.today() - 1, '09:10'))$$,
    (select id from public.supervisor_workday_events where workday_id = 'f6300000-0000-0000-0000-0000000000b4' and kind = 'supervision_start')
  )),
  'EVENT_NOT_CORRECTABLE', 'los eventos de una supervisión no se corrigen desde la jornada'
);

-- Corrige la pausa de Beto: 10:00 -> 10:15. Neto: 480 - 15 - 120 = 345.
select is(
  (select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Se pausó más tarde', app.local_ts(app.today() - 1, '10:15'))->>'minutes')::integer,
  345,
  'admin_correct_workday_event: la pausa corregida cambia los minutos (345)'
);
select ok(
  (select w.corrected from public.supervisor_workdays w where w.id = 'f6300000-0000-0000-0000-0000000000b1')
  and (select e.corrected_from = app.local_ts(app.today() - 1, '10:00') and e.correction_reason = 'Se pausó más tarde' and e.corrected_by = 'f6300000-0000-0000-0000-000000000082'
       from public.supervisor_workday_events e where e.id = 'f6300000-0000-0000-0000-0000000000e2'),
  'la corrección deja la jornada corrected y la traza en el evento (hora anterior, motivo, quién)'
);
set local role postgres;
select is(
  (select count(*)::integer from public.security_events
   where event_type = 'workday_corrected' and target_id = 'f6300000-0000-0000-0000-000000000092'
     and details ->> 'event_id' = 'f6300000-0000-0000-0000-0000000000e2'),
  1,
  'la corrección queda en security_events'
);
select tests.as_user('test-db063-admin-full@example.com');

-- Quita la pausa (con su reanudación): 480 - 120 = 360.
select is(
  (select public.admin_correct_workday_event('f6300000-0000-0000-0000-0000000000e2', 'Fue un error', null, true)->>'minutes')::integer,
  360,
  'quitar la pausa suma sus minutos (360)'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where workday_id = 'f6300000-0000-0000-0000-0000000000b1' and removed_at is not null),
  2,
  'la baja de la pausa también da de baja su reanudación (nada se borra)'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events where workday_id = 'f6300000-0000-0000-0000-0000000000b1'),
  6,
  'los eventos dados de baja siguen en la tabla (P-014)'
);

-- Agrega una pausa: 11:00 a 11:30 -> 330.
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '11:30'), app.local_ts(app.today() - 1, '11:00'), 'Prueba')$$),
  'INVALID_TIME_RANGE', 'una pausa que termina antes de empezar -> INVALID_TIME_RANGE'
);
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '11:00'), app.local_ts(app.today() - 1, '11:30'), '')$$),
  'REASON_REQUIRED', 'una pausa sin motivo de corrección -> REASON_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '07:00'), app.local_ts(app.today() - 1, '07:30'), 'Prueba')$$),
  'INVALID_EVENT_ORDER', 'una pausa antes del inicio de la jornada -> INVALID_EVENT_ORDER'
);
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '12:30'), app.local_ts(app.today() - 1, '13:00'), 'Prueba')$$),
  'INVALID_EVENT_ORDER', 'una pausa dentro del hueco de la reapertura -> INVALID_EVENT_ORDER'
);
select is(
  tests.err_hint($$select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000ff', app.local_ts(app.today() - 1, '11:00'), app.local_ts(app.today() - 1, '11:30'), 'Prueba')$$),
  'WORKDAY_NOT_FOUND', 'jornada inexistente -> WORKDAY_NOT_FOUND'
);
select is(
  (select public.admin_add_workday_pause('f6300000-0000-0000-0000-0000000000b1', app.local_ts(app.today() - 1, '11:00'), app.local_ts(app.today() - 1, '11:30'), 'Se olvidó de pausar', 'Trámite')->>'minutes')::integer,
  330,
  'admin_add_workday_pause: 360 - 30 = 330'
);
select is(
  (select (p ->> 'reason') from jsonb_array_elements(app.workday_pauses('f6300000-0000-0000-0000-0000000000b1')) p
   where p ->> 'type' = 'pause'),
  'Trámite',
  'la pausa agregada lleva su propio motivo'
);

-- Registrar en nombre -------------------------------------------------------------------------

select is(
  (select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), 'Se olvidó de iniciarla', app.local_ts(app.today() - 2, '12:00'))->>'minutes')::integer,
  240,
  'admin_record_workday: registra 08:00 a 12:00 = 240'
);
select ok(
  (select w.corrected and not w.auto_closed from public.supervisor_workdays w
   where w.supervisor_id = 'f6300000-0000-0000-0000-000000000091' and w.work_date = app.today() - 2),
  'la jornada registrada en nombre queda corrected'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 2, app.local_ts(app.today() - 2, '08:00'), 'Otra vez', app.local_ts(app.today() - 2, '12:00'))$$),
  'WORKDAY_ALREADY_EXISTS', 'una jornada por día -> WORKDAY_ALREADY_EXISTS'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() + 1, app.local_ts(app.today(), '00:00'), 'Prueba', null)$$),
  'DATE_IN_FUTURE', 'una jornada de mañana -> DATE_IN_FUTURE'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 3, app.local_ts(app.today() - 3, '08:00'), 'Prueba', null)$$),
  'ENDED_AT_REQUIRED', 'una jornada de un día anterior sin fin -> ENDED_AT_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 3, app.local_ts(app.today() - 3, '12:00'), 'Prueba', app.local_ts(app.today() - 3, '08:00'))$$),
  'INVALID_TIME_RANGE', 'un fin anterior al inicio -> INVALID_TIME_RANGE'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 3, app.local_ts(app.today() - 3, '08:00'), '', app.local_ts(app.today() - 3, '12:00'))$$),
  'REASON_REQUIRED', 'sin motivo -> REASON_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-0000000000a1', app.today() - 3, app.local_ts(app.today() - 3, '08:00'), 'Prueba', app.local_ts(app.today() - 3, '12:00'))$$),
  'SUPERVISOR_ROLE_REQUIRED', 'una persona que no es coordinadora -> SUPERVISOR_ROLE_REQUIRED'
);
select is(
  tests.err_hint($$select public.admin_record_workday('f6300000-0000-0000-0000-000000000091', app.today() - 3, app.local_ts(app.today() - 3, '08:00'), 'Prueba', app.local_ts(app.today() - 2, '12:00'))$$),
  'AT_OUT_OF_RANGE', 'un fin en otro día -> AT_OUT_OF_RANGE'
);

-- La advertencia del cierre automático se quita al corregir (la constancia queda) ----------------

select is(
  (select auto_close_warning from public.v_supervisor_workdays_admin where id = 'f6300000-0000-0000-0000-0000000000b3'),
  true,
  'v_supervisor_workdays_admin: la jornada cerrada sola trae la advertencia'
);
select is(
  (select public.admin_correct_workday_event(
     (select id from public.supervisor_workday_events where workday_id = 'f6300000-0000-0000-0000-0000000000b3' and kind = 'end'),
     'Terminó a las 18', app.local_ts(app.today() - 1, '18:00'))->>'minutes')::integer,
  180,
  'corregir el fin de la jornada cerrada sola (pausa abierta desde las 12:00): los minutos siguen en 180'
);
select ok(
  (select not auto_close_warning and auto_closed and corrected
   from public.v_supervisor_workdays_admin where id = 'f6300000-0000-0000-0000-0000000000b3'),
  'una corrección quita la advertencia pero deja la constancia (auto_closed y corrected)'
);
select is(
  (select ended_at from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b3'),
  app.local_ts(app.today() - 1, '18:00'),
  'corregir el evento de fin actualiza ended_at'
);

-- Prioridades (CJ-03, CJ-24) --------------------------------------------------------------------

select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', null, null)$$),
  'INVALID_PRIORITY_TARGET', 'una prioridad sin cliente ni sede -> INVALID_PRIORITY_TARGET'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-000000000001', 'f6300000-0000-0000-0000-000000000011')$$),
  'INVALID_PRIORITY_TARGET', 'una prioridad con cliente y sede a la vez -> INVALID_PRIORITY_TARGET'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-0000000000a1', 'f6300000-0000-0000-0000-000000000001', null)$$),
  'SUPERVISOR_ROLE_REQUIRED', 'una prioridad para quien no es coordinador -> SUPERVISOR_ROLE_REQUIRED'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-0000000000ff', null)$$),
  'CLIENT_NOT_FOUND', 'cliente inexistente -> CLIENT_NOT_FOUND'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', null, 'f6300000-0000-0000-0000-0000000000ff')$$),
  'SITE_NOT_FOUND', 'sede inexistente -> SITE_NOT_FOUND'
);
select is(
  (select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-000000000001', null)).client_id,
  'f6300000-0000-0000-0000-000000000001'::uuid,
  'set_supervisor_priority: prioridad por cliente'
);
select is(
  tests.err_hint($$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', 'f6300000-0000-0000-0000-000000000001', null)$$),
  'PRIORITY_ALREADY_EXISTS', 'la misma prioridad vigente dos veces -> PRIORITY_ALREADY_EXISTS'
);
select is(
  (select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', null, 'f6300000-0000-0000-0000-000000000012')).site_id,
  'f6300000-0000-0000-0000-000000000012'::uuid,
  'set_supervisor_priority: prioridad por sede'
);
select lives_ok(
  $$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000092', 'f6300000-0000-0000-0000-000000000001', null)$$,
  'una sede o cliente puede tener varios coordinadores preferenciales (CJ-24)'
);
select is(
  (select (public.remove_supervisor_priority(
     (select id from public.supervisor_priorities
      where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and site_id = 'f6300000-0000-0000-0000-000000000012'
        and removed_at is null))).removed_by),
  'f6300000-0000-0000-0000-000000000082'::uuid,
  'remove_supervisor_priority: marca removed_by (sin borrado físico)'
);
select is(
  tests.err_hint($$select public.remove_supervisor_priority((select id from public.supervisor_priorities where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and site_id = 'f6300000-0000-0000-0000-000000000012'))$$),
  'PRIORITY_ALREADY_REMOVED', 'dar de baja dos veces -> PRIORITY_ALREADY_REMOVED'
);
select is(
  tests.err_hint($$select public.remove_supervisor_priority('f6300000-0000-0000-0000-0000000000ff')$$),
  'PRIORITY_NOT_FOUND', 'prioridad inexistente -> PRIORITY_NOT_FOUND'
);
select lives_ok(
  $$select public.set_supervisor_priority('f6300000-0000-0000-0000-000000000091', null, 'f6300000-0000-0000-0000-000000000012')$$,
  'tras la baja se puede volver a cargar la misma prioridad (unicidad solo entre las vigentes)'
);

-- ---------------------------------------------------------------------------------------------
-- 6. RLS por rol y vistas
-- ---------------------------------------------------------------------------------------------

-- Dueño y administrador ven todo.
select tests.as_user('test-db063-owner@example.com');
select cmp_ok(
  (select count(*)::integer from public.supervisor_workdays where supervisor_id::text like 'f6300000-%'), '>=', 6,
  'el dueño ve las jornadas de todos'
);
select cmp_ok(
  (select count(*)::integer from public.supervisor_priorities where supervisor_id::text like 'f6300000-%'), '>=', 3,
  'el dueño ve las prioridades de todos'
);

select tests.as_user('test-db063-admin-sin@example.com');
select cmp_ok(
  (select count(*)::integer from public.supervisor_workdays where supervisor_id::text like 'f6300000-%'), '>=', 6,
  'un administrador (sin capacidades) ve las jornadas de todos'
);
select cmp_ok(
  (select count(*)::integer from public.supervisor_workday_events where workday_id::text like 'f6300000-%'), '>', 0,
  'un administrador ve los eventos'
);
select throws_ok(
  $$select latitude from public.supervisor_workday_events$$,
  '42501',
  null,
  'ni el administrador lee las coordenadas con select directo (permission denied)'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events e
   where e.workday_id = (select id from public.supervisor_workdays
                         where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and work_date = app.today())
     and (select o_latitude from app.workday_event_position(e.id)) is not null),
  1,
  'la posición del evento de inicio de Ana se lee por app.workday_event_position (administración)'
);

-- Un coordinador ve solo lo suyo.
select tests.as_user('test-db063-sa@example.com');
select is(
  (select count(*)::integer from public.supervisor_workdays where supervisor_id <> 'f6300000-0000-0000-0000-000000000091'),
  0,
  'el coordinador no ve las jornadas de otros'
);
select cmp_ok(
  (select count(*)::integer from public.supervisor_workdays where supervisor_id = 'f6300000-0000-0000-0000-000000000091'), '>=', 2,
  'el coordinador ve sus jornadas (la de hoy y la que registró la administración)'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where workday_id in (select id from public.supervisor_workdays where supervisor_id <> 'f6300000-0000-0000-0000-000000000091')),
  0,
  'el coordinador no ve los eventos de otros'
);
select cmp_ok(
  (select count(*)::integer from public.supervisor_workday_events), '>', 0,
  'el coordinador ve sus propios eventos'
);
select throws_ok(
  $$select latitude from public.supervisor_workday_events$$,
  '42501',
  null,
  'el coordinador no lee las coordenadas ni las propias (permission denied)'
);
select is(
  (select count(*)::integer from public.supervisor_priorities where supervisor_id <> 'f6300000-0000-0000-0000-000000000091'),
  0,
  'el coordinador no ve las prioridades de otros'
);
select cmp_ok(
  (select count(*)::integer from public.supervisor_priorities where supervisor_id = 'f6300000-0000-0000-0000-000000000091'), '>=', 2,
  'el coordinador ve sus prioridades (incluida la dada de baja, como historial)'
);
select throws_ok(
  $$insert into public.supervisor_workdays (supervisor_id, work_date, started_at) values ('f6300000-0000-0000-0000-000000000091', app.today() - 9, now())$$,
  '42501',
  null,
  'el coordinador no inserta jornadas por fuera de las RPC'
);
select throws_ok(
  $$update public.supervisor_workdays set auto_closed = true where supervisor_id = 'f6300000-0000-0000-0000-000000000091'$$,
  '42501',
  null,
  'el coordinador no modifica jornadas por fuera de las RPC'
);
select throws_ok(
  $$delete from public.supervisor_priorities where supervisor_id = 'f6300000-0000-0000-0000-000000000091'$$,
  '42501',
  null,
  'el coordinador no borra prioridades'
);
select is(
  (select count(*)::integer from public.v_supervisor_status), 0,
  'v_supervisor_status: el coordinador no ve nada (solo dueño y administradores)'
);
select is(
  (select count(*)::integer from public.v_supervisor_workdays_admin), 0,
  'v_supervisor_workdays_admin: el coordinador no ve nada'
);
select cmp_ok(
  (select count(*)::integer from public.v_my_workdays), '>=', 2,
  'v_my_workdays: el coordinador ve sus jornadas'
);
select is(
  (select count(*)::integer from public.v_my_workdays where supervisor_id <> 'f6300000-0000-0000-0000-000000000091'), 0,
  'v_my_workdays: solo las propias'
);
select is(
  (select state from public.v_my_workdays where work_date = app.today()), 'running',
  'v_my_workdays: la jornada de hoy de Ana está en marcha'
);
select is(
  (select (jsonb_array_length(events) = 6) from public.v_my_workdays where work_date = app.today()), true,
  'v_my_workdays: los seis eventos de la jornada de hoy (start, pause, resume, pause, end, reopen)'
);

-- Otro coordinador no ve la jornada de Ana.
select tests.as_user('test-db063-sb@example.com');
select is(
  (select count(*)::integer from public.supervisor_workdays where supervisor_id = 'f6300000-0000-0000-0000-000000000091'), 0,
  'Beto no ve las jornadas de Ana'
);

-- El empleado no ve nada de esto.
select tests.as_user('test-db063-emp@example.com');
select is(
  (select count(*)::integer from public.supervisor_workdays), 0,
  'el empleado no ve jornadas'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events), 0,
  'el empleado no ve eventos'
);
select is(
  (select count(*)::integer from public.supervisor_priorities), 0,
  'el empleado no ve prioridades'
);
select is(
  (select count(*)::integer from public.v_my_workdays) + (select count(*)::integer from public.v_supervisor_status)
    + (select count(*)::integer from public.v_supervisor_workdays_admin) + (select count(*)::integer from public.v_supervisor_today),
  0,
  'el empleado no ve ninguna de las vistas nuevas'
);

-- v_supervisor_status (administración): estados.
select tests.as_user('test-db063-admin-sin@example.com');
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000091'),
  'in_activity',
  'v_supervisor_status: Ana, con la jornada en marcha y sin supervisión, está «En actividad»'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000093'),
  'not_started',
  'v_supervisor_status: Lila, sin jornada, está «Sin iniciar»'
);
select is(
  (select on_leave from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000093'),
  true,
  'v_supervisor_status: Lila figura de licencia'
);
select is(
  (select count(*)::integer from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000094'),
  0,
  'v_supervisor_status: el coordinador con la ficha dada de baja no aparece'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000092'),
  'in_activity',
  'v_supervisor_status: Beto, con la jornada de hoy abierta y sin supervisión, está «En actividad»'
);
select ok(
  (select latitude is null and longitude is null from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000092'),
  'v_supervisor_status: el último evento sin posición no trae coordenadas («Sin ubicación»)'
);
select is(
  (select last_event_kind::text from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000091'),
  'reopen',
  'v_supervisor_status: último evento de Ana'
);

-- ---------------------------------------------------------------------------------------------
-- Cierre automático a las 23:55 de hoy (al final, porque cierra también la jornada de hoy de Ana)
-- ---------------------------------------------------------------------------------------------

set local role postgres;

select cmp_ok(
  app.auto_close_workdays(app.local_ts(app.today(), '23:56')), '>=', 2,
  'a las 23:56 cierra las jornadas abiertas de hoy (la de Ana y la de Beto)'
);
select is(
  (select ended_at from public.supervisor_workdays where id = 'f6300000-0000-0000-0000-0000000000b5'),
  app.local_ts(app.today(), '23:55'),
  'la jornada de hoy se cierra a las 23:55'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events
   where workday_id = 'f6300000-0000-0000-0000-0000000000b5' and kind = 'end' and reason = 'Cierre automático'),
  1,
  'queda un único evento de fin del cierre automático'
);

select tests.as_user('test-db063-admin-sin@example.com');
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000092'),
  'finished',
  'v_supervisor_status: Beto, con la jornada de hoy cerrada, está «Finalizada»'
);
select is(
  (select auto_closed from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000092'),
  true,
  'v_supervisor_status: la jornada de hoy de Beto se cerró sola'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6300000-0000-0000-0000-000000000091'),
  'finished',
  'v_supervisor_status: Ana también quedó «Finalizada» por el cierre automático'
);
select is(
  (select auto_close_warning from public.v_supervisor_workdays_admin
   where supervisor_id = 'f6300000-0000-0000-0000-000000000091' and work_date = app.today()),
  true,
  'v_supervisor_workdays_admin: la jornada de hoy de Ana trae la advertencia del cierre automático'
);


select * from finish();

rollback;
