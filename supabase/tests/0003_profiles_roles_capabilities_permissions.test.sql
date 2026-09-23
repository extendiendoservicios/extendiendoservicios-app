-- pgTAP de la migración 0003_profiles_roles_capabilities.sql (DB-004, DB-005, TEST-002).
--
-- Cubre: el fixture tests.as_user(email) (TEST-002), el hook app.custom_access_token_hook
-- (DB-004) y las funciones de permisos app.jwt_roles/jwt_capabilities/has_role/is_admin/
-- has_capability (DB-005). Estructura y restricciones de las tablas, handle_new_user y el
-- trigger del último owner están en 0003_profiles_roles_capabilities.test.sql.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

-- tests.as_user(email) (TEST-002) -------------------------------------------------------------
--
-- Se crea acá, dentro de la transacción del archivo (nunca en una migración), tal como
-- documenta supabase/tests/README.md. Resuelve el profile_id buscando el email en auth.users
-- (todavía no hay seed, DB-019: cada test de este archivo crea sus propias filas de
-- auth.users antes de llamar a esta función) y arma los claims llamando al mismo
-- app.custom_access_token_hook que usa producción -- así el fixture no duplica la lógica de
-- roles/capacidades y cualquier cambio futuro al hook se refleja acá solo. Cuando exista el
-- seed (DB-019), esta función no cambia: seguirá resolviendo por email contra auth.users, ya
-- con las filas que inserte el seed en lugar de las que cree cada test.
create schema if not exists tests;

-- authenticated (y anon, por si algún test futuro necesita encadenar tests.as_user después de
-- simular un visitante anónimo) necesitan USAGE sobre el esquema para poder invocar la función
-- de nuevo después de que la primera llamada haya cambiado el rol activo.
grant usage on schema tests to authenticated, anon;

create or replace function tests.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  -- Vuelve a postgres primero: si esta función se llama de nuevo después de una simulación
  -- previa (rol activo != postgres), authenticated/anon no tienen SELECT sobre auth.users.
  perform set_config('role', 'postgres', true);

  select id into v_user_id from auth.users where email = p_email;

  if v_user_id is null then
    raise exception 'tests.as_user: no existe auth.users.email = %', p_email;
  end if;

  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object(
          'sub', v_user_id::text,
          'email', p_email,
          'role', 'authenticated'
        )
      )
    )
  ) -> 'claims';

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

comment on function tests.as_user(text) is
  'TEST-002: fija request.jwt.claims y el rol activo en authenticated como si p_email hubiera iniciado sesión (busca el profile_id en auth.users y arma los claims con app.custom_access_token_hook). Solo para tests; no se crea en una migración.';

grant execute on function tests.as_user(text) to authenticated, anon;

select plan(20);

-- Fixtures: una persona owner, una admin (con una capacidad habilitada y otra deshabilitada),
-- una supervisor+employee (multirol, ADR-007) y una sin ningún rol. --------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000001', 'test-perm-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('b0000000-0000-0000-0000-000000000002', 'test-perm-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('b0000000-0000-0000-0000-000000000003', 'test-perm-multirol@example.com', jsonb_build_object('first_name', 'Multi', 'last_name', 'Tres')),
  ('b0000000-0000-0000-0000-000000000004', 'test-perm-sinrol@example.com', jsonb_build_object('first_name', 'Sin', 'last_name', 'Rol'));

insert into public.user_roles (profile_id, role) values
  ('b0000000-0000-0000-0000-000000000001', 'owner'),
  ('b0000000-0000-0000-0000-000000000002', 'admin'),
  ('b0000000-0000-0000-0000-000000000003', 'supervisor'),
  ('b0000000-0000-0000-0000-000000000003', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('b0000000-0000-0000-0000-000000000002', 'cancel_shifts', true),
  ('b0000000-0000-0000-0000-000000000002', 'edit_ratings', false);

-- app.custom_access_token_hook: persona con roles y capacidades conocidos ---------------------

select is(
  (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', 'b0000000-0000-0000-0000-000000000002',
        'claims', jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000002', 'role', 'authenticated')
      )
    ) -> 'claims' -> 'roles'
  ),
  '["admin"]'::jsonb,
  'hook: admin -> claim roles = ["admin"]'
);

select is(
  (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', 'b0000000-0000-0000-0000-000000000002',
        'claims', jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000002', 'role', 'authenticated')
      )
    ) -> 'claims' -> 'capabilities'
  ),
  '["cancel_shifts"]'::jsonb,
  'hook: admin -> claim capabilities = solo las habilitadas (cancel_shifts, no edit_ratings)'
);

select is(
  (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', 'b0000000-0000-0000-0000-000000000003',
        'claims', jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000003', 'role', 'authenticated')
      )
    ) -> 'claims' -> 'roles'
  ),
  '["supervisor", "employee"]'::jsonb,
  'hook: multirol -> claim roles trae los dos roles'
);

select is(
  (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', 'b0000000-0000-0000-0000-000000000003',
        'claims', jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000003', 'role', 'authenticated')
      )
    ) -> 'claims' -> 'capabilities'
  ),
  '[]'::jsonb,
  'hook: no admin -> claim capabilities vacío (solo se completa para admin, 04 sección 7.1)'
);

-- app.custom_access_token_hook: persona sin ningún rol -> arreglo vacío ----------------------

select is(
  (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', 'b0000000-0000-0000-0000-000000000004',
        'claims', jsonb_build_object('sub', 'b0000000-0000-0000-0000-000000000004', 'role', 'authenticated')
      )
    ) -> 'claims' -> 'roles'
  ),
  '[]'::jsonb,
  'hook: sin roles -> claim roles = []'
);

-- app.custom_access_token_hook: authenticated no puede ejecutarlo directamente (04 sección
-- 7.1, DB-004) --------------------------------------------------------------------------------

set local role authenticated;

prepare hook_as_authenticated as
  select app.custom_access_token_hook(jsonb_build_object('user_id', 'b0000000-0000-0000-0000-000000000001', 'claims', '{}'::jsonb));

select throws_ok(
  'hook_as_authenticated',
  '42501',
  'permission denied for function custom_access_token_hook',
  'authenticated no puede ejecutar el hook directamente'
);

set local role postgres;

-- tests.as_user + funciones de permisos: owner ------------------------------------------------

select tests.as_user('test-perm-owner@example.com');

select ok(app.has_role('owner'), 'as_user owner: has_role(owner) = true');
select ok(not app.has_role('admin'), 'as_user owner: has_role(admin) = false (no tiene ese rol asignado)');
select ok(app.is_admin(), 'as_user owner: is_admin() = true');
select ok(app.has_capability('cancel_shifts'), 'as_user owner: has_capability(cancel_shifts) = true (el owner las tiene todas implícitamente)');
select ok(app.has_capability('manage_supervisions'), 'as_user owner: has_capability(manage_supervisions) = true aunque nadie se la haya activado');

-- tests.as_user + funciones de permisos: admin con una capacidad habilitada y otra no ---------

select tests.as_user('test-perm-admin@example.com');

select ok(app.has_role('admin'), 'as_user admin: has_role(admin) = true');
select ok(not app.has_role('owner'), 'as_user admin: has_role(owner) = false');
select ok(app.is_admin(), 'as_user admin: is_admin() = true');
select ok(app.has_capability('cancel_shifts'), 'as_user admin: has_capability(cancel_shifts) = true (habilitada)');
select ok(not app.has_capability('edit_ratings'), 'as_user admin: has_capability(edit_ratings) = false (deshabilitada)');
select ok(not app.has_capability('manage_users'), 'as_user admin: has_capability(manage_users) = false (nunca se le asignó)');

-- tests.as_user + funciones de permisos: sin ningún rol ---------------------------------------

select tests.as_user('test-perm-sinrol@example.com');

select ok(not app.has_role('employee'), 'as_user sin rol: has_role(employee) = false');
select ok(not app.is_admin(), 'as_user sin rol: is_admin() = false');
select ok(not app.has_capability('cancel_shifts'), 'as_user sin rol: has_capability = false');

select * from finish();

rollback;
