-- pgTAP de la migración 0013_rpc_users.sql (DB-015): set_user_roles, set_admin_capability,
-- mark_changes_seen. Los pgTAP de USERS-017 (P07.1) van a agregar la parte que compete a la
-- Edge Function admin-users; acá van los tests propios de la migración (04 sección 9,
-- 06_API.md sección 2.2).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c3100000-...'.

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

select plan(25);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'set_user_roles', array['uuid', 'app_role[]'], 'existe public.set_user_roles(uuid, app_role[])');
select has_function('public', 'set_admin_capability', array['uuid', 'admin_capability', 'bool'], 'existe public.set_admin_capability(uuid, admin_capability, bool)');
select has_function('public', 'mark_changes_seen', array[]::text[], 'existe public.mark_changes_seen()');

-- Fixtures: un owner (el único del fixture), dos admins (uno con manage_users, otro sin), una
-- supervisora, un empleado sin roles privilegiados, una persona sin fila en employees y una
-- persona con doble rol (employee + supervisor) para probar el reemplazo -----------------------

insert into public.clients (id, legal_name) values ('c3100000-0000-0000-0000-000000000001', 'Cliente RPC users');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c3100000-0000-0000-0000-000000000081', 'test-db015-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c3100000-0000-0000-0000-000000000082', 'test-db015-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('c3100000-0000-0000-0000-000000000083', 'test-db015-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('c3100000-0000-0000-0000-000000000084', 'test-db015-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('c3100000-0000-0000-0000-000000000085', 'test-db015-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('c3100000-0000-0000-0000-000000000086', 'test-db015-sin-employee@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Empleado')),
  ('c3100000-0000-0000-0000-000000000087', 'test-db015-multirol@example.com', jsonb_build_object('first_name', 'Multi', 'last_name', 'Rol'));

insert into public.user_roles (profile_id, role) values
  ('c3100000-0000-0000-0000-000000000081', 'owner'),
  ('c3100000-0000-0000-0000-000000000082', 'admin'),
  ('c3100000-0000-0000-0000-000000000083', 'admin'),
  ('c3100000-0000-0000-0000-000000000084', 'supervisor'),
  ('c3100000-0000-0000-0000-000000000085', 'employee'),
  ('c3100000-0000-0000-0000-000000000087', 'employee'),
  ('c3100000-0000-0000-0000-000000000087', 'supervisor');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('c3100000-0000-0000-0000-000000000082', 'manage_users', true),
  ('c3100000-0000-0000-0000-000000000083', 'manage_users', false);

insert into public.employees (profile_id, dni) values
  ('c3100000-0000-0000-0000-000000000084', '53100084'),
  ('c3100000-0000-0000-0000-000000000085', '53100085'),
  ('c3100000-0000-0000-0000-000000000087', '53100087');

-- ---------------------------------------------------------------------------------------------
-- set_user_roles: permisos ----------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Un supervisor no puede llamarla en absoluto.
select tests.as_user('test-db015-supervisora@example.com');

prepare set_roles_as_supervisor as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000085', array['employee', 'supervisor']::public.app_role[]);

select throws_ok(
  'set_roles_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'set_user_roles: un supervisor no puede llamarla (FORBIDDEN)'
);

-- Un admin SIN manage_users no puede llamarla.
select tests.as_user('test-db015-admin-sin-cap@example.com');

prepare set_roles_as_admin_no_cap as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000085', array['employee', 'supervisor']::public.app_role[]);

select throws_ok(
  'set_roles_as_admin_no_cap', 'P0001', 'No tenés permiso para hacer esto.',
  'set_user_roles: un admin sin manage_users no puede llamarla (FORBIDDEN)'
);

-- Un admin CON manage_users no puede otorgar admin/owner.
select tests.as_user('test-db015-admin-con-cap@example.com');

prepare set_roles_admin_grants_admin as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000085', array['admin']::public.app_role[]);

select throws_ok(
  'set_roles_admin_grants_admin', 'P0001', 'No tenés permiso para hacer esto.',
  'set_user_roles: un admin con manage_users no puede otorgar el rol admin (FORBIDDEN)'
);

-- Un admin CON manage_users no puede tocar a alguien que ya es admin (ni para sacarle el rol).
prepare set_roles_admin_touches_admin as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000083', array['employee']::public.app_role[]);

select throws_ok(
  'set_roles_admin_touches_admin', 'P0001', 'No tenés permiso para hacer esto.',
  'set_user_roles: un admin con manage_users no puede tocar a alguien que ya es admin (FORBIDDEN)'
);

-- Un admin CON manage_users SÍ puede asignar supervisor/employee a alguien sin roles privilegiados.
select is(
  public.set_user_roles('c3100000-0000-0000-0000-000000000085', array['employee', 'supervisor']::public.app_role[]),
  array['supervisor', 'employee']::public.app_role[],
  'set_user_roles: admin con manage_users asigna employee+supervisor a alguien sin roles privilegiados (orden del enum: supervisor antes que employee)'
);

set local role postgres;

-- ROLE_REQUIRES_EMPLOYEE: pedir employee/supervisor para alguien sin fila en employees ----------

select tests.as_user('test-db015-owner@example.com');

prepare set_roles_requires_employee as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000086', array['employee']::public.app_role[]);

select throws_ok(
  'set_roles_requires_employee', 'P0001', 'Ese rol necesita datos de empleado cargados primero.',
  'set_user_roles: pedir employee sin fila en employees -> ROLE_REQUIRES_EMPLOYEE'
);

-- LAST_OWNER: no se puede dejar al único owner sin ese rol ---------------------------------------

prepare set_roles_last_owner as
  select public.set_user_roles('c3100000-0000-0000-0000-000000000081', array['admin']::public.app_role[]);

select throws_ok(
  'set_roles_last_owner', 'P0001', 'No se puede quitar al último dueño.',
  'set_user_roles: intentar sacarle owner al único owner -> LAST_OWNER (vía app.prevent_last_owner_removal)'
);

set local role postgres;

-- El owner SÍ puede reemplazar el conjunto de alguien con doble rol (pierde el que no está en el
-- nuevo conjunto) --------------------------------------------------------------------------------

select tests.as_user('test-db015-owner@example.com');

select is(
  public.set_user_roles('c3100000-0000-0000-0000-000000000087', array['employee']::public.app_role[]),
  array['employee']::public.app_role[],
  'set_user_roles: owner reemplaza el conjunto -- persona con employee+supervisor queda solo con employee'
);

set local role postgres;

select is(
  (select count(*)::int from public.user_roles where profile_id = 'c3100000-0000-0000-0000-000000000087' and role = 'supervisor'),
  0,
  'set_user_roles: el rol supervisor efectivamente se borró de user_roles'
);

-- El owner SÍ puede otorgar admin a alguien -------------------------------------------------------

select tests.as_user('test-db015-owner@example.com');

select is(
  public.set_user_roles('c3100000-0000-0000-0000-000000000085', array['employee', 'admin']::public.app_role[]),
  array['admin', 'employee']::public.app_role[],
  'set_user_roles: owner otorga admin a un empleado, manteniendo employee'
);

set local role postgres;

-- Evento roles_changed registrado ------------------------------------------------------------------

select is(
  (select count(*)::int from public.security_events where event_type = 'roles_changed' and target_id = 'c3100000-0000-0000-0000-000000000085'),
  2,
  'set_user_roles: registra un evento roles_changed por cada llamada exitosa sobre ese profile_id (2: admin le dio employee+supervisor, owner le dio employee+admin)'
);

-- PROFILE_NOT_FOUND ---------------------------------------------------------------------------------

select tests.as_user('test-db015-owner@example.com');

prepare set_roles_profile_not_found as
  select public.set_user_roles('00000000-0000-0000-0000-000000000000', array['employee']::public.app_role[]);

select throws_ok(
  'set_roles_profile_not_found', 'P0001', 'No encontramos a esa persona.',
  'set_user_roles: profile_id inexistente -> PROFILE_NOT_FOUND'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- set_admin_capability -----------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Un admin (no owner) no puede llamarla, ni siquiera con manage_users.
select tests.as_user('test-db015-admin-con-cap@example.com');

prepare set_capability_as_admin as
  select public.set_admin_capability('c3100000-0000-0000-0000-000000000083', 'cancel_shifts'::public.admin_capability, true);

select throws_ok(
  'set_capability_as_admin', 'P0001', 'No tenés permiso para hacer esto.',
  'set_admin_capability: un admin no puede llamarla (FORBIDDEN, solo owner)'
);

-- ADMIN_ROLE_REQUIRED: profile_id sin rol admin.
select tests.as_user('test-db015-owner@example.com');

-- Usa la supervisora (nunca tocada con roles admin en este archivo; el empleado ...085 ya
-- recibió el rol admin en el bloque anterior de set_user_roles).
prepare set_capability_not_admin as
  select public.set_admin_capability('c3100000-0000-0000-0000-000000000084', 'cancel_shifts'::public.admin_capability, true);

select throws_ok(
  'set_capability_not_admin', 'P0001', 'Esa persona no tiene rol de administrador.',
  'set_admin_capability: profile_id sin rol admin -> ADMIN_ROLE_REQUIRED'
);

-- El owner activa una capacidad nueva.
select is(
  (public.set_admin_capability('c3100000-0000-0000-0000-000000000083', 'cancel_shifts'::public.admin_capability, true)).enabled,
  true,
  'set_admin_capability: owner activa cancel_shifts para admin-sin-cap'
);

-- Upsert: el owner desactiva la misma capacidad (ya existente, en true).
select is(
  (public.set_admin_capability('c3100000-0000-0000-0000-000000000083', 'cancel_shifts'::public.admin_capability, false)).enabled,
  false,
  'set_admin_capability: upsert -- la misma capacidad se puede desactivar después'
);

set local role postgres;

select is(
  (select count(*)::int from public.admin_capabilities where profile_id = 'c3100000-0000-0000-0000-000000000083' and capability = 'cancel_shifts'),
  1,
  'set_admin_capability: el upsert no duplicó la fila (sigue habiendo una sola)'
);

select is(
  (select count(*)::int from public.security_events where event_type = 'capabilities_changed' and target_id = 'c3100000-0000-0000-0000-000000000083'),
  2,
  'set_admin_capability: registra un evento capabilities_changed por cada llamada exitosa'
);

-- ---------------------------------------------------------------------------------------------
-- mark_changes_seen ----------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select is(
  (select last_seen_changes_at from public.profiles where id = 'c3100000-0000-0000-0000-000000000085'),
  null::timestamptz,
  'mark_changes_seen: antes de llamarla, last_seen_changes_at sigue en null'
);

select tests.as_user('test-db015-empleado@example.com');

select ok(
  (public.mark_changes_seen()).last_seen_changes_at is not null,
  'mark_changes_seen: actualiza last_seen_changes_at de la propia fila a un valor no nulo'
);

set local role postgres;

select ok(
  (select last_seen_changes_at from public.profiles where id = 'c3100000-0000-0000-0000-000000000085') is not null,
  'mark_changes_seen: el cambio quedó persistido en profiles'
);

select is(
  (select last_seen_changes_at from public.profiles where id = 'c3100000-0000-0000-0000-000000000082'),
  null::timestamptz,
  'mark_changes_seen: no afecta la fila de otra persona (admin-con-cap sigue en null)'
);

select * from finish();

rollback;
