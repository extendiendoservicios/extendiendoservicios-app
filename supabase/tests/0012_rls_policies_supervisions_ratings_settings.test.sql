-- pgTAP de la migración 0012_rls_policies.sql (DB-014), parte 4: supervisions,
-- supervision_attendance, ratings, rating_criteria, holidays, company_settings,
-- security_events, y el caso "anon no lee ninguna tabla salvo v_public_branding". Las demás
-- tablas están en 0012_rls_policies.test.sql, 0012_rls_policies_clients_sites_services_shifts.
-- test.sql y 0012_rls_policies_assignments_attendance_tasks.test.sql.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2400000-...'.
--
-- Este archivo cubre el segundo criterio de aceptación explícito de F4 (08_Fases_y_Backlog.md):
-- "un empleado del seed, autenticado, no puede leer ratings" (P-084) -- el primero (asignaciones
-- de turnos ajenos) está en 0012_rls_policies_assignments_attendance_tasks.test.sql.

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

select plan(34);

-- Fixtures: cliente/sede, turno supervisado por S1 con E1 asignado y calificado; S2 es una
-- segunda supervisora sin relación con ese turno (para probar que S ve solo las propias) -------

insert into public.clients (id, legal_name) values ('c2400000-0000-0000-0000-000000000001', 'Cliente supervisiones');
insert into public.sites (id, client_id, name, address)
values ('c2400000-0000-0000-0000-000000000011', 'c2400000-0000-0000-0000-000000000001', 'Sede', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2400000-0000-0000-0000-000000000081', 'test-db014d-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c2400000-0000-0000-0000-000000000082', 'test-db014d-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c2400000-0000-0000-0000-000000000083', 'test-db014d-supervisora1@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Uno')),
  ('c2400000-0000-0000-0000-000000000084', 'test-db014d-supervisora2@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Dos')),
  ('c2400000-0000-0000-0000-000000000085', 'test-db014d-empleado1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno'));

insert into public.user_roles (profile_id, role) values
  ('c2400000-0000-0000-0000-000000000081', 'owner'),
  ('c2400000-0000-0000-0000-000000000082', 'admin'),
  ('c2400000-0000-0000-0000-000000000083', 'supervisor'),
  ('c2400000-0000-0000-0000-000000000084', 'supervisor'),
  ('c2400000-0000-0000-0000-000000000085', 'employee');

insert into public.employees (profile_id, dni) values
  ('c2400000-0000-0000-0000-000000000083', '52400083'),
  ('c2400000-0000-0000-0000-000000000084', '52400084'),
  ('c2400000-0000-0000-0000-000000000085', '52400085');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2400000-0000-0000-0000-000000000041', 'c2400000-0000-0000-0000-000000000001', 'c2400000-0000-0000-0000-000000000011', current_date - 1, '08:00', '16:00', 1);

insert into public.assignments (id, shift_id, employee_id)
values ('c2400000-0000-0000-0000-000000000051', 'c2400000-0000-0000-0000-000000000041', 'c2400000-0000-0000-0000-000000000085');

insert into public.supervisions (id, shift_id, supervisor_id, status)
values ('c2400000-0000-0000-0000-000000000061', 'c2400000-0000-0000-0000-000000000041', 'c2400000-0000-0000-0000-000000000083', 'completed');

insert into public.supervision_attendance (supervision_id, kind, recorded_at)
values ('c2400000-0000-0000-0000-000000000061', 'check_in', now());

insert into public.ratings (id, supervision_id, assignment_id, score, comment)
values ('c2400000-0000-0000-0000-000000000071', 'c2400000-0000-0000-0000-000000000061', 'c2400000-0000-0000-0000-000000000051', 4, 'Buen desempeño');

-- ---------------------------------------------------------------------------------------------
-- 1. supervisions, supervision_attendance (04 sección 7.2: "O, A: todas. S: propias. E: no.")
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014d-owner@example.com');
select is(
  (select count(*)::int from public.supervisions where id = 'c2400000-0000-0000-0000-000000000061'),
  1,
  'supervisions: owner ve la supervisión'
);

select tests.as_user('test-db014d-supervisora1@example.com');
select is(
  (select count(*)::int from public.supervisions where id = 'c2400000-0000-0000-0000-000000000061'),
  1,
  'supervisions: la propia supervisora ve su supervisión'
);

select tests.as_user('test-db014d-supervisora2@example.com');
select is(
  (select count(*)::int from public.supervisions where id = 'c2400000-0000-0000-0000-000000000061'),
  0,
  'supervisions: otra supervisora sin relación no ve la supervisión ajena'
);

select tests.as_user('test-db014d-empleado1@example.com');
select is(
  (select count(*)::int from public.supervisions where id = 'c2400000-0000-0000-0000-000000000061'),
  0,
  'supervisions: el empleado no ve la supervisión de su propio turno (04 sección 7.2: "E: no")'
);

select tests.as_user('test-db014d-supervisora1@example.com');
select is(
  (select count(*)::int from public.supervision_attendance where supervision_id = 'c2400000-0000-0000-0000-000000000061'),
  1,
  'supervision_attendance: la propia supervisora ve el registro de su supervisión'
);

select tests.as_user('test-db014d-supervisora2@example.com');
select is(
  (select count(*)::int from public.supervision_attendance where supervision_id = 'c2400000-0000-0000-0000-000000000061'),
  0,
  'supervision_attendance: otra supervisora no ve el registro ajeno'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. ratings -- CRITERIO DE ACEPTACIÓN F4 (P-084): el empleado NO ve ninguna calificación, ni
--    siquiera la propia.
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014d-owner@example.com');
select is(
  (select count(*)::int from public.ratings where id = 'c2400000-0000-0000-0000-000000000071'),
  1,
  'ratings: owner ve la calificación'
);

select tests.as_user('test-db014d-admin@example.com');
select is(
  (select count(*)::int from public.ratings where id = 'c2400000-0000-0000-0000-000000000071'),
  1,
  'ratings: admin ve la calificación'
);

select tests.as_user('test-db014d-supervisora1@example.com');
select is(
  (select count(*)::int from public.ratings where id = 'c2400000-0000-0000-0000-000000000071'),
  1,
  'ratings: la supervisora que la hizo ve su propia calificación'
);

select tests.as_user('test-db014d-supervisora2@example.com');
select is(
  (select count(*)::int from public.ratings where id = 'c2400000-0000-0000-0000-000000000071'),
  0,
  'ratings: otra supervisora sin relación no ve la calificación'
);

select tests.as_user('test-db014d-empleado1@example.com');
select is(
  (select count(*)::int from public.ratings where id = 'c2400000-0000-0000-0000-000000000071'),
  0,
  'ratings: CRITERIO DE ACEPTACIÓN F4 (P-084) -- el empleado calificado NO ve su propia calificación, RLS lo impide sin excepción'
);

select is(
  (select count(*)::int from public.ratings where assignment_id = 'c2400000-0000-0000-0000-000000000051'),
  0,
  'ratings: tampoco filtrando por su propia asignación el empleado ve ninguna fila (sin ninguna política para employee en esta tabla)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. rating_criteria (04 sección 7.2: "O, A, S: vigentes y pasadas. E: no. | O.")
-- ---------------------------------------------------------------------------------------------

insert into public.rating_criteria (id, position, title, valid_from, valid_to)
values
  ('c2400000-0000-0000-0000-000000000091', 1, 'Criterio vigente', current_date - 30, null),
  ('c2400000-0000-0000-0000-000000000092', 2, 'Criterio pasado', current_date - 90, current_date - 60);

select tests.as_user('test-db014d-supervisora1@example.com');
select is(
  (select count(*)::int from public.rating_criteria
    where id = any(array['c2400000-0000-0000-0000-000000000091'::uuid, 'c2400000-0000-0000-0000-000000000092'])),
  2,
  'rating_criteria: la supervisora ve vigentes y pasadas (sin filtrar por valid_to)'
);

select tests.as_user('test-db014d-empleado1@example.com');
select is(
  (select count(*)::int from public.rating_criteria
    where id = any(array['c2400000-0000-0000-0000-000000000091'::uuid, 'c2400000-0000-0000-0000-000000000092'])),
  0,
  'rating_criteria: el empleado no ve ningún criterio (04 sección 7.2: "E: no")'
);

set local role postgres;

-- Escritura: solo owner, ni siquiera admin (a diferencia de la mayoría de los maestros).
select tests.as_user('test-db014d-admin@example.com');

create temporary table c2400000_criteria_probe (n int) on commit drop;

with upd as (
  update public.rating_criteria set title = 'renombrado'
  where id = 'c2400000-0000-0000-0000-000000000091'
  returning 1
)
insert into c2400000_criteria_probe select count(*) from upd;

select is(
  (select n from c2400000_criteria_probe),
  0,
  'rating_criteria: admin NO puede escribir (04 sección 7.2: "O.", sin admin, a diferencia de otros maestros)'
);

select tests.as_user('test-db014d-owner@example.com');
select lives_ok(
  $$update public.rating_criteria set title = 'renombrado' where id = 'c2400000-0000-0000-0000-000000000091'$$,
  'rating_criteria: el owner sí puede escribir'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 4. holidays (04 sección 7.2: "Todos autenticados. | O.")
-- ---------------------------------------------------------------------------------------------

insert into public.holidays (id, holiday_date, name, deleted_at) values
  ('c2400000-0000-0000-0000-000000000093', current_date + 100, 'Feriado vigente', null),
  ('c2400000-0000-0000-0000-000000000094', current_date + 101, 'Feriado dado de baja', now());

select tests.as_user('test-db014d-empleado1@example.com');
select is(
  (select count(*)::int from public.holidays where id = 'c2400000-0000-0000-0000-000000000093'),
  1,
  'holidays: cualquier autenticado (acá, un empleado) ve un feriado vigente'
);

select is(
  (select count(*)::int from public.holidays where id = 'c2400000-0000-0000-0000-000000000094'),
  0,
  'holidays: no ve un feriado dado de baja lógica'
);

-- Desde 0017_grants.sql (DB-017, tramo B), anon ni siquiera tiene el privilegio de tabla.
set local role anon;

prepare holidays_select_anon as select count(*) from public.holidays;

select throws_ok(
  'holidays_select_anon', '42501', null,
  'holidays: anon no tiene ni el privilegio de tabla (solo "todos los autenticados", 0017_grants.sql)'
);

set local role postgres;

select tests.as_user('test-db014d-admin@example.com');

create temporary table c2400000_holidays_probe (n int) on commit drop;

with upd as (
  update public.holidays set name = 'renombrado'
  where id = 'c2400000-0000-0000-0000-000000000093'
  returning 1
)
insert into c2400000_holidays_probe select count(*) from upd;

select is(
  (select n from c2400000_holidays_probe),
  0,
  'holidays: admin NO puede escribir (04 sección 7.2: "O.", sin admin)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 5. company_settings (04 sección 7.2: "Todos autenticados (y anon vía v_public_branding). |
--    O (A puede subir logo: se otorga a O y A).")
-- ---------------------------------------------------------------------------------------------

insert into public.company_settings (id, name, logo_path, support_phone, location_consent_text)
values (1, 'Extendiendo Servicios', 'branding/logo.png', '+54 11 5555-5555', 'Texto de consentimiento');

select tests.as_user('test-db014d-empleado1@example.com');
select is(
  (select name from public.company_settings where id = 1),
  'Extendiendo Servicios',
  'company_settings: cualquier autenticado (acá, un empleado) lee la fila'
);

-- Nota de arquitectura (ver también 0012_rls_policies.sql): anon SÍ tiene una política de select
-- sobre esta tabla (using true), a propósito, para que v_public_branding (security_invoker,
-- 0011) le devuelva algo. Desde 0017_grants.sql (DB-017, tramo B) el grant de columnas
-- (name, logo_path, support_phone) para anon ya está aplicado: puede leer esas tres columnas
-- directamente de la tabla, pero ninguna otra (por ejemplo location_consent_text) -- el caso que
-- en el tramo A quedaba como pregunta abierta ("anon lee la fila completa hasta que 0017
-- agregue el grant de columnas") ya está resuelto.
set local role anon;
select is(
  (select support_phone from public.company_settings where id = 1),
  '+54 11 5555-5555',
  'company_settings: anon lee las columnas otorgadas (name, logo_path, support_phone) directamente de la tabla'
);

prepare company_settings_select_anon_other_column as
  select location_consent_text from public.company_settings where id = 1;

select throws_ok(
  'company_settings_select_anon_other_column', '42501', null,
  'company_settings: anon NO puede leer columnas fuera de las tres otorgadas (location_consent_text, 0017_grants.sql)'
);

select is(
  (select name from public.v_public_branding),
  'Extendiendo Servicios',
  'v_public_branding: anon lee la marca pública a través de la vista'
);
set local role postgres;

select tests.as_user('test-db014d-admin@example.com');
select lives_ok(
  $$update public.company_settings set support_phone = '+54 11 4444-4444' where id = 1$$,
  'company_settings: admin puede actualizar (04 sección 7.2, P-117: se otorga a O y A)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 6. security_events (04 sección 7.2: "O. | Solo funciones.")
-- ---------------------------------------------------------------------------------------------

select app.log_security_event('sign_in'::public.security_event_type, 'c2400000-0000-0000-0000-000000000085');

select tests.as_user('test-db014d-owner@example.com');
select is(
  (select count(*)::int from public.security_events where actor_id = 'c2400000-0000-0000-0000-000000000085'),
  1,
  'security_events: el owner ve el evento'
);

select tests.as_user('test-db014d-admin@example.com');
select is(
  (select count(*)::int from public.security_events where actor_id = 'c2400000-0000-0000-0000-000000000085'),
  0,
  'security_events: el admin NO ve eventos (04 sección 7.2: "O.", sin admin)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 7. anon no lee ninguna tabla de negocio salvo lo que expone v_public_branding (criterio de
--    aceptación de F4). Desde 0017_grants.sql (DB-017, tramo B) anon ni siquiera tiene el
--    privilegio de tabla sobre estas siete (antes de 0017 el ACL por defecto se lo daba y RLS
--    bloqueaba con 0 filas; ahora corta con permission denied, más estricto). El caso de
--    company_settings (columnas específicas, no la fila completa) ya se cubrió arriba.
-- ---------------------------------------------------------------------------------------------

set local role anon;

prepare anon_clients as select count(*) from public.clients where id = 'c2400000-0000-0000-0000-000000000001';
select throws_ok('anon_clients', '42501', null, 'anon: clients, sin privilegio de tabla');

prepare anon_employees as select count(*) from public.employees where profile_id = 'c2400000-0000-0000-0000-000000000085';
select throws_ok('anon_employees', '42501', null, 'anon: employees, sin privilegio de tabla');

prepare anon_shifts as select count(*) from public.shifts where id = 'c2400000-0000-0000-0000-000000000041';
select throws_ok('anon_shifts', '42501', null, 'anon: shifts, sin privilegio de tabla');

prepare anon_assignments as select count(*) from public.assignments where id = 'c2400000-0000-0000-0000-000000000051';
select throws_ok('anon_assignments', '42501', null, 'anon: assignments, sin privilegio de tabla');

prepare anon_ratings as select count(*) from public.ratings where id = 'c2400000-0000-0000-0000-000000000071';
select throws_ok('anon_ratings', '42501', null, 'anon: ratings, sin privilegio de tabla');

prepare anon_user_roles as select count(*) from public.user_roles;
select throws_ok('anon_user_roles', '42501', null, 'anon: user_roles, sin privilegio de tabla');

prepare anon_security_events as select count(*) from public.security_events;
select throws_ok('anon_security_events', '42501', null, 'anon: security_events, sin privilegio de tabla');

set local role postgres;

select * from finish();

rollback;
