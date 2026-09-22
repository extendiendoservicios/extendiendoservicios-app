-- supabase/seed-prod.sql — DB-020 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Seed mínimo de `App` (producción, ref `fysuppdadwvabrjpnnoh`): 04_Modelo_de_Datos.md sección
-- 10 -- "Solo owner (P-099), company_settings con nombre y teléfono de soporte, feriados del año.
-- Todo lo demás entra por la importación única de la fase 19 (P-097, P-098) y por pantalla."
--
-- ADVERTENCIA -- este archivo es SOLO PARA F20 (puesta en marcha), no se corre nunca desde este
-- encargo ni por ningún agente de este repositorio (regla común 8 y regla del encargo P04.6: nada
-- contra `App` sin encargo explícito de F20). Queda escrito y probado por su lógica -- misma
-- estructura que `supabase/seed.sql` (DB-019), revisada contra `App_dev` -- pero **nadie lo
-- ejecuta hasta F20**, y ese día lo hace Mike a mano, siguiendo `docs/deployment.md`.
--
-- Parametrizado (DB-020): las tres líneas marcadas "PARÁMETRO" más abajo son los únicos valores
-- que hay que revisar antes de correrlo -- nombre visible de la empresa, teléfono de soporte y
-- el texto de consentimiento de ubicación que ve el empleado. El resto (email del owner, P-099;
-- feriados nacionales) no se parametriza porque ya es un dato fijo y conocido.
--
-- Igual que `scripts/seed-dev.ts`, este archivo NUNCA inserta en `auth.users`: el usuario dueño
-- de producción lo crea Mike antes de correr este archivo, por el panel de Supabase
-- (Authentication → Add user, con el email de P-099 y una contraseña inicial entregada por canal
-- seguro, tal cual esa decisión lo pide) o con `scripts/seed-dev.ts` apuntado a `App` con la lista
-- de personas reducida a una sola fila -- cualquiera de las dos vías, este archivo después busca
-- ese perfil por email y corta con un mensaje claro si todavía no existe.

begin;

-- =================================================================================================
-- 1. Dueño: ya tiene que existir en Auth (ver advertencia de arriba). Se le asigna el rol owner
--    si todavía no lo tiene (no se pisa un rol ya asignado a mano).
-- =================================================================================================

do $$
declare
  v_owner_id uuid;
begin
  select id into v_owner_id from auth.users where lower(email) = lower('extserviciosapp@gmail.com');

  if v_owner_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No existe en Auth el usuario dueño (extserviciosapp@gmail.com, P-099). Creálo primero desde el panel de Supabase (Authentication → Add user) o con scripts/seed-dev.ts apuntado a App, y después volvé a correr este archivo.';
  end if;

  insert into public.user_roles (profile_id, role, granted_by)
  values (v_owner_id, 'owner', v_owner_id)
  on conflict (profile_id, role) do nothing;

  -- ---------------------------------------------------------------------------------------------
  -- 2. Empresa: company_settings (fila única). Nombre, teléfono y texto de consentimiento son los
  --    tres valores "PARÁMETRO" de este archivo (04 sección 10: "nombre y teléfono de soporte").
  -- ---------------------------------------------------------------------------------------------

  insert into public.company_settings (id, name, support_phone, location_consent_text, updated_by)
  values (
    1,
    'Extendiendo Servicios', -- PARÁMETRO: nombre visible de la empresa.
    '11 4000-0000', -- PARÁMETRO: teléfono de soporte real.
    'Para registrar el inicio y el fin de tu turno con tu ubicación, Extendiendo Servicios necesita tu permiso de geolocalización. Podés usar la app igual sin darlo: el registro de tu jornada funciona de todas formas, solo que sin la ubicación adjunta.', -- PARÁMETRO: texto de consentimiento (P-108).
    v_owner_id
  )
  on conflict (id) do update set
    name = excluded.name,
    support_phone = excluded.support_phone,
    location_consent_text = excluded.location_consent_text,
    updated_by = excluded.updated_by;

  -- ---------------------------------------------------------------------------------------------
  -- 3. Feriados nacionales de Argentina del año en curso, de fecha fija (04 sección 2.6, P-050).
  --    Misma lista y misma decisión menor que supabase/seed.sql (DB-019): se omiten los feriados
  --    móviles (Carnaval, Viernes Santo), que dependen del cálculo de la Pascua de cada año.
  -- ---------------------------------------------------------------------------------------------

  insert into public.holidays (holiday_date, name, created_by)
  select make_date(extract(year from app.today())::int, mes, dia), nombre, v_owner_id
  from (
    values
      (1, 1, 'Año Nuevo'),
      (3, 24, 'Día Nacional de la Memoria por la Verdad y la Justicia'),
      (4, 2, 'Día del Veterano y de los Caídos en la Guerra de Malvinas'),
      (5, 1, 'Día del Trabajador'),
      (5, 25, 'Día de la Revolución de Mayo'),
      (6, 20, 'Paso a la Inmortalidad del General Manuel Belgrano'),
      (7, 9, 'Día de la Independencia'),
      (8, 17, 'Paso a la Inmortalidad del General José de San Martín'),
      (10, 12, 'Día del Respeto a la Diversidad Cultural'),
      (11, 20, 'Día de la Soberanía Nacional'),
      (12, 8, 'Inmaculada Concepción de María'),
      (12, 25, 'Navidad')
  ) as f (mes, dia, nombre)
  on conflict (holiday_date) do nothing;
end $$;

commit;
