-- pgTAP de la migración 0060_p19_11c_fecha_avisos_certificado.sql (P19.11c, decisiones del 20 oct 2026):
--   1. update_shift_time(p_date): no se puede mover un turno a una fecha anterior a hoy
--      (SHIFT_DATE_IN_PAST); hoy sí.
--   2. Al mover un turno de día se anulan los avisos (attendance_notices.voided_at, quedan como
--      historial) y las asignaciones con demora o ausencia avisada vuelven a «esperado»; las
--      vistas v_assignments_board, v_my_day y v_my_history toman solo avisos no anulados.
--   3. set_absence_certificate: marcar o corregir el certificado de una ausencia ya avisada.
--   4. Mensajes: «supervisor» pasa a «coordinador» (assign_supervision, alta de usuarios,
--      anuncios); los hints no cambian.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6000000-...'. Las fechas de prueba son de 2199 salvo donde hace falta
-- «hoy» / «ayer» (app.today(), recortadas al día en Argentina: nada depende de la hora).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0060;
grant usage on schema tests_0060 to authenticated, anon;

create or replace function tests_0060.as_user(p_email text)
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
    raise exception 'tests_0060.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0060.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0060.err_hint(p_sql text)
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

grant execute on function tests_0060.err_hint(text) to authenticated, anon;

create or replace function tests_0060.err_message(p_sql text)
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

grant execute on function tests_0060.err_message(text) to authenticated, anon;

select plan(57);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'attendance_notices', 'voided_at', 'attendance_notices.voided_at');
select has_column('public', 'attendance_notices', 'voided_by', 'attendance_notices.voided_by');
select has_column('public', 'attendance_notices', 'void_reason', 'attendance_notices.void_reason');
select has_column('public', 'attendance_notices', 'updated_at', 'attendance_notices.updated_at');
select has_column('public', 'attendance_notices', 'updated_by', 'attendance_notices.updated_by');
select has_function('public', 'set_absence_certificate', array['uuid', 'boolean'], 'set_absence_certificate(uuid, boolean)');
select ok(
  not has_function_privilege('anon', 'public.set_absence_certificate(uuid, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.set_absence_certificate(uuid, boolean)', 'execute'),
  'grants de set_absence_certificate: anon no, authenticated sí'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f6000000-0000-0000-0000-000000000001', 'Cliente de fecha y avisos', 'active', 0);

insert into public.sites (id, client_id, name, address, status) values
  ('f6000000-0000-0000-0000-000000000011', 'f6000000-0000-0000-0000-000000000001', 'Sede de fecha y avisos', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6000000-0000-0000-0000-000000000081', 'test-db060-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Sesenta')),
  ('f6000000-0000-0000-0000-000000000082', 'test-db060-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConAsistencia')),
  ('f6000000-0000-0000-0000-000000000083', 'test-db060-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinAsistencia')),
  ('f6000000-0000-0000-0000-000000000084', 'test-db060-coordinadora@example.com', jsonb_build_object('first_name', 'Coordi', 'last_name', 'Nadora')),
  ('f6000000-0000-0000-0000-000000000085', 'test-db060-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('f6000000-0000-0000-0000-000000000091', 'test-db060-ea@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Avisos')),
  ('f6000000-0000-0000-0000-000000000092', 'test-db060-eb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Avisos')),
  ('f6000000-0000-0000-0000-000000000093', 'test-db060-ec@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Avisos')),
  ('f6000000-0000-0000-0000-000000000094', 'test-db060-ed@example.com', jsonb_build_object('first_name', 'Dora', 'last_name', 'Avisos'));

insert into public.user_roles (profile_id, role) values
  ('f6000000-0000-0000-0000-000000000081', 'owner'),
  ('f6000000-0000-0000-0000-000000000082', 'admin'),
  ('f6000000-0000-0000-0000-000000000083', 'admin'),
  ('f6000000-0000-0000-0000-000000000084', 'supervisor'),
  ('f6000000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f6000000-0000-0000-0000-000000000082', 'manage_attendance', true);

insert into public.employees (profile_id, dni, status) values
  ('f6000000-0000-0000-0000-000000000084', '96000084', 'active'),
  ('f6000000-0000-0000-0000-000000000085', '96000085', 'active'),
  ('f6000000-0000-0000-0000-000000000091', '96000091', 'active'),
  ('f6000000-0000-0000-0000-000000000092', '96000092', 'active'),
  ('f6000000-0000-0000-0000-000000000093', '96000093', 'active'),
  ('f6000000-0000-0000-0000-000000000094', '96000094', 'active');

-- Turnos:
--   SF  2199-08-05  avisos que se limpian al mover de día
--   SH  2199-08-20  cambio de hora sin cambio de fecha (los avisos se conservan)
--   SC  2199-10-05  set_absence_certificate
--   SP  2199-09-01  sin asignaciones, para la regla de fecha pasada
--   SX  2020-01-15  ya pasó, con una ausencia avisada
--   SD  hoy         de la empleada 85 (v_my_day)
--   SY  ayer        de la empleada 85 (v_my_history)
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', '2199-08-05', '08:00', '12:00', 4, 'assigned'),
  ('f6000000-0000-0000-0000-000000000042', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', '2199-08-20', '08:00', '12:00', 1, 'assigned'),
  ('f6000000-0000-0000-0000-000000000043', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', '2199-10-05', '08:00', '12:00', 4, 'assigned'),
  ('f6000000-0000-0000-0000-000000000044', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', '2199-09-01', '08:00', '12:00', 1, 'scheduled'),
  ('f6000000-0000-0000-0000-000000000045', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', '2020-01-15', '08:00', '12:00', 1, 'assigned'),
  ('f6000000-0000-0000-0000-000000000046', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', app.today(), '06:00', '07:00', 1, 'assigned'),
  ('f6000000-0000-0000-0000-000000000047', 'f6000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000011', app.today() - 1, '06:00', '07:00', 1, 'assigned');

insert into public.assignments (id, shift_id, employee_id) values
  ('f6000000-0000-0000-0000-000000000051', 'f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000091'),
  ('f6000000-0000-0000-0000-000000000052', 'f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000092'),
  ('f6000000-0000-0000-0000-000000000053', 'f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000093'),
  ('f6000000-0000-0000-0000-000000000054', 'f6000000-0000-0000-0000-000000000041', 'f6000000-0000-0000-0000-000000000094'),
  ('f6000000-0000-0000-0000-000000000055', 'f6000000-0000-0000-0000-000000000042', 'f6000000-0000-0000-0000-000000000091'),
  ('f6000000-0000-0000-0000-000000000061', 'f6000000-0000-0000-0000-000000000043', 'f6000000-0000-0000-0000-000000000091'),
  ('f6000000-0000-0000-0000-000000000062', 'f6000000-0000-0000-0000-000000000043', 'f6000000-0000-0000-0000-000000000092'),
  ('f6000000-0000-0000-0000-000000000063', 'f6000000-0000-0000-0000-000000000043', 'f6000000-0000-0000-0000-000000000093'),
  ('f6000000-0000-0000-0000-000000000064', 'f6000000-0000-0000-0000-000000000043', 'f6000000-0000-0000-0000-000000000094'),
  ('f6000000-0000-0000-0000-000000000065', 'f6000000-0000-0000-0000-000000000045', 'f6000000-0000-0000-0000-000000000091'),
  ('f6000000-0000-0000-0000-000000000071', 'f6000000-0000-0000-0000-000000000046', 'f6000000-0000-0000-0000-000000000085'),
  ('f6000000-0000-0000-0000-000000000072', 'f6000000-0000-0000-0000-000000000047', 'f6000000-0000-0000-0000-000000000085');

-- Avisos (created_at explícitos: dentro de la transacción now() es siempre el mismo instante).
--   A1 (51): demora + ausencia de la app -> absence_notified
--   A2 (52): demora -> delay_notified
--   A3 (53): en camino -> expected
--   A4 (54): sin avisos
--   H1 (55): ausencia de administración con certificado -> absence_notified (SH, solo cambia la hora)
insert into public.attendance_notices (id, assignment_id, kind, minutes_late, reason_code, source, created_at) values
  ('f6000000-0000-0000-0000-0000000000a1', 'f6000000-0000-0000-0000-000000000051', 'delay', 10, null, 'employee_app', now() - interval '3 hours'),
  ('f6000000-0000-0000-0000-0000000000a2', 'f6000000-0000-0000-0000-000000000051', 'absence', null, 'illness', 'employee_app', now() - interval '2 hours'),
  ('f6000000-0000-0000-0000-0000000000a3', 'f6000000-0000-0000-0000-000000000052', 'delay', 20, null, 'employee_app', now() - interval '2 hours'),
  ('f6000000-0000-0000-0000-0000000000a4', 'f6000000-0000-0000-0000-000000000053', 'on_the_way', null, null, 'employee_app', now() - interval '2 hours');
insert into public.attendance_notices (id, assignment_id, kind, source, has_certificate, created_at) values
  ('f6000000-0000-0000-0000-0000000000a5', 'f6000000-0000-0000-0000-000000000055', 'absence', 'admin', true, now() - interval '2 hours');
update public.assignments set status = 'absence_notified' where id in ('f6000000-0000-0000-0000-000000000051', 'f6000000-0000-0000-0000-000000000055');
update public.assignments set status = 'delay_notified' where id = 'f6000000-0000-0000-0000-000000000052';

-- Avisos de SC y SX (set_absence_certificate):
--   C1 (61): dos ausencias de la app (una vieja y una nueva), sin certificado cargado
--   C2 (62): ausencia de administración sin certificado
--   C3 (63): solo una demora
--   C4 (64): sin avisos
--   X1 (65): ausencia de administración de un turno que ya pasó
insert into public.attendance_notices (id, assignment_id, kind, minutes_late, reason_code, source, created_at) values
  ('f6000000-0000-0000-0000-0000000000b1', 'f6000000-0000-0000-0000-000000000061', 'absence', null, 'personal', 'employee_app', now() - interval '2 days'),
  ('f6000000-0000-0000-0000-0000000000b2', 'f6000000-0000-0000-0000-000000000061', 'absence', null, 'illness', 'employee_app', now() - interval '1 day'),
  ('f6000000-0000-0000-0000-0000000000b4', 'f6000000-0000-0000-0000-000000000063', 'delay', 15, null, 'employee_app', now() - interval '1 day');
insert into public.attendance_notices (id, assignment_id, kind, source, has_certificate, created_at) values
  ('f6000000-0000-0000-0000-0000000000b3', 'f6000000-0000-0000-0000-000000000062', 'absence', 'admin', false, now() - interval '1 day'),
  ('f6000000-0000-0000-0000-0000000000b5', 'f6000000-0000-0000-0000-000000000065', 'absence', 'admin', false, now() - interval '1 day');
update public.assignments set status = 'absence_notified' where id in ('f6000000-0000-0000-0000-000000000061', 'f6000000-0000-0000-0000-000000000062', 'f6000000-0000-0000-0000-000000000065');
update public.assignments set status = 'delay_notified' where id = 'f6000000-0000-0000-0000-000000000063';

-- Avisos de la empleada 85 (D1 hoy, Y1 ayer).
insert into public.attendance_notices (id, assignment_id, kind, minutes_late, reason_code, source, created_at) values
  ('f6000000-0000-0000-0000-0000000000c1', 'f6000000-0000-0000-0000-000000000071', 'delay', 10, null, 'employee_app', now() - interval '1 hour'),
  ('f6000000-0000-0000-0000-0000000000c2', 'f6000000-0000-0000-0000-000000000072', 'absence', null, 'illness', 'employee_app', now() - interval '1 hour');
update public.assignments set status = 'delay_notified' where id = 'f6000000-0000-0000-0000-000000000071';
update public.assignments set status = 'absence_notified' where id = 'f6000000-0000-0000-0000-000000000072';

-- Restricción vigente: has_certificate solo en ausencias.
prepare n_demora_con_certificado as
  insert into public.attendance_notices (assignment_id, kind, minutes_late, source, has_certificate)
  values ('f6000000-0000-0000-0000-000000000054', 'delay', 10, 'admin', true);
select throws_ok('n_demora_con_certificado', '23514', null, 'restricción: has_certificate solo vale en una ausencia');

-- 1. No mover un turno al pasado ---------------------------------------------------------------

select tests_0060.as_user('test-db060-admin@example.com');

select is(
  tests_0060.err_hint($$select public.update_shift_time('f6000000-0000-0000-0000-000000000044', time '08:00', time '12:00', false, date '2020-01-01')$$),
  'SHIFT_DATE_IN_PAST',
  'fecha pasada: SHIFT_DATE_IN_PAST'
);
select is(
  tests_0060.err_hint(format($$select public.update_shift_time('f6000000-0000-0000-0000-000000000044', time '08:00', time '12:00', false, %L::date)$$, app.today() - 1)),
  'SHIFT_DATE_IN_PAST',
  'fecha pasada: ayer ya es pasado'
);
select is(
  tests_0060.err_message($$select public.update_shift_time('f6000000-0000-0000-0000-000000000044', time '08:00', time '12:00', false, date '2020-01-01')$$),
  'No se puede mover el turno a una fecha que ya pasó.',
  'fecha pasada: mensaje'
);
select is(
  (select shift_date from public.shifts where id = 'f6000000-0000-0000-0000-000000000044'),
  date '2199-09-01',
  'fecha pasada: el turno no se movió'
);
select lives_ok(
  $$select public.update_shift_time('f6000000-0000-0000-0000-000000000045', time '09:00', time '11:00', false, date '2020-01-15')$$,
  'un turno que ya pasó admite cambiar la hora con su misma fecha (no es mover la fecha)'
);
select lives_ok(
  $$select public.update_shift_time('f6000000-0000-0000-0000-000000000045', time '08:00', time '12:00')$$,
  'un turno que ya pasó admite cambiar la hora sin p_date'
);
select lives_ok(
  format($$select public.update_shift_time('f6000000-0000-0000-0000-000000000044', time '00:01', time '00:30', false, %L::date)$$, app.today()),
  'mover a hoy se permite aunque la hora ya haya pasado'
);
select is(
  (select shift_date from public.shifts where id = 'f6000000-0000-0000-0000-000000000044'),
  app.today(),
  'mover a hoy: el turno quedó hoy'
);

-- 2. Limpieza de avisos al mover de día --------------------------------------------------------

select is(
  (select last_notice_kind::text from public.v_assignments_board where id = 'f6000000-0000-0000-0000-000000000051'),
  'absence',
  'antes de mover: el tablero muestra la ausencia de A1'
);
select is(
  (select status::text from public.assignments where id = 'f6000000-0000-0000-0000-000000000052'),
  'delay_notified',
  'antes de mover: A2 con demora avisada'
);

select lives_ok(
  $$select public.update_shift_time('f6000000-0000-0000-0000-000000000041', time '08:00', time '12:00', false, date '2199-08-06')$$,
  'mover SF de día'
);

select results_eq(
  $$select id::text, status::text from public.assignments where shift_id = 'f6000000-0000-0000-0000-000000000041' order by id$$,
  $$values ('f6000000-0000-0000-0000-000000000051', 'expected'), ('f6000000-0000-0000-0000-000000000052', 'expected'),
           ('f6000000-0000-0000-0000-000000000053', 'expected'), ('f6000000-0000-0000-0000-000000000054', 'expected')$$,
  'al mover de día todas las asignaciones vuelven a expected'
);
select is(
  (select count(*) from public.v_assignments_board where shift_id = 'f6000000-0000-0000-0000-000000000041' and last_notice_kind is not null),
  0::bigint,
  'al mover de día el tablero ya no muestra ningún último aviso'
);
select is(
  (select count(*) from public.v_assignments_board where shift_id = 'f6000000-0000-0000-0000-000000000041' and last_notice_at is not null),
  0::bigint,
  'al mover de día last_notice_at queda null'
);
select is(
  (select display_status from public.v_assignments_board where id = 'f6000000-0000-0000-0000-000000000051'),
  'expected',
  'al mover de día display_status vuelve a expected'
);

set local role postgres;
select is(
  (select count(*) from public.attendance_notices where assignment_id in (
    'f6000000-0000-0000-0000-000000000051', 'f6000000-0000-0000-0000-000000000052',
    'f6000000-0000-0000-0000-000000000053', 'f6000000-0000-0000-0000-000000000054')),
  4::bigint,
  'los avisos no se borran: siguen en attendance_notices como historial'
);
select is(
  (select count(*) from public.attendance_notices where assignment_id in (
    'f6000000-0000-0000-0000-000000000051', 'f6000000-0000-0000-0000-000000000052',
    'f6000000-0000-0000-0000-000000000053', 'f6000000-0000-0000-0000-000000000054')
    and voided_at is not null and voided_by = 'f6000000-0000-0000-0000-000000000082' and void_reason = 'SHIFT_DATE_CHANGED'),
  4::bigint,
  'los 4 avisos quedaron anulados con quién y por qué'
);
select is(
  (select count(*) from public.attendance_notices where assignment_id = 'f6000000-0000-0000-0000-000000000055' and voided_at is not null),
  0::bigint,
  'los avisos de otro turno no se tocan'
);

-- Un aviso nuevo (después del cambio) sí se muestra.
insert into public.attendance_notices (assignment_id, kind, minutes_late, source)
values ('f6000000-0000-0000-0000-000000000052', 'delay', 5, 'employee_app');
select tests_0060.as_user('test-db060-admin@example.com');
select is(
  (select last_notice_minutes_late::int from public.v_assignments_board where id = 'f6000000-0000-0000-0000-000000000052'),
  5,
  'un aviso posterior al cambio de fecha se muestra en el tablero'
);

-- Cambiar solo la hora no limpia nada.
select lives_ok(
  $$select public.update_shift_time('f6000000-0000-0000-0000-000000000042', time '09:00', time '13:00')$$,
  'cambiar solo la hora de SH'
);
select is(
  (select status::text from public.assignments where id = 'f6000000-0000-0000-0000-000000000055'),
  'absence_notified',
  'cambiar solo la hora conserva el estado de la asignación'
);
select is(
  (select last_notice_kind::text from public.v_assignments_board where id = 'f6000000-0000-0000-0000-000000000055'),
  'absence',
  'cambiar solo la hora conserva el último aviso en el tablero'
);
select lives_ok(
  $$select public.update_shift_time('f6000000-0000-0000-0000-000000000042', time '09:00', time '13:00', false, date '2199-08-20')$$,
  'p_date igual a la fecha actual no cuenta como mover de día'
);
select is(
  (select status::text from public.assignments where id = 'f6000000-0000-0000-0000-000000000055'),
  'absence_notified',
  'p_date igual a la actual conserva el estado'
);

-- v_my_day: la empleada ve su demora de hoy; al mover el turno a mañana deja de verla.
select tests_0060.as_user('test-db060-empleado@example.com');
select is(
  (select last_notice_kind::text from public.v_my_day where assignment_id = 'f6000000-0000-0000-0000-000000000071'),
  'delay',
  'v_my_day antes de mover: la empleada ve su aviso de demora'
);
select tests_0060.as_user('test-db060-admin@example.com');
select lives_ok(
  format($$select public.update_shift_time('f6000000-0000-0000-0000-000000000046', time '06:00', time '07:00', false, %L::date)$$, app.today() + 1),
  'mover a mañana el turno de hoy de la empleada'
);
select tests_0060.as_user('test-db060-empleado@example.com');
select results_eq(
  $$select status::text, last_notice_kind::text, shift_date = app.today() + 1 from public.v_my_day where assignment_id = 'f6000000-0000-0000-0000-000000000071'$$,
  $$values ('expected', null::text, true)$$,
  'v_my_day después de mover: asignada, sin aviso, en la fecha nueva'
);

-- v_my_history: la ausencia de ayer; al mover el turno a pasado mañana deja de figurar con aviso.
select is(
  (select last_notice_kind::text from public.v_my_history where assignment_id = 'f6000000-0000-0000-0000-000000000072'),
  'absence',
  'v_my_history antes de mover: la ausencia de ayer'
);
select tests_0060.as_user('test-db060-admin@example.com');
select lives_ok(
  format($$select public.update_shift_time('f6000000-0000-0000-0000-000000000047', time '06:00', time '07:00', false, %L::date)$$, app.today() + 2),
  'mover a pasado mañana el turno de ayer (todavía no empezó)'
);
select tests_0060.as_user('test-db060-empleado@example.com');
select is(
  (select count(*) from public.v_my_history where assignment_id = 'f6000000-0000-0000-0000-000000000072'),
  0::bigint,
  'v_my_history: el turno movido al futuro sale del historial'
);
select results_eq(
  $$select status::text, last_notice_kind::text from public.v_my_day where assignment_id = 'f6000000-0000-0000-0000-000000000072'$$,
  $$values ('expected', null::text)$$,
  'v_my_day: el turno movido aparece asignado y sin el aviso de ausencia'
);

-- 3. set_absence_certificate -------------------------------------------------------------------

select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', true)$$),
  'FORBIDDEN',
  'set_absence_certificate: la empleada no puede'
);

select tests_0060.as_user('test-db060-coordinadora@example.com');
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', true)$$),
  'FORBIDDEN',
  'set_absence_certificate: la coordinadora no puede'
);

select tests_0060.as_user('test-db060-admin-sin@example.com');
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', true)$$),
  'FORBIDDEN',
  'set_absence_certificate: admin sin manage_attendance no puede'
);

select tests_0060.as_user('test-db060-admin@example.com');
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', null)$$),
  'CERTIFICATE_REQUIRED',
  'set_absence_certificate: null da CERTIFICATE_REQUIRED'
);
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-0000000fffff', true)$$),
  'ASSIGNMENT_NOT_FOUND',
  'set_absence_certificate: asignación inexistente'
);
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000063', true)$$),
  'NO_ABSENCE',
  'set_absence_certificate: solo tiene una demora -> NO_ABSENCE'
);
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000064', true)$$),
  'NO_ABSENCE',
  'set_absence_certificate: sin avisos -> NO_ABSENCE'
);
select is(
  tests_0060.err_message($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000064', true)$$),
  'Esa asignación no tiene una ausencia avisada.',
  'set_absence_certificate: mensaje de NO_ABSENCE'
);
select is(
  tests_0060.err_hint($$select public.set_absence_certificate('f6000000-0000-0000-0000-000000000051', true)$$),
  'NO_ABSENCE',
  'set_absence_certificate: la ausencia quedó anulada al mover de día -> NO_ABSENCE'
);

-- Ausencia avisada por la empleada (sin certificado cargado): administración lo marca.
select is(
  (select has_certificate from public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', true)),
  true,
  'set_absence_certificate: marca con certificado una ausencia de la app'
);
set local role postgres;
select is(
  (select has_certificate from public.attendance_notices where id = 'f6000000-0000-0000-0000-0000000000b2'),
  true,
  'se actualizó el último aviso de ausencia'
);
select is(
  (select has_certificate from public.attendance_notices where id = 'f6000000-0000-0000-0000-0000000000b1'),
  null,
  'el aviso de ausencia anterior no se toca'
);
select ok(
  (select updated_by = 'f6000000-0000-0000-0000-000000000082' and updated_at is not null
   from public.attendance_notices where id = 'f6000000-0000-0000-0000-0000000000b2'),
  'quedó registrado quién y cuándo (updated_by / updated_at)'
);
select is(
  (select updated_at from public.attendance_notices where id = 'f6000000-0000-0000-0000-0000000000b1'),
  null,
  'el aviso que no se tocó no tiene updated_at'
);

-- Corregir de con a sin (el dueño también puede).
select tests_0060.as_user('test-db060-owner@example.com');
select is(
  (select has_certificate from public.set_absence_certificate('f6000000-0000-0000-0000-000000000061', false)),
  false,
  'set_absence_certificate: el dueño corrige a sin certificado'
);
select is(
  (select has_certificate from public.set_absence_certificate('f6000000-0000-0000-0000-000000000062', true)),
  true,
  'set_absence_certificate: ausencia cargada por administración sin certificado -> con certificado'
);
select is(
  (select status::text from public.assignments where id = 'f6000000-0000-0000-0000-000000000062'),
  'absence_notified',
  'set_absence_certificate no cambia el estado de la asignación'
);

-- Sin ventana horaria: un turno de 2020.
select is(
  (select has_certificate from public.set_absence_certificate('f6000000-0000-0000-0000-000000000065', true)),
  true,
  'set_absence_certificate: se puede marcar días (años) después'
);

-- 4. Mensajes con «coordinador» ----------------------------------------------------------------

-- Las cuatro aserciones sobre assign_supervision (mensajes «Ese coordinador...») se quitaron en
-- P24.1 (0063): la asignación manual desaparece (CJ-01) y la función ya no se puede ejecutar.
-- Que no se puede ejecutar lo cubre 0063_p24_1_jornada_coordinador.test.sql.

select * from finish();

rollback;
