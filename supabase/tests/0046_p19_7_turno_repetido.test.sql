-- pgTAP de la migración 0046_p19_7_turno_repetido.sql (P19.7 paquete R, AJ3-08):
--   shifts.series_id, create_shift (sin cambios de comportamiento), preview_shift_series y
--   create_shift_series (regla de fechas, tope de 3 meses, feriados, todo o nada, asignados y
--   rechazados, permisos).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f4600000-...'. Período de prueba: abril a junio de 2199 (lunes de abril: 1, 8,
-- 15, 22 y 29), fuera del uso real.

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

select plan(50);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'shifts', 'series_id', 'shifts.series_id existe');
select col_type_is('public', 'shifts', 'series_id', 'uuid', 'series_id es uuid');
select col_is_null('public', 'shifts', 'series_id', 'series_id admite null');
select has_index('public', 'shifts', 'shifts_series_id_idx', 'índice parcial por series_id');
select has_function('public', 'create_shift_series', array['uuid', 'uuid', 'time without time zone', 'time without time zone', 'smallint', 'date', 'date', 'smallint[]', 'smallint[]', 'boolean', 'text', 'boolean', 'boolean', 'uuid[]', 'boolean'], 'existe create_shift_series');
select has_function('public', 'preview_shift_series', array['date', 'date', 'smallint[]', 'smallint[]', 'boolean'], 'existe preview_shift_series');
select ok(
  has_function_privilege('authenticated', 'public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.preview_shift_series(date, date, smallint[], smallint[], boolean)', 'execute')
    and not has_function_privilege('anon', 'public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean)', 'execute')
    and not has_function_privilege('anon', 'public.preview_shift_series(date, date, smallint[], smallint[], boolean)', 'execute')
    and not has_function_privilege('authenticated', 'app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid, boolean)', 'execute')
    and not has_function_privilege('authenticated', 'app.shift_series_dates(date, date, smallint[], smallint[])', 'execute'),
  'grants: las RPC para authenticated y no para anon; los helpers internos no se llaman desde afuera'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f4600000-0000-0000-0000-000000000001', 'Cliente de repetición 0046', 'active'),
  ('f4600000-0000-0000-0000-000000000002', 'Cliente suspendido 0046', 'suspended');
insert into public.sites (id, client_id, name, address, status) values
  ('f4600000-0000-0000-0000-000000000011', 'f4600000-0000-0000-0000-000000000001', 'Sede de repetición 0046', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f4600000-0000-0000-0000-000000000081', 'test-db046-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Repite')),
  ('f4600000-0000-0000-0000-000000000082', 'test-db046-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('f4600000-0000-0000-0000-000000000083', 'test-db046-admin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCapacidad')),
  ('f4600000-0000-0000-0000-000000000084', 'test-db046-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('f4600000-0000-0000-0000-000000000085', 'test-db046-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('f4600000-0000-0000-0000-000000000091', 'test-db046-ea@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Libre')),
  ('f4600000-0000-0000-0000-000000000092', 'test-db046-eb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Ocupado'));

insert into public.user_roles (profile_id, role) values
  ('f4600000-0000-0000-0000-000000000081', 'owner'),
  ('f4600000-0000-0000-0000-000000000082', 'admin'),
  ('f4600000-0000-0000-0000-000000000083', 'admin'),
  ('f4600000-0000-0000-0000-000000000084', 'supervisor'),
  ('f4600000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f4600000-0000-0000-0000-000000000083', 'cancel_shifts', true);

insert into public.employees (profile_id, dni, status) values
  ('f4600000-0000-0000-0000-000000000084', '94600084', 'active'),
  ('f4600000-0000-0000-0000-000000000085', '94600085', 'active'),
  ('f4600000-0000-0000-0000-000000000091', '94600091', 'active'),
  ('f4600000-0000-0000-0000-000000000092', '94600092', 'active');

insert into public.holidays (holiday_date, name) values ('2199-04-15', 'Feriado de prueba 0046');

-- preview_shift_series -------------------------------------------------------------------------

select tests.as_user('test-db046-admin@example.com');

select is(
  public.preview_shift_series('2199-04-01', '2199-04-30', array[1]::smallint[], null, true),
  '{"dates": ["2199-04-01", "2199-04-08", "2199-04-15", "2199-04-22", "2199-04-29"], "holidays_skipped": [], "count": 5}'::jsonb,
  'preview: todos los lunes de abril, trabajando feriados'
);
select is(
  public.preview_shift_series('2199-04-01', '2199-04-30', array[1]::smallint[], null, false),
  '{"dates": ["2199-04-01", "2199-04-08", "2199-04-22", "2199-04-29"], "holidays_skipped": ["2199-04-15"], "count": 4}'::jsonb,
  'preview: el feriado se saltea y se informa'
);
select is(
  (public.preview_shift_series('2199-04-01', '2199-04-30', array[1]::smallint[], array[1, 5]::smallint[], true)) -> 'dates',
  '["2199-04-01", "2199-04-29"]'::jsonb,
  'preview: primera y última semana del mes'
);
select is(
  (public.preview_shift_series('2199-04-01', '2199-04-30', array[1, 3]::smallint[], array[2]::smallint[], true)) -> 'dates',
  '["2199-04-08", "2199-04-10"]'::jsonb,
  'preview: varios días, solo la 2.ª semana (lunes 8 y miércoles 10)'
);
select is(
  (public.preview_shift_series('2199-04-02', '2199-04-07', array[1]::smallint[], null, true)) -> 'count',
  '0'::jsonb,
  'preview: sin fechas que cumplan devuelve count 0 y no falla'
);
select is(
  (public.preview_shift_series('2199-04-01', '2199-07-01', array[1]::smallint[], null, true)) -> 'count',
  '14'::jsonb,
  'preview: hasta exactamente 3 meses después es válido (14 lunes del 1/4 al 1/7)'
);

prepare p_corto as select public.preview_shift_series('2199-04-10', '2199-04-09', array[1]::smallint[], null, false);
select throws_ok('p_corto', 'P0001', 'La fecha «hasta» tiene que ser igual o posterior a la fecha «desde».', 'preview: hasta < desde (SERIES_RANGE_INVALID)');
prepare p_largo as select public.preview_shift_series('2199-04-01', '2199-07-02', array[1]::smallint[], null, false);
select throws_ok('p_largo', 'P0001', 'La repetición puede abarcar como máximo 3 meses desde la primera fecha.', 'preview: más de 3 meses (SERIES_RANGE_TOO_LONG)');
prepare p_nulo as select public.preview_shift_series('2199-04-01', null, array[1]::smallint[], null, false);
select throws_ok('p_nulo', 'P0001', 'La fecha «hasta» tiene que ser igual o posterior a la fecha «desde».', 'preview: «hasta» obligatoria');
prepare p_dias as select public.preview_shift_series('2199-04-01', '2199-04-30', array[7]::smallint[], null, false);
select throws_ok('p_dias', 'P0001', 'Los días de la semana no son válidos.', 'preview: día 7 inválido (INVALID_WEEKDAYS)');
prepare p_semanas as select public.preview_shift_series('2199-04-01', '2199-04-30', array[1]::smallint[], array[6]::smallint[], false);
select throws_ok('p_semanas', 'P0001', 'Las semanas del mes no son válidas.', 'preview: semana 6 inválida (INVALID_WEEKS_OF_MONTH)');

-- create_shift_series: creación ------------------------------------------------------------------

select tests.as_user('test-db046-admin-cap@example.com');

select set_config('t.s1', public.create_shift_series(
  'f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011',
  '08:00', '12:00', 2::smallint, '2199-04-01', '2199-04-30', array[1]::smallint[], null, false,
  'Limpieza profunda', false, false, null
)::text, true);

select is(
  (select jsonb_array_length(current_setting('t.s1')::jsonb -> 'created')),
  4,
  'create: 4 turnos (el lunes 15 es feriado)'
);
select is(
  current_setting('t.s1')::jsonb -> 'holidays_skipped',
  '["2199-04-15"]'::jsonb,
  'create: informa el feriado salteado'
);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where series_id = (current_setting('t.s1')::jsonb ->> 'series_id')::uuid),
  array['2199-04-01', '2199-04-08', '2199-04-22', '2199-04-29'],
  'create: los turnos comparten series_id y caen en las fechas esperadas'
);
select is(
  (select count(*)::int from public.shifts where series_id = (current_setting('t.s1')::jsonb ->> 'series_id')::uuid
     and service_id is null and generated = false and status = 'scheduled' and required_staff = 2
     and start_time = '08:00' and end_time = '12:00' and open_ended = false),
  4,
  'create: turnos sueltos, programados, con la franja y la dotación pedidas'
);
select is(
  (select count(*)::int from public.shift_observations o join public.shifts s on s.id = o.shift_id
     where s.series_id = (current_setting('t.s1')::jsonb ->> 'series_id')::uuid
       and o.observation = 'Limpieza profunda' and o.show_in_print = false),
  4,
  'create: la nota y show_in_print quedan en cada turno'
);
select is(
  (select jsonb_array_length(current_setting('t.s1')::jsonb -> 'created' -> 0 -> 'assigned')),
  0,
  'create: sin empleados, assigned vacío'
);

-- Independientes: cancelar uno no toca los demás.
select public.cancel_shift(
  ((current_setting('t.s1')::jsonb -> 'created' -> 0) ->> 'shift_id')::uuid, 'Prueba de independencia'
);
select is(
  (select count(*)::int from public.shifts where series_id = (current_setting('t.s1')::jsonb ->> 'series_id')::uuid and status = 'cancelled'),
  1,
  'cada turno es independiente: cancelar uno no cancela los demás'
);

-- Última semana del mes y feriado trabajado
select set_config('t.s2', public.create_shift_series(
  'f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011',
  '14:00', '16:00', 1::smallint, '2199-04-01', '2199-05-31', array[1]::smallint[], array[5]::smallint[], true
)::text, true);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts where series_id = (current_setting('t.s2')::jsonb ->> 'series_id')::uuid),
  array['2199-04-29', '2199-05-27'],
  'create: solo la última semana del mes (el 27 de mayo es 4.ª y última, una sola vez)'
);
select isnt(
  current_setting('t.s1')::jsonb ->> 'series_id', current_setting('t.s2')::jsonb ->> 'series_id',
  'cada llamada genera un series_id distinto'
);
select public.create_shift_series(
  'f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011',
  '18:00', '19:00', 1::smallint, '2199-04-15', '2199-04-15', array[1]::smallint[], null, true
);
select is(
  (select count(*)::int from public.shifts where shift_date = '2199-04-15' and start_time = '18:00'), 1,
  'create: works_on_holidays = true crea el turno del feriado'
);

-- Errores y todo o nada --------------------------------------------------------------------------

select is((select count(*)::int from public.shifts where client_id = 'f4600000-0000-0000-0000-000000000001'), 7, 'antes de los errores hay 7 turnos');

prepare c_hora as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '12:00', '08:00', 1::smallint, '2199-06-01', '2199-06-30', array[1]::smallint[]);
select throws_ok('c_hora', 'P0001', 'La hora de fin tiene que ser posterior a la de inicio. (turno del 03/06/2199)', 'create: validación del turno falla todo e indica la fecha (INVALID_TIME_RANGE)');
prepare c_cliente as select public.create_shift_series('f4600000-0000-0000-0000-000000000002', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-06-01', '2199-06-30', array[1]::smallint[]);
select throws_ok('c_cliente', 'P0001', 'El cliente no está activo. (turno del 03/06/2199)', 'create: cliente inactivo (CLIENT_NOT_ACTIVE)');
prepare c_vacio as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-06-04', '2199-06-09', array[1]::smallint[]);
select throws_ok('c_vacio', 'P0001', 'Ninguna fecha del período cumple la regla elegida (o todas son feriados).', 'create: sin fechas (SERIES_EMPTY)');
prepare c_feriados as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-04-15', '2199-04-15', array[1]::smallint[]);
select throws_ok('c_feriados', 'P0001', 'Ninguna fecha del período cumple la regla elegida (o todas son feriados).', 'create: todas feriados y sin trabajar feriados (SERIES_EMPTY)');
prepare c_largo as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-04-01', '2199-07-02', array[1]::smallint[]);
select throws_ok('c_largo', 'P0001', 'La repetición puede abarcar como máximo 3 meses desde la primera fecha.', 'create: más de 3 meses (SERIES_RANGE_TOO_LONG)');
prepare c_rango as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-04-10', '2199-04-01', array[1]::smallint[]);
select throws_ok('c_rango', 'P0001', 'La fecha «hasta» tiene que ser igual o posterior a la fecha «desde».', 'create: hasta < desde (SERIES_RANGE_INVALID)');
prepare c_dias as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-04-01', '2199-04-30', array[]::smallint[]);
select throws_ok('c_dias', 'P0001', 'Los días de la semana no son válidos.', 'create: sin días (INVALID_WEEKDAYS)');
select is((select count(*)::int from public.shifts where client_id = 'f4600000-0000-0000-0000-000000000001'), 7, 'después de los errores no quedó ningún turno de más');

-- Asignados y rechazados -------------------------------------------------------------------------
-- Beto ya tiene un turno el lunes 2199-06-10 de 08:00 a 12:00.

select public.create_shift(
  'f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '2199-06-10',
  '08:00', '12:00', 1::smallint, null, null, false, true,
  array['f4600000-0000-0000-0000-000000000092']::uuid[]
);

select set_config('t.s3', public.create_shift_series(
  'f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011',
  '08:00', '12:00', 2::smallint, '2199-06-03', '2199-06-17', array[1]::smallint[], null, false, null, false, true,
  array['f4600000-0000-0000-0000-000000000091', 'f4600000-0000-0000-0000-000000000092']::uuid[]
)::text, true);

select is(
  (select jsonb_array_length(current_setting('t.s3')::jsonb -> 'created')), 3,
  'asignación: se crean los 3 lunes aunque un empleado se rechace'
);
select is(
  (select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id
     where s.series_id = (current_setting('t.s3')::jsonb ->> 'series_id')::uuid and a.removed_at is null),
  5,
  'asignación: 6 pedidas menos 1 rechazada = 5 asignaciones'
);
select is(
  (select jsonb_agg(c -> 'shift_date' order by c ->> 'shift_date') from jsonb_array_elements(current_setting('t.s3')::jsonb -> 'created') c where jsonb_array_length(c -> 'rejected') > 0),
  '["2199-06-10"]'::jsonb,
  'asignación: el rechazo se informa solo en la fecha del conflicto'
);
select is(
  (select c -> 'rejected' -> 0 ->> 'code' from jsonb_array_elements(current_setting('t.s3')::jsonb -> 'created') c where c ->> 'shift_date' = '2199-06-10'),
  'ASSIGNMENT_OVERLAP',
  'asignación: motivo ASSIGNMENT_OVERLAP'
);
select is(
  (select jsonb_array_length(c -> 'assigned') from jsonb_array_elements(current_setting('t.s3')::jsonb -> 'created') c where c ->> 'shift_date' = '2199-06-03'),
  2,
  'asignación: en una fecha sin conflicto quedan los dos asignados'
);

-- Permisos ---------------------------------------------------------------------------------------

select tests.as_user('test-db046-owner@example.com');
select is(
  (public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '07:00', '08:00', 1::smallint, '2199-06-24', '2199-06-24', array[1]::smallint[]) -> 'created' -> 0 ->> 'shift_date'),
  '2199-06-24',
  'permisos: el dueño puede'
);
select tests.as_user('test-db046-admin@example.com');
select is(
  (public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '07:00', '08:00', 1::smallint, '2199-07-01', '2199-07-01', array[1]::smallint[]) -> 'created' -> 0 ->> 'shift_date'),
  '2199-07-01',
  'permisos: un administrador sin capacidades puede (create_shift solo pide el rol)'
);

select tests.as_user('test-db046-supervisora@example.com');
prepare s_prev as select public.preview_shift_series('2199-04-01', '2199-04-30', array[1]::smallint[]);
prepare s_cre as select public.create_shift_series('f4600000-0000-0000-0000-000000000001', 'f4600000-0000-0000-0000-000000000011', '08:00', '12:00', 1::smallint, '2199-04-01', '2199-04-30', array[1]::smallint[]);
select throws_ok('s_cre', 'P0001', null, 'permisos: el supervisor no puede crear (FORBIDDEN)');
select throws_ok('s_prev', 'P0001', null, 'permisos: el supervisor no puede la vista previa (FORBIDDEN)');
select tests.as_user('test-db046-empleado@example.com');
select throws_ok('s_cre', 'P0001', null, 'permisos: el empleado no puede crear (FORBIDDEN)');
select throws_ok('s_prev', 'P0001', null, 'permisos: el empleado no puede la vista previa (FORBIDDEN)');
set local role anon;
select throws_ok('s_cre', '42501', null, 'permisos: anon sin permiso de ejecución (create)');
select throws_ok('s_prev', '42501', null, 'permisos: anon sin permiso de ejecución (preview)');

select * from finish();

rollback;
