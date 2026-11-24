-- 0089_p32_1_observaciones_24_nov.sql
-- P32.1 (Docs/Plan_Maestro/modulos/P32_observaciones_de_la_direccion_24_nov.md, sección «Paquetes»).
--
--   1. OJ-01 (D-01, D-02, D-03)  recarga de tareas en lote desde la plantilla:
--            app.outdated_template_shifts, public.count_outdated_template_shifts y
--            public.reload_template_shift_tasks.
--   2. OJ-03 (D-05 a D-07)       consultas por rango (de mañana a hoy + 60, Argentina) para
--            «Próximos días»: app.supervisor_shifts_between + public.get_supervisor_shifts
--            (coordinador) y app.my_services_base + public.get_my_services (empleado).
--            app.supervisor_upcoming y v_my_day devuelven exactamente lo mismo que antes.
--
-- Criterio del rango: las funciones públicas RECORTAN en silencio al rango permitido (mañana a hoy
-- + 60) para que un minicalendario pueda pedir el mes entero; un rango sin intersección devuelve
-- cero filas. Fechas nulas o p_from > p_to dan INVALID_DATE_RANGE.

-- ---------------------------------------------------------------------------------------------
-- 1. OJ-01: recarga de tareas en lote
-- ---------------------------------------------------------------------------------------------

-- Turnos alcanzados y desactualizados (D-01, D-02). Interna: la usan las dos RPC de abajo.
--   - Del cliente, scheduled/assigned, no dados de baja, que todavía no empezaron (starts_at > now()).
--   - Con p_site_id: los de esa sede (la sede debe ser del cliente). Con p_site_id nulo: los de las
--     sedes cuya plantilla vigente es la del cliente (las sedes con plantilla propia quedan fuera).
--   - Desactualizado: checklist_template_id distinto de la vigente, o tareas que no coinciden con los
--     ítems vigentes no borrados (misma cantidad y, por position, igual título, descripción y
--     obligatoriedad). Se saltea el turno con alguna tarea distinta de pending.
create function app.outdated_template_shifts(p_client_id uuid, p_site_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client_tpl uuid;
begin
  if p_client_id is null or not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_site_id and s.client_id = p_client_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa sede en este cliente.',
      hint = 'SITE_NOT_FOUND';
  end if;

  -- Plantilla vigente del cliente (la que no es de una sede), para el caso sin sede.
  select ct.id into v_client_tpl
  from public.checklist_templates ct
  where ct.client_id = p_client_id and ct.site_id is null and ct.is_active and ct.deleted_at is null
  limit 1;

  return query
  select x.id
  from (
    select sh.id,
           sh.checklist_template_id,
           app.checklist_template_for(sh.client_id, sh.site_id) as tpl
    from public.shifts sh
    where sh.client_id = p_client_id
      and sh.deleted_at is null
      and sh.status in ('scheduled', 'assigned')
      and sh.starts_at > now()
      and (p_site_id is null or sh.site_id = p_site_id)
  ) x
  where x.tpl is not null
    and (p_site_id is not null or x.tpl = v_client_tpl)
    and not exists (
      select 1 from public.shift_tasks st where st.shift_id = x.id and st.status <> 'pending'
    )
    and (
      x.checklist_template_id is distinct from x.tpl
      or (
        select jsonb_agg(jsonb_build_array(st.title, st.description, st.is_required) order by st.position)
        from public.shift_tasks st where st.shift_id = x.id
      ) is distinct from (
        select jsonb_agg(jsonb_build_array(i.title, i.description, i.is_required) order by i.position)
        from public.checklist_template_items i where i.template_id = x.tpl and i.deleted_at is null
      )
    )
  order by x.id;
end;
$$;

comment on function app.outdated_template_shifts(uuid, uuid) is
  'Turnos próximos con tareas distintas a la plantilla vigente (0089, OJ-01, D-01/D-02). Del cliente, scheduled/assigned, no dados de baja y con starts_at > now(). Con p_site_id: los de esa sede (SITE_NOT_FOUND si no es del cliente); sin sede: los de las sedes cuya plantilla vigente es la del cliente. Desactualizado = checklist_template_id distinto de la vigente o tareas que no coinciden (cantidad, orden, título, descripción, obligatoriedad) con los ítems no borrados; se saltea el turno con alguna tarea distinta de pending. Interna: la usan count_outdated_template_shifts y reload_template_shift_tasks.';

revoke execute on function app.outdated_template_shifts(uuid, uuid) from public, anon, authenticated;

create function public.count_outdated_template_shifts(p_client_id uuid, p_site_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_capability('edit_checklists');

  return (select count(*)::integer from app.outdated_template_shifts(p_client_id, p_site_id));
end;
$$;

comment on function public.count_outdated_template_shifts(uuid, uuid) is
  'Cantidad de turnos próximos con tareas distintas a la plantilla vigente (0089, OJ-01, D-01 a D-03). O, A + edit_checklists. Con p_site_id (plantilla de la sede) cuenta los turnos de esa sede; sin sede (plantilla del cliente), los de las sedes sin plantilla propia. Errores: CLIENT_NOT_FOUND, SITE_NOT_FOUND. Ver app.outdated_template_shifts para el alcance.';

revoke execute on function public.count_outdated_template_shifts(uuid, uuid) from public, anon;
grant execute on function public.count_outdated_template_shifts(uuid, uuid) to authenticated;

create function public.reload_template_shift_tasks(p_client_id uuid, p_site_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  perform app.require_capability('edit_checklists');

  -- Se materializa la lista antes de tocar nada: copy_checklist_to_shift cambia los datos que la
  -- condición mira.
  select coalesce(array_agg(o), '{}') into v_ids from app.outdated_template_shifts(p_client_id, p_site_id) o;

  foreach v_id in array v_ids loop
    perform app.copy_checklist_to_shift(v_id);
  end loop;

  return coalesce(array_length(v_ids, 1), 0);
end;
$$;

comment on function public.reload_template_shift_tasks(uuid, uuid) is
  'Reemplaza las tareas de todos los turnos próximos desactualizados por las de la plantilla vigente (0089, OJ-01, D-01 a D-03); devuelve cuántos actualizó. O, A + edit_checklists (mismo criterio que reload_shift_tasks). Alcance y errores como count_outdated_template_shifts: no toca turnos en curso, finalizados, cancelados ni ya empezados, ni los que tienen alguna tarea marcada.';

revoke execute on function public.reload_template_shift_tasks(uuid, uuid) from public, anon;
grant execute on function public.reload_template_shift_tasks(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2a. OJ-03: coordinador, turnos por rango
-- ---------------------------------------------------------------------------------------------

create function app.supervisor_shifts_between(p_from date, p_to date)
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
    and sh.shift_date between p_from and p_to
    and sh.status <> 'cancelled'
  order by sh.shift_date, sh.start_time, cl.legal_name, si.name, sh.id;
$$;

comment on function app.supervisor_shifts_between(date, date) is
  'Turnos entre dos fechas (inclusive) de todos los clientes y sedes, para «Próximos días» del coordinador (0089, OJ-03, D-05/D-06). Mismas columnas y reglas que app.supervisor_today (0081): solo devuelve filas si la sesión tiene el rol supervisor; turnos no cancelados ni dados de baja. Sin recorte: lo recortan las funciones que la llaman (supervisor_upcoming, get_supervisor_shifts).';

revoke execute on function app.supervisor_shifts_between(date, date) from public, anon;
grant execute on function app.supervisor_shifts_between(date, date) to authenticated, service_role;

-- app.supervisor_upcoming conserva firma y columnas: ahora usa la función por rango (mañana a hoy + 7).
create or replace function app.supervisor_upcoming()
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
  select * from app.supervisor_shifts_between(app.today() + 1, app.today() + 7);
$$;

create function public.get_supervisor_shifts(p_from date, p_to date)
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
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('supervisor');

  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El período no es válido.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  -- Se recorta al rango permitido: de mañana a hoy + 60 (Argentina).
  return query
  select * from app.supervisor_shifts_between(
    greatest(p_from, app.today() + 1),
    least(p_to, app.today() + 60)
  );
end;
$$;

comment on function public.get_supervisor_shifts(date, date) is
  'Turnos de «Próximos días» del coordinador entre dos fechas (0089, OJ-03, D-05/D-06). Solo S (FORBIDDEN si no). INVALID_DATE_RANGE si hay una fecha nula o p_from > p_to. El rango se recorta en silencio a mañana .. hoy + 60 (Argentina); sin intersección devuelve cero filas. Mismas columnas y reglas que v_supervisor_upcoming (app.supervisor_shifts_between): shift_date, priority_kind / is_priority (Mis sedes / Otras sedes), assigned_employees, supervisors, my_supervision_*. Turnos no cancelados ni dados de baja. Solo consulta.';

revoke execute on function public.get_supervisor_shifts(date, date) from public, anon;
grant execute on function public.get_supervisor_shifts(date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2b. OJ-03: empleado, servicios propios por rango
-- ---------------------------------------------------------------------------------------------

-- La consulta de v_my_day (0086) sin el filtro de fechas, para no duplicarla: v_my_day y
-- get_my_services la filtran por rango. security_invoker: el empleado solo ve filas de sus propias
-- asignaciones (a.employee_id = auth.uid()) y la RLS de las tablas sigue valiendo.
create view app.my_services_base
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
  WHERE ((a.employee_id = auth.uid()) AND (a.removed_at IS NULL));

comment on view app.my_services_base is
  'Servicios propios de la sesión (asignaciones vigentes), sin filtro de fechas (0089, OJ-03). Mismas columnas que v_my_day. Interna: la leen v_my_day (de hoy a hoy + 7) y get_my_services (de mañana a hoy + 60).';

revoke all on app.my_services_base from public, anon;
grant select on app.my_services_base to authenticated, service_role;

-- v_my_day devuelve exactamente lo mismo que en 0086: mismas columnas, mismas filas.
create or replace view public.v_my_day
with (security_invoker = true)
as
select * from app.my_services_base b
where b.shift_date >= app.today() and b.shift_date <= app.today() + 7;

revoke all on public.v_my_day from public, anon, authenticated;
grant select on public.v_my_day to authenticated;

create function public.get_my_services(p_from date, p_to date)
returns setof public.v_my_day
language plpgsql
stable
security invoker
set search_path = public, app, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El período no es válido.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  -- Se recorta al rango permitido: de mañana a hoy + 60 (Argentina).
  return query
  select * from app.my_services_base b
  where b.shift_date between greatest(p_from, app.today() + 1) and least(p_to, app.today() + 60)
  order by b.shift_date, b.effective_start_time, b.assignment_id;
end;
$$;

comment on function public.get_my_services(date, date) is
  'Servicios propios de la sesión entre dos fechas, para «Próximos días» del empleado (0089, OJ-03, D-05/D-07). Mismas columnas y reglas de visibilidad que v_my_day (solo las asignaciones vigentes propias; security invoker, la RLS sigue valiendo). INVALID_DATE_RANGE si hay una fecha nula o p_from > p_to. El rango se recorta en silencio a mañana .. hoy + 60 (Argentina); sin intersección devuelve cero filas. Orden: fecha y hora de inicio efectiva.';

revoke execute on function public.get_my_services(date, date) from public, anon;
grant execute on function public.get_my_services(date, date) to authenticated;
