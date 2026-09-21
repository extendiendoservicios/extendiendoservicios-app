-- DB-013 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Undécimo bloque de 04_Modelo_de_Datos.md sección 11: las diez vistas de la sección 4, todas
-- `security_invoker = true` ("para que apliquen las políticas RLS de las tablas base"). Contenido,
-- en orden:
--   0. `app.today()`: fecha de hoy en Argentina (auxiliar nuevo, usado por varias vistas de este
--      archivo -- ver nota más abajo).
--   1. `v_employees` (04 sección 4).
--   2. `v_shifts_board` (04 sección 4).
--   3. `v_assignments_board` (04 sección 4).
--   4. `v_my_day` (04 sección 4, P-092, P-093).
--   5. `v_supervisions_admin` (04 sección 4, P-088).
--   6. `v_my_supervisions` (04 sección 4).
--   7. `v_public_branding` (04 sección 7.2).
--   8. `v_people_basic` (04 sección 7.2, P-103).
--   9. `v_clients` (06_API.md sección 4).
--  10. `v_search` (06_API.md sección 3, PROPUESTO).
--
-- Este archivo TODAVÍA no otorga ningún permiso adicional (las políticas RLS de las tablas base
-- llegan recién en 0012_rls_policies.sql, DB-014): hasta que 0012 se aplique, cualquier consulta a
-- estas vistas desde `authenticated`/`anon` sigue devolviendo cero filas, exactamente igual que
-- consultar las tablas base hoy (nota de seguridad de 0003_profiles_roles_capabilities.sql). Las
-- vistas en sí (objetos del esquema `public`) quedan con el mismo ACL por defecto que las tablas
-- (select para `anon`/`authenticated`, verificado en `0003`): eso no es un problema porque el
-- `security_invoker` hace que la política real la sigan poniendo las tablas de abajo.

-- ---------------------------------------------------------------------------------------------
-- 0. app.today() (04 sección 5, auxiliar nuevo -- decisión menor, ver reporte de la tarea)
-- ---------------------------------------------------------------------------------------------

-- Fecha de "hoy" en la única zona del sistema (ADR-019). No está en la lista de la sección 5 del
-- modelo, pero varias columnas derivadas de este archivo la necesitan (licencia vigente de
-- v_employees, ventana de 7 días de v_my_day): en vez de repetir
-- `(now() at time zone 'America/Argentina/Buenos_Aires')::date` en cada vista, se centraliza acá,
-- mismo criterio que app.local_ts (0001) para la dirección opuesta (fecha+hora local -> instante
-- UTC). `stable`, no `immutable`: a diferencia de app.local_ts, esta función sí depende de
-- `now()`, así que su resultado cambia entre transacciones (aunque no dentro de una).
create function app.today()
returns date
language sql
stable
set search_path = public, app, pg_temp
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

comment on function app.today() is
  'Fecha de hoy en America/Argentina/Buenos_Aires (ADR-019). Auxiliar de 0011 (DB-013), usada por v_employees (licencia vigente) y v_my_day (ventana de 7 días); no es una de las funciones listadas en 04 sección 5, se agrega para no repetir la conversión de zona en cada vista.';

-- ---------------------------------------------------------------------------------------------
-- 1. v_employees (04 sección 4)
-- ---------------------------------------------------------------------------------------------

-- effective_status: 'on_leave' si existe una licencia vigente (starts_on <= hoy <=
-- coalesce(ends_on, hoy), deleted_at is null -- mismo criterio que el comentario de
-- employee_leaves en 0007), si no el status persistido. Es texto, no employee_status: 'on_leave'
-- no es un valor del enum (el modelo lo llama "derivado", 04 sección 3).
-- roles: arreglo de user_roles.role para ese profile_id (normalmente employee y/o supervisor,
-- P-013 exige fila en employees para esos roles, pero se agrega sin filtrar por rol para reflejar
-- exactamente "roles" tal cual pide la sección 4, por si alguna vez una persona con employees
-- también tiene owner/admin).
create view public.v_employees
with (security_invoker = true)
as
select
  e.profile_id,
  p.first_name,
  p.last_name,
  p.contact_email,
  p.phone,
  p.avatar_path,
  p.is_active as profile_is_active,
  e.employee_number,
  e.dni,
  e.cuil,
  e.address,
  e.birth_date,
  e.hire_date,
  e.emergency_contact_name,
  e.emergency_contact_phone,
  e.emergency_contact_relationship,
  e.status,
  case
    when leaves.employee_id is not null then 'on_leave'
    else e.status::text
  end as effective_status,
  e.terminated_at,
  e.notes,
  coalesce(roles.roles, array[]::public.app_role[]) as roles,
  e.created_at,
  e.updated_at,
  e.created_by,
  e.updated_by,
  e.deleted_at
from public.employees e
join public.profiles p on p.id = e.profile_id
left join lateral (
  select array_agg(ur.role order by ur.role) as roles
  from public.user_roles ur
  where ur.profile_id = e.profile_id
) roles on true
left join lateral (
  select el.employee_id
  from public.employee_leaves el
  where el.employee_id = e.profile_id
    and el.deleted_at is null
    and el.starts_on <= app.today()
    and (el.ends_on is null or el.ends_on >= app.today())
  limit 1
) leaves on true;

comment on view public.v_employees is
  'Listado y ficha de empleados con estado efectivo (04 sección 4). effective_status = on_leave si hay una licencia vigente hoy (Argentina), si no employees.status. roles = user_roles de la persona. security_invoker: la visibilidad de filas la deciden las políticas de employees/profiles (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 2. v_shifts_board (04 sección 4)
-- ---------------------------------------------------------------------------------------------

-- display_status (decisión menor sobre la fórmula exacta, documentada en el reporte de la
-- tarea): el modelo describe "uncovered" en prosa ("hora de inicio pasada y assigned_count <
-- required_staff, o alguna asignación en absence_notified sin reemplazo, y el turno no está
-- in_progress/completed/cancelled") sin dar el álgebra booleana exacta. Se implementa como:
--   uncovered = status not in ('in_progress','completed','cancelled')
--     and assigned_count < required_staff
--     and (now() > starts_at or hay alguna asignación vigente en absence_notified)
-- Es decir, se distribuye "assigned_count < required_staff" sobre las dos condiciones del "o"
-- (hora pasada / hay una ausencia avisada): un turno con cupo lleno nunca se marca "sin cubrir"
-- aunque haya una ausencia avisada (el admin ya cubrió el faltante con otra asignación, sin
-- quitar la que avisó ausencia, P-073), y una ausencia avisada antes del inicio ya alcanza para
-- marcarlo (no hace falta esperar a que pase la hora) si el cupo quedó corto.
-- upcoming = el turno todavía no arrancó (scheduled/assigned) y empieza dentro de las próximas 2
-- horas.
create view public.v_shifts_board
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
  sh.notes,
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
  sh.deleted_at
from public.shifts sh
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join lateral (
  select
    count(*) filter (where a.removed_at is null) as assigned_count,
    count(*) filter (where a.removed_at is null and a.status = 'present') as present_count,
    count(*) filter (where a.removed_at is null and a.status = 'finished') as finished_count,
    count(*) filter (where a.removed_at is null and a.status = 'absence_notified') as absent_count,
    count(*) filter (where a.removed_at is null and a.status = 'delay_notified') as delayed_count
  from public.assignments a
  where a.shift_id = sh.id
) counts on true
where sh.deleted_at is null;

comment on view public.v_shifts_board is
  'Planificación, asistencia de hoy y tablero (04 sección 4). display_status agrega los derivados uncovered/upcoming sobre shifts.status (fórmula exacta documentada en el comentario de arriba de esta migración -- decisión menor, el modelo no la da en álgebra booleana). security_invoker: visibilidad de filas por RLS de shifts/clients/sites (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 3. v_assignments_board (04 sección 4)
-- ---------------------------------------------------------------------------------------------

-- franja efectiva: coalesce(a.start_time/end_time, turno) para mostrar, y directamente
-- lower/upper de assignments."window" (ya calculada por app.sync_assignment_window, 0007) para
-- los instantes UTC -- evita recalcular con app.local_ts.
-- minutes_late / minutes_early_leave (P-076): decisión menor de simetría -- el modelo define
-- minutes_early_leave explícitamente (P-076: diferencia contra la hora prevista cuando el fin
-- registrado es anterior) pero no da la fórmula de minutes_late; se implementa análogo: minutos
-- entre el inicio previsto (lower(window)) y el check_in efectivo, solo si el check-in es
-- posterior (si llegó a horario o antes, 0/null). null cuando todavía no hay check_in/check_out.
-- no_record (P-071): estado expected/delay_notified con la hora de inicio efectiva ya pasada.
create view public.v_assignments_board
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
    when co.recorded_at is not null and co.recorded_at < upper(a."window")
      then round(extract(epoch from (upper(a."window") - co.recorded_at)) / 60)::int
    else null
  end as minutes_early_leave,
  case
    when a.status in ('expected', 'delay_notified') and now() > lower(a."window")
      then 'no_record'
    else a.status::text
  end as display_status,
  a.removed_at,
  a.removed_by,
  a.removed_reason,
  a.created_at,
  a.updated_at,
  a.created_by,
  a.updated_by
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out';

comment on view public.v_assignments_board is
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status agrega no_record (P-071); minutes_early_leave (P-076) y minutes_late (simetría, decisión menor) comparan contra la franja efectiva (assignments."window"). Incluye asignaciones quitadas (removed_at not null): la fila queda para historia (04 sección 2.3), el que consuma la vista filtra si las quiere. security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 4. v_my_day (04 sección 4, P-092, P-093)
-- ---------------------------------------------------------------------------------------------

-- Filtra a.employee_id = auth.uid(): es "mi" día, no el de compañeros (a diferencia de
-- v_assignments_board, de uso administrativo/general). Rango: hoy y los próximos 7 días
-- (P-093), asignaciones vigentes (removed_at is null) de turnos no cancelados.
-- changed_since_last_seen (P-092): "calculado por updated_at de asignaciones y turnos contra
-- profiles.last_seen_changes_at". Se usa coalesce(updated_at, created_at) porque updated_at nace
-- en null hasta la primera modificación (0003 sección 0: "updated_at timestamptz" sin default);
-- coalesce(last_seen_changes_at, '-infinity') para que, si la persona nunca abrió Hoy, se marque
-- todo como cambiado (decisión menor: no hay una última visita contra la cual comparar).
create view public.v_my_day
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.shift_id,
  sh.shift_date,
  (sh.shift_date = app.today()) as is_today,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions,
  si.building_hours,
  si.phone_restricted,
  si.photos_not_allowed,
  si.restrictions_notes,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  coalesce(tasks.tasks_total, 0) as tasks_total,
  coalesce(tasks.tasks_done, 0) as tasks_done,
  (
    greatest(coalesce(a.updated_at, a.created_at), coalesce(sh.updated_at, sh.created_at))
    > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
  ) as changed_since_last_seen
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join lateral (
  select
    count(*) as tasks_total,
    count(*) filter (where st.status = 'done') as tasks_done
  from public.shift_tasks st
  where st.shift_id = a.shift_id
) tasks on true
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.status <> 'cancelled'
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. changed_since_last_seen compara el último cambio de la asignación/turno contra profiles.last_seen_changes_at (P-092); is_today distingue el bloque "hoy en detalle" de la lista simple de próximos días (P-093). Filtra employee_id = auth.uid() en la definición (no solo por RLS): es la vista de "mi día", no la de compañeros. security_invoker: además queda sujeta a la RLS de assignments/shifts (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 5. v_supervisions_admin (04 sección 4, P-088)
-- ---------------------------------------------------------------------------------------------

create view public.v_supervisions_admin
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  sv.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  sv.status,
  sv.assigned_by,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(r.ratings_count, 0) as ratings_count,
  r.ratings_avg,
  sv.created_at,
  sv.updated_at
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = sv.supervisor_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select count(*) as ratings_count, avg(rt.score)::numeric(3, 2) as ratings_avg
  from public.ratings rt
  where rt.supervision_id = sv.id
) r on true;

comment on view public.v_supervisions_admin is
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088): turno, sede, cliente, supervisor, cantidad de calificaciones y promedio simple del turno (solo como dato de la fila; los promedios por empleado son módulo F). security_invoker: visibilidad de filas por RLS de supervisions/shifts/clients/sites/profiles (0012, DB-014) -- en la práctica solo O/A ven filas, ver esa migración.';

-- ---------------------------------------------------------------------------------------------
-- 6. v_my_supervisions (04 sección 4)
-- ---------------------------------------------------------------------------------------------

-- Filtra supervisor_id = auth.uid(): es "mis" supervisiones (mismo criterio que v_my_day).
-- assigned_employees: arreglo jsonb con los empleados asignados vigentes del turno (nombre y
-- estado), para la pantalla de detalle del supervisor sin una segunda consulta.
create view public.v_my_supervisions
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.status,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  sv.criteria_snapshot,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(emp.employees, '[]'::jsonb) as assigned_employees
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select jsonb_agg(
      jsonb_build_object(
        'employee_id', a.employee_id,
        'first_name', p2.first_name,
        'last_name', p2.last_name,
        'status', a.status
      )
      order by p2.last_name, p2.first_name
    ) as employees
  from public.assignments a
  join public.profiles p2 on p2.id = a.employee_id
  where a.shift_id = sv.shift_id
    and a.removed_at is null
) emp on true
where sv.supervisor_id = auth.uid();

comment on view public.v_my_supervisions is
  'Pantallas del supervisor: Hoy, próximos y historial (04 sección 4). Filtra supervisor_id = auth.uid() en la definición (es "mis" supervisiones). assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre y estado). security_invoker: además queda sujeta a la RLS de supervisions/shifts (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 7. v_public_branding (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

-- Solo las tres columnas que anon puede leer para el login (04 sección 7.2: "name, logo_path,
-- support_phone"). No expone location_consent_text (P-108, se usa autenticado) ni updated_by/
-- updated_at. La fila (id = 1) la crea el seed (DB-019/DB-020), no esta migración.
create view public.v_public_branding
with (security_invoker = true)
as
select cs.name, cs.logo_path, cs.support_phone
from public.company_settings cs
where cs.id = 1;

comment on view public.v_public_branding is
  'Marca pública para el login (04 sección 7.2): nombre, logo y teléfono de soporte. Única vía de anon hacia company_settings (0012, DB-014, agrega una política anon-only sobre esa tabla para que esta vista funcione bajo security_invoker; el resto de las columnas de company_settings quedan fuera de esta vista).';

-- ---------------------------------------------------------------------------------------------
-- 8. v_people_basic (04 sección 7.2, P-103)
-- ---------------------------------------------------------------------------------------------

-- Solo nombre y foto (04 sección 7.2: "solo columnas expuestas por la vista v_people_basic:
-- nombre, foto"). La vista en sí solo proyecta estas columnas; la visibilidad de FILAS (qué
-- personas puede ver cada rol) la deciden las políticas de profiles en 0012 -- ver ahí la nota
-- sobre el límite real de esta restricción "por columna" en Postgres (RLS es por fila, no por
-- columna): queda documentada como pregunta en el reporte de la tarea.
create view public.v_people_basic
with (security_invoker = true)
as
select p.id as profile_id, p.first_name, p.last_name, p.avatar_path
from public.profiles p;

comment on view public.v_people_basic is
  'Nombre y foto de una persona, para mostrar compañeros de turno y personal supervisado sin exponer el resto de profiles (04 sección 7.2, P-103). security_invoker: la RLS de profiles (0012, DB-014) decide qué filas (personas) ve cada rol; esta vista solo recorta columnas.';

-- ---------------------------------------------------------------------------------------------
-- 9. v_clients (06_API.md sección 4)
-- ---------------------------------------------------------------------------------------------

-- "conteo de sedes y servicios activos" (06 sección 4): sites_count cuenta las sedes vigentes
-- (deleted_at is null, sin filtrar por status -- activas e inactivas cuentan para el total de
-- "sedes" del cliente); active_services_count cuenta solo services.status = 'active' y vigentes.
create view public.v_clients
with (security_invoker = true)
as
select
  c.id,
  c.legal_name,
  c.trade_name,
  c.cuit,
  c.admin_address,
  c.latitude,
  c.longitude,
  c.status,
  c.notes,
  coalesce(s.sites_count, 0) as sites_count,
  coalesce(sv.active_services_count, 0) as active_services_count,
  c.created_at,
  c.updated_at,
  c.created_by,
  c.updated_by,
  c.deleted_at
from public.clients c
left join lateral (
  select count(*) as sites_count
  from public.sites st
  where st.client_id = c.id
    and st.deleted_at is null
) s on true
left join lateral (
  select count(*) as active_services_count
  from public.services se
  where se.client_id = c.id
    and se.status = 'active'
    and se.deleted_at is null
) sv on true;

comment on view public.v_clients is
  'Listado de clientes con conteo de sedes y servicios activos (06_API.md sección 4). sites_count: sedes vigentes (deleted_at is null), sin filtrar por estado activa/inactiva. security_invoker: visibilidad de filas por RLS de clients (0012, DB-014).';

-- ---------------------------------------------------------------------------------------------
-- 10. v_search (06_API.md sección 3, PROPUESTO)
-- ---------------------------------------------------------------------------------------------

-- PROPUESTO en 06_API.md ("Buscar (buscador global) | from('v_search') PROPUESTO | O, A |
-- Empleados, clientes y sedes por texto"): se implementa como una unión de tres subconsultas con
-- una forma común (kind, id, title, subtitle, search_text) para que el frontend arme una sola
-- lista mezclada. search_text: concatenación en minúsculas de los campos relevantes de cada tipo,
-- pensada para filtrar con `.ilike('search_text', '%termino%')` desde el cliente (06_API.md no
-- fija cómo se filtra el texto; queda anotado en el reporte de la tarea para ajustar en F9 con
-- EMP-012 si hace falta full-text search de verdad). No incluye baja lógica (deleted_at is null
-- en clients/sites; employees no se filtra por status ni deleted_at -- el buscador administrativo
-- también debería encontrar personal dado de baja, a diferencia de los listados operativos).
create view public.v_search
with (security_invoker = true)
as
select
  'employee'::text as kind,
  e.profile_id as id,
  (p.first_name || ' ' || p.last_name) as title,
  ('Legajo ' || e.employee_number::text) as subtitle,
  lower(p.first_name || ' ' || p.last_name || ' ' || e.employee_number::text || ' ' || e.dni) as search_text
from public.employees e
join public.profiles p on p.id = e.profile_id
union all
select
  'client'::text as kind,
  c.id,
  coalesce(c.trade_name, c.legal_name) as title,
  c.legal_name as subtitle,
  lower(c.legal_name || ' ' || coalesce(c.trade_name, '') || ' ' || coalesce(c.cuit, '')) as search_text
from public.clients c
where c.deleted_at is null
union all
select
  'site'::text as kind,
  si.id,
  si.name as title,
  cl.legal_name as subtitle,
  lower(si.name || ' ' || cl.legal_name || ' ' || coalesce(si.address, '')) as search_text
from public.sites si
join public.clients cl on cl.id = si.client_id
where si.deleted_at is null;

comment on view public.v_search is
  'Buscador global (06_API.md sección 3, PROPUESTO): empleados, clientes y sedes por texto, forma común (kind, id, title, subtitle, search_text) para una sola lista mezclada. Filtrado propuesto: .ilike(search_text, %termino%) desde el cliente. security_invoker: visibilidad de filas por RLS de employees/profiles/clients/sites (0012, DB-014) -- en la práctica solo O/A ven filas.';
