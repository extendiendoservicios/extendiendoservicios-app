-- P19.6 B, decisión de Mike (9 oct 2026) sobre lo «a confirmar» de 0037: el tope de horas
-- (AJ2-09) NO rige para los supervisores, que pueden visitar fuera del horario del turno.
-- `v_supervisions_admin.worked_minutes` vuelve al criterio de 0033: fin real menos inicio real de
-- la supervisión (null si falta alguno). Lo demás de 0037 queda igual (planned_minutes null si el
-- turno es «A terminar», shift_open_ended al final). Mismas columnas, orden y tipos.

create or replace view public.v_supervisions_admin
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
  sv.updated_at,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.criteria_snapshot,
  coalesce(emp.assigned_employees_count, 0) as assigned_employees_count,
  case when sh.open_ended then null else app.minutes_between(sh.starts_at, sh.ends_at) end as planned_minutes,
  app.minutes_between(ci.recorded_at, co.recorded_at) as worked_minutes,
  sh.open_ended as shift_open_ended
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
) r on true
left join lateral (
  select count(*) as assigned_employees_count
  from public.assignments a
  where a.shift_id = sv.shift_id and a.removed_at is null
) emp on true;

comment on view public.v_supervisions_admin is
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). ratings_count/ratings_avg: cantidad y promedio simple del turno. start_time/end_time/starts_at/ends_at: franja del turno (0029, ADM-13). criteria_snapshot: criterios vigentes al iniciar (ADM-15). assigned_employees_count: empleados asignados vigentes del turno (0029). planned_minutes/worked_minutes (0033, P19.5a): duración de la franja y minutos entre el inicio y el fin reales de la supervisión (null si falta alguno), para las horas del supervisor en la pestaña Asistencia de su ficha (ADM-12). Sin tope de horas (0038: el tope de AJ2-09 rige solo para empleados). planned_minutes es null si el turno es «A terminar» y shift_open_ended lo avisa (0037; end_time = 23:59 no es una hora de fin). security_invoker: visibilidad de filas por RLS (0012) -- en la práctica solo O/A ven filas.';
