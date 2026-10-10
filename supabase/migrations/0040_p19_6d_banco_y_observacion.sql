-- P19.6 paquete D: AJ2-04 «banco, CBU y alias de clientes y empleados» y AJ2-15 «observación del
-- turno con casilla mostrar en la impresión» (base de datos).
--
-- AJ2-04 -- diseño: TABLAS APARTE, no columnas en `clients` ni en `employees`.
--   Motivo de seguridad: `employees` la lee el supervisor de sus turnos (fila completa,
--   employees_select_supervisor_team, 0012) y el empleado la suya; `clients` la leen el
--   supervisor y, por v_clients_basic, el empleado. Además `authenticated` tiene `select` de
--   tabla completa (0017) y varias vistas (v_clients, v_employees, v_search, v_my_supervisions)
--   trabajan sobre esas tablas. Una columna nueva ahí se filtraría por la tabla o por cualquier
--   vista futura con `select *`. En cambio, una tabla con su propia RLS no se puede filtrar por
--   ninguna vista existente ni por las que se agreguen: nadie la lee si la política no lo permite.
--     - public.client_bank_details   (client_id)   : select solo dueño/administrador.
--     - public.employee_bank_details (profile_id)  : select dueño/administrador y la propia
--       persona (el empleado ve los suyos en «Más», solo lectura). Supervisor y compañeros, nada.
--   Escritura: solo por RPC (`set_client_bank_details`, `set_employee_bank_details`), dueño y
--   administrador, que normalizan y validan. `authenticated` no tiene insert/update/delete.
--   El empleado lee sus datos directo de `employee_bank_details` (la RLS ya lo limita a su fila);
--   no hace falta una función `my_bank_details()` aparte.
--   Checks: CBU exactamente 22 dígitos; alias de 6 a 20 caracteres de letras, números, punto y
--   guion (formato de alias de CBU, sin la @ ni espacios); banco texto libre.
--
-- AJ2-15 -- diseño: TABLA APARTE `public.shift_observations` (shift_id pk → shifts, observation,
--   show_in_print), con RLS de lectura solo para dueño y administrador. Mismo motivo que el banco:
--   `shifts` la leen el supervisor y el empleado asignados (fila completa, 0012) y `authenticated`
--   tiene `select` de tabla (0017), así que una observación guardada en `shifts` quedaría legible
--   por la API para quien no corresponde. Cambios:
--     - La observación que antes vivía en `shifts.notes` (notas administrativas) se migra a la
--       tabla nueva con la casilla DESTILDADA (decisión de Mike: lo existente no se imprime) y
--       `shifts.notes` se VACÍA. La columna se conserva (no se elimina) y deja de escribirse:
--       así no se rompen los select del front que la nombran ni los tests/fixtures viejos; el
--       front pasa a leer la observación de v_shifts_board / shift_observations. Un turno sin fila
--       en la tabla nueva no tiene observación.
--     - v_shifts_board: `notes` sale de la tabla nueva y `show_in_print` se suma al final (null si
--       no hay observación). Como la vista es security_invoker, para supervisor y empleado la RLS
--       de la tabla nueva los deja en null.
--     - v_assignments_board: `shift_observation` al final (alimenta la planilla de asistencia):
--       la observación solo si la casilla está tildada; null para quien no es administración.
--     - client_service_summary: cada turno de `shifts` trae `observation` al final (null si no
--       hay observación o si no se imprime).
--     - create_shift: parámetro nuevo al final `p_show_in_print boolean default true`.
--     - update_shift_details: parámetro nuevo al final `p_show_in_print boolean default null`
--       (null = no cambia la casilla). Ambas escriben en shift_observations, nunca en shifts.notes.
--     - Escritura solo por esas dos RPC (`authenticated` no tiene insert/update/delete).

-- ---------------------------------------------------------------------------------------------
-- 1. Datos bancarios de clientes
-- ---------------------------------------------------------------------------------------------

create table public.client_bank_details (
  client_id uuid primary key references public.clients (id),
  bank_name text,
  cbu text,
  alias text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint client_bank_details_cbu_check check (cbu is null or cbu ~ '^[0-9]{22}$'),
  constraint client_bank_details_alias_check check (alias is null or alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  constraint client_bank_details_bank_name_check check (bank_name is null or (btrim(bank_name) <> '' and char_length(bank_name) <= 100))
);

comment on table public.client_bank_details is
  'Banco, CBU y alias de un cliente (0040, AJ2-04). Tabla aparte para que ninguna vista ni política de clients los filtre: solo dueño y administrador leen; se escribe por set_client_bank_details.';

alter table public.client_bank_details enable row level security;

create trigger trg_set_updated_at
before update on public.client_bank_details
for each row execute function app.set_updated_at();

create policy client_bank_details_select_admin
  on public.client_bank_details for select to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 2. Datos bancarios de empleados y supervisores
-- ---------------------------------------------------------------------------------------------

create table public.employee_bank_details (
  profile_id uuid primary key references public.employees (profile_id),
  bank_name text,
  cbu text,
  alias text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint employee_bank_details_cbu_check check (cbu is null or cbu ~ '^[0-9]{22}$'),
  constraint employee_bank_details_alias_check check (alias is null or alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  constraint employee_bank_details_bank_name_check check (bank_name is null or (btrim(bank_name) <> '' and char_length(bank_name) <= 100))
);

comment on table public.employee_bank_details is
  'Banco, CBU y alias de un empleado o supervisor (0040, AJ2-04). Tabla aparte para que ni la política de supervisor sobre employees ni v_employees los filtren: leen dueño, administrador y la propia persona (solo lectura, pantalla «Más»); se escribe por set_employee_bank_details.';

alter table public.employee_bank_details enable row level security;

create trigger trg_set_updated_at
before update on public.employee_bank_details
for each row execute function app.set_updated_at();

create policy employee_bank_details_select_admin
  on public.employee_bank_details for select to authenticated
  using (app.is_admin());

create policy employee_bank_details_select_own
  on public.employee_bank_details for select to authenticated
  using (profile_id = app.current_uid());

-- ---------------------------------------------------------------------------------------------
-- 3. Normalización común y RPC de escritura
-- ---------------------------------------------------------------------------------------------

-- Devuelve el CBU solo con dígitos (quita espacios, guiones y puntos); null si viene vacío.
-- Si después de limpiar no son exactamente 22 dígitos, corta con INVALID_CBU.
create function app.normalize_cbu(p_cbu text)
returns text
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
declare
  v_clean text;
begin
  if p_cbu is null or btrim(p_cbu) = '' then
    return null;
  end if;

  v_clean := regexp_replace(p_cbu, '[\s.-]', '', 'g');

  if v_clean !~ '^[0-9]{22}$' then
    raise exception using
      errcode = 'P0001',
      message = 'El CBU tiene que tener exactamente 22 dígitos.',
      hint = 'INVALID_CBU';
  end if;

  return v_clean;
end;
$$;

comment on function app.normalize_cbu(text) is
  'CBU solo con dígitos (0040, AJ2-04): quita espacios, guiones y puntos; null si viene vacío; INVALID_CBU si no quedan exactamente 22 dígitos.';

create function app.normalize_bank_alias(p_alias text)
returns text
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
declare
  v_clean text;
begin
  if p_alias is null or btrim(p_alias) = '' then
    return null;
  end if;

  v_clean := btrim(p_alias);

  if v_clean !~ '^[A-Za-z0-9.-]{6,20}$' then
    raise exception using
      errcode = 'P0001',
      message = 'El alias tiene que tener entre 6 y 20 caracteres: letras, números, punto o guion.',
      hint = 'INVALID_ALIAS';
  end if;

  return v_clean;
end;
$$;

comment on function app.normalize_bank_alias(text) is
  'Alias de CBU recortado (0040, AJ2-04): null si viene vacío; INVALID_ALIAS si no tiene 6 a 20 caracteres de letras, números, punto o guion.';

create function public.set_client_bank_details(
  p_client_id uuid,
  p_bank_name text default null,
  p_cbu text default null,
  p_alias text default null
)
returns public.client_bank_details
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.client_bank_details;
  v_bank text;
begin
  perform app.require_admin();

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  v_bank := nullif(btrim(p_bank_name), '');

  if v_bank is not null and char_length(v_bank) > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'El nombre del banco puede tener hasta 100 caracteres.',
      hint = 'BANK_NAME_TOO_LONG';
  end if;

  insert into public.client_bank_details (client_id, bank_name, cbu, alias, created_by, updated_by)
  values (p_client_id, v_bank, app.normalize_cbu(p_cbu), app.normalize_bank_alias(p_alias), auth.uid(), auth.uid())
  on conflict (client_id) do update
    set bank_name = excluded.bank_name,
        cbu = excluded.cbu,
        alias = excluded.alias,
        updated_by = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_client_bank_details(uuid, text, text, text) is
  'Guarda (alta o cambio) banco, CBU y alias de un cliente (0040, AJ2-04). O, A; FORBIDDEN si no. CLIENT_NOT_FOUND, INVALID_CBU (22 dígitos exactos; se aceptan espacios, guiones y puntos y se guarda solo con dígitos), INVALID_ALIAS (6 a 20 caracteres: letras, números, punto, guion), BANK_NAME_TOO_LONG (100). Cada campo vacío se guarda como null; mandar los tres vacíos deja la fila sin datos. Devuelve la fila.';

create function public.set_employee_bank_details(
  p_profile_id uuid,
  p_bank_name text default null,
  p_cbu text default null,
  p_alias text default null
)
returns public.employee_bank_details
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.employee_bank_details;
  v_bank text;
begin
  perform app.require_admin();

  if not exists (select 1 from public.employees e where e.profile_id = p_profile_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  v_bank := nullif(btrim(p_bank_name), '');

  if v_bank is not null and char_length(v_bank) > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'El nombre del banco puede tener hasta 100 caracteres.',
      hint = 'BANK_NAME_TOO_LONG';
  end if;

  insert into public.employee_bank_details (profile_id, bank_name, cbu, alias, created_by, updated_by)
  values (p_profile_id, v_bank, app.normalize_cbu(p_cbu), app.normalize_bank_alias(p_alias), auth.uid(), auth.uid())
  on conflict (profile_id) do update
    set bank_name = excluded.bank_name,
        cbu = excluded.cbu,
        alias = excluded.alias,
        updated_by = auth.uid()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_employee_bank_details(uuid, text, text, text) is
  'Guarda (alta o cambio) banco, CBU y alias de un empleado o supervisor (0040, AJ2-04). O, A; FORBIDDEN si no. PROFILE_NOT_FOUND (no tiene ficha en employees), INVALID_CBU, INVALID_ALIAS, BANK_NAME_TOO_LONG: mismas reglas que set_client_bank_details. Devuelve la fila.';

-- ---------------------------------------------------------------------------------------------
-- 4. shift_observations (AJ2-15)
-- ---------------------------------------------------------------------------------------------

create table public.shift_observations (
  shift_id uuid primary key references public.shifts (id),
  observation text,
  show_in_print boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id)
);

comment on table public.shift_observations is
  'Observación del turno y casilla «mostrar en la impresión» (0040, AJ2-15). Tabla aparte para que supervisor y empleado asignados no la lean por shifts: select solo dueño y administrador; se escribe por create_shift y update_shift_details. Reemplaza a shifts.notes, que quedó vacía y sin uso.';

alter table public.shift_observations enable row level security;

create trigger trg_set_updated_at
before update on public.shift_observations
for each row execute function app.set_updated_at();

create policy shift_observations_select_admin
  on public.shift_observations for select to authenticated
  using (app.is_admin());

-- Migración de lo existente: casilla destildada (lo ya cargado no se imprime de golpe). El update
-- que vacía shifts.notes no debe mover updated_at (dispararía el aviso de cambios de v_my_day).
insert into public.shift_observations (shift_id, observation, show_in_print, created_by)
select sh.id, sh.notes, false, sh.updated_by
from public.shifts sh
where sh.notes is not null and btrim(sh.notes) <> '';

alter table public.shifts disable trigger trg_set_updated_at;
update public.shifts set notes = null where notes is not null;
alter table public.shifts enable trigger trg_set_updated_at;

comment on column public.shifts.notes is
  'En desuso desde 0040 (AJ2-15): siempre null. La observación del turno vive en shift_observations (solo administración la lee).';

-- ---------------------------------------------------------------------------------------------
-- 5. Vistas y resumen del cliente
-- ---------------------------------------------------------------------------------------------

-- v_shifts_board: `notes` viene de shift_observations y `show_in_print` va al final (create or replace no
-- permite reordenar columnas).
create or replace view public.v_shifts_board
with (security_invoker = true)
as
select
  sh.id,
  sh.service_id,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.city as site_city,
  sh.shift_date,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sh.required_staff,
  sh.status,
  sh.generated,
  sh.checklist_template_id,
  sh.cancelled_at,
  sh.cancelled_by,
  sh.cancel_reason,
  o.observation as notes,
  coalesce(counts.assigned_count, 0) as assigned_count,
  coalesce(counts.present_count, 0) as present_count,
  coalesce(counts.finished_count, 0) as finished_count,
  coalesce(counts.absent_count, 0) as absent_count,
  coalesce(counts.delayed_count, 0) as delayed_count,
  case
    when sh.status not in ('in_progress', 'completed', 'cancelled')
      and coalesce(counts.assigned_count, 0) < sh.required_staff
      and (now() > sh.starts_at or coalesce(counts.absent_count, 0) > 0)
      then 'uncovered'
    when sh.status in ('scheduled', 'assigned')
      and sh.starts_at > now()
      and sh.starts_at <= now() + interval '2 hours'
      then 'upcoming'
    else sh.status::text
  end as display_status,
  sh.created_at,
  sh.updated_at,
  sh.created_by,
  sh.updated_by,
  sh.deleted_at,
  sh.open_ended,
  coalesce(counts.no_checkout_count, 0) as no_checkout_count,
  o.show_in_print as show_in_print
from public.shifts sh
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.shift_observations o on o.shift_id = sh.id
left join lateral (
  select
    count(*) filter (where a.removed_at is null) as assigned_count,
    count(*) filter (where a.removed_at is null and a.status = 'present') as present_count,
    count(*) filter (where a.removed_at is null and a.status = 'finished') as finished_count,
    count(*) filter (where a.removed_at is null and a.status = 'absence_notified') as absent_count,
    count(*) filter (where a.removed_at is null and a.status = 'delay_notified') as delayed_count,
    count(*) filter (
      where a.removed_at is null
        and a.status = 'present'
        and sh.open_ended
        and a.end_time is null
        and sh.status <> 'cancelled'
        and now() >= upper(a."window")
    ) as no_checkout_count
  from public.assignments a
  where a.shift_id = sh.id
) counts on true
where sh.deleted_at is null;

comment on view public.v_shifts_board is
  'Planificación, asistencia de hoy y tablero (04 sección 4). display_status agrega los derivados uncovered/upcoming sobre shifts.status (fórmula en el comentario de 0011). open_ended (0037, AJ2-10): turno «A terminar»; el front muestra «A terminar» en vez de end_time (que queda en 23:59). no_checkout_count (0037): asignaciones vigentes «Sin salida» (present, turno abierto, sin fin propio, pasadas las 23:59). notes y show_in_print (0040, AJ2-15): observación del turno y casilla «mostrar en la impresión», leídas de shift_observations; solo los ve administración (null para supervisor y empleado por la RLS de esa tabla; show_in_print también es null si el turno no tiene observación). security_invoker: visibilidad de filas por RLS de shifts/clients/sites (0012, DB-014).';

-- v_assignments_board: `shift_observation` al final.
create or replace view public.v_assignments_board
with (security_invoker = true)
as
select
  a.id,
  a.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  a.employee_id,
  p.first_name as employee_first_name,
  p.last_name as employee_last_name,
  p.avatar_path as employee_avatar_path,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  case
    when ci.recorded_at is not null and ci.recorded_at > lower(a."window")
      then round(extract(epoch from (ci.recorded_at - lower(a."window"))) / 60)::int
    else null
  end as minutes_late,
  case
    when sh.open_ended and a.end_time is null then null
    when co.recorded_at is not null and co.recorded_at < upper(a."window")
      then round(extract(epoch from (upper(a."window") - co.recorded_at)) / 60)::int
    else null
  end as minutes_early_leave,
  case
    when a.status in ('expected', 'delay_notified')
      and notice.kind = 'on_the_way'
      and ci.recorded_at is null
      and now() < upper(a."window")
      and now() <= coalesce(notice.estimated_arrival_at, lower(a."window"))
                   + make_interval(mins => app.late_grace_minutes())
      then 'on_the_way'
    when a.status in ('expected', 'delay_notified')
      and now() > lower(a."window")
      and now() <= lower(a."window") + make_interval(mins => app.late_grace_minutes())
      then 'late'
    when a.status in ('expected', 'delay_notified') and now() > lower(a."window")
      then 'no_record'
    when a.status = 'present'
      and a.removed_at is null
      and sh.open_ended
      and a.end_time is null
      and sh.status <> 'cancelled'
      and now() >= upper(a."window")
      then 'no_checkout'
    else a.status::text
  end as display_status,
  a.removed_at,
  a.removed_by,
  a.removed_reason,
  a.created_at,
  a.updated_at,
  a.created_by,
  a.updated_by,
  ci.source as check_in_source,
  ci.recorded_by as check_in_recorded_by,
  co.source as check_out_source,
  co.recorded_by as check_out_recorded_by,
  notice.kind as last_notice_kind,
  notice.minutes_late as last_notice_minutes_late,
  notice.reason_code as last_notice_reason_code,
  notice.reason_text as last_notice_reason_text,
  notice.reported_by as last_notice_reported_by,
  notice.source as last_notice_source,
  notice.created_at as last_notice_at,
  notice.estimated_arrival_at as last_notice_estimated_arrival_at,
  case
    when sh.open_ended and a.end_time is null then null
    else app.minutes_between(lower(a."window"), upper(a."window"))
  end as planned_minutes,
  case
    when a.status = 'present'
      and a.removed_at is null
      and sh.open_ended
      and a.end_time is null
      and sh.status <> 'cancelled'
      and now() >= upper(a."window")
      then 0
    else app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window"))
  end as worked_minutes,
  (sh.open_ended and a.end_time is null) as effective_open_ended,
  case when o.show_in_print then nullif(btrim(o.observation), '') end as shift_observation
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
left join public.shift_observations o on o.shift_id = sh.id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source,
         an.created_at, an.estimated_arrival_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true;

comment on view public.v_assignments_board is
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status deriva (no se persiste), sobre expected/delay_notified sin inicio registrado y en este orden: on_the_way (último aviso en camino, franja sin terminar y now() <= vencimiento del aviso: hora estimada + app.late_grace_minutes(), o inicio efectivo + app.late_grace_minutes() si no indicó estimación; 0034), late («Llegada tarde»: pasó el inicio efectivo hace app.late_grace_minutes() = 15 minutos o menos, P19.5a) y no_record (más de esos minutos, P-071); no_checkout («Sin salida», 0037, AJ2-10): asignación present de un turno «A terminar» sin fin propio, vigente, pasadas las 23:59 del día del turno; en los demás casos es assignments.status. minutes_late / minutes_early_leave (P-076) comparan contra la franja efectiva (assignments."window"); minutes_early_leave es null en una asignación «A terminar» (no tiene fin previsto). planned_minutes: duración de la franja efectiva, null si la asignación es «A terminar» (0037). worked_minutes (AJ2-09, 0037): minutos de [inicio fichado, fin fichado] dentro de la franja efectiva (app.capped_worked_minutes), redondeados al minuto, nunca negativos; null si falta alguno; 0 si está «Sin salida». El front muestra tilde si worked_minutes >= planned_minutes sin margen y advertencia si es menor o hubo salida anticipada. effective_open_ended (0037): la asignación es «A terminar» (turno abierto y sin fin propio); el front muestra «A terminar» en vez de effective_end_time (23:59). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027). last_notice_*: último aviso de la asignación (por created_at). Incluye asignaciones quitadas (removed_at not null). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices. shift_observation (0040, AJ2-15): observación del turno para la columna «Observaciones» del imprimible; solo si el turno tiene la casilla «mostrar en la impresión» tildada y solo para administración (lee shift_observations; null para los demás roles).';

-- client_service_summary: `observation` al final de cada turno (misma función que 0037).
create or replace function public.client_service_summary(
  p_client_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client_exists boolean;
  v_result jsonb;
begin
  -- Lo ve quien puede ver clientes (clients_select_admin, 0012): dueño y cualquier administrador.
  perform app.require_admin();

  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El rango de fechas no es válido: la fecha desde no puede ser posterior a la fecha hasta.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  select exists (select 1 from public.clients c where c.id = p_client_id) into v_client_exists;

  if not v_client_exists then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  with done_shifts as (
    select sh.id, sh.shift_date, sh.site_id, si.name as site_name, sh.start_time, sh.end_time,
           sh.status, sh.open_ended,
           case when o.show_in_print then nullif(btrim(o.observation), '') end as observation
    from public.shifts sh
    join public.sites si on si.id = sh.site_id
    left join public.shift_observations o on o.shift_id = sh.id
    where sh.client_id = p_client_id
      and sh.deleted_at is null
      and sh.status <> 'cancelled'
      and sh.shift_date between p_from and p_to
      and (
        sh.status = 'completed'
        or exists (
          select 1
          from public.assignments a
          join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
          where a.shift_id = sh.id
        )
      )
  ),
  rows as (
    select
      ds.id as shift_id,
      a.id as assignment_id,
      a.employee_id,
      p.first_name,
      p.last_name,
      a.status,
      ci.recorded_at as check_in_at,
      co.recorded_at as check_out_at,
      (ds.open_ended and a.end_time is null) as open_ended,
      (
        a.status = 'present'
        and ds.open_ended
        and a.end_time is null
        and now() >= upper(a."window")
      ) as no_checkout,
      case
        when ds.open_ended and a.end_time is null then null
        else app.minutes_between(lower(a."window"), upper(a."window"))
      end as planned_minutes,
      app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window")) as worked_minutes
    from done_shifts ds
    join public.assignments a on a.shift_id = ds.id and a.removed_at is null
    join public.profiles p on p.id = a.employee_id
    left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
  ),
  per_shift as (
    select
      ds.id,
      coalesce(sum(r.worked_minutes), 0)::integer as worked_minutes,
      coalesce(sum(r.planned_minutes) filter (where r.check_in_at is not null), 0)::integer as planned_minutes,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'assignment_id', r.assignment_id,
            'employee_id', r.employee_id,
            'first_name', r.first_name,
            'last_name', r.last_name,
            'status', r.status,
            'check_in_at', r.check_in_at,
            'check_out_at', r.check_out_at,
            'planned_minutes', r.planned_minutes,
            'worked_minutes', r.worked_minutes,
            'open_ended', r.open_ended,
            'no_checkout', r.no_checkout
          )
          order by r.last_name, r.first_name, r.assignment_id
        ) filter (where r.assignment_id is not null),
        '[]'::jsonb
      ) as employees
    from done_shifts ds
    left join rows r on r.shift_id = ds.id
    group by ds.id
  )
  select jsonb_build_object(
    'client_id', p_client_id,
    'from', p_from,
    'to', p_to,
    'totals', jsonb_build_object(
      'shifts_done', (select count(*) from done_shifts),
      'employees_count', (select count(distinct employee_id) from rows where check_in_at is not null),
      'worked_minutes', coalesce((select sum(worked_minutes) from rows), 0),
      'planned_minutes', coalesce((select sum(planned_minutes) from rows where check_in_at is not null), 0),
      'open_ended_shifts', (select count(*) from done_shifts where open_ended)
    ),
    'shifts', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'shift_id', ds.id,
            'shift_date', ds.shift_date,
            'site_id', ds.site_id,
            'site_name', ds.site_name,
            'start_time', ds.start_time,
            'end_time', ds.end_time,
            'status', ds.status,
            'worked_minutes', ps.worked_minutes,
            'planned_minutes', ps.planned_minutes,
            'employees', ps.employees,
            'open_ended', ds.open_ended,
            'observation', ds.observation
          )
          order by ds.shift_date, ds.start_time, ds.site_name, ds.id
        )
        from done_shifts ds
        join per_shift ps on ps.id = ds.id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.client_service_summary(uuid, date, date) is
  'Resumen de servicios de un cliente en un período, para la hoja imprimible (0033, P19.5a). O, A (quien ve clientes, clients_select_admin); FORBIDDEN si no; INVALID_DATE_RANGE (fechas nulas o desde > hasta), CLIENT_NOT_FOUND. "Turno realizado": vigente, no cancelado, completed o con al menos un inicio registrado, con shift_date entre p_from y p_to. Devuelve jsonb { client_id, from, to, totals { shifts_done, employees_count (distintos con inicio), worked_minutes, planned_minutes, open_ended_shifts (turnos «A terminar», 0037) }, shifts [ { shift_id, shift_date, site_id, site_name, start_time, end_time, status, worked_minutes, planned_minutes, open_ended (0037), observation (0040, AJ2-15: observación del turno, solo si tiene tildada «mostrar en la impresión»; null si no), employees [ { assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at, planned_minutes, worked_minutes, open_ended, no_checkout } ] } ] } ordenado por fecha, hora y sede. Desde 0037 (AJ2-09/AJ2-10): worked_minutes cuenta solo la parte del fichaje dentro de la franja efectiva de cada asignación (app.capped_worked_minutes); las asignaciones «A terminar» (open_ended) tienen planned_minutes null y no suman a las previstas; una asignación sin salida (no_checkout) suma 0 horas hasta que administración cargue la hora. employees lista las asignaciones vigentes del turno (también las sin inicio, con worked_minutes null). end_time = 23:59 en un turno open_ended no es una hora de fin: se muestra «A terminar». Desde 0040 cada turno de shifts trae observation al final (null si no hay o si no se imprime).';

-- ---------------------------------------------------------------------------------------------
-- 6. create_shift y update_shift_details con la casilla (cambian de firma: drop + create)
-- ---------------------------------------------------------------------------------------------

drop function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean);

create function public.create_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_service_id uuid default null,
  p_notes text default null,
  p_open_ended boolean default false,
  p_show_in_print boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_warnings text[] := array[]::text[];
  v_end time;
begin
  perform app.require_role('owner', 'admin');

  v_end := case when coalesce(p_open_ended, false) then time '23:59' else p_end end;

  if v_end is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status = 'active') then
    raise exception using
      errcode = 'P0001',
      message = 'El cliente no está activo.',
      hint = 'CLIENT_NOT_ACTIVE';
  end if;

  if not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.client_id = p_client_id and s.status = 'active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'La sede no está activa.',
      hint = 'SITE_NOT_ACTIVE';
  end if;

  insert into public.shifts (
    service_id, client_id, site_id, shift_date, start_time, end_time, open_ended,
    required_staff, status, generated, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, v_end, coalesce(p_open_ended, false),
    p_required_staff, 'scheduled', false, auth.uid()
  )
  returning * into v_shift;

  if nullif(btrim(p_notes), '') is not null or p_show_in_print is false then
    insert into public.shift_observations (shift_id, observation, show_in_print, created_by)
    values (v_shift.id, nullif(btrim(p_notes), ''), coalesce(p_show_in_print, true), auth.uid());
  end if;

  perform app.copy_checklist_to_shift(v_shift.id);

  if exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    v_warnings := array_append(v_warnings, 'HOLIDAY');
  end if;

  select * into v_shift from public.shifts where id = v_shift.id;

  -- La observación no vive en shifts: se agrega al objeto devuelto para no cambiar el contrato.
  return jsonb_build_object(
    'shift',
    to_jsonb(v_shift) || jsonb_build_object(
      'notes', (select o.observation from public.shift_observations o where o.shift_id = v_shift.id),
      'show_in_print', coalesce((select o.show_in_print from public.shift_observations o where o.shift_id = v_shift.id), true)
    ),
    'warnings', v_warnings
  );
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. CLIENT_NOT_ACTIVE/SITE_NOT_ACTIVE si el cliente o la sede no están activos; INVALID_TIME_RANGE si end <= start (o si falta p_end y el turno no es «A terminar»). Copia el checklist vigente (app.copy_checklist_to_shift). Devuelve {"shift": <fila>, "warnings": [...]}; "HOLIDAY" (informativo, no bloquea) si la fecha es feriado. Desde 0037 (AJ2-10) p_open_ended = true crea un turno «A terminar» (sin hora de fin; p_end se ignora y end_time queda en 23:59). Desde 0040 (AJ2-15) p_notes es la observación del turno y p_show_in_print (default true; null cuenta como true) la casilla «mostrar en la impresión».';

drop function public.update_shift_details(uuid, smallint, text);

create function public.update_shift_details(p_shift_id uuid, p_required_staff smallint, p_notes text default null, p_show_in_print boolean default null)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_assigned_count int;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null for update;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if v_shift.status = 'completed' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó.',
      hint = 'SHIFT_COMPLETED';
  end if;

  if p_required_staff < 1 or p_required_staff > 10 then
    raise exception using
      errcode = 'P0001',
      message = 'La dotación tiene que ser entre 1 y 10 personas.',
      hint = 'REQUIRED_STAFF_RANGE';
  end if;

  select count(*) into v_assigned_count
  from public.assignments a
  where a.shift_id = p_shift_id and a.removed_at is null;

  if p_required_staff < v_assigned_count then
    raise exception using
      errcode = 'P0001',
      message = 'No podés bajar la dotación por debajo de la cantidad de personas ya asignadas.',
      hint = 'REQUIRED_STAFF_BELOW_ASSIGNED';
  end if;

  update public.shifts
  set
    required_staff = p_required_staff,
    status = case
      when status = 'scheduled' and v_assigned_count >= p_required_staff then 'assigned'
      when status = 'assigned' and v_assigned_count < p_required_staff then 'scheduled'
      else status
    end,
    updated_by = auth.uid()
  where id = p_shift_id
  returning * into v_shift;

  -- La observación se guarda aparte. p_notes siempre reemplaza (como antes con shifts.notes);
  -- p_show_in_print null = no cambia (si no había fila, nace tildada).
  if nullif(btrim(p_notes), '') is not null
     or p_show_in_print is not null
     or exists (select 1 from public.shift_observations o where o.shift_id = p_shift_id) then
    insert into public.shift_observations (shift_id, observation, show_in_print, created_by, updated_by)
    values (p_shift_id, nullif(btrim(p_notes), ''), coalesce(p_show_in_print, true), auth.uid(), auth.uid())
    on conflict (shift_id) do update
      set observation = excluded.observation,
          show_in_print = coalesce(p_show_in_print, public.shift_observations.show_in_print),
          updated_by = auth.uid();
  end if;

  -- La fila devuelta lleva la observación en `notes` (no se guarda en shifts) para no cambiar el contrato.
  select o.observation into v_shift.notes from public.shift_observations o where o.shift_id = p_shift_id;

  return v_shift;
end;
$$;

comment on function public.update_shift_details(uuid, smallint, text, boolean) is
  'Edita la dotación y las notas administrativas de un turno (corrige 06 sección 7, que traía "editar notas: update shifts.notes" -- 0012 no permite escritura directa de shifts, todo pasa por RPC; pendiente anotado en 12_Registro_de_Progreso.md, P10.3). O, A. SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, REQUIRED_STAFF_RANGE (1..10), REQUIRED_STAFF_BELOW_ASSIGNED si p_required_staff queda por debajo de los asignados vigentes. Recalcula scheduled/assigned según la nueva dotación (04 sección 6.1). Devuelve la fila de shifts. Desde 0028 (P14.2) fija updated_by = auth.uid(): esta RPC puede seguir editando notas/dotación con el turno in_progress, después de un check-in de otra persona, y no tiene que quedar atribuida a quien hizo ese check-in. Desde 0040 (AJ2-15) p_notes es la observación del turno (solo administración la ve) y p_show_in_print la casilla «mostrar en la impresión»: null = no cambia.';

-- ---------------------------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------------------------

-- Las tablas nuevas nacen con select para authenticated (default privileges de 0017); la RLS las
-- limita. Sin insert/update/delete: se escribe solo por las RPC.
revoke execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean) to authenticated;

revoke execute on function public.update_shift_details(uuid, smallint, text, boolean) from public, anon;
grant execute on function public.update_shift_details(uuid, smallint, text, boolean) to authenticated;

revoke execute on function public.set_client_bank_details(uuid, text, text, text) from public, anon;
grant execute on function public.set_client_bank_details(uuid, text, text, text) to authenticated;

revoke execute on function public.set_employee_bank_details(uuid, text, text, text) from public, anon;
grant execute on function public.set_employee_bank_details(uuid, text, text, text) to authenticated;


-- Las funciones auxiliares de app.* solo las llaman las RPC (security definer): nadie más las ejecuta.
revoke execute on function app.normalize_cbu(text) from public, anon, authenticated;
revoke execute on function app.normalize_bank_alias(text) from public, anon, authenticated;
