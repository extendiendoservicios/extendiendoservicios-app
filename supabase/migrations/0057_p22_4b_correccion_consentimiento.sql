-- 0057 · P22.4b · corrección de accept_location_consent y revoke_location_consent (módulo B1)
--
-- 0056 las creó fijando también `updated_by = auth.uid()`. El trigger
-- app.enforce_profile_self_update_columns (0017, 0033) no deja que una persona que no es dueño ni
-- administrador cambie su propio `updated_by`, así que para empleados y supervisores las dos RPC
-- fallaban con FORBIDDEN («Desde tu perfil solo podés editar…»). Lo detectó el pgTAP de 0056.
-- Se redefinen igual, sin tocar `updated_by` (el `update` directo que reemplazan tampoco lo hacía).
-- Firma, permisos y errores no cambian.

create or replace function public.accept_location_consent()
returns timestamptz
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
begin
  if v_uid is null then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  update public.profiles
  set location_consent_at = v_at
  where id = v_uid;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  return v_at;
end;
$$;

comment on function public.accept_location_consent() is
  'Registra el consentimiento de ubicación de quien llama (0056, P22.4b, B-22; corregida en 0057): profiles.location_consent_at = now() del servidor, solo para auth.uid(). Devuelve el instante guardado. FORBIDDEN sin sesión; PROFILE_NOT_FOUND si no hay perfil.';

create or replace function public.revoke_location_consent()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  update public.profiles
  set location_consent_at = null
  where id = v_uid;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

comment on function public.revoke_location_consent() is
  'Retira el consentimiento de ubicación de quien llama (0056, P22.4b; corregida en 0057): profiles.location_consent_at = null, solo para auth.uid(). FORBIDDEN sin sesión; PROFILE_NOT_FOUND si no hay perfil.';
