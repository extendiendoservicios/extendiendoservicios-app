-- DB-011 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Noveno bloque de 04_Modelo_de_Datos.md sección 11: asistencia (sección 2.3, tablas
-- `attendance_records` y `attendance_notices`; ADR-009). Contenido, en orden:
--   1. `attendance_records` (inicio y fin por asignación; un inicio y un fin por asignación).
--   2. `attendance_notices` (avisos de demora y ausencia; varios por asignación).
--
-- Solo estructura: las reglas de negocio (ventana de inicio, "antes de la hora de inicio",
-- transición de la asignación) las verifican las RPC de asistencia (0014, fase 13/14), no esta
-- migración.
--
-- RLS habilitada en las dos tablas desde este mismo archivo, sin políticas todavía (llegan en
-- 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. attendance_records (04 sección 2.3, P-065, P-066, P-067, P-069, P-075, P-076, ADR-009)
-- ---------------------------------------------------------------------------------------------

-- `recorded_at not null`: la pone `now()` dentro de la RPC (record_check_in/record_check_out,
-- admin_record_attendance, close_assignment), nunca el reloj del cliente (P-066). Coordenadas
-- nulas por defecto (ADR-009: se guardan solo si el empleado concede el permiso; ninguna
-- pantalla de la Base las muestra).
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id),
  kind public.attendance_kind not null,
  recorded_at timestamptz not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  accuracy_m numeric(7, 1),
  source public.attendance_source not null,
  recorded_by uuid references public.profiles (id),
  reason text,
  created_at timestamptz not null default now(),
  constraint attendance_records_reason_check check (source <> 'admin' or reason is not null),
  unique (assignment_id, kind)
);

comment on table public.attendance_records is
  'Inicio y fin por asignación (04 sección 2.3, P-065). unique (assignment_id, kind): un check_in y un check_out por asignación -- las correcciones son módulo B. reason obligatorio cuando source = admin (P-075). Coordenadas nulas si el empleado no concedió el permiso; ninguna pantalla de la Base las muestra (ADR-009).';

alter table public.attendance_records enable row level security;

-- Índice de 04 sección 8: registros de una asignación.
create index attendance_records_assignment_id_idx on public.attendance_records (assignment_id);

-- ---------------------------------------------------------------------------------------------
-- 2. attendance_notices (04 sección 2.3, P-072, P-073, P-074)
-- ---------------------------------------------------------------------------------------------

create table public.attendance_notices (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id),
  kind public.notice_kind not null,
  minutes_late smallint,
  reason_code public.absence_reason,
  reason_text text,
  reported_by uuid references public.profiles (id),
  source public.attendance_source not null,
  created_at timestamptz not null default now(),
  constraint attendance_notices_minutes_late_check check (
    kind <> 'delay' or (minutes_late is not null and minutes_late between 1 and 600)
  ),
  constraint attendance_notices_reason_code_check check (
    kind <> 'absence' or reason_code is not null
  ),
  constraint attendance_notices_reason_text_check check (
    reason_code is distinct from 'other' or reason_text is not null
  )
);

comment on table public.attendance_notices is
  'Avisos de demora y ausencia (04 sección 2.3, P-072, P-073). Varios por asignación (primero demora, después ausencia); el estado de la asignación refleja el último. minutes_late obligatorio (1..600) si kind = delay; reason_code obligatorio si kind = absence; reason_text obligatorio si reason_code = other. Una ausencia avisada no libera el cupo (P-073): lo decide el administrador.';

alter table public.attendance_notices enable row level security;

-- Índice de 04 sección 8: último aviso de una asignación.
create index attendance_notices_assignment_id_created_at_idx
  on public.attendance_notices (assignment_id, created_at desc);
