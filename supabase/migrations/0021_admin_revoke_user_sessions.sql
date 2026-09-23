-- Sin tarea DB numerada -- ajuste encontrado al verificar en vivo la Edge Function `admin-users`
-- (USERS-003, USERS-004, P07.1) contra `App_dev`.
--
-- 06_API.md sección 2.1 describe `reset_password`/`sign_out_user`/`deactivate_user` como
-- "revoca sesiones" con `auth.admin.signOut(userId, 'global')`. Probado en vivo, ese método de
-- `supabase-js` NO sirve para eso: `GoTrueAdminApi.signOut(jwt, scope)` usa el primer argumento
-- como el `Authorization: Bearer <jwt>` de la request a `POST /auth/v1/logout` (revoca LA SESIÓN
-- DUEÑA DE ESE TOKEN, sea cual sea la scope), no "todas las sesiones de este profile_id" -- pasarle
-- un uuid ahí manda un JWT inválido y GoTrue devuelve 401 (verificado: el primer intento de
-- `sign_out_user` contra `App_dev` dio 500 INTERNAL_ERROR en las seis acciones que revocan
-- sesión). No hay, en la Admin API pública, un método "cerrar todas las sesiones de este user_id".
--
-- La tabla que sí tiene esa información, `auth.sessions`, no está expuesta por PostgREST (04
-- sección 0, `supabase/config.toml`: solo `public`/`graphql_public`), así que ni siquiera con
-- `service_role` (que salta RLS, pero no la exposición de esquemas de PostgREST) la Edge Function
-- puede borrar ahí directo por `.from(...)`. Hace falta esta función, en `public` por el mismo
-- motivo que las RPC de `0013_rpc_users.sql` (PostgREST solo expone RPC de ese esquema).
--
-- No es una RPC de 06_API.md sección 9 (no la llama el frontend, no tiene `app.require_role`):
-- uso exclusivo de la Edge Function `admin-users`, con `execute` revocado a todos salvo
-- `service_role`.
create function public.admin_revoke_user_sessions(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  delete from auth.sessions where user_id = p_profile_id;
end;
$$;

comment on function public.admin_revoke_user_sessions(uuid) is
  'Revoca (borra) todas las filas de auth.sessions de una persona -- lo que auth.admin.signOut() de supabase-js no puede hacer por profile_id (revoca por JWT, no por usuario) y lo que PostgREST no expone directo (auth.sessions no es un esquema expuesto). Uso exclusivo de la Edge Function admin-users, conexión service_role. No es RPC de 06_API.md sección 9: sin app.require_role, execute revocado a public/anon/authenticated.';

revoke execute on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;
