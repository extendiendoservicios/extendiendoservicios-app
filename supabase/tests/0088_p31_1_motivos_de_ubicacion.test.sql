-- pgTAP de la migración 0088_p31_1_observaciones_23_nov.sql (P31.1), parte D:
--   D-14  geo_unvalidated_reason con tres motivos técnicos nuevos (permission_denied,
--         position_unavailable, timeout) y el parámetro opcional p_geo_reason en record_check_in,
--         record_check_out, take_supervision y complete_supervision (firmas nuevas, sin la vieja).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f88d0000-...'. Los turnos son de hoy (app.today()) y la jornada del
-- coordinador también, con el inicio a las 00:01. Nada depende de la hora del día.
--
-- Este archivo usa los valores nuevos del enum: corre después de aplicar la migración (un valor
-- de enum agregado no se puede usar en la misma transacción que lo crea).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0088d;
grant usage on schema tests_0088d to authenticated, anon;

create or replace function tests_0088d.as_user(p_email text)
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
    raise exception 'tests_0088d.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0088d.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0088d.err(p_sql text)
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

grant execute on function tests_0088d.err(text) to authenticated, anon;

create table tests_0088d.res (k text primary key, r jsonb);
grant select, insert on tests_0088d.res to authenticated;

select plan(36);

-- Estructura -----------------------------------------------------------------------------------

select enum_has_labels(
  'public', 'geo_unvalidated_reason',
  array['no_location', 'site_without_coords', 'admin_record', 'low_accuracy', 'permission_denied', 'position_unavailable', 'timeout'],
  'geo_unvalidated_reason: los cuatro motivos de antes y los tres técnicos nuevos'
);

select has_function('public', 'record_check_in', array['uuid', 'numeric', 'numeric', 'numeric', 'text', 'text'], 'record_check_in(uuid, numeric, numeric, numeric, text, text)');
select has_function('public', 'record_check_out', array['uuid', 'numeric', 'numeric', 'numeric', 'text', 'text'], 'record_check_out(uuid, numeric, numeric, numeric, text, text)');
select has_function('public', 'take_supervision', array['uuid', 'numeric', 'numeric', 'numeric', 'text', 'text'], 'take_supervision(uuid, numeric, numeric, numeric, text, text)');
select has_function('public', 'complete_supervision', array['uuid', 'text', 'numeric', 'numeric', 'numeric', 'text', 'text'], 'complete_supervision(uuid, text, numeric, numeric, numeric, text, text)');
select hasnt_function('public', 'record_check_in', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'sin la sobrecarga vieja de record_check_in');
select hasnt_function('public', 'record_check_out', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'sin la sobrecarga vieja de record_check_out');
select hasnt_function('public', 'take_supervision', array['uuid', 'numeric', 'numeric', 'numeric', 'text'], 'sin la sobrecarga vieja de take_supervision');
select hasnt_function('public', 'complete_supervision', array['uuid', 'text', 'numeric', 'numeric', 'numeric', 'text'], 'sin la sobrecarga vieja de complete_supervision');
select is(
  (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname in ('record_check_in', 'record_check_out', 'take_supervision', 'complete_supervision')),
  4, 'una sola firma por cada una de las cuatro RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.record_check_in(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.record_check_out(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.take_supervision(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.complete_supervision(uuid, text, numeric, numeric, numeric, text, text)', 'execute'),
  'grants: authenticated puede ejecutar las cuatro'
);
select ok(
  not has_function_privilege('anon', 'public.record_check_in(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.record_check_out(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.take_supervision(uuid, numeric, numeric, numeric, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.complete_supervision(uuid, text, numeric, numeric, numeric, text, text)', 'execute'),
  'grants: anon no puede ejecutar ninguna'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f88d0000-0000-0000-0000-000000000001', 'Cliente 0088d SA', 'YPF 0088d', 'active', 4);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f88d0000-0000-0000-0000-000000000011', 'f88d0000-0000-0000-0000-000000000001', 'Sede D 88', 'Dirección 88d', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f88d0000-0000-0000-0000-000000000091', 'test-db0088d-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f88d0000-0000-0000-0000-0000000000a1', 'test-db0088d-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f88d0000-0000-0000-0000-0000000000a2', 'test-db0088d-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f88d0000-0000-0000-0000-0000000000a3', 'test-db0088d-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera')),
  ('f88d0000-0000-0000-0000-0000000000a4', 'test-db0088d-a4@example.com', jsonb_build_object('first_name', 'Darío', 'last_name', 'Duarte')),
  ('f88d0000-0000-0000-0000-0000000000a5', 'test-db0088d-a5@example.com', jsonb_build_object('first_name', 'Elena', 'last_name', 'Espinosa')),
  ('f88d0000-0000-0000-0000-0000000000a6', 'test-db0088d-a6@example.com', jsonb_build_object('first_name', 'Fabián', 'last_name', 'Funes'));

insert into public.user_roles (profile_id, role) values
  ('f88d0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f88d0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f88d0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f88d0000-0000-0000-0000-0000000000a3', 'employee'),
  ('f88d0000-0000-0000-0000-0000000000a4', 'employee'),
  ('f88d0000-0000-0000-0000-0000000000a5', 'employee'),
  ('f88d0000-0000-0000-0000-0000000000a6', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f88d0000-0000-0000-0000-000000000091', '98804091', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a1', '98804101', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a2', '98804102', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a3', '98804103', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a4', '98804104', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a5', '98804105', 'active'),
  ('f88d0000-0000-0000-0000-0000000000a6', '98804106', 'active');

-- Un turno de hoy con seis personas, y dos turnos de hoy más para las supervisiones.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f88d0000-0000-0000-0000-000000000061', null, 'f88d0000-0000-0000-0000-000000000001', 'f88d0000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 6, 'scheduled', false),
  ('f88d0000-0000-0000-0000-000000000062', null, 'f88d0000-0000-0000-0000-000000000001', 'f88d0000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'scheduled', false),
  ('f88d0000-0000-0000-0000-000000000063', null, 'f88d0000-0000-0000-0000-000000000001', 'f88d0000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'scheduled', false);

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f88d0000-0000-0000-0000-000000000161', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f88d0000-0000-0000-0000-000000000162', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a2', 'expected'),
  ('f88d0000-0000-0000-0000-000000000163', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a3', 'expected'),
  ('f88d0000-0000-0000-0000-000000000164', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a4', 'expected'),
  ('f88d0000-0000-0000-0000-000000000165', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a5', 'expected'),
  ('f88d0000-0000-0000-0000-000000000166', 'f88d0000-0000-0000-0000-000000000061', 'f88d0000-0000-0000-0000-0000000000a6', 'expected');

-- Jornada del coordinador, iniciada a las 00:01 de hoy.
insert into public.supervisor_workdays (id, supervisor_id, work_date, started_at) values
  ('f88d0000-0000-0000-0000-000000000301', 'f88d0000-0000-0000-0000-000000000091', app.today(), app.local_ts(app.today(), '00:01'));
insert into public.supervisor_workday_events (workday_id, kind, recorded_at) values
  ('f88d0000-0000-0000-0000-000000000301', 'start', app.local_ts(app.today(), '00:01'));

-- Fichaje de entrada de los empleados -----------------------------------------------------------

select tests_0088d.as_user('test-db0088d-a1@example.com');
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_in('f88d0000-0000-0000-0000-000000000161', null, null, null, null, 'permission_denied') r),
  'permission_denied', 'entrada sin coordenadas y con motivo permission_denied: se guarda ese motivo'
);
select is(
  (select r.geo_status::text from public.attendance_records r where r.assignment_id = 'f88d0000-0000-0000-0000-000000000161' and r.kind = 'check_in'),
  'unvalidated', 'entrada: sigue sin validar'
);
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_out('f88d0000-0000-0000-0000-000000000161', p_geo_reason => 'timeout') r),
  'timeout', 'salida sin coordenadas y con motivo timeout: se guarda ese motivo'
);

select tests_0088d.as_user('test-db0088d-a2@example.com');
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_in('f88d0000-0000-0000-0000-000000000162') r),
  'no_location', 'entrada sin motivo (null): queda no_location, como antes'
);
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_out('f88d0000-0000-0000-0000-000000000162', null, null, null, null, 'position_unavailable') r),
  'position_unavailable', 'salida con motivo position_unavailable'
);

select tests_0088d.as_user('test-db0088d-a3@example.com');
select is(
  (select r.geo_status::text || '/' || coalesce(r.geo_unvalidated_reason::text, 'sin motivo') from public.record_check_in('f88d0000-0000-0000-0000-000000000163', -34.6, -58.4, 10, null, 'timeout') r),
  'valid/sin motivo', 'con coordenadas el motivo se ignora y la validación sale como siempre'
);

select tests_0088d.as_user('test-db0088d-a4@example.com');
select is(
  tests_0088d.err($$select * from public.record_check_in('f88d0000-0000-0000-0000-000000000164', null, null, null, null, 'abc')$$) ->> 'hint',
  'INVALID_GEO_REASON', 'un motivo que no es uno de los tres da INVALID_GEO_REASON'
);
select is(
  tests_0088d.err($$select * from public.record_check_in('f88d0000-0000-0000-0000-000000000164', null, null, null, null, 'no_location')$$) ->> 'hint',
  'INVALID_GEO_REASON', 'los motivos internos (no_location) tampoco se aceptan desde afuera'
);
select is(
  (select count(*)::int from public.attendance_records where assignment_id = 'f88d0000-0000-0000-0000-000000000164'), 0,
  'el intento con motivo inválido no registró nada'
);
select is(
  tests_0088d.err($$select * from public.record_check_in('f88d0000-0000-0000-0000-000000000164', -34.6, null, null, null, 'timeout')$$) ->> 'hint',
  'COORDINATES_INCOMPLETE', 'las coordenadas incompletas siguen dando COORDINATES_INCOMPLETE'
);

select tests_0088d.as_user('test-db0088d-a5@example.com');
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_in('f88d0000-0000-0000-0000-000000000165', null, null, null, null, '  position_unavailable  ') r),
  'position_unavailable', 'el motivo se recorta (espacios de los bordes)'
);
select tests_0088d.as_user('test-db0088d-a6@example.com');
select is(
  (select r.geo_unvalidated_reason::text from public.record_check_in('f88d0000-0000-0000-0000-000000000166', null, null, null, null, '') r),
  'no_location', 'un motivo vacío equivale a no mandarlo'
);

-- Un empleado no puede usar la asignación de otro con el motivo nuevo (los chequeos de antes siguen).
select is(
  tests_0088d.err($$select * from public.record_check_in('f88d0000-0000-0000-0000-000000000165', null, null, null, null, 'timeout')$$) ->> 'hint',
  'NOT_YOUR_ASSIGNMENT', 'los chequeos de siempre siguen (NOT_YOUR_ASSIGNMENT)'
);

-- Supervisiones --------------------------------------------------------------------------------

select tests_0088d.as_user('test-db0088d-sup@example.com');

select is(
  tests_0088d.err($$select * from public.take_supervision('f88d0000-0000-0000-0000-000000000062', null, null, null, null, 'xyz')$$) ->> 'hint',
  'INVALID_GEO_REASON', 'take_supervision: motivo inválido'
);
select is(
  (select count(*)::int from public.supervisions where shift_id = 'f88d0000-0000-0000-0000-000000000062'), 0,
  'take_supervision: el intento inválido no creó la supervisión'
);

insert into tests_0088d.res (k, r)
select 'tk1', public.take_supervision('f88d0000-0000-0000-0000-000000000062', null, null, null, null, 'position_unavailable');

select is(
  (select r -> 'check_in' ->> 'geo_unvalidated_reason' from tests_0088d.res where k = 'tk1'),
  'position_unavailable', 'take_supervision: el inicio guarda el motivo técnico'
);
select is(
  (select r -> 'check_in' ->> 'geo_status' from tests_0088d.res where k = 'tk1'),
  'unvalidated', 'take_supervision: sigue sin validar'
);

select is(
  tests_0088d.err(format($$select * from public.complete_supervision(%L, null, null, null, null, null, 'zzz')$$, (select r -> 'supervision' ->> 'id' from tests_0088d.res where k = 'tk1'))) ->> 'hint',
  'INVALID_GEO_REASON', 'complete_supervision: motivo inválido'
);

insert into tests_0088d.res (k, r)
select 'cp1', to_jsonb(public.complete_supervision((select (r -> 'supervision' ->> 'id')::uuid from tests_0088d.res where k = 'tk1'), 'Todo bien', null, null, null, null, 'timeout'));

select is((select r ->> 'status' from tests_0088d.res where k = 'cp1'), 'completed', 'complete_supervision: cierra la supervisión');

set local role postgres;
select is(
  (select sa.geo_unvalidated_reason::text from public.supervision_attendance sa
   where sa.supervision_id = (select (r -> 'supervision' ->> 'id')::uuid from tests_0088d.res where k = 'tk1') and sa.kind = 'check_out'),
  'timeout', 'complete_supervision: el fin guarda el motivo técnico'
);
select is(
  (select sa.geo_unvalidated_reason::text from public.supervision_attendance sa
   where sa.supervision_id = (select (r -> 'supervision' ->> 'id')::uuid from tests_0088d.res where k = 'tk1') and sa.kind = 'check_in'),
  'position_unavailable', 'el inicio de esa supervisión conserva su motivo'
);

select tests_0088d.as_user('test-db0088d-sup@example.com');
insert into tests_0088d.res (k, r)
select 'tk2', public.take_supervision(p_shift_id => 'f88d0000-0000-0000-0000-000000000063', p_geo_reason => 'permission_denied');
select is(
  (select r -> 'check_in' ->> 'geo_unvalidated_reason' from tests_0088d.res where k = 'tk2'),
  'permission_denied', 'take_supervision: llamado por nombre, solo con el motivo'
);

select is(
  (select to_jsonb(s) ->> 'status' from public.complete_supervision(
     (select (r -> 'supervision' ->> 'id')::uuid from tests_0088d.res where k = 'tk2')) s),
  'completed', 'complete_supervision: sin el motivo (llamado viejo) sigue andando'
);

set local role postgres;
select is(
  (select sa.geo_unvalidated_reason::text from public.supervision_attendance sa
   where sa.supervision_id = (select (r -> 'supervision' ->> 'id')::uuid from tests_0088d.res where k = 'tk2') and sa.kind = 'check_out'),
  'no_location', 'complete_supervision: sin motivo queda no_location'
);

select * from finish();

rollback;
