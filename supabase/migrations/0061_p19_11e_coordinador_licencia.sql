-- 0061 (P19.11e): un coordinador de licencia no puede recibir supervisiones (decisión de Mike del
-- 20 oct 2026).
--
--   1. assign_supervision: si el coordinador elegido tiene una licencia vigente (employee_leaves
--      sin baja lógica, que cubre la fecha del turno; ends_on nulo = abierta) da ON_LEAVE con el
--      mensaje «El coordinador está de licencia ese día.». Es el único camino que crea o cambia
--      el coordinador de una supervisión (no hay reasignar; generate_shifts no genera supervisiones).
--   2. update_shift_time(p_date): al mover la fecha, si el coordinador de la supervisión vigente
--      (assigned / in_progress) está de licencia en la nueva fecha, da ON_LEAVE nombrándolo.
--   Sin cambios de firmas ni de permisos. Los selectores de coordinadores no son una RPC: la app
--      lee v_employees, así que esta migración no agrega columnas.

-- ---------------------------------------------------------------------------------------------
-- 1. assign_supervision
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

  -- Coordinador de licencia ese día (decisión de Mike del 20 oct 2026): no recibe supervisiones.
  -- La licencia es de employees.profile_id; la comprobación anterior ya exige la fila de employees.
  if exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p_supervisor_id
      and el.deleted_at is null
      and el.starts_on <= v_shift.shift_date
      and (el.ends_on is null or el.ends_on >= v_shift.shift_date)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'El coordinador está de licencia ese día.',
      hint = 'ON_LEAVE';
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

comment on function public.assign_supervision(uuid, uuid) is
  'Asigna un coordinador (rol supervisor) a un turno (04 sección 6.4, 9; 06 sección 12; P-078, P-079). O, A + manage_supervisions. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado o completado), SUPERVISOR_ROLE_REQUIRED (rol vigente y activo), ON_LEAVE (0061, P19.11e: el coordinador tiene una licencia vigente que cubre la fecha del turno), ALREADY_ASSIGNED (unique_violation de supervisions_shift_id_supervisor_id_key, 0010). Devuelve {"supervision": <fila>, "warnings": [...]} con SUPERVISES_OWN_SHIFT si el coordinador también está asignado como empleado en ese turno -- no bloquea (ratificado 27 sep 2026, P15.0).';

revoke execute on function public.assign_supervision(uuid, uuid) from public, anon;
grant execute on function public.assign_supervision(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. update_shift_time
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

    -- Lo mismo para el coordinador de la supervisión vigente del turno (decisión del 20 oct 2026).
    select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
    into v_names
    from public.supervisions sv
    join public.profiles p on p.id = sv.supervisor_id
    where sv.shift_id = p_shift_id
      and sv.status in ('assigned', 'in_progress')
      and exists (
        select 1 from public.employee_leaves el
        where el.employee_id = sv.supervisor_id
          and el.deleted_at is null
          and el.starts_on <= v_new_date
          and (el.ends_on is null or el.ends_on >= v_new_date)
      );

    if v_names is not null then
      raise exception using
        errcode = 'P0001',
        message = 'El coordinador está de licencia en la nueva fecha: ' || v_names || '.',
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
  'Cambia la franja y, desde 0059 (P19.11a), la fecha de un turno (04 sección 6.1, 9; 06 sección 7). O, A. p_date null = misma fecha. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula shift_date y la ventana de las asignaciones; si eso las deja superpuestas se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP nombrando a quien queda superpuesto (0030). Fija updated_by = auth.uid() (0028). Desde 0037 (AJ2-10): p_open_ended = true deja el turno «A terminar» (p_end se ignora, end_time = 23:59); un turno «A terminar» ya finalizado admite ponerle la hora de fin (mismo inicio, misma fecha) y las horas se recalculan con el tope de AJ2-09. Cambiar la fecha solo se puede si el turno no empezó: SHIFT_STARTED si el estado no es scheduled/assigned o algún fichaje cuelga de sus asignaciones; SHIFT_DATE_IN_PAST (0060) si la fecha nueva es anterior a hoy (hoy sí se permite); ON_LEAVE (error) si algún asignado vigente o el coordinador de la supervisión vigente (0061) está de licencia en la nueva fecha; ASSIGNMENT_OVERLAP en la nueva fecha; SHIFT_DATE_TAKEN si el servicio ya tiene otro turno vigente ese día. Al cambiar la fecha (0060) se anulan los avisos de sus asignaciones (attendance_notices.voided_at; quedan como historial) y las asignaciones con demora o ausencia avisada vuelven a expected. Las advertencias (HOLIDAY, OUTSIDE_AVAILABILITY) las da get_shift_date_warnings.';

revoke execute on function public.update_shift_time(uuid, time, time, boolean, date) from public, anon;
grant execute on function public.update_shift_time(uuid, time, time, boolean, date) to authenticated;
