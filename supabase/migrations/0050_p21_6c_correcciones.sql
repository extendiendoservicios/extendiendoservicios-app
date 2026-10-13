-- 0050 · P21.6c · Correcciones de QA.
--
-- 1. service_role no podía leer `v_assignments_board.worked_minutes`: "permission denied for schema app".
--    Causa: la vista llama a `app.capped_worked_minutes` (0037), una función SIN security definer, que se
--    ejecuta con el rol de quien consulta. 0031 le dio a service_role `execute` sobre las funciones de app
--    que usan las vistas, pero nunca `usage` sobre el esquema `app` (0003 se lo dio solo a authenticated y
--    supabase_auth_admin), y sin `usage` el `execute` no alcanza. Se le da `usage` (a anon no se le da nada) y
--    `execute` sobre `app.announcement_targets_me`, la única otra función de app que usa una vista
--    (v_my_announcements) y que service_role todavía no podía ejecutar.
-- 2. DEF-P14: `set_my_high_contrast` (0043) no verificaba que el perfil siga activo: una persona desactivada
--    con el token vigente la pasaba. Ahora corta con FORBIDDEN, como las demás RPC (app.current_profile_active,
--    0020). Firma, grants y comportamiento para personas activas, sin cambios.

grant usage on schema app to service_role;
grant execute on function app.announcement_targets_me(uuid, public.announcement_audience) to service_role;

create or replace function public.set_my_high_contrast(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception using
      errcode = 'P0001',
      message = 'Tenés que iniciar sesión para cambiar esta preferencia.',
      hint = 'UNAUTHENTICATED';
  end if;

  if not app.current_profile_active() then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  if p_enabled is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si querés activar o desactivar el alto contraste.',
      hint = 'VALIDATION_ERROR';
  end if;

  update public.profiles
  set high_contrast = p_enabled
  where id = v_uid;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function public.set_my_high_contrast(boolean) from public, anon;
grant execute on function public.set_my_high_contrast(boolean) to authenticated;
