-- pgTAP de la migración 0087_p30_1_observaciones_18_nov.sql (P30.1), solo de lo que toca:
--   OH-08  save_employee_leave (libera asignaciones, preview, permisos, grants directos).
--   OH-06  employee_fixed_gaps (cada motivo).
--   OH-07  employee_fixed_pattern, employee_week_boards, save/get_employee_week_board.
--   OH-09  register_past_shift (asistencia, horas, rollback, licencia pasada, permisos).
--   OH-10  create_shift con servicio repetido: SHIFT_DATE_TAKEN con el turno existente.
--   OH-11  service_changes_run: gana el último cambio (overridden) y limpia franjas propias.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f87a0000-...'. Fechas de 2199 para lo futuro (el 2199-07-01 es lunes) y de
-- 2020 para lo pasado (el 2020-03-02 es lunes). Nada depende de la hora del día.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0087;
grant usage on schema tests_0087 to authenticated, anon;

create or replace function tests_0087.as_user(p_email text)
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
    raise exception 'tests_0087.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0087.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0087.err(p_sql text)
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

grant execute on function tests_0087.err(text) to authenticated, anon;

create table tests_0087.res (k text primary key, r jsonb);
grant select, insert on tests_0087.res to authenticated;
create table tests_0087.gaps (
  shift_id uuid, shift_date date, start_time time, end_time time, open_ended boolean, client_id uuid,
  client_name text, site_id uuid, site_name text, service_id uuid, service_name text,
  calendar_color smallint, reason text, detail jsonb, shift_status public.shift_status
);
grant select, insert on tests_0087.gaps to authenticated;

select plan(105);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f87a0000-0000-0000-0000-000000000001', 'Cliente 0087 SA', 'YPF 0087', 'active', 3);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f87a0000-0000-0000-0000-000000000011', 'f87a0000-0000-0000-0000-000000000001', 'YPF RUTA 87', 'Dirección 87', -34.6, -58.4, 'active'),
  ('f87a0000-0000-0000-0000-000000000012', 'f87a0000-0000-0000-0000-000000000001', 'Otra sede 87', 'Dirección 87 bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f87a0000-0000-0000-0000-000000000081', 'test-db0087-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Siete')),
  ('f87a0000-0000-0000-0000-000000000082', 'test-db0087-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Siete')),
  ('f87a0000-0000-0000-0000-000000000083', 'test-db0087-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f87a0000-0000-0000-0000-000000000091', 'test-db0087-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f87a0000-0000-0000-0000-0000000000a1', 'test-db0087-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f87a0000-0000-0000-0000-0000000000a2', 'test-db0087-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f87a0000-0000-0000-0000-0000000000a3', 'test-db0087-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera')),
  ('f87a0000-0000-0000-0000-0000000000a4', 'test-db0087-a4@example.com', jsonb_build_object('first_name', 'Darío', 'last_name', 'Inactivo'));

insert into public.user_roles (profile_id, role) values
  ('f87a0000-0000-0000-0000-000000000081', 'owner'),
  ('f87a0000-0000-0000-0000-000000000082', 'admin'),
  ('f87a0000-0000-0000-0000-000000000083', 'admin'),
  ('f87a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f87a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f87a0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f87a0000-0000-0000-0000-0000000000a3', 'employee'),
  ('f87a0000-0000-0000-0000-0000000000a4', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f87a0000-0000-0000-0000-000000000091', '98708091', 'active'),
  ('f87a0000-0000-0000-0000-0000000000a1', '98708101', 'active'),
  ('f87a0000-0000-0000-0000-0000000000a2', '98708102', 'active'),
  ('f87a0000-0000-0000-0000-0000000000a3', '98708103', 'active'),
  ('f87a0000-0000-0000-0000-0000000000a4', '98708104', 'terminated');

-- El admin 82 puede gestionar asistencia; el 83 no.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f87a0000-0000-0000-0000-000000000082', 'manage_attendance', true);

-- Servicios (lunes): S1 15 a 17 en la sede 1 (fija Acosta); S2 9 a 13 en la sede 2 (fija Boutter);
-- S3 vencido y S5 inactivo (también con Boutter fija, no entran al patrón); S4 para OH-11.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', 'S1 TARDE 87', array[1]::smallint[], '15:00', '17:00', 1, '2199-01-01', null, 'active'),
  ('f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', 'S2 MAÑANA 87', array[1]::smallint[], '09:00', '13:00', 1, '2199-01-01', null, 'active'),
  ('f87a0000-0000-0000-0000-000000000023', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', 'S3 VENCIDO 87', array[2]::smallint[], '08:00', '09:00', 1, '2019-01-01', '2020-01-01', 'active'),
  ('f87a0000-0000-0000-0000-000000000024', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', 'S4 CAMBIOS 87', array[1]::smallint[], '09:00', '13:00', 1, '2199-01-01', null, 'active'),
  ('f87a0000-0000-0000-0000-000000000025', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', 'S5 PAUSADO 87', array[3]::smallint[], '08:00', '09:00', 1, '2199-01-01', null, 'paused');

insert into public.service_fixed_employees (service_id, employee_id) values
  ('f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-0000000000a1'),
  ('f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-0000000000a2'),
  ('f87a0000-0000-0000-0000-000000000023', 'f87a0000-0000-0000-0000-0000000000a2'),
  ('f87a0000-0000-0000-0000-000000000025', 'f87a0000-0000-0000-0000-0000000000a2');

-- Turnos de S1 (lunes de julio de 2199) para las licencias de Acosta.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f87a0000-0000-0000-0000-000000000031', 'f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-01', '15:00', '17:00', 1, 'assigned', true),
  ('f87a0000-0000-0000-0000-000000000032', 'f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-08', '15:00', '17:00', 1, 'in_progress', true),
  ('f87a0000-0000-0000-0000-000000000033', 'f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-15', '15:00', '17:00', 1, 'assigned', true),
  ('f87a0000-0000-0000-0000-000000000034', 'f87a0000-0000-0000-0000-000000000021', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-22', '15:00', '17:00', 1, 'assigned', true),
  -- un turno de 2020 (ya pasó, sin fichajes): una licencia desde 2020 no lo libera (solo desde hoy)
  ('f87a0000-0000-0000-0000-000000000035', null, 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-02-03', '09:00', '10:00', 1, 'assigned', false),
  -- un turno cancelado del 29/7 (con asignación vigente heredada) y otro fuera del período (5/8)
  ('f87a0000-0000-0000-0000-000000000036', null, 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-29', '09:00', '10:00', 1, 'scheduled', false),
  ('f87a0000-0000-0000-0000-000000000037', null, 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-08-05', '09:00', '10:00', 1, 'assigned', false);

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f87a0000-0000-0000-0000-000000000101', 'f87a0000-0000-0000-0000-000000000031', 'f87a0000-0000-0000-0000-0000000000a1', 'delay_notified'),
  ('f87a0000-0000-0000-0000-000000000102', 'f87a0000-0000-0000-0000-000000000032', 'f87a0000-0000-0000-0000-0000000000a1', 'present'),
  ('f87a0000-0000-0000-0000-000000000103', 'f87a0000-0000-0000-0000-000000000033', 'f87a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f87a0000-0000-0000-0000-000000000104', 'f87a0000-0000-0000-0000-000000000034', 'f87a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f87a0000-0000-0000-0000-000000000105', 'f87a0000-0000-0000-0000-000000000035', 'f87a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f87a0000-0000-0000-0000-000000000106', 'f87a0000-0000-0000-0000-000000000036', 'f87a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f87a0000-0000-0000-0000-000000000107', 'f87a0000-0000-0000-0000-000000000037', 'f87a0000-0000-0000-0000-0000000000a1', 'expected');

update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f87a0000-0000-0000-0000-000000000081', cancel_reason = 'Prueba'
where id = 'f87a0000-0000-0000-0000-000000000036';

-- Fichaje de inicio en el turno del 8/7 (la asignación se conserva) y un aviso de demora en el 1/7.
insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f87a0000-0000-0000-0000-000000000102', 'check_in', now(), 'employee_app');
insert into public.attendance_notices (id, assignment_id, kind, minutes_late, source) values
  ('f87a0000-0000-0000-0000-0000000001a1', 'f87a0000-0000-0000-0000-000000000101', 'delay', 10, 'admin');

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'employee_week_boards', 'estructura: existe employee_week_boards');
select is(
  (select relrowsecurity from pg_class where oid = 'public.employee_week_boards'::regclass),
  true, 'estructura: employee_week_boards tiene RLS habilitada'
);
select ok(
  not has_table_privilege('authenticated', 'public.employee_week_boards', 'insert')
    and not has_table_privilege('authenticated', 'public.employee_week_boards', 'update')
    and not has_table_privilege('authenticated', 'public.employee_week_boards', 'delete')
    and has_table_privilege('authenticated', 'public.employee_week_boards', 'select')
    and not has_table_privilege('anon', 'public.employee_week_boards', 'select'),
  'grants: la pizarra solo se lee (select) y no es de anon'
);
select ok(
  not has_table_privilege('authenticated', 'public.employee_leaves', 'insert')
    and not has_table_privilege('authenticated', 'public.employee_leaves', 'delete')
    and not has_column_privilege('authenticated', 'public.employee_leaves', 'starts_on', 'update')
    and has_column_privilege('authenticated', 'public.employee_leaves', 'deleted_at', 'update'),
  'grants: employee_leaves ya no se inserta ni se edita directo; queda la baja lógica'
);
select ok(
  has_function_privilege('authenticated', 'public.save_employee_leave(uuid, uuid, date, date, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.employee_fixed_gaps(uuid, date, date)', 'execute')
    and has_function_privilege('authenticated', 'public.employee_fixed_pattern(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.save_employee_week_board(uuid, jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.get_employee_week_board(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.register_past_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, uuid[], boolean)', 'execute')
    and not has_function_privilege('anon', 'public.save_employee_leave(uuid, uuid, date, date, text, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.register_past_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, uuid[], boolean)', 'execute')
    and not has_function_privilege('authenticated', 'app.raise_shift_date_taken(uuid, date)', 'execute')
    and not has_function_privilege('authenticated', 'app.assign_employee_core(uuid, uuid, time, time, boolean, boolean)', 'execute'),
  'grants: las RPC nuevas son de authenticated (no de anon) y los auxiliares internos no'
);

-- OH-08: save_employee_leave -------------------------------------------------------------------

select tests_0087.as_user('test-db0087-a1@example.com');
select is(
  tests_0087.err($$select public.save_employee_leave(null, 'f87a0000-0000-0000-0000-0000000000a1', '2199-07-01', '2199-07-10', 'x')$$) ->> 'hint',
  'FORBIDDEN', 'licencias: un empleado no puede guardar licencias'
);
select tests_0087.as_user('test-db0087-sup@example.com');
select is(
  tests_0087.err($$select public.save_employee_leave(null, 'f87a0000-0000-0000-0000-0000000000a1', '2199-07-01', '2199-07-10', 'x')$$) ->> 'hint',
  'FORBIDDEN', 'licencias: un coordinador tampoco'
);

select tests_0087.as_user('test-db0087-admin-sin@example.com');
select is(
  tests_0087.err($$select public.save_employee_leave(null, 'f87a0000-0000-0000-0000-0000000000a1', '2199-12-01', '2199-12-02', 'x', true)$$),
  null, 'licencias: un administrador (sin capacidades especiales) puede'
);

select tests_0087.as_user('test-db0087-admin@example.com');

-- Vista previa: del 2020-02-01 (para ver que lo ya pasado no se libera) al 2199-07-30.
insert into tests_0087.res (k, r)
select 't_prev', public.save_employee_leave(
  null, 'f87a0000-0000-0000-0000-0000000000a1', '2020-02-01', '2199-07-30', 'Vacaciones', true
);

select is(
  (select (r ->> 'released_count')::int from tests_0087.res where k = 't_prev'), 3,
  'licencias: la vista previa libera las asignaciones de 1/7, 15/7 y 22/7 (no las pasadas, canceladas ni fuera del período)'
);
select is(
  (select (r ->> 'kept_count')::int from tests_0087.res where k = 't_prev'), 1,
  'licencias: la vista previa deja el del 8/7 (con fichaje) en kept'
);
select is(
  (select (r -> 'kept' -> 0 ->> 'shift_id') from tests_0087.res where k = 't_prev'), 'f87a0000-0000-0000-0000-000000000032',
  'licencias: kept trae el turno con fichaje'
);
select is(
  (select r -> 'released' -> 0 ->> 'client_name' from tests_0087.res where k = 't_prev'), 'YPF 0087',
  'licencias: released trae cliente, sede y servicio (client_name)'
);
select is(
  (select r -> 'released' -> 0 -> 'detail' ->> 'code' from tests_0087.res where k = 't_prev'), 'LEAVE_RELEASED',
  'licencias: released[].detail trae code LEAVE_RELEASED'
);
select ok(
  (select r ->> 'preview' from tests_0087.res where k = 't_prev')::boolean and (select r -> 'leave' ->> 'id' from tests_0087.res where k = 't_prev') is null,
  'licencias: la vista previa marca preview y no crea la licencia (id nulo)'
);

select tests_0087.as_user('test-db0087-owner@example.com');
select is(
  (select count(*)::int from public.employee_leaves where employee_id = 'f87a0000-0000-0000-0000-0000000000a1' and starts_on = '2020-02-01'),
  0, 'licencias: la vista previa no escribió la licencia'
);
select is(
  (select count(*)::int from public.assignments where employee_id = 'f87a0000-0000-0000-0000-0000000000a1' and removed_at is not null),
  0, 'licencias: la vista previa no quitó ninguna asignación'
);

-- Validaciones.
select is(
  tests_0087.err($$select public.save_employee_leave(null, 'f87a0000-0000-0000-0000-0000000000a1', '2199-07-10', '2199-07-01', 'x')$$) ->> 'hint',
  'INVALID_DATE_RANGE', 'licencias: hasta anterior a desde da INVALID_DATE_RANGE'
);
select is(
  tests_0087.err($$select public.save_employee_leave(null, '00000000-0000-0000-0000-0000000000ff', '2199-07-01', null, 'x')$$) ->> 'hint',
  'EMPLOYEE_NOT_FOUND', 'licencias: empleado inexistente da EMPLOYEE_NOT_FOUND'
);
select is(
  tests_0087.err($$select public.save_employee_leave('00000000-0000-0000-0000-0000000000ff', 'f87a0000-0000-0000-0000-0000000000a1', '2199-07-01', null, 'x')$$) ->> 'hint',
  'LEAVE_NOT_FOUND', 'licencias: licencia inexistente da LEAVE_NOT_FOUND'
);

-- Alta de verdad.
insert into tests_0087.res (k, r)
select 't_leave', public.save_employee_leave(
  null, 'f87a0000-0000-0000-0000-0000000000a1', '2020-02-01', '2199-07-30', 'Vacaciones'
);

select is((select (r ->> 'released_count')::int from tests_0087.res where k = 't_leave'), 3, 'licencias: el alta libera 3 asignaciones');
select is(
  (select count(*)::int from public.employee_leaves where id = (select (r -> 'leave' ->> 'id')::uuid from tests_0087.res where k = 't_leave') and created_by is not null),
  1, 'licencias: el alta crea la licencia con created_by'
);
select is(
  (select count(*)::int from public.assignments
   where id in ('f87a0000-0000-0000-0000-000000000101', 'f87a0000-0000-0000-0000-000000000103', 'f87a0000-0000-0000-0000-000000000104')
     and removed_at is not null and removed_by is not null and removed_reason = 'Licencia (Vacaciones) del 1/2 al 30/7'),
  3, 'licencias: las liberadas quedan con removed_at, removed_by y el motivo con el rango'
);
select is(
  (select count(*)::int from public.assignments
   where id in ('f87a0000-0000-0000-0000-000000000102', 'f87a0000-0000-0000-0000-000000000105', 'f87a0000-0000-0000-0000-000000000106', 'f87a0000-0000-0000-0000-000000000107')
     and removed_at is null),
  4, 'licencias: no toca la que tiene fichaje, la pasada, la del turno cancelado ni la de fuera del período'
);
select is(
  (select status::text from public.shifts where id = 'f87a0000-0000-0000-0000-000000000031'), 'scheduled',
  'licencias: el turno que queda sin dotación vuelve a scheduled'
);
select is(
  (select count(*)::int from public.attendance_notices where id = 'f87a0000-0000-0000-0000-0000000001a1' and voided_at is not null and void_reason = 'LEAVE_RELEASED'),
  1, 'licencias: se anula el aviso de la asignación liberada'
);

-- Cambio: se acorta al 7/7 (no vuelve a asignar) y se verifica el update.
select is(
  tests_0087.err(format($f$select public.save_employee_leave(%L, 'f87a0000-0000-0000-0000-0000000000a1', '2020-02-01', '2199-07-07', 'Vacaciones largas')$f$, (select r -> 'leave' ->> 'id' from tests_0087.res where k = 't_leave'))),
  null, 'licencias: el cambio de una licencia existente anda'
);
select is(
  (select ends_on::text || '/' || reason || '/' || (updated_by is not null)::text from public.employee_leaves where id = (select (r -> 'leave' ->> 'id')::uuid from tests_0087.res where k = 't_leave')),
  '2199-07-07/Vacaciones largas/true', 'licencias: el cambio guarda fechas, motivo y updated_by'
);
select is(
  (select count(*)::int from public.assignments where id = 'f87a0000-0000-0000-0000-000000000103' and removed_at is not null),
  1, 'licencias: acortar la licencia no vuelve a asignar'
);

-- Escritura directa.
select ok(
  tests_0087.err($$insert into public.employee_leaves (employee_id, starts_on) values ('f87a0000-0000-0000-0000-0000000000a3', '2199-09-01')$$) ->> 'state' = '42501',
  'licencias: el insert directo ya no está permitido (permission denied)'
);
select ok(
  tests_0087.err($$update public.employee_leaves set starts_on = '2199-01-01' where employee_id = 'f87a0000-0000-0000-0000-0000000000a1'$$) ->> 'state' = '42501',
  'licencias: el update de fechas directo ya no está permitido'
);
select is(
  tests_0087.err($$update public.employee_leaves set deleted_at = now(), updated_by = auth.uid() where id = (select id from public.employee_leaves where employee_id = 'f87a0000-0000-0000-0000-0000000000a1' limit 1)$$),
  null, 'licencias: la baja lógica sigue siendo posible'
);

-- OH-06: employee_fixed_gaps -------------------------------------------------------------------

-- Boutter es fija de S2 (lunes 9 a 13, sede 2). Un turno por motivo (lunes de agosto y setiembre).
set local role postgres;
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, created_at) values
  ('f87a0000-0000-0000-0000-000000000041', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-08-05', '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f87a0000-0000-0000-0000-000000000042', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-08-12', '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f87a0000-0000-0000-0000-000000000043', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-08-19', '09:00', '13:00', 1, 'assigned', true, now()),
  ('f87a0000-0000-0000-0000-000000000044', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-08-26', '09:00', '13:00', 1, 'scheduled', true, now()),
  ('f87a0000-0000-0000-0000-000000000045', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-09-02', '09:00', '13:00', 1, 'scheduled', true, now() - interval '1 day'),
  ('f87a0000-0000-0000-0000-000000000046', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-09-09', '09:00', '13:00', 1, 'scheduled', true, now()),
  -- cancelado: no es un hueco
  ('f87a0000-0000-0000-0000-000000000047', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-09-16', '09:00', '13:00', 1, 'scheduled', true, now()),
  -- asignada: no es un hueco
  ('f87a0000-0000-0000-0000-000000000048', 'f87a0000-0000-0000-0000-000000000022', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-09-23', '09:00', '13:00', 1, 'assigned', true, now()),
  -- manual del 12/8 de Boutter que se superpone con el turno del servicio
  ('f87a0000-0000-0000-0000-000000000049', null, 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-08-12', '10:00', '12:00', 1, 'assigned', false, now());

update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f87a0000-0000-0000-0000-000000000081', cancel_reason = 'Prueba'
where id = 'f87a0000-0000-0000-0000-000000000047';

insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f87a0000-0000-0000-0000-0000000000a2', '2199-08-05', '2199-08-05', 'Médica');

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f87a0000-0000-0000-0000-000000000151', 'f87a0000-0000-0000-0000-000000000043', 'f87a0000-0000-0000-0000-0000000000a3', 'expected'),
  ('f87a0000-0000-0000-0000-000000000152', 'f87a0000-0000-0000-0000-000000000049', 'f87a0000-0000-0000-0000-0000000000a2', 'expected'),
  ('f87a0000-0000-0000-0000-000000000153', 'f87a0000-0000-0000-0000-000000000048', 'f87a0000-0000-0000-0000-0000000000a2', 'expected');
-- Una baja lógica de Boutter en el turno del 26/8.
insert into public.assignments (id, shift_id, employee_id, status, removed_at, removed_by, removed_reason) values
  ('f87a0000-0000-0000-0000-000000000154', 'f87a0000-0000-0000-0000-000000000044', 'f87a0000-0000-0000-0000-0000000000a2', 'expected', now(), 'f87a0000-0000-0000-0000-000000000081', 'Lo sacaron a mano');

select tests_0087.as_user('test-db0087-owner@example.com');

create temp table t_gaps on commit drop as
select * from public.employee_fixed_gaps('f87a0000-0000-0000-0000-0000000000a2', '2199-08-01', '2199-09-30');
grant select on t_gaps to authenticated;

select is((select count(*)::int from t_gaps), 5, 'gaps: cinco huecos (no cuenta el cancelado, el asignado ni el que ya cubre otra persona, 0088 D-01)');
select is((select reason from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000041'), 'ON_LEAVE', 'gaps: licencia = ON_LEAVE');
select is((select detail ->> 'code' from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000041'), 'ON_LEAVE', 'gaps: ON_LEAVE trae el detalle de la licencia');
select is((select reason from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000042'), 'OVERLAP', 'gaps: otra asignación en el horario = OVERLAP');
select is(
  (select detail ->> 'conflict_shift_id' from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000042'),
  'f87a0000-0000-0000-0000-000000000049', 'gaps: OVERLAP trae el turno que choca'
);
select is((select count(*)::int from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000043'), 0, 'gaps: dotación completa con otra persona = no se lista (0088, D-01)');
select is((select reason from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000044'), 'REMOVED', 'gaps: baja lógica = REMOVED');
select is((select detail ->> 'removed_reason' from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000044'), 'Lo sacaron a mano', 'gaps: REMOVED trae el motivo de la baja');
select is((select reason from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000045'), 'ADDED_AFTER', 'gaps: fijo agregado después de crear el turno = ADDED_AFTER');
select is((select reason from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000046'), 'NOT_ASSIGNED', 'gaps: sin otra causa = NOT_ASSIGNED');
select is(
  (select calendar_color from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000046'), 3::smallint,
  'gaps: trae el color del cliente'
);
select is(
  (select client_name || '/' || site_name || '/' || service_name from t_gaps where shift_id = 'f87a0000-0000-0000-0000-000000000046'),
  'YPF 0087/Otra sede 87/S2 MAÑANA 87', 'gaps: trae cliente, sede y servicio'
);
select is(
  tests_0087.err($$select * from public.employee_fixed_gaps('f87a0000-0000-0000-0000-0000000000a2', '2199-09-30', '2199-08-01')$$) ->> 'hint',
  'INVALID_DATE_RANGE', 'gaps: rango inválido'
);
select tests_0087.as_user('test-db0087-a2@example.com');
select is(
  tests_0087.err($$select * from public.employee_fixed_gaps('f87a0000-0000-0000-0000-0000000000a2', '2199-08-01', '2199-09-30')$$) ->> 'hint',
  'FORBIDDEN', 'gaps: un empleado no los puede consultar'
);

-- OH-07: patrón fijo ---------------------------------------------------------------------------

select tests_0087.as_user('test-db0087-admin@example.com');
select is(
  (select count(*)::int from public.employee_fixed_pattern('f87a0000-0000-0000-0000-0000000000a2')), 1,
  'patrón: solo los servicios activos y vigentes (no el vencido ni el inactivo)'
);
select is(
  (select service_name || '/' || weekdays::text || '/' || start_time::text || '/' || end_time::text || '/' || calendar_color::text || '/' || site_name
   from public.employee_fixed_pattern('f87a0000-0000-0000-0000-0000000000a2')),
  'S2 MAÑANA 87/{1}/09:00:00/13:00:00/3/Otra sede 87', 'patrón: días, horario, color y sede del servicio'
);
select tests_0087.as_user('test-db0087-sup@example.com');
select is(
  tests_0087.err($$select * from public.employee_fixed_pattern('f87a0000-0000-0000-0000-0000000000a2')$$) ->> 'hint',
  'FORBIDDEN', 'patrón: un coordinador no lo consulta'
);

-- OH-07: pizarra -------------------------------------------------------------------------------

select tests_0087.as_user('test-db0087-admin@example.com');
select is(public.get_employee_week_board('f87a0000-0000-0000-0000-0000000000a2'), null, 'pizarra: sin guardar devuelve null');

select is(
  (public.save_employee_week_board(
    'f87a0000-0000-0000-0000-0000000000a2',
    '[{"id":"b1","weekday":1,"start":"09:00","end":"13:00","label":"S2","color_index":3,"service_id":"f87a0000-0000-0000-0000-000000000022","extra":"se descarta"},
      {"id":"b2","weekday":0,"start":"08:30","end":null}]'::jsonb
  ) -> 'blocks' -> 1)::text,
  '{"id": "b2", "end": null, "label": "", "start": "08:30", "weekday": 0, "color_index": null, "service_id": null}'::jsonb::text,
  'pizarra: guarda normalizado (label vacío, nulos) y descarta claves ajenas'
);
select is(
  (select (public.get_employee_week_board('f87a0000-0000-0000-0000-0000000000a2') ->> 'updated_by_name')), 'Admin Siete',
  'pizarra: la lectura trae el nombre de quien la editó'
);
select is(
  (select jsonb_array_length(blocks) from public.employee_week_boards where employee_id = 'f87a0000-0000-0000-0000-0000000000a2'), 2,
  'pizarra: se puede leer con select la tabla (admin)'
);
select is(
  tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"z","weekday":2,"start":"10:00"}]')$$),
  null, 'pizarra: guardar de nuevo reemplaza todo'
);
select is(
  (select jsonb_array_length(blocks) from public.employee_week_boards where employee_id = 'f87a0000-0000-0000-0000-0000000000a2'), 1,
  'pizarra: quedó un solo bloque'
);

-- Formas inválidas: cada una da INVALID_BOARD y no cambia lo guardado.
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '{"a":1}')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: un objeto no es un arreglo');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', null)$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: null no vale');
select is(
  tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', (select jsonb_agg(jsonb_build_object('id', 'k' || g, 'weekday', 1, 'start', '09:00')) from generate_series(1, 61) g))$$) ->> 'hint',
  'INVALID_BOARD', 'pizarra: más de 60 bloques'
);
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":7,"start":"09:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: día 7');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1.5,"start":"09:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: día decimal');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"25:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: hora de inicio 25:00');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"09:00","end":"9:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: hora de fin mal formada');
select is(tests_0087.err(format($f$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"09:00","label":"%s"}]')$f$, repeat('x', 81))) ->> 'hint', 'INVALID_BOARD', 'pizarra: texto de más de 80');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"09:00","color_index":12}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: color 12');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"09:00","service_id":"no-es-uuid"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: service_id que no es uuid');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"id":"a","weekday":1,"start":"09:00"},{"id":"a","weekday":2,"start":"09:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: ids repetidos');
select is(tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[{"weekday":1,"start":"09:00"}]')$$) ->> 'hint', 'INVALID_BOARD', 'pizarra: sin id');
select is(
  (select blocks -> 0 ->> 'id' from public.employee_week_boards where employee_id = 'f87a0000-0000-0000-0000-0000000000a2'), 'z',
  'pizarra: lo inválido no pisó lo guardado'
);
select is(
  tests_0087.err($$select public.save_employee_week_board('00000000-0000-0000-0000-0000000000ff', '[]')$$) ->> 'hint',
  'EMPLOYEE_NOT_FOUND', 'pizarra: empleado inexistente'
);

select tests_0087.as_user('test-db0087-a2@example.com');
select is(
  tests_0087.err($$select public.save_employee_week_board('f87a0000-0000-0000-0000-0000000000a2', '[]')$$) ->> 'hint',
  'FORBIDDEN', 'pizarra: un empleado no la guarda (ni la propia)'
);
select is(
  (select count(*)::int from public.employee_week_boards), 0,
  'pizarra: RLS, un empleado no ve ninguna pizarra'
);
select ok(
  tests_0087.err($$insert into public.employee_week_boards (employee_id, blocks) values ('f87a0000-0000-0000-0000-0000000000a2', '[]')$$) ->> 'state' = '42501',
  'pizarra: sin escritura directa'
);
select tests_0087.as_user('test-db0087-sup@example.com');
select is(
  tests_0087.err($$select public.get_employee_week_board('f87a0000-0000-0000-0000-0000000000a2')$$) ->> 'hint',
  'FORBIDDEN', 'pizarra: un coordinador no la lee por la RPC'
);

-- OH-10: create_shift con servicio repetido ----------------------------------------------------

select tests_0087.as_user('test-db0087-owner@example.com');
select is(
  tests_0087.err($$select public.create_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-22', '15:00', '17:00', 1::smallint, 'f87a0000-0000-0000-0000-000000000021')$$) ->> 'hint',
  'SHIFT_DATE_TAKEN', 'create_shift: servicio con turno ese día da SHIFT_DATE_TAKEN (no 23505)'
);
select is(
  (tests_0087.err($$select public.create_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-22', '15:00', '17:00', 1::smallint, 'f87a0000-0000-0000-0000-000000000021')$$) ->> 'detail')::jsonb ->> 'shift_id',
  'f87a0000-0000-0000-0000-000000000034', 'create_shift: el detail trae el turno existente'
);
select is(
  (tests_0087.err($$select public.create_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-09-23', '09:00', '13:00', 1::smallint, 'f87a0000-0000-0000-0000-000000000022')$$) ->> 'detail')::jsonb -> 'assigned' -> 0 ->> 'employee_id',
  'f87a0000-0000-0000-0000-0000000000a2', 'create_shift: el detail trae los asignados'
);
select is(
  tests_0087.err($$select public.create_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-22', '15:00', '17:00', 1::smallint, null)$$),
  null, 'create_shift: sin servicio el mismo día se puede crear (turno suelto)'
);

-- OH-09: register_past_shift -------------------------------------------------------------------

select tests_0087.as_user('test-db0087-admin-sin@example.com');
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-09', '09:00', '13:00', 1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3']::uuid[])$$) ->> 'hint',
  'FORBIDDEN', 'pasado: un administrador sin manage_attendance no puede'
);
select tests_0087.as_user('test-db0087-a3@example.com');
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-09', '09:00', '13:00', 1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3']::uuid[])$$) ->> 'hint',
  'FORBIDDEN', 'pasado: un empleado no puede'
);

select tests_0087.as_user('test-db0087-admin@example.com');
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2199-07-01', '09:00', '13:00', 1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3']::uuid[])$$) ->> 'hint',
  'SHIFT_NOT_PAST', 'pasado: un turno futuro da SHIFT_NOT_PAST'
);
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-09', '09:00', '13:00', 1::smallint, null, null, true, array[]::uuid[])$$) ->> 'hint',
  'EMPLOYEES_REQUIRED', 'pasado: sin personas da EMPLOYEES_REQUIRED'
);
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-09', '13:00', '09:00', 1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3']::uuid[])$$) ->> 'hint',
  'INVALID_TIME_RANGE', 'pasado: horario invertido'
);

-- Rollback: la segunda persona está inactiva, no queda ni el turno.
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-16', '09:00', '13:00', 2::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3', 'f87a0000-0000-0000-0000-0000000000a4']::uuid[])$$) ->> 'hint',
  'EMPLOYEE_NOT_ACTIVE', 'pasado: una persona que no se puede asignar frena todo'
);
select is(
  (tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-16', '09:00', '13:00', 2::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a3', 'f87a0000-0000-0000-0000-0000000000a4']::uuid[])$$) ->> 'message'),
  'Inactivo: Ese empleado no está activo.', 'pasado: el mensaje dice quién falló'
);
select is(
  (select count(*)::int from public.shifts where shift_date = '2020-03-16' and site_id = 'f87a0000-0000-0000-0000-000000000011')
  + (select count(*)::int from public.assignments where employee_id = 'f87a0000-0000-0000-0000-0000000000a3' and shift_date = '2020-03-16'),
  0, 'pasado: ante el error no quedó nada (ni turno ni asignación)'
);

-- Camino feliz con dos personas y un servicio.
insert into tests_0087.res (k, r)
select 't_past', public.register_past_shift(
  'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-02', '09:00', '13:00',
  2::smallint, 'f87a0000-0000-0000-0000-000000000021', 'Carga posterior de prueba', true,
  array['f87a0000-0000-0000-0000-0000000000a3', 'f87a0000-0000-0000-0000-0000000000a1']::uuid[]
);

select is((select r -> 'shift' ->> 'status' from tests_0087.res where k = 't_past'), 'completed', 'pasado: el turno queda finalizado');
select is(
  (select count(*)::int from public.assignments where shift_id = (select (r -> 'shift' ->> 'id')::uuid from tests_0087.res where k = 't_past') and status = 'finished' and removed_at is null),
  2, 'pasado: las dos asignaciones quedan finished'
);
select is(
  (select count(*)::int from public.attendance_records ar
   join public.assignments a on a.id = ar.assignment_id
   where a.shift_id = (select (r -> 'shift' ->> 'id')::uuid from tests_0087.res where k = 't_past')
     and ar.source = 'admin' and ar.reason = 'Carga posterior' and ar.recorded_by = 'f87a0000-0000-0000-0000-000000000082'),
  4, 'pasado: 4 fichajes (inicio y fin por persona), origen admin, motivo «Carga posterior» y recorded_by = quien llama'
);
select is(
  (select min(ar.recorded_at)::text || '|' || max(ar.recorded_at)::text from public.attendance_records ar
   join public.assignments a on a.id = ar.assignment_id
   where a.shift_id = (select (r -> 'shift' ->> 'id')::uuid from tests_0087.res where k = 't_past')),
  app.local_ts('2020-03-02', '09:00')::text || '|' || app.local_ts('2020-03-02', '13:00')::text,
  'pasado: inicio y fin con el horario del turno (hora de Argentina)'
);
select is(
  (select min(worked_minutes)::int || '/' || max(worked_minutes)::int from public.v_assignments_board
   where shift_id = (select (r -> 'shift' ->> 'id')::uuid from tests_0087.res where k = 't_past')),
  '240/240', 'pasado: las horas cuentan (240 minutos cada uno en v_assignments_board)'
);
select is((select r -> 'shift' ->> 'notes' from tests_0087.res where k = 't_past'), 'Carga posterior de prueba', 'pasado: guarda la observación');

-- El cierre automático y los avisos no lo tocan.
set local role postgres;
select app.auto_close_assignments(now());
select tests_0087.as_user('test-db0087-owner@example.com');
select is(
  (select count(*)::int from public.attendance_records ar
   join public.assignments a on a.id = ar.assignment_id
   where a.shift_id = (select (r -> 'shift' ->> 'id')::uuid from tests_0087.res where k = 't_past') and ar.auto_closed),
  0, 'pasado: el cierre automático no lo marca'
);

-- Superposición: Acosta ya está en el turno anterior (9 a 13): ese horario choca y no deja nada.
select tests_0087.as_user('test-db0087-admin@example.com');
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-02', '10:00', '12:00', 1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a1']::uuid[])$$) ->> 'hint',
  'ASSIGNMENT_OVERLAP', 'pasado: la superposición con otro turno es error'
);
select is(
  tests_0087.err($$select public.register_past_shift('f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-02', '15:00', '17:00', 1::smallint, 'f87a0000-0000-0000-0000-000000000021', null, true, array['f87a0000-0000-0000-0000-0000000000a2']::uuid[])$$) ->> 'hint',
  'SHIFT_DATE_TAKEN', 'pasado: el servicio ya tiene turno ese día = SHIFT_DATE_TAKEN'
);

-- Licencia en un día pasado: avisa y no bloquea.
set local role postgres;
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f87a0000-0000-0000-0000-0000000000a2', '2020-03-23', '2020-03-24', 'Estudio');
select tests_0087.as_user('test-db0087-owner@example.com');
insert into tests_0087.res (k, r)
select 't_past_leave', public.register_past_shift(
  'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000011', '2020-03-23', '09:00', '11:00',
  1::smallint, null, null, true, array['f87a0000-0000-0000-0000-0000000000a2']::uuid[]
);
select ok(
  'ON_LEAVE' = any (array(select jsonb_array_elements_text(r -> 'warnings') from tests_0087.res where k = 't_past_leave'))
    and (select r -> 'shift' ->> 'status' from tests_0087.res where k = 't_past_leave') = 'completed',
  'pasado: con licencia ese día avisa ON_LEAVE y guarda igual'
);

-- OH-11: el servicio gana sobre los cambios a mano ---------------------------------------------

set local role postgres;
-- S4 (lunes 9 a 13, dotación 1, sin fotos): tres turnos generados de octubre de 2199.
--   T1 con horario cambiado a mano (10 a 14) y una persona con franja propia;
--   T2 igual al servicio; T3 con dotación 2 y fotos a mano.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, requires_photos, status, generated) values
  ('f87a0000-0000-0000-0000-000000000061', 'f87a0000-0000-0000-0000-000000000024', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-10-07', '10:00', '14:00', 1, false, 'assigned', true),
  ('f87a0000-0000-0000-0000-000000000062', 'f87a0000-0000-0000-0000-000000000024', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-10-14', '09:00', '13:00', 1, false, 'scheduled', true),
  ('f87a0000-0000-0000-0000-000000000063', 'f87a0000-0000-0000-0000-000000000024', 'f87a0000-0000-0000-0000-000000000001', 'f87a0000-0000-0000-0000-000000000012', '2199-10-21', '09:00', '13:00', 2, true, 'scheduled', true);
insert into public.assignments (id, shift_id, employee_id, start_time, end_time, status) values
  ('f87a0000-0000-0000-0000-000000000161', 'f87a0000-0000-0000-0000-000000000061', 'f87a0000-0000-0000-0000-0000000000a3', '10:00', '12:00', 'expected');
-- El servicio cambia a 8 a 12 (el cambio ya está guardado).
update public.services set start_time = '08:00', end_time = '12:00' where id = 'f87a0000-0000-0000-0000-000000000024';

select tests_0087.as_user('test-db0087-owner@example.com');
insert into tests_0087.res (k, r)
select 't_prev_sc', public.preview_service_changes(
  'f87a0000-0000-0000-0000-000000000024', '2199-10-01',
  '{"start_time":"09:00","end_time":"13:00","open_ended":false,"required_staff":1,"requires_photos":false}'::jsonb,
  false
);

select is((select (r ->> 'updated_count')::int from tests_0087.res where k = 't_prev_sc'), 3, 'servicio: los tres turnos se actualizan (también el cambiado a mano)');
select is((select (r ->> 'overridden_count')::int from tests_0087.res where k = 't_prev_sc'), 2, 'servicio: dos tenían cambios a mano que se reemplazan (overridden_count)');
select is(
  (select jsonb_array_length(r -> 'overridden') from tests_0087.res where k = 't_prev_sc'), 2, 'servicio: overridden lista esos turnos'
);
select is(
  (select r -> 'overridden' -> 0 ->> 'shift_id' from tests_0087.res where k = 't_prev_sc'), 'f87a0000-0000-0000-0000-000000000061',
  'servicio: el primero es el del horario cambiado a mano'
);
select is(
  (select r -> 'overridden' -> 0 -> 'fields' ->> 0 from tests_0087.res where k = 't_prev_sc'), 'time', 'servicio: fields dice qué se reemplaza (time)'
);
select is(
  (select (r -> 'overridden' -> 1 -> 'fields')::text from tests_0087.res where k = 't_prev_sc'), '["required_staff", "requires_photos"]',
  'servicio: el tercero reemplaza dotación y fotos'
);
select is(
  (select count(*)::int from jsonb_array_elements((select r -> 'skipped' from tests_0087.res where k = 't_prev_sc')) s where s ->> 'code' like 'MANUAL%'),
  0, 'servicio: ya no hay notas MANUAL_*'
);
select is(
  (select start_time::text from public.shifts where id = 'f87a0000-0000-0000-0000-000000000061'), '10:00:00',
  'servicio: la vista previa no escribió nada'
);

select public.apply_service_changes(
  'f87a0000-0000-0000-0000-000000000024', '2199-10-01',
  '{"start_time":"09:00","end_time":"13:00","open_ended":false,"required_staff":1,"requires_photos":false}'::jsonb,
  false
);
select is(
  (select start_time::text || '-' || end_time::text from public.shifts where id = 'f87a0000-0000-0000-0000-000000000061'), '08:00:00-12:00:00',
  'servicio: aplicar pisa el horario cambiado a mano'
);
select is(
  (select start_time is null and end_time is null from public.assignments where id = 'f87a0000-0000-0000-0000-000000000161'), true,
  'servicio: se borra la franja propia de la persona del turno que cambió de horario'
);
select is(
  (select required_staff::text || '/' || requires_photos::text from public.shifts where id = 'f87a0000-0000-0000-0000-000000000063'), '1/false',
  'servicio: aplicar pisa dotación y fotos cambiadas a mano'
);

select * from finish();

rollback;
