-- Sin tarea DB numerada -- corrección encontrada al verificar en vivo contra `App_dev` la
-- ventana de revocación de `0020_permission_functions_active_check.sql` (P07.1, decisión de
-- Mike del 23 sep 2026).
--
-- El hallazgo: `0020` hace que `app.has_role`/`app.has_capability` (y por herencia `app.is_admin`,
-- `app.require_role`, `app.require_capability`) exijan perfil activo, y con eso alcanza para
-- TODA política de `0012_rls_policies.sql` que pase por una de esas funciones. Pero varias
-- políticas de "acceso a la fila propia" (04 sección 7.2, "propio" = `auth.uid()` coincide) NO
-- pasan por ninguna función de rol: comparan `auth.uid()` directo contra la columna, porque el
-- diseño no exige un rol puntual para ver los datos propios (cualquier persona con sesión ve su
-- propio perfil, sus propios roles, etc.). El resultado, comprobado en vivo (ver el reporte de
-- la tarea): una persona recién desactivada por `deactivate_user`, con su `access_token` todavía
-- vigente (hasta `jwt_expiry`, ahora 900 s), seguía leyendo su propia fila de `profiles` por
-- PostgREST -- exactamente lo que la decisión de Mike (b) quería cerrar, sin excepción para
-- "los datos propios".
--
-- La corrección: `app.current_uid()`, que devuelve `auth.uid()` solo si el perfil sigue activo y
-- no borrado (si no, `null` -- y `null = cualquier_columna` nunca es verdadero en SQL, así que la
-- política deja de matchear ninguna fila). Se reemplaza `auth.uid()` por `app.current_uid()` en
-- las ocho políticas de "propio"/"own" que no pasaban por ninguna función de rol: el resto de
-- las políticas que ya usan `app.has_role`/`app.is_admin` en la misma condición (por ejemplo,
-- `assignments_update_own_notes`, `attendance_records_select_employee`,
-- `supervisions_select_own`) no se tocan acá, porque ya quedaron cubiertas por `0020`.
--
-- `drop policy` + `create policy`, no hay `create or replace policy` en Postgres.

-- ---------------------------------------------------------------------------------------------
-- 1. app.current_uid()
-- ---------------------------------------------------------------------------------------------

create function app.current_uid()
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select case when app.current_profile_active() then auth.uid() else null end;
$$;

comment on function app.current_uid() is
  'auth.uid() si el perfil de esa sesión sigue activo y no borrado (app.current_profile_active()), null si no. Reemplaza a auth.uid() en las políticas RLS de "fila propia" que no pasan por ninguna función de rol (04 sección 7.2), para que la ventana de revocación (decisión de Mike del 23 sep 2026) también las alcance: null no es igual a ninguna columna, así que la política deja de matchear filas.';

-- ---------------------------------------------------------------------------------------------
-- 2. profiles
-- ---------------------------------------------------------------------------------------------

drop policy profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = app.current_uid());

drop policy profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = app.current_uid())
  with check (id = app.current_uid());

-- ---------------------------------------------------------------------------------------------
-- 3. user_roles, admin_capabilities
-- ---------------------------------------------------------------------------------------------

drop policy user_roles_select_own on public.user_roles;
create policy user_roles_select_own
  on public.user_roles for select to authenticated
  using (profile_id = app.current_uid());

drop policy admin_capabilities_select_own on public.admin_capabilities;
create policy admin_capabilities_select_own
  on public.admin_capabilities for select to authenticated
  using (profile_id = app.current_uid());

-- ---------------------------------------------------------------------------------------------
-- 4. employees, employee_client_permissions, employee_availability, employee_leaves
-- ---------------------------------------------------------------------------------------------

drop policy employees_select_own on public.employees;
create policy employees_select_own
  on public.employees for select to authenticated
  using (profile_id = app.current_uid());

drop policy employee_client_permissions_select_own on public.employee_client_permissions;
create policy employee_client_permissions_select_own
  on public.employee_client_permissions for select to authenticated
  using (employee_id = app.current_uid());

drop policy employee_availability_select_own on public.employee_availability;
create policy employee_availability_select_own
  on public.employee_availability for select to authenticated
  using (employee_id = app.current_uid());

drop policy employee_leaves_select_own on public.employee_leaves;
create policy employee_leaves_select_own
  on public.employee_leaves for select to authenticated
  using (employee_id = app.current_uid() and deleted_at is null);
