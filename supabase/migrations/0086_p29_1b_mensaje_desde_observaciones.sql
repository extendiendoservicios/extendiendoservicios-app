-- 0086_p29_1b_mensaje_desde_observaciones.sql
-- P29.1b: corrige OG-05 de 0085. El «Mensaje de la oficina» (shift_notes) leía public.shifts.notes,
-- que está en desuso desde 0040 (AJ2-15) y queda siempre null: la observación del turno vive en
-- public.shift_observations (la escriben create_shift_core y update_shift_details; la lee el panel).
--
-- shift_observations tiene RLS de select solo para administración (0040), a propósito: el empleado y
-- el coordinador no la leen por tabla. Como las vistas son security_invoker, un join directo les
-- devolvería siempre null. En vez de abrir la tabla, se usa una función auxiliar security definer
-- que devuelve la observación de UN turno solo si quien llama (auth.uid()) está asignado al turno
-- (asignación vigente) o lo supervisa. Así el empleado y el coordinador ven la observación de sus
-- propios turnos y de ningún otro, y shift_observations (incluida show_in_print) sigue cerrada.
--
-- Las vistas v_my_day, v_my_history y v_my_supervisions conservan columnas, orden y tipos de 0085;
-- shift_notes sigue al final (create or replace). changed_since_last_seen no cambia: update_shift_details
-- siempre actualiza shifts (trigger set_updated_at), así que editar la observación lo enciende.

create or replace function app.shift_office_message(p_shift_id uuid)
returns text
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select nullif(btrim(o.observation), '')
  from public.shift_observations o
  where o.shift_id = p_shift_id
    and (
      exists (
        select 1 from public.assignments a
        where a.shift_id = p_shift_id and a.employee_id = auth.uid() and a.removed_at is null
      )
      or exists (
        select 1 from public.supervisions sv
        where sv.shift_id = p_shift_id and sv.supervisor_id = auth.uid()
      )
    );
$$;

comment on function app.shift_office_message(uuid) is
  'Mensaje de la oficina (0086, OG-05): observación del turno (shift_observations.observation, sin espacios de los bordes, null si está vacía) solo si auth.uid() está asignado al turno (asignación vigente) o lo supervisa; para cualquier otra persona devuelve null. security definer porque shift_observations solo la lee administración.';

revoke all on function app.shift_office_message(uuid) from public, anon, authenticated;
grant execute on function app.shift_office_message(uuid) to authenticated;
-- service_role también la necesita: las vistas son security_invoker y la consulta de todas las vistas con
-- service_role (0050) las ejecuta con ese rol. Sin sesión (auth.uid() null) devuelve null.
grant execute on function app.shift_office_message(uuid) to service_role;

-- Columna nueva al final; el resto de la definición es la de 0081 sin cambios. El empleado solo
-- ve filas de sus propias asignaciones (where a.employee_id = auth.uid()) y el coordinador solo
-- las de sus supervisiones (sv.supervisor_id = auth.uid()). security_invoker y grants igual que antes.
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
    COALESCE(si.geofence_radius_m, ( SELECT cs.geofence_radius_m
           FROM company_settings cs
          WHERE (cs.id = 1))) AS site_geofence_radius_m,
    ( SELECT cs.geofence_max_accuracy_m
           FROM company_settings cs
          WHERE (cs.id = 1)) AS geofence_max_accuracy_m,
    ci.geo_status AS check_in_geo_status,
    ci.geo_unvalidated_reason AS check_in_geo_reason,
    ci.site_distance_m AS check_in_distance_m,
    ci.geofence_radius_m AS check_in_geofence_radius_m,
    (ci.geo_override_at IS NOT NULL) AS check_in_geo_overridden,
    (ci.time_corrected_at IS NOT NULL) AS check_in_time_corrected,
    co.geo_status AS check_out_geo_status,
    co.geo_unvalidated_reason AS check_out_geo_reason,
    co.site_distance_m AS check_out_distance_m,
    co.geofence_radius_m AS check_out_geofence_radius_m,
    (co.geo_override_at IS NOT NULL) AS check_out_geo_overridden,
    (co.time_corrected_at IS NOT NULL) AS check_out_time_corrected,
    notice.has_certificate AS last_notice_has_certificate,
    app.shift_office_message(sh.id) AS shift_notes
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
          WHERE ((an.assignment_id = a.id) AND (an.voided_at IS NULL))
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND ((sh.shift_date >= app.today()) AND (sh.shift_date <= (app.today() + 7))));

comment on column public.v_my_day.shift_notes is
  'Observación del turno (shift_observations.observation, vía app.shift_office_message) que cargan la dirección o la administración, para mostrar como «Mensaje de la oficina» (OG-05; 0086 corrige 0085, que leía shifts.notes). Null si está vacía. Solo de los turnos donde la persona está asignada. Editar la observación mueve shifts.updated_at (update_shift_details) y enciende changed_since_last_seen (P-092).';

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
    COALESCE(si.geofence_radius_m, ( SELECT cs.geofence_radius_m
           FROM company_settings cs
          WHERE (cs.id = 1))) AS site_geofence_radius_m,
    ( SELECT cs.geofence_max_accuracy_m
           FROM company_settings cs
          WHERE (cs.id = 1)) AS geofence_max_accuracy_m,
    ci.geo_status AS check_in_geo_status,
    ci.geo_unvalidated_reason AS check_in_geo_reason,
    ci.site_distance_m AS check_in_distance_m,
    ci.geofence_radius_m AS check_in_geofence_radius_m,
    (ci.geo_override_at IS NOT NULL) AS check_in_geo_overridden,
    (ci.time_corrected_at IS NOT NULL) AS check_in_time_corrected,
    co.geo_status AS check_out_geo_status,
    co.geo_unvalidated_reason AS check_out_geo_reason,
    co.site_distance_m AS check_out_distance_m,
    co.geofence_radius_m AS check_out_geofence_radius_m,
    (co.geo_override_at IS NOT NULL) AS check_out_geo_overridden,
    (co.time_corrected_at IS NOT NULL) AS check_out_time_corrected,
    notice.has_certificate AS last_notice_has_certificate,
    app.shift_office_message(sh.id) AS shift_notes
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
          WHERE ((an.assignment_id = a.id) AND (an.voided_at IS NULL))
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND (sh.shift_date < app.today()));

comment on column public.v_my_history.shift_notes is
  'Observación del turno (shift_observations.observation), igual que en v_my_day (0086, OG-05). Null si está vacía.';

create or replace view public.v_my_supervisions
with (security_invoker = true)
as
 SELECT sv.id,
    sv.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    si.address AS site_address,
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
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    COALESCE(emp.employees, '[]'::jsonb) AS assigned_employees,
    si.city AS site_city,
    si.latitude AS site_latitude,
    si.longitude AS site_longitude,
    si.access_instructions AS site_access_instructions,
    si.building_hours AS site_building_hours,
    si.phone_restricted AS site_phone_restricted,
    si.photos_not_allowed AS site_photos_not_allowed,
    si.restrictions_notes AS site_restrictions_notes,
    sh.open_ended AS shift_open_ended,
    sh.requires_photos,
    COALESCE(media.photos_count, (0)::bigint) AS my_photos_count,
    COALESCE(media.videos_count, (0)::bigint) AS my_videos_count,
    COALESCE(si.geofence_radius_m, ( SELECT cs.geofence_radius_m
           FROM company_settings cs
          WHERE (cs.id = 1))) AS site_geofence_radius_m,
    ( SELECT cs.geofence_max_accuracy_m
           FROM company_settings cs
          WHERE (cs.id = 1)) AS geofence_max_accuracy_m,
    ci.geo_status AS check_in_geo_status,
    ci.geo_unvalidated_reason AS check_in_geo_reason,
    ci.site_distance_m AS check_in_distance_m,
    ci.geofence_radius_m AS check_in_geofence_radius_m,
    (ci.geo_override_at IS NOT NULL) AS check_in_geo_overridden,
    co.geo_status AS check_out_geo_status,
    co.geo_unvalidated_reason AS check_out_geo_reason,
    co.site_distance_m AS check_out_distance_m,
    co.geofence_radius_m AS check_out_geofence_radius_m,
    (co.geo_override_at IS NOT NULL) AS check_out_geo_overridden,
    app.shift_office_message(sh.id) AS shift_notes
   FROM (((((((supervisions sv
     JOIN shifts sh ON ((sh.id = sv.shift_id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     LEFT JOIN supervision_attendance ci ON (((ci.supervision_id = sv.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN supervision_attendance co ON (((co.supervision_id = sv.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE (m.kind = 'photo'::media_kind)) AS photos_count,
            count(*) FILTER (WHERE (m.kind = 'video'::media_kind)) AS videos_count
           FROM shift_media m
          WHERE ((m.supervision_id = sv.id) AND (m.uploaded_by = auth.uid()) AND (m.confirmed_at IS NOT NULL) AND (m.removed_at IS NULL))) media ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'first_name', p2.first_name, 'last_name', p2.last_name, 'status', a.status, 'check_in_at', ar.recorded_at) ORDER BY p2.last_name, p2.first_name) AS employees
           FROM ((assignments a
             JOIN v_people_basic p2 ON ((p2.profile_id = a.employee_id)))
             LEFT JOIN attendance_records ar ON (((ar.assignment_id = a.id) AND (ar.kind = 'check_in'::attendance_kind))))
          WHERE ((a.shift_id = sv.shift_id) AND (a.removed_at IS NULL))) emp ON (true))
  WHERE (sv.supervisor_id = auth.uid());

comment on column public.v_my_supervisions.shift_notes is
  'Observación del turno (shift_observations.observation) para el coordinador que lo supervisa (0086, OG-05, propuesto). Null si está vacía. Solo de los turnos que supervisa.';
-- create or replace conserva los grants y los comentarios de vista; se reafirman por claridad.
revoke all on public.v_my_day from public, anon, authenticated;
grant select on public.v_my_day to authenticated;
revoke all on public.v_my_history from public, anon, authenticated;
grant select on public.v_my_history to authenticated;
revoke all on public.v_my_supervisions from public, anon, authenticated;
grant select on public.v_my_supervisions to authenticated;
