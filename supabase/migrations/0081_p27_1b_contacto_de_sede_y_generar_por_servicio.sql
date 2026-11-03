-- 0081_p27_1b_contacto_de_sede_y_generar_por_servicio.sql
-- P27.1b (OD-24, OD-27 y borrado de servicios solo del dueño).
--
-- OD-24: el contacto de la sede (sites.contact_name, sites.contact_phone) lo ven SOLO dueños y
-- administradores. Hasta ahora lo devolvían a empleado y coordinador (supervisor) las vistas del
-- celular y, además, ambos podían leerlo con un select directo a sites (política sites_select_shift_party).
--   1. Se recrean sin site_contact_name / site_contact_phone: v_my_day, v_my_history, v_my_supervisions,
--      v_supervisor_today y la función app.supervisor_today(). Las columnas de una vista no se pueden
--      quitar con create or replace: se hace drop + create con el mismo security_invoker y los mismos
--      grants (select a authenticated). Ninguna otra vista depende de ellas.
--   2. sites: se revoca el select de tabla a authenticated y se concede por columna TODAS menos
--      contact_name y contact_phone. Un grant de columna es por rol de base y no por rol de la app,
--      así que para dueños y administradores el contacto se lee por la vista admin-only
--      v_site_contacts (filtra app.is_admin()). La escritura no cambia (política sites_write_admin).
--      Consecuencia: select('*') sobre sites ya no está permitido para authenticated; hay que pedir
--      las columnas. Una columna nueva de sites necesita su grant explícito.
--
-- OD-27: generate_shifts(p_year, p_month, p_service_id default null). Con servicio genera solo los
-- turnos de ese servicio (desde su valid_from, con las mismas reglas); sin servicio, igual que antes.
--
-- Decisión de Mike (2 nov): delete_service (0044) solo el dueño. Se mueve la lógica a
-- app.delete_service_core y public.delete_service pasa a ser un envoltorio con require_role('owner').

-- ---------------------------------------------------------------------------------------------
-- 1. Vistas y función sin el contacto de la sede
-- ---------------------------------------------------------------------------------------------

drop view public.v_supervisor_today;
drop function app.supervisor_today();
drop view public.v_my_day;
drop view public.v_my_history;
drop view public.v_my_supervisions;

create view public.v_my_day
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
          WHERE ((an.assignment_id = a.id) AND (an.voided_at IS NULL))
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND ((sh.shift_date >= app.today()) AND (sh.shift_date <= (app.today() + 7))));

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028). is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_estimated_arrival_at (0033) y on_the_way_expires_at (0034): aviso «en camino» y hasta cuándo vale. effective_open_ended (0037, AJ2-10): la asignación es «A terminar» (turno abierto y sin fin propio): el celular muestra «A terminar» en vez de effective_end_time (23:59). no_checkout (0037): «Sin salida» (present, abierta, pasadas las 23:59 del día del turno); la salida ya no se puede fichar desde el celular (record_check_out da OPEN_SHIFT_DAY_ENDED) y la carga administración. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en photos_not_allowed. Suma (0052, B1) site_geofence_radius_m (radio vigente de la sede para el mini mapa, B-18), geofence_max_accuracy_m y la validación propia de cada fichaje (check_in_* / check_out_*: geo_status, geo_reason, distance_m, geofence_radius_m, geo_overridden, time_corrected), sin el motivo de la corrección (B-28). Desde 0081 (OD-24) ya no trae site_contact_name ni site_contact_phone: el contacto de la sede es solo de dueños y administradores.';

revoke all on public.v_my_day from public, anon, authenticated;
grant select on public.v_my_day to authenticated;

create view public.v_my_history
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
          WHERE ((an.assignment_id = a.id) AND (an.voided_at IS NULL))
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND (sh.shift_date < app.today()));

comment on view public.v_my_history is
  'Historial propio del empleado, pantalla «Mis servicios anteriores» (AJ4-06): asignaciones propias de días anteriores a hoy, sin límite de antigüedad. Mismas columnas que v_my_day (0047) para reutilizar el mapeo en el front; hoy y los días siguientes se siguen leyendo de v_my_day, por eso el filtro es sh.shift_date < app.today(). Excluye las asignaciones quitadas (removed_at) e incluye los turnos cancelados (shift_status = ''cancelled''). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de las tablas base. Paginación: el front ordena por shift_date desc, start_time desc (effective_start_time) y usa rango (.range) de a 20 filas; el índice assignments_employee_id_shift_date_idx cubre el filtro por empleado y el orden por fecha. Mismas columnas que v_my_day (incluidas las de validación y corrección de 0052, B-19), solo días anteriores. Desde 0081 (OD-24) ya no trae site_contact_name ni site_contact_phone: el contacto de la sede es solo de dueños y administradores.';

revoke all on public.v_my_history from public, anon, authenticated;
grant select on public.v_my_history to authenticated;

create view public.v_my_supervisions
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
    (co.geo_override_at IS NOT NULL) AS check_out_geo_overridden
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

comment on view public.v_my_supervisions is
  'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", 0029, SUP-03); el nombre sale de v_people_basic (0030, DEF-P03). site_* (0029, SUP-006). shift_open_ended (0037, AJ2-10): el turno es «A terminar»; la pantalla muestra «A terminar» en vez de end_time (23:59). security_invoker: además queda sujeta a la RLS de supervisions/shifts/clients/sites/assignments. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en site_photos_not_allowed. Suma (0052, B1) site_geofence_radius_m, geofence_max_accuracy_m y la validación de la supervisión (check_in_* / check_out_*: geo_status, geo_reason, distance_m, geofence_radius_m, geo_overridden) contra la sede supervisada (B-07). Desde 0081 (OD-24) ya no trae site_contact_name ni site_contact_phone: el contacto de la sede es solo de dueños y administradores.';

revoke all on public.v_my_supervisions from public, anon, authenticated;
grant select on public.v_my_supervisions to authenticated;

create function app.supervisor_today()
returns table (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  ends_at timestamptz,
  open_ended boolean,
  shift_status public.shift_status,
  display_state text,
  required_staff smallint,
  client_id uuid,
  client_legal_name text,
  client_trade_name text,
  site_id uuid,
  site_name text,
  site_address text,
  site_city text,
  site_latitude numeric,
  site_longitude numeric,
  priority_kind text,
  is_priority boolean,
  assigned_employees jsonb,
  supervisors jsonb,
  my_supervision_id uuid,
  my_supervision_status public.supervision_status,
  site_radius_m smallint,
  max_accuracy_m smallint,
  access_instructions text,
  building_hours text,
  restrictions_notes text,
  phone_restricted boolean,
  photos_not_allowed boolean
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    sh.id,
    sh.shift_date,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.ends_at,
    sh.open_ended,
    sh.status,
    case sh.status when 'in_progress' then 'in_progress' when 'completed' then 'finished' else 'pending' end,
    sh.required_staff,
    sh.client_id,
    cl.legal_name,
    cl.trade_name,
    sh.site_id,
    si.name,
    si.address,
    si.city,
    si.latitude::numeric,
    si.longitude::numeric,
    pr.kind,
    (pr.kind is not null),
    coalesce(emp.employees, '[]'::jsonb),
    coalesce(sup.supervisors, '[]'::jsonb),
    mine.id,
    mine.status,
    coalesce(si.geofence_radius_m, cs.geofence_radius_m),
    cs.geofence_max_accuracy_m,
    si.access_instructions,
    si.building_hours,
    si.restrictions_notes,
    si.phone_restricted,
    si.photos_not_allowed
  from public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  cross join public.company_settings cs
  left join lateral (
    select case
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = auth.uid() and sp.removed_at is null and sp.site_id = sh.site_id
      ) then 'site'
      when exists (
        select 1 from public.supervisor_priorities sp
        where sp.supervisor_id = auth.uid() and sp.removed_at is null and sp.client_id = sh.client_id
      ) then 'client'
    end as kind
  ) pr on true
  left join lateral (
    select jsonb_agg(
        jsonb_build_object(
          'assignment_id', a.id,
          'employee_id', a.employee_id,
          'first_name', p2.first_name,
          'last_name', p2.last_name,
          'status', a.status,
          'check_in_at', ci.recorded_at,
          'check_out_at', co.recorded_at
        )
        order by p2.last_name, p2.first_name
      ) as employees
    from public.assignments a
    join public.profiles p2 on p2.id = a.employee_id
    left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
    where a.shift_id = sh.id and a.removed_at is null
  ) emp on true
  left join lateral (
    select jsonb_agg(
        jsonb_build_object(
          'supervision_id', sv.id,
          'supervisor_id', sv.supervisor_id,
          'first_name', p3.first_name,
          'last_name', p3.last_name,
          'status', sv.status,
          'check_in_at', sci.recorded_at,
          'check_out_at', sco.recorded_at,
          'is_me', (sv.supervisor_id = auth.uid())
        )
        order by sci.recorded_at nulls last, sv.created_at
      ) as supervisors
    from public.supervisions sv
    join public.profiles p3 on p3.id = sv.supervisor_id
    left join public.supervision_attendance sci on sci.supervision_id = sv.id and sci.kind = 'check_in'
    left join public.supervision_attendance sco on sco.supervision_id = sv.id and sco.kind = 'check_out'
    where sv.shift_id = sh.id and sv.status <> 'cancelled'
  ) sup on true
  left join lateral (
    select sv.id, sv.status
    from public.supervisions sv
    where sv.shift_id = sh.id and sv.supervisor_id = auth.uid() and sv.status <> 'cancelled'
    order by (sv.status = 'in_progress') desc, sv.created_at desc
    limit 1
  ) mine on true
  where app.has_role('supervisor')
    and sh.deleted_at is null
    and sh.shift_date = app.today()
    and sh.status <> 'cancelled';
$$;

comment on function app.supervisor_today() is
  'Turnos de hoy de todos los clientes y sedes para el coordinador (0063, CJ-02, CJ-25). Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Interna: la lee v_supervisor_today. Desde 0064 trae site_radius_m y max_accuracy_m; desde 0065 los datos de la sede de SUP-04; desde 0068 phone_restricted y photos_not_allowed. Desde 0079 (OD-10), si el coordinador tiene varias supervisiones del turno, my_supervision_id / my_supervision_status son los de la abierta (in_progress) y, si no hay, los de la última no cancelada; supervisors las trae a todas. Desde 0081 (OD-24) ya no trae el contacto de la sede (site_contact_name, site_contact_phone).';

revoke execute on function app.supervisor_today() from public, anon;
grant execute on function app.supervisor_today() to authenticated, service_role;

create view public.v_supervisor_today
with (security_invoker = true)
as
select * from app.supervisor_today();

comment on view public.v_supervisor_today is
  'Pantalla Hoy del coordinador (SUP-02, SUP-03; 0063, CJ-02, CJ-04, CJ-25): todos los turnos de hoy no cancelados. priority_kind (site | client | null) / is_priority: la prioridad del coordinador (CJ-03, CJ-24). display_state: in_progress | pending | finished (según el estado del turno). assigned_employees: [{ assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at }]. supervisors: quién lo supervisa o ya lo supervisó, sin las canceladas: [{ supervision_id, supervisor_id, first_name, last_name, status, check_in_at, check_out_at, is_me }]. my_supervision_id / my_supervision_status: la supervisión propia no cancelada. site_radius_m (smallint) y max_accuracy_m (smallint), desde 0064: radio vigente de la sede (el propio o el general de la empresa) y precisión máxima aceptada del GPS, para el detalle del turno (SUP-03). Desde 0065: site_contact_name, site_contact_phone, access_instructions, building_hours y restrictions_notes (text, nulos si la sede no los cargó), los mismos datos de la sede que muestra SUP-04, para el detalle del turno (SUP-03); sin datos del cliente. Desde 0068: phone_restricted y photos_not_allowed (boolean, las marcas «sin celular» y «sin fotos» de la sede). Solo trae filas para el rol supervisor. Desde 0081 (OD-24) ya no trae site_contact_name ni site_contact_phone: el contacto de la sede es solo de dueños y administradores.';

revoke all on public.v_supervisor_today from public, anon, authenticated;
grant select on public.v_supervisor_today to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. sites: el contacto deja de ser legible por select directo para authenticated
-- ---------------------------------------------------------------------------------------------

revoke select on public.sites from authenticated;
grant select (
  id, client_id, name, address, city, latitude, longitude, access_instructions, building_hours,
  phone_restricted, photos_not_allowed, restrictions_notes, status, created_at, updated_at,
  created_by, updated_by, deleted_at, geofence_radius_m
) on public.sites to authenticated;

comment on column public.sites.contact_name is
  'Contacto de la sede (OD-24, 0081): solo dueños y administradores. authenticated no tiene select de esta columna: se lee por v_site_contacts. Escritura: política sites_write_admin.';
comment on column public.sites.contact_phone is
  'Teléfono del contacto de la sede (OD-24, 0081): solo dueños y administradores. authenticated no tiene select de esta columna: se lee por v_site_contacts. Escritura: política sites_write_admin.';

-- Corre con los permisos del dueño de la vista (sin security_invoker) porque authenticated no puede
-- leer las columnas; el filtro app.is_admin() es la única puerta y da cero filas a cualquier otro rol.
create view public.v_site_contacts
as
select
  s.id as site_id,
  s.client_id,
  s.contact_name,
  s.contact_phone
from public.sites s
where app.is_admin();

comment on view public.v_site_contacts is
  'Contacto de la sede para dueños y administradores (OD-24, 0081). Devuelve filas solo si la sesión tiene rol owner o admin; para empleado y coordinador queda vacía. Una fila por sede (también las dadas de baja).';

revoke all on public.v_site_contacts from public, anon, authenticated;
grant select on public.v_site_contacts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. generate_shifts con servicio opcional (OD-27)
-- ---------------------------------------------------------------------------------------------

drop function public.generate_shifts(int, int);

create function public.generate_shifts(p_year int, p_month int, p_service_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_from date;
  v_to date;
  v_rec record;
  v_fixed record;
  v_shift_id uuid;
  v_starts_at timestamptz;
  v_created int := 0;
  v_skipped int := 0;
  v_holidays_skipped int := 0;
  v_assigned int := 0;
  v_past_without_fixed int := 0;
  v_unassigned jsonb := '[]'::jsonb;
  v_code text;
  v_msg text;
begin
  perform app.require_capability('generate_shifts');

  if p_service_id is not null and not exists (
    select 1 from public.services s where s.id = p_service_id and s.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  v_from := make_date(p_year, p_month, 1);
  v_to := (v_from + interval '1 month - 1 day')::date;

  for v_rec in
    select
      s.id as service_id,
      s.client_id,
      s.site_id,
      s.start_time,
      s.end_time,
      s.open_ended,
      s.required_staff,
      s.works_on_holidays,
      s.requires_photos,
      d.shift_date,
      (h.holiday_date is not null) as is_holiday
    from public.services s
    join public.clients c on c.id = s.client_id and c.status = 'active'
    join public.sites st on st.id = s.site_id and st.client_id = s.client_id and st.status = 'active'
    cross join lateral (
      select gs::date as shift_date
      from generate_series(v_from, v_to, interval '1 day') as gs
      where extract(dow from gs)::smallint = any(s.weekdays)
        and app.date_matches_weeks_of_month(gs::date, s.weeks_of_month)
        and gs::date >= s.valid_from
        and (s.valid_to is null or gs::date <= s.valid_to)
    ) d
    left join public.holidays h on h.holiday_date = d.shift_date and h.deleted_at is null
    where s.status = 'active' and s.deleted_at is null
      and (p_service_id is null or s.id = p_service_id)
    order by s.id, d.shift_date
  loop
    if v_rec.is_holiday and not v_rec.works_on_holidays then
      v_holidays_skipped := v_holidays_skipped + 1;
      continue;
    end if;

    if exists (
      select 1 from public.shifts sh
      where sh.service_id = v_rec.service_id
        and sh.shift_date = v_rec.shift_date
        and sh.deleted_at is null
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.shifts (
      service_id, client_id, site_id, shift_date, start_time, end_time, open_ended,
      required_staff, status, generated, requires_photos, created_by
    ) values (
      v_rec.service_id, v_rec.client_id, v_rec.site_id, v_rec.shift_date,
      v_rec.start_time, v_rec.end_time, v_rec.open_ended, v_rec.required_staff, 'scheduled', true, v_rec.requires_photos, auth.uid()
    )
    returning id, starts_at into v_shift_id, v_starts_at;

    perform app.copy_checklist_to_shift(v_shift_id);

    v_created := v_created + 1;

    -- AJ2-17: empleados fijos. Solo en los turnos recién creados (nunca en uno que ya existía).
    -- Un turno que ya empezó no recibe fijos: asignar hacia atrás inventaría inasistencias.
    if exists (select 1 from public.service_fixed_employees f where f.service_id = v_rec.service_id) then
      if now() >= v_starts_at then
        v_past_without_fixed := v_past_without_fixed + 1;
      else
        for v_fixed in
          select f.employee_id,
                 (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = f.employee_id) as employee_name
          from public.service_fixed_employees f
          where f.service_id = v_rec.service_id
          order by f.created_at, f.employee_id
        loop
          begin
            perform app.assign_employee_core(v_shift_id, v_fixed.employee_id, null, null, true);
            v_assigned := v_assigned + 1;
          exception
            when sqlstate 'P0001' then
              get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text;
              v_unassigned := v_unassigned || jsonb_build_array(jsonb_build_object(
                'shift_id', v_shift_id,
                'shift_date', v_rec.shift_date,
                'service_id', v_rec.service_id,
                'employee_id', v_fixed.employee_id,
                'employee_name', v_fixed.employee_name,
                'code', v_code,
                'message', v_msg
              ));
          end;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'holidays_skipped', v_holidays_skipped,
    'assigned', v_assigned,
    'unassigned', v_unassigned,
    'past_without_fixed', v_past_without_fixed
  );
end;
$$;

comment on function public.generate_shifts(int, int, uuid) is
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta weekdays, weeks_of_month, valid_from / valid_to, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente. O, A + generate_shifts. Los turnos de un servicio «A terminar» nacen «A terminar» (0037). Cada turno recién creado asigna a los empleados fijos del servicio (0041, AJ2-17) con app.assign_employee_core en modo estricto: lo que no se puede asignar no frena la generación y se informa. Cada turno creado hereda services.requires_photos (0047, H-07). Desde 0081 (OD-27) el tercer parámetro p_service_id (default null) limita la generación a ese servicio, desde su valid_from y con las mismas reglas; sin él, el comportamiento es el de siempre. SERVICE_NOT_FOUND si p_service_id no existe o está borrado (un servicio pausado o fuera de vigencia no es error: genera 0). Devuelve {"created", "skipped", "holidays_skipped", "assigned", "unassigned" [{shift_id, shift_date, service_id, employee_id, employee_name, code, message}], "past_without_fixed"}.';

revoke execute on function public.generate_shifts(int, int, uuid) from public, anon;
grant execute on function public.generate_shifts(int, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. delete_service solo para el dueño
-- ---------------------------------------------------------------------------------------------

alter function public.delete_service(uuid) set schema app;
alter function app.delete_service(uuid) rename to delete_service_core;
revoke execute on function app.delete_service_core(uuid) from public, anon, authenticated;

create function public.delete_service(p_service_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner');
  return app.delete_service_core(p_service_id);
end;
$$;

comment on function app.delete_service_core(uuid) is
  'Cuerpo de public.delete_service (0044, 0045, 0047), movido a app en 0081. Interna: solo la llama el envoltorio, que ya exigió rol owner.';

comment on function public.delete_service(uuid) is
  'Elimina físicamente el servicio y todos sus turnos con lo que cuelga (0044, AJ3-01). Desde 0081 SOLO el dueño (owner): un administrador recibe FORBIDDEN. Es un envoltorio de app.delete_service_core, que conserva las validaciones y los códigos de siempre: SERVICE_NOT_FOUND, SERVICE_HAS_ATTENDANCE, SERVICE_HAS_SUPERVISIONS, SERVICE_HAS_MEDIA. Devuelve {"service_id", "shifts_deleted", "assignments_deleted"} (ver app.delete_service_core).';

revoke execute on function public.delete_service(uuid) from public, anon;
grant execute on function public.delete_service(uuid) to authenticated;
