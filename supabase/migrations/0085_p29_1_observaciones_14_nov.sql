-- 0085_p29_1_observaciones_14_nov.sql
-- P29.1 (Docs/Plan_Maestro/modulos/P29_observaciones_de_la_duena_14_nov.md, sección 3).
--
--   1. OG-04  CUIT repetido permitido: se borra clients_cuit_key; índice común y RPC
--             find_clients_by_cuit para el aviso «Ya hay otro cliente con este CUIT».
--   2. OG-02  Cierre de avisos de «Requiere atención»: tabla attention_dismissals, RPC
--             dismiss_attention y reopen_attention, limpieza de más de 30 días (pg_cron diario).
--   3. OG-03  v_assignments_board YA trae el último aviso (last_notice_kind, last_notice_minutes_late,
--             last_notice_reason_text, last_notice_at, last_notice_estimated_arrival_at): no se toca.
--   4. OG-05  shift_notes (shifts.notes) en v_my_day, v_my_history y v_my_supervisions (columna
--             nueva al final, create or replace). changed_since_last_seen ya compara sh.updated_at
--             (P-092), que el trigger set_updated_at mueve al cambiar las notas: no se toca.
--   5. OG-01  RPC map_active_sites(): sedes con ubicación de clientes activos con servicios activos.
--   6. OG-12  RPC admin_users_directory(): legajo, DNI y email de login para el listado de Usuarios.
--
-- Nada de esto cambia datos existentes.

-- ---------------------------------------------------------------------------------------------
-- 1. OG-04 · CUIT repetido
-- ---------------------------------------------------------------------------------------------

-- Se mantiene clients_cuit_format_check (11 dígitos, 0016). Ninguna RPC de alta o edición de
-- clientes captura el 23505 del CUIT: las escrituras de clientes van directo a la tabla y la
-- traducción «Ese CUIT ya está registrado» vive en el front (src/api/clients.ts, mapWriteError).
alter table public.clients drop constraint if exists clients_cuit_key;

create index if not exists clients_cuit_idx
  on public.clients (cuit)
  where cuit is not null;

create or replace function public.find_clients_by_cuit(
  p_cuit text,
  p_exclude_client_id uuid default null
)
returns table (
  id uuid,
  legal_name text,
  trade_name text,
  cuit text
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_cuit text;
begin
  perform app.require_role('owner', 'admin');

  -- Acepta el CUIT con guiones o puntos: se comparan solo los dígitos.
  v_cuit := regexp_replace(coalesce(p_cuit, ''), '[^0-9]', '', 'g');
  if v_cuit = '' then
    return;
  end if;

  return query
  select c.id, c.legal_name, c.trade_name, c.cuit
  from public.clients c
  where c.cuit = v_cuit
    and c.status = 'active'
    and c.deleted_at is null
    and (p_exclude_client_id is null or c.id <> p_exclude_client_id)
  order by c.legal_name;
end;
$$;

comment on function public.find_clients_by_cuit(text, uuid) is
  'Aviso de CUIT repetido (0085, OG-04): clientes ACTIVOS (status active, sin baja lógica) con ese CUIT, sin contar a p_exclude_client_id (el que se está editando). Acepta el CUIT con guiones o puntos (compara solo dígitos); vacío devuelve cero filas. Solo owner y admin (FORBIDDEN). No bloquea nada: la unicidad de clients.cuit se quitó en 0085.';

revoke all on function public.find_clients_by_cuit(text, uuid) from public, anon, authenticated;
grant execute on function public.find_clients_by_cuit(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. OG-02 · Cierre de avisos de «Requiere atención»
-- ---------------------------------------------------------------------------------------------

-- Un cierre vale para esa SITUACIÓN: (tipo de aviso, turno, asignación). Si la misma asignación
-- pasa a otro aviso, el tipo cambia y el nuevo aviso aparece. «uncovered» se cierra por turno
-- (assignment_id nulo); los demás tipos exigen asignación. El cierre es para toda la dirección y
-- la administración (C-01): una sola fila por situación, con quién y cuándo.
create table if not exists public.attention_dismissals (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  shift_id uuid not null references public.shifts (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete cascade,
  dismissed_by uuid not null references public.profiles (id),
  dismissed_at timestamptz not null default now(),
  constraint attention_dismissals_kind_check check (
    kind in ('absence', 'uncovered', 'noRecord', 'noCheckout', 'overdue', 'outsideGeo', 'late', 'delayNotified')
  ),
  constraint attention_dismissals_assignment_check check (
    (kind = 'uncovered' and assignment_id is null)
    or (kind <> 'uncovered' and assignment_id is not null)
  ),
  constraint attention_dismissals_situation_key unique nulls not distinct (kind, shift_id, assignment_id)
);

comment on table public.attention_dismissals is
  'Avisos cerrados de «Requiere atención» (0085, OG-02, C-01). Una fila por situación (kind + shift_id + assignment_id; uncovered va sin asignación). Vale para toda la dirección y la administración. Se escribe solo con dismiss_attention y reopen_attention; se limpian los de más de 30 días (pg_cron diario).';
comment on column public.attention_dismissals.kind is 'Tipo de aviso, igual a AttentionKind de src/features/dashboard/attention.ts: absence, uncovered, noRecord, noCheckout, overdue, outsideGeo, late, delayNotified.';
comment on column public.attention_dismissals.assignment_id is 'Asignación del aviso; nula solo para uncovered (turno sin cubrir).';
comment on column public.attention_dismissals.dismissed_by is 'Quién lo cerró (dueño o administrador).';
comment on column public.attention_dismissals.dismissed_at is 'Cuándo se cerró.';

create index if not exists attention_dismissals_shift_id_idx on public.attention_dismissals (shift_id);
create index if not exists attention_dismissals_dismissed_at_idx on public.attention_dismissals (dismissed_at);

alter table public.attention_dismissals enable row level security;

drop policy if exists attention_dismissals_select_admin on public.attention_dismissals;
create policy attention_dismissals_select_admin
  on public.attention_dismissals
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.attention_dismissals from public, anon, authenticated;
grant select on public.attention_dismissals to authenticated;

-- Limpieza: borra los cierres de más de 30 días. La corre pg_cron una vez al día y, por si la
-- extensión no estuviera, también dismiss_attention (barato: índice por dismissed_at).
create or replace function app.purge_attention_dismissals()
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.attention_dismissals
  where dismissed_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.purge_attention_dismissals() is
  'Borra los cierres de avisos (attention_dismissals) de más de 30 días (0085, OG-02). Devuelve cuántos borró. La programa pg_cron a diario (purge-attention-dismissals); sin permisos para anon ni authenticated.';

revoke execute on function app.purge_attention_dismissals() from public, anon, authenticated;

create or replace function public.dismiss_attention(
  p_kind text,
  p_shift_id uuid,
  p_assignment_id uuid default null
)
returns public.attention_dismissals
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.attention_dismissals;
begin
  perform app.require_role('owner', 'admin');

  if p_kind is null or p_kind not in
    ('absence', 'uncovered', 'noRecord', 'noCheckout', 'overdue', 'outsideGeo', 'late', 'delayNotified') then
    raise exception using
      errcode = 'P0001',
      message = 'Ese tipo de aviso no existe.',
      hint = 'INVALID_ATTENTION_KIND';
  end if;

  if not exists (select 1 from public.shifts s where s.id = p_shift_id and s.deleted_at is null) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if p_kind = 'uncovered' then
    if p_assignment_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Los avisos de turno sin cubrir se cierran por turno, sin asignación.',
        hint = 'INVALID_ATTENTION_TARGET';
    end if;
  else
    if p_assignment_id is null then
      raise exception using
        errcode = 'P0001',
        message = 'Este aviso es de una asignación: indicá cuál.',
        hint = 'INVALID_ATTENTION_TARGET';
    end if;
    if not exists (
      select 1 from public.assignments a where a.id = p_assignment_id and a.shift_id = p_shift_id
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos esa asignación en el turno.',
        hint = 'ASSIGNMENT_NOT_FOUND';
    end if;
  end if;

  -- Limpieza oportunista (ver app.purge_attention_dismissals).
  perform app.purge_attention_dismissals();

  -- Idempotente: si la situación ya estaba cerrada, devuelve el cierre existente (conserva quién y cuándo).
  insert into public.attention_dismissals (kind, shift_id, assignment_id, dismissed_by)
  values (p_kind, p_shift_id, p_assignment_id, auth.uid())
  on conflict on constraint attention_dismissals_situation_key do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.attention_dismissals d
    where d.kind = p_kind
      and d.shift_id = p_shift_id
      and d.assignment_id is not distinct from p_assignment_id;
  end if;

  return v_row;
end;
$$;

comment on function public.dismiss_attention(text, uuid, uuid) is
  'Cierra un aviso de «Requiere atención» para toda la dirección y la administración (0085, OG-02, C-01). Solo owner y admin (cualquier admin, sin capacidad especial). p_kind: absence, uncovered, noRecord, noCheckout, overdue, outsideGeo, late o delayNotified. uncovered va sin p_assignment_id; los demás lo exigen y tiene que ser del turno. Idempotente: si ya estaba cerrado devuelve el cierre existente. No toca el turno ni la asistencia. Errores: FORBIDDEN, INVALID_ATTENTION_KIND, SHIFT_NOT_FOUND, INVALID_ATTENTION_TARGET, ASSIGNMENT_NOT_FOUND.';

revoke all on function public.dismiss_attention(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.dismiss_attention(text, uuid, uuid) to authenticated;

create or replace function public.reopen_attention(p_id uuid)
returns public.attention_dismissals
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.attention_dismissals;
begin
  perform app.require_role('owner', 'admin');

  delete from public.attention_dismissals d
  where d.id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Ese aviso cerrado ya no existe.',
      hint = 'DISMISSAL_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

comment on function public.reopen_attention(uuid) is
  'Reabre un aviso cerrado (0085, OG-02): borra el cierre y el aviso vuelve a mostrarse mientras dure la situación. Solo owner y admin. Devuelve la fila borrada. Errores: FORBIDDEN, DISMISSAL_NOT_FOUND.';

revoke all on function public.reopen_attention(uuid) from public, anon, authenticated;
grant execute on function public.reopen_attention(uuid) to authenticated;

-- Limpieza diaria con pg_cron (03:10 hora Argentina = 06:10 UTC; mismo criterio que 0082).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise warning 'P29.1: no se pudo habilitar pg_cron (%). Programá la limpieza a mano (docs/database.md).', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-attention-dismissals', '10 6 * * *', 'select app.purge_attention_dismissals()');
  else
    raise warning 'P29.1: pg_cron no está habilitada: la limpieza de avisos cerrados NO quedó programada (igual se limpia al cerrar un aviso).';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. OG-05 · Observación del turno para el empleado y el coordinador
-- ---------------------------------------------------------------------------------------------

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
    NULLIF(btrim(sh.notes), ''::text) AS shift_notes
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
  'Observación del turno (shifts.notes) que cargan la dirección o la administración, para mostrar como «Mensaje de la oficina» (0085, OG-05). Null si está vacía. Solo de los turnos donde la persona está asignada. Un cambio de shifts.notes mueve shifts.updated_at y enciende changed_since_last_seen (P-092).';

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
    NULLIF(btrim(sh.notes), ''::text) AS shift_notes
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
  'Observación del turno (shifts.notes), igual que en v_my_day (0085, OG-05). Null si está vacía.';

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
    NULLIF(btrim(sh.notes), ''::text) AS shift_notes
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
  'Observación del turno (shifts.notes) para el coordinador que lo supervisa (0085, OG-05, propuesto). Null si está vacía. Solo de los turnos que supervisa.';

-- create or replace conserva los grants y los comentarios de vista; se reafirman por claridad.
revoke all on public.v_my_day from public, anon, authenticated;
grant select on public.v_my_day to authenticated;
revoke all on public.v_my_history from public, anon, authenticated;
grant select on public.v_my_history to authenticated;
revoke all on public.v_my_supervisions from public, anon, authenticated;
grant select on public.v_my_supervisions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. OG-01 · Mapa «Todos los clientes»
-- ---------------------------------------------------------------------------------------------

-- Una fila por sede con ubicación (latitud y longitud) de un cliente activo con al menos un
-- servicio activo (status active, sin baja lógica y no vencido). El color es el del calendario del
-- cliente (clients.calendar_color, 0..11). services: json con los servicios activos de la sede.
create or replace function public.map_active_sites()
returns table (
  client_id uuid,
  client_legal_name text,
  client_trade_name text,
  client_calendar_color smallint,
  site_id uuid,
  site_name text,
  site_city text,
  site_latitude numeric,
  site_longitude numeric,
  services jsonb
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner', 'admin');

  return query
  select
    c.id,
    c.legal_name,
    c.trade_name,
    c.calendar_color,
    si.id,
    si.name,
    si.city,
    si.latitude,
    si.longitude,
    sv.services
  from public.clients c
  join public.sites si on si.client_id = c.id
  cross join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'id', s.id,
               'name', s.name,
               'weekdays', to_jsonb(s.weekdays),
               'weeks_of_month', to_jsonb(s.weeks_of_month),
               'start_time', s.start_time,
               'end_time', s.end_time,
               'open_ended', s.open_ended
             )
             order by s.start_time, s.name
           ) as services
    from public.services s
    where s.site_id = si.id
      and s.status = 'active'
      and s.deleted_at is null
      and (s.valid_to is null or s.valid_to >= app.today())
  ) sv
  where c.status = 'active'
    and c.deleted_at is null
    and si.status = 'active'
    and si.deleted_at is null
    and si.latitude is not null
    and si.longitude is not null
    and sv.services is not null
  order by c.legal_name, si.name;
end;
$$;

comment on function public.map_active_sites() is
  'Mapa «Todos los clientes» (0085, OG-01): una fila por sede activa con latitud y longitud, de clientes activos con al menos un servicio activo (status active, sin baja lógica, valid_to nulo o futuro). client_calendar_color es el color del cliente (0..11). services es un json con los servicios activos de la sede: id, name, weekdays, weeks_of_month, start_time, end_time, open_ended. Solo owner y admin (FORBIDDEN).';

revoke all on function public.map_active_sites() from public, anon, authenticated;
grant execute on function public.map_active_sites() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. OG-12 · Datos del listado de Usuarios
-- ---------------------------------------------------------------------------------------------

-- Una fila por persona con perfil. employee_number (legajo) y dni salen de la ficha laboral
-- (employees) y son datos laborales: los ve cualquier dueño o administrador. El email de login
-- (auth.users.email) es parte del acceso (CR-07): el dueño ve el de todos; el administrador con
-- manage_users ve el de quien no tiene rol owner ni admin y el propio; los demás casos, null.
create or replace function public.admin_users_directory()
returns table (
  profile_id uuid,
  employee_number integer,
  dni text,
  email text
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_is_owner boolean;
  v_can_see_access boolean;
begin
  perform app.require_role('owner', 'admin');

  v_is_owner := app.has_role('owner');
  v_can_see_access := v_is_owner or app.has_capability('manage_users');

  return query
  select
    p.id,
    e.employee_number,
    e.dni,
    case
      when v_is_owner then u.email::text
      when v_can_see_access
        and (
          p.id = auth.uid()
          or not exists (
            select 1 from public.user_roles ur
            where ur.profile_id = p.id and ur.role in ('owner', 'admin')
          )
        ) then u.email::text
      else null
    end
  from public.profiles p
  left join public.employees e on e.profile_id = p.id
  left join auth.users u on u.id = p.id;
end;
$$;

comment on function public.admin_users_directory() is
  'Datos extra del listado de Configuración → Usuarios (0085, OG-12): por persona, employee_number (legajo), dni (de la ficha laboral; null si no tiene) y email de login. El legajo y el DNI los ven owner y admin. El email sigue CR-07: el dueño ve todos; el administrador con manage_users ve el de quien no es dueño ni admin y el propio; en el resto, null. Se combina en el front con la consulta actual de profiles (fetchUsers) por profile_id. Solo owner y admin (FORBIDDEN).';

revoke all on function public.admin_users_directory() from public, anon, authenticated;
grant execute on function public.admin_users_directory() to authenticated;
