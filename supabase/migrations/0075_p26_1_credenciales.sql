-- P26.1 · Credenciales visibles (Docs/Plan_Maestro/modulos/P26_credenciales_y_personal_administrativo.md,
-- sección 3, «Migración 0075»; decisiones CR-01 a CR-15).
--
-- Contenido:
--   1. Enumeración `credential_source` (de dónde salió la contraseña guardada, CR-11).
--   2. Tabla `account_credentials`: copia CIFRADA de la contraseña de cada cuenta (CR-09).
--   3. Tipos de evento nuevos de `security_events`: `credentials_viewed` y `password_changed_by_user`.
--
-- Seguridad (CR-09): la base guarda solo texto cifrado. El cifrado y el descifrado (AES-256-GCM)
-- ocurren únicamente dentro de la Edge Function `admin-users`, con la clave `CREDENTIALS_KEY` que
-- vive como secreto de la función. La tabla no tiene políticas RLS ni permisos para `anon` ni
-- `authenticated`: solo la lee y escribe `service_role` (que ignora RLS) desde la función. Ninguna
-- vista ni RPC la expone.
--
-- Decisión menor: `ciphertext` e `iv` son `text` en base64 estándar (no `bytea`). PostgREST y
-- supabase-js mueven `bytea` como cadena hexadecimal escapada (`\x...`), lo que obliga a convertir
-- en cada lectura y escritura; el base64 viaja tal cual y se guarda sin conversiones.
--
-- `alter type ... add value` no se puede referenciar en la misma transacción en la que se agrega:
-- acá los valores nuevos no se usan en ningún objeto de esta migración (solo los inserta la función
-- desde afuera), por eso va todo en el mismo archivo.

-- ---------------------------------------------------------------------------------------------
-- 1. Enumeración
-- ---------------------------------------------------------------------------------------------

create type public.credential_source as enum (
  'created',
  'admin_reset',
  'self_change',
  'recovery',
  'initial_delivery'
);

comment on type public.credential_source is
  'Origen de la contraseña guardada en account_credentials (CR-11): created (alta), admin_reset (la puso la administración), self_change (la cambió la persona desde Mi perfil), recovery (la cambió con el enlace de recuperación del email) e initial_delivery (entrega inicial de credenciales por script).';

-- ---------------------------------------------------------------------------------------------
-- 2. account_credentials
-- ---------------------------------------------------------------------------------------------

-- Una fila por persona: cada cambio de contraseña la reemplaza. El historial queda en
-- `security_events`, nunca con la contraseña.
create table public.account_credentials (
  profile_id uuid primary key references public.profiles (id),
  ciphertext text not null,
  iv text not null,
  key_version smallint not null default 1,
  source public.credential_source not null,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles (id),
  constraint account_credentials_ciphertext_check check (length(ciphertext) > 0),
  constraint account_credentials_iv_check check (length(iv) > 0),
  constraint account_credentials_key_version_check check (key_version > 0)
);

comment on table public.account_credentials is
  'Copia CIFRADA (AES-256-GCM) de la contraseña de cada cuenta (P26.1, CR-09). Una fila por persona. Sin políticas RLS y sin permisos para anon ni authenticated: solo la usa la Edge Function admin-users con service_role. La base nunca ve la contraseña en claro.';
comment on column public.account_credentials.profile_id is 'Persona dueña de la cuenta (profiles.id).';
comment on column public.account_credentials.ciphertext is 'Contraseña cifrada con AES-256-GCM (incluye la etiqueta de autenticación), en base64.';
comment on column public.account_credentials.iv is 'Vector de inicialización de 12 bytes, aleatorio por cada cifrado, en base64.';
comment on column public.account_credentials.key_version is 'Versión de la clave CREDENTIALS_KEY con la que se cifró (permite rotarla). Hoy siempre 1.';
comment on column public.account_credentials.source is 'De dónde salió la contraseña (credential_source, CR-11).';
comment on column public.account_credentials.set_at is 'Cuándo se guardó esta contraseña.';
comment on column public.account_credentials.set_by is 'Quién la puso: la administración, o la propia persona en un cambio propio. Nulo si la puso un script.';

alter table public.account_credentials enable row level security;

-- Sin políticas a propósito (con RLS activada eso ya bloquea todo) y sin permisos: el "grant all"
-- por defecto de Supabase le daba a anon y authenticated todos los privilegios sobre las tablas
-- nuevas de public.
revoke all on table public.account_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Tipos de evento de seguridad
-- ---------------------------------------------------------------------------------------------

alter type public.security_event_type add value if not exists 'credentials_viewed';
alter type public.security_event_type add value if not exists 'password_changed_by_user';

comment on type public.security_event_type is
  'Tipo de evento de seguridad registrado en security_events (04 sección 2.6). Incluye admin_action_rejected (0030), name_changed (0032), los de B1 (0052), workday_corrected / workday_auto_closed (0062, P24.1), stock_movement_voided / supply_price_changed (0069, P25.1) y, desde 0075, credentials_viewed (la administración pidió ver una contraseña) y password_changed_by_user (la persona cambió la suya).';
