-- DB-015 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base, P04.5 tramo B)
--
-- Primer bloque de RPC de la fase 4 (04_Modelo_de_Datos.md sección 9, todas security definer,
-- search_path fijo, parámetros p_, primero app.require_role/require_capability, transacción
-- única, error P0001 con mensaje en voseo y hint estable): `set_user_roles`,
-- `set_admin_capability`, `mark_changes_seen` (06_API.md sección 2.2). Viven en el esquema
-- `public` (no `app`): `supabase/config.toml` solo expone `public`/`graphql_public` a PostgREST,
-- así que toda RPC invocable por el cliente (`supabase-js .rpc(...)`) tiene que estar ahí, a
-- diferencia de las funciones auxiliares de permisos, que sí van en `app`.
--
-- Los grants de `execute` (revocar de `public`/`anon`, conceder a `authenticated`) quedan para
-- `0017_grants.sql` (DB-017, encargo explícito del tramo B): hasta entonces, estas tres
-- funciones quedan con el `execute` que Postgres concede a `public` por defecto al crearlas
-- (incluye `anon`), igual que las funciones de `0001`/`0007`/`0010` antes de sus grants.

-- ---------------------------------------------------------------------------------------------
-- 1. set_user_roles(p_profile_id, p_roles) -- 04 sección 9, 06_API.md sección 2.2
-- ---------------------------------------------------------------------------------------------

-- Reemplaza el conjunto de roles de una persona (04 sección 2.1: "RPC set_user_roles"). Quién
-- puede llamarla: owner siempre; admin solo con `manage_users` -- se resuelve con
-- `app.require_capability('manage_users')` en una sola línea porque esa función ya devuelve
-- `true` para el owner siempre (04 sección 5), sin duplicar la condición "O; A + capacidad".
-- Restricción adicional para admin (06_API.md: "A + manage_users solo si el conjunto resultante
-- no incluye owner ni admin y el usuario no era owner ni admin"): un admin no puede, por esta
-- vía, otorgar ni quitar `owner`/`admin`, ni tocar a alguien que ya tenga alguno de esos roles
-- -- ni siquiera a sí mismo (si es admin, "el usuario no era owner ni admin" ya lo excluye).
-- ROLE_REQUIRES_EMPLOYEE (P-013, 04 sección 2.1: "Los roles employee y supervisor exigen fila en
-- employees"): si el conjunto pedido incluye alguno de los dos, `p_profile_id` tiene que tener
-- fila en `employees` (la crea la Edge Function `admin-users`, USERS-002, F7 -- todavía no
-- escrita; esta RPC no la crea).
-- La regla del último owner (LAST_OWNER) no se reimplementa acá: la aplica el trigger
-- `app.prevent_last_owner_removal` (0003) en cuanto el `delete` de abajo borra la fila `owner`
-- de la última persona que lo tiene.
-- Devuelve `app_role[]`, no la fila de una tabla: la operación reemplaza un conjunto de filas de
-- `user_roles` (PK compuesta `profile_id, role`), no hay una única "fila afectada" que devolver
-- (decisión menor, documentada en el reporte de la tarea).
create function public.set_user_roles(p_profile_id uuid, p_roles public.app_role[])
returns public.app_role[]
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_roles public.app_role[];
  v_current_roles public.app_role[];
  v_target_was_privileged boolean;
  v_result_has_privileged boolean;
  v_result public.app_role[];
begin
  perform app.require_capability('manage_users');

  if not exists (select 1 from public.profiles p where p.id = p_profile_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  -- Normaliza: sin valores nulos ni repetidos en el conjunto pedido.
  v_roles := coalesce(
    (select array_agg(distinct r) from unnest(p_roles) as r where r is not null),
    array[]::public.app_role[]
  );

  select coalesce(array_agg(ur.role), array[]::public.app_role[])
    into v_current_roles
  from public.user_roles ur
  where ur.profile_id = p_profile_id;

  v_target_was_privileged := 'owner' = any(v_current_roles) or 'admin' = any(v_current_roles);
  v_result_has_privileged := 'owner' = any(v_roles) or 'admin' = any(v_roles);

  if not app.has_role('owner') and (v_target_was_privileged or v_result_has_privileged) then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  if ('employee' = any(v_roles) or 'supervisor' = any(v_roles))
    and not exists (select 1 from public.employees e where e.profile_id = p_profile_id)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Ese rol necesita datos de empleado cargados primero.',
      hint = 'ROLE_REQUIRES_EMPLOYEE';
  end if;

  -- Reemplaza el conjunto: borra lo que sobra (dispara app.prevent_last_owner_removal si
  -- corresponde, LAST_OWNER) e inserta lo que falta.
  delete from public.user_roles ur
  where ur.profile_id = p_profile_id
    and not (ur.role = any(v_roles));

  insert into public.user_roles (profile_id, role, granted_by, granted_at)
  select p_profile_id, r, auth.uid(), now()
  from unnest(v_roles) as r
  on conflict (profile_id, role) do nothing;

  perform app.log_security_event(
    'roles_changed'::public.security_event_type,
    auth.uid(),
    p_profile_id,
    jsonb_build_object('roles_previous', to_jsonb(v_current_roles), 'roles_new', to_jsonb(v_roles))
  );

  select coalesce(array_agg(ur.role order by ur.role), array[]::public.app_role[])
    into v_result
  from public.user_roles ur
  where ur.profile_id = p_profile_id;

  return v_result;
end;
$$;

comment on function public.set_user_roles(uuid, public.app_role[]) is
  'Reemplaza el conjunto de roles de una persona (04 sección 2.1, 06_API.md sección 2.2). Owner: sin restricciones (sujeto a LAST_OWNER). Admin con manage_users: no puede tocar owner/admin, ni asignarlos, ni actuar sobre alguien que ya los tenga. ROLE_REQUIRES_EMPLOYEE si el conjunto incluye employee/supervisor sin fila en employees. Evento roles_changed. Si el frontend quita un rol, después llama a la Edge Function sign_out_user (P-015) para que el JWT viejo no siga valiendo -- esta RPC no cierra sesiones.';

-- ---------------------------------------------------------------------------------------------
-- 2. set_admin_capability(p_profile_id, p_capability, p_enabled) -- 04 sección 9, 06 sección 2.2
-- ---------------------------------------------------------------------------------------------

-- Solo el owner (04 sección 7.2: "admin_capabilities | ... | RPC set_admin_capability (O)"), a
-- diferencia de set_user_roles: ni el admin con manage_users la puede llamar. `p_profile_id`
-- tiene que tener rol admin (04 sección 2.1: "profile_id | uuid FK profiles | Debe tener rol
-- admin"); ADMIN_ROLE_REQUIRED no está en la tabla de códigos de 06 sección 15 (decisión menor,
-- documentada en el reporte de la tarea, mismo criterio que ROLE_REQUIRES_EMPLOYEE arriba). Hace
-- upsert (una persona puede no tener fila todavía para esa capacidad puntual).
create function public.set_admin_capability(
  p_profile_id uuid,
  p_capability public.admin_capability,
  p_enabled boolean
)
returns public.admin_capabilities
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.admin_capabilities;
begin
  perform app.require_role('owner');

  if not exists (
    select 1 from public.user_roles ur
    where ur.profile_id = p_profile_id and ur.role = 'admin'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Esa persona no tiene rol de administrador.',
      hint = 'ADMIN_ROLE_REQUIRED';
  end if;

  insert into public.admin_capabilities (profile_id, capability, enabled, updated_by, updated_at)
  values (p_profile_id, p_capability, p_enabled, auth.uid(), now())
  on conflict (profile_id, capability)
  do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_row;

  perform app.log_security_event(
    'capabilities_changed'::public.security_event_type,
    auth.uid(),
    p_profile_id,
    jsonb_build_object('capability', p_capability, 'enabled', p_enabled)
  );

  return v_row;
end;
$$;

comment on function public.set_admin_capability(uuid, public.admin_capability, boolean) is
  'Activa o desactiva una capacidad de un administrador (04 sección 2.1, 7.2, 9). Solo owner (ni siquiera admin con manage_users). ADMIN_ROLE_REQUIRED si profile_id no tiene rol admin. Upsert; evento capabilities_changed.';

-- ---------------------------------------------------------------------------------------------
-- 3. mark_changes_seen() -- 04 sección 9, 06 sección 2.2, P-092
-- ---------------------------------------------------------------------------------------------

-- Cualquier persona autenticada, sobre su propia fila (auth.uid(), no recibe parámetro -- no
-- hay forma de marcarle los cambios vistos a otra persona). Sin app.require_role/require_capability
-- porque no hay ninguna restricción de rol (04 sección 9: "cualquiera"); igual security definer
-- por consistencia con el resto de la sección 9 y porque la columna que toca
-- (last_seen_changes_at) todavía no tiene su grant de columna para authenticated (llega en
-- 0017_grants.sql, DB-017).
create function public.mark_changes_seen()
returns public.profiles
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.profiles;
begin
  update public.profiles
  set last_seen_changes_at = now()
  where id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

comment on function public.mark_changes_seen() is
  'Actualiza profiles.last_seen_changes_at = now() para la persona autenticada (P-092). Sin parámetros: siempre sobre la propia fila. El frontend la llama al abrir Hoy, no al iniciar sesión (06_API.md sección 1).';
