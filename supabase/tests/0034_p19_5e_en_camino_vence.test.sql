-- pgTAP de la migración 0034_p19_5e_en_camino_vence.sql (P19.5e): vencimiento de «En camino»,
-- v_my_day.on_the_way_expires_at y v_employee_ratings legible con service_role.
--
-- Convención (supabase/tests/README.md): una sola transacción que termina en `rollback`. Prefijo
-- de fixtures: 'e3400000-...'.
--
-- Control del tiempo: dentro de una transacción `now()` es constante, así que cada turno se arma
-- con INSTANTES relativos a `now()` y la fecha y la hora local salen del mismo instante. Los casos
-- con inicio pasado (hasta 40 minutos atrás) con la franja todavía abierta no existen entre las
-- 0:00 y las 0:41 de Argentina (sin turnos que crucen la medianoche, ADR-019): esas aserciones
-- salen como `skip` en esa ventana. Los casos con inicio futuro no dependen de la hora.

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

-- Turno a partir de dos instantes (la fecha y las horas locales salen del mismo instante).
create or replace function tests.mk_shift(p_id uuid, p_start timestamptz, p_end timestamptz)
returns void
language plpgsql
as $$
declare
  v_date date := (p_start at time zone 'America/Argentina/Buenos_Aires')::date;
  v_end time;
begin
  if (p_end at time zone 'America/Argentina/Buenos_Aires')::date > v_date then
    v_end := '23:59:59.999999';
  else
    v_end := (p_end at time zone 'America/Argentina/Buenos_Aires')::time;
  end if;
  insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
  values (p_id, 'e3400000-0000-0000-0000-000000000011', 'e3400000-0000-0000-0000-000000000021',
          v_date, (p_start at time zone 'America/Argentina/Buenos_Aires')::time, v_end, 10, 'assigned');
end;
$$;

create or replace function tests.emp(p_n int)
returns uuid language sql immutable as $$
  select ('e3400000-0000-0000-0000-0000000001' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

create or replace function tests.asg(p_n int)
returns uuid language sql immutable as $$
  select ('e3400000-0000-0000-0000-0000000003' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

create or replace function tests.shf(p_n int)
returns uuid language sql immutable as $$
  select ('e3400000-0000-0000-0000-0000000002' || lpad(to_hex(p_n), 2, '0'))::uuid;
$$;

-- Turno + asignación del caso n.
create or replace function tests.mk_case(
  p_n int, p_start timestamptz, p_status public.assignment_status default 'expected'
)
returns void
language plpgsql
as $$
begin
  perform tests.mk_shift(tests.shf(p_n), p_start, p_start + interval '1 hour');
  insert into public.assignments (id, shift_id, employee_id, status)
  values (tests.asg(p_n), tests.shf(p_n), tests.emp(p_n), p_status);
end;
$$;

-- Aviso «en camino» del caso n. p_eta null = sin estimación.
create or replace function tests.mk_notice(
  p_n int, p_eta timestamptz, p_created timestamptz default null
)
returns void
language sql
as $$
  insert into public.attendance_notices (assignment_id, kind, estimated_arrival_at, reported_by, source, created_at)
  values (tests.asg(p_n), 'on_the_way', p_eta, tests.emp(p_n), 'employee_app', coalesce(p_created, now()));
$$;

create or replace function tests.st(p_n int)
returns text
language sql
stable
as $$
  select display_status from public.v_assignments_board where id = tests.asg(p_n);
$$;
grant execute on function tests.st(int) to authenticated;

create temporary table t34_flags on commit drop as
select ((now() at time zone 'America/Argentina/Buenos_Aires')::time >= time '00:41') as can_open_window;
grant select on t34_flags to authenticated;

select plan(32);

-- ---------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------

select col_type_is('public', 'v_my_day', 'on_the_way_expires_at', 'timestamp with time zone', 'v_my_day.on_the_way_expires_at existe (timestamptz)');
select is(
  (select a.attname::text from pg_attribute a where a.attrelid = 'public.v_my_day'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum desc limit 1),
  'no_checkout',
  'v_my_day: on_the_way_expires_at conserva su lugar (0037 agrega effective_open_ended y no_checkout después)'
);
select is(
  (select a.attname::text from pg_attribute a where a.attrelid = 'public.v_assignments_board'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum desc limit 1),
  'effective_open_ended',
  'v_assignments_board conserva sus columnas (0037 agrega effective_open_ended al final)'
);
select ok(
  (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_my_day'::regclass)
    and (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_assignments_board'::regclass)
    and (select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'public.v_employee_ratings'::regclass),
  'las tres vistas siguen siendo security_invoker'
);
select ok(
  has_function_privilege('service_role', 'app.employee_ratings_visible()', 'execute')
    and has_function_privilege('authenticated', 'app.employee_ratings_visible()', 'execute')
    and not has_function_privilege('anon', 'app.employee_ratings_visible()', 'execute'),
  'app.employee_ratings_visible(): ejecutable por service_role y authenticated, no por anon'
);
select ok(
  not has_table_privilege('anon', 'public.v_employee_ratings', 'select')
    and has_table_privilege('authenticated', 'public.v_employee_ratings', 'select')
    and has_table_privilege('service_role', 'public.v_employee_ratings', 'select'),
  'v_employee_ratings: anon sin acceso, authenticated y service_role con select'
);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('e3400000-0000-0000-0000-000000000081', 'test-db034-owner@example.com', jsonb_build_object('first_name', 'Dueña', 'last_name', 'Uno'));

insert into auth.users (id, email, raw_user_meta_data)
select tests.emp(n), 'test-db034-emp' || n || '@example.com',
       jsonb_build_object('first_name', 'Emp', 'last_name', 'Numero' || n)
from generate_series(1, 30) n;

insert into public.user_roles (profile_id, role) values ('e3400000-0000-0000-0000-000000000081', 'owner');
insert into public.user_roles (profile_id, role)
select tests.emp(n), 'employee' from generate_series(1, 30) n;

insert into public.employees (profile_id, dni)
select tests.emp(n), (93400100 + n)::text from generate_series(1, 30) n;

insert into public.clients (id, legal_name, status) values
  ('e3400000-0000-0000-0000-000000000011', 'Cliente 0034', 'active');
insert into public.sites (id, client_id, name, address, status) values
  ('e3400000-0000-0000-0000-000000000021', 'e3400000-0000-0000-0000-000000000011', 'Sede 0034', 'Calle 1', 'active');

-- Con estimación, inicio pasado (solo con la franja abierta, ver cabecera) --------------------
-- 1: inicio -30, estimación -10 -> vence en +5 minutos
select tests.mk_case(1, now() - interval '30 minutes');
select tests.mk_notice(1, now() - interval '10 minutes');
-- 2: inicio -30, estimación -15 exactos -> vence justo ahora (todavía vale)
select tests.mk_case(2, now() - interval '30 minutes');
select tests.mk_notice(2, now() - interval '15 minutes');
-- 3: inicio -30, estimación -15 min 1 s -> venció; pasaron más de 15 minutos del inicio
select tests.mk_case(3, now() - interval '30 minutes');
select tests.mk_notice(3, now() - interval '15 minutes 1 second');
-- 4: inicio -10, estimación -16 -> venció; pasaron 10 minutos del inicio
select tests.mk_case(4, now() - interval '10 minutes');
select tests.mk_notice(4, now() - interval '16 minutes');
-- 5: inicio -20, estimación +10 (futura) -> vale
select tests.mk_case(5, now() - interval '20 minutes');
select tests.mk_notice(5, now() + interval '10 minutes');
-- Sin estimación, inicio pasado
-- 6: inicio -10 -> vence en +5
select tests.mk_case(6, now() - interval '10 minutes');
select tests.mk_notice(6, null);
-- 7: inicio -15 exactos -> todavía vale
select tests.mk_case(7, now() - interval '15 minutes');
select tests.mk_notice(7, null);
-- 8: inicio -15 min 1 s -> venció
select tests.mk_case(8, now() - interval '15 minutes 1 second');
select tests.mk_notice(8, null);
-- Aviso hecho antes del inicio que vence después de empezar
-- 9: aviso hace 2 h con estimación -25 (antes del inicio, que es -20); vence en -10 -> no_record
select tests.mk_case(9, now() - interval '20 minutes');
select tests.mk_notice(9, now() - interval '25 minutes', now() - interval '2 hours');
-- 10: aviso hace 2 h con estimación -12; inicio -10; vence en +3 -> sigue en camino
select tests.mk_case(10, now() - interval '10 minutes');
select tests.mk_notice(10, now() - interval '12 minutes', now() - interval '2 hours');
-- Inicio futuro (no dependen de la hora del día)
-- 11: estimación vencida (aviso viejo), inicio en +1 h -> expected
select tests.mk_case(11, now() + interval '1 hour');
select tests.mk_notice(11, now() - interval '20 minutes', now() - interval '3 hours');
-- 12: estimación +30, inicio +1 h -> en camino
select tests.mk_case(12, now() + interval '1 hour');
select tests.mk_notice(12, now() + interval '30 minutes');
-- 13: sin estimación, inicio +1 h -> en camino
select tests.mk_case(13, now() + interval '1 hour');
select tests.mk_notice(13, null);
-- 14: demora avisada antes (status delay_notified), en camino vencido, inicio +1 h -> delay_notified
select tests.mk_case(14, now() + interval '1 hour', 'delay_notified');
select tests.mk_notice(14, now() - interval '20 minutes', now() - interval '3 hours');
-- 15: ya fichó (present), en camino vencido, inicio +1 h -> present
select tests.mk_case(15, now() + interval '1 hour', 'present');
select tests.mk_notice(15, now() - interval '60 minutes', now() - interval '3 hours');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
values (tests.asg(15), 'check_in', now() - interval '5 minutes', 'employee_app', tests.emp(15));
-- 16: ya fichó (present), inicio -30, en camino vencido (franja abierta) -> present
select tests.mk_case(16, now() - interval '30 minutes', 'present');
select tests.mk_notice(16, now() - interval '60 minutes', now() - interval '3 hours');
insert into public.attendance_records (assignment_id, kind, recorded_at, source, recorded_by)
values (tests.asg(16), 'check_in', now() - interval '5 minutes', 'employee_app', tests.emp(16));
-- 17: demora avisada, en camino vencido, inicio -30 -> no_record
select tests.mk_case(17, now() - interval '30 minutes', 'delay_notified');
select tests.mk_notice(17, now() - interval '20 minutes', now() - interval '3 hours');
-- v_my_day
-- 18: sin estimación, inicio +1 h
select tests.mk_case(18, now() + interval '1 hour');
select tests.mk_notice(18, null);
-- 19: estimación +30, inicio +1 h
select tests.mk_case(19, now() + interval '1 hour');
select tests.mk_notice(19, now() + interval '30 minutes');
-- 20: aviso en camino y después una demora (último aviso = demora)
select tests.mk_case(20, now() + interval '1 hour', 'delay_notified');
select tests.mk_notice(20, null, now() - interval '10 minutes');
insert into public.attendance_notices (assignment_id, kind, minutes_late, reported_by, source, created_at)
values (tests.asg(20), 'delay', 20, tests.emp(20), 'employee_app', now());
-- 21: sin ningún aviso
select tests.mk_case(21, now() + interval '1 hour');

-- ---------------------------------------------------------------------------------------------
-- display_status (v_assignments_board)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db034-owner@example.com');

select is(tests.st(1), 'on_the_way', 'con estimación, antes de estimación + 15 min: on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(2), 'on_the_way', 'con estimación, exactamente en estimación + 15 min: todavía on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(3), 'no_record', 'con estimación vencida y más de 15 min del inicio: no_record') where (select can_open_window from t34_flags);
select is(tests.st(4), 'late', 'con estimación vencida y 10 min del inicio: late') where (select can_open_window from t34_flags);
select is(tests.st(5), 'on_the_way', 'estimación futura con el inicio ya pasado: on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(6), 'on_the_way', 'sin estimación, a 10 min del inicio: on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(7), 'on_the_way', 'sin estimación, exactamente a 15 min del inicio: todavía on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(8), 'no_record', 'sin estimación, a 15 min y 1 s del inicio: no_record') where (select can_open_window from t34_flags);
select is(tests.st(9), 'no_record', 'aviso hecho antes del inicio, vencido después de empezar: no_record') where (select can_open_window from t34_flags);
select is(tests.st(10), 'on_the_way', 'aviso hecho antes del inicio, todavía no vence: on_the_way') where (select can_open_window from t34_flags);
select is(tests.st(16), 'present', 'con inicio registrado y el aviso vencido: present') where (select can_open_window from t34_flags);
select is(tests.st(17), 'no_record', 'demora avisada y en camino vencido, más de 15 min del inicio: no_record') where (select can_open_window from t34_flags);
select skip(12, 'entre las 0:00 y las 0:41 no se puede armar un inicio de hace hasta 40 minutos con la franja abierta (sin turnos que crucen la medianoche)')
where not (select can_open_window from t34_flags);

select is(tests.st(11), 'expected', 'estimación vencida antes del inicio: vuelve a expected');
select is(tests.st(12), 'on_the_way', 'estimación futura, inicio futuro: on_the_way');
select is(tests.st(13), 'on_the_way', 'sin estimación, inicio futuro: on_the_way');
select is(tests.st(14), 'delay_notified', 'demora avisada y en camino vencido antes del inicio: delay_notified');
select is(tests.st(15), 'present', 'con inicio registrado y el aviso vencido, inicio futuro: present');

-- ---------------------------------------------------------------------------------------------
-- v_my_day.on_the_way_expires_at
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db034-emp18@example.com');
select is(
  (select on_the_way_expires_at from public.v_my_day where assignment_id = tests.asg(18)),
  (select effective_starts_at + interval '15 minutes' from public.v_my_day where assignment_id = tests.asg(18)),
  'v_my_day: sin estimación vence a inicio efectivo + 15 min'
);
select tests.as_user('test-db034-emp19@example.com');
select is(
  (select on_the_way_expires_at from public.v_my_day where assignment_id = tests.asg(19)),
  now() + interval '45 minutes',
  'v_my_day: con estimación vence a estimación + 15 min'
);
select tests.as_user('test-db034-emp20@example.com');
select is(
  (select on_the_way_expires_at from public.v_my_day where assignment_id = tests.asg(20)),
  null,
  'v_my_day: si el último aviso es una demora, no hay vencimiento'
);
select tests.as_user('test-db034-emp21@example.com');
select is(
  (select on_the_way_expires_at from public.v_my_day where assignment_id = tests.asg(21)),
  null,
  'v_my_day: sin avisos, no hay vencimiento'
);
select is(
  (select count(*)::int from public.v_my_day where assignment_id = tests.asg(18)),
  0,
  'v_my_day: el empleado no ve la asignación de otro'
);

-- ---------------------------------------------------------------------------------------------
-- v_employee_ratings con service_role
-- ---------------------------------------------------------------------------------------------

set local role postgres;
create temporary table t34_expected on commit drop as
select count(*)::int as n from public.employees;
grant select on t34_expected to service_role, authenticated;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select count(*)::int from public.v_employee_ratings),
  (select n from t34_expected),
  'service_role lee v_employee_ratings completa (una fila por empleado)'
);
select is(
  (select count(*)::int from public.v_employee_ratings where employee_id = 'e3400000-0000-0000-0000-000000000101' and ratings_count = 0 and ratings_avg is null),
  1,
  'service_role: un empleado sin calificaciones aparece con 0 y promedio null'
);

-- Un authenticated sin rol de administración sigue sin ver filas; no se hace pasar por service_role.
set local role postgres;
select tests.as_user('test-db034-emp1@example.com');
select is(
  (select count(*)::int from public.v_employee_ratings),
  0,
  'empleado: v_employee_ratings sigue sin devolver filas'
);
select tests.as_user('test-db034-owner@example.com');
select is(
  (select count(*)::int from public.v_employee_ratings),
  (select n from t34_expected),
  'dueño: v_employee_ratings sigue devolviendo una fila por empleado'
);

select * from finish();

rollback;
