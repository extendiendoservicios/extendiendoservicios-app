-- pgTAP de la migración 0012_rls_policies.sql (DB-014), tramo CLIENT-007 y SITE-007: lo que
-- `0012_rls_policies_clients_sites_services_shifts.test.sql` no cubre todavía de `clients`,
-- `client_contacts` y `sites` --
--   1. selección por rol `admin` (el archivo original solo prueba owner/supervisor/empleado);
--   2. que la falta de RLS por capacidad es real: un administrador SIN ninguna capacidad activa
--      escribe igual que uno con todas (04 sección 7.2: "clients, client_contacts... | O, A." y
--      "sites | ... | O, A.", sin capacidad de por medio -- a diferencia de `employees`, que sí
--      exige `manage_users` para que A cree, o de las RPC de turnos/asistencia);
--   3. que supervisor y empleado no pueden escribir directo (sin política de insert/update para
--      esos roles: el insert falla con 42501, el update simplemente no afecta ninguna fila
--      porque la política de "sus turnos" es de solo lectura -- son dos comportamientos
--      distintos de Postgres ante la ausencia de política, y conviene dejar los dos probados);
--   4. que la baja lógica (`deleted_at`) esconde la fila de supervisor y empleado incluso
--      cuando siguen teniendo un turno relacionado, pero no de owner/admin (que necesitan el
--      historial completo, nota de arquitectura de 0012_rls_policies.sql).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2201000-...' (personas) y
-- 'c2201100-...' (clientes/sedes/turnos).

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

select plan(22);

-- Fixtures: owner, dos administradores (uno con una capacidad activa, otro sin ninguna),
-- supervisora y empleado, con un cliente/sede/turno donde S y E tienen parte -------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2201000-0000-0000-0000-000000000001', 'test-db014c-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Escritura')),
  ('c2201000-0000-0000-0000-000000000002', 'test-db014c-admin-full@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCapacidad')),
  ('c2201000-0000-0000-0000-000000000003', 'test-db014c-admin-nocap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCapacidad')),
  ('c2201000-0000-0000-0000-000000000004', 'test-db014c-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Escritura')),
  ('c2201000-0000-0000-0000-000000000005', 'test-db014c-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Escritura'));

insert into public.user_roles (profile_id, role) values
  ('c2201000-0000-0000-0000-000000000001', 'owner'),
  ('c2201000-0000-0000-0000-000000000002', 'admin'),
  ('c2201000-0000-0000-0000-000000000003', 'admin'),
  ('c2201000-0000-0000-0000-000000000004', 'supervisor'),
  ('c2201000-0000-0000-0000-000000000005', 'employee');

-- admin-full con una capacidad activa (no hace falta ninguna para clients/sites, pero así el
-- fixture no se confunde con "admin recién creado sin nada tocado"); admin-nocap deliberadamente
-- sin ninguna fila en admin_capabilities.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c2201000-0000-0000-0000-000000000002', 'manage_users', true);

insert into public.employees (profile_id, dni) values
  ('c2201000-0000-0000-0000-000000000004', '52201004'),
  ('c2201000-0000-0000-0000-000000000005', '52201005');

insert into public.clients (id, legal_name) values
  ('c2201100-0000-0000-0000-000000000001', 'Cliente Escritura SRL');

insert into public.sites (id, client_id, name, address) values
  ('c2201100-0000-0000-0000-000000000011', 'c2201100-0000-0000-0000-000000000001', 'Sede Escritura', 'Dirección de prueba');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2201100-0000-0000-0000-000000000041', 'c2201100-0000-0000-0000-000000000001', 'c2201100-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 1);

insert into public.assignments (shift_id, employee_id)
values ('c2201100-0000-0000-0000-000000000041', 'c2201000-0000-0000-0000-000000000005');

insert into public.supervisions (shift_id, supervisor_id)
values ('c2201100-0000-0000-0000-000000000041', 'c2201000-0000-0000-0000-000000000004');

-- ---------------------------------------------------------------------------------------------
-- 1. Selección por admin (clients, sites): el archivo original solo prueba owner/S/E
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014c-admin-full@example.com');
select is(
  (select count(*)::int from public.clients where id = 'c2201100-0000-0000-0000-000000000001'),
  1,
  'clients: un admin ve el cliente del fixture, igual que el owner'
);
select is(
  (select count(*)::int from public.sites where id = 'c2201100-0000-0000-0000-000000000011'),
  1,
  'sites: un admin ve la sede del fixture, igual que el owner'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. Escritura: owner y los dos administradores (con y sin capacidad) pueden insertar y
--    escribir igual, porque 04 sección 7.2 no exige ninguna capacidad para clients/sites/
--    client_contacts (a diferencia de employees, que sí exige manage_users para que A cree)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014c-owner@example.com');
select lives_ok(
  $$insert into public.clients (id, legal_name) values ('c2201100-0000-0000-0000-000000000002', 'Cliente Alta Owner')$$,
  'clients: el owner puede insertar un cliente'
);
set local role postgres;

select tests.as_user('test-db014c-admin-full@example.com');
select lives_ok(
  $$insert into public.clients (id, legal_name) values ('c2201100-0000-0000-0000-000000000003', 'Cliente Alta Admin Con Capacidad')$$,
  'clients: un admin con una capacidad activa puede insertar un cliente'
);
set local role postgres;

select tests.as_user('test-db014c-admin-nocap@example.com');
select lives_ok(
  $$insert into public.clients (id, legal_name) values ('c2201100-0000-0000-0000-000000000004', 'Cliente Alta Admin Sin Capacidad')$$,
  'clients: un admin SIN ninguna capacidad activa también puede insertar un cliente (no hay capacidad que lo exija)'
);
select lives_ok(
  $$insert into public.sites (id, client_id, name, address)
    values ('c2201100-0000-0000-0000-000000000012', 'c2201100-0000-0000-0000-000000000004', 'Sede Alta Admin Sin Capacidad', 'Dirección')$$,
  'sites: un admin SIN ninguna capacidad activa puede insertar una sede'
);
select lives_ok(
  $$insert into public.client_contacts (id, client_id, name, is_primary)
    values ('c2201100-0000-0000-0000-000000000005', 'c2201100-0000-0000-0000-000000000004', 'Contacto Alta', true)$$,
  'client_contacts: un admin SIN ninguna capacidad activa puede insertar un contacto'
);
set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. Escritura negada a supervisor y empleado (sin política de insert/update para esos roles)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014c-supervisora@example.com');

prepare client_insert_supervisor as
  insert into public.clients (id, legal_name) values ('c2201100-0000-0000-0000-000000000006', 'Cliente Rechazado Supervisora');
select throws_ok(
  'client_insert_supervisor', '42501', null,
  'clients: la supervisora no puede insertar un cliente'
);

prepare contact_insert_supervisor as
  insert into public.client_contacts (id, client_id, name, is_primary)
  values ('c2201100-0000-0000-0000-000000000007', 'c2201100-0000-0000-0000-000000000001', 'Contacto Rechazado', false);
select throws_ok(
  'contact_insert_supervisor', '42501', null,
  'client_contacts: la supervisora no puede insertar un contacto'
);

prepare site_insert_supervisor as
  insert into public.sites (id, client_id, name, address)
  values ('c2201100-0000-0000-0000-000000000013', 'c2201100-0000-0000-0000-000000000001', 'Sede Rechazada Supervisora', 'Dirección');
select throws_ok(
  'site_insert_supervisor', '42501', null,
  'sites: la supervisora no puede insertar una sede'
);

-- Update: no hay política de escritura para S, así que el using de UPDATE no matchea ninguna
-- fila -- Postgres no tira error, la sentencia corre y no afecta ninguna fila (distinto del
-- insert, que sí falla porque el WITH CHECK de la fila nueva no tiene ninguna política que lo
-- acepte). Un `update` con `returning` dentro de un `with` no puede ir anidado en el `select`
-- de otra consulta ("WITH clause containing a data-modifying statement must be at the top
-- level"), así que se mide con `get diagnostics` en un bloque `do` (corre con el mismo rol de
-- sesión, la RLS sigue aplicando igual) y se lee después con `current_setting`.
do $$
declare
  v_count int;
begin
  update public.clients set notes = 'tocado por supervisora' where id = 'c2201100-0000-0000-0000-000000000001';
  get diagnostics v_count = row_count;
  perform set_config('pgtap.tmp_rowcount', v_count::text, true);
end;
$$;
select is(
  current_setting('pgtap.tmp_rowcount')::int,
  0,
  'clients: el update de la supervisora sobre el cliente de su turno no afecta ninguna fila (sin política de escritura para S)'
);

set local role postgres;

select tests.as_user('test-db014c-empleado@example.com');

prepare client_insert_empleado as
  insert into public.clients (id, legal_name) values ('c2201100-0000-0000-0000-000000000008', 'Cliente Rechazado Empleado');
select throws_ok(
  'client_insert_empleado', '42501', null,
  'clients: el empleado no puede insertar un cliente'
);

prepare site_insert_empleado as
  insert into public.sites (id, client_id, name, address)
  values ('c2201100-0000-0000-0000-000000000014', 'c2201100-0000-0000-0000-000000000001', 'Sede Rechazada Empleado', 'Dirección');
select throws_ok(
  'site_insert_empleado', '42501', null,
  'sites: el empleado no puede insertar una sede'
);

do $$
declare
  v_count int;
begin
  update public.sites set contact_name = 'tocado por empleado' where id = 'c2201100-0000-0000-0000-000000000011';
  get diagnostics v_count = row_count;
  perform set_config('pgtap.tmp_rowcount', v_count::text, true);
end;
$$;
select is(
  current_setting('pgtap.tmp_rowcount')::int,
  0,
  'sites: el update del empleado sobre la sede de su turno no afecta ninguna fila (sin política de escritura para E)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 4. Un admin sí puede actualizar (cambiar estado del cliente, 06 sección 4 "Cambiar estado")
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014c-admin-full@example.com');
select lives_ok(
  $$update public.clients set status = 'suspended' where id = 'c2201100-0000-0000-0000-000000000001'$$,
  'clients: un admin puede cambiar el estado del cliente (suspender)'
);
set local role postgres;

select is(
  (select status::text from public.clients where id = 'c2201100-0000-0000-0000-000000000001'),
  'suspended',
  'clients: el cambio de estado del admin quedó persistido'
);

-- ---------------------------------------------------------------------------------------------
-- 5. Baja lógica: esconde la fila para S/E aunque sigan teniendo el turno relacionado; O/A
--    conservan el acceso (necesitan el historial completo, nota de arquitectura de 0012)
--
-- Orden importante: el contacto se prueba primero, con el cliente todavía activo -- la política
-- de client_contacts para S exige TAMBIÉN que el cliente dueño esté vigente
-- (`client_contacts_select_shift_party`, 0012), así que si se diera de baja el cliente antes, el
-- contacto quedaría oculto por la baja del cliente y no probaría nada sobre su propio
-- `deleted_at`.
-- ---------------------------------------------------------------------------------------------

insert into public.client_contacts (id, client_id, name, is_primary)
values ('c2201100-0000-0000-0000-000000000009', 'c2201100-0000-0000-0000-000000000001', 'Contacto Baja Lógica', false);

update public.client_contacts set deleted_at = now() where id = 'c2201100-0000-0000-0000-000000000009';

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select count(*)::int from public.client_contacts where id = 'c2201100-0000-0000-0000-000000000009'),
  0,
  'client_contacts: la supervisora deja de ver el contacto dado de baja lógica (con el cliente todavía activo)'
);
set local role postgres;

select tests.as_user('test-db014c-admin-full@example.com');
select is(
  (select count(*)::int from public.client_contacts where id = 'c2201100-0000-0000-0000-000000000009'),
  1,
  'client_contacts: el admin sigue viendo el contacto dado de baja lógica'
);
set local role postgres;

update public.clients set deleted_at = now() where id = 'c2201100-0000-0000-0000-000000000001';

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select count(*)::int from public.clients where id = 'c2201100-0000-0000-0000-000000000001'),
  0,
  'clients: la supervisora deja de ver el cliente dado de baja lógica, aunque siga teniendo el turno'
);
set local role postgres;

select tests.as_user('test-db014c-admin-full@example.com');
select is(
  (select count(*)::int from public.clients where id = 'c2201100-0000-0000-0000-000000000001'),
  1,
  'clients: el admin sigue viendo el cliente dado de baja lógica'
);
set local role postgres;

update public.sites set deleted_at = now() where id = 'c2201100-0000-0000-0000-000000000011';

select tests.as_user('test-db014c-empleado@example.com');
select is(
  (select count(*)::int from public.sites where id = 'c2201100-0000-0000-0000-000000000011'),
  0,
  'sites: el empleado deja de ver la sede dada de baja lógica, aunque siga teniendo el turno'
);
set local role postgres;

select tests.as_user('test-db014c-owner@example.com');
select is(
  (select count(*)::int from public.sites where id = 'c2201100-0000-0000-0000-000000000011'),
  1,
  'sites: el owner sigue viendo la sede dada de baja lógica'
);
set local role postgres;

select * from finish();

rollback;
