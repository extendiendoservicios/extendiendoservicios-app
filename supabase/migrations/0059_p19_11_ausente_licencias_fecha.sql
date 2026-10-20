-- 0059 (P19.11a): observaciones de la reunión del 19 oct 2026 con los dueños.
--
-- Decisiones de Mike:
--   1. «Ausente» cargado por administración, con o sin certificado. El motivo es opcional cuando
--      lo carga administración; el empleado sigue obligado a dar motivo desde la app.
--      attendance_notices.has_certificate, notify_absence(p_has_certificate) y la columna
--      last_notice_has_certificate en v_assignments_board, v_my_day y v_my_history.
--   2. Las licencias bloquean: un empleado de licencia no se puede asignar a un turno del período
--      en ningún camino (assign_employee, create_shift, create_shift_series, generate_shifts).
--      app.assign_employee_core da ON_LEAVE siempre como error. get_leave_conflicts lista los
--      turnos que ya tenía asignados dentro de un período de licencia (para avisar al guardarla).
--   3. Editar la fecha de un turno que no empezó: update_shift_time(p_date) y
--      get_shift_date_warnings (advertencias previas HOLIDAY / OUTSIDE_AVAILABILITY).

-- ---------------------------------------------------------------------------------------------
-- 1. Ausente con certificado
-- ---------------------------------------------------------------------------------------------

alter table public.attendance_notices
  add column has_certificate boolean;

comment on column public.attendance_notices.has_certificate is
  'Ausencia con certificado (true) o sin certificado (false). Solo se carga cuando la ausencia la registra administración (source = admin, 0059, P19.11a); null en las demás filas.';

alter table public.attendance_notices
  add constraint attendance_notices_has_certificate_check
  check (kind = 'absence' or has_certificate is null);

-- El motivo sigue siendo obligatorio para el empleado (source = employee_app); administración
-- puede cargar la ausencia sin motivo. La regla de reason_text (other) no cambia.
alter table public.attendance_notices
  drop constraint attendance_notices_reason_code_check;

alter table public.attendance_notices
  add constraint attendance_notices_reason_code_check
  check (kind <> 'absence' or source <> 'employee_app' or reason_code is not null);

comment on table public.attendance_notices is
  'Avisos de demora y ausencia (04 sección 2.3, P-072, P-073, P-074). Varios por asignación (primero demora, después ausencia); el estado de la asignación refleja el último. minutes_late obligatorio (1..600) si kind = delay; reason_code obligatorio si kind = absence y source = employee_app (administración puede omitirlo, 0059); reason_text obligatorio si reason_code = other; has_certificate solo en ausencias (0059). Una ausencia avisada no libera el cupo (P-073): lo decide el administrador.';

-- notify_absence: parámetro nuevo al final y p_reason_code opcional (administración).
drop function public.notify_absence(uuid, public.absence_reason, text);

create function public.notify_absence(
  p_assignment_id uuid,
  p_reason_code public.absence_reason default null,
  p_reason_text text default null,
  p_has_certificate boolean default null
)
returns public.attendance_notices
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_source public.attendance_source;
  v_on_behalf boolean;
  v_notice public.attendance_notices;
begin
  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if app.is_admin() then
    if not app.has_capability('manage_attendance') then
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
    v_source := 'admin';
    v_on_behalf := true;
  elsif app.has_role('employee') then
    if v_assignment.employee_id <> auth.uid() then
      raise exception using
        errcode = 'P0001',
        message = 'Esa asignación no es tuya.',
        hint = 'NOT_YOUR_ASSIGNMENT';
    end if;
    v_source := 'employee_app';
    v_on_behalf := false;
  else
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

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

  -- present/finished: ya hay un check_in registrado -- ni el propio empleado ni el administrador
  -- pueden avisar una ausencia a esta altura (04 sección 6.2 no tiene esa transición).
  if v_assignment.status in ('present', 'finished') then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
  end if;

  if v_assignment.status = 'absence_notified' then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  -- P-073: antes del inicio efectivo para el propio empleado. Decisión de Mike del 26 sep 2026
  -- (P14.0): dueño y administrador con manage_attendance también pueden avisar después del inicio
  -- efectivo, mientras la asignación no tenga inicio registrado (ver 0027).
  if not v_on_behalf and now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint = 'TOO_LATE_TO_NOTIFY';
  end if;

  -- Desde 0059 (P19.11a): el motivo es obligatorio solo para el empleado; administración puede
  -- omitirlo, pero tiene que indicar si la ausencia es con o sin certificado.
  if not v_on_behalf and p_reason_code is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo de la ausencia.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_reason_code = 'other' and nullif(btrim(p_reason_text), '') is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo de la ausencia.',
      hint = 'REASON_REQUIRED';
  end if;

  if v_on_behalf and p_has_certificate is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si la ausencia es con certificado o sin certificado.',
      hint = 'CERTIFICATE_REQUIRED';
  end if;

  insert into public.attendance_notices (
    assignment_id, kind, reason_code, reason_text, has_certificate, reported_by, source
  )
  values (
    p_assignment_id, 'absence', p_reason_code, nullif(btrim(p_reason_text), ''),
    case when v_on_behalf then p_has_certificate else null end,
    auth.uid(), v_source
  )
  returning * into v_notice;

  -- La asignación queda absence_notified; el cupo NO se libera (P-073), el administrador decide.
  update public.assignments
  set status = 'absence_notified', updated_by = auth.uid()
  where id = p_assignment_id;

  return v_notice;
end;
$$;

comment on function public.notify_absence(uuid, public.absence_reason, text, boolean) is
  'Aviso de ausencia (04 sección 6.2; 06 sección 11; P-073, P-074). E (propia, solo antes del inicio efectivo; el motivo es obligatorio y p_has_certificate se ignora); O, A + manage_attendance (en nombre, antes o después del inicio efectivo mientras la asignación no tenga inicio registrado -- ratificado el 26 sep 2026, P14.0; desde 0059, P19.11a, el motivo es opcional y es obligatorio indicar p_has_certificate: con certificado true, sin certificado false). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, FORBIDDEN (supervisor, o admin sin manage_attendance), SHIFT_CANCELLED/SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya present/finished), TOO_LATE_TO_NOTIFY (solo para el propio empleado, después del inicio, o si ya avisó una ausencia), REASON_REQUIRED (motivo obligatorio para el empleado; si es other, también el texto), CERTIFICATE_REQUIRED (administración sin indicar el certificado). Asignación -> absence_notified; el cupo no se libera solo.';

revoke execute on function public.notify_absence(uuid, public.absence_reason, text, boolean) from public, anon;
grant execute on function public.notify_absence(uuid, public.absence_reason, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Vistas: last_notice_has_certificate (columna nueva al final)
-- ---------------------------------------------------------------------------------------------

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
    notice.has_certificate AS last_notice_has_certificate
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
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true));

create or replace view public.v_my_day
with (security_invoker = true)
as
SELECT a.id AS assignment_id,
    a.shift_id,
    sh.shift_date,
    (sh.shift_date = app.today()) AS is_today,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    cl.trade_name AS client_trade_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
    si.contact_name AS site_contact_name,
    si.contact_phone AS site_contact_phone,
    si.access_instructions,
    si.building_hours,
    si.phone_restricted,
    si.photos_not_allowed,
    si.restrictions_notes,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    COALESCE(tasks.tasks_total, (0)::bigint) AS tasks_total,
    COALESCE(tasks.tasks_done, (0)::bigint) AS tasks_done,
    (((COALESCE(a.updated_at, a.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((a.updated_at IS NULL) OR (a.updated_by IS DISTINCT FROM a.employee_id))) OR ((COALESCE(sh.updated_at, sh.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((sh.updated_at IS NULL) OR (sh.updated_by IS DISTINCT FROM a.employee_id)))) AS changed_since_last_seen,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
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
            WHEN (notice.kind = 'on_the_way'::notice_kind) THEN (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes()))
            ELSE NULL::timestamp with time zone
        END AS on_the_way_expires_at,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
    ((a.status = 'present'::assignment_status) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) AS no_checkout,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    coalesce(si.geofence_radius_m, (select cs.geofence_radius_m from public.company_settings cs where cs.id = 1)) as site_geofence_radius_m,
    (select cs.geofence_max_accuracy_m from public.company_settings cs where cs.id = 1) as geofence_max_accuracy_m,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected,
    notice.has_certificate AS last_notice_has_certificate
   FROM (((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     JOIN v_clients_basic cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS tasks_total,
            count(*) FILTER (WHERE (st.status = 'done'::task_status)) AS tasks_done
           FROM shift_tasks st
          WHERE (st.shift_id = a.shift_id)) tasks ON (true))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.assignment_id = a.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
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
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND ((sh.shift_date >= app.today()) AND (sh.shift_date <= (app.today() + 7))));

create or replace view public.v_my_history
with (security_invoker = true)
as
SELECT a.id AS assignment_id,
    a.shift_id,
    sh.shift_date,
    (sh.shift_date = app.today()) AS is_today,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    cl.trade_name AS client_trade_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
    si.contact_name AS site_contact_name,
    si.contact_phone AS site_contact_phone,
    si.access_instructions,
    si.building_hours,
    si.phone_restricted,
    si.photos_not_allowed,
    si.restrictions_notes,
    COALESCE(a.start_time, sh.start_time) AS effective_start_time,
    COALESCE(a.end_time, sh.end_time) AS effective_end_time,
    lower(a."window") AS effective_starts_at,
    upper(a."window") AS effective_ends_at,
    a.status,
    sh.status AS shift_status,
    a.notes,
    COALESCE(tasks.tasks_total, (0)::bigint) AS tasks_total,
    COALESCE(tasks.tasks_done, (0)::bigint) AS tasks_done,
    (((COALESCE(a.updated_at, a.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((a.updated_at IS NULL) OR (a.updated_by IS DISTINCT FROM a.employee_id))) OR ((COALESCE(sh.updated_at, sh.created_at) > COALESCE(p.last_seen_changes_at, '-infinity'::timestamp with time zone)) AND ((sh.updated_at IS NULL) OR (sh.updated_by IS DISTINCT FROM a.employee_id)))) AS changed_since_last_seen,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
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
            WHEN (notice.kind = 'on_the_way'::notice_kind) THEN (COALESCE(notice.estimated_arrival_at, lower(a."window")) + make_interval(mins => app.late_grace_minutes()))
            ELSE NULL::timestamp with time zone
        END AS on_the_way_expires_at,
    (sh.open_ended AND (a.end_time IS NULL)) AS effective_open_ended,
    ((a.status = 'present'::assignment_status) AND sh.open_ended AND (a.end_time IS NULL) AND (sh.status <> 'cancelled'::shift_status) AND (now() >= upper(a."window"))) AS no_checkout,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    coalesce(si.geofence_radius_m, (select cs.geofence_radius_m from public.company_settings cs where cs.id = 1)) as site_geofence_radius_m,
    (select cs.geofence_max_accuracy_m from public.company_settings cs where cs.id = 1) as geofence_max_accuracy_m,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    (ci.time_corrected_at is not null) as check_in_time_corrected,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    (co.time_corrected_at is not null) as check_out_time_corrected,
    notice.has_certificate AS last_notice_has_certificate
   FROM (((((((((assignments a
     JOIN shifts sh ON ((sh.id = a.shift_id)))
     JOIN v_clients_basic cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = a.employee_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS tasks_total,
            count(*) FILTER (WHERE (st.status = 'done'::task_status)) AS tasks_done
           FROM shift_tasks st
          WHERE (st.shift_id = a.shift_id)) tasks ON (true))
     LEFT JOIN attendance_records ci ON (((ci.assignment_id = a.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN attendance_records co ON (((co.assignment_id = a.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.assignment_id = a.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
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
          WHERE (an.assignment_id = a.id)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND (sh.shift_date < app.today()));

comment on column public.v_assignments_board.last_notice_has_certificate is
  'Último aviso de la asignación: true/false si fue una ausencia cargada por administración con o sin certificado (0059, P19.11a); null en los demás casos.';
comment on column public.v_my_day.last_notice_has_certificate is
  'Último aviso de la asignación: true/false si fue una ausencia cargada por administración con o sin certificado (0059, P19.11a); null en los demás casos.';
comment on column public.v_my_history.last_notice_has_certificate is
  'Último aviso de la asignación: true/false si fue una ausencia cargada por administración con o sin certificado (0059, P19.11a); null en los demás casos.';

-- ---------------------------------------------------------------------------------------------
-- 3. Licencias bloquean: app.assign_employee_core
-- ---------------------------------------------------------------------------------------------

create or replace function app.assign_employee_core(
  p_shift_id uuid,
  p_employee_id uuid,
  p_start time default null,
  p_end time default null,
  p_strict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_employee public.employees;
  v_assignment public.assignments;
  v_assigned_count int;
  v_warnings text[] := array[]::text[];
  v_has_permissions boolean;
  v_has_availability boolean;
begin
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

  if now() >= v_shift.starts_at and not app.has_capability('manage_attendance') then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya empezó.',
      hint = 'SHIFT_STARTED';
  end if;

  select * into v_employee from public.employees where profile_id = p_employee_id and deleted_at is null;

  if v_employee.profile_id is null or v_employee.status <> 'active' then
    raise exception using
      errcode = 'P0001',
      message = 'Ese empleado no está activo.',
      hint = 'EMPLOYEE_NOT_ACTIVE';
  end if;

  if p_start is not null and p_end is not null and p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if (p_start is not null and (p_start < v_shift.start_time or p_start >= v_shift.end_time))
    or (p_end is not null and (p_end > v_shift.end_time or p_end <= v_shift.start_time))
  then
    raise exception using
      errcode = 'P0001',
      message = 'La franja de la asignación tiene que estar dentro de la del turno.',
      hint = 'ASSIGNMENT_TIME_OUT_OF_SHIFT';
  end if;

  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = p_employee_id and a.removed_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese empleado ya está asignado a este turno.',
      hint = 'ALREADY_ASSIGNED';
  end if;

  select count(*) into v_assigned_count
  from public.assignments a
  where a.shift_id = p_shift_id and a.removed_at is null;

  if v_assigned_count >= v_shift.required_staff then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya tiene la dotación completa.',
      hint = 'SHIFT_FULL';
  end if;

  -- Advertencias (P-033, P-034, P-035). Se calculan antes de insertar (solo dependen de los
  -- datos de entrada) para que el modo estricto pueda rechazar sin dejar la asignación creada.
  select exists (
    select 1 from public.employee_client_permissions ecp where ecp.employee_id = p_employee_id
  ) into v_has_permissions;

  if v_has_permissions and not exists (
    select 1 from public.employee_client_permissions ecp
    where ecp.employee_id = p_employee_id and ecp.client_id = v_shift.client_id
  ) then
    v_warnings := array_append(v_warnings, 'NOT_ENABLED_FOR_CLIENT');
  end if;

  select exists (
    select 1 from public.employee_availability ea where ea.employee_id = p_employee_id
  ) into v_has_availability;

  if v_has_availability and not exists (
    select 1 from public.employee_availability ea
    where ea.employee_id = p_employee_id
      and ea.weekday = extract(dow from v_shift.shift_date)::smallint
      and ea.start_time <= coalesce(p_start, v_shift.start_time)
      and ea.end_time >= coalesce(p_end, v_shift.end_time)
  ) then
    v_warnings := array_append(v_warnings, 'OUTSIDE_AVAILABILITY');
  end if;

  -- Licencia (P-033): desde 0059 (P19.11a) bloquea siempre, en cualquier camino (asignación
  -- manual, alta de turno, repetición y asignación de fijos). Ya no es una advertencia.
  if exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p_employee_id
      and el.deleted_at is null
      and el.starts_on <= v_shift.shift_date
      and (el.ends_on is null or el.ends_on >= v_shift.shift_date)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'El empleado está de licencia ese día.',
      hint = 'ON_LEAVE';
  end if;

  -- Modo estricto (asignación automática de los fijos): la falta de disponibilidad bloquea,
  -- porque nadie está mirando la advertencia.
  if p_strict and 'OUTSIDE_AVAILABILITY' = any(v_warnings) then
    raise exception using
      errcode = 'P0001',
      message = 'El empleado no está disponible ese día en ese horario.',
      hint = 'OUTSIDE_AVAILABILITY';
  end if;

  begin
    insert into public.assignments (shift_id, employee_id, start_time, end_time, created_by)
    values (p_shift_id, p_employee_id, p_start, p_end, auth.uid())
    returning * into v_assignment;
  exception
    when exclusion_violation then
      raise exception using
        errcode = 'P0001',
        message = 'El empleado ya tiene otro turno en ese horario.',
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  -- Transición scheduled -> assigned (04 sección 6.1): si esta asignación completa la dotación.
  update public.shifts
  set status = 'assigned'
  where id = p_shift_id
    and status = 'scheduled'
    and (v_assigned_count + 1) >= required_staff;

  select * into v_assignment from public.assignments where id = v_assignment.id;

  return jsonb_build_object('assignment', to_jsonb(v_assignment), 'warnings', v_warnings);
end;
$$;

comment on function app.assign_employee_core(uuid, uuid, time, time, boolean) is
  'Cuerpo de public.assign_employee (0024) sin el control de rol: lo llaman assign_employee, create_shift y generate_shifts, que ya validaron quién es el que llama. Mismas validaciones y errores que assign_employee. p_strict = true (asignación automática) convierte ON_LEAVE y OUTSIDE_AVAILABILITY en error con ese mismo hint.';

comment on function app.assign_employee_core(uuid, uuid, time, time, boolean) is
  'Cuerpo de public.assign_employee (0024) sin el control de rol: lo llaman assign_employee, create_shift y generate_shifts, que ya validaron quién es el que llama. Mismas validaciones y errores que assign_employee. ON_LEAVE (licencia vigente en la fecha del turno) es siempre un error desde 0059 (P19.11a). p_strict = true (asignación automática) convierte además OUTSIDE_AVAILABILITY en error con ese mismo hint; NOT_ENABLED_FOR_CLIENT y OUTSIDE_AVAILABILITY (fuera del modo estricto) siguen siendo advertencias.';

comment on function public.assign_employee(uuid, uuid, time, time) is
  'Asigna un empleado a un turno (04 sección 9, 06 sección 8). O, A (después del inicio del turno: + manage_attendance, SHIFT_STARTED si falta). SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, EMPLOYEE_NOT_ACTIVE, ALREADY_ASSIGNED, SHIFT_FULL, ASSIGNMENT_OVERLAP (exclusión), ON_LEAVE (licencia vigente ese día: error desde 0059, P19.11a), INVALID_TIME_RANGE/ASSIGNMENT_TIME_OUT_OF_SHIFT para la franja propia (P-046). Devuelve {"assignment": <fila>, "warnings": [...]} con NOT_ENABLED_FOR_CLIENT (P-034) y OUTSIDE_AVAILABILITY (P-035) -- ninguna bloquea. Si completa la dotación, el turno pasa a assigned.';

-- ---------------------------------------------------------------------------------------------
-- 4. get_leave_conflicts(p_employee_id, p_starts_on, p_ends_on): turnos ya asignados dentro
--    de un período de licencia
-- ---------------------------------------------------------------------------------------------

-- Las licencias se guardan por escritura directa en employee_leaves (no por RPC), así que los
-- conflictos no se pueden devolver al guardar: la pantalla llama a esta función después de
-- guardar. No desasigna nada.
create function public.get_leave_conflicts(
  p_employee_id uuid,
  p_starts_on date,
  p_ends_on date default null
)
returns table (
  assignment_id uuid,
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  open_ended boolean,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  shift_status public.shift_status
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
begin
  perform app.require_role('owner', 'admin');

  if p_employee_id is null or p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception using
      errcode = 'P0001',
      message = 'El período de la licencia no es válido.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  return query
  select a.id,
         sh.id,
         sh.shift_date,
         coalesce(a.start_time, sh.start_time),
         coalesce(a.end_time, sh.end_time),
         (sh.open_ended and a.end_time is null),
         sh.client_id,
         cl.legal_name,
         sh.site_id,
         si.name,
         sh.status
  from public.assignments a
  join public.shifts sh on sh.id = a.shift_id and sh.deleted_at is null
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  where a.employee_id = p_employee_id
    and a.removed_at is null
    and sh.status not in ('cancelled', 'completed')
    and sh.shift_date >= app.today()
    and sh.shift_date >= p_starts_on
    and (p_ends_on is null or sh.shift_date <= p_ends_on)
  order by sh.shift_date, coalesce(a.start_time, sh.start_time), sh.id;
end;
$$;

comment on function public.get_leave_conflicts(uuid, date, date) is
  'Turnos que un empleado ya tiene asignados dentro de un período de licencia (0059, P19.11a). O, A. p_ends_on null = licencia abierta. Devuelve las asignaciones vigentes de turnos no cancelados ni finalizados, desde hoy (hora de Argentina), con fecha, horario efectivo, cliente, sede y estado del turno. No desasigna nada: la pantalla avisa y lista después de guardar la licencia. INVALID_DATE_RANGE si p_ends_on < p_starts_on.';

revoke execute on function public.get_leave_conflicts(uuid, date, date) from public, anon;
grant execute on function public.get_leave_conflicts(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Editar la fecha del turno: update_shift_time(p_date) y get_shift_date_warnings
-- ---------------------------------------------------------------------------------------------

-- Cambiar la fecha solo se puede si el turno no empezó: estado scheduled/assigned y ningún
-- fichaje en sus asignaciones (SHIFT_STARTED). Para cada asignado vigente se revalida la nueva
-- fecha: licencia (ON_LEAVE, error) y superposición (ASSIGNMENT_OVERLAP, error). La ventana de
-- fichaje de cada asignación, shift_date y las vistas del día (v_my_day, tablero, supervisiones)
-- derivan de shifts.shift_date: el trigger de 0007 recalcula assignments.shift_date/"window" y
-- starts_at/ends_at son columnas generadas; supervisiones y tareas cuelgan de shift_id.
drop function public.update_shift_time(uuid, time, time, boolean);

create function public.update_shift_time(
  p_shift_id uuid,
  p_start time,
  p_end time,
  p_open_ended boolean default false,
  p_date date default null
)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_names text;
  v_open boolean := coalesce(p_open_ended, false);
  v_end time;
  v_new_date date;
  v_date_changed boolean;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  v_new_date := coalesce(p_date, v_shift.shift_date);
  v_date_changed := v_new_date <> v_shift.shift_date;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if v_shift.status = 'completed'
    and (v_date_changed
      or not (v_shift.open_ended and not v_open and p_start is not distinct from v_shift.start_time))
  then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno ya terminó.',
      hint = 'SHIFT_COMPLETED';
  end if;

  v_end := case when v_open then time '23:59' else p_end end;

  if v_end is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if v_shift.status = 'in_progress' and p_start is distinct from v_shift.start_time then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  if v_date_changed then
    -- Solo si el turno no empezó: estado que permite editar y ningún fichaje (ni siquiera de
    -- una asignación que después se quitó).
    if v_shift.status not in ('scheduled', 'assigned')
      or exists (
        select 1
        from public.attendance_records ar
        join public.assignments a on a.id = ar.assignment_id
        where a.shift_id = p_shift_id
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'El turno ya empezó: no se puede cambiar la fecha.',
        hint = 'SHIFT_STARTED';
    end if;

    if v_shift.service_id is not null and exists (
      select 1 from public.shifts o
      where o.service_id = v_shift.service_id
        and o.shift_date = v_new_date
        and o.deleted_at is null
        and o.id <> p_shift_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'Ese servicio ya tiene un turno en esa fecha.',
        hint = 'SHIFT_DATE_TAKEN';
    end if;

    -- Licencia en la nueva fecha: bloquea (decisión del 19 oct 2026), igual que al asignar.
    select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
    into v_names
    from public.assignments a
    join public.profiles p on p.id = a.employee_id
    where a.shift_id = p_shift_id
      and a.removed_at is null
      and exists (
        select 1 from public.employee_leaves el
        where el.employee_id = a.employee_id
          and el.deleted_at is null
          and el.starts_on <= v_new_date
          and (el.ends_on is null or el.ends_on >= v_new_date)
      );

    if v_names is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Hay empleados de licencia en la nueva fecha: ' || v_names || '.',
        hint = 'ON_LEAVE';
    end if;
  end if;

  begin
    update public.shifts
    set shift_date = v_new_date, start_time = p_start, end_time = v_end, open_ended = v_open,
        updated_by = auth.uid()
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      -- La actualización ya se deshizo (subtransacción del bloque): v_shift conserva el turno
      -- anterior; la fecha que importa es la pedida (v_new_date).
      select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
      into v_names
      from public.assignments a
      join public.profiles p on p.id = a.employee_id
      where a.shift_id = p_shift_id
        and a.removed_at is null
        and exists (
          select 1
          from public.assignments b
          where b.employee_id = a.employee_id
            and b.id <> a.id
            and b.removed_at is null
            and b."window" && tstzrange(
              app.local_ts(v_new_date, coalesce(a.start_time, p_start)),
              app.local_ts(v_new_date, coalesce(a.end_time, v_end)),
              '[)'
            )
        );

      raise exception using
        errcode = 'P0001',
        message = case
          when v_names is null then 'El empleado ya tiene otro turno en ese horario.'
          else 'El empleado ya tiene otro turno en ese horario. Afecta a: ' || v_names || '.'
        end,
        hint = 'ASSIGNMENT_OVERLAP';
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese servicio ya tiene un turno en esa fecha.',
        hint = 'SHIFT_DATE_TAKEN';
  end;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time, boolean, date) is
  'Cambia la franja y, desde 0059 (P19.11a), la fecha de un turno (04 sección 6.1, 9; 06 sección 7). O, A. p_date null = misma fecha. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula shift_date y la ventana de las asignaciones; si eso las deja superpuestas se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP nombrando a quien queda superpuesto (0030). Fija updated_by = auth.uid() (0028). Desde 0037 (AJ2-10): p_open_ended = true deja el turno «A terminar» (p_end se ignora, end_time = 23:59); un turno «A terminar» ya finalizado admite ponerle la hora de fin (mismo inicio, misma fecha) y las horas se recalculan con el tope de AJ2-09. Cambiar la fecha solo se puede si el turno no empezó: SHIFT_STARTED si el estado no es scheduled/assigned o algún fichaje cuelga de sus asignaciones; ON_LEAVE (error) si algún asignado vigente está de licencia en la nueva fecha; ASSIGNMENT_OVERLAP en la nueva fecha; SHIFT_DATE_TAKEN si el servicio ya tiene otro turno vigente ese día. Las advertencias (HOLIDAY, OUTSIDE_AVAILABILITY) las da get_shift_date_warnings.';

revoke execute on function public.update_shift_time(uuid, time, time, boolean, date) from public, anon;
grant execute on function public.update_shift_time(uuid, time, time, boolean, date) to authenticated;

-- Advertencias previas a cambiar la fecha (solo lectura): HOLIDAY (feriado en la nueva fecha) y
-- OUTSIDE_AVAILABILITY (algún asignado vigente tiene disponibilidad declarada que no cubre la
-- nueva fecha y horario). No cubre los errores (ON_LEAVE, ASSIGNMENT_OVERLAP): esos los da
-- update_shift_time.
create function public.get_shift_date_warnings(
  p_shift_id uuid,
  p_date date,
  p_start time default null,
  p_end time default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_warnings text[] := array[]::text[];
  v_outside jsonb;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la fecha.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  if exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    v_warnings := array_append(v_warnings, 'HOLIDAY');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', x.employee_id,
           'employee_name', x.employee_name
         ) order by x.employee_name), '[]'::jsonb)
  into v_outside
  from (
    select a.employee_id, btrim(p.first_name || ' ' || p.last_name) as employee_name
    from public.assignments a
    join public.profiles p on p.id = a.employee_id
    where a.shift_id = p_shift_id
      and a.removed_at is null
      and exists (select 1 from public.employee_availability ea where ea.employee_id = a.employee_id)
      and not exists (
        select 1 from public.employee_availability ea
        where ea.employee_id = a.employee_id
          and ea.weekday = extract(dow from p_date)::smallint
          and ea.start_time <= coalesce(a.start_time, p_start, v_shift.start_time)
          and ea.end_time >= coalesce(a.end_time, p_end, v_shift.end_time)
      )
  ) x;

  if jsonb_array_length(v_outside) > 0 then
    v_warnings := array_append(v_warnings, 'OUTSIDE_AVAILABILITY');
  end if;

  return jsonb_build_object('warnings', to_jsonb(v_warnings), 'outside_availability', v_outside);
end;
$$;

comment on function public.get_shift_date_warnings(uuid, date, time, time) is
  'Advertencias de mover un turno a otra fecha (0059, P19.11a), solo lectura. O, A. Devuelve {"warnings": ["HOLIDAY", "OUTSIDE_AVAILABILITY"], "outside_availability": [{employee_id, employee_name}]}. HOLIDAY: feriado vigente en p_date. OUTSIDE_AVAILABILITY: algún asignado vigente tiene disponibilidad declarada que no cubre ese día y horario (p_start/p_end opcionales: si no, los del turno; la franja propia de la asignación manda). Los errores (ON_LEAVE, ASSIGNMENT_OVERLAP, SHIFT_STARTED) los da update_shift_time.';

revoke execute on function public.get_shift_date_warnings(uuid, date, time, time) from public, anon;
grant execute on function public.get_shift_date_warnings(uuid, date, time, time) to authenticated;
