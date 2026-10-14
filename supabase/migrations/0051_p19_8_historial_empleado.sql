-- P19.8b, AJ4-06 (parte base de datos): historial propio del empleado, «Mis servicios anteriores».
--
-- v_my_day solo muestra hoy y los próximos 7 días. Esta vista expone lo que el empleado ya
-- trabajó, sin límite de antigüedad. Mismas columnas, mismo orden y mismos tipos que v_my_day
-- (definición vigente de 0047), para que el front reutilice el mismo mapeo de filas.
-- No toca v_my_day ni ninguna otra vista o RPC.
--
-- Índices: no hace falta uno nuevo. assignments_employee_id_shift_date_idx (employee_id,
-- shift_date), de 0007, sirve para filtrar por empleado y ordenar por fecha descendente sin
-- recorrer la tabla; shift_date está denormalizada en assignments (igual que sh.shift_date).

create or replace view public.v_my_history
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
  end as on_the_way_expires_at,
  (sh.open_ended and a.end_time is null) as effective_open_ended,
  (
    a.status = 'present'
    and sh.open_ended
    and a.end_time is null
    and sh.status <> 'cancelled'
    and now() >= upper(a."window")
  ) as no_checkout,
  sh.requires_photos,
  coalesce(media.photos_count, 0) as my_photos_count,
  coalesce(media.videos_count, 0) as my_videos_count
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
  select
    count(*) filter (where m.kind = 'photo') as photos_count,
    count(*) filter (where m.kind = 'video') as videos_count
  from public.shift_media m
  where m.assignment_id = a.id
    and m.uploaded_by = auth.uid()
    and m.confirmed_at is not null
    and m.removed_at is null
) media on true
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
  and sh.shift_date < app.today();

grant select on public.v_my_history to authenticated;

comment on view public.v_my_history is
  'Historial propio del empleado, pantalla «Mis servicios anteriores» (AJ4-06): asignaciones propias de días anteriores a hoy, sin límite de antigüedad. Mismas columnas que v_my_day (0047) para reutilizar el mapeo en el front; hoy y los días siguientes se siguen leyendo de v_my_day, por eso el filtro es sh.shift_date < app.today(). Excluye las asignaciones quitadas (removed_at) e incluye los turnos cancelados (shift_status = ''cancelled''). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de las tablas base. Paginación: el front ordena por shift_date desc, start_time desc (effective_start_time) y usa rango (.range) de a 20 filas; el índice assignments_employee_id_shift_date_idx cubre el filtro por empleado y el orden por fecha.';
