-- pgTAP de la migración 0088_p31_1_observaciones_23_nov.sql (P31.1), parte C:
--   D-10  v_assignments_board: supervision_state (none | in_progress | done) y supervisor_name al
--         final; solo para dueño y administradores.
--   D-11  v_supervisor_status: latitud, longitud y precisión del evento más reciente que trae
--         posición (jornada y supervisiones); position_at al final; el estado sigue saliendo del
--         último evento.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f88c0000-...'. Los turnos de D-10 son de 2020 y la jornada de D-11 es de hoy
-- con horas fijas dentro del día (00:01 a 00:05, Argentina). Nada depende de la hora del día.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0088c;
grant usage on schema tests_0088c to authenticated, anon;

create or replace function tests_0088c.as_user(p_email text)
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
    raise exception 'tests_0088c.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0088c.as_user(text) to authenticated, anon;

select plan(39);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f88c0000-0000-0000-0000-000000000001', 'Cliente 0088c SA', 'YPF 0088c', 'active', 1);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f88c0000-0000-0000-0000-000000000011', 'f88c0000-0000-0000-0000-000000000001', 'Sede C 88', 'Dirección 88c', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f88c0000-0000-0000-0000-000000000081', 'test-db0088c-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Ochenta')),
  ('f88c0000-0000-0000-0000-000000000082', 'test-db0088c-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Ochenta')),
  ('f88c0000-0000-0000-0000-000000000091', 'test-db0088c-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f88c0000-0000-0000-0000-000000000092', 'test-db0088c-sup2@example.com', jsonb_build_object('first_name', 'Marta', 'last_name', 'Mapa')),
  ('f88c0000-0000-0000-0000-0000000000a1', 'test-db0088c-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta'));

insert into public.user_roles (profile_id, role) values
  ('f88c0000-0000-0000-0000-000000000081', 'owner'),
  ('f88c0000-0000-0000-0000-000000000082', 'admin'),
  ('f88c0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f88c0000-0000-0000-0000-000000000092', 'supervisor'),
  ('f88c0000-0000-0000-0000-0000000000a1', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f88c0000-0000-0000-0000-000000000091', '98803091', 'active'),
  ('f88c0000-0000-0000-0000-000000000092', '98803092', 'active'),
  ('f88c0000-0000-0000-0000-0000000000a1', '98803101', 'active');

-- D-10 -----------------------------------------------------------------------------------------

-- Cuatro turnos finalizados de 2020 (una asignación de Acosta cada uno):
--   61 sin supervisión                       -> none
--   62 supervisión abierta (in_progress)     -> in_progress, Sofía
--   63 supervisión terminada (completed)     -> done, Sofía
--   64 «Sin cerrar»: in_progress con fin     -> done, Marta
--   65 abierta de Marta y terminada de Sofía -> in_progress (gana la abierta), Marta
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f88c0000-0000-0000-0000-000000000061', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', '2020-04-06', '08:00', '12:00', 1, 'completed', false),
  ('f88c0000-0000-0000-0000-000000000062', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', '2020-04-07', '08:00', '12:00', 1, 'completed', false),
  ('f88c0000-0000-0000-0000-000000000063', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', '2020-04-08', '08:00', '12:00', 1, 'completed', false),
  ('f88c0000-0000-0000-0000-000000000064', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', '2020-04-09', '08:00', '12:00', 1, 'completed', false),
  ('f88c0000-0000-0000-0000-000000000065', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', '2020-04-10', '08:00', '12:00', 1, 'completed', false);

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f88c0000-0000-0000-0000-000000000161', 'f88c0000-0000-0000-0000-000000000061', 'f88c0000-0000-0000-0000-0000000000a1', 'finished'),
  ('f88c0000-0000-0000-0000-000000000162', 'f88c0000-0000-0000-0000-000000000062', 'f88c0000-0000-0000-0000-0000000000a1', 'finished'),
  ('f88c0000-0000-0000-0000-000000000163', 'f88c0000-0000-0000-0000-000000000063', 'f88c0000-0000-0000-0000-0000000000a1', 'finished'),
  ('f88c0000-0000-0000-0000-000000000164', 'f88c0000-0000-0000-0000-000000000064', 'f88c0000-0000-0000-0000-0000000000a1', 'finished'),
  ('f88c0000-0000-0000-0000-000000000165', 'f88c0000-0000-0000-0000-000000000065', 'f88c0000-0000-0000-0000-0000000000a1', 'finished');

insert into public.supervisions (id, shift_id, supervisor_id, status, criteria_snapshot) values
  ('f88c0000-0000-0000-0000-000000000261', 'f88c0000-0000-0000-0000-000000000062', 'f88c0000-0000-0000-0000-000000000091', 'in_progress', '[]'::jsonb),
  ('f88c0000-0000-0000-0000-000000000262', 'f88c0000-0000-0000-0000-000000000063', 'f88c0000-0000-0000-0000-000000000091', 'completed', '[]'::jsonb),
  ('f88c0000-0000-0000-0000-000000000263', 'f88c0000-0000-0000-0000-000000000064', 'f88c0000-0000-0000-0000-000000000092', 'in_progress', '[]'::jsonb),
  ('f88c0000-0000-0000-0000-000000000264', 'f88c0000-0000-0000-0000-000000000065', 'f88c0000-0000-0000-0000-000000000091', 'completed', '[]'::jsonb),
  ('f88c0000-0000-0000-0000-000000000265', 'f88c0000-0000-0000-0000-000000000065', 'f88c0000-0000-0000-0000-000000000092', 'in_progress', '[]'::jsonb);

insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('f88c0000-0000-0000-0000-000000000261', 'check_in', app.local_ts('2020-04-07', '09:00')),
  ('f88c0000-0000-0000-0000-000000000262', 'check_in', app.local_ts('2020-04-08', '09:00')),
  ('f88c0000-0000-0000-0000-000000000262', 'check_out', app.local_ts('2020-04-08', '10:00')),
  ('f88c0000-0000-0000-0000-000000000263', 'check_in', app.local_ts('2020-04-09', '09:00')),
  ('f88c0000-0000-0000-0000-000000000263', 'check_out', app.local_ts('2020-04-09', '10:00')),
  ('f88c0000-0000-0000-0000-000000000264', 'check_in', app.local_ts('2020-04-10', '09:00')),
  ('f88c0000-0000-0000-0000-000000000264', 'check_out', app.local_ts('2020-04-10', '10:00')),
  ('f88c0000-0000-0000-0000-000000000265', 'check_in', app.local_ts('2020-04-10', '11:00'));

select is(
  (select array_agg(column_name::text order by ordinal_position) from (
    select column_name, ordinal_position from information_schema.columns
    where table_schema = 'public' and table_name = 'v_assignments_board'
    order by ordinal_position desc limit 3
  ) x),
  array['check_out_auto_closed', 'supervision_state', 'supervisor_name'],
  'v_assignments_board: supervision_state y supervisor_name son las dos últimas columnas (después de check_out_auto_closed)'
);

select tests_0088c.as_user('test-db0088c-owner@example.com');

select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000161'), 'none', 'tablero: sin supervisión = none');
select is((select supervisor_name from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000161'), null, 'tablero: sin supervisión no hay nombre');
select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000162'), 'in_progress', 'tablero: supervisión abierta = in_progress');
select is((select supervisor_name from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000162'), 'Sofía Supervisora', 'tablero: trae el nombre de quien supervisa');
select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000163'), 'done', 'tablero: supervisión terminada = done');
select is((select supervisor_name from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000163'), 'Sofía Supervisora', 'tablero: trae el nombre de quien supervisó');
select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000164'), 'done', 'tablero: «Sin cerrar» (in_progress con fin) = done');
select is((select supervisor_name from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000164'), 'Marta Mapa', 'tablero: el nombre es el de esa supervisión');
select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000165'), 'in_progress', 'tablero: con una abierta y una terminada gana la abierta');
select is((select supervisor_name from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000165'), 'Marta Mapa', 'tablero: el nombre es el de la abierta');

select tests_0088c.as_user('test-db0088c-admin@example.com');
select is((select supervision_state from public.v_assignments_board where id = 'f88c0000-0000-0000-0000-000000000163'), 'done', 'tablero: un administrador también ve la supervisión');

select tests_0088c.as_user('test-db0088c-a1@example.com');
select is(
  (select count(*)::int from public.v_assignments_board where supervision_state is not null), 0,
  'tablero: el empleado no ve el estado de supervisión en ninguna fila'
);
select is(
  (select count(*)::int from public.v_assignments_board where supervisor_name is not null), 0,
  'tablero: el empleado no ve el nombre del coordinador en ninguna fila'
);
select tests_0088c.as_user('test-db0088c-sup@example.com');
select is(
  (select count(*)::int from public.v_assignments_board where supervision_state is not null or supervisor_name is not null), 0,
  'tablero: el coordinador tampoco ve esas columnas'
);

-- D-11 -----------------------------------------------------------------------------------------

set local role postgres;

-- Jornada de hoy de Sofía: inicio 00:01 con posición A y una pausa 00:03 SIN posición. El último
-- evento es la pausa, que no trae posición: la posición tiene que ser la del inicio.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at) values
  ('f88c0000-0000-0000-0000-000000000301', 'f88c0000-0000-0000-0000-000000000091', app.today(), app.local_ts(app.today(), '00:01')),
  ('f88c0000-0000-0000-0000-000000000302', 'f88c0000-0000-0000-0000-000000000092', app.today(), app.local_ts(app.today(), '00:01'));
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, latitude, longitude, accuracy_m, reason) values
  ('f88c0000-0000-0000-0000-000000000401', 'f88c0000-0000-0000-0000-000000000301', 'start', app.local_ts(app.today(), '00:01'), -34.600000, -58.400000, 10.0, null),
  ('f88c0000-0000-0000-0000-000000000402', 'f88c0000-0000-0000-0000-000000000301', 'pause', app.local_ts(app.today(), '00:03'), null, null, null, 'Almuerzo'),
  -- Marta: un solo evento, sin posición.
  ('f88c0000-0000-0000-0000-000000000403', 'f88c0000-0000-0000-0000-000000000302', 'start', app.local_ts(app.today(), '00:01'), null, null, null, null);

select is(
  (select array_agg(column_name::text order by ordinal_position) from (
    select column_name, ordinal_position from information_schema.columns
    where table_schema = 'public' and table_name = 'v_supervisor_status'
    order by ordinal_position desc limit 2
  ) x),
  array['on_leave', 'position_at'],
  'v_supervisor_status: position_at es la última columna (después de on_leave)'
);

select tests_0088c.as_user('test-db0088c-owner@example.com');

select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 'paused',
  'mapa: el estado sigue saliendo del último evento (pausa)'
);
select is(
  (select last_event_kind::text from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 'pause',
  'mapa: last_event_kind sigue siendo el último evento'
);
select is(
  (select latitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -34.600000::numeric(9, 6),
  'mapa: la última pausa no trae posición: se usa la del inicio (latitud)'
);
select is(
  (select longitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -58.400000::numeric(9, 6),
  'mapa: ... y la longitud'
);
select is(
  (select accuracy_m from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 10.0::numeric(7, 1),
  'mapa: ... y la precisión'
);
select is(
  (select position_at from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), app.local_ts(app.today(), '00:01'),
  'mapa: position_at es la hora de esa posición, anterior al último evento'
);
select is(
  (select last_event_at from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), app.local_ts(app.today(), '00:03'),
  'mapa: last_event_at sigue siendo el del último evento'
);

-- Marta no trae ninguna posición: sin ubicación.
select is(
  (select latitude is null and longitude is null and accuracy_m is null and position_at is null from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000092'), true,
  'mapa: si ningún evento trae posición, queda sin ubicación'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000092'), 'in_activity',
  'mapa: el estado de Marta sale del inicio'
);

-- Una supervisión de Sofía de hoy, terminada, con inicio (00:02, posición B) y fin (00:04, posición
-- C) guardados en supervision_attendance: cuentan aunque no haya eventos de jornada para ellos.
set local role postgres;

insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f88c0000-0000-0000-0000-000000000067', null, 'f88c0000-0000-0000-0000-000000000001', 'f88c0000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'scheduled', false);
insert into public.supervisions (id, shift_id, supervisor_id, status, workday_id, criteria_snapshot) values
  ('f88c0000-0000-0000-0000-000000000266', 'f88c0000-0000-0000-0000-000000000067', 'f88c0000-0000-0000-0000-000000000091', 'completed', 'f88c0000-0000-0000-0000-000000000301', '[]'::jsonb);
insert into public.supervision_attendance (supervision_id, kind, recorded_at, latitude, longitude, accuracy_m) values
  ('f88c0000-0000-0000-0000-000000000266', 'check_in', app.local_ts(app.today(), '00:02'), -34.610000, -58.410000, 20.0),
  ('f88c0000-0000-0000-0000-000000000266', 'check_out', app.local_ts(app.today(), '00:04'), -34.620000, -58.420000, 30.0);

select tests_0088c.as_user('test-db0088c-owner@example.com');

select is(
  (select latitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -34.620000::numeric(9, 6),
  'mapa: el fin de una supervisión más reciente que el último evento manda (latitud)'
);
select is(
  (select longitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -58.420000::numeric(9, 6),
  'mapa: ... longitud'
);
select is(
  (select accuracy_m from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 30.0::numeric(7, 1),
  'mapa: ... precisión'
);
select is(
  (select position_at from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), app.local_ts(app.today(), '00:04'),
  'mapa: position_at es la hora del fin de la supervisión'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 'paused',
  'mapa: el estado sigue saliendo del último evento de la jornada'
);

-- Una reanudación con posición D a las 00:05 pasa a ser la más reciente; si se da de baja, vuelve
-- la anterior.
set local role postgres;
insert into public.supervisor_workday_events (id, workday_id, kind, recorded_at, latitude, longitude, accuracy_m) values
  ('f88c0000-0000-0000-0000-000000000404', 'f88c0000-0000-0000-0000-000000000301', 'resume', app.local_ts(app.today(), '00:05'), -34.630000, -58.430000, 15.0);
select tests_0088c.as_user('test-db0088c-owner@example.com');
select is(
  (select latitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -34.630000::numeric(9, 6),
  'mapa: la reanudación con posición, la más reciente, manda'
);
select is(
  (select status from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), 'in_activity',
  'mapa: el estado cambia con el último evento (reanudó)'
);

set local role postgres;
update public.supervisor_workday_events
set removed_at = now(), removed_by = 'f88c0000-0000-0000-0000-000000000081'
where id = 'f88c0000-0000-0000-0000-000000000404';
select tests_0088c.as_user('test-db0088c-owner@example.com');
select is(
  (select latitude from public.v_supervisor_status where supervisor_id = 'f88c0000-0000-0000-0000-000000000091'), -34.620000::numeric(9, 6),
  'mapa: un evento dado de baja no cuenta: vuelve el fin de la supervisión'
);

-- Permisos.
select tests_0088c.as_user('test-db0088c-admin@example.com');
select is(
  (select count(*)::int from public.v_supervisor_status where supervisor_id in ('f88c0000-0000-0000-0000-000000000091', 'f88c0000-0000-0000-0000-000000000092')), 2,
  'permisos: un administrador ve el estado de los coordinadores'
);
select is(
  (select count(*)::int from app.workday_last_position('f88c0000-0000-0000-0000-000000000301')), 1,
  'permisos: app.workday_last_position devuelve la posición a un administrador'
);

select tests_0088c.as_user('test-db0088c-sup@example.com');
select is(
  (select count(*)::int from public.v_supervisor_status), 0,
  'permisos: un coordinador no ve el mapa (sin filas)'
);
select is(
  (select count(*)::int from app.workday_last_position('f88c0000-0000-0000-0000-000000000301')), 0,
  'permisos: app.workday_last_position no devuelve posiciones a un coordinador'
);
select tests_0088c.as_user('test-db0088c-a1@example.com');
select is(
  (select count(*)::int from public.v_supervisor_status), 0,
  'permisos: un empleado no ve el mapa'
);
select is(
  (select count(*)::int from app.workday_last_position('f88c0000-0000-0000-0000-000000000301')), 0,
  'permisos: app.workday_last_position no devuelve posiciones a un empleado'
);

select * from finish();

rollback;
