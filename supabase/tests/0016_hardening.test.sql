-- pgTAP de la migración 0016_hardening.sql: los cuatro endurecimientos (search_path fijo,
-- formato de CUIT/CUIL/DNI, hook exige usuario activo, app.sync_assignment_window filtra
-- asignaciones quitadas al recalcular por cambio del turno).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c5100000-...'.

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

select plan(21);

-- ---------------------------------------------------------------------------------------------
-- 1. search_path fijo -----------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select ok(
  (select 'search_path=public, app, pg_temp' = any(proconfig) from pg_proc where proname = 'set_updated_at' and pronamespace = 'app'::regnamespace),
  'app.set_updated_at(): search_path fijo'
);
select ok(
  (select 'search_path=public, app, pg_temp' = any(proconfig) from pg_proc where proname = 'local_ts' and pronamespace = 'app'::regnamespace),
  'app.local_ts(): search_path fijo'
);
select ok(
  (select 'search_path=public, app, pg_temp' = any(proconfig) from pg_proc where proname = 'valid_weekdays' and pronamespace = 'app'::regnamespace),
  'app.valid_weekdays(): search_path fijo'
);

-- Regresión: local_ts y valid_weekdays siguen funcionando igual después de `alter function`.
select is(
  app.local_ts('2026-01-15', '10:00'),
  '2026-01-15 13:00:00+00'::timestamptz,
  'app.local_ts sigue funcionando igual tras el alter function (enero, -03:00)'
);
select ok(app.valid_weekdays(array[1, 3, 5]::smallint[]), 'app.valid_weekdays sigue funcionando igual tras el alter function (caso válido)');
select ok(not app.valid_weekdays(array[1, 1]::smallint[]), 'app.valid_weekdays sigue rechazando repetidos tras el alter function');

-- ---------------------------------------------------------------------------------------------
-- 2. Formato de documentos --------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select lives_ok(
  $$insert into public.clients (id, legal_name, cuit) values ('c5100000-0000-0000-0000-000000000001', 'Cliente CUIT válido', '20123456789')$$,
  'clients.cuit: 11 dígitos entra'
);

select lives_ok(
  $$insert into public.clients (id, legal_name, cuit) values ('c5100000-0000-0000-0000-000000000002', 'Cliente sin CUIT', null)$$,
  'clients.cuit: null entra (columna opcional)'
);

prepare cuit_con_letras as
  insert into public.clients (legal_name, cuit) values ('Cliente CUIT inválido', '2012345678A');

select throws_ok('cuit_con_letras', '23514', null, 'clients.cuit: rechaza CUIT con letras');

prepare cuit_largo_incorrecto as
  insert into public.clients (legal_name, cuit) values ('Cliente CUIT corto', '2012345');

select throws_ok('cuit_largo_incorrecto', '23514', null, 'clients.cuit: rechaza CUIT con menos de 11 dígitos');

insert into auth.users (id, email, raw_user_meta_data)
values ('c5100000-0000-0000-0000-000000000081', 'test-db016h-dni-valido@example.com', jsonb_build_object('first_name', 'A', 'last_name', 'A'));

select lives_ok(
  $$insert into public.employees (profile_id, dni) values ('c5100000-0000-0000-0000-000000000081', '12345678')$$,
  'employees.dni: solo dígitos entra, sin largo fijo'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('c5100000-0000-0000-0000-000000000082', 'test-db016h-dni-invalido@example.com', jsonb_build_object('first_name', 'B', 'last_name', 'B'));

prepare dni_con_letras as
  insert into public.employees (profile_id, dni) values ('c5100000-0000-0000-0000-000000000082', '1234ABCD');

select throws_ok('dni_con_letras', '23514', null, 'employees.dni: rechaza DNI con letras');

insert into auth.users (id, email, raw_user_meta_data)
values ('c5100000-0000-0000-0000-000000000083', 'test-db016h-cuil@example.com', jsonb_build_object('first_name', 'C', 'last_name', 'C'));

select lives_ok(
  $$insert into public.employees (profile_id, dni, cuil) values ('c5100000-0000-0000-0000-000000000083', '87654321', '20876543219')$$,
  'employees.cuil: 11 dígitos entra (misma regla que clients.cuit, decisión menor)'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('c5100000-0000-0000-0000-000000000084', 'test-db016h-cuil-invalido@example.com', jsonb_build_object('first_name', 'D', 'last_name', 'D'));

prepare cuil_invalido as
  insert into public.employees (profile_id, dni, cuil) values ('c5100000-0000-0000-0000-000000000084', '11223344', '123');

select throws_ok('cuil_invalido', '23514', null, 'employees.cuil: rechaza un valor que no tiene 11 dígitos');

-- ---------------------------------------------------------------------------------------------
-- 3. Hook: exige usuario activo y no dado de baja -----------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5100000-0000-0000-0000-000000000091', 'test-db016h-hook-activo@example.com', jsonb_build_object('first_name', 'Activo', 'last_name', 'A')),
  ('c5100000-0000-0000-0000-000000000092', 'test-db016h-hook-inactivo@example.com', jsonb_build_object('first_name', 'Inactivo', 'last_name', 'B')),
  ('c5100000-0000-0000-0000-000000000093', 'test-db016h-hook-borrado@example.com', jsonb_build_object('first_name', 'Borrado', 'last_name', 'C'));

insert into public.user_roles (profile_id, role) values
  ('c5100000-0000-0000-0000-000000000091', 'admin'),
  ('c5100000-0000-0000-0000-000000000092', 'admin'),
  ('c5100000-0000-0000-0000-000000000093', 'admin');

update public.profiles set is_active = false where id = 'c5100000-0000-0000-0000-000000000092';
update public.profiles set deleted_at = now() where id = 'c5100000-0000-0000-0000-000000000093';

select is(
  (app.custom_access_token_hook(jsonb_build_object('user_id', 'c5100000-0000-0000-0000-000000000091', 'claims', jsonb_build_object('sub', 'c5100000-0000-0000-0000-000000000091'))) -> 'claims' -> 'roles'),
  '["admin"]'::jsonb,
  'hook: usuario activo -> trae sus roles normalmente'
);

select is(
  (app.custom_access_token_hook(jsonb_build_object('user_id', 'c5100000-0000-0000-0000-000000000092', 'claims', jsonb_build_object('sub', 'c5100000-0000-0000-0000-000000000092'))) -> 'claims' -> 'roles'),
  '[]'::jsonb,
  'hook: is_active = false -> roles vacío, aunque tenga fila en user_roles'
);

select is(
  (app.custom_access_token_hook(jsonb_build_object('user_id', 'c5100000-0000-0000-0000-000000000093', 'claims', jsonb_build_object('sub', 'c5100000-0000-0000-0000-000000000093'))) -> 'claims' -> 'roles'),
  '[]'::jsonb,
  'hook: deleted_at not null -> roles vacío'
);

select is(
  (app.custom_access_token_hook(jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000000', 'claims', jsonb_build_object('sub', '00000000-0000-0000-0000-000000000000'))) -> 'claims' -> 'roles'),
  '[]'::jsonb,
  'hook: sin fila de profiles (usuario recién creado) -> roles vacío, sin lanzar excepción'
);

-- ---------------------------------------------------------------------------------------------
-- 4. app.sync_assignment_window: no recalcula asignaciones quitadas ------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name) values ('c5100000-0000-0000-0000-000000000003', 'Cliente hardening turnos');
insert into public.sites (id, client_id, name, address)
values ('c5100000-0000-0000-0000-000000000031', 'c5100000-0000-0000-0000-000000000003', 'Sede', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c5100000-0000-0000-0000-000000000094', 'test-db016h-turno-vigente@example.com', jsonb_build_object('first_name', 'E', 'last_name', 'E')),
  ('c5100000-0000-0000-0000-000000000095', 'test-db016h-turno-quitada@example.com', jsonb_build_object('first_name', 'F', 'last_name', 'F'));

insert into public.employees (profile_id, dni) values
  ('c5100000-0000-0000-0000-000000000094', '94000094'),
  ('c5100000-0000-0000-0000-000000000095', '94000095');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c5100000-0000-0000-0000-000000000041', 'c5100000-0000-0000-0000-000000000003', 'c5100000-0000-0000-0000-000000000031', '2026-05-05', '08:00', '12:00', 2);

insert into public.assignments (id, shift_id, employee_id)
values ('c5100000-0000-0000-0000-000000000051', 'c5100000-0000-0000-0000-000000000041', 'c5100000-0000-0000-0000-000000000094');

insert into public.assignments (id, shift_id, employee_id)
values ('c5100000-0000-0000-0000-000000000052', 'c5100000-0000-0000-0000-000000000041', 'c5100000-0000-0000-0000-000000000095');

update public.assignments
set removed_at = now(), removed_by = 'c5100000-0000-0000-0000-000000000094', removed_reason = 'prueba hardening'
where id = 'c5100000-0000-0000-0000-000000000052';

select is(
  (select "window" from public.assignments where id = 'c5100000-0000-0000-0000-000000000052'),
  tstzrange(app.local_ts('2026-05-05', '08:00'), app.local_ts('2026-05-05', '12:00'), '[)'),
  'window de la asignación quitada, antes de mover el turno (valor original)'
);

update public.shifts set start_time = '07:00' where id = 'c5100000-0000-0000-0000-000000000041';

select is(
  (select "window" from public.assignments where id = 'c5100000-0000-0000-0000-000000000051'),
  tstzrange(app.local_ts('2026-05-05', '07:00'), app.local_ts('2026-05-05', '12:00'), '[)'),
  'app.sync_assignment_window: la asignación VIGENTE sí recalcula su window al cambiar el turno'
);

select is(
  (select "window" from public.assignments where id = 'c5100000-0000-0000-0000-000000000052'),
  tstzrange(app.local_ts('2026-05-05', '08:00'), app.local_ts('2026-05-05', '12:00'), '[)'),
  'app.sync_assignment_window: la asignación QUITADA (removed_at not null) NO recalcula -- conserva el valor con el que quedó (0016_hardening.sql)'
);

select * from finish();

rollback;
