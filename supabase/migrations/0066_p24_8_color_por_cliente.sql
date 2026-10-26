-- 0066_p24_8_color_por_cliente.sql
-- P24.8 (decisión de Mike, maqueta opción B): el calendario de Planificación puede colorear los turnos
-- por cliente. La paleta fija de 12 colores vive en el frontend; la base guarda solo el índice 0..11.
--
--   1. clients.calendar_color smallint not null check (0..11).
--   2. Backfill determinístico de los clientes existentes: por created_at (desempate por id) se
--      reparte 0, 1, 2 ... 11, 0 ...
--   3. Trigger before insert: si el color viene null se asigna el índice menos usado entre todos los
--      clientes (activos, inactivos y dados de baja lógica) y, ante empate, el más bajo; así dos
--      clientes no comparten color mientras haya menos de 12. Un valor explícito se respeta.
--   4. Lo cambian el dueño y los administradores por el update directo que ya existe
--      (clients_write_admin, 0012/0030): no hace falta una RPC.
--   5. Se expone en v_shifts_board y v_assignments_board como client_calendar_color y en v_clients
--      como calendar_color (columna nueva al final, create or replace). Los grants no cambian.

-- ---------------------------------------------------------------------------------------------
-- 1. Columna y backfill
-- ---------------------------------------------------------------------------------------------

alter table public.clients add column calendar_color smallint;

update public.clients c
set calendar_color = ((r.rn - 1) % 12)::smallint
from (
  select id, row_number() over (order by created_at, id)::integer as rn
  from public.clients
) r
where r.id = c.id;

alter table public.clients
  alter column calendar_color set not null,
  add constraint clients_calendar_color_check check (calendar_color between 0 and 11);

comment on column public.clients.calendar_color is
  'Índice (0 a 11) del color del cliente en el calendario de Planificación (0066, P24.8). La paleta de 12 colores vive en el frontend. Se asigna solo al crear el cliente (el menos usado, ante empate el más bajo) y lo pueden cambiar el dueño y los administradores.';

-- ---------------------------------------------------------------------------------------------
-- 2. Asignación automática al crear
-- ---------------------------------------------------------------------------------------------

create function app.assign_client_calendar_color()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.calendar_color is null then
    -- Evita que dos altas simultáneas elijan el mismo índice.
    perform pg_advisory_xact_lock(hashtext('clients.calendar_color'));

    select g.i::smallint into new.calendar_color
    from generate_series(0, 11) as g(i)
    left join (
      select c.calendar_color as color, count(*) as n
      from public.clients c
      group by c.calendar_color
    ) u on u.color = g.i
    order by coalesce(u.n, 0), g.i
    limit 1;
  end if;
  return new;
end;
$$;

comment on function app.assign_client_calendar_color() is
  'Trigger before insert de clients (0066, P24.8): si calendar_color viene null, asigna el índice 0..11 menos usado entre todos los clientes y, ante empate, el más bajo. Un valor explícito se respeta.';

revoke execute on function app.assign_client_calendar_color() from public, anon, authenticated;

create trigger trg_assign_calendar_color
before insert on public.clients
for each row execute function app.assign_client_calendar_color();

-- ---------------------------------------------------------------------------------------------
-- 3. Vistas (columna nueva al final; opciones y grants no cambian)
-- ---------------------------------------------------------------------------------------------

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
  o.show_in_print as show_in_print,
  sh.requires_photos as requires_photos,
  cl.calendar_color as client_calendar_color
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

comment on column public.v_shifts_board.client_calendar_color is
  'Índice (0..11) del color del cliente en el calendario (0066, P24.8): copia de clients.calendar_color.';

create or replace view public.v_assignments_board
with (security_invoker = true)
as
SELECT a.id,
    a.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    a.employee_id,
    p.first_name AS employee_first_name,
    p.last_name AS employee_last_name,
    p.avatar_path AS employee_avatar_path,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
        CASE
            WHEN ((ci.recorded_at IS NOT NULL) AND (ci.recorded_at > lower(a."window"))) THEN (round((EXTRACT(epoch FROM (ci.recorded_at - lower(a."window"))) / (60)::numeric)))::integer
            ELSE NULL::integer
        END AS minutes_late,
        CASE
            WHEN (sh.open_ended AND (a.end_time IS NULL)) THEN NULL::integer
            WHEN ((co.recorded_at IS NOT NULL) AND (co.recorded_at < upper(a."window"))) THEN (round((EXTRACT(epoch FROM (upper(a."window") - co.recorded_at)) / (60)::numeric)))::integer
            ELSE NULL::integer
        END AS minutes_early_leave,
        CASE
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (notice.kind = 'on_the_way'::notice_kind) AND (ci.recorded_at IS NULL) AND (now() < upper(a."window")) AND (now() <= (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes())))) THEN 'on_the_way'::text
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (now() > lower(a."window")) AND (now() <= (lower(a."window") + make_interval(mins => app.late_grace_minutes())))) THEN 'late'::text
            WHEN ((a.status = ANY (ARRAY['expected'::assignment_status, 'delay_notified'::assignment_status])) AND (now() > lower(a."window"))) THEN 'no_record'::text
            WHEN ((a.status = 'present'::assignment_status) AND (a.removed_at IS NULL) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) THEN 'no_checkout'::text
            ELSE (a.status)::text
        END AS display_status,
    a.removed_at,
    a.removed_by,
    a.removed_reason,
    a.created_at,
    a.updated_at,
    a.created_by,
    a.updated_by,
    ci.source AS check_in_source,
    ci.recorded_by AS check_in_recorded_by,
    co.source AS check_out_source,
    co.recorded_by AS check_out_recorded_by,
    notice.kind AS last_notice_kind,
    notice.minutes_late AS last_notice_minutes_late,
    notice.reason_code AS last_notice_reason_code,
    notice.reason_text AS last_notice_reason_text,
    notice.reported_by AS last_notice_reported_by,
    notice.source AS last_notice_source,
    notice.created_at AS last_notice_at,
    notice.estimated_arrival_at AS last_notice_estimated_arrival_at,
        CASE
            WHEN (sh.open_ended AND (a.end_time IS NULL)) THEN NULL::integer
            ELSE app.minutes_between(lower(a."window"), upper(a."window"))
        END AS planned_minutes,
        CASE
            WHEN ((a.status = 'present'::assignment_status) AND (a.removed_at IS NULL) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) THEN 0
            ELSE app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window"))
        END AS worked_minutes,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
        CASE
            WHEN o.show_in_print THEN NULLIF(btrim(o.observation), ''::text)
            ELSE NULL::text
        END AS shift_observation,
    ci.id as check_in_record_id,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('attendance', ci.id) pos)::numeric(7,1) as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('attendance', co.id) pos)::numeric(7,1) as check_out_accuracy_m,
    co.outside_reason as check_out_outside_reason,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected,
    coalesce((ci.geo_status = 'outside' and ci.geo_override_at is null) or (co.geo_status = 'outside' and co.geo_override_at is null), false) as has_outside_geo,
    notice.has_certificate AS last_notice_has_certificate,
    cl.calendar_color AS client_calendar_color
   FROM ((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     LEFT JOIN shift_observations o ON ((o.shift_id = sh.id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT an.kind,
            an.minutes_late,
            an.reason_code,
            an.reason_text,
            an.reported_by,
            an.source,
            an.created_at,
            an.estimated_arrival_at,
            an.has_certificate
           FROM attendance_notices an
          WHERE (an.assignment_id = a.id) AND (an.voided_at IS NULL)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true));

comment on column public.v_assignments_board.client_calendar_color is
  'Índice (0..11) del color del cliente en el calendario (0066, P24.8): copia de clients.calendar_color.';

create or replace view public.v_clients
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
  c.deleted_at,
  c.photo_path,
  c.calendar_color
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

comment on column public.v_clients.calendar_color is
  'Índice (0..11) del color del cliente en el calendario de Planificación (0066, P24.8). Editable por el dueño y los administradores.';
