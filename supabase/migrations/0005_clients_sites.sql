-- DB-007 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Quinto bloque de 04_Modelo_de_Datos.md sección 11: clientes y sedes (sección 2.2). Contenido,
-- en orden:
--   1. `clients`.
--   2. `client_contacts` (índice único parcial: un solo contacto principal por cliente).
--   3. `sites` (nombre único por cliente; `unique (id, client_id)` para las FK compuestas que
--      agregan `services` y `shifts` en 0007, DB-009, y así garantizar que la sede referenciada
--      pertenece de verdad al cliente referenciado).
--
-- RLS habilitada en las tres tablas desde este mismo archivo, sin políticas todavía (llegan en
-- 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. clients (04 sección 2.2, P-023, P-024, P-025)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'active'`: el modelo no anota un valor por defecto explícito, pero
-- todo cliente nace operable y las altas de pantalla no deberían tener que elegir un estado
-- (decisión menor, documentada en el reporte de la tarea).
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  cuit text unique,
  admin_address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  status public.client_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz
);

comment on table public.clients is
  'Clientes de la empresa (04 sección 2.2). Suspendido y baja conservan historial; generate_shifts y create_shift rechazan clientes no activos (CLIENT_NOT_ACTIVE, 06_API.md sección 15).';

alter table public.clients enable row level security;

create trigger trg_set_updated_at
before update on public.clients
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. client_contacts (04 sección 2.2, P-025)
-- ---------------------------------------------------------------------------------------------

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null,
  role_title text,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz
);

comment on table public.client_contacts is
  'Contactos de un cliente, varios por cliente (04 sección 2.2, P-025). A lo sumo uno con is_primary = true por cliente entre los vigentes (índice client_contacts_one_primary_per_client_idx).';

alter table public.client_contacts enable row level security;

create trigger trg_set_updated_at
before update on public.client_contacts
for each row execute function app.set_updated_at();

-- Único contacto principal por cliente, entre las filas vigentes (no dadas de baja). Parcial en
-- vez de una restricción de tabla porque la regla solo aplica cuando is_primary es verdadero: la
-- mayoría de los contactos (is_primary = false) puede repetirse sin límite.
create unique index client_contacts_one_primary_per_client_idx
  on public.client_contacts (client_id)
  where is_primary and deleted_at is null;

-- ---------------------------------------------------------------------------------------------
-- 3. sites (04 sección 2.2, P-028, P-029, P-030, P-031)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'active'`: mismo criterio que clients.status arriba.
create table public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  name text not null,
  address text not null,
  city text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  contact_name text,
  contact_phone text,
  access_instructions text,
  building_hours text,
  phone_restricted boolean not null default false,
  photos_not_allowed boolean not null default false,
  restrictions_notes text,
  status public.site_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  -- Permite las FK compuestas (site_id, client_id) -> sites(id, client_id) que agregan
  -- `services` y `shifts` (0007, DB-009): así la base garantiza que la sede referenciada
  -- pertenece de verdad al cliente referenciado, sin depender de un trigger ni de la RPC.
  unique (id, client_id)
);

comment on table public.sites is
  'Sedes de un cliente (04 sección 2.2). Nombre único por cliente entre las vigentes; unique (id, client_id) habilita las FK compuestas de services/shifts. Inactiva no admite turnos nuevos (SITE_NOT_ACTIVE, 06_API.md sección 15).';

alter table public.sites enable row level security;

create trigger trg_set_updated_at
before update on public.sites
for each row execute function app.set_updated_at();

-- Nombre único por cliente, entre las sedes vigentes (SITE_NAME_IN_USE, 06_API.md sección 15).
create unique index sites_client_id_name_key
  on public.sites (client_id, name)
  where deleted_at is null;

-- Índice de 04 sección 8: listado y mapa de sedes por cliente.
create index sites_client_id_idx on public.sites (client_id);
