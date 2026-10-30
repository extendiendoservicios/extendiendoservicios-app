-- pgTAP de la migración 0063_p24_1_jornada_coordinador.sql (P24.1), segunda parte: la supervisión
-- libre (CJ-01 a CJ-11, CJ-26 a CJ-28).
--   1. take_supervision: requisitos (jornada iniciada y sin pausa, CJ-07), turno de hoy, no
--      cancelado, en curso o terminado (CJ-06), de a una (CJ-08), validación de sede (B-07),
--      dos coordinadores en el mismo turno (CJ-05) y la advertencia SUPERVISES_OWN_SHIFT.
--   2. Bloqueos de la jornada con una supervisión abierta (CJ-29).
--   3. complete_supervision: calificar a todos los que tienen inicio registrado (CJ-10), los
--      ausentes y las asignaciones quitadas quedan fuera, el propio coordinador queda fuera
--      (CJ-28); registra el fin. Varias calificaciones por empleado (CJ-09).
--   4. discard_supervision (CJ-27) y volver a tomar el turno.
--   5. rate_employee: sin ventana mientras la supervisión está abierta; con ventana desde el fin.
--   6. Permisos por rol (dueño, administrador, coordinador, empleado) y que el empleado siga sin
--      leer ratings (P-084). Funciones revocadas.
--   7. Vistas: v_supervisor_today (prioridad, quién supervisa), v_supervisor_status (estados de
--      CJ-33) y v_supervisions_admin (varias filas por turno, duración informativa).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6301000-...'. Los turnos son de HOY (take_supervision exige el día); sus
-- horarios fijos nunca se comparan con now() salvo donde se fuerza a mano.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0063b;
grant usage on schema tests_0063b to authenticated, anon;

create or replace function tests_0063b.as_user(p_email text)
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
    raise exception 'tests_0063b.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0063b.as_user(text) to authenticated, anon;

create or replace function tests_0063b.err_hint(p_sql text)
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

grant execute on function tests_0063b.err_hint(text) to authenticated, anon;

create or replace function tests_0063b.err_message(p_sql text)
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

grant execute on function tests_0063b.err_message(text) to authenticated, anon;

select plan(110);

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'take_supervision', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'take_supervision');
select has_function('public', 'discard_supervision', array['uuid'], 'discard_supervision');
select has_function('public', 'complete_supervision', array['uuid', 'text', 'numeric', 'numeric', 'numeric', 'text'], 'complete_supervision con posición opcional');
select hasnt_function('public', 'complete_supervision', array['uuid', 'text'], 'la firma vieja de complete_supervision ya no existe (sin sobrecarga ambigua)');
select has_view('public', 'v_supervisor_today', 'existe v_supervisor_today');
select has_column('public', 'v_supervisions_admin', 'workday_id', 'v_supervisions_admin.workday_id');
select has_column('public', 'v_supervisions_admin', 'duration_minutes', 'v_supervisions_admin.duration_minutes');
select has_column('public', 'v_supervisions_admin', 'unclosed', 'v_supervisions_admin.unclosed');
select has_column('public', 'v_supervisions_admin', 'workday_auto_closed', 'v_supervisions_admin.workday_auto_closed');

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f6301000-0000-0000-0000-000000000001', 'Cliente de supervisión uno', 'active'),
  ('f6301000-0000-0000-0000-000000000002', 'Cliente de supervisión dos', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f6301000-0000-0000-0000-000000000011', 'f6301000-0000-0000-0000-000000000001', 'Sede uno', 'Dirección 1', -34.6, -58.4, 'active'),
  ('f6301000-0000-0000-0000-000000000012', 'f6301000-0000-0000-0000-000000000002', 'Sede dos', 'Dirección 2', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6301000-0000-0000-0000-000000000081', 'test-db063b-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Libre')),
  ('f6301000-0000-0000-0000-000000000082', 'test-db063b-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Libre')),
  ('f6301000-0000-0000-0000-000000000091', 'test-db063b-sa@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Coordinadora')),
  ('f6301000-0000-0000-0000-000000000092', 'test-db063b-sb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Coordinador')),
  ('f6301000-0000-0000-0000-000000000093', 'test-db063b-sc@example.com', jsonb_build_object('first_name', 'Cora', 'last_name', 'Tercera')),
  ('f6301000-0000-0000-0000-0000000000a1', 'test-db063b-x@example.com', jsonb_build_object('first_name', 'Ximena', 'last_name', 'Uno')),
  ('f6301000-0000-0000-0000-0000000000a2', 'test-db063b-y@example.com', jsonb_build_object('first_name', 'Yago', 'last_name', 'Dos')),
  ('f6301000-0000-0000-0000-0000000000a3', 'test-db063b-z@example.com', jsonb_build_object('first_name', 'Zoe', 'last_name', 'Tres')),
  ('f6301000-0000-0000-0000-0000000000a4', 'test-db063b-v@example.com', jsonb_build_object('first_name', 'Vera', 'last_name', 'Cuatro')),
  ('f6301000-0000-0000-0000-0000000000a5', 'test-db063b-w@example.com', jsonb_build_object('first_name', 'Walter', 'last_name', 'Cinco')),
  ('f6301000-0000-0000-0000-0000000000a6', 'test-db063b-r@example.com', jsonb_build_object('first_name', 'Rita', 'last_name', 'Removida'));

insert into public.user_roles (profile_id, role) values
  ('f6301000-0000-0000-0000-000000000081', 'owner'),
  ('f6301000-0000-0000-0000-000000000082', 'admin'),
  ('f6301000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6301000-0000-0000-0000-000000000091', 'employee'),
  ('f6301000-0000-0000-0000-000000000092', 'supervisor'),
  ('f6301000-0000-0000-0000-000000000093', 'supervisor'),
  ('f6301000-0000-0000-0000-0000000000a1', 'employee'),
  ('f6301000-0000-0000-0000-0000000000a2', 'employee'),
  ('f6301000-0000-0000-0000-0000000000a3', 'employee'),
  ('f6301000-0000-0000-0000-0000000000a4', 'employee'),
  ('f6301000-0000-0000-0000-0000000000a5', 'employee'),
  ('f6301000-0000-0000-0000-0000000000a6', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f6301000-0000-0000-0000-000000000082', 'manage_supervisions', true),
  ('f6301000-0000-0000-0000-000000000082', 'edit_ratings', true);

insert into public.employees (profile_id, dni, status) values
  ('f6301000-0000-0000-0000-000000000091', '96301091', 'active'),
  ('f6301000-0000-0000-0000-000000000092', '96301092', 'active'),
  ('f6301000-0000-0000-0000-000000000093', '96301093', 'active'),
  ('f6301000-0000-0000-0000-0000000000a1', '96301101', 'active'),
  ('f6301000-0000-0000-0000-0000000000a2', '96301102', 'active'),
  ('f6301000-0000-0000-0000-0000000000a3', '96301103', 'active'),
  ('f6301000-0000-0000-0000-0000000000a4', '96301104', 'active'),
  ('f6301000-0000-0000-0000-0000000000a5', '96301105', 'active'),
  ('f6301000-0000-0000-0000-0000000000a6', '96301106', 'active');

-- Turnos:
--   S1 (41) hoy, sede uno, en curso: Ximena y Yago con inicio; Zoe ausente (sin inicio); Rita con
--      inicio pero con la asignación quitada.
--   S2 (42) hoy, sede dos: Ana (la coordinadora, también empleada) y Vera, las dos con inicio.
--   S3 (43) mañana.
--   S4 (44) hoy, cancelado.
--   S5 (40) hoy, ya terminado (00:00 a 00:01): Walter con inicio y fin.
--   S6 (45) hoy, sede uno, sin asignaciones.
--   S7 (47) hoy, sede dos, sin asignaciones.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-000000000001', 'f6301000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 4, 'in_progress'),
  ('f6301000-0000-0000-0000-000000000042', 'f6301000-0000-0000-0000-000000000002', 'f6301000-0000-0000-0000-000000000012', app.today(), '13:00', '17:00', 2, 'in_progress'),
  ('f6301000-0000-0000-0000-000000000043', 'f6301000-0000-0000-0000-000000000001', 'f6301000-0000-0000-0000-000000000011', app.today() + 1, '08:00', '12:00', 1, 'scheduled'),
  ('f6301000-0000-0000-0000-000000000040', 'f6301000-0000-0000-0000-000000000001', 'f6301000-0000-0000-0000-000000000011', app.today(), '00:00', '00:01', 1, 'completed'),
  ('f6301000-0000-0000-0000-000000000045', 'f6301000-0000-0000-0000-000000000001', 'f6301000-0000-0000-0000-000000000011', app.today(), '18:00', '19:00', 1, 'scheduled'),
  ('f6301000-0000-0000-0000-000000000047', 'f6301000-0000-0000-0000-000000000002', 'f6301000-0000-0000-0000-000000000012', app.today(), '21:30', '22:30', 1, 'scheduled');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f6301000-0000-0000-0000-000000000044', 'f6301000-0000-0000-0000-000000000001', 'f6301000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'cancelled', now(), 'f6301000-0000-0000-0000-000000000081', 'Cancelado de prueba');

insert into public.assignments (id, shift_id, employee_id) values
  ('f6301000-0000-0000-0000-000000000201', 'f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-0000000000a1'),
  ('f6301000-0000-0000-0000-000000000202', 'f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-0000000000a2'),
  ('f6301000-0000-0000-0000-000000000203', 'f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-0000000000a3'),
  ('f6301000-0000-0000-0000-000000000204', 'f6301000-0000-0000-0000-000000000042', 'f6301000-0000-0000-0000-000000000091'),
  ('f6301000-0000-0000-0000-000000000205', 'f6301000-0000-0000-0000-000000000042', 'f6301000-0000-0000-0000-0000000000a4'),
  ('f6301000-0000-0000-0000-000000000206', 'f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-0000000000a6'),
  ('f6301000-0000-0000-0000-000000000207', 'f6301000-0000-0000-0000-000000000040', 'f6301000-0000-0000-0000-0000000000a5');

-- Rita ya no está en el turno (baja lógica).
update public.assignments
set removed_at = now(), removed_by = 'f6301000-0000-0000-0000-000000000081', removed_reason = 'Baja de prueba'
where id = 'f6301000-0000-0000-0000-000000000206';

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f6301000-0000-0000-0000-000000000201', 'check_in', app.local_ts(app.today(), '08:05'), 'employee_app'),
  ('f6301000-0000-0000-0000-000000000202', 'check_in', app.local_ts(app.today(), '08:10'), 'employee_app'),
  ('f6301000-0000-0000-0000-000000000206', 'check_in', app.local_ts(app.today(), '08:15'), 'employee_app'),
  ('f6301000-0000-0000-0000-000000000204', 'check_in', app.local_ts(app.today(), '13:05'), 'employee_app'),
  ('f6301000-0000-0000-0000-000000000205', 'check_in', app.local_ts(app.today(), '13:10'), 'employee_app'),
  ('f6301000-0000-0000-0000-000000000207', 'check_in', app.local_ts(app.today(), '00:00') + interval '10 seconds', 'employee_app'),
  ('f6301000-0000-0000-0000-000000000207', 'check_out', app.local_ts(app.today(), '00:00') + interval '50 seconds', 'employee_app');

-- Prioridades de Ana: el cliente uno entero y la sede dos.
insert into public.supervisor_priorities (supervisor_id, client_id, site_id) values
  ('f6301000-0000-0000-0000-000000000091', 'f6301000-0000-0000-0000-000000000001', null),
  ('f6301000-0000-0000-0000-000000000091', null, 'f6301000-0000-0000-0000-000000000012');

-- Una supervisión de Beto anterior a la migración (en curso, sin jornada) en el turno 7: no cuenta
-- como «abierta» (CJ-08) y sirve para probar que Ana no toca supervisiones ajenas.
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('f6301000-0000-0000-0000-0000000000d2', 'f6301000-0000-0000-0000-000000000047', 'f6301000-0000-0000-0000-000000000092', 'in_progress');

-- ---------------------------------------------------------------------------------------------
-- 1. take_supervision: requisitos y bloqueos
-- ---------------------------------------------------------------------------------------------

select tests_0063b.as_user('test-db063b-sa@example.com');

select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$),
  'WORKDAY_NOT_STARTED', 'sin la jornada iniciada no se puede supervisar (CJ-07)'
);
select is(
  tests_0063b.err_message($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$),
  'Primero iniciá tu jornada.', 'mensaje de la jornada sin iniciar'
);

select is((select public.start_workday()->>'state'), 'running', 'Ana inicia su jornada');

select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-0000000000ff')$$),
  'SHIFT_NOT_FOUND', 'turno inexistente -> SHIFT_NOT_FOUND'
);
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000043')$$),
  'NOT_TODAY', 'un turno de mañana -> NOT_TODAY'
);
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000044')$$),
  'SHIFT_NOT_SUPERVISABLE', 'un turno cancelado -> SHIFT_NOT_SUPERVISABLE'
);
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041', -34.6, null, null)$$),
  'COORDINATES_INCOMPLETE', 'posición incompleta -> COORDINATES_INCOMPLETE'
);

select is((select public.pause_workday()->>'state'), 'paused', 'Ana pausa');
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$),
  'WORKDAY_PAUSED', 'en pausa no se puede supervisar (CJ-07)'
);
select is((select public.resume_workday()->>'state'), 'running', 'Ana reanuda');

-- «Supervisar» registra el inicio con la posición en un solo paso (CJ-26).
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000041', -34.6, -58.4, 10)->'supervision'->>'status'),
  'in_progress', 'take_supervision: la supervisión nace en curso (no existe «asignada»)'
);

set local role postgres;

select ok(
  (select sv.workday_id = (select w.id from public.supervisor_workdays w
                           where w.supervisor_id = 'f6301000-0000-0000-0000-000000000091' and w.work_date = app.today())
          and sv.assigned_by is null and sv.criteria_snapshot is not null
   from public.supervisions sv
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  'la supervisión queda en la jornada de hoy, sin asignador y con los criterios vigentes'
);
select ok(
  (select sa.geo_status = 'valid' and sa.latitude = -34.6 and sa.site_distance_m is not null
   from public.supervision_attendance sa
   join public.supervisions sv on sv.id = sa.supervision_id
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091' and sa.kind = 'check_in'),
  'el inicio queda con la validación de sede de B1 (válido en el punto de la sede)'
);
select ok(
  (select e.has_position
   from public.supervisor_workday_events e
   join public.supervisions sv on sv.id = e.supervision_id
   where e.kind = 'supervision_start' and sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  'el inicio deja el evento supervision_start con posición (CJ-20)'
);

select tests_0063b.as_user('test-db063b-sa@example.com');

-- De a una (CJ-08) y bloqueos de la jornada con una supervisión abierta (CJ-29).
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000045')$$),
  'SUPERVISION_ALREADY_OPEN', 'con una supervisión abierta no se abre otra (CJ-08)'
);
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$),
  'SUPERVISION_ALREADY_OPEN', 'el mismo turno otra vez, con la supervisión abierta -> SUPERVISION_ALREADY_OPEN'
);
select is(
  tests_0063b.err_hint($$select public.pause_workday()$$),
  'SUPERVISION_OPEN', 'no se puede pausar con una supervisión abierta (CJ-29)'
);
select is(
  tests_0063b.err_hint($$select public.end_workday()$$),
  'SUPERVISION_OPEN', 'no se puede finalizar con una supervisión abierta (CJ-29)'
);

-- Dos coordinadores en el mismo turno (CJ-05).
select tests_0063b.as_user('test-db063b-sb@example.com');
select is(tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$), 'WORKDAY_NOT_STARTED', 'Beto sin jornada tampoco supervisa');
select is((select public.start_workday()->>'state'), 'running', 'Beto inicia su jornada');
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000041')->'warnings'),
  '[]'::jsonb,
  'take_supervision: Beto toma el mismo turno que Ana (CJ-05), sin advertencias'
);

set local role postgres;
select is(
  (select count(*)::integer from public.supervisions
   where shift_id = 'f6301000-0000-0000-0000-000000000041' and status <> 'cancelled'),
  2,
  'el turno tiene dos supervisiones vigentes, una por coordinador'
);

-- v_supervisor_today (CJ-02, CJ-25): todos los turnos de hoy, con quién supervisa.
select tests_0063b.as_user('test-db063b-sb@example.com');
select is(
  (select jsonb_array_length(supervisors) from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041'),
  2,
  'v_supervisor_today: el turno uno muestra a los dos coordinadores'
);
select is(
  (select count(*)::integer from public.v_supervisor_today t, jsonb_array_elements(t.supervisors) s
   where t.shift_id = 'f6301000-0000-0000-0000-000000000041' and (s ->> 'is_me')::boolean),
  1,
  'v_supervisor_today: exactamente uno de los dos es «yo»'
);
select is(
  (select my_supervision_status::text from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041'),
  'in_progress', 'v_supervisor_today: mi supervisión del turno uno'
);
select is(
  (select my_supervision_id from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000042'),
  null, 'v_supervisor_today: el turno dos (de otro cliente) aparece, sin supervisión mía (CJ-02)'
);
select is(
  (select count(*)::integer from public.v_supervisor_today
   where shift_id in (
     'f6301000-0000-0000-0000-000000000041', 'f6301000-0000-0000-0000-000000000042', 'f6301000-0000-0000-0000-000000000043',
     'f6301000-0000-0000-0000-000000000044', 'f6301000-0000-0000-0000-000000000040', 'f6301000-0000-0000-0000-000000000045',
     'f6301000-0000-0000-0000-000000000047')),
  5,
  'v_supervisor_today: 5 de los 7 turnos (sin el de mañana ni el cancelado)'
);
select is(
  (select jsonb_array_length(assigned_employees) from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041'),
  3,
  'v_supervisor_today: los empleados asignados vigentes (sin la asignación quitada)'
);
select is(
  (select display_state from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041')
  || '/' || (select display_state from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000040')
  || '/' || (select display_state from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000045'),
  'in_progress/finished/pending',
  'v_supervisor_today: estados en curso, terminado y por empezar'
);
select is(
  (select coalesce(priority_kind, 'ninguna') from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041'),
  'ninguna', 'v_supervisor_today: Beto no tiene prioridades'
);

select tests_0063b.as_user('test-db063b-sa@example.com');
select is(
  (select priority_kind from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000041')
  || '/' || (select priority_kind from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000042')
  || '/' || (select priority_kind from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000045'),
  'client/site/client',
  'v_supervisor_today: la prioridad de Ana es por cliente (cubre todas sus sedes) o por sede (CJ-24)'
);
select is(
  (select is_priority from public.v_supervisor_today where shift_id = 'f6301000-0000-0000-0000-000000000042'),
  true, 'v_supervisor_today: is_priority'
);

-- ---------------------------------------------------------------------------------------------
-- 2. complete_supervision: CJ-10, CJ-28, CJ-09
-- ---------------------------------------------------------------------------------------------

select is(
  tests_0063b.err_hint($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'))$$),
  'RATINGS_PENDING', 'cerrar sin calificar a nadie -> RATINGS_PENDING (CJ-10)'
);
select ok(
  (select m ~ 'Ximena Uno' and m ~ 'Yago Dos' and m !~ 'Zoe' and m !~ 'Rita'
   from (select tests_0063b.err_message($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'))$$) as m) q),
  'el mensaje nombra a Ximena y a Yago (con inicio), no a Zoe (ausente, CJ-28) ni a Rita (asignación quitada)'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'), 'f6301000-0000-0000-0000-000000000201', 5, 'Muy bien')$$,
  'Ana califica a Ximena'
);
select is(
  tests_0063b.err_message($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'))$$),
  'Falta calificar a: Yago Dos.',
  'con Ximena calificada, falta solo Yago'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'), 'f6301000-0000-0000-0000-000000000202', 4, null)$$,
  'Ana califica a Yago'
);
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
     'Todo en orden', -34.6, -58.4, 9)).status::text),
  'completed',
  'complete_supervision: con todos calificados (los ausentes no cuentan) cierra'
);

set local role postgres;
select ok(
  (select co.geo_status = 'valid' and co.latitude = -34.6
   from public.supervision_attendance co
   join public.supervisions sv on sv.id = co.supervision_id
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091' and co.kind = 'check_out'),
  'cerrar registra el fin con la posición y la validación de sede'
);
select is(
  (select count(*)::integer
   from public.supervisor_workday_events e
   join public.supervisions sv on sv.id = e.supervision_id
   where e.kind = 'supervision_end' and sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  1,
  'cerrar deja el evento supervision_end'
);
select is(
  (select general_notes from public.supervisions
   where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  'Todo en orden', 'cerrar guarda las observaciones'
);

select tests_0063b.as_user('test-db063b-sa@example.com');
select is(
  tests_0063b.err_hint($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'))$$),
  'SUPERVISION_NOT_EDITABLE', 'cerrar dos veces -> SUPERVISION_NOT_EDITABLE'
);
select is(
  tests_0063b.err_hint($$select public.discard_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'))$$),
  'SUPERVISION_NOT_EDITABLE', 'una supervisión cerrada no se descarta'
);
select is(
  tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000041')$$),
  'ALREADY_SUPERVISED', 'volver a tomar un turno que ya supervisó y cerró -> ALREADY_SUPERVISED (CJ-27)'
);

-- Cada coordinador califica con su criterio (CJ-09): el mismo empleado, dos calificaciones.
select tests_0063b.as_user('test-db063b-sb@example.com');
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000092' and status <> 'cancelled'), 'f6301000-0000-0000-0000-000000000201', 3, 'Regular')$$,
  'Beto califica a Ximena con su criterio'
);
select is(
  tests_0063b.err_hint($$select public.discard_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000092' and status <> 'cancelled'))$$),
  'SUPERVISION_HAS_RATINGS', 'con una calificación cargada no se puede descartar (CJ-27)'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000092' and status <> 'cancelled'), 'f6301000-0000-0000-0000-000000000202', 2, null)$$,
  'Beto califica a Yago'
);
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041' and supervisor_id = 'f6301000-0000-0000-0000-000000000092' and status <> 'cancelled')
   )).status::text),
  'completed', 'Beto cierra su supervisión del mismo turno'
);

set local role postgres;
select is(
  (select count(*)::integer from public.ratings where assignment_id = 'f6301000-0000-0000-0000-000000000201'),
  2, 'Ximena tiene dos calificaciones en el mismo turno, una por coordinador (CJ-09, CJ-11)'
);
select is(
  (select sa.geo_status::text || '/' || sa.geo_unvalidated_reason::text
   from public.supervision_attendance sa
   join public.supervisions sv on sv.id = sa.supervision_id
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000041' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000092' and sa.kind = 'check_out'),
  'unvalidated/no_location', 'cerrar sin posición queda «Sin validar / sin ubicación»'
);

-- v_supervisions_admin: varias filas por turno, duración informativa (CJ-14).
select tests_0063b.as_user('test-db063b-admin@example.com');
select is(
  (select count(*)::integer from public.v_supervisions_admin where shift_id = 'f6301000-0000-0000-0000-000000000041' and status = 'completed'),
  2, 'v_supervisions_admin: dos filas para el mismo turno'
);
select ok(
  (select bool_and(workday_id is not null and duration_minutes is not null and not unclosed and not workday_auto_closed and ratings_count = 2)
   from public.v_supervisions_admin where shift_id = 'f6301000-0000-0000-0000-000000000041' and status = 'completed'),
  'v_supervisions_admin: con jornada, duración informativa, sin marca «Sin cerrar» y con sus calificaciones'
);

-- ---------------------------------------------------------------------------------------------
-- 3. discard_supervision y volver a tomar (CJ-27); turnos sin empleados con inicio
-- ---------------------------------------------------------------------------------------------

select tests_0063b.as_user('test-db063b-sa@example.com');
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000045')->'supervision'->>'status'),
  'in_progress', 'Ana toma el turno seis (sin empleados)'
);
select is(
  tests_0063b.err_hint($$select public.discard_supervision('f6301000-0000-0000-0000-0000000000ff')$$),
  'SUPERVISION_NOT_FOUND', 'descartar una supervisión inexistente -> SUPERVISION_NOT_FOUND'
);
select is(
  tests_0063b.err_hint($$select public.discard_supervision('f6301000-0000-0000-0000-0000000000d2')$$),
  'NOT_YOUR_SUPERVISION', 'descartar la supervisión de otro -> NOT_YOUR_SUPERVISION'
);
select is(
  tests_0063b.err_hint($$select public.complete_supervision('f6301000-0000-0000-0000-0000000000d2')$$),
  'NOT_YOUR_SUPERVISION', 'cerrar la supervisión de otro -> NOT_YOUR_SUPERVISION'
);
select is(
  (select (public.discard_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000045' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled')
   )).cancel_reason),
  'Descartada por el coordinador', 'discard_supervision: queda cancelada con el motivo «Descartada por el coordinador»'
);
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000045')->'supervision'->>'status'),
  'in_progress', 'tras descartar, puede volver a tomar ese turno (CJ-27)'
);
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000045' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled')
   )).status::text),
  'completed', 'un turno sin empleados con inicio se cierra sin calificar a nadie'
);

set local role postgres;
select is(
  (select count(*)::integer from public.supervisions
   where shift_id = 'f6301000-0000-0000-0000-000000000045' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  2, 'el descarte conserva la supervisión cancelada como historial (P-014)'
);
select is(
  (select count(*)::integer from public.supervisor_workday_events e
   join public.supervisions sv on sv.id = e.supervision_id
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000045' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000091'
     and sv.status = 'cancelled' and e.kind = 'supervision_start' and e.removed_at is not null),
  1, 'el descarte da de baja el evento de inicio de la supervisión descartada'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Un turno ya terminado del mismo día (CJ-06) y la ventana de calificación (P-083)
-- ---------------------------------------------------------------------------------------------

select tests_0063b.as_user('test-db063b-sa@example.com');
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000040')->'supervision'->>'status'),
  'in_progress', 'Ana toma un turno ya terminado del mismo día (CJ-06)'
);
select is(
  tests_0063b.err_message($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled'))$$),
  'Falta calificar a: Walter Cinco.', 'faltan los que tuvieron inicio, también en un turno terminado'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled'), 'f6301000-0000-0000-0000-000000000207', 5, 'Impecable')$$,
  'se puede calificar mientras la supervisión está abierta aunque el turno ya haya terminado (sin ventana)'
);
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled')
   )).status::text),
  'completed', 'cierra la supervisión del turno terminado'
);

-- Con la supervisión cerrada rige el plazo de P-083: el fin queda una hora atrás.
set local role postgres;
update public.supervision_attendance
set recorded_at = now() - interval '1 hour'
where kind = 'check_out'
  and supervision_id = (select id from public.supervisions
                        where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091');

select tests_0063b.as_user('test-db063b-sa@example.com');
-- El turno cinco termina a las 00:01 de hoy: entre las 00:00 y las 00:01 el plazo seguiría abierto.
select is(
  case when now() > app.local_ts(app.today(), '00:01') then
    tests_0063b.err_hint($$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'), 'f6301000-0000-0000-0000-000000000207', 4, 'Cambio')$$)
  else 'RATING_WINDOW_CLOSED' end,
  'RATING_WINDOW_CLOSED', 'cerrada la supervisión y pasado el plazo, el coordinador no edita (P-083)'
);
select tests_0063b.as_user('test-db063b-admin@example.com');
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000040' and supervisor_id = 'f6301000-0000-0000-0000-000000000091'), 'f6301000-0000-0000-0000-000000000207', 4, 'Corregida')$$,
  'el administrador con edit_ratings edita siempre'
);

-- ---------------------------------------------------------------------------------------------
-- 5. El coordinador también asignado como empleado (CJ-28, P15.0)
-- ---------------------------------------------------------------------------------------------

select tests_0063b.as_user('test-db063b-sa@example.com');
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000042')->'warnings'),
  '["SUPERVISES_OWN_SHIFT"]'::jsonb,
  'take_supervision: advierte SUPERVISES_OWN_SHIFT si también está asignada como empleada'
);
select is(
  tests_0063b.err_hint($$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000042' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled'), 'f6301000-0000-0000-0000-000000000204', 5, null)$$),
  'SELF_RATING_NOT_ALLOWED', 'no se califica a sí misma'
);
select is(
  tests_0063b.err_message($$select public.complete_supervision((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000042' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled'))$$),
  'Falta calificar a: Vera Cuatro.', 'ella queda fuera del requisito: solo falta Vera'
);
select lives_ok(
  $$select public.rate_employee((select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000042' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled'), 'f6301000-0000-0000-0000-000000000205', 5, null)$$,
  'Ana califica a Vera'
);
select is(
  (select (public.complete_supervision(
     (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000042' and supervisor_id = 'f6301000-0000-0000-0000-000000000091' and status <> 'cancelled')
   )).status::text),
  'completed', 'Ana cierra sin calificarse a sí misma'
);

-- ---------------------------------------------------------------------------------------------
-- 6. Permisos por rol y funciones revocadas
-- ---------------------------------------------------------------------------------------------

select tests_0063b.as_user('test-db063b-x@example.com');
select is(tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000045')$$), 'FORBIDDEN', 'el empleado no toma supervisiones');
select is(tests_0063b.err_hint($$select public.discard_supervision('f6301000-0000-0000-0000-0000000000d2')$$), 'FORBIDDEN', 'el empleado no descarta supervisiones');
select is(tests_0063b.err_hint($$select public.complete_supervision('f6301000-0000-0000-0000-0000000000d2')$$), 'FORBIDDEN', 'el empleado no cierra supervisiones');
select is(
  tests_0063b.err_hint($$select public.rate_employee('f6301000-0000-0000-0000-0000000000d2', 'f6301000-0000-0000-0000-000000000201', 5, null)$$),
  'FORBIDDEN', 'el empleado no califica'
);
select is((select count(*)::integer from public.ratings), 0, 'el empleado no lee ratings, ni las suyas (P-084)');
select is((select count(*)::integer from public.supervisions), 0, 'el empleado no lee supervisiones');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el empleado no ve la lista de turnos del coordinador');

select tests_0063b.as_user('test-db063b-admin@example.com');
select is(tests_0063b.err_hint($$select public.take_supervision('f6301000-0000-0000-0000-000000000045')$$), 'FORBIDDEN', 'un administrador sin el rol de coordinador no toma supervisiones');
select is(tests_0063b.err_hint($$select public.discard_supervision('f6301000-0000-0000-0000-0000000000d2')$$), 'FORBIDDEN', 'un administrador no descarta supervisiones');
select is(tests_0063b.err_hint($$select public.complete_supervision('f6301000-0000-0000-0000-0000000000d2')$$), 'FORBIDDEN', 'un administrador no cierra supervisiones');
select is(tests_0063b.err_hint($$select public.assign_supervision('f6301000-0000-0000-0000-000000000045', 'f6301000-0000-0000-0000-000000000091')$$), '42501', 'assign_supervision revocada: ni el administrador la ejecuta (CJ-01)');
select is(tests_0063b.err_hint($$select public.mark_supervision_not_done('f6301000-0000-0000-0000-0000000000d2', 'Prueba')$$), '42501', 'mark_supervision_not_done revocada (CJ-26)');
select is(tests_0063b.err_hint($$select public.supervision_check_in('f6301000-0000-0000-0000-0000000000d2')$$), '42501', 'supervision_check_in revocada: el inicio es take_supervision');
select is(tests_0063b.err_hint($$select public.supervision_check_out('f6301000-0000-0000-0000-0000000000d2')$$), '42501', 'supervision_check_out revocada: el fin es complete_supervision');
select cmp_ok((select count(*)::integer from public.ratings where supervision_id in (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041')), '>=', 4, 'el administrador lee las calificaciones');
select lives_ok(
  $$select public.cancel_supervision('f6301000-0000-0000-0000-0000000000d2', 'Supervisión anterior a la migración')$$,
  'cancel_supervision sigue disponible para la administración'
);

select tests_0063b.as_user('test-db063b-owner@example.com');
select cmp_ok((select count(*)::integer from public.ratings where supervision_id in (select id from public.supervisions where shift_id = 'f6301000-0000-0000-0000-000000000041')), '>=', 4, 'el dueño lee las calificaciones');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el dueño no ve la lista de turnos del coordinador (es del rol coordinador)');

-- ---------------------------------------------------------------------------------------------
-- 7. v_supervisor_status: los estados (CJ-33)
-- ---------------------------------------------------------------------------------------------

-- Beto pausa con motivo y posición; Cora supervisa fuera de la sede; Ana finaliza.
select tests_0063b.as_user('test-db063b-sb@example.com');
select is(
  (select public.pause_workday('Almuerzo', -34.61, -58.41, 8)->>'state'), 'paused',
  'Beto pausa (su supervisión de la jornada ya está cerrada; la anterior a la migración no cuenta)'
);

select tests_0063b.as_user('test-db063b-sc@example.com');
select is((select public.start_workday(-34.65, -58.45, 20)->>'state'), 'running', 'Cora inicia su jornada');
select is(
  (select public.take_supervision('f6301000-0000-0000-0000-000000000047', -34.6, -58.4, 10, 'Estaba en otra sede')->'check_in'->>'geo_status'),
  'outside', 'la validación de sede de B1: lejos de la sede queda «fuera de zona»'
);

select tests_0063b.as_user('test-db063b-sa@example.com');
select is((select public.end_workday()->>'state'), 'ended', 'Ana finaliza su jornada (sin supervisiones abiertas)');

select tests_0063b.as_user('test-db063b-admin@example.com');
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f6301000-0000-0000-0000-000000000091'),
  'finished', 'v_supervisor_status: Ana, «Finalizada»'
);
select is(
  (select status || '/' || pause_reason || '/' || latitude::text from public.v_supervisor_status where supervisor_id = 'f6301000-0000-0000-0000-000000000092'),
  'paused/Almuerzo/-34.610000', 'v_supervisor_status: Beto, «En pausa» con el motivo y la posición de la pausa'
);
select is(
  (select status || '/' || site_name || '/' || client_legal_name from public.v_supervisor_status where supervisor_id = 'f6301000-0000-0000-0000-000000000093'),
  'supervising/Sede dos/Cliente de supervisión dos', 'v_supervisor_status: Cora, «Supervisando» con su cliente y sede'
);
select ok(
  (select supervision_id is not null and latitude = -34.6 and longitude = -58.4 and last_event_kind = 'supervision_start'
   from public.v_supervisor_status where supervisor_id = 'f6301000-0000-0000-0000-000000000093'),
  'v_supervisor_status: la posición es la del último evento (el inicio de la supervisión)'
);
select ok(
  (select duration_minutes >= 0 and not unclosed and workday_id is not null
   from public.v_supervisions_admin
   where shift_id = 'f6301000-0000-0000-0000-000000000047' and supervisor_id = 'f6301000-0000-0000-0000-000000000093'),
  'v_supervisions_admin: una supervisión abierta cuenta la duración hasta ahora y no está «Sin cerrar»'
);

set local role postgres;
select ok(
  (select sa.geo_status = 'outside' and sa.outside_reason = 'Estaba en otra sede'
   from public.supervision_attendance sa
   join public.supervisions sv on sv.id = sa.supervision_id
   where sv.shift_id = 'f6301000-0000-0000-0000-000000000047' and sv.supervisor_id = 'f6301000-0000-0000-0000-000000000093' and sa.kind = 'check_in'),
  'el motivo de «fuera de zona» se guarda en el inicio'
);
select is(
  (select array_agg(e.kind::text order by e.seq)
   from public.supervisor_workday_events e
   join public.supervisor_workdays w on w.id = e.workday_id
   where w.supervisor_id = 'f6301000-0000-0000-0000-000000000091' and w.work_date = app.today() and e.removed_at is null),
  array['start', 'pause', 'resume', 'supervision_start', 'supervision_end', 'supervision_start', 'supervision_end', 'supervision_start', 'supervision_end', 'supervision_start', 'supervision_end', 'end'],
  'los eventos vigentes de la jornada de Ana: inicio, pausa, reanudación, cuatro supervisiones cerradas (la descartada no figura) y fin'
);

select * from finish();

rollback;
