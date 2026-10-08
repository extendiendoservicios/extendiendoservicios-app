-- pgTAP de las migraciones 0032_p19_5a_enums.sql y 0033_p19_5a_ajustes_reunion.sql (P19.5a,
-- ajustes de la reunión del 6 oct 2026): update_person_name, "En camino" (notify_on_the_way),
-- «Llegada tarde» (display_status late -> no_record a los 15 minutos), horas trabajadas
-- (planned_minutes / worked_minutes), v_employee_ratings, horas de supervisión y el resumen por
-- cliente (client_service_summary, clients_worked_minutes).
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`. Prefijo
-- de fixtures: 'e3300000-...'.
--
-- Control del tiempo: dentro de una transacción `now()` es constante, así que cada turno se arma
-- a partir de INSTANTES relativos a `now()` (hace 5 minutos, dentro de 3 horas, etc.) y la fecha
-- y la hora local de Argentina se derivan del mismo instante (tests.mk_shift). Nada depende de la
-- hora real del día salvo un caso que el modelo no puede armar (sin turnos que crucen la
-- medianoche, ADR-019): "el inicio fue hace 20 minutos y la franja todavía no terminó" no existe
-- entre las 0:00 y las 0:21 de Argentina; esas aserciones salen como `skip` en esa ventana.
-- Las horas trabajadas y el resumen por cliente usan fechas pasadas (hoy menos N días) con horas
-- fijas, sin depender de la hora de la corrida.

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

-- Ejecuta una sentencia y devuelve el `hint` del error (el código estable de 06 sección 15), o el
-- SQLSTATE si el error no trae hint (por ejemplo 42501, permission denied), o null si anduvo.
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

-- Turno a partir de dos instantes. La fecha y las horas locales salen del mismo instante, así
-- app.local_ts(shift_date, start_time) vuelve a dar exactamente p_start. Si el fin cae otro día,
-- se recorta al final del día del inicio (sin turnos que crucen la medianoche).
create or replace function tests.mk_shift(
  p_id uuid, p_client uuid, p_site uuid, p_start timestamptz, p_end timestamptz,
  p_status public.shift_status default 'assigned'
)
returns void
language plpgsql
as $$
declare
  v_date date := (p_start at time zone 'America/Argentina/Buenos_Aires')::date;
  v_start time := (p_start at time zone 'America/Argentina/Buenos_Aires')::time;
  v_end time;
begin
  if (p_end at time zone 'America/Argentina/Buenos_Aires')::date > v_date then
    v_end := '23:59:59.999999';
  else
    v_end := (p_end at time zone 'America/Argentina/Buenos_Aires')::time;
  end if;
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
  values (p_id, p_client, p_site, v_date, v_start, v_end, 10, p_status);
end;
$$;

-- Empleado número n (uuid fijo) y su asignación.
create or replace function tests.emp(p_n int)
returns uuid
language sql
immutable
as $$
  select ('e3300000-0000-0000-0000-0000000001' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

create or replace function tests.asg(p_n int)
returns uuid
language sql
immutable
as $$
  select ('e3300000-0000-0000-0000-0000000003' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

create or replace function tests.shf(p_n int)
returns uuid
language sql
immutable
as $$
  select ('e3300000-0000-0000-0000-0000000002' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

create or replace function tests.mk_asg(p_n int, p_status public.assignment_status default 'expected')
returns void
language sql
as $$
  insert into public.assignments (id, shift_id, employee_id, status)
  values (tests.asg(p_n), tests.shf(p_n), tests.emp(p_n), p_status);
$$;

-- ¿Se puede armar "inicio hace 20 minutos con la franja todavía abierta"? (ver cabecera)
create temporary table t33_flags on commit drop as
select ((now() at time zone 'America/Argentina/Buenos_Aires')::time >= time '00:21') as can_open_window;
grant select on t33_flags to authenticated;

select plan(148);

-- ---------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------

select has_function('public', 'update_person_name', array['uuid', 'text', 'text'], 'existe update_person_name(uuid, text, text)');
select has_function('public', 'notify_on_the_way', array['uuid', 'integer'], 'existe notify_on_the_way(uuid, integer)');
select has_function('public', 'client_service_summary', array['uuid', 'date', 'date'], 'existe client_service_summary(uuid, date, date)');
select has_function('public', 'clients_worked_minutes', array['date', 'date'], 'existe clients_worked_minutes(date, date)');
select has_function('app', 'late_grace_minutes', array[]::text[], 'existe app.late_grace_minutes()');
select has_function('app', 'minutes_between', array['timestamp with time zone', 'timestamp with time zone'], 'existe app.minutes_between(timestamptz, timestamptz)');
select has_view('public', 'v_employee_ratings', 'existe v_employee_ratings');
select has_column('public', 'attendance_notices', 'estimated_arrival_at', 'attendance_notices.estimated_arrival_at existe');
select enum_has_labels('public', 'notice_kind', array['delay', 'absence', 'on_the_way'], 'notice_kind incluye on_the_way');
select is(app.late_grace_minutes(), 15, 'la ventana de «Llegada tarde» son 15 minutos');
select ok(
  pg_get_viewdef('public.v_assignments_board'::regclass) like '%late_grace_minutes%',
  'v_assignments_board lee los 15 minutos de app.late_grace_minutes() (un solo lugar)'
);
select is(app.minutes_between(null, now()), null, 'minutes_between devuelve null si falta un extremo');
select is(app.minutes_between(now(), now() + interval '90 seconds'), 2, 'minutes_between redondea al minuto más cercano (90 s -> 2)');

select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_employee_ratings'::regclass),
  'v_employee_ratings es security_invoker'
);

-- Las columnas nuevas de las vistas van al final y las anteriores no se movieron.
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'public.v_assignments_board'::regclass and attnum > 0 and not attisdropped
   and attnum > (select attnum from pg_attribute where attrelid = 'public.v_assignments_board'::regclass and attname = 'last_notice_at')),
  array['last_notice_estimated_arrival_at', 'planned_minutes', 'worked_minutes'],
  'v_assignments_board: last_notice_estimated_arrival_at, planned_minutes y worked_minutes van al final'
);
select is(
  (select attname::text from pg_attribute where attrelid = 'public.v_my_day'::regclass and attnum > 0 and not attisdropped order by attnum desc offset 1 limit 1),
  'last_notice_estimated_arrival_at',
  'v_my_day: last_notice_estimated_arrival_at es la penúltima (0034 agrega on_the_way_expires_at al final)'
);
select is(
  (select array_agg(attname::text order by attnum) from (
     select attname, attnum from pg_attribute
     where attrelid = 'public.v_supervisions_admin'::regclass and attnum > 0 and not attisdropped
     order by attnum desc limit 2) x),
  array['planned_minutes', 'worked_minutes'],
  'v_supervisions_admin: planned_minutes y worked_minutes son las últimas columnas'
);

-- Grants: anon no ejecuta nada de esto; authenticated sí.
select ok(
  not has_function_privilege('anon', 'public.update_person_name(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.notify_on_the_way(uuid, integer)', 'execute')
    and not has_function_privilege('anon', 'public.client_service_summary(uuid, date, date)', 'execute')
    and not has_function_privilege('anon', 'public.clients_worked_minutes(date, date)', 'execute'),
  'anon no puede ejecutar ninguna de las RPC nuevas'
);
select ok(
  has_function_privilege('authenticated', 'public.update_person_name(uuid, text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.notify_on_the_way(uuid, integer)', 'execute')
    and has_function_privilege('authenticated', 'public.client_service_summary(uuid, date, date)', 'execute')
    and has_function_privilege('authenticated', 'public.clients_worked_minutes(date, date)', 'execute'),
  'authenticated puede ejecutar las RPC nuevas (la autorización la hace cada RPC)'
);
select ok(
  not has_table_privilege('anon', 'public.v_employee_ratings', 'select')
    and has_table_privilege('authenticated', 'public.v_employee_ratings', 'select'),
  'v_employee_ratings: sin acceso para anon, select para authenticated'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e3300000-0000-0000-0000-000000000081', 'test-db033-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Uno')),
  ('e3300000-0000-0000-0000-000000000082', 'test-db033-owner2@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Dos')),
  ('e3300000-0000-0000-0000-000000000083', 'test-db033-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConPermisos')),
  ('e3300000-0000-0000-0000-000000000084', 'test-db033-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinPermisos')),
  ('e3300000-0000-0000-0000-000000000085', 'test-db033-supervisor@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e3300000-0000-0000-0000-000000000086', 'test-db033-inactivo@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Inactivo'));

insert into auth.users (id, email, raw_user_meta_data)
select tests.emp(n), 'test-db033-emp' || n || '@example.com',
       jsonb_build_object('first_name', 'Emp', 'last_name', 'Numero' || n)
from generate_series(1, 40) n;

insert into public.user_roles (profile_id, role) values
  ('e3300000-0000-0000-0000-000000000081', 'owner'),
  ('e3300000-0000-0000-0000-000000000082', 'owner'),
  ('e3300000-0000-0000-0000-000000000083', 'admin'),
  ('e3300000-0000-0000-0000-000000000084', 'admin'),
  ('e3300000-0000-0000-0000-000000000085', 'supervisor'),
  ('e3300000-0000-0000-0000-000000000086', 'employee');

insert into public.user_roles (profile_id, role)
select tests.emp(n), 'employee' from generate_series(1, 40) n;

-- El admin con permisos tiene manage_attendance (para probar que ni así puede avisar "en camino").
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e3300000-0000-0000-0000-000000000083', 'manage_attendance', true),
  ('e3300000-0000-0000-0000-000000000084', 'manage_attendance', false);

insert into public.employees (profile_id, dni) values
  ('e3300000-0000-0000-0000-000000000085', '93300085'),
  ('e3300000-0000-0000-0000-000000000086', '93300086');

insert into public.employees (profile_id, dni)
select tests.emp(n), (93300100 + n)::text from generate_series(1, 40) n;

insert into public.clients (id, legal_name, status) values
  ('e3300000-0000-0000-0000-000000000011', 'Cliente 0033 principal', 'active'),
  ('e3300000-0000-0000-0000-000000000012', 'Cliente 0033 sin servicios', 'active'),
  ('e3300000-0000-0000-0000-000000000013', 'Cliente 0033 fuera de rango', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('e3300000-0000-0000-0000-000000000021', 'e3300000-0000-0000-0000-000000000011', 'Sede A 0033', 'Calle 1', 'active'),
  ('e3300000-0000-0000-0000-000000000022', 'e3300000-0000-0000-0000-000000000011', 'Sede B 0033', 'Calle 2', 'active'),
  ('e3300000-0000-0000-0000-000000000023', 'e3300000-0000-0000-0000-000000000012', 'Sede C 0033', 'Calle 3', 'active'),
  ('e3300000-0000-0000-0000-000000000024', 'e3300000-0000-0000-0000-000000000013', 'Sede D 0033', 'Calle 4', 'active');

-- Una persona desactivada (para "perfil activo" en update_person_name).
update public.profiles set is_active = false where id = 'e3300000-0000-0000-0000-000000000086';

-- ---------------------------------------------------------------------------------------------
-- 1. update_person_name
-- ---------------------------------------------------------------------------------------------

-- Dueño sobre otra persona, con espacios de más.
select tests.as_user('test-db033-owner@example.com');

select is(
  (select first_name || '|' || last_name from public.update_person_name(tests.emp(1), '  Ana   María ', ' De la  Torre ')),
  'Ana María|De la Torre',
  'dueño: cambia el nombre de un empleado y compacta los espacios'
);

set local role postgres;
select is(
  (select first_name || '|' || last_name from public.profiles where id = tests.emp(1)),
  'Ana María|De la Torre',
  'el cambio quedó guardado en profiles'
);
select is(
  (select updated_by from public.profiles where id = tests.emp(1)),
  'e3300000-0000-0000-0000-000000000081'::uuid,
  'updated_by queda con quien hizo el cambio'
);
select is(
  (select details from public.security_events
   where event_type = 'name_changed' and target_id = tests.emp(1) and actor_id = 'e3300000-0000-0000-0000-000000000081'),
  jsonb_build_object(
    'first_name_previous', 'Emp', 'last_name_previous', 'Numero1',
    'first_name_new', 'Ana María', 'last_name_new', 'De la Torre'
  ),
  'security_events: name_changed con quién, a quién, nombre anterior y nuevo'
);
select is(
  coalesce(current_setting('app.allow_name_update', true), ''),
  '',
  'la marca interna app.allow_name_update queda limpia al terminar'
);

-- Dueño sobre sí mismo y sobre otro dueño.
select tests.as_user('test-db033-owner@example.com');
select is(
  (select first_name from public.update_person_name('e3300000-0000-0000-0000-000000000081', 'Dueña', 'Primera')),
  'Dueña',
  'dueño: puede cambiar su propio nombre'
);
select is(
  (select last_name from public.update_person_name('e3300000-0000-0000-0000-000000000082', 'Dueño', 'Segundo')),
  'Segundo',
  'dueño: puede cambiar el nombre de otro dueño'
);
select is(
  (select first_name from public.update_person_name(tests.emp(40), 'Sup', 'Ervisor')),
  'Sup',
  'dueño: puede cambiar el nombre de cualquier empleado'
);

-- Sin cambios: no escribe ni deja rastro.
set local role postgres;
select is(
  (select count(*)::int from public.security_events where event_type = 'name_changed' and target_id = tests.emp(1)),
  1,
  'hasta acá hay un solo evento name_changed para el empleado 1'
);
select tests.as_user('test-db033-owner@example.com');
select lives_ok(
  $$select public.update_person_name(tests.emp(1), 'Ana María', 'De la Torre')$$,
  'repetir el mismo nombre no falla'
);
set local role postgres;
select is(
  (select count(*)::int from public.security_events where event_type = 'name_changed' and target_id = tests.emp(1)),
  1,
  'repetir el mismo nombre no agrega otro evento'
);

-- Validaciones.
select tests.as_user('test-db033-owner@example.com');
select is(tests.err_hint($$select public.update_person_name(tests.emp(1), '   ', 'X')$$), 'NAME_REQUIRED', 'nombre vacío: NAME_REQUIRED');
select is(tests.err_hint($$select public.update_person_name(tests.emp(1), 'X', '')$$), 'NAME_REQUIRED', 'apellido vacío: NAME_REQUIRED');
select is(tests.err_hint($$select public.update_person_name(tests.emp(1), null, 'X')$$), 'NAME_REQUIRED', 'nombre nulo: NAME_REQUIRED');
select is(tests.err_hint($$select public.update_person_name(tests.emp(1), repeat('a', 101), 'X')$$), 'NAME_TOO_LONG', '101 caracteres: NAME_TOO_LONG');
select lives_ok($$select public.update_person_name(tests.emp(1), repeat('a', 100), 'X')$$, '100 caracteres anda');
select is(tests.err_hint($$select public.update_person_name('e3300000-0000-0000-0000-0000000fffff', 'A', 'B')$$), 'PROFILE_NOT_FOUND', 'dueño sobre una persona que no existe: PROFILE_NOT_FOUND');
select is(tests.err_hint($$select public.update_person_name(null, 'A', 'B')$$), 'PROFILE_NOT_FOUND', 'dueño con id nulo: PROFILE_NOT_FOUND');

-- Empleado: solo la propia.
select tests.as_user('test-db033-emp2@example.com');
select is(
  (select first_name || '|' || last_name from public.update_person_name(tests.emp(2), 'Bea', 'Pérez')),
  'Bea|Pérez',
  'empleado: cambia su propio nombre (Mi perfil)'
);
select is(tests.err_hint($$select public.update_person_name(tests.emp(3), 'Otro', 'Nombre')$$), 'FORBIDDEN', 'empleado: no cambia el de otro');
select is(tests.err_hint($$select public.update_person_name('e3300000-0000-0000-0000-0000000fffff', 'A', 'B')$$), 'FORBIDDEN', 'empleado sobre un id inexistente: FORBIDDEN (no revela quién existe)');
select throws_ok(
  $$update public.profiles set first_name = 'Directo' where id = tests.emp(2)$$,
  'P0001', null,
  'empleado: el update directo de su nombre sigue bloqueado por el trigger'
);
set local role postgres;
select is(
  (select details ->> 'first_name_previous' from public.security_events
   where event_type = 'name_changed' and actor_id = tests.emp(2) and target_id = tests.emp(2)),
  'Emp',
  'el cambio del empleado sobre sí mismo deja su evento'
);

-- Supervisor.
select tests.as_user('test-db033-supervisor@example.com');
select is((select first_name from public.update_person_name('e3300000-0000-0000-0000-000000000085', 'Supervisora', 'Visora')), 'Supervisora', 'supervisor: cambia su propio nombre');
select is(tests.err_hint($$select public.update_person_name(tests.emp(3), 'X', 'Y')$$), 'FORBIDDEN', 'supervisor: no cambia el de otro');

-- Administrador: solo el propio por esta vía.
select tests.as_user('test-db033-admin@example.com');
select is((select first_name from public.update_person_name('e3300000-0000-0000-0000-000000000083', 'Admina', 'ConPermisos')), 'Admina', 'administrador: cambia su propio nombre');
select is(tests.err_hint($$select public.update_person_name(tests.emp(3), 'X', 'Y')$$), 'FORBIDDEN', 'administrador: no cambia el de un empleado por esta vía');
select is(tests.err_hint($$select public.update_person_name('e3300000-0000-0000-0000-000000000082', 'X', 'Y')$$), 'FORBIDDEN', 'administrador: no cambia el de un dueño');
select lives_ok(
  $$update public.profiles set first_name = 'Edición', last_name = 'Directa' where id = tests.emp(3)$$,
  'administrador: la ficha del empleado sigue usando el update directo de profiles'
);

-- Persona desactivada y anónimo.
select tests.as_user('test-db033-inactivo@example.com');
select is(
  tests.err_hint($$select public.update_person_name('e3300000-0000-0000-0000-000000000086', 'Vuelve', 'Atrás')$$),
  'FORBIDDEN',
  'una persona desactivada no cambia ni su propio nombre'
);
set local role anon;
select is(
  tests.err_hint($$select public.update_person_name('e3300000-0000-0000-0000-000000000086', 'A', 'B')$$),
  '42501',
  'anon: permission denied al ejecutar update_person_name'
);
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. notify_on_the_way
-- ---------------------------------------------------------------------------------------------

select tests.mk_shift(tests.shf(11), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '2 hours', now() + interval '3 hours');
select tests.mk_asg(11);
select tests.mk_shift(tests.shf(12), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '3 hours', now() + interval '4 hours');
select tests.mk_asg(12);
select tests.mk_shift(tests.shf(13), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '3 hours 1 minute', now() + interval '4 hours');
select tests.mk_asg(13);
select tests.mk_shift(tests.shf(14), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '3 hours', now() - interval '2 hours');
select tests.mk_asg(14);
-- 15: en pleno servicio (inicio hace 10 minutos o a las 0:00, lo que sea más tarde)
select tests.mk_shift(
  tests.shf(15), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  greatest(now() - interval '10 minutes', app.local_ts(app.today(), time '00:00')),
  greatest(now() - interval '10 minutes', app.local_ts(app.today(), time '00:00')) + interval '1 hour'
);
select tests.mk_asg(15);
select tests.mk_shift(tests.shf(16), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(16, 'present');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
values (tests.asg(16), 'check_in', now(), 'employee_app', tests.emp(16));
select tests.mk_shift(tests.shf(17), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(17, 'absence_notified');
select tests.mk_shift(tests.shf(18), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(18);
update public.assignments set removed_at = now(), removed_by = 'e3300000-0000-0000-0000-000000000081', removed_reason = 'prueba' where id = tests.asg(18);
select tests.mk_shift(tests.shf(19), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(19);
update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'e3300000-0000-0000-0000-000000000081', cancel_reason = 'prueba' where id = tests.shf(19);
select tests.mk_shift(tests.shf(20), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours', 'completed');
select tests.mk_asg(20);
select tests.mk_shift(tests.shf(21), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(21);

-- Camino feliz: empleado 11, inicio dentro de 2 horas.
select tests.as_user('test-db033-emp11@example.com');
select is(
  (select kind::text from public.notify_on_the_way(tests.asg(11), 30)),
  'on_the_way',
  'empleado: avisa que sale (kind on_the_way)'
);
select is(
  (select estimated_arrival_at from public.attendance_notices where assignment_id = tests.asg(11) order by created_at desc limit 1),
  now() + interval '30 minutes',
  'estimated_arrival_at = now() + minutos informados'
);
select is(
  (select source::text || '|' || reported_by::text from public.attendance_notices where assignment_id = tests.asg(11) limit 1),
  'employee_app|' || tests.emp(11)::text,
  'el aviso queda con origen employee_app y reported_by = quien avisó'
);
select is((select status::text from public.assignments where id = tests.asg(11)), 'expected', 'la asignación sigue "esperada": en camino no cambia assignments.status');

select is(
  (select last_notice_kind::text || '|' || (last_notice_estimated_arrival_at = now() + interval '30 minutes')::text from public.v_my_day where assignment_id = tests.asg(11)),
  'on_the_way|true',
  'v_my_day: el empleado ve que avisó en camino y su hora estimada'
);

-- Repetir actualiza la estimación: el último manda.
select lives_ok($$select public.notify_on_the_way(tests.asg(11), 45)$$, 'repetir el aviso con otra estimación anda');
select is(
  (select count(*)::int from public.attendance_notices where assignment_id = tests.asg(11) and kind = 'on_the_way'),
  2,
  'repetir el aviso agrega otro (historial); no pisa el anterior'
);
select is(
  (select last_notice_estimated_arrival_at = now() + interval '45 minutes' from public.v_my_day where assignment_id = tests.asg(11)),
  true,
  'v_my_day: manda la última estimación (45 min)'
);
select lives_ok($$select public.notify_on_the_way(tests.asg(11))$$, 'sin p_eta_minutes también anda');
select is(
  (select last_notice_estimated_arrival_at from public.v_my_day where assignment_id = tests.asg(11)),
  null::timestamptz,
  'sin estimación: el último aviso deja la hora estimada en null'
);

-- Ventana: exactamente 3 horas antes anda; un minuto antes de eso, no.
select tests.as_user('test-db033-emp12@example.com');
select lives_ok($$select public.notify_on_the_way(tests.asg(12), 10)$$, 'a exactamente 3 horas del inicio ya se puede avisar');
select tests.as_user('test-db033-emp13@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(13), 10)$$), 'ON_THE_WAY_TOO_EARLY', 'a más de 3 horas del inicio: ON_THE_WAY_TOO_EARLY');
select tests.as_user('test-db033-emp14@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(14), 10)$$), 'ON_THE_WAY_TOO_LATE', 'después del fin efectivo: ON_THE_WAY_TOO_LATE');
select tests.as_user('test-db033-emp15@example.com');
select lives_ok($$select public.notify_on_the_way(tests.asg(15), 5)$$, 'con el servicio en marcha y sin fichar todavía se puede avisar');

-- Después de avisar, el fichaje normal sigue igual.
select lives_ok($$select public.record_check_in(tests.asg(15))$$, 'record_check_in después de en camino: sigue funcionando igual');
select is((select status::text from public.assignments where id = tests.asg(15)), 'present', 'record_check_in después de en camino: la asignación pasa a present como siempre');

-- Rechazos.
select tests.as_user('test-db033-emp16@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(16), 10)$$), 'ASSIGNMENT_STARTED', 'ya fichó el inicio: ASSIGNMENT_STARTED');
select tests.as_user('test-db033-emp17@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(17), 10)$$), 'ABSENCE_ALREADY_NOTIFIED', 'ya avisó ausencia: ABSENCE_ALREADY_NOTIFIED');
select tests.as_user('test-db033-emp18@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(18), 10)$$), 'ASSIGNMENT_NOT_FOUND', 'asignación quitada: ASSIGNMENT_NOT_FOUND');
select tests.as_user('test-db033-emp19@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(19), 10)$$), 'SHIFT_CANCELLED', 'turno cancelado: SHIFT_CANCELLED');
select tests.as_user('test-db033-emp20@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(20), 10)$$), 'SHIFT_COMPLETED', 'turno finalizado: SHIFT_COMPLETED');
select is(tests.err_hint($$select public.notify_on_the_way('e3300000-0000-0000-0000-0000000fffff', 10)$$), 'ASSIGNMENT_NOT_FOUND', 'asignación inexistente: ASSIGNMENT_NOT_FOUND');

select tests.as_user('test-db033-emp21@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(21), 0)$$), 'INVALID_ETA', 'estimación 0: INVALID_ETA');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(21), 241)$$), 'INVALID_ETA', 'estimación 241: INVALID_ETA');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(21), -5)$$), 'INVALID_ETA', 'estimación negativa: INVALID_ETA');
select lives_ok($$select public.notify_on_the_way(tests.asg(21), 1)$$, 'estimación 1 anda');
select lives_ok($$select public.notify_on_the_way(tests.asg(21), 240)$$, 'estimación 240 anda');

-- Solo el empleado de esa asignación.
select tests.as_user('test-db033-emp2@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), 'NOT_YOUR_ASSIGNMENT', 'otro empleado: NOT_YOUR_ASSIGNMENT');
select tests.as_user('test-db033-supervisor@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), 'FORBIDDEN', 'supervisor: FORBIDDEN');
select tests.as_user('test-db033-admin@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), 'FORBIDDEN', 'administrador (aun con manage_attendance): FORBIDDEN');
select tests.as_user('test-db033-admin-sin-cap@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), 'FORBIDDEN', 'administrador sin permisos: FORBIDDEN');
select tests.as_user('test-db033-owner@example.com');
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), 'FORBIDDEN', 'dueño: FORBIDDEN (el aviso lo hace el empleado)');
set local role anon;
select is(tests.err_hint($$select public.notify_on_the_way(tests.asg(11), 10)$$), '42501', 'anon: permission denied');
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. display_status: late -> no_record, on_the_way mientras no venza (el vencimiento se prueba en 0034)
-- ---------------------------------------------------------------------------------------------

-- 22: inicio hace 5 minutos, esperado -> late
select tests.mk_shift(tests.shf(22), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '5 minutes', now() + interval '1 hour');
select tests.mk_asg(22);
-- 23: inicio hace 20 minutos -> no_record
select tests.mk_shift(tests.shf(23), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(23);
-- 24: justo 15 minutos -> late (el minuto 15 exacto todavía es gracia)
select tests.mk_shift(tests.shf(24), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '15 minutes', now() + interval '1 hour');
select tests.mk_asg(24);
-- 25: 15 minutos y 1 segundo -> no_record
select tests.mk_shift(tests.shf(25), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '15 minutes 1 second', now() + interval '1 hour');
select tests.mk_asg(25);
-- 26 / 27: demora avisada, hace 5 y 20 minutos
select tests.mk_shift(tests.shf(26), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '5 minutes', now() + interval '1 hour');
select tests.mk_asg(26, 'delay_notified');
select tests.mk_shift(tests.shf(27), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(27, 'delay_notified');
-- 28: aún no empezó -> expected
select tests.mk_shift(tests.shf(28), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(28);
-- 29: ausencia avisada, hace 20 minutos -> absence_notified (no se pisa)
select tests.mk_shift(tests.shf(29), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(29, 'absence_notified');
-- 30: presente hace 20 minutos -> present
select tests.mk_shift(tests.shf(30), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(30, 'present');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
values (tests.asg(30), 'check_in', now() - interval '18 minutes', 'employee_app', tests.emp(30));
-- 31: en camino con estimación futura, inicio hace 20 minutos, franja abierta -> on_the_way (el aviso no venció: estimación + 15 min, 0034)
select tests.mk_shift(tests.shf(31), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(31);
insert into public.attendance_notices (assignment_id, kind, estimated_arrival_at, reported_by, source)
values (tests.asg(31), 'on_the_way', now() + interval '10 minutes', tests.emp(31), 'employee_app');
-- 32: en camino sin estimación, inicio hace 5 minutos -> on_the_way (vence a inicio + 15 min, 0034)
select tests.mk_shift(tests.shf(32), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '5 minutes', now() + interval '1 hour');
select tests.mk_asg(32);
insert into public.attendance_notices (assignment_id, kind, reported_by, source)
values (tests.asg(32), 'on_the_way', tests.emp(32), 'employee_app');
-- 33: en camino pero la franja ya terminó -> no_record
select tests.mk_shift(tests.shf(33), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '3 hours', now() - interval '2 hours');
select tests.mk_asg(33);
insert into public.attendance_notices (assignment_id, kind, reported_by, source)
values (tests.asg(33), 'on_the_way', tests.emp(33), 'employee_app');
-- 34: en camino y después fichó -> present
select tests.mk_shift(tests.shf(34), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() - interval '20 minutes', now() + interval '1 hour');
select tests.mk_asg(34, 'present');
insert into public.attendance_notices (assignment_id, kind, reported_by, source, created_at)
values (tests.asg(34), 'on_the_way', tests.emp(34), 'employee_app', now() - interval '30 minutes');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
values (tests.asg(34), 'check_in', now() - interval '10 minutes', 'employee_app', tests.emp(34));
-- 35: en camino y después avisó demora (más nuevo), inicio en el futuro -> delay_notified
select tests.mk_shift(tests.shf(35), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(35, 'delay_notified');
insert into public.attendance_notices (assignment_id, kind, reported_by, source, created_at)
values (tests.asg(35), 'on_the_way', tests.emp(35), 'employee_app', now() - interval '5 minutes');
insert into public.attendance_notices (assignment_id, kind, minutes_late, reported_by, source, created_at)
values (tests.asg(35), 'delay', 20, tests.emp(35), 'employee_app', now());
-- 36: en camino con inicio en el futuro -> on_the_way (aún antes de la hora)
select tests.mk_shift(tests.shf(36), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', now() + interval '1 hour', now() + interval '2 hours');
select tests.mk_asg(36);
insert into public.attendance_notices (assignment_id, kind, reported_by, source)
values (tests.asg(36), 'on_the_way', tests.emp(36), 'employee_app');

select tests.as_user('test-db033-owner@example.com');

select is((select display_status from public.v_assignments_board where id = tests.asg(22)), 'late', 'inicio hace 5 minutos sin fichar: late («Llegada tarde»)');
select is((select display_status from public.v_assignments_board where id = tests.asg(23)), 'no_record', 'inicio hace 20 minutos sin fichar: no_record');
select is((select display_status from public.v_assignments_board where id = tests.asg(24)), 'late', 'a los 15 minutos exactos todavía es late');
select is((select display_status from public.v_assignments_board where id = tests.asg(25)), 'no_record', 'a los 15 minutos y 1 segundo ya es no_record');
select is((select display_status from public.v_assignments_board where id = tests.asg(26)), 'late', 'demora avisada, hace 5 minutos: late');
select is((select display_status from public.v_assignments_board where id = tests.asg(27)), 'no_record', 'demora avisada, hace 20 minutos: no_record');
select is((select display_status from public.v_assignments_board where id = tests.asg(28)), 'expected', 'todavía no empezó: expected');
select is((select display_status from public.v_assignments_board where id = tests.asg(29)), 'absence_notified', 'ausencia avisada: sigue absence_notified');
select is((select display_status from public.v_assignments_board where id = tests.asg(30)), 'present', 'ya fichó: present');

select is(
  (select display_status from public.v_assignments_board where id = tests.asg(31)),
  'on_the_way',
  'en camino con estimación futura, inicio hace 20 minutos: on_the_way (aún no venció, 0034)'
) where (select can_open_window from t33_flags);
select skip(1, 'entre las 0:00 y las 0:21 no se puede armar un inicio de hace 20 minutos con la franja abierta (sin turnos que crucen la medianoche)')
where not (select can_open_window from t33_flags);

select is(
  (select display_status from public.v_assignments_board where id = tests.asg(32)),
  'on_the_way',
  'en camino sin estimación, inicio hace 5 minutos: on_the_way (vence a los 15 minutos del inicio, 0034)'
) where (select can_open_window from t33_flags);
select skip(1, 'entre las 0:00 y las 0:21 no se puede armar un inicio reciente con la franja abierta')
where not (select can_open_window from t33_flags);

select is((select display_status from public.v_assignments_board where id = tests.asg(33)), 'no_record', 'en camino pero con la franja terminada: no_record');
select is((select display_status from public.v_assignments_board where id = tests.asg(34)), 'present', 'en camino y después fichó: present');
select is((select display_status from public.v_assignments_board where id = tests.asg(35)), 'delay_notified', 'un aviso de demora posterior reemplaza al de en camino');
select is((select display_status from public.v_assignments_board where id = tests.asg(36)), 'on_the_way', 'en camino antes de la hora de inicio: on_the_way');
select is(
  (select last_notice_estimated_arrival_at from public.v_assignments_board where id = tests.asg(31)),
  now() + interval '10 minutes',
  'v_assignments_board expone last_notice_estimated_arrival_at'
);
select is(
  (select last_notice_kind::text from public.v_assignments_board where id = tests.asg(31)),
  'on_the_way',
  'v_assignments_board: last_notice_kind = on_the_way'
);
select is(
  (select count(*)::int from public.v_assignments_board where display_status = 'late' and id in (tests.asg(22), tests.asg(24), tests.asg(26))),
  3,
  'la planilla puede filtrar por late'
);

-- ---------------------------------------------------------------------------------------------
-- 4. Horas trabajadas (planned_minutes / worked_minutes)
-- ---------------------------------------------------------------------------------------------

set local role postgres;

-- Turnos de hace 3 días de 08:00 a 16:00 (480 minutos).
select tests.mk_shift(tests.shf(37), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 3, time '08:00'), app.local_ts(app.today() - 3, time '16:00'), 'completed');
select tests.mk_shift(tests.shf(38), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 3, time '08:00'), app.local_ts(app.today() - 3, time '16:00'), 'completed');
select tests.mk_shift(tests.shf(39), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 3, time '08:00'), app.local_ts(app.today() - 3, time '16:00'), 'in_progress');
select tests.mk_shift(tests.shf(40), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 3, time '08:00'), app.local_ts(app.today() - 3, time '16:00'), 'assigned');
select tests.mk_asg(37, 'finished');
select tests.mk_asg(38, 'finished');
select tests.mk_asg(39, 'present');
select tests.mk_asg(40, 'expected');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  (tests.asg(37), 'check_in', app.local_ts(app.today() - 3, time '08:03'), 'employee_app', tests.emp(37)),
  (tests.asg(37), 'check_out', app.local_ts(app.today() - 3, time '16:10'), 'employee_app', tests.emp(37)),
  (tests.asg(38), 'check_in', app.local_ts(app.today() - 3, time '08:00'), 'employee_app', tests.emp(38)),
  (tests.asg(38), 'check_out', app.local_ts(app.today() - 3, time '15:50'), 'employee_app', tests.emp(38)),
  (tests.asg(39), 'check_in', app.local_ts(app.today() - 3, time '08:00'), 'employee_app', tests.emp(39));

select tests.as_user('test-db033-admin@example.com');

select is(
  (select planned_minutes || '|' || worked_minutes || '|' || coalesce(minutes_early_leave::text, 'null') from public.v_assignments_board where id = tests.asg(37)),
  '480|487|null',
  'jornada completa con 10 minutos de más: planned 480, worked 487 (tilde verde: worked >= planned)'
);
select is(
  (select planned_minutes || '|' || worked_minutes || '|' || coalesce(minutes_early_leave::text, 'null') from public.v_assignments_board where id = tests.asg(38)),
  '480|470|10',
  'salida anticipada de 10 minutos: worked 470 < planned 480 (advertencia)'
);
select is(
  (select planned_minutes || '|' || coalesce(worked_minutes::text, 'null') from public.v_assignments_board where id = tests.asg(39)),
  '480|null',
  'con inicio y sin fin: planned 480, worked null'
);
select is(
  (select planned_minutes || '|' || coalesce(worked_minutes::text, 'null') from public.v_assignments_board where id = tests.asg(40)),
  '480|null',
  'sin fichajes: planned 480, worked null'
);

set local role postgres;
-- Franja propia de la asignación (09:00 a 12:00 dentro del turno de 08:00 a 16:00).
select tests.mk_shift(tests.shf(1), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 4, time '08:00'), app.local_ts(app.today() - 4, time '16:00'), 'completed');
insert into public.assignments (id, shift_id, employee_id, status, start_time, end_time)
values ('e3300000-0000-0000-0000-0000000003a1', tests.shf(1), tests.emp(4), 'finished', '09:00', '12:00');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  ('e3300000-0000-0000-0000-0000000003a1', 'check_in', app.local_ts(app.today() - 4, time '09:00'), 'employee_app', tests.emp(4)),
  ('e3300000-0000-0000-0000-0000000003a1', 'check_out', app.local_ts(app.today() - 4, time '12:00'), 'employee_app', tests.emp(4));
select is(
  (select planned_minutes || '|' || worked_minutes from public.v_assignments_board where id = 'e3300000-0000-0000-0000-0000000003a1'),
  '180|180',
  'franja propia de la asignación: planned 180, worked 180 (igual al previsto: tilde, sin margen)'
);

-- fetchEmployeeAttendanceHistory: filtra por employee_id y fecha sobre esta vista; las horas
-- salen de las mismas columnas.
select tests.as_user('test-db033-owner@example.com');
select is(
  (select sum(worked_minutes)::int from public.v_assignments_board
   where employee_id in (tests.emp(37), tests.emp(38)) and shift_date = app.today() - 3),
  957,
  'el total del rango se suma de worked_minutes de las filas del historial (487 + 470)'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Horas de un supervisor (v_supervisions_admin)
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select tests.mk_shift(tests.shf(2), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000022',
  app.local_ts(app.today() - 5, time '10:00'), app.local_ts(app.today() - 5, time '14:00'), 'completed');
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e3300000-0000-0000-0000-0000000004a1', tests.shf(2), 'e3300000-0000-0000-0000-000000000085', 'completed');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e3300000-0000-0000-0000-0000000004a1', 'check_in', app.local_ts(app.today() - 5, time '10:05')),
  ('e3300000-0000-0000-0000-0000000004a1', 'check_out', app.local_ts(app.today() - 5, time '11:35'));
select tests.mk_shift(tests.shf(3), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000022',
  app.local_ts(app.today() - 6, time '10:00'), app.local_ts(app.today() - 6, time '14:00'), 'completed');
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e3300000-0000-0000-0000-0000000004a2', tests.shf(3), 'e3300000-0000-0000-0000-000000000085', 'in_progress');
insert into public.supervision_attendance (supervision_id, kind, recorded_at) values
  ('e3300000-0000-0000-0000-0000000004a2', 'check_in', app.local_ts(app.today() - 6, time '10:00'));

select tests.as_user('test-db033-admin-sin-cap@example.com');
select is(
  (select shift_date::text || '|' || client_legal_name || '|' || site_name || '|' || start_time::text || '|' || end_time::text || '|' || planned_minutes || '|' || worked_minutes
   from public.v_supervisions_admin where id = 'e3300000-0000-0000-0000-0000000004a1'),
  (app.today() - 5)::text || '|Cliente 0033 principal|Sede B 0033|10:00:00|14:00:00|240|90',
  'v_supervisions_admin: fecha, cliente, sede, franja, planned 240 y worked 90 de la supervisión'
);
select is(
  (select coalesce(worked_minutes::text, 'null') from public.v_supervisions_admin where id = 'e3300000-0000-0000-0000-0000000004a2'),
  'null',
  'supervisión con inicio y sin fin: worked_minutes null'
);
select tests.as_user('test-db033-supervisor@example.com');
select is(
  (select count(*)::int from public.v_supervisions_admin),
  (select count(*)::int from public.supervisions where supervisor_id = 'e3300000-0000-0000-0000-000000000085'),
  'v_supervisions_admin: la RLS no cambió, el supervisor ve solo sus propias supervisiones (con sus minutos)'
);

-- ---------------------------------------------------------------------------------------------
-- 6. v_employee_ratings
-- ---------------------------------------------------------------------------------------------

set local role postgres;
-- El empleado 5 recibe 5, 4 y 4 en tres turnos de días distintos; el 6 no recibe nada.
select tests.mk_shift(tests.shf(4), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', app.local_ts(app.today() - 7, time '08:00'), app.local_ts(app.today() - 7, time '09:00'), 'completed');
select tests.mk_shift(tests.shf(5), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', app.local_ts(app.today() - 8, time '08:00'), app.local_ts(app.today() - 8, time '09:00'), 'completed');
select tests.mk_shift(tests.shf(6), 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021', app.local_ts(app.today() - 9, time '08:00'), app.local_ts(app.today() - 9, time '09:00'), 'completed');
insert into public.assignments (id, shift_id, employee_id, status) values
  ('e3300000-0000-0000-0000-0000000003b4', tests.shf(4), tests.emp(5), 'finished'),
  ('e3300000-0000-0000-0000-0000000003b5', tests.shf(5), tests.emp(5), 'finished'),
  ('e3300000-0000-0000-0000-0000000003b6', tests.shf(6), tests.emp(5), 'finished'),
  ('e3300000-0000-0000-0000-0000000003b7', tests.shf(4), tests.emp(6), 'finished');
insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('e3300000-0000-0000-0000-0000000004b4', tests.shf(4), 'e3300000-0000-0000-0000-000000000085', 'completed'),
  ('e3300000-0000-0000-0000-0000000004b5', tests.shf(5), 'e3300000-0000-0000-0000-000000000085', 'completed'),
  ('e3300000-0000-0000-0000-0000000004b6', tests.shf(6), 'e3300000-0000-0000-0000-000000000085', 'completed');
insert into public.ratings (supervision_id, assignment_id, score) values
  ('e3300000-0000-0000-0000-0000000004b4', 'e3300000-0000-0000-0000-0000000003b4', 5),
  ('e3300000-0000-0000-0000-0000000004b5', 'e3300000-0000-0000-0000-0000000003b5', 4),
  ('e3300000-0000-0000-0000-0000000004b6', 'e3300000-0000-0000-0000-0000000003b6', 4);

select tests.as_user('test-db033-owner@example.com');
select is(
  (select ratings_count || '|' || ratings_avg from public.v_employee_ratings where employee_id = tests.emp(5)),
  '3|4.33',
  'dueño: empleado con tres calificaciones (5, 4, 4): cuenta 3, promedio 4.33'
);
select is(
  (select ratings_count || '|' || coalesce(ratings_avg::text, 'null') from public.v_employee_ratings where employee_id = tests.emp(6)),
  '0|null',
  'dueño: empleado sin calificaciones aparece con 0 y promedio null'
);
select is(
  (select count(*)::int from public.v_employee_ratings where employee_id in (select profile_id from public.employees)),
  (select count(*)::int from public.employees),
  'dueño: el listado trae una fila por cada empleado'
);
select tests.as_user('test-db033-admin-sin-cap@example.com');
select is(
  (select ratings_count || '|' || ratings_avg from public.v_employee_ratings where employee_id = tests.emp(5)),
  '3|4.33',
  'administrador (sin permisos opcionales): ve el promedio'
);
select tests.as_user('test-db033-supervisor@example.com');
select is(
  (select count(*)::int from public.v_employee_ratings),
  0,
  'supervisor: v_employee_ratings no devuelve filas'
);
select tests.as_user('test-db033-emp5@example.com');
select is(
  (select count(*)::int from public.v_employee_ratings),
  0,
  'empleado: no ve ni su propio promedio'
);
set local role anon;
select is(tests.err_hint($$select * from public.v_employee_ratings$$), '42501', 'anon: permission denied en v_employee_ratings');
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 7. Resumen por cliente
-- ---------------------------------------------------------------------------------------------

-- Cliente principal, ventana de -20 a -10 días respecto de hoy.
-- S1 (-12): 08:00-12:00, finalizado, dos empleados: 240 y 210 minutos.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c1', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 12, time '08:00'), app.local_ts(app.today() - 12, time '12:00'), 'completed');
-- S2 (-11): 14:00-18:00, en curso, un inicio sin fin (cuenta como realizado, sin minutos).
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c2', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000022',
  app.local_ts(app.today() - 11, time '14:00'), app.local_ts(app.today() - 11, time '18:00'), 'in_progress');
-- S3 (-13): programado sin fichajes: no es realizado.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c3', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 13, time '08:00'), app.local_ts(app.today() - 13, time '12:00'), 'assigned');
-- S4 (-14): cancelado: no cuenta.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c4', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 14, time '08:00'), app.local_ts(app.today() - 14, time '12:00'), 'assigned');
update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'e3300000-0000-0000-0000-000000000081', cancel_reason = 'prueba'
where id = 'e3300000-0000-0000-0000-0000000002c4';
-- S5 (-30): fuera del rango, finalizado.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c5', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000021',
  app.local_ts(app.today() - 30, time '08:00'), app.local_ts(app.today() - 30, time '12:00'), 'completed');
-- S6 (-15): finalizado con una sola persona que avisó ausencia: realizado por estar finalizado, 0 minutos.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c6', 'e3300000-0000-0000-0000-000000000011', 'e3300000-0000-0000-0000-000000000022',
  app.local_ts(app.today() - 15, time '08:00'), app.local_ts(app.today() - 15, time '12:00'), 'completed');
-- S7 (-12) del cliente fuera de rango de la prueba: no entra en el principal.
select tests.mk_shift('e3300000-0000-0000-0000-0000000002c7', 'e3300000-0000-0000-0000-000000000013', 'e3300000-0000-0000-0000-000000000024',
  app.local_ts(app.today() - 12, time '08:00'), app.local_ts(app.today() - 12, time '10:00'), 'completed');

insert into public.assignments (id, shift_id, employee_id, status) values
  ('e3300000-0000-0000-0000-0000000003c1', 'e3300000-0000-0000-0000-0000000002c1', tests.emp(7), 'finished'),
  ('e3300000-0000-0000-0000-0000000003c2', 'e3300000-0000-0000-0000-0000000002c1', tests.emp(8), 'finished'),
  ('e3300000-0000-0000-0000-0000000003c3', 'e3300000-0000-0000-0000-0000000002c2', tests.emp(7), 'present'),
  ('e3300000-0000-0000-0000-0000000003c4', 'e3300000-0000-0000-0000-0000000002c3', tests.emp(7), 'expected'),
  ('e3300000-0000-0000-0000-0000000003c5', 'e3300000-0000-0000-0000-0000000002c5', tests.emp(7), 'finished'),
  ('e3300000-0000-0000-0000-0000000003c6', 'e3300000-0000-0000-0000-0000000002c6', tests.emp(9), 'absence_notified'),
  ('e3300000-0000-0000-0000-0000000003c7', 'e3300000-0000-0000-0000-0000000002c7', tests.emp(10), 'finished');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by) values
  ('e3300000-0000-0000-0000-0000000003c1', 'check_in', app.local_ts(app.today() - 12, time '08:00'), 'employee_app', tests.emp(7)),
  ('e3300000-0000-0000-0000-0000000003c1', 'check_out', app.local_ts(app.today() - 12, time '12:00'), 'employee_app', tests.emp(7)),
  ('e3300000-0000-0000-0000-0000000003c2', 'check_in', app.local_ts(app.today() - 12, time '08:30'), 'employee_app', tests.emp(8)),
  ('e3300000-0000-0000-0000-0000000003c2', 'check_out', app.local_ts(app.today() - 12, time '12:00'), 'employee_app', tests.emp(8)),
  ('e3300000-0000-0000-0000-0000000003c3', 'check_in', app.local_ts(app.today() - 11, time '14:00'), 'employee_app', tests.emp(7)),
  ('e3300000-0000-0000-0000-0000000003c5', 'check_in', app.local_ts(app.today() - 30, time '08:00'), 'employee_app', tests.emp(7)),
  ('e3300000-0000-0000-0000-0000000003c5', 'check_out', app.local_ts(app.today() - 30, time '12:00'), 'employee_app', tests.emp(7)),
  ('e3300000-0000-0000-0000-0000000003c7', 'check_in', app.local_ts(app.today() - 12, time '08:00'), 'employee_app', tests.emp(10)),
  ('e3300000-0000-0000-0000-0000000003c7', 'check_out', app.local_ts(app.today() - 12, time '10:00'), 'employee_app', tests.emp(10));

select tests.as_user('test-db033-admin-sin-cap@example.com');
create temporary table t33_summary on commit drop as
select public.client_service_summary('e3300000-0000-0000-0000-000000000011', app.today() - 20, app.today() - 10) as s;
grant select on t33_summary to authenticated;

select is((select s #>> '{totals,shifts_done}' from t33_summary), '3', 'resumen: 3 turnos realizados (finalizado, con inicio y finalizado sin presentes); no cuentan el programado, el cancelado ni el de fuera de rango');
select is((select s #>> '{totals,employees_count}' from t33_summary), '2', 'resumen: 2 empleados distintos con inicio registrado (7 y 8; el 9 solo avisó ausencia)');
select is((select s #>> '{totals,worked_minutes}' from t33_summary), '450', 'resumen: 450 minutos trabajados (240 + 210; el inicio sin fin no suma)');
select is((select s #>> '{totals,planned_minutes}' from t33_summary), '720', 'resumen: 720 minutos previstos de las asignaciones con inicio (240 + 240 + 240)');
select is((select jsonb_array_length(s -> 'shifts') from t33_summary), 3, 'resumen: detalle de 3 turnos');
select is(
  (select array_agg(e ->> 'shift_date' order by e ->> 'shift_date') from t33_summary, jsonb_array_elements(s -> 'shifts') e),
  array[(app.today() - 15)::text, (app.today() - 12)::text, (app.today() - 11)::text],
  'resumen: turnos ordenados por fecha'
);
select is(
  (select e ->> 'site_name' || '|' || (e ->> 'start_time') || '|' || (e ->> 'end_time') || '|' || (e ->> 'worked_minutes') || '|' || jsonb_array_length(e -> 'employees')
   from t33_summary, jsonb_array_elements(s -> 'shifts') e where e ->> 'shift_id' = 'e3300000-0000-0000-0000-0000000002c1'),
  'Sede A 0033|08:00:00|12:00:00|450|2',
  'resumen: el turno 1 trae sede, franja, 450 minutos y dos empleados'
);
select is(
  (select array_agg((x ->> 'last_name') || ':' || (x ->> 'worked_minutes') order by x ->> 'last_name')
   from t33_summary, jsonb_array_elements(s -> 'shifts') e, jsonb_array_elements(e -> 'employees') x
   where e ->> 'shift_id' = 'e3300000-0000-0000-0000-0000000002c1'),
  array['Numero7:240', 'Numero8:210'],
  'resumen: minutos trabajados de cada empleado del turno'
);
select is(
  (select x ->> 'worked_minutes' from t33_summary, jsonb_array_elements(s -> 'shifts') e, jsonb_array_elements(e -> 'employees') x
   where e ->> 'shift_id' = 'e3300000-0000-0000-0000-0000000002c2'),
  null,
  'resumen: inicio sin fin deja worked_minutes en null para esa persona'
);
select is(
  (select e ->> 'worked_minutes' from t33_summary, jsonb_array_elements(s -> 'shifts') e where e ->> 'shift_id' = 'e3300000-0000-0000-0000-0000000002c6'),
  '0',
  'resumen: el turno finalizado sin presentes figura con 0 minutos'
);

select is(
  (select public.client_service_summary('e3300000-0000-0000-0000-000000000012', app.today() - 20, app.today() - 10) #>> '{totals,shifts_done}'),
  '0',
  'resumen: cliente sin servicios en el período: 0 turnos'
);
select is(
  (select jsonb_typeof(public.client_service_summary('e3300000-0000-0000-0000-000000000012', app.today() - 20, app.today() - 10) -> 'shifts')),
  'array',
  'resumen: cliente sin servicios devuelve un arreglo vacío, no null'
);
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-000000000011', current_date, current_date - 1)$$), 'INVALID_DATE_RANGE', 'resumen: desde posterior a hasta: INVALID_DATE_RANGE');
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-000000000011', null, current_date)$$), 'INVALID_DATE_RANGE', 'resumen: fecha nula: INVALID_DATE_RANGE');
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-0000000fffff', current_date - 1, current_date)$$), 'CLIENT_NOT_FOUND', 'resumen: cliente inexistente: CLIENT_NOT_FOUND');

select tests.as_user('test-db033-owner@example.com');
select is(
  (select public.client_service_summary('e3300000-0000-0000-0000-000000000011', app.today() - 20, app.today() - 10) #>> '{totals,worked_minutes}'),
  '450',
  'resumen: el dueño obtiene el mismo resultado'
);

-- Permisos: solo dueño y administradores.
select tests.as_user('test-db033-supervisor@example.com');
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-000000000011', current_date - 1, current_date)$$), 'FORBIDDEN', 'resumen: supervisor FORBIDDEN');
select is(tests.err_hint($$select * from public.clients_worked_minutes(current_date - 1, current_date)$$), 'FORBIDDEN', 'minutos por cliente: supervisor FORBIDDEN');
select tests.as_user('test-db033-emp7@example.com');
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-000000000011', current_date - 1, current_date)$$), 'FORBIDDEN', 'resumen: empleado FORBIDDEN');
select is(tests.err_hint($$select * from public.clients_worked_minutes(current_date - 1, current_date)$$), 'FORBIDDEN', 'minutos por cliente: empleado FORBIDDEN');
set local role anon;
select is(tests.err_hint($$select public.client_service_summary('e3300000-0000-0000-0000-000000000011', current_date - 1, current_date)$$), '42501', 'resumen: anon permission denied');
select is(tests.err_hint($$select * from public.clients_worked_minutes(current_date - 1, current_date)$$), '42501', 'minutos por cliente: anon permission denied');
set local role postgres;

-- clients_worked_minutes
select tests.as_user('test-db033-admin-sin-cap@example.com');
select is(
  (select worked_minutes from public.clients_worked_minutes(app.today() - 20, app.today() - 10) where client_id = 'e3300000-0000-0000-0000-000000000011'),
  450::bigint,
  'minutos por cliente: el cliente principal suma 450 (igual que el total del resumen)'
);
select is(
  (select worked_minutes from public.clients_worked_minutes(app.today() - 20, app.today() - 10) where client_id = 'e3300000-0000-0000-0000-000000000012'),
  0::bigint,
  'minutos por cliente: sin trabajo da 0, no desaparece'
);
select is(
  (select worked_minutes from public.clients_worked_minutes(app.today() - 20, app.today() - 10) where client_id = 'e3300000-0000-0000-0000-000000000013'),
  120::bigint,
  'minutos por cliente: otro cliente suma lo suyo (120)'
);
select is(
  (select worked_minutes from public.clients_worked_minutes(app.today() - 40, app.today() - 25) where client_id = 'e3300000-0000-0000-0000-000000000011'),
  240::bigint,
  'minutos por cliente: el período cambia el resultado (el turno de hace 30 días)'
);
select is(
  (select count(*)::int from public.clients_worked_minutes(app.today() - 20, app.today() - 10)),
  (select count(*)::int from public.clients),
  'minutos por cliente: una fila por cada cliente'
);
select is(tests.err_hint($$select * from public.clients_worked_minutes(current_date, current_date - 1)$$), 'INVALID_DATE_RANGE', 'minutos por cliente: rango invertido: INVALID_DATE_RANGE');
select tests.as_user('test-db033-owner@example.com');
select lives_ok($$select * from public.clients_worked_minutes(date_trunc('month', current_date)::date, current_date)$$, 'minutos por cliente: el dueño consulta el mes en curso');

-- Rendimiento: la consulta por cliente y rango entra por el índice nuevo.
set local role postgres;
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'shifts_client_id_shift_date_idx'),
  'existe el índice shifts (client_id, shift_date)'
);

select * from finish();

rollback;
