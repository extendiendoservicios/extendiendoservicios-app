-- 0049 · P21.6c · Revocación explícita de `execute` a PUBLIC y anon en las dos funciones de la Edge Function.
-- `admin_create_user_records` (0035/0036) y `admin_find_orphan_account` (0035) ya tenían `revoke all ... from
-- public, anon, authenticated` y `grant execute ... to service_role` (verificado en el catálogo: anon y
-- authenticated no pueden ejecutarlas). Pero el inventario de permisos (tests/permissions) exige la forma
-- literal `revoke execute on function ... from public, anon`. Se la agrega, idempotente y sin cambiar
-- ningún permiso real. Las llama solamente la Edge Function `admin-users` con la service_role, que conserva
-- su `execute`.

revoke execute on function public.admin_find_orphan_account(text) from public, anon, authenticated;
grant execute on function public.admin_find_orphan_account(text) to service_role;

revoke execute on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_user_records(uuid, uuid, text, text, public.app_role[], jsonb, text)
  to service_role;
