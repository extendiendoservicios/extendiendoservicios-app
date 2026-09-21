-- DB-006 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Cuarto bloque de 04_Modelo_de_Datos.md sección 11: configuración y seguridad (sección 2.6).
-- Contenido, en orden:
--   1. `company_settings` (singleton, fila única `id = 1`).
--   2. `holidays`.
--   3. `security_events`.
--   4. `app.log_security_event(...)` (sección 5), que inserta en `security_events`.
--
-- RLS habilitada en las tres tablas desde este mismo archivo, sin políticas todavía: llegan en
-- `0012_rls_policies.sql` (DB-014). Ver la nota de seguridad completa en
-- `0003_profiles_roles_capabilities.sql` (repetida en `docs/database.md`): el ACL por defecto del
-- esquema `public` ya concede acceso a `anon`/`authenticated` en cuanto se crea una tabla, así que
-- toda tabla nueva la habilita de inmediato.

-- ---------------------------------------------------------------------------------------------
-- 1. company_settings (04 sección 2.6: singleton `id smallint check id = 1`)
-- ---------------------------------------------------------------------------------------------

-- Sin `created_at`/`created_by`: el modelo no los lista para esta tabla (a diferencia de los
-- maestros con "traza + deleted_at"), mismo criterio que `admin_capabilities` en 0003 -- una fila
-- que siempre existió desde el seed, sin necesidad de saber cuándo se "creó". `updated_at` nace
-- con `not null default now()` (no en null como `profiles.updated_at`) porque acá es el único
-- rastro temporal de la fila; el trigger `app.set_updated_at` lo mantiene al día en cada `update`.
create table public.company_settings (
  id smallint primary key check (id = 1),
  name text,
  logo_path text,
  support_phone text,
  location_consent_text text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

comment on table public.company_settings is
  'Configuración de la empresa: fila única (id = 1). Nombre, logo (bucket branding), teléfono de soporte y texto de consentimiento de ubicación (04 sección 2.6, P-108, P-117, IF-13). La fila la crea el seed (DB-019/DB-020), no esta migración.';

alter table public.company_settings enable row level security;

create trigger trg_set_updated_at
before update on public.company_settings
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. holidays (04 sección 2.6, P-050)
-- ---------------------------------------------------------------------------------------------

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date unique,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz
);

comment on table public.holidays is
  'Calendario de feriados, editable por el dueño (04 sección 2.6, P-050). generate_shifts (0013) lo usa para no crear turnos de servicios con works_on_holidays = false.';

alter table public.holidays enable row level security;

create trigger trg_set_updated_at
before update on public.holidays
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 3. security_events (04 sección 2.6, P-104)
-- ---------------------------------------------------------------------------------------------

-- Tabla de solo inserción (append-only): sin updated_at/updated_by/deleted_at -- nadie corrige ni
-- borra un evento de seguridad ya registrado, ni siquiera el owner (04 sección 7.2: "O: [select].
-- [Insert/Update/Delete]: Solo funciones."). `event_type not null`: es el discriminador de la
-- fila, sin el cual el registro no tiene sentido (igual criterio que `admin_capabilities.capability`
-- en 0003, que tampoco lo anota "not null" en el modelo y aun así se declaró así). `actor_id` y
-- `target_id` sí quedan nullable: un `sign_in_failed` puede no resolver a ningún actor conocido, y
-- no todo evento tiene un destinatario distinto del actor. Ambos referencian `profiles.id` sin que
-- el modelo lo escriba con la palabra "FK" -- mismo criterio que `user_roles.granted_by` en 0003:
-- el nombre de la columna ya dice que apunta a una persona (sección 0, "created_by/updated_by
-- referencian profiles.id").
create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  event_type public.security_event_type not null,
  actor_id uuid references public.profiles (id),
  target_id uuid references public.profiles (id),
  details jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

comment on table public.security_events is
  'Log de seguridad: inicios de sesión, altas y bajas de usuario, cambios de rol/capacidad, reseteos, revocaciones (04 sección 2.6, P-104). Solo inserta el sistema, vía app.log_security_event(...) desde funciones security definer o la Edge Function admin-users (conexión service_role, bypassrls); lee el owner (0012, DB-014).';

alter table public.security_events enable row level security;

-- Índices de 04 sección 8: listado cronológico (pantalla ADM-31 del dueño) y por actor.
create index security_events_created_at_idx on public.security_events (created_at desc);
create index security_events_actor_id_idx on public.security_events (actor_id);

-- ---------------------------------------------------------------------------------------------
-- 4. app.log_security_event(...) (04 sección 5)
-- ---------------------------------------------------------------------------------------------

-- `security definer` porque `security_events` ya tiene RLS habilitada y ningún rol de sesión
-- (`authenticated`, ni siquiera `owner`) va a tener una política de insert en 0012 (04 sección 7.2:
-- "Solo funciones"): sin `security definer`, ninguna RPC futura (set_user_roles, notify_absence,
-- el trigger de sign_in de AUTH-009, etc.) podría dejar rastro acá. Devuelve la fila insertada,
-- como el resto de las funciones que escriben (sección 9), para que quien la llama pueda usarla
-- sin un segundo `select`. No verifica rol ni capacidad: no es una RPC de la sección 9 invocable
-- por el cliente (06_API.md no la lista), sino un auxiliar de uso interno -- por eso el `revoke`
-- de abajo le saca el `execute` que Postgres concede a PUBLIC por defecto, dejándolo disponible
-- únicamente para quien sea dueño de la función (`postgres`, quien aplica las migraciones) y para
-- cualquier otra función `security definer` de este mismo dueño que la llame desde adentro (el
-- `current_user` efectivo durante una función `security definer` es su dueño, así que la llamada
-- interna no pasa por este `revoke`; mismo razonamiento que el hook de 0003 con
-- `supabase_auth_admin`, aplicado acá al dueño de las funciones en lugar de a un rol de Auth).
create function app.log_security_event(
  p_event_type public.security_event_type,
  p_actor_id uuid,
  p_target_id uuid default null,
  p_details jsonb default null,
  p_ip inet default null
)
returns public.security_events
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_event public.security_events;
begin
  insert into public.security_events (event_type, actor_id, target_id, details, ip)
  values (p_event_type, p_actor_id, p_target_id, p_details, p_ip)
  returning * into v_event;

  return v_event;
end;
$$;

comment on function app.log_security_event(public.security_event_type, uuid, uuid, jsonb, inet) is
  'Inserta una fila en security_events y la devuelve (04 sección 2.6, sección 5). Uso interno: solo la llaman funciones security definer del sistema (no es una RPC de la sección 9, no se expone a authenticated ni anon).';

revoke execute on function app.log_security_event(public.security_event_type, uuid, uuid, jsonb, inet)
  from public, anon, authenticated;
