-- DB-008 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Sexto bloque de 04_Modelo_de_Datos.md sección 11: datos laborales de quien tiene rol empleado o
-- supervisor (sección 2.1). Contenido, en orden:
--   1. Secuencia `employee_number_seq` y tabla `employees`.
--   2. `employee_client_permissions`.
--   3. `employee_availability` (check `end_time > start_time`).
--   4. `employee_leaves` (check `ends_on >= starts_on` y restricción de exclusión sobre el rango
--      de fechas, con `btree_gist` -- instalada por 0001_extensions_and_schema_app.sql).
--
-- RLS habilitada en las cuatro tablas desde este mismo archivo, sin políticas todavía (llegan en
-- 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. employee_number_seq + employees (04 sección 2.1, P-032, P-033, P-036, P-038)
-- ---------------------------------------------------------------------------------------------

-- Secuencia de Postgres para el legajo (P-036: "lo genera el sistema, pero podría editarse").
-- `owned by` la ata al ciclo de vida de la columna (se borra si algún día se borra la columna),
-- sin que eso cambie que el valor por defecto sea editable en cada insert.
create sequence public.employee_number_seq;

-- `status not null default 'active'`: el modelo no anota un valor por defecto explícito, pero
-- todo empleado nace activo (decisión menor, documentada en el reporte de la tarea). "De licencia"
-- no es un valor de esta columna: se deriva de employee_leaves en la vista v_employees (0011).
create table public.employees (
  profile_id uuid primary key references public.profiles (id),
  employee_number integer not null unique default nextval('public.employee_number_seq'),
  dni text not null unique,
  cuil text,
  address text,
  birth_date date,
  hire_date date,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  status public.employee_status not null default 'active',
  terminated_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz
);

alter sequence public.employee_number_seq owned by public.employees.employee_number;

comment on table public.employees is
  'Datos laborales de quien tiene rol employee o supervisor (04 sección 2.1). profile_id = profiles.id: una persona tiene a lo sumo una fila acá, sin importar cuántos de esos dos roles tenga. "De licencia" se deriva de employee_leaves (vista v_employees, 0011), no es un valor de status.';

alter table public.employees enable row level security;

create trigger trg_set_updated_at
before update on public.employees
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 2. employee_client_permissions (04 sección 2.1, P-034)
-- ---------------------------------------------------------------------------------------------

create table public.employee_client_permissions (
  employee_id uuid not null references public.employees (profile_id),
  client_id uuid not null references public.clients (id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (employee_id, client_id)
);

comment on table public.employee_client_permissions is
  'Clientes habilitados por empleado (04 sección 2.1, P-034). Lista vacía para un empleado = habilitado para todos. Asignar a un turno de un cliente no habilitado advierte, no bloquea (POR CONFIRMAR fase 11).';

alter table public.employee_client_permissions enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. employee_availability (04 sección 2.1, P-035)
-- ---------------------------------------------------------------------------------------------

create table public.employee_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (profile_id),
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.employee_availability is
  'Disponibilidad declarada por el empleado, varias filas por día (04 sección 2.1, P-035). weekday: 0 = domingo .. 6 = sábado. Sin deleted_at: el modelo la trata como "traza" simple, no como maestro (a diferencia de employee_leaves).';

alter table public.employee_availability enable row level security;

create trigger trg_set_updated_at
before update on public.employee_availability
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 4. employee_leaves (04 sección 2.1, P-033)
-- ---------------------------------------------------------------------------------------------

create table public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (profile_id),
  starts_on date not null,
  ends_on date,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint employee_leaves_ends_on_check check (ends_on is null or ends_on >= starts_on)
);

comment on table public.employee_leaves is
  'Licencias de un empleado; ends_on nulo = licencia abierta (04 sección 2.1, P-033). El estado "de licencia" de v_employees se deriva de que exista una fila vigente (deleted_at is null) con starts_on <= hoy <= coalesce(ends_on, hoy).';

alter table public.employee_leaves enable row level security;

create trigger trg_set_updated_at
before update on public.employee_leaves
for each row execute function app.set_updated_at();

-- Restricción de exclusión (04 sección 2.1): dos licencias vigentes del mismo empleado no pueden
-- superponerse. `where (deleted_at is null)`: una licencia dada de baja lógica (corregida) no debe
-- seguir bloqueando el rango de fechas que ocupaba -- mismo criterio que usará la exclusión de
-- `assignments` en 0007 con `removed_at is null`. Requiere `btree_gist` (instalada por
-- 0001_extensions_and_schema_app.sql) para el operador de igualdad `=` sobre `uuid` dentro de un
-- índice GiST.
alter table public.employee_leaves
  add constraint employee_leaves_no_overlap
  exclude using gist (
    employee_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  )
  where (deleted_at is null);
