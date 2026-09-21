-- DB-003, DB-004, DB-005 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Tercer bloque de 04_Modelo_de_Datos.md sección 11: personas y acceso (sección 2.1), más --
-- en el mismo archivo, porque el modelo no les reserva uno propio -- las funciones de permisos
-- de la sección 5 que ya no dependen de ninguna tabla adicional y el hook de Auth de la
-- sección 7.1. Contenido, en orden:
--   1. Tablas `profiles`, `user_roles`, `admin_capabilities` (sección 2.1).
--   2. RLS habilitada en las tres, sin políticas todavía (llegan en 0012, DB-014).
--   3. Trigger `app.handle_new_user()` sobre `auth.users`.
--   4. Trigger "último owner" sobre `user_roles`.
--   5. Funciones de permisos: `jwt_roles`, `jwt_capabilities`, `has_role`, `is_admin`,
--      `has_capability`, `require_role`, `require_admin`, `require_capability`.
--   6. Hook `app.custom_access_token_hook(jsonb)` y sus grants.
--
-- Nota de seguridad -- por qué el paso 2 no es opcional (afecta a toda migración de acá en
-- adelante, no solo a esta): verificado en `App_dev` con
-- `select * from pg_default_acl where defaclnamespace = 'public'::regnamespace` que el ACL por
-- defecto del esquema `public` ya concede `select/insert/update/delete` a `anon` Y a
-- `authenticated` en cuanto `postgres` crea una tabla ahí (así provisiona Supabase el
-- proyecto). Sin `enable row level security` en el mismo archivo que crea la tabla, quedaría
-- expuesta por PostgREST desde el momento en que este archivo se aplica y hasta que 0012
-- agregue las políticas de la sección 7.2 -- inaceptable porque `App_dev` también sirve de
-- staging (ADR-014, ADR-023). Por eso toda tabla nueva de esta migración (y de las que siguen)
-- habilita RLS de inmediato, aunque sus políticas lleguen recién en 0012 (DB-014): mientras
-- tanto, RLS activa y cero políticas deniega el acceso a todos salvo el dueño de la tabla y los
-- roles con el atributo `bypassrls` (`postgres`, `service_role`; se comprobó con
-- `select rolname, rolbypassrls from pg_roles` que `supabase_auth_admin` NO lo tiene).

-- ---------------------------------------------------------------------------------------------
-- 1. Tablas (04 sección 2.1)
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id),
  first_name text not null,
  last_name text not null,
  contact_email text,
  phone text,
  avatar_path text,
  location_consent_at timestamptz,
  last_seen_changes_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz
);

comment on table public.profiles is
  'Una fila por persona con usuario, cualquiera sea su rol (04 sección 2.1). La crea app.handle_new_user() al insertar en auth.users; nunca se borra físicamente.';

alter table public.profiles enable row level security;

-- Búsqueda de personas por nombre (04 sección 8).
create index profiles_last_name_first_name_idx on public.profiles (last_name, first_name);

create trigger trg_set_updated_at
before update on public.profiles
for each row execute function app.set_updated_at();

create table public.user_roles (
  profile_id uuid not null references public.profiles (id),
  role public.app_role not null,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (profile_id, role)
);

comment on table public.user_roles is
  'Roles de cada persona, varios por persona (04 sección 2.1, ADR-007). Siempre queda al menos un owner (trigger app.prevent_last_owner_removal). Se escribe por RPC (set_user_roles, DB-015) o por la Edge Function admin-users al dar de alta.';

alter table public.user_roles enable row level security;

create table public.admin_capabilities (
  profile_id uuid not null references public.profiles (id),
  capability public.admin_capability not null,
  enabled boolean not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (profile_id, capability)
);

comment on table public.admin_capabilities is
  'Capacidades activables por administrador (04 sección 2.1, ADR-006). El owner las tiene todas implícitamente, no figuran acá para el owner. Se escribe por RPC (set_admin_capability, DB-015); la regla "el profile_id tiene que tener rol admin" la valida esa RPC, no una restricción de tabla.';

alter table public.admin_capabilities enable row level security;

create trigger trg_set_updated_at
before update on public.admin_capabilities
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. app.handle_new_user(): trigger sobre auth.users (04 sección 2.1, sección 5)
-- ---------------------------------------------------------------------------------------------

-- Patrón documentado por Supabase para "Managing User Data"
-- (https://supabase.com/docs/guides/auth/managing-user-data): función `security definer` con
-- `search_path` fijo, trigger AFTER INSERT en auth.users. `security definer` para que la
-- inserción en public.profiles corra con los permisos de quien creó la función (dueña de la
-- tabla) sin importar qué rol haya hecho el INSERT en auth.users (supabase_auth_admin al crear
-- el usuario por Admin API en producción; postgres en los tests pgTAP). Nombre y apellido
-- salen de `raw_user_meta_data` (los provee quien crea el usuario: la Edge Function
-- `admin-users`, F7, o `scripts/seed-dev.ts`); ADR-008 descarta el alta pública, así que
-- siempre deberían venir, pero si faltaran se guarda cadena vacía en lugar de bloquear el alta:
-- un trigger que falla acá corta el inicio de sesión de Supabase Auth entero, no solo el alta.
create function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.profiles (id, first_name, last_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', '')
  );
  return new;
end;
$$;

comment on function app.handle_new_user() is
  'Trigger AFTER INSERT en auth.users: crea la fila de profiles (04 sección 2.1, 5).';

create trigger trg_handle_new_user
after insert on auth.users
for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- 3. app.prevent_last_owner_removal(): trigger "último owner" sobre user_roles
--    (04 sección 2.1: "al menos un owner activo siempre"; 03 sección 5)
-- ---------------------------------------------------------------------------------------------

-- Se dispara al borrar la fila (el patrón que va a usar `set_user_roles`, DB-015, para
-- reemplazar el conjunto de roles de una persona) o al actualizarla si algún día se cambia
-- `role` en lugar de borrar e insertar. Compara contra el resto de las filas `owner`
-- (excluyendo la propia) dentro de la misma transacción: si no queda ninguna otra, corta con
-- el código estable LAST_OWNER (06_API.md sección 15).
create function app.prevent_last_owner_removal()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    if not exists (
      select 1
      from public.user_roles ur
      where ur.role = 'owner'
        and ur.profile_id <> old.profile_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede quitar al último dueño.',
        hint = 'LAST_OWNER';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function app.prevent_last_owner_removal() is
  'Trigger BEFORE DELETE/UPDATE en user_roles: rechaza quitar el rol owner a la última persona que lo tiene (LAST_OWNER, 06 sección 15).';

create trigger trg_prevent_last_owner_removal
before delete or update on public.user_roles
for each row execute function app.prevent_last_owner_removal();

-- ---------------------------------------------------------------------------------------------
-- 4. Funciones de permisos (04 sección 5)
-- ---------------------------------------------------------------------------------------------

-- app.jwt_roles(): roles de la sesión actual, leídos del claim "roles" que agrega el hook
-- (sección 7.1). `stable`: mismo resultado dentro de la misma consulta/transacción, como
-- cualquier lectura de auth.jwt().
create function app.jwt_roles()
returns public.app_role[]
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (
      select array_agg(t.value::public.app_role)
      from jsonb_array_elements_text(coalesce(auth.jwt() -> 'roles', '[]'::jsonb)) as t(value)
    ),
    array[]::public.app_role[]
  );
$$;

comment on function app.jwt_roles() is
  'Roles de la sesión actual (claim "roles" del JWT, 04 sección 7.1). Arreglo vacío si no tiene ninguno.';

-- app.jwt_capabilities(): capacidades de la sesión actual. Solo se completa para admin (04
-- sección 7.1); devuelve texto (no admin_capability[]) porque así la firma exacta de la
-- sección 5.
create function app.jwt_capabilities()
returns text[]
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (
      select array_agg(t.value)
      from jsonb_array_elements_text(coalesce(auth.jwt() -> 'capabilities', '[]'::jsonb)) as t(value)
    ),
    array[]::text[]
  );
$$;

comment on function app.jwt_capabilities() is
  'Capacidades de la sesión actual (claim "capabilities" del JWT, solo se completa para admin, 04 sección 7.1). Arreglo vacío si no tiene ninguna.';

create function app.has_role(p_role public.app_role)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select p_role = any(app.jwt_roles());
$$;

comment on function app.has_role(public.app_role) is
  'True si la sesión actual tiene el rol indicado (04 sección 5).';

create function app.is_admin()
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select app.has_role('owner') or app.has_role('admin');
$$;

comment on function app.is_admin() is
  'True si la sesión actual es owner o admin (04 sección 5).';

create function app.has_capability(p_capability public.admin_capability)
returns boolean
language sql
stable
set search_path = public, app, pg_temp
as $$
  select app.has_role('owner') or p_capability::text = any(app.jwt_capabilities());
$$;

comment on function app.has_capability(public.admin_capability) is
  'True para owner siempre; para admin, si la capacidad está habilitada en el JWT (04 sección 5).';

-- app.require_role / app.require_admin / app.require_capability: envoltorios de los `has_*` de
-- arriba que las RPC llaman como primera línea (06_API.md sección 0): si la condición no se
-- cumple, cortan la transacción con el código estable FORBIDDEN (06 sección 15).
create function app.require_role(variadic p_roles public.app_role[])
returns void
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
begin
  if not exists (
    select 1 from unnest(p_roles) as r(role) where app.has_role(r.role)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;
end;
$$;

comment on function app.require_role(public.app_role[]) is
  'Corta con FORBIDDEN si la sesión actual no tiene ninguno de los roles indicados (04 sección 5, 06 sección 0).';

create function app.require_admin()
returns void
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;
end;
$$;

comment on function app.require_admin() is
  'Corta con FORBIDDEN si la sesión actual no es owner ni admin (04 sección 5, 06 sección 0).';

create function app.require_capability(p_capability public.admin_capability)
returns void
language plpgsql
stable
set search_path = public, app, pg_temp
as $$
begin
  if not app.has_capability(p_capability) then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;
end;
$$;

comment on function app.require_capability(public.admin_capability) is
  'Corta con FORBIDDEN si la sesión actual no tiene la capacidad indicada (el owner siempre la tiene, 04 sección 5, 06 sección 0).';

-- ---------------------------------------------------------------------------------------------
-- 5. app.custom_access_token_hook(jsonb): hook de Auth (04 sección 5 y 7.1)
-- ---------------------------------------------------------------------------------------------

-- Patrón oficial de Supabase para "Custom Access Token Hook"
-- (https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook), aplicado así:
--   - Firma `(event jsonb) returns jsonb`: recibe `{user_id, claims, authentication_method}` y
--     devuelve el mismo evento con `claims` modificado (jsonb_set sobre event->'claims'), tal
--     cual el ejemplo de la documentación -- no se devuelve un objeto nuevo con solo "claims".
--   - Grants (después de la función): `grant usage`/`grant execute` a `supabase_auth_admin` (el
--     rol con el que Supabase Auth invoca el hook) y `revoke execute` de `public`, `anon` y
--     `authenticated`, calcado del ejemplo oficial.
--   - Diferencia deliberada con el ejemplo oficial: la documentación de Supabase no marca su
--     función de ejemplo `security definer` y en cambio le da a `supabase_auth_admin` acceso
--     directo a la tabla que consulta (`grant all ... to supabase_auth_admin`). Acá no alcanza:
--     esta base habilita RLS en cuanto crea cada tabla (nota de seguridad al principio del
--     archivo) y `supabase_auth_admin` NO tiene el atributo `bypassrls` (verificado en
--     App_dev: `select rolbypassrls from pg_roles where rolname = 'supabase_auth_admin'` ->
--     false; sí lo tienen `postgres` y `service_role`). Sin `security definer`, el hook
--     dejaría de poder leer `user_roles`/`admin_capabilities` en cuanto 0012 agregue las
--     políticas de RLS -- que además nunca van a reconocer a `supabase_auth_admin`, un rol de
--     servicio sin sesión de usuario ni `auth.uid()`. Por eso la función es `security definer`
--     (dueña: quien corre esta migración, con privilegio para leer ambas tablas sin pasar por
--     RLS) y ya no hace falta darle a `supabase_auth_admin` acceso directo a las tablas, solo a
--     la función.
create function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_profile_id uuid;
  v_claims jsonb;
  v_roles jsonb;
  v_is_admin boolean;
  v_capabilities jsonb;
begin
  v_profile_id := (event ->> 'user_id')::uuid;
  v_claims := event -> 'claims';

  select coalesce(jsonb_agg(ur.role order by ur.role), '[]'::jsonb), bool_or(ur.role = 'admin')
    into v_roles, v_is_admin
  from public.user_roles ur
  where ur.profile_id = v_profile_id;

  v_roles := coalesce(v_roles, '[]'::jsonb);

  if v_is_admin then
    select coalesce(jsonb_agg(ac.capability order by ac.capability), '[]'::jsonb)
      into v_capabilities
    from public.admin_capabilities ac
    where ac.profile_id = v_profile_id
      and ac.enabled = true;
  else
    v_capabilities := '[]'::jsonb;
  end if;

  v_claims := jsonb_set(v_claims, '{roles}', v_roles);
  v_claims := jsonb_set(v_claims, '{capabilities}', v_capabilities);

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function app.custom_access_token_hook(jsonb) is
  'Hook de Auth: agrega los claims "roles" y "capabilities" al JWT (04 sección 7.1). Invocado únicamente por supabase_auth_admin.';

-- ---------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------

-- `authenticated` necesita USAGE en el esquema `app` para poder evaluar, dentro de las
-- políticas RLS que agrega 0012 (DB-014), expresiones como `app.has_role(...)`: sin este grant
-- de esquema, ninguna política que use estas funciones auxiliares podría evaluarse desde una
-- sesión autenticada, sin importar los permisos de la función en sí (verificado en App_dev:
-- `has_schema_privilege('authenticated','app','USAGE')` daba `false` antes de este grant, aun
-- cuando `has_function_privilege('authenticated','app.local_ts(date,time)','EXECUTE')` ya daba
-- `true` por el privilegio EXECUTE que Postgres concede a PUBLIC al crear una función). No se
-- otorga a `anon`: no participa de ninguna política basada en rol (04 sección 7.2, "anon solo
-- v_public_branding"). Las funciones de este archivo no necesitan un `grant execute`
-- individual porque ya lo tienen (PUBLIC), salvo el hook, que lo revoca explícitamente abajo.
grant usage on schema app to authenticated;

-- Permisos del hook (04 sección 7.1, DB-004): solo supabase_auth_admin puede invocarlo.
grant usage on schema app to supabase_auth_admin;
grant execute on function app.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function app.custom_access_token_hook(jsonb) from public, anon, authenticated;
