-- pgTAP de SERVICE-005 (08_Fases_y_Backlog.md, F10 · Servicios y generación de turnos, P10.1):
-- restricciones de `services` y sus políticas RLS que `0007_services_shifts_assignments.test.sql`
-- y `0012_rls_policies_clients_sites_services_shifts.test.sql` todavía no cubren (revisados antes
-- de escribir este archivo, ver el encabezado de cada uno): ya están cubiertos ahí el check de
-- `weekdays` (`app.valid_weekdays`), el de franja horaria, el de dotación 1..10, la existencia de
-- la FK compuesta en el catálogo (`pg_constraint`), RLS de lectura por rol (O, A ven; S, E no) y
-- que un admin puede escribir. Lo que agrega este archivo:
--   1. La FK compuesta funciona de verdad (no solo existe en el catálogo): insertar un servicio
--      con una sede que pertenece a OTRO cliente distinto del indicado falla.
--   2. RLS de escritura negativa: ni supervisor ni empleado pueden insertar ni actualizar un
--      servicio (04 sección 7.2: "services | O, A. | O, A." -- sin S ni E).
--   3. `anon` no tiene ni el privilegio de tabla sobre `services` (0017_grants.sql, mismo criterio
--      que el test de `sites`/`clients` en `0012_rls_policies_clients_sites_services_shifts.test.sql`).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2302000-...'.

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

select plan(6);

-- ---------------------------------------------------------------------------------------------
-- Fixtures: dos clientes con una sede cada uno, y personas con los cuatro roles.
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name) values
  ('e2302000-0000-0000-0000-000000000001', 'Cliente uno de SERVICE-005'),
  ('e2302000-0000-0000-0000-000000000002', 'Cliente dos de SERVICE-005');

insert into public.sites (id, client_id, name, address) values
  ('e2302000-0000-0000-0000-000000000011', 'e2302000-0000-0000-0000-000000000001', 'Sede del cliente uno', 'Dirección 1'),
  ('e2302000-0000-0000-0000-000000000012', 'e2302000-0000-0000-0000-000000000002', 'Sede del cliente dos', 'Dirección 2');

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from)
values ('e2302000-0000-0000-0000-000000000031', 'e2302000-0000-0000-0000-000000000001', 'e2302000-0000-0000-0000-000000000011', 'Servicio de prueba', array[1]::smallint[], '08:00', '12:00', '2199-01-01');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2302000-0000-0000-0000-000000000084', 'test-db023svc005-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e2302000-0000-0000-0000-000000000085', 'test-db023svc005-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado'));

insert into public.user_roles (profile_id, role) values
  ('e2302000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2302000-0000-0000-0000-000000000085', 'employee');

insert into public.employees (profile_id, dni) values
  ('e2302000-0000-0000-0000-000000000084', '92302084'),
  ('e2302000-0000-0000-0000-000000000085', '92302085');

-- ---------------------------------------------------------------------------------------------
-- 1. FK compuesta funcional: la sede tiene que pertenecer de verdad al cliente indicado -------
-- ---------------------------------------------------------------------------------------------

prepare service_site_from_another_client as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('e2302000-0000-0000-0000-000000000001', 'e2302000-0000-0000-0000-000000000012', 'Sede de otro cliente', array[1]::smallint[], '08:00', '12:00', '2199-01-01');

select throws_ok(
  'service_site_from_another_client', '23503', null,
  'services: rechaza site_id que pertenece a un cliente distinto (FK compuesta (site_id, client_id))'
);

-- ---------------------------------------------------------------------------------------------
-- 2. RLS de escritura: ni supervisor ni empleado pueden insertar ni actualizar (04 sección 7.2) --
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db023svc005-supervisora@example.com');

prepare service_insert_as_supervisor as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('e2302000-0000-0000-0000-000000000001', 'e2302000-0000-0000-0000-000000000011', 'Intento supervisor', array[1]::smallint[], '08:00', '12:00', '2199-01-01');

select throws_ok(
  'service_insert_as_supervisor', '42501', null,
  'services: la supervisora no puede insertar (RLS, 04 sección 7.2)'
);

-- La supervisora no tiene ninguna política de SELECT sobre services (04 sección 7.2: "O, A. |
-- O, A." -- sin S ni E), así que la fila queda invisible para el UPDATE: Postgres no lanza un
-- error (a diferencia del INSERT, donde WITH CHECK sí lo hace), simplemente no encuentra
-- ninguna fila para actualizar -- se verifica que el contenido no cambió, no que la sentencia
-- falle.
select lives_ok(
  $$update public.services set notes = 'ajustado por supervisora' where id = 'e2302000-0000-0000-0000-000000000031'$$,
  'services: el update de la supervisora no lanza error (RLS la deja sin filas visibles para actualizar)'
);

set local role postgres;

select is(
  (select notes from public.services where id = 'e2302000-0000-0000-0000-000000000031'),
  null::text,
  'services: el update de la supervisora no cambió nada -- RLS no le dejó ver la fila (04 sección 7.2)'
);

select tests.as_user('test-db023svc005-empleado@example.com');

prepare service_insert_as_employee as
  insert into public.services (client_id, site_id, name, weekdays, start_time, end_time, valid_from)
  values ('e2302000-0000-0000-0000-000000000001', 'e2302000-0000-0000-0000-000000000011', 'Intento empleado', array[1]::smallint[], '08:00', '12:00', '2199-01-01');

select throws_ok(
  'service_insert_as_employee', '42501', null,
  'services: el empleado no puede insertar (RLS, 04 sección 7.2)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. anon no tiene ni el privilegio de tabla (0017_grants.sql) ----------------------------------
-- ---------------------------------------------------------------------------------------------

set local role anon;

prepare service_select_anon as select count(*) from public.services;

select throws_ok(
  'service_select_anon', '42501', null,
  'services: anon no tiene ni el privilegio de tabla (0017_grants.sql)'
);

set local role postgres;

select * from finish();

rollback;
