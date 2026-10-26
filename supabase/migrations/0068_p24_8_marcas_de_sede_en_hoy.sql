-- 0068_p24_8_marcas_de_sede_en_hoy.sql
-- P24.8: app.supervisor_today / v_supervisor_today suman al final phone_restricted y photos_not_allowed
-- de `sites` (mismos nombres que v_my_day), para que SUP-03 pase las dos marcas a SiteInfo como SUP-04.
-- Cambian las columnas de salida: se recrean la función y la vista con los mismos grants y revokes de 0065.

drop view public.v_supervisor_today;
drop function app.supervisor_today();

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
  site_contact_name text,
  site_contact_phone text,
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
    si.contact_name,
    si.contact_phone,
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
    limit 1
  ) mine on true
  where app.has_role('supervisor')
    and sh.deleted_at is null
    and sh.shift_date = app.today()
    and sh.status <> 'cancelled';
$$;

comment on function app.supervisor_today() is
  'Turnos de hoy de todos los clientes y sedes para el coordinador (0063, CJ-02, CJ-25). Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Interna: la lee v_supervisor_today. Desde 0064 trae site_radius_m (radio vigente de la sede: el propio o el general) y max_accuracy_m (precisión máxima de la empresa), los mismos valores que usa la validación al tomar la supervisión (app.geo_for_site). Desde 0065 trae los datos de la sede que ya lee SUP-04 (site_contact_name, site_contact_phone, access_instructions, building_hours, restrictions_notes), sin nada del cliente. Desde 0068 suma phone_restricted y photos_not_allowed (las marcas de la sede que también muestra SUP-04).';

revoke execute on function app.supervisor_today() from public, anon;
grant execute on function app.supervisor_today() to authenticated, service_role;

create view public.v_supervisor_today
with (security_invoker = true)
as
select * from app.supervisor_today();

comment on view public.v_supervisor_today is
  'Pantalla Hoy del coordinador (SUP-02, SUP-03; 0063, CJ-02, CJ-04, CJ-25): todos los turnos de hoy no cancelados. priority_kind (site | client | null) / is_priority: la prioridad del coordinador (CJ-03, CJ-24). display_state: in_progress | pending | finished (según el estado del turno). assigned_employees: [{ assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at }]. supervisors: quién lo supervisa o ya lo supervisó, sin las canceladas: [{ supervision_id, supervisor_id, first_name, last_name, status, check_in_at, check_out_at, is_me }]. my_supervision_id / my_supervision_status: la supervisión propia no cancelada. site_radius_m (smallint) y max_accuracy_m (smallint), desde 0064: radio vigente de la sede (el propio o el general de la empresa) y precisión máxima aceptada del GPS, para el detalle del turno (SUP-03). Desde 0065: site_contact_name, site_contact_phone, access_instructions, building_hours y restrictions_notes (text, nulos si la sede no los cargó), los mismos datos de la sede que muestra SUP-04, para el detalle del turno (SUP-03); sin datos del cliente. Desde 0068: phone_restricted y photos_not_allowed (boolean, las marcas «sin celular» y «sin fotos» de la sede). Solo trae filas para el rol supervisor.';

revoke all on public.v_supervisor_today from public, anon, authenticated;
grant select on public.v_supervisor_today to authenticated;
