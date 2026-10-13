-- 0048 · P21.6b · v_shifts_board expone requires_photos (módulo H, H-07).
-- El tablero y la planificación necesitan saber si el turno exige fotos sin consultar `shifts` aparte.
-- Se recrea la vista con la definición de 0040 y la columna nueva al final (create or replace no permite
-- reordenar). Opciones y grants se conservan: security_invoker = true; los privilegios de la vista no cambian.

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
  sh.requires_photos as requires_photos
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
  'Planificación, asistencia de hoy y tablero (04 sección 4). display_status agrega los derivados uncovered/upcoming sobre shifts.status (fórmula en el comentario de 0011). open_ended (0037, AJ2-10): turno «A terminar». no_checkout_count (0037): asignaciones vigentes «Sin salida». notes y show_in_print (0040, AJ2-15): observación del turno y casilla de impresión, solo visibles para administración. requires_photos (0048, H-07): el turno exige evidencia fotográfica (copia de shifts.requires_photos). security_invoker: visibilidad de filas por RLS de shifts/clients/sites (0012, DB-014).';
