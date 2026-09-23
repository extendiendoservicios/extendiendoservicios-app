-- DB-012 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Décimo bloque de 04_Modelo_de_Datos.md sección 11: supervisiones (sección 2.5). Contenido, en
-- orden:
--   1. `supervisions` (una por turno y supervisor entre las no canceladas).
--   2. `supervision_attendance` (inicio y fin de la supervisión, por sede).
--   3. `ratings` (calificación 1 a 5 por asignación, una por supervisión × asignación).
--   4. `rating_criteria` (guía de texto con vigencia, sin puntaje por criterio).
--   5. `app.supervises_shift(shift_id)` (04 sección 5): pendiente desde 0007 (DB-009) porque
--      dependía de esta tabla.
--
-- Solo estructura: las transiciones de 04 sección 6.4 (assign_supervision, supervision_check_in,
-- complete_supervision, etc.) y el upsert de rate_employee llegan con las RPC de supervisión
-- (0015, fase 15).
--
-- RLS habilitada en las cuatro tablas desde este mismo archivo, sin políticas todavía (llegan en
-- 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. supervisions (04 sección 2.5, P-041, P-078, P-079, P-082, P-085, P-086, P-087)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'assigned'`: transición inicial de 04 sección 6.4 ("— -> assigned").
-- `assigned_at not null default now()`: el modelo no fija un default explícito, pero
-- assign_supervision (0015) siempre la asigna en el momento -- mismo criterio que
-- `client_contacts`/`employee_client_permissions.created_at` con default now() en migraciones
-- previas.
create table public.supervisions (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  supervisor_id uuid not null references public.employees (profile_id),
  status public.supervision_status not null default 'assigned',
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  not_done_reason text,
  cancel_reason text,
  general_notes text,
  criteria_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint supervisions_not_done_reason_check check (
    status <> 'not_done' or not_done_reason is not null
  ),
  constraint supervisions_cancel_reason_check check (
    status <> 'cancelled' or cancel_reason is not null
  )
);

comment on table public.supervisions is
  'Una supervisión por turno y supervisor, entre las no canceladas (04 sección 2.5, P-078). Produce una calificación por cada asignación del turno (ratings). criteria_snapshot guarda los criterios vigentes al iniciar (P-087, la escribe supervision_check_in, 0015). Sin deleted_at: el modelo la lista solo "Traza".';

alter table public.supervisions enable row level security;

create trigger trg_set_updated_at
before update on public.supervisions
for each row execute function app.set_updated_at();

-- Unicidad parcial (04 sección 2.5, P-086: sin supervisión espontánea): un supervisor no puede
-- tener dos supervisiones no canceladas del mismo turno.
create unique index supervisions_shift_id_supervisor_id_key
  on public.supervisions (shift_id, supervisor_id)
  where status <> 'cancelled';

-- Índices de 04 sección 8: pantallas del supervisor (Hoy, historial) y del turno.
create index supervisions_supervisor_id_status_idx on public.supervisions (supervisor_id, status);
create index supervisions_shift_id_idx on public.supervisions (shift_id);

-- ---------------------------------------------------------------------------------------------
-- 2. supervision_attendance (04 sección 2.5, P-041, P-085, ADR-009)
-- ---------------------------------------------------------------------------------------------

create table public.supervision_attendance (
  id uuid primary key default gen_random_uuid(),
  supervision_id uuid not null references public.supervisions (id),
  kind public.attendance_kind not null,
  recorded_at timestamptz not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  accuracy_m numeric(7, 1),
  created_at timestamptz not null default now(),
  unique (supervision_id, kind)
);

comment on table public.supervision_attendance is
  'Inicio y fin de cada supervisión, por sede (04 sección 2.5, P-041, P-085). Mismo criterio que attendance_records: hora del servidor, coordenadas opcionales y sin validar (ADR-009). unique (supervision_id, kind): un check_in y un check_out por supervisión.';

alter table public.supervision_attendance enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 3. ratings (04 sección 2.5, P-080, P-081, P-083, P-084)
-- ---------------------------------------------------------------------------------------------

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  supervision_id uuid not null references public.supervisions (id),
  assignment_id uuid not null references public.assignments (id),
  score smallint not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint ratings_score_check check (score between 1 and 5),
  unique (supervision_id, assignment_id)
);

comment on table public.ratings is
  'Calificación de 1 a 5 por asignación, una por supervisión × asignación (04 sección 2.5, P-080, P-081). updated_by distingue ediciones administrativas (P-083). El empleado no lee esta tabla por ninguna vía (P-084, RLS en 0012). rate_employee (0015) hace upsert; la RPC verifica que assignment_id pertenezca al turno de la supervisión (04 sección 2.5, "verificado en RPC y trigger" -- el trigger llega si hace falta en 0015, junto con la RPC).';

alter table public.ratings enable row level security;

create trigger trg_set_updated_at
before update on public.ratings
for each row execute function app.set_updated_at();

-- Índice de 04 sección 8: calificaciones de un empleado (vía su asignación).
create index ratings_assignment_id_idx on public.ratings (assignment_id);

-- ---------------------------------------------------------------------------------------------
-- 4. rating_criteria (04 sección 2.5, P-080, P-087, P-101)
-- ---------------------------------------------------------------------------------------------

-- `position not null`: mismo criterio que checklist_template_items.position (0008) -- necesaria
-- para ordenar la guía en pantalla; el modelo no la anota "not null" explícitamente.
create table public.rating_criteria (
  id uuid primary key default gen_random_uuid(),
  position smallint not null,
  title text not null,
  description text,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.rating_criteria is
  'Guía de texto para calificar (no se puntúa por criterio, P-080, P-087). Vigente = valid_from <= hoy and (valid_to is null or valid_to >= hoy). Cerrar un criterio es poner valid_to; no se borra (P-087). Sin deleted_at: el modelo la lista solo "Traza".';

alter table public.rating_criteria enable row level security;

create trigger trg_set_updated_at
before update on public.rating_criteria
for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- 5. app.supervises_shift(shift_id) (04 sección 5) -- pendiente desde 0007 (DB-009)
-- ---------------------------------------------------------------------------------------------

-- `security definer`: mismo motivo que app.current_employee_id/app.shares_shift en 0007 --
-- supervisions ya tiene RLS habilitada y esta función se va a evaluar dentro de políticas de
-- otras tablas (shifts, clients, sites, etc.) desde 0012.
create function app.supervises_shift(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.supervisions s
    where s.shift_id = p_shift_id
      and s.supervisor_id = auth.uid()
      and s.status <> 'cancelled'
  );
$$;

comment on function app.supervises_shift(uuid) is
  'True si la sesión actual tiene una supervisión no cancelada sobre ese turno (04 sección 5).';
