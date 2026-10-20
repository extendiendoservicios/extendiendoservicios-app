-- 0060 (P19.11c): ajustes a la 0059 tras la reunión del 20 oct 2026 (decisiones de Mike).
--
--   1. No se puede mover un turno al pasado: update_shift_time(p_date) da SHIFT_DATE_IN_PAST si
--      la fecha nueva es anterior a hoy (America/Argentina/Buenos_Aires). Mover a hoy se permite.
--   2. Al mover un turno de día se limpian los avisos: attendance_notices.voided_at / voided_by /
--      void_reason anulan los avisos (quedan como historial) y las asignaciones con demora o
--      ausencia avisada vuelven a «esperado». Las vistas toman solo avisos con voided_at null.
--   3. set_absence_certificate(p_assignment_id, p_has_certificate): marcar o corregir después el
--      certificado de una ausencia ya avisada (por el empleado o por administración).
--      attendance_notices.updated_at / updated_by registran quién y cuándo.
--   4. «Supervisor» pasa a «coordinador» en los mensajes que ve el usuario (solo el texto: los
--      códigos, los hints y el valor del rol siguen igual).

-- ---------------------------------------------------------------------------------------------
-- 1. attendance_notices: anulación de avisos y traza de cambios
-- ---------------------------------------------------------------------------------------------

alter table public.attendance_notices
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.profiles (id),
  add column if not exists void_reason text,
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.profiles (id);

comment on column public.attendance_notices.voided_at is
  'Instante en que el aviso dejó de valer (0060, P19.11c). Hoy solo por mover el turno de día (void_reason = SHIFT_DATE_CHANGED). El aviso no se borra: queda como historial. Las vistas v_assignments_board, v_my_day y v_my_history toman como «último aviso» solo los que tienen voided_at null.';
comment on column public.attendance_notices.voided_by is
  'Quién anuló el aviso (auth.uid() de quien movió el turno).';
comment on column public.attendance_notices.void_reason is
  'Motivo de la anulación: SHIFT_DATE_CHANGED (se movió el turno de día).';
comment on column public.attendance_notices.updated_at is
  'Último cambio del aviso (trigger app.set_updated_at); null si nunca se modificó. Lo fijan set_absence_certificate y la anulación por cambio de fecha (0060).';
comment on column public.attendance_notices.updated_by is
  'Quién hizo el último cambio (set_absence_certificate, update_shift_time).';

drop trigger if exists trg_set_updated_at on public.attendance_notices;
create trigger trg_set_updated_at
before update on public.attendance_notices
for each row execute function app.set_updated_at();

comment on table public.attendance_notices is
  'Avisos de demora, «en camino» y ausencia (04 sección 2.3, P-072, P-073, P-074). Varios por asignación (primero demora, después ausencia); el estado de la asignación refleja el último aviso vigente. minutes_late obligatorio (1..600) si kind = delay; reason_code obligatorio si kind = absence y source = employee_app (administración puede omitirlo, 0059); reason_text obligatorio si reason_code = other; has_certificate solo en ausencias (0059; se puede marcar o corregir después con set_absence_certificate, 0060). Una ausencia avisada no libera el cupo (P-073): lo decide el administrador. Un aviso anulado (voided_at, 0060: se movió el turno de día) queda como historial y no cuenta en las vistas.';

-- ---------------------------------------------------------------------------------------------
-- 2. Vistas: el último aviso es el último aviso no anulado (mismas columnas que en 0059)
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
          WHERE (an.assignment_id = a.id) AND (an.voided_at IS NULL)
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
          WHERE (an.assignment_id = a.id) AND (an.voided_at IS NULL)
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
          WHERE (an.assignment_id = a.id) AND (an.voided_at IS NULL)
          ORDER BY an.created_at DESC
         LIMIT 1) notice ON (true))
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL) AND (sh.shift_date < app.today()));


-- ---------------------------------------------------------------------------------------------
-- 3. update_shift_time: no mover al pasado y limpiar los avisos al mover de día
-- ---------------------------------------------------------------------------------------------

create or replace function public.update_shift_time(
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

    -- Decisión de Mike del 20 oct 2026: no se mueve un turno al pasado. Hoy sí (la hora no se
    -- valida: si ya pasó, las asignaciones quedan con la ventana vencida y el tablero las muestra
    -- como «Llegada tarde» / «Sin registro» igual que con un turno de hoy cuya hora se edita).
    if v_new_date < app.today() then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede mover el turno a una fecha que ya pasó.',
        hint = 'SHIFT_DATE_IN_PAST';
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

  -- Al mover de día los avisos dejan de valer (decisión del 20 oct 2026): cada aviso de las
  -- asignaciones del turno se anula (voided_at; queda como historial, nada se borra) y las
  -- asignaciones con demora o ausencia avisada vuelven a «esperado» (assigned en la UI). Las vistas
  -- toman solo avisos con voided_at is null. Como el turno no tiene fichajes (SHIFT_STARTED), la
  -- asignación solo puede estar en expected, delay_notified o absence_notified.
  if v_date_changed then
    update public.attendance_notices an
    set voided_at = now(), voided_by = auth.uid(), void_reason = 'SHIFT_DATE_CHANGED'
    from public.assignments a
    where a.id = an.assignment_id
      and a.shift_id = p_shift_id
      and an.voided_at is null;

    update public.assignments
    set status = 'expected', updated_by = auth.uid()
    where shift_id = p_shift_id
      and removed_at is null
      and status in ('delay_notified', 'absence_notified');
  end if;

  return v_shift;
end;
$$;


comment on function public.update_shift_time(uuid, time, time, boolean, date) is
  'Cambia la franja y, desde 0059 (P19.11a), la fecha de un turno (04 sección 6.1, 9; 06 sección 7). O, A. p_date null = misma fecha. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula shift_date y la ventana de las asignaciones; si eso las deja superpuestas se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP nombrando a quien queda superpuesto (0030). Fija updated_by = auth.uid() (0028). Desde 0037 (AJ2-10): p_open_ended = true deja el turno «A terminar» (p_end se ignora, end_time = 23:59); un turno «A terminar» ya finalizado admite ponerle la hora de fin (mismo inicio, misma fecha) y las horas se recalculan con el tope de AJ2-09. Cambiar la fecha solo se puede si el turno no empezó: SHIFT_STARTED si el estado no es scheduled/assigned o algún fichaje cuelga de sus asignaciones; SHIFT_DATE_IN_PAST (0060) si la fecha nueva es anterior a hoy (hoy sí se permite); ON_LEAVE (error) si algún asignado vigente está de licencia en la nueva fecha; ASSIGNMENT_OVERLAP en la nueva fecha; SHIFT_DATE_TAKEN si el servicio ya tiene otro turno vigente ese día. Al cambiar la fecha (0060) se anulan los avisos de sus asignaciones (attendance_notices.voided_at; quedan como historial) y las asignaciones con demora o ausencia avisada vuelven a expected. Las advertencias (HOLIDAY, OUTSIDE_AVAILABILITY) las da get_shift_date_warnings.';

revoke execute on function public.update_shift_time(uuid, time, time, boolean, date) from public, anon;
grant execute on function public.update_shift_time(uuid, time, time, boolean, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. set_absence_certificate: marcar o corregir el certificado de una ausencia ya avisada
-- ---------------------------------------------------------------------------------------------

create function public.set_absence_certificate(
  p_assignment_id uuid,
  p_has_certificate boolean
)
returns public.attendance_notices
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_notice public.attendance_notices;
begin
  -- Mismo criterio que la ausencia cargada por administración en notify_absence: O, A con
  -- manage_attendance.
  if not app.is_admin() or not app.has_capability('manage_attendance') then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if p_has_certificate is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si la ausencia es con certificado o sin certificado.',
      hint = 'CERTIFICATE_REQUIRED';
  end if;

  -- Último aviso de ausencia vigente (no anulado) de una asignación que sigue con la ausencia
  -- avisada. Sin ventana horaria: se puede marcar días después.
  select an.* into v_notice
  from public.attendance_notices an
  where an.assignment_id = p_assignment_id
    and an.kind = 'absence'
    and an.voided_at is null
  order by an.created_at desc
  limit 1
  for update;

  if v_notice.id is null or v_assignment.status <> 'absence_notified' then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no tiene una ausencia avisada.',
      hint = 'NO_ABSENCE';
  end if;

  update public.attendance_notices
  set has_certificate = p_has_certificate, updated_by = auth.uid()
  where id = v_notice.id
  returning * into v_notice;

  return v_notice;
end;
$$;

comment on function public.set_absence_certificate(uuid, boolean) is
  'Marca o corrige si la ausencia ya avisada es con certificado (true) o sin certificado (false) (0060, P19.11c). O, A + manage_attendance. Actualiza el último aviso de ausencia vigente (voided_at null) de la asignación, sea de source = employee_app o admin; sin ventana horaria. Registra quién y cuándo en attendance_notices.updated_by / updated_at. FORBIDDEN, ASSIGNMENT_NOT_FOUND (no existe o está quitada), CERTIFICATE_REQUIRED (p_has_certificate null), NO_ABSENCE (la asignación no tiene una ausencia avisada vigente). Devuelve el aviso actualizado.';

revoke execute on function public.set_absence_certificate(uuid, boolean) from public, anon;
grant execute on function public.set_absence_certificate(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. «Supervisor» -> «coordinador» en los mensajes (solo el texto; los hints no cambian).
--    Definiciones vigentes de las tres funciones, con la única diferencia del texto del mensaje.
--    Los permisos y los comentarios de cada función se conservan (create or replace).
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_supervision(p_shift_id uuid, p_supervisor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_shift public.shifts;
  v_supervision public.supervisions;
  v_warnings text[] := array[]::text[];
begin
  perform app.require_capability('manage_supervisions');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null for update;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status not in ('scheduled', 'assigned', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no admite asignar una supervisión en su estado actual.',
      hint = 'SHIFT_NOT_SUPERVISABLE';
  end if;

  -- Supervisor con rol vigente (user_roles, no el JWT del que llama) y activo: perfil sin
  -- desactivar/dar de baja, y fila de employees activa y sin baja lógica (04 sección 2.1: los
  -- roles employee/supervisor exigen fila en employees).
  if not exists (
    select 1
    from public.profiles p
    join public.employees e on e.profile_id = p.id
    join public.user_roles ur on ur.profile_id = p.id and ur.role = 'supervisor'
    where p.id = p_supervisor_id
      and p.is_active
      and p.deleted_at is null
      and e.status = 'active'
      and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese coordinador no tiene el rol vigente o no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  begin
    insert into public.supervisions (shift_id, supervisor_id, assigned_by, created_by)
    values (p_shift_id, p_supervisor_id, auth.uid(), auth.uid())
    returning * into v_supervision;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese coordinador ya tiene una supervisión asignada a este turno.',
        hint = 'ALREADY_ASSIGNED';
  end;

  -- Advertencia (no bloquea, CONFIRMADO 27 sep 2026 P15.0): el supervisor también está asignado
  -- como empleado (asignación no quitada) en este mismo turno.
  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = p_supervisor_id and a.removed_at is null
  ) then
    v_warnings := array_append(v_warnings, 'SUPERVISES_OWN_SHIFT');
  end if;

  return jsonb_build_object('supervision', to_jsonb(v_supervision), 'warnings', v_warnings);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_create_user_records(p_profile_id uuid, p_actor_id uuid, p_first_name text, p_last_name text, p_roles app_role[], p_employee jsonb DEFAULT NULL::jsonb, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_employee_number integer;
  v_constraint text;
begin
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá al menos un rol válido.',
      hint = 'VALIDATION_ERROR';
  end if;

  if ('employee' = any (p_roles) or 'supervisor' = any (p_roles))
    and (p_employee is null or coalesce(trim(p_employee ->> 'dni'), '') = '')
  then
    raise exception using
      errcode = 'P0001',
      message = 'Para asignar el rol de empleado o coordinador hace falta cargar los datos de empleado (al menos el DNI).',
      hint = 'EMPLOYEE_DATA_REQUIRED';
  end if;

  -- Una cuenta retomada puede venir con otro nombre que el del primer intento.
  update public.profiles
  set first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      phone = nullif(trim(p_phone), ''),
      updated_by = p_actor_id
  where id = p_profile_id;

  if p_employee is not null then
    begin
      insert into public.employees (
        profile_id,
        employee_number,
        dni,
        cuil,
        address,
        birth_date,
        hire_date,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relationship,
        notes,
        created_by
      )
      values (
        p_profile_id,
        coalesce(
          (p_employee ->> 'employee_number')::integer,
          (select coalesce(max(e.employee_number), 0) + 1 from public.employees e)
        ),
        p_employee ->> 'dni',
        nullif(p_employee ->> 'cuil', ''),
        nullif(p_employee ->> 'address', ''),
        nullif(p_employee ->> 'birth_date', '')::date,
        nullif(p_employee ->> 'hire_date', '')::date,
        nullif(p_employee ->> 'emergency_contact_name', ''),
        nullif(p_employee ->> 'emergency_contact_phone', ''),
        nullif(p_employee ->> 'emergency_contact_relationship', ''),
        nullif(p_employee ->> 'notes', ''),
        p_actor_id
      )
      returning employee_number into v_employee_number;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'employees_dni_key' then
          raise exception using
            errcode = 'P0001',
            message = 'Ese DNI ya está registrado.',
            hint = 'DNI_IN_USE';
        elsif v_constraint = 'employees_employee_number_key' then
          raise exception using
            errcode = 'P0001',
            message = 'Ese legajo ya está en uso.',
            hint = 'EMPLOYEE_NUMBER_IN_USE';
        end if;
        raise;
      when check_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception using
          errcode = 'P0001',
          message = case
            when v_constraint = 'employees_dni_format_check' then 'El DNI tiene que tener solo dígitos.'
            when v_constraint = 'employees_cuil_format_check' then 'El CUIL tiene que tener 11 dígitos, sin puntos ni guiones.'
            else 'Los datos de empleado no son válidos.'
          end,
          hint = 'VALIDATION_ERROR';
      when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
        raise exception using
          errcode = 'P0001',
          message = 'Revisá las fechas y el legajo: alguno no tiene un formato válido.',
          hint = 'VALIDATION_ERROR';
    end;
  end if;

  insert into public.user_roles (profile_id, role, granted_by)
  select p_profile_id, r, p_actor_id
  from unnest(p_roles) as r
  on conflict (profile_id, role) do nothing;

  if 'admin' = any (p_roles) then
    insert into public.admin_capabilities (profile_id, capability, enabled, updated_by)
    select p_profile_id, c, true, p_actor_id
    from unnest(enum_range(null::public.admin_capability)) as c
    on conflict (profile_id, capability) do nothing;
  end if;

  return jsonb_build_object('profile_id', p_profile_id, 'employee_number', v_employee_number);
end;
$function$
;

CREATE OR REPLACE FUNCTION app.set_announcement_recipients(p_id uuid, p_audience announcement_audience, p_recipient_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare
  v_ids uuid[];
  v_bad int;
begin
  delete from public.announcement_recipients where announcement_id = p_id;

  if p_audience <> 'custom' then
    return;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_recipient_ids, '{}')) as t(x)
  where x is not null;

  if cardinality(v_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí al menos una persona para el anuncio.',
      hint = 'RECIPIENTS_REQUIRED';
  end if;

  select count(*) into v_bad
  from unnest(v_ids) as t(x)
  where not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id and ur.role in ('employee', 'supervisor')
    where p.id = t.x and p.is_active and p.deleted_at is null
  );

  if v_bad > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Hay personas elegidas que no están activas o no son empleados ni coordinadores.',
      hint = 'RECIPIENT_INVALID';
  end if;

  insert into public.announcement_recipients (announcement_id, profile_id)
  select p_id, x from unnest(v_ids) as t(x);
end;
$function$
;

