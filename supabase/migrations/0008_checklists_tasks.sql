-- DB-010 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Octavo bloque de 04_Modelo_de_Datos.md sección 11: tareas y checklists (sección 2.4).
-- Contenido, en orden:
--   1. `checklist_templates` (plantilla por cliente, con plantilla propia opcional por sede;
--      unicidad parcial: una por cliente y una por sede como máximo).
--   2. `checklist_template_items` (ítems ordenables; unicidad diferible de posición).
--   3. `shift_tasks` (copia del checklist en el turno, ADR-011: las tareas se copian, no se
--      referencian).
--   4. FK de `shifts.checklist_template_id` hacia `checklist_templates`, pendiente desde 0007
--      (DB-009) porque esta tabla no existía todavía.
--
-- RLS habilitada en las tres tablas nuevas desde este mismo archivo, sin políticas todavía
-- (llegan en 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. checklist_templates (04 sección 2.4, P-058, P-064)
-- ---------------------------------------------------------------------------------------------

-- `name not null`: el modelo no lo anota explícitamente ("id, client_id not null, site_id null
-- (FK compuesta), name, is_active bool default true, traza + deleted_at"), pero toda plantilla
-- necesita un nombre para distinguirse en la pantalla de administración -- decisión menor, mismo
-- criterio que otros campos "name" del modelo (clients.legal_name, sites.name).
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  site_id uuid,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  -- FK compuesta (04 sección 2.3/2.4, igual criterio que services/shifts en 0007): garantiza
  -- que site_id, cuando no es nulo, pertenece de verdad a client_id. Con MATCH SIMPLE (el
  -- default de Postgres) la restricción no se evalúa cuando site_id es null, así que una
  -- plantilla de cliente (sin sede) no se ve afectada.
  foreign key (site_id, client_id) references public.sites (id, client_id)
);

comment on table public.checklist_templates is
  'Plantilla de checklist por cliente, con plantilla propia opcional por sede (copia editable de la del cliente, no herencia dinámica, P-058, ADR-011). A lo sumo una por cliente y una por sede entre las vigentes (checklist_templates_client_site_key). clone_checklist_template (F12) crea la de sede a partir de la del cliente.';

alter table public.checklist_templates enable row level security;

create trigger trg_set_updated_at
before update on public.checklist_templates
for each row execute function app.set_updated_at();

-- Unicidad parcial (04 sección 2.4): una plantilla por cliente y una por sede como máximo, entre
-- las vigentes. `coalesce(site_id, '00000000-…')` colapsa todas las plantillas "de cliente"
-- (site_id null) de un mismo cliente a una sola clave, tal cual describe el modelo.
create unique index checklist_templates_client_site_key
  on public.checklist_templates (client_id, coalesce(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

create index checklist_templates_client_id_idx on public.checklist_templates (client_id);

-- ---------------------------------------------------------------------------------------------
-- 2. checklist_template_items (04 sección 2.4, P-059)
-- ---------------------------------------------------------------------------------------------

-- `position not null`: necesaria para ordenar y para la unicidad de abajo; el modelo la lista
-- sin "not null" explícito pero sin valor no tiene sentido (mismo criterio que `name`, arriba).
-- Unicidad `deferrable initially deferred` (04 sección 2.4: "Único (template_id, position)
-- diferible"): así "Reordenar: update de position en lote" (06_API.md sección 9) puede escribir
-- varias filas dentro de la misma transacción sin que una posición quede duplicada a mitad de
-- camino -- sin diferir, Postgres verifica la unicidad fila por fila a medida que se actualiza
-- cada una, y un intercambio de posiciones entre dos ítems chocaría contra sí mismo.
create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id),
  position smallint not null,
  title text not null,
  description text,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint checklist_template_items_template_id_position_key
    unique (template_id, position) deferrable initially deferred
);

comment on table public.checklist_template_items is
  'Ítems de una plantilla, ordenables (position). is_required por defecto true (P-059): en la Base solo cambia la presentación ("Opcional") y el resumen del turno, no bloquea el fin. Unicidad de position diferible para permitir reordenar en un solo lote.';

alter table public.checklist_template_items enable row level security;

create trigger trg_set_updated_at
before update on public.checklist_template_items
for each row execute function app.set_updated_at();

create index checklist_template_items_template_id_idx on public.checklist_template_items (template_id);

-- ---------------------------------------------------------------------------------------------
-- 3. shift_tasks (04 sección 2.4, P-060, P-061, P-063, ADR-011)
-- ---------------------------------------------------------------------------------------------

-- Copia de los ítems de la plantilla al crear el turno (ADR-011): sin FK hacia
-- checklist_template_items, a propósito -- son datos propios del turno, no una referencia (si
-- la plantilla cambia o se borra lógicamente después, el turno ya generado no se entera).
-- `position`/`title`/`is_required` "copiados": se anota `not null` en title (siempre viene de un
-- ítem con title not null) y en is_required (siempre viene de un valor concreto, sin default
-- propio: lo fija la copia, no esta tabla). `position` sin `not null` explícito en el modelo,
-- pero igual criterio que checklist_template_items.position.
create table public.shift_tasks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  position smallint not null,
  title text not null,
  description text,
  is_required boolean not null,
  status public.task_status not null default 'pending',
  not_done_reason text,
  status_changed_at timestamptz,
  status_changed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint shift_tasks_not_done_reason_check check (
    status <> 'not_done' or not_done_reason is not null
  )
);

comment on table public.shift_tasks is
  'Copia del checklist en el turno (ADR-011, P-061): compartida por todos los empleados asignados (un equipo, un checklist), no por asignación. Estados y transiciones en 04 sección 6.3. Sin deleted_at: el modelo la lista solo "Traza". Un turno creado antes de que exista plantilla queda con cero tareas hasta reload_shift_tasks (0013, F12).';

alter table public.shift_tasks enable row level security;

create trigger trg_set_updated_at
before update on public.shift_tasks
for each row execute function app.set_updated_at();

-- Índice de 04 sección 8: listado ordenado de las tareas de un turno.
create index shift_tasks_shift_id_position_idx on public.shift_tasks (shift_id, position);

-- ---------------------------------------------------------------------------------------------
-- 4. FK pendiente de 0007 (DB-009): shifts.checklist_template_id -> checklist_templates
-- ---------------------------------------------------------------------------------------------

-- Sin `on delete`: checklist_templates nunca se borra físicamente (baja lógica con deleted_at,
-- 04 sección 0), así que la referencia histórica del turno queda siempre resoluble.
alter table public.shifts
  add constraint shifts_checklist_template_id_fkey
  foreign key (checklist_template_id) references public.checklist_templates (id);
