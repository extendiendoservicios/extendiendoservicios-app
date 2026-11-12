-- pgTAP de la migración 0082_p28_1_observaciones_11_nov.sql (P28.1), parte 1:
--   OF-19  feriados: unicidad solo entre los vigentes y upsert_holiday (reactiva una fecha dada de baja).
--   OF-19b holiday_shift_conflicts y remove_holiday_shifts.
--   OF-04b cancel_shift libera a los empleados sin fichajes (desde 0083 con released_at; la corrección de datos está en 0083_p28_1b_turno_cancelado_libera.test.sql).
--   OF-20  licencias superpuestas permitidas y app.leave_conflict (motivo y rango).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f82a0000-...'. Las fechas son de 2199 para no chocar con datos reales; el
-- resultado no depende de la hora a la que corra.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0082a;
grant usage on schema tests_0082a to authenticated, anon;

create or replace function tests_0082a.as_user(p_email text)
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
    raise exception 'tests_0082a.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0082a.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0082a.err(p_sql text)
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

grant execute on function tests_0082a.err(text) to authenticated, anon;

select plan(44);

-- Estructura -----------------------------------------------------------------------------------

select has_index('public', 'holidays', 'holidays_holiday_date_active_key', 'holidays: índice único parcial por fecha');
select hasnt_index('public', 'employee_leaves', 'employee_leaves_no_overlap', 'employee_leaves: ya no hay exclusión de superposición');
select has_function('public', 'upsert_holiday', array['date', 'text'], 'upsert_holiday');
select has_function('public', 'holiday_shift_conflicts', array['date'], 'holiday_shift_conflicts');
select has_function('public', 'remove_holiday_shifts', array['date'], 'remove_holiday_shifts');
select ok(
  not has_function_privilege('anon', 'public.upsert_holiday(date, text)', 'execute')
  and has_function_privilege('authenticated', 'public.upsert_holiday(date, text)', 'execute')
  and not has_function_privilege('anon', 'public.remove_holiday_shifts(date)', 'execute'),
  'grants: authenticated sí, anon no'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f82a0000-0000-0000-0000-000000000001', 'Cliente 0082a', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f82a0000-0000-0000-0000-000000000011', 'f82a0000-0000-0000-0000-000000000001', 'Sede 0082a', 'Dirección 82a', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f82a0000-0000-0000-0000-000000000081', 'test-db0082a-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Uno')),
  ('f82a0000-0000-0000-0000-000000000082', 'test-db0082a-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCapacidad')),
  ('f82a0000-0000-0000-0000-000000000083', 'test-db0082a-admin2@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f82a0000-0000-0000-0000-000000000091', 'test-db0082a-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Uno')),
  ('f82a0000-0000-0000-0000-0000000000a1', 'test-db0082a-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f82a0000-0000-0000-0000-0000000000a2', 'test-db0082a-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Benítez'));

insert into public.user_roles (profile_id, role) values
  ('f82a0000-0000-0000-0000-000000000081', 'owner'),
  ('f82a0000-0000-0000-0000-000000000082', 'admin'),
  ('f82a0000-0000-0000-0000-000000000083', 'admin'),
  ('f82a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f82a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f82a0000-0000-0000-0000-0000000000a2', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f82a0000-0000-0000-0000-000000000091', '98201091', 'active'),
  ('f82a0000-0000-0000-0000-0000000000a1', '98201101', 'active'),
  ('f82a0000-0000-0000-0000-0000000000a2', '98201102', 'active');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f82a0000-0000-0000-0000-000000000082', 'cancel_shifts', true);

-- Feriados (OF-19) -----------------------------------------------------------------------------

-- Un feriado dado de baja (como el «VI» del 11/11) y dos bajas de otra fecha con uno vigente.
insert into public.holidays (id, holiday_date, name, deleted_at) values
  ('f82a0000-0000-0000-0000-0000000000b1', '2199-12-25', 'VI (dado de baja)', now());

select lives_ok(
  $$insert into public.holidays (id, holiday_date, name, deleted_at) values
      ('f82a0000-0000-0000-0000-0000000000b2', '2199-12-26', 'Baja 1', now()),
      ('f82a0000-0000-0000-0000-0000000000b3', '2199-12-26', 'Baja 2', now()),
      ('f82a0000-0000-0000-0000-0000000000b4', '2199-12-26', 'Vigente', null)$$,
  'la fecha es única solo entre los vigentes: varias bajas y un vigente conviven'
);

select is(
  (select tests_0082a.err($$insert into public.holidays (holiday_date, name) values ('2199-12-26', 'Duplicado vigente')$$) ->> 'state'),
  '23505', 'dos feriados vigentes con la misma fecha siguen rechazados'
);

select tests_0082a.as_user('test-db0082a-admin@example.com');
select is(tests_0082a.err($$select public.upsert_holiday('2199-12-27', 'Feriado')$$) ->> 'hint', 'FORBIDDEN', 'un administrador no da de alta feriados (solo el dueño)');
select tests_0082a.as_user('test-db0082a-a1@example.com');
select is(tests_0082a.err($$select public.upsert_holiday('2199-12-27', 'Feriado')$$) ->> 'hint', 'FORBIDDEN', 'un empleado no da de alta feriados');
select tests_0082a.as_user('test-db0082a-sup@example.com');
select is(tests_0082a.err($$select public.upsert_holiday('2199-12-27', 'Feriado')$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no da de alta feriados');

select tests_0082a.as_user('test-db0082a-owner@example.com');
select is(tests_0082a.err($$select public.upsert_holiday(null, 'Feriado')$$) ->> 'hint', 'HOLIDAY_DATE_REQUIRED', 'la fecha es obligatoria');
select is(tests_0082a.err($$select public.upsert_holiday('2199-12-27', '   ')$$) ->> 'hint', 'HOLIDAY_NAME_REQUIRED', 'el nombre es obligatorio');

select set_config('tests_0082a.r', public.upsert_holiday('2199-12-25', 'Navidad')::text, true) is not null as reactivado;
select is((select current_setting('tests_0082a.r')::jsonb ->> 'action'), 'reactivated', 'sobre una fecha dada de baja: la reactiva');
select is((select current_setting('tests_0082a.r')::jsonb -> 'holiday' ->> 'id'), 'f82a0000-0000-0000-0000-0000000000b1', 'reactiva la misma fila');
select is((select current_setting('tests_0082a.r')::jsonb -> 'holiday' ->> 'name'), 'Navidad', 'con el nombre nuevo');
select is((select current_setting('tests_0082a.r')::jsonb -> 'holiday' ->> 'deleted_at'), null, 'y sin baja');

select is((select public.upsert_holiday('2199-12-28', 'Feriado puente') ->> 'action'), 'created', 'sobre una fecha sin feriado: lo crea');
select is((select public.upsert_holiday('2199-12-28', 'Feriado puente') ->> 'action'), 'unchanged', 'si ya existe igual: sin cambios');
select is((select public.upsert_holiday('2199-12-28', 'Feriado puente 2') ->> 'action'), 'updated', 'si ya existe con otro nombre: lo renombra');

set local role postgres;
select is(
  (select count(*)::int from public.holidays where holiday_date = '2199-12-25' and deleted_at is null),
  1, 'queda un solo feriado vigente en la fecha reactivada'
);

-- Turnos de un feriado (OF-19b) ----------------------------------------------------------------

-- Feriado vigente el lunes 2199-07-08. Cuatro servicios con turno ese día: sin historia, con
-- historia, creado a mano y uno que sí trabaja feriados.
insert into public.holidays (id, holiday_date, name) values
  ('f82a0000-0000-0000-0000-0000000000b5', '2199-07-08', 'Feriado de prueba');

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, works_on_holidays, status) values
  ('f82a0000-0000-0000-0000-000000000021', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', 'Sin historia', array[1]::smallint[], '08:00', '10:00', 1, '2199-01-01', false, 'active'),
  ('f82a0000-0000-0000-0000-000000000022', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', 'Con historia', array[1]::smallint[], '11:00', '12:00', 1, '2199-01-01', false, 'active'),
  ('f82a0000-0000-0000-0000-000000000023', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', 'Creado a mano', array[1]::smallint[], '13:00', '14:00', 1, '2199-01-01', false, 'active'),
  ('f82a0000-0000-0000-0000-000000000024', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', 'Trabaja feriados', array[1]::smallint[], '15:00', '16:00', 1, '2199-01-01', true, 'active');

insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f82a0000-0000-0000-0000-000000000031', 'f82a0000-0000-0000-0000-000000000021', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-08', '08:00', '10:00', 1, 'scheduled', true),
  ('f82a0000-0000-0000-0000-000000000032', 'f82a0000-0000-0000-0000-000000000022', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-08', '11:00', '12:00', 1, 'scheduled', true),
  ('f82a0000-0000-0000-0000-000000000033', 'f82a0000-0000-0000-0000-000000000023', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-08', '13:00', '14:00', 1, 'scheduled', false),
  ('f82a0000-0000-0000-0000-000000000034', 'f82a0000-0000-0000-0000-000000000024', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-08', '15:00', '16:00', 1, 'scheduled', true);

insert into public.assignments (id, shift_id, employee_id) values
  ('f82a0000-0000-0000-0000-000000000101', 'f82a0000-0000-0000-0000-000000000031', 'f82a0000-0000-0000-0000-0000000000a1'),
  ('f82a0000-0000-0000-0000-000000000102', 'f82a0000-0000-0000-0000-000000000032', 'f82a0000-0000-0000-0000-0000000000a2');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f82a0000-0000-0000-0000-000000000102', 'check_in', now(), 'employee_app');

select tests_0082a.as_user('test-db0082a-sup@example.com');
select is(tests_0082a.err($$select public.holiday_shift_conflicts('2199-07-08')$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no consulta los turnos del feriado');

select tests_0082a.as_user('test-db0082a-admin2@example.com');
select set_config('tests_0082a.c', public.holiday_shift_conflicts('2199-07-08')::text, true) is not null as consultado;
select is((select current_setting('tests_0082a.c')::jsonb ->> 'is_holiday'), 'true', 'informa que la fecha es feriado');
select is((select current_setting('tests_0082a.c')::jsonb ->> 'deletable_count'), '1', 'un turno se puede borrar (sin historia)');
select is((select current_setting('tests_0082a.c')::jsonb ->> 'with_history_count'), '1', 'uno tiene historia');
select is(
  (select array_agg(s ->> 'service_name' order by s ->> 'service_name') from jsonb_array_elements(current_setting('tests_0082a.c')::jsonb -> 'shifts') s),
  array['Con historia', 'Sin historia'],
  'lista solo los turnos generados de servicios que no trabajan feriados (ni el creado a mano ni el que sí trabaja)'
);

select is(tests_0082a.err($$select public.remove_holiday_shifts('2199-07-08')$$) ->> 'hint', 'FORBIDDEN', 'un administrador sin cancel_shifts no borra los turnos del feriado');

select tests_0082a.as_user('test-db0082a-admin@example.com');
select is(tests_0082a.err($$select public.remove_holiday_shifts('2199-07-09')$$) ->> 'hint', 'NOT_A_HOLIDAY', 'una fecha sin feriado vigente no se puede limpiar');
select set_config('tests_0082a.d', public.remove_holiday_shifts('2199-07-08')::text, true) is not null as borrado;
select is((select current_setting('tests_0082a.d')::jsonb -> 'deleted' ->> 'shifts'), '1', 'borra el turno sin historia');
select is((select current_setting('tests_0082a.d')::jsonb -> 'deleted' ->> 'assignments'), '1', 'con su asignación');
select is((select current_setting('tests_0082a.d')::jsonb ->> 'skipped_count'), '1', 'saltea el que tiene historia');
select isnt((select current_setting('tests_0082a.d')::jsonb ->> 'event_id'), null, 'deja un evento record_deleted');

set local role postgres;
select is(
  (select array_agg(id::text order by id) from public.shifts where shift_date = '2199-07-08' and id::text like 'f82a0000%'),
  array['f82a0000-0000-0000-0000-000000000032', 'f82a0000-0000-0000-0000-000000000033', 'f82a0000-0000-0000-0000-000000000034'],
  'quedan el turno con historia, el creado a mano y el del servicio que trabaja feriados'
);

-- cancel_shift libera a los empleados (OF-04b) --------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82a0000-0000-0000-0000-000000000041', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-15', '09:00', '11:00', 2, 'assigned'),
  ('f82a0000-0000-0000-0000-000000000042', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-15', '09:00', '11:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('f82a0000-0000-0000-0000-000000000111', 'f82a0000-0000-0000-0000-000000000041', 'f82a0000-0000-0000-0000-0000000000a1'),
  ('f82a0000-0000-0000-0000-000000000112', 'f82a0000-0000-0000-0000-000000000041', 'f82a0000-0000-0000-0000-0000000000a2');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f82a0000-0000-0000-0000-000000000112', 'check_in', now(), 'employee_app');

select tests_0082a.as_user('test-db0082a-admin2@example.com');
select is(tests_0082a.err($$select public.cancel_shift('f82a0000-0000-0000-0000-000000000041', 'Prueba')$$) ->> 'hint', 'FORBIDDEN', 'cancel_shift sigue pidiendo cancel_shifts');

select tests_0082a.as_user('test-db0082a-admin@example.com');
select lives_ok(
  $$select public.cancel_shift('f82a0000-0000-0000-0000-000000000041', 'El cliente suspendió')$$,
  'se cancela el turno'
);

set local role postgres;
select is(
  (select released_at is not null and removed_at is null from public.assignments where id = 'f82a0000-0000-0000-0000-000000000111'),
  true, 'la asignación sin fichajes queda liberada (released_at, 0083) y sigue vigente (removed_at nulo)'
);
select is(
  (select released_by from public.assignments where id = 'f82a0000-0000-0000-0000-000000000111'),
  'f82a0000-0000-0000-0000-000000000082'::uuid, 'quedó registrado quién la liberó'
);
select is(
  (select removed_at is null from public.assignments where id = 'f82a0000-0000-0000-0000-000000000112'),
  true, 'la asignación con fichaje se conserva como historia (sin liberar)'
);

select tests_0082a.as_user('test-db0082a-admin@example.com');
select lives_ok(
  $$select public.assign_employee('f82a0000-0000-0000-0000-000000000042', 'f82a0000-0000-0000-0000-0000000000a1')$$,
  'el empleado liberado se puede asignar a otro turno en el mismo horario'
);

-- La corrección de los datos (0083) es idempotente: se vuelve a correr la misma sentencia.
set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, cancelled_at, cancelled_by, cancel_reason) values
  ('f82a0000-0000-0000-0000-000000000043', 'f82a0000-0000-0000-0000-000000000001', 'f82a0000-0000-0000-0000-000000000011', '2199-07-22', '09:00', '11:00', 1, 'cancelled', now(), 'f82a0000-0000-0000-0000-000000000081', 'Cancelado antes');
insert into public.assignments (id, shift_id, employee_id) values
  ('f82a0000-0000-0000-0000-000000000113', 'f82a0000-0000-0000-0000-000000000043', 'f82a0000-0000-0000-0000-0000000000a1');

update public.assignments a
set released_at = now(), released_by = sh.cancelled_by
from public.shifts sh
where sh.id = a.shift_id
  and sh.status = 'cancelled'
  and sh.cancelled_by is not null
  and a.removed_at is null
  and a.released_at is null
  and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

select is(
  (select released_at is not null and removed_at is null from public.assignments where id = 'f82a0000-0000-0000-0000-000000000113'),
  true, 'la asignación viva de un turno ya cancelado queda liberada'
);

-- Licencias superpuestas (OF-20) ------------------------------------------------------------------

select lives_ok(
  $$insert into public.employee_leaves (id, employee_id, starts_on, ends_on, reason) values
      ('f82a0000-0000-0000-0000-0000000000c1', 'f82a0000-0000-0000-0000-0000000000a1', '2199-08-03', '2199-08-10', 'Vacaciones'),
      ('f82a0000-0000-0000-0000-0000000000c2', 'f82a0000-0000-0000-0000-0000000000a1', '2199-08-08', '2199-08-12', 'Enfermedad')$$,
  'se pueden cargar dos licencias del mismo empleado que se pisan'
);

select is(
  app.leave_conflict('f82a0000-0000-0000-0000-0000000000a1', '2199-08-05') ->> 'message',
  'Acosta tiene licencia (Vacaciones) del 3 al 10/8.',
  'el mensaje dice el apellido, el motivo y el rango'
);
select is(
  app.leave_conflict('f82a0000-0000-0000-0000-0000000000a1', '2199-08-09') ->> 'message',
  'Acosta tiene licencia (Vacaciones) del 3 al 10/8 y (Enfermedad) del 8 al 12/8.',
  'si hay dos licencias el mismo día se muestran las dos'
);
select is(app.leave_conflict('f82a0000-0000-0000-0000-0000000000a1', '2199-08-20'), null, 'sin licencia ese día no hay conflicto');

select * from finish();

rollback;
