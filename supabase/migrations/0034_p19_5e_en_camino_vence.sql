-- P19.5e, corrección de los ajustes de la reunión (0033, P19.5a), a partir de la verificación P19.5d.
--
--   1. «En camino» vence (decisión de Mike, 7 oct 2026). Antes `display_status = 'on_the_way'`
--      prevalecía sobre `late` y `no_record` hasta el fin de la franja y podía tapar la alerta de
--      alguien que avisó y nunca llegó. Ahora vale mientras:
--        - no haya inicio registrado,
--        - la franja efectiva no haya terminado, y
--        - now() <= vencimiento del aviso, que es
--            con estimación (estimated_arrival_at): estimated_arrival_at + app.late_grace_minutes();
--            sin estimación: inicio efectivo + app.late_grace_minutes().
--      Vencido, la fila sigue la regla normal: `late` (hasta 15 minutos desde el inicio efectivo),
--      `no_record` (más de 15), o `expected`/`delay_notified` si todavía no llegó la hora de inicio.
--      El número 15 sigue viviendo solo en app.late_grace_minutes(). El instante exacto del
--      vencimiento todavía vale (<=), igual que el minuto 15 de «Llegada tarde».
--      `v_assignments_board`: mismas columnas, orden y tipos que 0033.
--   2. `v_my_day.on_the_way_expires_at` (columna nueva AL FINAL): vencimiento del último aviso si
--      es «en camino» (null en otro caso), para que el celular no muestre «llegás a las HH:MM»
--      con una hora vencida. La calcula la base con la misma constante.
--   3. `v_employee_ratings` legible con `service_role` (defecto 4 de P19.5d): la vista llamaba a
--      app.is_admin(), que service_role no puede ejecutar (sin usage sobre app) y que además le
--      habría devuelto cero filas. Nueva `app.employee_ratings_visible()` (security definer), como
--      en 0031: service_role ve todo, como en las tablas (la RLS no le aplica). Un authenticated no puede hacerse pasar
--      por él: el rol sale del JWT firmado.

-- ---------------------------------------------------------------------------------------------
-- 1. v_assignments_board
-- ---------------------------------------------------------------------------------------------

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
  app.minutes_between(lower(a."window"), upper(a."window")) as planned_minutes,
  app.minutes_between(ci.recorded_at, co.recorded_at) as worked_minutes
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
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
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status deriva (no se persiste), sobre expected/delay_notified sin inicio registrado y en este orden: on_the_way (último aviso en camino, franja sin terminar y now() <= vencimiento del aviso: hora estimada + app.late_grace_minutes(), o inicio efectivo + app.late_grace_minutes() si no indicó estimación; 0034), late («Llegada tarde»: pasó el inicio efectivo hace app.late_grace_minutes() = 15 minutos o menos, P19.5a) y no_record (más de esos minutos, P-071); en los demás casos es assignments.status. Un «en camino» vencido deja de tapar la alerta. minutes_late / minutes_early_leave (P-076) comparan contra la franja efectiva (assignments."window"). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027). last_notice_*: último aviso de la asignación (por created_at), null si nunca avisó; last_notice_estimated_arrival_at es la hora estimada de un aviso en camino (0033). planned_minutes: duración de la franja efectiva; worked_minutes: fin real menos inicio real (null si falta alguno), ambos redondeados al minuto (0033); el front muestra tilde si worked_minutes >= planned_minutes sin margen y advertencia si es menor o hubo salida anticipada. Incluye asignaciones quitadas (removed_at not null). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices.';

-- ---------------------------------------------------------------------------------------------
-- 2. v_my_day (una columna nueva al final)
-- ---------------------------------------------------------------------------------------------

create or replace view public.v_my_day
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
    (
      coalesce(a.updated_at, a.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (a.updated_at is null or a.updated_by is distinct from a.employee_id)
    )
    or
    (
      coalesce(sh.updated_at, sh.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (sh.updated_at is null or sh.updated_by is distinct from a.employee_id)
    )
  ) as changed_since_last_seen,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
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
    when notice.kind = 'on_the_way'
      then coalesce(notice.estimated_arrival_at, lower(a."window"))
           + make_interval(mins => app.late_grace_minutes())
    else null
  end as on_the_way_expires_at
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.v_clients_basic cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join lateral (
  select
    count(*) as tasks_total,
    count(*) filter (where st.status = 'done') as tasks_done
  from public.shift_tasks st
  where st.shift_id = a.shift_id
) tasks on true
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source,
         an.created_at, an.estimated_arrival_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028); límite conocido de 0028 sobre una sola pareja updated_at/updated_by por fila. is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_kind puede ser delay, absence u on_the_way (0033); last_notice_estimated_arrival_at (0033) es la hora estimada de llegada del último aviso en camino, para mostrar "Avisaste que vas en camino" y permitir corregirla con notify_on_the_way. on_the_way_expires_at (0034): si el último aviso es en camino, hora hasta la que sigue valiendo (la estimación, o el inicio efectivo si no hay, más app.late_grace_minutes()); pasada esa hora el aviso venció y la app no debe mostrar «llegás a las HH:MM»; null si el último aviso no es en camino. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices.';

-- ---------------------------------------------------------------------------------------------
-- 3. v_employee_ratings legible con service_role
-- ---------------------------------------------------------------------------------------------

-- Una vista security_invoker ejecuta app.is_admin() con el rol de quien consulta, y service_role no
-- tiene `usage` sobre el esquema app (hay que darle execute a cada función de app que use, ver
-- 0031, y además is_admin() llama a has_role() desde adentro y fallaría con "permission denied
-- for schema app"). Se resuelve como en 0031: una función `security definer` que decide la
-- visibilidad, ejecutable por authenticated y service_role, sin abrir el esquema.
create function app.employee_ratings_visible()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.is_admin() or auth.role() = 'service_role';
$$;

comment on function app.employee_ratings_visible() is
  'True si la sesión puede leer v_employee_ratings: dueño o administrador (P-084) o service_role (0034). security definer para que la vista, que corre con el rol de quien consulta, no necesite usage sobre el esquema app.';

revoke execute on function app.employee_ratings_visible() from public, anon;
grant execute on function app.employee_ratings_visible() to authenticated, service_role;

create or replace view public.v_employee_ratings
with (security_invoker = true)
as
select
  e.profile_id as employee_id,
  coalesce(r.ratings_count, 0)::integer as ratings_count,
  r.ratings_avg
from public.employees e
left join (
  select
    a.employee_id,
    count(*) as ratings_count,
    avg(rt.score)::numeric(3, 2) as ratings_avg
  from public.assignments a
  join public.ratings rt on rt.assignment_id = a.id
  group by a.employee_id
) r on r.employee_id = e.profile_id
where (select app.employee_ratings_visible());

comment on view public.v_employee_ratings is
  'Cantidad y promedio (1 a 5, dos decimales) de calificaciones por empleado (0033, P19.5a), para el listado de Empleados y la ficha. Una fila por cada empleado (ratings_count 0 y ratings_avg null si no tiene). Solo dueño y administradores ven filas (P-084); service_role ve todo, como en las tablas (0034). Cuenta todas las calificaciones de sus asignaciones, también las de asignaciones quitadas. security_invoker: además queda sujeta a la RLS de employees/assignments/ratings.';
