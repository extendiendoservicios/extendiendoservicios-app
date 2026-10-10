-- 0041 (P19.6 paquete F, AJ2-17): asignar empleados al crear turnos.
--
-- Decisión de Mike (9 oct 2026):
--   - Turno suelto: al crearlo se eligen empleados y quedan asignados en la misma operación
--     (create_shift con p_employee_ids).
--   - Servicio: tiene «empleados fijos»; cada turno que genera generate_shifts los asigna solos.
--
-- Contenido:
--   1. app.assign_employee_core: el cuerpo de assign_employee (0024) sin el control de rol, para
--      que create_shift y generate_shifts reutilicen EXACTAMENTE las mismas validaciones. Con
--      p_strict = true (lo usa generate_shifts) las advertencias ON_LEAVE y OUTSIDE_AVAILABILITY
--      bloquean en vez de advertir. public.assign_employee queda como envoltorio (misma firma).
--   2. service_fixed_employees + RLS + topes por dotación + set_service_fixed_employees.
--   3. create_shift con p_employee_ids (política: el turno se crea siempre; informa asignados y
--      rechazados con motivo).
--   4. generate_shifts asigna los fijos; lo que no se puede asignar se saltea y se informa.

-- ---------------------------------------------------------------------------------------------
-- 1. app.assign_employee_core
-- ---------------------------------------------------------------------------------------------

create function app.assign_employee_core(
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

  if exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p_employee_id
      and el.deleted_at is null
      and el.starts_on <= v_shift.shift_date
      and (el.ends_on is null or el.ends_on >= v_shift.shift_date)
  ) then
    v_warnings := array_append(v_warnings, 'ON_LEAVE');
  end if;

  -- Modo estricto (asignación automática de los fijos): licencia y falta de disponibilidad
  -- bloquean, porque nadie está mirando la advertencia.
  if p_strict and 'ON_LEAVE' = any(v_warnings) then
    raise exception using
      errcode = 'P0001',
      message = 'El empleado está de licencia ese día.',
      hint = 'ON_LEAVE';
  end if;

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

revoke execute on function app.assign_employee_core(uuid, uuid, time, time, boolean) from public, anon, authenticated;

create or replace function public.assign_employee(
  p_shift_id uuid,
  p_employee_id uuid,
  p_start time default null,
  p_end time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner', 'admin');
  return app.assign_employee_core(p_shift_id, p_employee_id, p_start, p_end, false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. service_fixed_employees
-- ---------------------------------------------------------------------------------------------

create table public.service_fixed_employees (
  service_id uuid not null references public.services (id),
  employee_id uuid not null references public.employees (profile_id),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (service_id, employee_id)
);

comment on table public.service_fixed_employees is
  'Empleados fijos de un servicio (AJ2-17): generate_shifts los asigna solos a cada turno que genera. Máximo required_staff del servicio. Mismo acceso que services (O, A).';

create index service_fixed_employees_employee_id_idx on public.service_fixed_employees (employee_id);

alter table public.service_fixed_employees enable row level security;

create policy service_fixed_employees_select_admin
  on public.service_fixed_employees for select to authenticated
  using (app.is_admin());

create policy service_fixed_employees_write_admin
  on public.service_fixed_employees for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

revoke all on public.service_fixed_employees from anon;
grant select, insert, update, delete on public.service_fixed_employees to authenticated;

-- Tope: la cantidad de fijos no supera la dotación del servicio (también para escrituras directas).
create function app.check_fixed_employees_limit()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_required smallint;
  v_count int;
begin
  select s.required_staff into v_required from public.services s where s.id = new.service_id;
  select count(*) into v_count from public.service_fixed_employees f
  where f.service_id = new.service_id and f.employee_id <> new.employee_id;

  if v_count + 1 > v_required then
    raise exception using
      errcode = 'P0001',
      message = 'Los empleados fijos no pueden ser más que la dotación del servicio (' || v_required || ').',
      hint = 'FIXED_EXCEEDS_STAFF';
  end if;
  return new;
end;
$$;

revoke execute on function app.check_fixed_employees_limit() from public, anon, authenticated;

create trigger trg_fixed_employees_limit
before insert or update on public.service_fixed_employees
for each row execute function app.check_fixed_employees_limit();

-- Bajar la dotación del servicio por debajo de la cantidad de fijos también se rechaza.
create function app.check_service_staff_vs_fixed()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.required_staff < old.required_staff
    and (select count(*) from public.service_fixed_employees f where f.service_id = new.id) > new.required_staff
  then
    raise exception using
      errcode = 'P0001',
      message = 'El servicio tiene más empleados fijos que la dotación pedida. Sacá fijos antes de bajarla.',
      hint = 'FIXED_EXCEEDS_STAFF';
  end if;
  return new;
end;
$$;

revoke execute on function app.check_service_staff_vs_fixed() from public, anon, authenticated;

create trigger trg_services_staff_vs_fixed
before update of required_staff on public.services
for each row execute function app.check_service_staff_vs_fixed();

create function public.set_service_fixed_employees(
  p_service_id uuid,
  p_employee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_ids uuid[];
  v_bad uuid;
begin
  perform app.require_role('owner', 'admin');

  select * into v_service from public.services where id = p_service_id and deleted_at is null for update;

  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  -- Sin nulos ni repetidos.
  select coalesce(array_agg(d.x), array[]::uuid[]) into v_ids
  from (select distinct x from unnest(coalesce(p_employee_ids, array[]::uuid[])) as x where x is not null) d;

  if cardinality(v_ids) > v_service.required_staff then
    raise exception using
      errcode = 'P0001',
      message = 'Los empleados fijos no pueden ser más que la dotación del servicio (' || v_service.required_staff || ').',
      hint = 'FIXED_EXCEEDS_STAFF';
  end if;

  -- Los que ya eran fijos se conservan aunque hoy no estén activos (se pueden sacar); solo los
  -- que se suman tienen que ser empleados activos.
  select x into v_bad
  from unnest(v_ids) as x
  where not exists (
      select 1 from public.service_fixed_employees f where f.service_id = p_service_id and f.employee_id = x
    )
    and not exists (
      select 1 from public.employees e where e.profile_id = x and e.deleted_at is null and e.status = 'active'
    )
  limit 1;

  if v_bad is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Hay un empleado que no está activo.',
      hint = 'EMPLOYEE_NOT_ACTIVE';
  end if;

  delete from public.service_fixed_employees
  where service_id = p_service_id and not (employee_id = any(v_ids));

  insert into public.service_fixed_employees (service_id, employee_id, created_by)
  select p_service_id, x, auth.uid() from unnest(v_ids) as x
  on conflict (service_id, employee_id) do nothing;

  return jsonb_build_object(
    'service_id', p_service_id,
    'employee_ids', to_jsonb(v_ids)
  );
end;
$$;

comment on function public.set_service_fixed_employees(uuid, uuid[]) is
  'Fija la lista de empleados fijos de un servicio (reemplaza la anterior; null o vacío = sin fijos). O, A. SERVICE_NOT_FOUND, FIXED_EXCEEDS_STAFF (más fijos que required_staff), EMPLOYEE_NOT_ACTIVE (alguno de los nuevos no es un empleado activo). No toca turnos ya generados. Devuelve {"service_id", "employee_ids": [...]}.';

revoke execute on function public.set_service_fixed_employees(uuid, uuid[]) from public, anon;
grant execute on function public.set_service_fixed_employees(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. create_shift con p_employee_ids (cambia de firma: drop + create)
-- ---------------------------------------------------------------------------------------------

drop function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean);

create function public.create_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_service_id uuid default null,
  p_notes text default null,
  p_open_ended boolean default false,
  p_show_in_print boolean default true,
  p_employee_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_warnings text[] := array[]::text[];
  v_end time;
  v_emp uuid;
  v_res jsonb;
  v_assigned jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_code text;
  v_msg text;
begin
  perform app.require_role('owner', 'admin');

  v_end := case when coalesce(p_open_ended, false) then time '23:59' else p_end end;

  if v_end is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status = 'active') then
    raise exception using
      errcode = 'P0001',
      message = 'El cliente no está activo.',
      hint = 'CLIENT_NOT_ACTIVE';
  end if;

  if not exists (
    select 1 from public.sites s
    where s.id = p_site_id and s.client_id = p_client_id and s.status = 'active'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'La sede no está activa.',
      hint = 'SITE_NOT_ACTIVE';
  end if;

  insert into public.shifts (
    service_id, client_id, site_id, shift_date, start_time, end_time, open_ended,
    required_staff, status, generated, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, v_end, coalesce(p_open_ended, false),
    p_required_staff, 'scheduled', false, auth.uid()
  )
  returning * into v_shift;

  if nullif(btrim(p_notes), '') is not null or p_show_in_print is false then
    insert into public.shift_observations (shift_id, observation, show_in_print, created_by)
    values (v_shift.id, nullif(btrim(p_notes), ''), coalesce(p_show_in_print, true), auth.uid());
  end if;

  perform app.copy_checklist_to_shift(v_shift.id);

  if exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    v_warnings := array_append(v_warnings, 'HOLIDAY');
  end if;

  -- AJ2-17: asigna a los empleados pedidos, en el orden recibido y sin repetidos, con las mismas
  -- validaciones que la asignación manual. Un empleado que no se puede asignar no frena el alta
  -- del turno: queda en "rejected" con su motivo (el resto sí se asigna).
  for v_emp in
    select d.x from (
      select t.x, min(t.ord) as ord
      from unnest(coalesce(p_employee_ids, array[]::uuid[])) with ordinality as t(x, ord)
      where t.x is not null
      group by t.x
    ) d
    order by d.ord
  loop
    begin
      v_res := app.assign_employee_core(v_shift.id, v_emp, null, null, false);
      v_assigned := v_assigned || jsonb_build_array(jsonb_build_object(
        'employee_id', v_emp,
        'assignment_id', v_res -> 'assignment' ->> 'id',
        'warnings', v_res -> 'warnings'
      ));
    exception
      when sqlstate 'P0001' then
        get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text;
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'employee_id', v_emp,
          'employee_name', (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = v_emp),
          'code', v_code,
          'message', v_msg
        ));
    end;
  end loop;

  select * into v_shift from public.shifts where id = v_shift.id;

  -- La observación no vive en shifts: se agrega al objeto devuelto para no cambiar el contrato.
  return jsonb_build_object(
    'shift',
    to_jsonb(v_shift) || jsonb_build_object(
      'notes', (select o.observation from public.shift_observations o where o.shift_id = v_shift.id),
      'show_in_print', coalesce((select o.show_in_print from public.shift_observations o where o.shift_id = v_shift.id), true)
    ),
    'warnings', v_warnings,
    'assigned', v_assigned,
    'rejected', v_rejected
  );
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[]) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. CLIENT_NOT_ACTIVE/SITE_NOT_ACTIVE si el cliente o la sede no están activos; INVALID_TIME_RANGE si end <= start (o si falta p_end y el turno no es «A terminar»). Copia el checklist vigente (app.copy_checklist_to_shift). Devuelve {"shift": <fila>, "warnings": [...], "assigned": [...], "rejected": [...]}; "HOLIDAY" (informativo, no bloquea) si la fecha es feriado. Desde 0037 (AJ2-10) p_open_ended = true crea un turno «A terminar». Desde 0040 (AJ2-15) p_notes y p_show_in_print. Desde 0041 (AJ2-17) p_employee_ids (null o vacío = sin asignar): asigna a cada empleado con app.assign_employee_core (las mismas reglas que assign_employee). El turno se crea siempre; assigned = [{employee_id, assignment_id, warnings}] (warnings NOT_ENABLED_FOR_CLIENT / OUTSIDE_AVAILABILITY / ON_LEAVE, que advierten y no bloquean como en la asignación manual); rejected = [{employee_id, employee_name, code, message}] con code EMPLOYEE_NOT_ACTIVE, ASSIGNMENT_OVERLAP, SHIFT_FULL (más empleados que required_staff), SHIFT_STARTED (turno ya empezado sin manage_attendance), etc.';

revoke execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[]) from public, anon;
grant execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. generate_shifts: asigna los empleados fijos de cada servicio
-- ---------------------------------------------------------------------------------------------

create or replace function public.generate_shifts(p_year int, p_month int)
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
      d.shift_date,
      (h.holiday_date is not null) as is_holiday
    from public.services s
    join public.clients c on c.id = s.client_id and c.status = 'active'
    join public.sites st on st.id = s.site_id and st.client_id = s.client_id and st.status = 'active'
    cross join lateral (
      select gs::date as shift_date
      from generate_series(v_from, v_to, interval '1 day') as gs
      where extract(dow from gs)::smallint = any(s.weekdays)
        and gs::date >= s.valid_from
        and (s.valid_to is null or gs::date <= s.valid_to)
    ) d
    left join public.holidays h on h.holiday_date = d.shift_date and h.deleted_at is null
    where s.status = 'active' and s.deleted_at is null
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
      required_staff, status, generated, created_by
    ) values (
      v_rec.service_id, v_rec.client_id, v_rec.site_id, v_rec.shift_date,
      v_rec.start_time, v_rec.end_time, v_rec.open_ended, v_rec.required_staff, 'scheduled', true, auth.uid()
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

comment on function public.generate_shifts(int, int) is
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta days_of_week, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente. O, A + generate_shifts. Los turnos de un servicio «A terminar» nacen «A terminar» (0037). Desde 0041 (AJ2-17) cada turno recién creado asigna a los empleados fijos del servicio (service_fixed_employees) con app.assign_employee_core en modo estricto: lo que no se puede asignar NO frena la generación, se saltea y se informa. Devuelve {"created", "skipped", "holidays_skipped", "assigned" (asignaciones hechas), "unassigned" [{shift_id, shift_date, service_id, employee_id, employee_name, code, message}] con code ON_LEAVE, OUTSIDE_AVAILABILITY, ASSIGNMENT_OVERLAP, EMPLOYEE_NOT_ACTIVE, SHIFT_FULL..., "past_without_fixed" (turnos creados que ya habían empezado y por eso no reciben fijos)}.';
