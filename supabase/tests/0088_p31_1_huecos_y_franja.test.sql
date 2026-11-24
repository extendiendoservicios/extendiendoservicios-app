-- pgTAP de la migración 0088_p31_1_observaciones_23_nov.sql (P31.1), parte A:
--   D-01  employee_fixed_gaps: no lista turnos cubiertos por otras personas, pasados ni finalizados.
--   D-07  update_shift_time: la franja de un turno finalizado se puede cambiar (dueño y
--         administradores); las horas se recalculan solas; la fecha no.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f88a0000-...'. Fechas de 2199 para lo futuro (el 2199-08-05 es lunes), de 2020
-- para lo pasado y app.today() para lo de hoy. Nada depende de la hora del día.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0088a;
grant usage on schema tests_0088a to authenticated, anon;

create or replace function tests_0088a.as_user(p_email text)
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
    raise exception 'tests_0088a.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0088a.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0088a.err(p_sql text)
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

grant execute on function tests_0088a.err(text) to authenticated, anon;

select plan(35);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f88a0000-0000-0000-0000-000000000001', 'Cliente 0088a SA', 'YPF 0088a', 'active', 5);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f88a0000-0000-0000-0000-000000000011', 'f88a0000-0000-0000-0000-000000000001', 'Sede A 88', 'Dirección 88a', -34.6, -58.4, 'active'),
  ('f88a0000-0000-0000-0000-000000000012', 'f88a0000-0000-0000-0000-000000000001', 'Sede B 88', 'Dirección 88a bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f88a0000-0000-0000-0000-000000000081', 'test-db0088a-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Ochenta')),
  ('f88a0000-0000-0000-0000-000000000082', 'test-db0088a-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Ochenta')),
  ('f88a0000-0000-0000-0000-000000000091', 'test-db0088a-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f88a0000-0000-0000-0000-0000000000a1', 'test-db0088a-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f88a0000-0000-0000-0000-0000000000a2', 'test-db0088a-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f88a0000-0000-0000-0000-0000000000a3', 'test-db0088a-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera')),
  ('f88a0000-0000-0000-0000-0000000000a4', 'test-db0088a-a4@example.com', jsonb_build_object('first_name', 'Darío', 'last_name', 'Duarte'));

insert into public.user_roles (profile_id, role) values
  ('f88a0000-0000-0000-0000-000000000081', 'owner'),
  ('f88a0000-0000-0000-0000-000000000082', 'admin'),
  ('f88a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f88a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f88a0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f88a0000-0000-0000-0000-0000000000a3', 'employee'),
  ('f88a0000-0000-0000-0000-0000000000a4', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f88a0000-0000-0000-0000-000000000091', '98801091', 'active'),
  ('f88a0000-0000-0000-0000-0000000000a1', '98801101', 'active'),
  ('f88a0000-0000-0000-0000-0000000000a2', '98801102', 'active'),
  ('f88a0000-0000-0000-0000-0000000000a3', '98801103', 'active'),
  ('f88a0000-0000-0000-0000-0000000000a4', '98801104', 'active');

-- Servicio con Acosta como fija. Dotación 1.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', 'S1 88a', array[1]::smallint[], '09:00', '13:00', 1, '2019-01-01', null, 'active');
insert into public.service_fixed_employees (service_id, employee_id) values
  ('f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-0000000000a1');

-- Turnos del servicio de Acosta (sin asignarla):
--   41 2199-08-05  cubierto por Boutter y con licencia de Acosta -> NO se lista (D-01)
--   42 2199-08-12  sin nadie y con licencia de Acosta            -> ON_LEAVE
--   43 2199-08-19  finalizado, sin nadie                          -> NO se lista
--   44 2199-08-26  dotación 2 con una persona                     -> NOT_ASSIGNED (le falta gente)
--   45 2199-09-02  cubierto por Boutter, sin licencia             -> NO se lista (SHIFT_FULL ya no existe)
--   46 hoy         sin nadie                                      -> NOT_ASSIGNED
--   47 ayer        sin nadie                                      -> NO se lista (pasado)
--   48 2020-03-02  pasado, sin nadie                              -> NO se lista (pasado)
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, created_at) values
  ('f88a0000-0000-0000-0000-000000000041', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2199-08-05', '09:00', '13:00', 1, 'assigned', true, now()),
  ('f88a0000-0000-0000-0000-000000000042', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2199-08-12', '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f88a0000-0000-0000-0000-000000000043', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2199-08-19', '09:00', '13:00', 1, 'completed', true, now()),
  ('f88a0000-0000-0000-0000-000000000044', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2199-08-26', '09:00', '13:00', 2, 'scheduled', true, now()),
  ('f88a0000-0000-0000-0000-000000000045', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2199-09-02', '09:00', '13:00', 1, 'assigned', true, now()),
  ('f88a0000-0000-0000-0000-000000000046', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', app.today(), '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f88a0000-0000-0000-0000-000000000047', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', app.today() - 1, '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f88a0000-0000-0000-0000-000000000048', 'f88a0000-0000-0000-0000-000000000021', 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2020-03-02', '09:00', '13:00', 1, 'scheduled', true, now());

insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f88a0000-0000-0000-0000-0000000000a1', '2199-08-05', '2199-08-12', 'Vacaciones');

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f88a0000-0000-0000-0000-000000000151', 'f88a0000-0000-0000-0000-000000000041', 'f88a0000-0000-0000-0000-0000000000a2', 'expected'),
  ('f88a0000-0000-0000-0000-000000000152', 'f88a0000-0000-0000-0000-000000000044', 'f88a0000-0000-0000-0000-0000000000a2', 'expected'),
  ('f88a0000-0000-0000-0000-000000000153', 'f88a0000-0000-0000-0000-000000000045', 'f88a0000-0000-0000-0000-0000000000a2', 'expected');

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'employee_fixed_gaps', array['uuid', 'date', 'date'], 'existe employee_fixed_gaps(uuid, date, date)');
select ok(
  has_function_privilege('authenticated', 'public.employee_fixed_gaps(uuid, date, date)', 'execute')
    and not has_function_privilege('anon', 'public.employee_fixed_gaps(uuid, date, date)', 'execute'),
  'employee_fixed_gaps: authenticated sí, anon no'
);

-- D-01 -----------------------------------------------------------------------------------------

select tests_0088a.as_user('test-db0088a-owner@example.com');

create temp table t_gaps on commit drop as
select * from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-09-30');
grant select on t_gaps to authenticated;

select is((select count(*)::int from t_gaps), 2, 'gaps: solo dos huecos reales en agosto y setiembre de 2199');
select is(
  (select count(*)::int from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000041'), 0,
  'gaps: el turno cubierto por otra persona NO se lista aunque la fija tenga licencia'
);
select is((select reason from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000042'), 'ON_LEAVE', 'gaps: sin nadie y con licencia = ON_LEAVE');
select is((select detail ->> 'code' from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000042'), 'ON_LEAVE', 'gaps: ON_LEAVE sigue trayendo el detalle');
select is((select count(*)::int from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000043'), 0, 'gaps: un turno finalizado no se lista');
select is(
  (select reason from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000044'), 'NOT_ASSIGNED',
  'gaps: si la dotación no está completa (1 de 2) sigue listado'
);
select is((select count(*)::int from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000045'), 0, 'gaps: dotación completa con otra persona = no se lista (ya no hay SHIFT_FULL)');
select is(
  (select count(*)::int from t_gaps where reason = 'SHIFT_FULL'), 0,
  'gaps: el motivo SHIFT_FULL ya no aparece'
);
select is(
  (select calendar_color from t_gaps where shift_id = 'f88a0000-0000-0000-0000-000000000042'), 5::smallint,
  'gaps: sigue trayendo el color del cliente'
);

create temp table t_gaps_hoy on commit drop as
select * from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', app.today() - 5, app.today() + 2);
grant select on t_gaps_hoy to authenticated;

select is((select count(*)::int from t_gaps_hoy where shift_id = 'f88a0000-0000-0000-0000-000000000046'), 1, 'gaps: el turno de hoy sin nadie se lista');
select is((select count(*)::int from t_gaps_hoy where shift_id = 'f88a0000-0000-0000-0000-000000000047'), 0, 'gaps: el de ayer no (pasado)');
select is(
  (select count(*)::int from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', '2020-03-01', '2020-03-31')), 0,
  'gaps: un turno de 2020 sin nadie no se lista (pasado)'
);

select tests_0088a.as_user('test-db0088a-admin@example.com');
select is(
  (select count(*)::int from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-09-30')), 2,
  'gaps: un administrador también los consulta'
);
select tests_0088a.as_user('test-db0088a-a1@example.com');
select is(
  tests_0088a.err($$select * from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-09-30')$$) ->> 'hint',
  'FORBIDDEN', 'gaps: un empleado no los puede consultar'
);
select tests_0088a.as_user('test-db0088a-sup@example.com');
select is(
  tests_0088a.err($$select * from public.employee_fixed_gaps('f88a0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-09-30')$$) ->> 'hint',
  'FORBIDDEN', 'gaps: un coordinador no los puede consultar'
);

-- D-07 -----------------------------------------------------------------------------------------

set local role postgres;

-- Turno finalizado 10:30 a 14:30 del lunes 2020-03-09; Cabrera fichó 10:02 a 14:56. Otro turno de
-- Cabrera ese día a las 15:00 (para probar el choque). Duarte tiene franja propia 10:30 a 14:30.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f88a0000-0000-0000-0000-000000000061', null, 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000012', '2020-03-09', '10:30', '14:30', 2, 'completed', false),
  ('f88a0000-0000-0000-0000-000000000062', null, 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2020-03-09', '15:00', '16:00', 1, 'scheduled', false),
  ('f88a0000-0000-0000-0000-000000000063', null, 'f88a0000-0000-0000-0000-000000000001', 'f88a0000-0000-0000-0000-000000000011', '2020-03-10', '10:00', '12:00', 1, 'scheduled', false);

update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f88a0000-0000-0000-0000-000000000081', cancel_reason = 'Prueba'
where id = 'f88a0000-0000-0000-0000-000000000063';

insert into public.assignments (id, shift_id, employee_id, status, start_time, end_time) values
  ('f88a0000-0000-0000-0000-000000000161', 'f88a0000-0000-0000-0000-000000000061', 'f88a0000-0000-0000-0000-0000000000a3', 'finished', null, null),
  ('f88a0000-0000-0000-0000-000000000162', 'f88a0000-0000-0000-0000-000000000061', 'f88a0000-0000-0000-0000-0000000000a4', 'finished', '10:30', '14:30'),
  ('f88a0000-0000-0000-0000-000000000163', 'f88a0000-0000-0000-0000-000000000062', 'f88a0000-0000-0000-0000-0000000000a3', 'expected', null, null);

insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  ('f88a0000-0000-0000-0000-000000000161', 'check_in', app.local_ts('2020-03-09', '10:02'), 'employee_app', 'f88a0000-0000-0000-0000-0000000000a3'),
  ('f88a0000-0000-0000-0000-000000000161', 'check_out', app.local_ts('2020-03-09', '14:56'), 'employee_app', 'f88a0000-0000-0000-0000-0000000000a3'),
  ('f88a0000-0000-0000-0000-000000000162', 'check_in', app.local_ts('2020-03-09', '10:02'), 'employee_app', 'f88a0000-0000-0000-0000-0000000000a4'),
  ('f88a0000-0000-0000-0000-000000000162', 'check_out', app.local_ts('2020-03-09', '14:56'), 'employee_app', 'f88a0000-0000-0000-0000-0000000000a4');

select has_function('public', 'update_shift_time', array['uuid', 'time without time zone', 'time without time zone', 'boolean', 'date'], 'existe update_shift_time(uuid, time, time, boolean, date)');

select tests_0088a.as_user('test-db0088a-owner@example.com');

select is(
  (select worked_minutes from public.v_assignments_board where id = 'f88a0000-0000-0000-0000-000000000161'), 240,
  'horas: fichaje 10:02-14:56 en turno 10:30-14:30 = 240 min'
);

create temp table t_upd on commit drop as
select * from public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '15:00');
grant select on t_upd to authenticated;

select is((select status::text from t_upd), 'completed', 'franja: el turno sigue finalizado');
select is((select start_time::text || '-' || end_time::text from t_upd), '10:00:00-15:00:00', 'franja: la nueva franja queda guardada');
select is((select updated_by from t_upd), 'f88a0000-0000-0000-0000-000000000081'::uuid, 'franja: queda quién la cambió (updated_by)');
select is(
  (select worked_minutes from public.v_assignments_board where id = 'f88a0000-0000-0000-0000-000000000161'), 294,
  'horas: tras cambiar a 10:00-15:00 se cuentan 294 min (10:02 a 14:56)'
);
select is(
  (select status::text from public.assignments where id = 'f88a0000-0000-0000-0000-000000000161'), 'finished',
  'franja: la asignación no cambia de estado'
);
select is(
  (select worked_minutes from public.v_assignments_board where id = 'f88a0000-0000-0000-0000-000000000162'), 240,
  'franja propia: la asignación con franja propia conserva sus horas (240 min)'
);

-- El administrador también puede editar el horario de un turno finalizado.
select tests_0088a.as_user('test-db0088a-admin@example.com');
select is(
  (select end_time::text from public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '14:30')), '14:30:00',
  'franja: un administrador también cambia el horario de un turno finalizado'
);
select is(
  (select worked_minutes from public.v_assignments_board where id = 'f88a0000-0000-0000-0000-000000000161'), 268,
  'horas: acortar el fin vuelve a recortar (10:02 a 14:30 = 268 min)'
);

select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '14:30', false, '2020-03-16')$$) ->> 'hint',
  'SHIFT_COMPLETED', 'franja: con otra fecha un turno finalizado sigue dando SHIFT_COMPLETED'
);
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', null, true)$$) ->> 'hint',
  'SHIFT_COMPLETED', 'franja: no se pasa un turno finalizado a «A terminar»'
);
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '15:00', '14:00')$$) ->> 'hint',
  'INVALID_TIME_RANGE', 'franja: el fin tiene que ser posterior al inicio'
);
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '15:30')$$) ->> 'hint',
  'ASSIGNMENT_OVERLAP', 'franja: si pisa otro turno de un asignado, ASSIGNMENT_OVERLAP'
);
select is(
  (select end_time::text from public.shifts where id = 'f88a0000-0000-0000-0000-000000000061'), '14:30:00',
  'franja: el intento fallido no cambió nada'
);
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000063', '10:00', '13:00')$$) ->> 'hint',
  'SHIFT_CANCELLED', 'franja: un turno cancelado sigue rechazado'
);

select tests_0088a.as_user('test-db0088a-a3@example.com');
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '15:00')$$) ->> 'hint',
  'FORBIDDEN', 'franja: un empleado no puede'
);
select tests_0088a.as_user('test-db0088a-sup@example.com');
select is(
  tests_0088a.err($$select public.update_shift_time('f88a0000-0000-0000-0000-000000000061', '10:00', '15:00')$$) ->> 'hint',
  'FORBIDDEN', 'franja: un coordinador no puede'
);

select * from finish();

rollback;
