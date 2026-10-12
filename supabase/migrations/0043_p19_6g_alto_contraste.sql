-- 0043 P19.6 paquete G (AJ2-02): tema de alto contraste, preferencia por persona.
-- Cada persona elige el alto contraste en su perfil; se guarda en su cuenta y vale en
-- administración y celular. La lectura usa el select actual de profiles (grant de tabla +
-- política de fila propia); la escritura es solo por esta RPC.

alter table public.profiles
  add column high_contrast boolean not null default false;

comment on column public.profiles.high_contrast is
  'Preferencia personal: tema de alto contraste activado (AJ2-02). Se cambia solo con public.set_my_high_contrast.';

-- security definer porque el update directo del perfil propio está limitado por grants de columna
-- y por el trigger app.enforce_profile_self_update_columns. Se toca solo la fila de auth.uid().
create function public.set_my_high_contrast(p_enabled boolean)
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

comment on function public.set_my_high_contrast(boolean) is
  'Activa o desactiva el alto contraste de la persona autenticada (AJ2-02). Solo actualiza su propia fila de profiles.';

revoke execute on function public.set_my_high_contrast(boolean) from public, anon;
grant execute on function public.set_my_high_contrast(boolean) to authenticated;
