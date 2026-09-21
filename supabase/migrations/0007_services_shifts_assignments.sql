-- DB-009 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Séptimo bloque de 04_Modelo_de_Datos.md sección 11: servicios, turnos y asignaciones
-- (sección 2.3), el corazón de la operación. Contenido, en orden:
--   1. `services` (acuerdo recurrente; check de días de semana con `app.valid_weekdays`,
--      04 sección 0001).
--   2. `shifts` (ocurrencia fechada; columnas generadas `starts_at`/`ends_at` con
--      `app.local_ts`, ADR-019; unicidad parcial de un turno por servicio y día, ADR-010).
--   3. `assignments` (empleado × turno; franja propia opcional; columnas denormalizadas
--      `shift_date`/`window` mantenidas por el trigger `app.sync_assignment_window`;
--      restricción de exclusión gist que bloquea la superposición del mismo empleado,
--      P-053; unicidad parcial de empleado por turno).
--   4. `app.current_employee_id()` y `app.shares_shift(shift_id)` (04 sección 5): ya pueden
--      escribirse porque de acá en más existen `employees` (0006), `shifts` y `assignments`.
--      `app.supervises_shift(shift_id)` queda para 0010 (DB-012), que es donde nace
--      `supervisions` -- la tabla de la que depende.
--
-- Las FK compuestas `(site_id, client_id) → sites (id, client_id)` de `services` y `shifts`
-- usan el `unique (id, client_id)` que dejó preparado `sites` en 0005 (DB-007): así la base
-- garantiza que la sede referenciada pertenece de verdad al cliente referenciado, sin
-- depender de un trigger ni de la RPC.
--
-- `shifts.checklist_template_id` nace como columna simple, sin FK todavía: `checklist_templates`
-- se crea recién en 0008 (DB-010), después de este archivo en el orden de la sección 11.
-- 0008 agrega la restricción de clave foránea con `alter table` una vez que la tabla referenciada
-- exista (decisión menor: el modelo no dice cómo resolver esta referencia hacia adelante; se
-- eligió no reordenar 0007/0008 -- el orden de la sección 11 es explícito -- y separar la FK en
-- dos pasos, en vez de, por ejemplo, omitirla).
--
-- RLS habilitada en las tres tablas desde este mismo archivo, sin políticas todavía (llegan en
-- 0012, DB-014): ver la nota de seguridad de 0003_profiles_roles_capabilities.sql.

-- ---------------------------------------------------------------------------------------------
-- 1. services (04 sección 2.3, P-043, P-044, P-046, P-047, P-050, P-057, ADR-010)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'active'`: mismo criterio que `clients.status`/`sites.status`/
-- `employees.status` en 0005/0006 -- el modelo no anota un valor por defecto explícito, pero
-- toda alta de pantalla nace operable. `works_on_holidays not null default true` (P-050, POR
-- CONFIRMAR el valor inicial en fase 10): se elige `true` como el valor menos sorprendente --
-- "el servicio se presta también en feriados salvo que se indique lo contrario" -- documentado
-- acá como decisión menor a ratificar en F10.
create table public.services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  site_id uuid not null,
  name text not null,
  weekdays smallint[] not null,
  start_time time not null,
  end_time time not null,
  required_staff smallint not null default 1,
  valid_from date not null,
  valid_to date,
  works_on_holidays boolean not null default true,
  min_hours_month numeric(6, 2),
  max_hours_month numeric(6, 2),
  status public.service_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint services_weekdays_check check (app.valid_weekdays(weekdays)),
  constraint services_time_range_check check (end_time > start_time),
  constraint services_required_staff_check check (required_staff between 1 and 10),
  -- FK compuesta (04 sección 2.3): garantiza que site_id pertenece de verdad a client_id.
  foreign key (site_id, client_id) references public.sites (id, client_id)
);

comment on table public.services is
  'Acuerdo recurrente entre cliente, sede, franja, días de la semana y dotación (04 sección 2.3, P-043, ADR-010). generate_shifts (0013) crea los turnos faltantes de cada servicio active y vigente; editar un servicio no modifica turnos ya generados.';

alter table public.services enable row level security;

create trigger trg_set_updated_at
before update on public.services
for each row execute function app.set_updated_at();

-- Índice de 04 sección 8 (implícito en la relación con sites, agregado por consistencia con
-- sites_client_id_idx de 0005): listado y filtro de servicios por sede.
create index services_site_id_idx on public.services (site_id);
create index services_client_id_idx on public.services (client_id);

-- ---------------------------------------------------------------------------------------------
-- 2. shifts (04 sección 2.3, P-043, P-045, P-048, P-049, P-051, P-054, P-061, ADR-019)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'scheduled'`: transición inicial de 04 sección 6.1 ("— -> scheduled").
-- `generated not null default false`: mismo criterio de booleanos con default explícito que
-- `phone_restricted`/`photos_not_allowed` en 0005.
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services (id),
  client_id uuid not null references public.clients (id),
  site_id uuid not null,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  required_staff smallint not null,
  status public.shift_status not null default 'scheduled',
  generated boolean not null default false,
  -- Sin FK todavía: checklist_templates nace en 0008 (ver nota al principio del archivo).
  checklist_template_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  deleted_at timestamptz,
  constraint shifts_time_range_check check (end_time > start_time),
  constraint shifts_required_staff_check check (required_staff between 1 and 10),
  constraint shifts_cancel_fields_check check (
    status <> 'cancelled'
    or (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)
  ),
  -- FK compuesta (04 sección 2.3): garantiza que site_id pertenece de verdad a client_id.
  foreign key (site_id, client_id) references public.sites (id, client_id)
);

comment on table public.shifts is
  'Ocurrencia fechada de un servicio, o turno puntual sin servicio (service_id null, P-045). Estados y transiciones en 04 sección 6.1; los derivados "sin cubrir" y "próximo" se calculan en v_shifts_board (0011), no se persisten (04 sección 6.1, 0.Estados).';

alter table public.shifts enable row level security;

create trigger trg_set_updated_at
before update on public.shifts
for each row execute function app.set_updated_at();

-- Columnas generadas para consultas (04 sección 2.3): instante UTC de inicio y fin del turno,
-- a partir de la fecha y la franja locales de Argentina. `app.local_ts` es immutable (ADR-019:
-- Argentina no tiene horario de verano desde 2009), condición que Postgres exige para usar una
-- función dentro de una columna `generated always as (...) stored`.
alter table public.shifts
  add column starts_at timestamptz generated always as (app.local_ts(shift_date, start_time)) stored,
  add column ends_at timestamptz generated always as (app.local_ts(shift_date, end_time)) stored;

comment on column public.shifts.starts_at is
  'Instante UTC de inicio del turno (app.local_ts(shift_date, start_time), ADR-019). Columna generada, no se escribe directamente.';
comment on column public.shifts.ends_at is
  'Instante UTC de fin del turno (app.local_ts(shift_date, end_time), ADR-019). Columna generada, no se escribe directamente.';

-- Unicidad parcial (04 sección 2.3, ADR-010): un servicio genera a lo sumo un turno por día,
-- entre los turnos vigentes (un turno dado de baja lógica no bloquea la fecha; ver el mismo
-- criterio en employee_leaves_no_overlap, 0006). No aplica a turnos puntuales (service_id null).
create unique index shifts_service_id_shift_date_key
  on public.shifts (service_id, shift_date)
  where service_id is not null and deleted_at is null;

-- Índices de 04 sección 8. shifts_service_id_shift_date_key (arriba) ya cubre el par
-- (service_id, shift_date) que pide la sección 8 para la generación; no se duplica.
create index shifts_shift_date_idx on public.shifts (shift_date);
create index shifts_site_id_shift_date_idx on public.shifts (site_id, shift_date);
create index shifts_status_idx
  on public.shifts (status)
  where status in ('scheduled', 'assigned', 'in_progress');

-- ---------------------------------------------------------------------------------------------
-- 3. assignments (04 sección 2.3, P-046, P-052, P-053, P-062, P-065, P-070)
-- ---------------------------------------------------------------------------------------------

-- `status not null default 'expected'`: transición inicial de 04 sección 6.2 ("— -> expected").
-- `shift_date`/`window` nacen `not null`: las mantiene siempre el trigger
-- `app.sync_assignment_window` (más abajo), que corre BEFORE INSERT y las fija antes de que
-- Postgres verifique la restricción NOT NULL sobre la fila nueva.
-- `assignments_time_range_check`: el modelo no anota un check explícito para la franja propia
-- (a diferencia de `shifts.end_time`/`services.end_time`), pero se agrega por consistencia de
-- datos -- decisión menor documentada en el reporte de la tarea -- para no aceptar una franja
-- propia invertida cuando ambos extremos vienen indicados; una sola punta (solo start_time o
-- solo end_time) sigue permitida, igual que el modelo describe la franja propia como opcional.
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  employee_id uuid not null references public.employees (profile_id),
  start_time time,
  end_time time,
  status public.assignment_status not null default 'expected',
  notes text,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  shift_date date not null,
  -- Entre comillas dobles porque `window` es palabra reservada de SQL (se usa en
  -- `SELECT ... WINDOW w AS (...)`) y no se puede escribir sin comillas como nombre de columna
  -- (Postgres lo rechaza con "syntax error at or near window", verificado al aplicar esta
  -- migración). El modelo (04 sección 2.3) nombra la columna así; se mantiene el nombre y se cita
  -- entre comillas en cada uso (acá, en el trigger y en la restricción de exclusión).
  "window" tstzrange not null,
  constraint assignments_time_range_check check (
    start_time is null or end_time is null or end_time > start_time
  ),
  constraint assignments_removed_fields_check check (
    removed_at is null or (removed_by is not null and removed_reason is not null)
  )
);

comment on table public.assignments is
  'Empleado × turno (04 sección 2.3). Franja propia opcional (start_time/end_time, P-046); nula = la del turno. shift_date/window son denormalizadas, las mantiene app.sync_assignment_window. Quitar una asignación es baja lógica con motivo (removed_at/removed_by/removed_reason); la fila queda para historia -- sin deleted_at, a diferencia de los maestros.';
comment on column public.assignments.shift_date is
  'Denormalizada del turno (shifts.shift_date), mantenida por app.sync_assignment_window. Solo lectura: la escribe el trigger, no la RPC.';
comment on column public.assignments."window" is
  'Rango [inicio, fin) de la franja efectiva en instante UTC (la propia si existe, si no la del turno), mantenida por app.sync_assignment_window. Base de la restricción de exclusión assignments_no_overlap (P-053).';

alter table public.assignments enable row level security;

create trigger trg_set_updated_at
before update on public.assignments
for each row execute function app.set_updated_at();

-- app.sync_assignment_window() (04 sección 2.3, sección 5): calcula shift_date/window de una
-- asignación a partir del turno y de la franja efectiva (la propia si existe, si no la del
-- turno). Un único trigger para dos disparadores distintos (distingue por tg_table_name):
--   - BEFORE INSERT OR UPDATE OF shift_id/start_time/end_time ON assignments: recalcula la
--     fila que está por escribirse, usando el turno referenciado.
--   - AFTER UPDATE OF shift_date/start_time/end_time ON shifts: recalcula todas las
--     asignaciones vigentes de ese turno cuando cambia su fecha o su franja (update_shift_time,
--     0013, todavía no escrita) -- "se recalculan si cambia el turno" (04 sección 2.3).
-- Sin `security definer`: corre con los permisos de quien dispara el trigger (por ahora
-- `postgres`, que aplica las migraciones y corre los tests; las RPC de 0013 son `security
-- definer` y van a tener permiso de sobra sobre estas dos tablas al ejecutar el UPDATE/INSERT
-- que dispara el trigger).
create function app.sync_assignment_window()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  if tg_table_name = 'assignments' then
    select * into v_shift from public.shifts where id = new.shift_id;

    if v_shift.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'El turno de la asignación no existe.',
        hint = 'SHIFT_NOT_FOUND';
    end if;

    new.shift_date := v_shift.shift_date;
    new."window" := tstzrange(
      app.local_ts(v_shift.shift_date, coalesce(new.start_time, v_shift.start_time)),
      app.local_ts(v_shift.shift_date, coalesce(new.end_time, v_shift.end_time)),
      '[)'
    );
    return new;
  elsif tg_table_name = 'shifts' then
    update public.assignments a
    set shift_date = new.shift_date,
        "window" = tstzrange(
          app.local_ts(new.shift_date, coalesce(a.start_time, new.start_time)),
          app.local_ts(new.shift_date, coalesce(a.end_time, new.end_time)),
          '[)'
        )
    where a.shift_id = new.id;
    return new;
  end if;

  return new;
end;
$$;

comment on function app.sync_assignment_window() is
  'Trigger: mantiene assignments.shift_date/window (franja efectiva en UTC, "[)" para que dos turnos consecutivos sin hueco no se consideren superpuestos). BEFORE INSERT/UPDATE en assignments recalcula la fila propia; AFTER UPDATE en shifts recalcula las asignaciones vigentes del turno (04 sección 2.3, P-053).';

create trigger trg_sync_assignment_window
before insert or update of shift_id, start_time, end_time on public.assignments
for each row execute function app.sync_assignment_window();

create trigger trg_sync_assignment_window_from_shift
after update of shift_date, start_time, end_time on public.shifts
for each row execute function app.sync_assignment_window();

-- Restricción de exclusión (04 sección 2.3, P-053): bloquea que el mismo empleado tenga dos
-- asignaciones vigentes con ventanas superpuestas. `where (removed_at is null)`: una asignación
-- quitada (baja lógica) libera el rango que ocupaba -- mismo criterio que
-- employee_leaves_no_overlap en 0006. Requiere btree_gist (0001) para el operador `=` sobre
-- `uuid` dentro de un índice GiST. Se agrega con `alter table` después de crear la tabla y el
-- trigger, para que las filas que pudiera haber (ninguna todavía, tabla recién creada) ya
-- tengan window calculada -- documentado por claridad, sin efecto real en una tabla vacía.
alter table public.assignments
  add constraint assignments_no_overlap
  exclude using gist (
    employee_id with =,
    "window" with &&
  )
  where (removed_at is null);

-- Unicidad parcial (04 sección 2.3): un empleado no puede tener dos asignaciones vigentes en el
-- mismo turno.
create unique index assignments_shift_id_employee_id_key
  on public.assignments (shift_id, employee_id)
  where removed_at is null;

-- Índices de 04 sección 8: jornada del empleado y dotación del turno.
create index assignments_employee_id_shift_date_idx on public.assignments (employee_id, shift_date);
create index assignments_shift_id_idx on public.assignments (shift_id) where removed_at is null;

-- ---------------------------------------------------------------------------------------------
-- 4. app.current_employee_id() y app.shares_shift(shift_id) (04 sección 5)
-- ---------------------------------------------------------------------------------------------

-- `security definer`: employees y assignments ya tienen RLS habilitada y, en cuanto 0012 agregue
-- las políticas, estas funciones se van a evaluar *dentro* de políticas de otras tablas (shifts,
-- clients, sites, etc.) -- sin bypassear RLS acá adentro, esa evaluación anidada podría fallar o
-- disparar recursión (mismo motivo que custom_access_token_hook en 0003). `stable`: mismo
-- resultado dentro de la misma transacción/consulta.
create function app.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select auth.uid()
  where exists (
    select 1 from public.employees e where e.profile_id = auth.uid()
  );
$$;

comment on function app.current_employee_id() is
  'auth.uid() si la sesión actual tiene fila en employees (cualquiera sea su status), null si no (04 sección 5).';

create function app.shares_shift(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.assignments a
    where a.shift_id = p_shift_id
      and a.employee_id = auth.uid()
      and a.removed_at is null
  );
$$;

comment on function app.shares_shift(uuid) is
  'True si la sesión actual tiene una asignación vigente (removed_at is null) en ese turno -- para ver compañeros y datos del turno (04 sección 5, P-103).';
