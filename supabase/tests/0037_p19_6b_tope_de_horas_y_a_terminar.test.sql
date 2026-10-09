-- pgTAP de la migración 0037_p19_6b_tope_de_horas_y_a_terminar.sql (P19.6 paquete B, ajustes de la
-- reunión del 9 oct 2026): AJ2-09 tope de horas (app.capped_worked_minutes y todo lo que muestra
-- horas trabajadas) y AJ2-10 turnos «A terminar» (open_ended, «Sin salida», superposición hasta
-- las 23:59, generación desde un servicio «A terminar», franja propia).
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`. Prefijo
-- de fixtures: 'e3700000-...'. Todos los fichajes caen en una fecha pasada (hoy menos 5 días) con
-- horas fijas, así ningún caso depende de la hora real de la corrida.

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

-- Devuelve el `hint` del error (código estable de 06 sección 15), o el SQLSTATE si no trae hint, o
-- null si la sentencia anduvo.
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

-- Día de los fichajes (hoy menos 5) y un instante de ese día a una hora local de Argentina.
create or replace function tests.d()
returns date language sql stable as $$ select app.today() - 5; $$;
create or replace function tests.at(p_time time)
returns timestamptz language sql stable as $$ select app.local_ts(app.today() - 5, p_time); $$;

create or replace function tests.emp(p_n int)
returns uuid language sql immutable as $$
  select ('e3700000-0000-0000-0000-0000000001' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;
create or replace function tests.shf(p_n int)
returns uuid language sql immutable as $$
  select ('e3700000-0000-0000-0000-0000000002' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;
create or replace function tests.asg(p_n int)
returns uuid language sql immutable as $$
  select ('e3700000-0000-0000-0000-0000000003' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

select plan(106);

-- ---------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------

select has_column('public', 'services', 'open_ended', 'services.open_ended existe');
select has_column('public', 'shifts', 'open_ended', 'shifts.open_ended existe');
select col_type_is('public', 'shifts', 'open_ended', 'boolean', 'shifts.open_ended es boolean');
select col_not_null('public', 'shifts', 'open_ended', 'shifts.open_ended es not null');
select col_default_is('public', 'shifts', 'open_ended', 'false', 'shifts.open_ended nace en false');
select col_default_is('public', 'services', 'open_ended', 'false', 'services.open_ended nace en false');
select has_function('app', 'capped_worked_minutes',
  array['timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone', 'timestamp with time zone'],
  'existe app.capped_worked_minutes(timestamptz x4)');
select has_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text', 'boolean'],
  'create_shift tiene p_open_ended');
select has_function('public', 'update_shift_time', array['uuid', 'time', 'time', 'boolean'],
  'update_shift_time tiene p_open_ended');
select hasnt_function('public', 'update_shift_time', array['uuid', 'time', 'time'],
  'ya no existe update_shift_time(uuid, time, time) (sin ambigüedad de firmas)');
select hasnt_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text'],
  'ya no existe create_shift de ocho parámetros');
select ok(
  not has_function_privilege('anon', 'public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.update_shift_time(uuid, time, time, boolean)', 'execute')
    and has_function_privilege('authenticated', 'public.update_shift_time(uuid, time, time, boolean)', 'execute'),
  'grants de create_shift/update_shift_time: anon no, authenticated sí'
);
select ok(
  has_function_privilege('authenticated', 'app.capped_worked_minutes(timestamptz, timestamptz, timestamptz, timestamptz)', 'execute')
    and has_function_privilege('service_role', 'app.capped_worked_minutes(timestamptz, timestamptz, timestamptz, timestamptz)', 'execute'),
  'app.capped_worked_minutes la ejecutan authenticated y service_role (las vistas son security_invoker)'
);

-- Las columnas nuevas de las vistas van al final.
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_shifts_board'::regclass and attnum > 0 and not attisdropped
   and attnum >= (select attnum from pg_attribute where attrelid = 'public.v_shifts_board'::regclass and attname = 'deleted_at')),
  array['deleted_at', 'open_ended', 'no_checkout_count'],
  'v_shifts_board: open_ended y no_checkout_count van después de deleted_at'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_assignments_board'::regclass and attnum > 0 and not attisdropped
   and attnum >= (select attnum from pg_attribute where attrelid = 'public.v_assignments_board'::regclass and attname = 'planned_minutes')),
  array['planned_minutes', 'worked_minutes', 'effective_open_ended'],
  'v_assignments_board: effective_open_ended va después de worked_minutes'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_my_day'::regclass and attnum > 0 and not attisdropped
   and attnum >= (select attnum from pg_attribute where attrelid = 'public.v_my_day'::regclass and attname = 'on_the_way_expires_at')),
  array['on_the_way_expires_at', 'effective_open_ended', 'no_checkout'],
  'v_my_day: effective_open_ended y no_checkout van después de on_the_way_expires_at'
);
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_my_supervisions'::regclass and attnum > 0 and not attisdropped
   and attnum >= (select attnum from pg_attribute where attrelid = 'public.v_my_supervisions'::regclass and attname = 'site_restrictions_notes')),
  array['site_restrictions_notes', 'shift_open_ended'],
  'v_my_supervisions: shift_open_ended va al final'
);
select is(
  (select attname::text from pg_attribute where attrelid = 'public.v_supervisions_admin'::regclass and attnum > 0 and not attisdropped order by attnum desc limit 1),
  'shift_open_ended',
  'v_supervisions_admin: shift_open_ended va al final'
);

-- ---------------------------------------------------------------------------------------------
-- 1. app.capped_worked_minutes (AJ2-09), función pura, turno 8 a 12
-- ---------------------------------------------------------------------------------------------

select is(app.capped_worked_minutes(tests.at('07:45'), tests.at('11:45'), tests.at('08:00'), tests.at('12:00')), 225,
  'entra 7:45 y sale 11:45 en un turno 8 a 12: 225 min (3 h 45; lo de antes del inicio no suma)');
select is(app.capped_worked_minutes(tests.at('08:00'), tests.at('12:30'), tests.at('08:00'), tests.at('12:00')), 240,
  'entra 8:00 y sale 12:30: 240 min (lo de después del fin no suma)');
select is(app.capped_worked_minutes(tests.at('08:05'), tests.at('12:00'), tests.at('08:00'), tests.at('12:00')), 235,
  'llega 8:05: 235 min (los 5 min se descuentan aunque estén dentro de la tolerancia)');
select is(app.capped_worked_minutes(tests.at('07:00'), tests.at('13:00'), tests.at('08:00'), tests.at('12:00')), 240,
  'llega antes y se va después: la franja completa, 240 min');
select is(app.capped_worked_minutes(tests.at('08:00'), tests.at('08:00'), tests.at('08:00'), tests.at('12:00')), 0,
  'entrada y salida iguales: 0');
select is(app.capped_worked_minutes(tests.at('13:00'), tests.at('14:00'), tests.at('08:00'), tests.at('12:00')), 0,
  'fichaje enteramente fuera de la franja: 0, nunca negativo');
select is(app.capped_worked_minutes(tests.at('05:00'), tests.at('07:00'), tests.at('08:00'), tests.at('12:00')), 0,
  'fichaje enteramente antes de la franja: 0, nunca negativo');
select is(app.capped_worked_minutes(tests.at('08:00'), null, tests.at('08:00'), tests.at('12:00')), null,
  'sin salida: null (la vista lo muestra como 0 solo cuando está «Sin salida»)');
select is(app.capped_worked_minutes(null, tests.at('12:00'), tests.at('08:00'), tests.at('12:00')), null,
  'sin entrada: null');
select is(app.capped_worked_minutes(tests.at('07:50'), tests.at('13:10'), tests.at('08:00'), null), 310,
  'franja sin fin (null): desde max(entrada, inicio) hasta la salida real, 310 min (A terminar 7:50 a 13:10, turno desde las 8:00)');
select is(app.capped_worked_minutes(tests.at('07:50'), tests.at('13:10'), null, null), 320,
  'franja sin ninguna punta: el fichaje completo');
select is(app.capped_worked_minutes(tests.at('08:00') + interval '20 seconds', tests.at('08:01') + interval '10 seconds', tests.at('08:00'), tests.at('12:00')), 1,
  'redondea al minuto (50 s -> 1)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e3700000-0000-0000-0000-000000000081', 'test-db037-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Uno')),
  ('e3700000-0000-0000-0000-000000000083', 'test-db037-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConPermisos')),
  ('e3700000-0000-0000-0000-000000000084', 'test-db037-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinPermisos')),
  ('e3700000-0000-0000-0000-000000000085', 'test-db037-supervisor@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora'));

insert into auth.users (id, email, raw_user_meta_data)
select tests.emp(n), 'test-db037-emp' || n || '@example.com',
       jsonb_build_object('first_name', 'Emp', 'last_name', 'Numero' || lpad(n::text, 2, '0'))
from generate_series(1, 20) n;

insert into public.user_roles (profile_id, role) values
  ('e3700000-0000-0000-0000-000000000081', 'owner'),
  ('e3700000-0000-0000-0000-000000000083', 'admin'),
  ('e3700000-0000-0000-0000-000000000084', 'admin'),
  ('e3700000-0000-0000-0000-000000000085', 'supervisor');

insert into public.user_roles (profile_id, role)
select tests.emp(n), 'employee' from generate_series(1, 20) n;

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e3700000-0000-0000-0000-000000000083', 'manage_attendance', true),
  ('e3700000-0000-0000-0000-000000000083', 'generate_shifts', true),
  ('e3700000-0000-0000-0000-000000000084', 'manage_attendance', false);

insert into public.employees (profile_id, dni) values
  ('e3700000-0000-0000-0000-000000000085', '93700085');

insert into public.employees (profile_id, dni)
select tests.emp(n), (93700100 + n)::text from generate_series(1, 20) n;

insert into public.clients (id, legal_name, status) values
  ('e3700000-0000-0000-0000-000000000011', 'Cliente 0037', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e3700000-0000-0000-0000-000000000021', 'e3700000-0000-0000-0000-000000000011', 'Sede 0037', 'Calle 1', 'active');

-- Turnos del día de los fichajes (todos 08:00 a 12:00 salvo indicación). Regulares: 1 a 5 y 15.
-- «A terminar»: 6 a 10 y 16. Las asignaciones nacen con la ventana que calcula el trigger de 0007.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, open_ended, required_staff, status)
select tests.shf(n), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021',
       tests.d(), time '08:00', time '12:00', false, 5,
       case when n in (5, 15) then 'in_progress' else 'completed' end::public.shift_status
from unnest(array[1, 2, 3, 4, 5, 15]) n;

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, open_ended, required_staff, status)
select tests.shf(n), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021',
       tests.d(), time '08:00', time '09:00', true, 5,
       case when n in (7, 16) then 'in_progress' else 'completed' end::public.shift_status
from unnest(array[6, 7, 8, 9, 10, 16]) n;

insert into public.assignments (id, shift_id, employee_id, status, start_time, end_time) values
  (tests.asg(1), tests.shf(1), tests.emp(1), 'finished', null, null),
  (tests.asg(2), tests.shf(2), tests.emp(2), 'finished', null, null),
  (tests.asg(3), tests.shf(3), tests.emp(3), 'finished', null, null),
  (tests.asg(4), tests.shf(4), tests.emp(4), 'finished', null, null),
  (tests.asg(5), tests.shf(5), tests.emp(5), 'present', null, null),
  (tests.asg(15), tests.shf(15), tests.emp(15), 'present', null, null),
  (tests.asg(6), tests.shf(6), tests.emp(6), 'finished', null, null),
  (tests.asg(7), tests.shf(7), tests.emp(7), 'present', null, null),
  (tests.asg(8), tests.shf(8), tests.emp(8), 'finished', null, null),
  (tests.asg(9), tests.shf(9), tests.emp(9), 'finished', '09:00', null),
  (tests.asg(16), tests.shf(16), tests.emp(16), 'present', '09:00', null),
  (tests.asg(10), tests.shf(10), tests.emp(10), 'finished', '09:00', '13:00');

insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  (tests.asg(1), 'check_in', tests.at('07:45'), 'employee_app', tests.emp(1)),
  (tests.asg(1), 'check_out', tests.at('11:45'), 'employee_app', tests.emp(1)),
  (tests.asg(2), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(2)),
  (tests.asg(2), 'check_out', tests.at('12:30'), 'employee_app', tests.emp(2)),
  (tests.asg(3), 'check_in', tests.at('08:05'), 'employee_app', tests.emp(3)),
  (tests.asg(3), 'check_out', tests.at('12:00'), 'employee_app', tests.emp(3)),
  (tests.asg(4), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(4)),
  (tests.asg(4), 'check_out', tests.at('11:50'), 'employee_app', tests.emp(4)),
  (tests.asg(5), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(5)),
  (tests.asg(15), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(15)),
  (tests.asg(6), 'check_in', tests.at('07:50'), 'employee_app', tests.emp(6)),
  (tests.asg(6), 'check_out', tests.at('13:10'), 'employee_app', tests.emp(6)),
  (tests.asg(7), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(7)),
  (tests.asg(8), 'check_in', tests.at('08:00'), 'employee_app', tests.emp(8)),
  (tests.asg(8), 'check_out', tests.at('14:00'), 'employee_app', tests.emp(8)),
  (tests.asg(9), 'check_in', tests.at('08:50'), 'employee_app', tests.emp(9)),
  (tests.asg(9), 'check_out', tests.at('15:00'), 'employee_app', tests.emp(9)),
  (tests.asg(16), 'check_in', tests.at('08:50'), 'employee_app', tests.emp(16)),
  (tests.asg(10), 'check_in', tests.at('09:00'), 'employee_app', tests.emp(10)),
  (tests.asg(10), 'check_out', tests.at('14:00'), 'employee_app', tests.emp(10));

-- ---------------------------------------------------------------------------------------------
-- 2. «A terminar»: normalización y checks
-- ---------------------------------------------------------------------------------------------

select is(
  (select end_time::text || '|' || ends_at::text from public.shifts where id = tests.shf(6)),
  '23:59:00|' || app.local_ts(tests.d(), time '23:59')::text,
  'un turno open_ended insertado con end_time 09:00 queda en 23:59 y ends_at es las 23:59 de ese día'
);
select is(
  (select upper("window") from public.assignments where id = tests.asg(6)),
  app.local_ts(tests.d(), time '23:59'),
  'la ventana de la asignación de un turno «A terminar» llega hasta las 23:59'
);
select is(
  (select upper("window") from public.assignments where id = tests.asg(10)),
  app.local_ts(tests.d(), time '13:00'),
  'con franja propia con fin dentro de un turno «A terminar», la ventana usa el fin propio'
);

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, open_ended)
values ('e3700000-0000-0000-0000-0000000000a1', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021',
        'Servicio A terminar 0037', array[0, 1, 2, 3, 4, 5, 6]::smallint[], '08:00', '10:00', date '2026-01-01', true);
select is(
  (select end_time::text from public.services where id = 'e3700000-0000-0000-0000-0000000000a1'),
  '23:59:00',
  'un servicio open_ended queda con end_time 23:59 (trigger app.normalize_open_ended)'
);
update public.services set open_ended = false, end_time = '10:00' where id = 'e3700000-0000-0000-0000-0000000000a1';
select is(
  (select open_ended::text || '|' || end_time::text from public.services where id = 'e3700000-0000-0000-0000-0000000000a1'),
  'false|10:00:00',
  'un servicio vuelve a tener hora de fin al apagar open_ended y fijar end_time'
);
update public.services set open_ended = true where id = 'e3700000-0000-0000-0000-0000000000a1';
select is(
  (select end_time::text from public.services where id = 'e3700000-0000-0000-0000-0000000000a1'),
  '23:59:00',
  'al volver a prender open_ended el end_time vuelve a 23:59'
);

-- ---------------------------------------------------------------------------------------------
-- 3. v_assignments_board: horas con tope y «A terminar»
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db037-owner@example.com');

select is(
  (select planned_minutes || '|' || worked_minutes || '|' || coalesce(minutes_late::text, 'null') || '|' || coalesce(minutes_early_leave::text, 'null')
   from public.v_assignments_board where id = tests.asg(1)),
  '240|225|null|15',
  'turno 8 a 12, entra 7:45 y sale 11:45: worked 225 (ni lo de antes), salida anticipada 15 se sigue marcando'
);
select is(
  (select planned_minutes || '|' || worked_minutes || '|' || coalesce(minutes_late::text, 'null') || '|' || coalesce(minutes_early_leave::text, 'null')
   from public.v_assignments_board where id = tests.asg(2)),
  '240|240|null|null',
  'entra 8:00 y sale 12:30: worked 240 (ni lo de después), sin llegada tarde ni salida anticipada'
);
select is(
  (select worked_minutes || '|' || minutes_late from public.v_assignments_board where id = tests.asg(3)),
  '235|5',
  'llega 8:05: worked 235 y la llegada tarde de 5 minutos se sigue marcando'
);
select is(
  (select worked_minutes || '|' || minutes_early_leave from public.v_assignments_board where id = tests.asg(4)),
  '230|10',
  'sale 11:50: worked 230 y la salida anticipada de 10 minutos se sigue marcando'
);
select is(
  (select coalesce(worked_minutes::text, 'null') || '|' || display_status || '|' || effective_open_ended::text
   from public.v_assignments_board where id = tests.asg(5)),
  'null|present|false',
  'turno común con inicio y sin fin: worked null, display present (no es «Sin salida»)'
);
select is(
  (select coalesce(planned_minutes::text, 'null') || '|' || worked_minutes || '|' || effective_open_ended::text || '|' || display_status
   from public.v_assignments_board where id = tests.asg(6)),
  'null|310|true|finished',
  '«A terminar» entra 7:50 y sale 13:10 en un turno desde las 8:00: worked 310, planned null, effective_open_ended'
);
select is(
  (select coalesce(minutes_early_leave::text, 'null') || '|' || effective_end_time::text from public.v_assignments_board where id = tests.asg(6)),
  'null|23:59:00',
  '«A terminar»: no hay salida anticipada (no tiene fin previsto); effective_end_time queda en 23:59 y el front muestra «A terminar»'
);
select is(
  (select worked_minutes || '|' || display_status || '|' || coalesce(planned_minutes::text, 'null') || '|' || effective_open_ended::text
   from public.v_assignments_board where id = tests.asg(7)),
  '0|no_checkout|null|true',
  '«A terminar» con inicio, sin salida y pasadas las 23:59: «Sin salida» (no_checkout) con 0 horas'
);
select is(
  (select worked_minutes || '|' || coalesce(planned_minutes::text, 'null') from public.v_assignments_board where id = tests.asg(8)),
  '360|null',
  '«A terminar» entra 8:00 y sale 14:00: worked 360 (sin tope superior)'
);
select is(
  (select worked_minutes || '|' || effective_open_ended::text || '|' || coalesce(minutes_late::text, 'null')
   from public.v_assignments_board where id = tests.asg(9)),
  '360|true|null',
  'franja propia con inicio 9:00 en un turno «A terminar» (sin fin propio): es abierta; entra 8:50, sale 15:00: worked 360 (desde las 9:00)'
);
select is(
  (select planned_minutes || '|' || worked_minutes || '|' || effective_open_ended::text || '|' || display_status
   from public.v_assignments_board where id = tests.asg(10)),
  '240|240|false|finished',
  'franja propia 9:00 a 13:00 en un turno «A terminar»: tiene fin propio, planned 240, worked 240 con tope 13:00, no es abierta'
);

-- v_shifts_board
select is(
  (select open_ended::text || '|' || no_checkout_count::text from public.v_shifts_board where id = tests.shf(7)),
  'true|1',
  'v_shifts_board: el turno «A terminar» con una asignación sin salida cuenta 1 en no_checkout_count'
);
select is(
  (select open_ended::text || '|' || no_checkout_count::text from public.v_shifts_board where id = tests.shf(5)),
  'false|0',
  'v_shifts_board: el turno común con inicio sin fin no cuenta como «Sin salida»'
);
select is(
  (select no_checkout_count::int from public.v_shifts_board where id = tests.shf(16)),
  1,
  'v_shifts_board: la asignación con inicio propio y sin fin propio (turno 16) también cuenta como «Sin salida»'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Resumen por cliente y minutos por cliente
-- ---------------------------------------------------------------------------------------------

select is(
  (public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'totals' ->> 'worked_minutes')::int,
  2200,
  'client_service_summary: worked_minutes = 225+240+235+230 + 310+360+360+240 (cada fichaje con su tope)'
);
select is(
  (public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'totals' ->> 'planned_minutes')::int,
  1680,
  'client_service_summary: planned_minutes suma solo las asignaciones con inicio y fin previsto (los «A terminar» sin fin no suman)'
);
select is(
  (public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'totals' ->> 'open_ended_shifts')::int,
  6,
  'client_service_summary: totals.open_ended_shifts cuenta aparte los turnos «A terminar»'
);
select is(
  (select (s ->> 'open_ended') from jsonb_array_elements(public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'shifts') s
   where s ->> 'shift_id' = tests.shf(6)::text),
  'true',
  'client_service_summary: el turno «A terminar» trae open_ended = true'
);
select is(
  (select (e ->> 'no_checkout') || '|' || coalesce(e ->> 'planned_minutes', 'null') || '|' || coalesce(e ->> 'worked_minutes', 'null')
   from jsonb_array_elements(public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'shifts') s,
        jsonb_array_elements(s -> 'employees') e
   where e ->> 'assignment_id' = tests.asg(7)::text),
  'true|null|null',
  'client_service_summary: la asignación «Sin salida» viene con no_checkout = true y sin minutos (suma 0)'
);
select is(
  (select (s ->> 'worked_minutes') from jsonb_array_elements(public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'shifts') s
   where s ->> 'shift_id' = tests.shf(1)::text),
  '225',
  'client_service_summary: el turno 1 suma 225 (no 240)'
);
select is(
  (select worked_minutes::int from public.clients_worked_minutes(tests.d(), tests.d()) where client_id = 'e3700000-0000-0000-0000-000000000011'),
  2200,
  'clients_worked_minutes: mismo total que el resumen (2200)'
);

-- ---------------------------------------------------------------------------------------------
-- 5. record_check_out: «A terminar» pasadas las 23:59 no se ficha, la hora la carga administración
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db037-emp7@example.com');
select is(
  tests.err_hint(format('select public.record_check_out(%L)', tests.asg(7))),
  'OPEN_SHIFT_DAY_ENDED',
  'record_check_out: la asignación «A terminar» con el día ya terminado da OPEN_SHIFT_DAY_ENDED'
);
select is(
  tests.err_message(format('select public.record_check_out(%L)', tests.asg(7))),
  'El día del turno ya terminó y quedó sin salida: pedile a un administrador que cargue tu hora de salida.',
  'record_check_out: el mensaje manda a pedirle a un administrador que cargue la hora'
);

select tests.as_user('test-db037-emp16@example.com');
select is(
  tests.err_hint(format('select public.record_check_out(%L)', tests.asg(16))),
  'OPEN_SHIFT_DAY_ENDED',
  'record_check_out: lo mismo con inicio propio y sin fin propio (sigue siendo abierta)'
);

select tests.as_user('test-db037-emp15@example.com');
select is(
  tests.err_hint(format('select public.record_check_out(%L)', tests.asg(15))),
  null,
  'record_check_out: un turno común no cambia (puede fichar la salida de un día anterior, P-069)'
);

-- ---------------------------------------------------------------------------------------------
-- 6. Administración carga la salida de quien quedó «Sin salida»
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db037-admin-sin-cap@example.com');
select is(
  tests.err_hint(format('select public.close_assignment(%L, %L, %L)', tests.asg(7), 'Carga', tests.at('13:10'))),
  'FORBIDDEN',
  'close_assignment: un administrador sin manage_attendance no puede cargar la salida'
);

select tests.as_user('test-db037-admin@example.com');
select is(
  (select recorded_at from public.close_assignment(tests.asg(7), 'Olvidó fichar la salida', tests.at('13:10'))),
  tests.at('13:10'),
  'close_assignment: administración carga la salida 13:10 de quien quedó «Sin salida»'
);
select is(
  (select worked_minutes || '|' || display_status from public.v_assignments_board where id = tests.asg(7)),
  '310|finished',
  'cargada la hora, deja de estar «Sin salida» y cuenta 310 min (8:00 a 13:10)'
);
select is(
  (select status::text from public.shifts where id = tests.shf(7)),
  'completed',
  'cuando el último asignado ficha la salida, el turno «A terminar» pasa a Finalizado'
);
select is(
  (select no_checkout_count::int from public.v_shifts_board where id = tests.shf(7)),
  0,
  'v_shifts_board: no_checkout_count vuelve a 0'
);

-- ---------------------------------------------------------------------------------------------
-- 7. Ponerle hora de fin a un turno «A terminar» (durante o después de terminado)
-- ---------------------------------------------------------------------------------------------

select is(
  (select end_time::text || '|' || open_ended::text from public.update_shift_time(tests.shf(8), '08:00', '12:00', false)),
  '12:00:00|false',
  'update_shift_time: un turno «A terminar» ya finalizado admite ponerle la hora de fin 12:00'
);
select is(
  (select planned_minutes || '|' || worked_minutes || '|' || effective_open_ended::text || '|' || coalesce(minutes_early_leave::text, 'null')
   from public.v_assignments_board where id = tests.asg(8)),
  '240|240|false|null',
  'con la hora de fin puesta rige el tope: entró 8:00 y salió 14:00, worked 240 (antes 360), planned 240'
);
select is(
  (select upper("window") from public.assignments where id = tests.asg(8)),
  app.local_ts(tests.d(), time '12:00'),
  'la ventana de la asignación se recalculó hasta las 12:00'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, %L, false)', tests.shf(8), '08:00', '13:00')),
  'SHIFT_COMPLETED',
  'update_shift_time: un turno finalizado que ya tiene hora de fin no admite cambios (SHIFT_COMPLETED)'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, %L, false)', tests.shf(6), '08:30', '12:00')),
  'SHIFT_COMPLETED',
  'update_shift_time: un turno «A terminar» finalizado no admite cambiar el inicio (SHIFT_COMPLETED)'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, %L, true)', tests.shf(6), '08:00', null)),
  'SHIFT_COMPLETED',
  'update_shift_time: un turno finalizado no admite volver a «A terminar» (SHIFT_COMPLETED)'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, %L, false)', tests.shf(1), '08:00', '13:00')),
  'SHIFT_COMPLETED',
  'update_shift_time: un turno común finalizado sigue dando SHIFT_COMPLETED'
);
select is(
  (select end_time::text from public.update_shift_time(tests.shf(6), '08:00', '12:00', false)),
  '12:00:00',
  'update_shift_time: se le pone fin 12:00 al turno 6 (entró 7:50, salió 13:10)'
);
select is(
  (select worked_minutes from public.v_assignments_board where id = tests.asg(6)),
  240,
  'ese turno pasa de 310 a 240 min: lo de después de las 12:00 ya no suma'
);
select is(
  (select (public.client_service_summary('e3700000-0000-0000-0000-000000000011', tests.d(), tests.d()) -> 'totals' ->> 'open_ended_shifts')::int),
  4,
  'el resumen del cliente ahora cuenta 4 turnos «A terminar» (los dos con fin puesto salen del aparte)'
);

-- ---------------------------------------------------------------------------------------------
-- 8. Superposición: un turno «A terminar» ocupa al empleado hasta las 23:59
-- ---------------------------------------------------------------------------------------------

set local role postgres;
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, open_ended, required_staff, status) values
  (tests.shf(11), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 5, '08:00', '09:00', true, 3, 'scheduled'),
  (tests.shf(12), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 5, '20:00', '22:00', false, 3, 'scheduled'),
  (tests.shf(13), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 5, '06:00', '08:00', false, 3, 'scheduled'),
  (tests.shf(14), 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 6, '20:00', '22:00', false, 3, 'scheduled');

select tests.as_user('test-db037-admin@example.com');

select is(
  (public.assign_employee(tests.shf(11), tests.emp(11)) -> 'assignment' ->> 'shift_id'),
  tests.shf(11)::text,
  'se asigna a un empleado a un turno «A terminar»'
);
select is(
  tests.err_hint(format('select public.assign_employee(%L, %L)', tests.shf(12), tests.emp(11))),
  'ASSIGNMENT_OVERLAP',
  'el mismo empleado no se puede asignar a las 20:00 del mismo día: el turno «A terminar» lo ocupa hasta las 23:59'
);
select is(
  tests.err_hint(format('select public.assign_employee(%L, %L)', tests.shf(13), tests.emp(11))),
  null,
  'un turno que termina justo cuando empieza el «A terminar» (8:00) no se superpone'
);
select is(
  tests.err_hint(format('select public.assign_employee(%L, %L)', tests.shf(14), tests.emp(11))),
  null,
  'al día siguiente el empleado está libre'
);
select is(
  (select upper("window") from public.assignments where shift_id = tests.shf(11) and employee_id = tests.emp(11)),
  app.local_ts(app.today() + 5, time '23:59'),
  'la ventana de la asignación llega hasta las 23:59'
);

-- Franja propia dentro de un turno «A terminar»: con fin propio, el empleado queda libre después.
select is(
  (public.assign_employee(tests.shf(11), tests.emp(12), '08:00', '12:00') -> 'assignment' ->> 'end_time'),
  '12:00:00',
  'franja propia con fin dentro de un turno «A terminar»: se permite'
);
select is(
  tests.err_hint(format('select public.assign_employee(%L, %L)', tests.shf(12), tests.emp(12))),
  null,
  'con fin propio a las 12:00 el empleado puede tomar otro turno a las 20:00'
);

-- ---------------------------------------------------------------------------------------------
-- 9. create_shift y update_shift_time con p_open_ended
-- ---------------------------------------------------------------------------------------------

select is(
  (public.create_shift('e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 12, '07:00', null, 2::smallint, null, null, true) -> 'shift' ->> 'open_ended'),
  'true',
  'create_shift con p_open_ended = true crea un turno «A terminar» aunque p_end venga null'
);
select is(
  (select end_time::text from public.shifts where shift_date = app.today() + 12 and client_id = 'e3700000-0000-0000-0000-000000000011'),
  '23:59:00',
  'create_shift: el turno «A terminar» queda con end_time 23:59'
);
select is(
  (public.create_shift('e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 13, '07:00', '15:00', 2::smallint, null, null) -> 'shift' ->> 'open_ended'),
  'false',
  'create_shift sin p_open_ended sigue creando un turno común'
);
select is(
  tests.err_hint(format('select public.create_shift(%L, %L, %L, %L, null, 2::smallint)', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 14, '07:00')),
  'INVALID_TIME_RANGE',
  'create_shift: sin hora de fin y sin «A terminar» da INVALID_TIME_RANGE'
);
select is(
  tests.err_hint(format('select public.create_shift(%L, %L, %L, %L, null, 2::smallint, null, null, true)', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 14, '23:59')),
  'INVALID_TIME_RANGE',
  'create_shift: un turno «A terminar» no puede empezar a las 23:59'
);
select is(
  tests.err_hint(format('select public.create_shift(%L, %L, %L, %L, null, 2::smallint, null, null, true)', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 14, '07:00')),
  null,
  'create_shift: con «A terminar» alcanza con el inicio'
);

select tests.as_user('test-db037-supervisor@example.com');
select is(
  tests.err_hint(format('select public.create_shift(%L, %L, %L, %L, null, 2::smallint, null, null, true)', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021', app.today() + 15, '07:00')),
  'FORBIDDEN',
  'create_shift: un supervisor no puede (FORBIDDEN)'
);
select tests.as_user('test-db037-emp1@example.com');
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, %L, true)', tests.shf(11), '08:00', null)),
  'FORBIDDEN',
  'update_shift_time: un empleado no puede (FORBIDDEN)'
);

select tests.as_user('test-db037-admin@example.com');
select is(
  (select open_ended::text || '|' || end_time::text from public.update_shift_time(tests.shf(12), '20:00', null, true)),
  'true|23:59:00',
  'update_shift_time: un turno programado pasa a «A terminar» (p_end se ignora)'
);
select is(
  (select open_ended::text || '|' || end_time::text from public.update_shift_time(tests.shf(12), '20:00', '22:30', false)),
  'false|22:30:00',
  'update_shift_time: y vuelve a tener hora de fin'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, null, false)', tests.shf(12), '20:00')),
  'INVALID_TIME_RANGE',
  'update_shift_time: sin hora de fin y sin «A terminar» da INVALID_TIME_RANGE'
);
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, null, true)', tests.shf(12), '23:59')),
  'INVALID_TIME_RANGE',
  'update_shift_time: «A terminar» no puede empezar a las 23:59'
);
-- Convertir en «A terminar» un turno que dejaría al empleado 11 superpuesto: el turno 13 (6 a 8) se
-- vuelve «A terminar» desde las 06:00 y pisa al 11 (8:00 a 23:59), el mensaje nombra a quien afecta.
select is(
  tests.err_hint(format('select public.update_shift_time(%L, %L, null, true)', tests.shf(13), '06:00')),
  'ASSIGNMENT_OVERLAP',
  'update_shift_time: volver «A terminar» un turno que pisa a otro turno del mismo empleado da ASSIGNMENT_OVERLAP'
);

-- ---------------------------------------------------------------------------------------------
-- 10. Generación del mes desde un servicio «A terminar»
-- ---------------------------------------------------------------------------------------------

set local role postgres;
create temporary table t37_mes on commit drop as
select extract(year from (date_trunc('month', app.today()) + interval '3 months'))::int as y,
       extract(month from (date_trunc('month', app.today()) + interval '3 months'))::int as m,
       (date_trunc('month', app.today()) + interval '3 months')::date as first_day;
grant select on t37_mes to authenticated;

update public.services set valid_from = (select first_day from t37_mes), valid_to = (select first_day + 6 from t37_mes)
where id = 'e3700000-0000-0000-0000-0000000000a1';

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, valid_to, open_ended)
values ('e3700000-0000-0000-0000-0000000000a2', 'e3700000-0000-0000-0000-000000000011', 'e3700000-0000-0000-0000-000000000021',
        'Servicio común 0037', array[0, 1, 2, 3, 4, 5, 6]::smallint[], '08:00', '12:00',
        (select first_day from t37_mes), (select first_day + 6 from t37_mes), false);

select tests.as_user('test-db037-admin-sin-cap@example.com');
select is(
  tests.err_hint(format('select public.generate_shifts(%s, %s)', (select y from t37_mes), (select m from t37_mes))),
  'FORBIDDEN',
  'generate_shifts: un administrador sin la capacidad no puede (FORBIDDEN)'
);

select tests.as_user('test-db037-admin@example.com');
select is(
  (select (public.generate_shifts((select y from t37_mes), (select m from t37_mes)) ->> 'created')::int >= 14),
  true,
  'generate_shifts crea los turnos de los dos servicios (7 + 7 como mínimo)'
);

set local role postgres;
select is(
  (select count(*)::int from public.shifts where service_id = 'e3700000-0000-0000-0000-0000000000a1' and open_ended and end_time = time '23:59' and generated),
  7,
  'servicio «A terminar»: sus 7 turnos generados nacen «A terminar» (open_ended, end_time 23:59)'
);
select is(
  (select count(*)::int from public.shifts where service_id = 'e3700000-0000-0000-0000-0000000000a2' and not open_ended and end_time = time '12:00' and generated),
  7,
  'servicio común: sus 7 turnos generados siguen con hora de fin 12:00'
);
select tests.as_user('test-db037-admin@example.com');
select is(
  (public.generate_shifts((select y from t37_mes), (select m from t37_mes)) ->> 'created')::int,
  0,
  'generate_shifts sigue idempotente: la segunda corrida no crea nada'
);
select is(
  (select open_ended::text from public.v_shifts_board where service_id = 'e3700000-0000-0000-0000-0000000000a1' limit 1),
  'true',
  'v_shifts_board expone open_ended de los turnos generados'
);

-- ---------------------------------------------------------------------------------------------
-- 11. v_my_day (celular del empleado) y supervisiones
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db037-emp11@example.com');
select is(
  (select effective_open_ended::text || '|' || no_checkout::text || '|' || effective_end_time::text
   from public.v_my_day where shift_id = tests.shf(11)),
  'true|false|23:59:00',
  'v_my_day: la asignación «A terminar» futura trae effective_open_ended = true y no_checkout = false'
);

set local role postgres;
-- Un turno «A terminar» de hoy+0 que ya terminó el día: simulado con una asignación presente de
-- ayer (v_my_day solo muestra de hoy en adelante), así que se prueba la regla sobre v_assignments_board.
select is(
  (select count(*)::int from public.v_assignments_board where display_status = 'no_checkout' and shift_id = tests.shf(16)),
  1,
  'la asignación abierta con inicio propio y sin salida (turno 16) está «Sin salida»'
);

-- Supervisión sobre un turno «A terminar» (horas de supervisor con tope).
insert into public.supervisions (id, shift_id, supervisor_id, status, assigned_by)
values ('e3700000-0000-0000-0000-0000000004a1', tests.shf(6), 'e3700000-0000-0000-0000-000000000085', 'completed', 'e3700000-0000-0000-0000-000000000081');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e3700000-0000-0000-0000-0000000004a1', 'check_in', tests.at('07:30')),
  ('e3700000-0000-0000-0000-0000000004a1', 'check_out', tests.at('11:00'));
select tests.as_user('test-db037-owner@example.com');
select is(
  (select coalesce(planned_minutes::text, 'null') || '|' || worked_minutes || '|' || shift_open_ended::text
   from public.v_supervisions_admin where id = 'e3700000-0000-0000-0000-0000000004a1'),
  '240|180|false',
  'v_supervisions_admin: el turno 6 ya tiene fin 12:00; el supervisor entró 7:30 y salió 11:00: worked 180 (desde las 8:00), planned 240'
);
select tests.as_user('test-db037-supervisor@example.com');
select is(
  (select shift_open_ended from public.v_my_supervisions where id = 'e3700000-0000-0000-0000-0000000004a1'),
  false,
  'v_my_supervisions expone shift_open_ended'
);

select * from finish();

rollback;
