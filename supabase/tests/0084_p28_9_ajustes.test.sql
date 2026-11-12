-- pgTAP de la migración 0084_p28_9_ajustes.sql (P28.9a), solo de lo que toca:
--   OF-05b  p_create_missing en preview_service_changes / apply_service_changes.
--   OF-23   move_assignment_to_new_shift (turno nuevo + pase, atómico).
--   OF-08b  detail de OF-08 en get_leave_conflicts y assign_supervision.
--   OF-22   client_service_summary trae check_out_auto_closed.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f84a0000-...'. Fechas de 2199 (el 2199-07-01 es lunes).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0084;
grant usage on schema tests_0084 to authenticated, anon;

create or replace function tests_0084.as_user(p_email text)
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
    raise exception 'tests_0084.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0084.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0084.err(p_sql text)
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

grant execute on function tests_0084.err(text) to authenticated, anon;

select plan(49);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f84a0000-0000-0000-0000-000000000001', 'Cliente 0084 SA', 'YPF 0084', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f84a0000-0000-0000-0000-000000000011', 'f84a0000-0000-0000-0000-000000000001', 'YPF RUTA', 'Dirección 84', -34.6, -58.4, 'active'),
  ('f84a0000-0000-0000-0000-000000000012', 'f84a0000-0000-0000-0000-000000000001', 'Otra sede', 'Dirección 84 bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f84a0000-0000-0000-0000-000000000081', 'test-db0084-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Cuatro')),
  ('f84a0000-0000-0000-0000-000000000082', 'test-db0084-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Cuatro')),
  ('f84a0000-0000-0000-0000-000000000091', 'test-db0084-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f84a0000-0000-0000-0000-0000000000a1', 'test-db0084-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f84a0000-0000-0000-0000-0000000000a2', 'test-db0084-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f84a0000-0000-0000-0000-0000000000a3', 'test-db0084-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera'));

insert into public.user_roles (profile_id, role) values
  ('f84a0000-0000-0000-0000-000000000081', 'owner'),
  ('f84a0000-0000-0000-0000-000000000082', 'admin'),
  ('f84a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f84a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f84a0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f84a0000-0000-0000-0000-0000000000a3', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f84a0000-0000-0000-0000-000000000091', '98404091', 'active'),
  ('f84a0000-0000-0000-0000-0000000000a1', '98404101', 'active'),
  ('f84a0000-0000-0000-0000-0000000000a2', '98404102', 'active'),
  ('f84a0000-0000-0000-0000-0000000000a3', '98404103', 'active');

-- Servicio S1 «TURNO TARDE»: lunes 15 a 17 en YPF RUTA. Turno del lunes 2199-07-01 con Acosta.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f84a0000-0000-0000-0000-000000000021', 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', 'YPF RUTA TURNO TARDE', array[1]::smallint[], '15:00', '17:00', 1, '2199-01-01', 'active');
-- Servicio S2 (OF-05b): lunes 9 a 13 en la otra sede, con turnos generados el 1/7 y el 8/7.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f84a0000-0000-0000-0000-000000000022', 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000012', 'Servicio 0084 mañana', array[1]::smallint[], '09:00', '13:00', 1, '2199-01-01', 'active');

insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f84a0000-0000-0000-0000-000000000031', 'f84a0000-0000-0000-0000-000000000021', 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', '2199-07-01', '15:00', '17:00', 1, 'assigned', true),
  ('f84a0000-0000-0000-0000-000000000032', 'f84a0000-0000-0000-0000-000000000022', 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000012', '2199-07-01', '09:00', '13:00', 1, 'scheduled', true),
  ('f84a0000-0000-0000-0000-000000000033', 'f84a0000-0000-0000-0000-000000000022', 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000012', '2199-07-08', '09:00', '13:00', 1, 'scheduled', true),
  -- manual del 5/7 (viernes) con Boutter, que está de licencia del 3 al 10/7, y uno sin asignar (supervisión)
  ('f84a0000-0000-0000-0000-000000000034', null, 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', '2199-07-05', '09:00', '10:00', 1, 'assigned', false),
  ('f84a0000-0000-0000-0000-000000000035', null, 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', '2199-07-05', '11:00', '12:00', 1, 'scheduled', false),
  -- manual del 15/7 con Acosta de 16 a 18 (para chocar con el pase del turno tarde)
  ('f84a0000-0000-0000-0000-000000000036', null, 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', '2199-07-15', '16:00', '18:00', 1, 'assigned', false),
  -- manual del 22/7 completado, con un fin cerrado automáticamente (OF-22)
  ('f84a0000-0000-0000-0000-000000000037', null, 'f84a0000-0000-0000-0000-000000000001', 'f84a0000-0000-0000-0000-000000000011', '2199-07-22', '09:00', '13:00', 1, 'completed', false);

insert into public.assignments (id, shift_id, employee_id) values
  ('f84a0000-0000-0000-0000-000000000101', 'f84a0000-0000-0000-0000-000000000031', 'f84a0000-0000-0000-0000-0000000000a1'),
  ('f84a0000-0000-0000-0000-000000000102', 'f84a0000-0000-0000-0000-000000000034', 'f84a0000-0000-0000-0000-0000000000a2'),
  ('f84a0000-0000-0000-0000-000000000103', 'f84a0000-0000-0000-0000-000000000036', 'f84a0000-0000-0000-0000-0000000000a1'),
  ('f84a0000-0000-0000-0000-000000000104', 'f84a0000-0000-0000-0000-000000000037', 'f84a0000-0000-0000-0000-0000000000a3');

insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10', 'Vacaciones'),
  ('f84a0000-0000-0000-0000-000000000091', '2199-07-03', '2199-07-10', 'Estudio');

insert into public.attendance_records (id, assignment_id, kind, recorded_at, source, recorded_by, reason, geo_status, geo_unvalidated_reason, auto_closed) values
  ('f84a0000-0000-0000-0000-000000000201', 'f84a0000-0000-0000-0000-000000000104', 'check_in', app.local_ts('2199-07-22', '09:00'), 'admin', null, 'Fichaje de prueba', 'unvalidated', 'admin_record', false),
  ('f84a0000-0000-0000-0000-000000000202', 'f84a0000-0000-0000-0000-000000000104', 'check_out', app.local_ts('2199-07-22', '13:00'), 'admin', null, 'Cierre automático de prueba', 'unvalidated', 'admin_record', true);

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'preview_service_changes', array['uuid', 'date', 'jsonb', 'boolean'], 'preview_service_changes con p_create_missing');
select has_function('public', 'apply_service_changes', array['uuid', 'date', 'jsonb', 'boolean'], 'apply_service_changes con p_create_missing');
select hasnt_function('public', 'apply_service_changes', array['uuid', 'date', 'jsonb'], 'no queda la firma vieja de apply_service_changes');
select hasnt_function('public', 'preview_service_changes', array['uuid', 'date', 'jsonb'], 'no queda la firma vieja de preview_service_changes');
select has_function('public', 'move_assignment_to_new_shift', array['uuid', 'date', 'time', 'time'], 'move_assignment_to_new_shift');
select ok(
  not has_function_privilege('anon', 'public.move_assignment_to_new_shift(uuid, date, time, time)', 'execute')
  and has_function_privilege('authenticated', 'public.move_assignment_to_new_shift(uuid, date, time, time)', 'execute')
  and not has_function_privilege('anon', 'public.preview_service_changes(uuid, date, jsonb, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.preview_service_changes(uuid, date, jsonb, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'app.service_changes_run(uuid, date, jsonb, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'app.shift_brief(uuid, uuid)', 'execute'),
  'grants: las RPC solo para authenticated; las ayudas internas de app no'
);

-- OF-05b: p_create_missing ---------------------------------------------------------------------

select tests_0084.as_user('test-db0084-admin@example.com');

select is(
  (select (public.preview_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01') ->> 'created_count')::int),
  3, 'vista previa sin p_create_missing: 3 turnos faltantes (15, 22 y 29/7)'
);
select is(
  (select (public.preview_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01', null, false) ->> 'created_count')::int),
  0, 'vista previa con p_create_missing = false: no genera ninguno'
);
select is(
  (select jsonb_array_length(public.preview_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01', null, false) -> 'created')),
  0, 'y la lista created queda vacía'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'f84a0000-0000-0000-0000-000000000022' and deleted_at is null),
  2, 'las vistas previas no dejan nada escrito'
);

select is(
  (select (public.apply_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01', null, false) ->> 'created_count')::int),
  0, 'aplicar con p_create_missing = false: no crea turnos'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'f84a0000-0000-0000-0000-000000000022' and deleted_at is null),
  2, 'el servicio sigue con sus 2 turnos'
);
select is(
  (select (public.apply_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01') ->> 'created_count')::int),
  3, 'aplicar sin el parámetro (default true): crea los 3 que faltan'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'f84a0000-0000-0000-0000-000000000022' and deleted_at is null),
  5, 'el servicio queda con 5 turnos'
);

select is(tests_0084.err($$select public.apply_service_changes('f84a0000-0000-0000-0000-000000000022', null, null, false)$$) ->> 'hint', 'FROM_DATE_REQUIRED', 'sin fecha: FROM_DATE_REQUIRED');

select tests_0084.as_user('test-db0084-sup@example.com');
select is(tests_0084.err($$select public.apply_service_changes('f84a0000-0000-0000-0000-000000000022', '2199-07-01', null, false)$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no aplica cambios del servicio');

-- OF-23: move_assignment_to_new_shift --------------------------------------------------------------

select tests_0084.as_user('test-db0084-sup@example.com');
select is(tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', '2199-07-08', '15:00', '17:00')$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no pasa a nadie a un turno nuevo');
select tests_0084.as_user('test-db0084-a1@example.com');
select is(tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', '2199-07-08', '15:00', '17:00')$$) ->> 'hint', 'FORBIDDEN', 'un empleado tampoco');

select tests_0084.as_user('test-db0084-admin@example.com');
select is(tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-0000000000ff', '2199-07-08', '15:00', '17:00')$$) ->> 'hint', 'ASSIGNMENT_NOT_FOUND', 'una asignación inexistente');
select is(tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', '2199-07-08', '17:00', '15:00')$$) ->> 'hint', 'INVALID_TIME_RANGE', 'fin anterior al inicio: INVALID_TIME_RANGE');
select is(tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', null, '15:00', '17:00')$$) ->> 'hint', 'INVALID_TIME_RANGE', 'sin fecha: INVALID_TIME_RANGE');

-- Superposición: Acosta ya está el 15/7 de 16 a 18. No queda turno nuevo ni se mueve nada.
select set_config('tests_0084.e1', tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', '2199-07-15', '15:00', '17:00')$$)::text, true) is not null as e1;
select is((select current_setting('tests_0084.e1')::jsonb ->> 'hint'), 'ASSIGNMENT_OVERLAP', 'pasar a alguien a un horario que se pisa: ASSIGNMENT_OVERLAP');
select is(
  (select ((current_setting('tests_0084.e1')::jsonb ->> 'detail')::jsonb) ->> 'conflict_shift_id'),
  'f84a0000-0000-0000-0000-000000000036', 'el detalle trae el turno con el que choca'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'f84a0000-0000-0000-0000-000000000021' and shift_date = '2199-07-15'),
  0, 'si falla el pase no queda el turno nuevo'
);
select is(
  (select removed_at is null from public.assignments where id = 'f84a0000-0000-0000-0000-000000000101'),
  true, 'y la asignación original sigue vigente'
);

-- Licencia: Boutter está de licencia del 3 al 10/7.
select is(
  tests_0084.err($$select public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000102', '2199-07-06', '09:00', '10:00')$$) ->> 'hint',
  'ON_LEAVE', 'pasar a alguien de licencia: ON_LEAVE'
);
select is(
  (select count(*)::int from public.shifts where shift_date = '2199-07-06' and client_id = 'f84a0000-0000-0000-0000-000000000001'),
  0, 'sin turno nuevo si falla por licencia'
);

-- Camino feliz.
select set_config('tests_0084.r', public.move_assignment_to_new_shift('f84a0000-0000-0000-0000-000000000101', '2199-07-08', '15:00', '17:00')::text, true) is not null as r;
select ok((select current_setting('tests_0084.r')::jsonb ? 'shift_id' and current_setting('tests_0084.r')::jsonb ? 'assignment_id'), 'devuelve shift_id y assignment_id');
select is(
  (select s.service_id from public.shifts s where s.id = (current_setting('tests_0084.r')::jsonb ->> 'shift_id')::uuid),
  'f84a0000-0000-0000-0000-000000000021'::uuid, 'otra fecha sin turno del servicio: el turno nuevo conserva el servicio'
);
select is(
  (select s.site_id from public.shifts s where s.id = (current_setting('tests_0084.r')::jsonb ->> 'shift_id')::uuid),
  'f84a0000-0000-0000-0000-000000000011'::uuid, 'y de la misma sede'
);
select is(
  (select s.shift_date::text || ' ' || s.start_time::text || '-' || s.end_time::text || ' ' || s.required_staff::text
   from public.shifts s where s.id = (current_setting('tests_0084.r')::jsonb ->> 'shift_id')::uuid),
  '2199-07-08 15:00:00-17:00:00 1', 'con la fecha, el horario y la dotación pedidos'
);
select is(
  (select s.generated from public.shifts s where s.id = (current_setting('tests_0084.r')::jsonb ->> 'shift_id')::uuid),
  false, 'es un turno manual (generated = false)'
);
select is(
  (select a.employee_id from public.assignments a where a.id = (current_setting('tests_0084.r')::jsonb ->> 'assignment_id')::uuid and a.removed_at is null),
  'f84a0000-0000-0000-0000-0000000000a1'::uuid, 'la persona queda asignada en el turno nuevo'
);
select is(
  (select removed_at is not null from public.assignments where id = 'f84a0000-0000-0000-0000-000000000101'),
  true, 'y la asignación de origen quedó quitada'
);
select is(
  (current_setting('tests_0084.r')::jsonb -> 'previous' ->> 'shift_id'),
  'f84a0000-0000-0000-0000-000000000031', 'previous trae el turno de origen para deshacer'
);

-- Mismo día que el turno de origen: el servicio ya tiene turno ese día, así que el turno nuevo
-- nace sin servicio (manual), del mismo cliente y sede. La persona ya está en el turno del 8/7.
select set_config('tests_0084.r2', public.move_assignment_to_new_shift((current_setting('tests_0084.r')::jsonb ->> 'assignment_id')::uuid, '2199-07-08', '18:00', '20:00')::text, true) is not null as r2;
select is(
  (select s.service_id from public.shifts s where s.id = (current_setting('tests_0084.r2')::jsonb ->> 'shift_id')::uuid),
  null::uuid, 'mismo día que un turno del servicio: el turno nuevo queda sin servicio'
);
select is(
  (select s.site_id::text || '|' || s.client_id::text || '|' || s.shift_date::text || '|' || s.generated::text
   from public.shifts s where s.id = (current_setting('tests_0084.r2')::jsonb ->> 'shift_id')::uuid),
  'f84a0000-0000-0000-0000-000000000011|f84a0000-0000-0000-0000-000000000001|2199-07-08|false',
  'del mismo cliente y sede, el mismo día, manual'
);
select is(
  (select a.employee_id from public.assignments a where a.id = (current_setting('tests_0084.r2')::jsonb ->> 'assignment_id')::uuid and a.removed_at is null),
  'f84a0000-0000-0000-0000-0000000000a1'::uuid, 'y la persona queda asignada en él'
);

-- OF-08b: get_leave_conflicts ------------------------------------------------------------------------

select is(
  (select count(*)::int from public.get_leave_conflicts('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10')),
  1, 'get_leave_conflicts: el turno del 5/7 de Boutter'
);
select is(
  (select shift_id from public.get_leave_conflicts('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10')),
  'f84a0000-0000-0000-0000-000000000034'::uuid, 'sigue trayendo shift_id'
);
select is(
  (select detail ->> 'shift_id' from public.get_leave_conflicts('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10')),
  'f84a0000-0000-0000-0000-000000000034', 'detail trae el shift_id'
);
select is(
  (select detail ->> 'message' from public.get_leave_conflicts('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10')),
  'Boutter ya está en YPF RUTA (turno manual) el vie 5/7 de 09:00 a 10:00.',
  'detail trae el mensaje de OF-08 (sede, servicio, día y horario)'
);
select is(
  (select (detail ->> 'site_name') || '|' || (detail ->> 'shift_date') || '|' || (detail ->> 'start_time') || '|' || (detail ->> 'end_time')
   from public.get_leave_conflicts('f84a0000-0000-0000-0000-0000000000a2', '2199-07-03', '2199-07-10')),
  'YPF RUTA|2199-07-05|09:00:00|10:00:00', 'detail trae sede, fecha y horario'
);

-- OF-08b: assign_supervision --------------------------------------------------------------------------

-- Desde 0063 authenticated no ejecuta assign_supervision: se corre con la sesión del dueño pero
-- con el rol de base postgres.
select tests_0084.as_user('test-db0084-owner@example.com');
set local role postgres;
select set_config('tests_0084.s', tests_0084.err($$select public.assign_supervision('f84a0000-0000-0000-0000-000000000035', 'f84a0000-0000-0000-0000-000000000091')$$)::text, true) is not null as s;
select is((select current_setting('tests_0084.s')::jsonb ->> 'hint'), 'ON_LEAVE', 'asignar un coordinador de licencia: ON_LEAVE');
select is(
  (select current_setting('tests_0084.s')::jsonb ->> 'message'),
  'Supervisora tiene licencia (Estudio) del 3 al 10/7.', 'el mensaje dice la licencia'
);
select is(
  (select ((current_setting('tests_0084.s')::jsonb ->> 'detail')::jsonb) ->> 'shift_id'),
  'f84a0000-0000-0000-0000-000000000035', 'el detail trae el shift_id del turno'
);
select is(
  (select ((current_setting('tests_0084.s')::jsonb ->> 'detail')::jsonb) ->> 'site_name') || '|'
    || (select ((current_setting('tests_0084.s')::jsonb ->> 'detail')::jsonb) ->> 'shift_date') || '|'
    || (select ((current_setting('tests_0084.s')::jsonb ->> 'detail')::jsonb) ->> 'start_time'),
  'YPF RUTA|2199-07-05|11:00:00', 'y la sede, la fecha y el horario'
);
select is(
  (select ((current_setting('tests_0084.s')::jsonb ->> 'detail')::jsonb) -> 'leaves' -> 0 ->> 'reason'),
  'Estudio', 'y la licencia'
);

-- OF-22: client_service_summary -------------------------------------------------------------------------

select tests_0084.as_user('test-db0084-admin@example.com');
select is(
  (select e ->> 'check_out_auto_closed'
   from jsonb_array_elements(public.client_service_summary('f84a0000-0000-0000-0000-000000000001', '2199-07-22', '2199-07-22') -> 'shifts') s,
        jsonb_array_elements(s -> 'employees') e
   where e ->> 'employee_id' = 'f84a0000-0000-0000-0000-0000000000a3'),
  'true', 'el resumen del cliente marca el fin cerrado automáticamente'
);

select * from finish();

rollback;
