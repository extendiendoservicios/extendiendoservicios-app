-- =================================================================================================
-- 0080_p27_1_fijos_en_lote.sql (P27.1, observaciones de los dueños del 2 nov 2026)
--
-- Tercera y última de las migraciones 0078 a 0080.
--
-- OD-11: aplicar los empleados fijos de un servicio a los turnos que ya están creados.
--
--   Al guardar un servicio con cambios en sus empleados fijos (set_service_fixed_employees), la
--   pantalla pregunta «¿Aplicar a los turnos desde el [fecha]?» y llama a
--   apply_service_fixed_employees. En cada turno del servicio desde esa fecha se quitan los
--   fijos anteriores y se asignan los nuevos. No se tocan los turnos que ya empezaron, que tienen
--   algún fichaje o aviso, o que están cancelados, ni los empleados que se agregaron a mano.
--
--   Para distinguir al fijo del agregado a mano hace falta recordar el origen de la asignación:
--   assignments.from_fixed. Un trigger lo marca al insertar cuando el empleado es, en ese momento,
--   fijo del servicio del turno (así cubre generate_shifts, create_shift y la asignación individual
--   sin tocarlos). Las asignaciones vigentes anteriores a esta migración se marcan con el mismo
--   criterio: las del empleado que hoy es fijo del servicio del turno. Un empleado que ya había
--   dejado de ser fijo antes de esta migración y conserva asignaciones en turnos futuros queda
--   como «a mano» (no se puede reconstruir de dónde vino) y se saca a mano.
--
--   Las asignaciones nuevas usan app.assign_employee_core en modo estricto: las mismas validaciones
--   que la asignación individual y que generate_shifts (licencia, superposición, disponibilidad,
--   empleado inactivo, dotación completa...). Lo que no se puede asignar no frena el resto: se
--   saltea y se informa con su motivo.
-- =================================================================================================

alter table public.assignments
  add column from_fixed boolean not null default false;

comment on column public.assignments.from_fixed is
  'Origen de la asignación (0080, OD-11): true si el empleado era fijo del servicio del turno cuando se asignó (lo marca el trigger trg_assignments_mark_from_fixed). apply_service_fixed_employees solo quita las asignaciones con from_fixed = true; las demás se consideran agregadas a mano.';

create function app.mark_assignment_from_fixed()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.removed_at is null and exists (
    select 1
    from public.shifts sh
    join public.service_fixed_employees f on f.service_id = sh.service_id and f.employee_id = new.employee_id
    where sh.id = new.shift_id
  ) then
    new.from_fixed := true;
  end if;

  return new;
end;
$$;

comment on function app.mark_assignment_from_fixed() is
  'Trigger de assignments (0080, OD-11): marca from_fixed = true si el empleado es fijo del servicio del turno al insertar la asignación.';

revoke execute on function app.mark_assignment_from_fixed() from public, anon, authenticated;

create trigger trg_assignments_mark_from_fixed
before insert on public.assignments
for each row execute function app.mark_assignment_from_fixed();

-- Asignaciones vigentes anteriores: las del empleado que hoy es fijo del servicio del turno. No se
-- quiere cambiar updated_at de todas: se apaga ese trigger solo durante la carga.
alter table public.assignments disable trigger trg_set_updated_at;

update public.assignments a
set from_fixed = true
from public.shifts sh
join public.service_fixed_employees f on f.service_id = sh.service_id
where a.shift_id = sh.id
  and f.employee_id = a.employee_id
  and a.removed_at is null
  and a.from_fixed = false;

alter table public.assignments enable trigger trg_set_updated_at;

-- ---------------------------------------------------------------------------------------------
-- apply_service_fixed_employees
-- ---------------------------------------------------------------------------------------------

create function public.apply_service_fixed_employees(
  p_service_id uuid,
  p_from_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_fixed uuid[];
  v_shift record;
  v_asg record;
  v_emp uuid;
  v_name text;
  v_remaining integer;
  v_code text;
  v_msg text;
  v_skip_code text;
  v_removed jsonb;
  v_added jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_skipped_shifts integer := 0;
  v_partial_count integer := 0;
  v_removed_total integer := 0;
  v_added_total integer := 0;
  v_shift_partial boolean;
begin
  perform app.require_role('owner', 'admin');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  select * into v_service from public.services where id = p_service_id and deleted_at is null for update;

  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  select coalesce(array_agg(f.employee_id order by f.created_at, f.employee_id), array[]::uuid[])
  into v_fixed
  from public.service_fixed_employees f
  where f.service_id = p_service_id;

  for v_shift in
    select sh.*
    from public.shifts sh
    where sh.service_id = p_service_id
      and sh.deleted_at is null
      and sh.shift_date >= p_from_date
    order by sh.shift_date, sh.start_time, sh.id
    for update
  loop
    -- Turnos que no se tocan.
    v_skip_code := case
      when v_shift.status = 'cancelled' then 'SHIFT_CANCELLED'
      when v_shift.status in ('in_progress', 'completed') or now() >= v_shift.starts_at then 'SHIFT_STARTED'
      when exists (
        select 1 from public.attendance_records ar
        join public.assignments a on a.id = ar.assignment_id
        where a.shift_id = v_shift.id
      ) then 'HAS_ATTENDANCE'
      when exists (
        select 1 from public.attendance_notices n
        join public.assignments a on a.id = n.assignment_id
        where a.shift_id = v_shift.id and n.voided_at is null
      ) then 'HAS_NOTICES'
      else null
    end;

    if v_skip_code is not null then
      v_skipped_shifts := v_skipped_shifts + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'scope', 'shift',
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'employee_id', null,
        'employee_name', null,
        'code', v_skip_code,
        'message', case v_skip_code
          when 'SHIFT_CANCELLED' then 'El turno está cancelado.'
          when 'SHIFT_STARTED' then 'El turno ya empezó.'
          when 'HAS_ATTENDANCE' then 'El turno ya tiene fichajes.'
          else 'El turno ya tiene avisos de demora o ausencia.'
        end
      );
      continue;
    end if;

    v_removed := '[]'::jsonb;
    v_added := '[]'::jsonb;
    v_shift_partial := false;

    -- 1. Quitar los fijos anteriores: asignaciones vigentes de origen fijo cuyo empleado ya no es fijo.
    for v_asg in
      select a.id, a.employee_id
      from public.assignments a
      where a.shift_id = v_shift.id
        and a.removed_at is null
        and a.from_fixed
        and not (a.employee_id = any (v_fixed))
      order by a.created_at, a.id
    loop
      update public.assignments
      set removed_at = now(),
          removed_by = auth.uid(),
          removed_reason = 'Cambio de los empleados fijos del servicio'
      where id = v_asg.id and removed_at is null;

      v_removed := v_removed || jsonb_build_object(
        'employee_id', v_asg.employee_id,
        'employee_name', (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = v_asg.employee_id)
      );
    end loop;

    if jsonb_array_length(v_removed) > 0 then
      select count(*) into v_remaining
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      -- Transición assigned -> scheduled si la baja deja la dotación incompleta (04 sección 6.1).
      update public.shifts
      set status = 'scheduled'
      where id = v_shift.id and status = 'assigned' and v_remaining < required_staff;
    end if;

    -- 2. Asignar los fijos nuevos (los que todavía no están asignados), con las mismas validaciones
    --    que la asignación individual en modo estricto.
    foreach v_emp in array v_fixed
    loop
      if exists (
        select 1 from public.assignments a
        where a.shift_id = v_shift.id and a.employee_id = v_emp and a.removed_at is null
      ) then
        continue;
      end if;

      select btrim(p.first_name || ' ' || p.last_name) into v_name from public.profiles p where p.id = v_emp;

      begin
        perform app.assign_employee_core(v_shift.id, v_emp, null, null, true);
        v_added := v_added || jsonb_build_object('employee_id', v_emp, 'employee_name', v_name);
      exception
        when sqlstate 'P0001' then
          get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text;
          v_shift_partial := true;
          v_skipped := v_skipped || jsonb_build_object(
            'scope', 'employee',
            'shift_id', v_shift.id,
            'shift_date', v_shift.shift_date,
            'employee_id', v_emp,
            'employee_name', v_name,
            'code', v_code,
            'message', v_msg
          );
      end;
    end loop;

    if jsonb_array_length(v_removed) = 0 and jsonb_array_length(v_added) = 0 then
      -- Nada que cambiar en este turno (ya estaba como corresponde, o no se pudo asignar a nadie).
      if not v_shift_partial then
        v_unchanged_count := v_unchanged_count + 1;
      else
        v_partial_count := v_partial_count + 1;
      end if;
    else
      v_updated_count := v_updated_count + 1;
      v_removed_total := v_removed_total + jsonb_array_length(v_removed);
      v_added_total := v_added_total + jsonb_array_length(v_added);
      if v_shift_partial then
        v_partial_count := v_partial_count + 1;
      end if;
      v_updated := v_updated || jsonb_build_object(
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'removed', v_removed,
        'added', v_added
      );
    end if;
  end loop;

  return jsonb_build_object(
    'service_id', p_service_id,
    'from_date', p_from_date,
    'fixed_employee_ids', to_jsonb(v_fixed),
    'updated_count', v_updated_count,
    'unchanged_count', v_unchanged_count,
    'skipped_count', v_skipped_shifts,
    'partial_count', v_partial_count,
    'assignments_removed', v_removed_total,
    'assignments_added', v_added_total,
    'updated', v_updated,
    'skipped', v_skipped
  );
end;
$$;

comment on function public.apply_service_fixed_employees(uuid, date) is
  'Aplica los empleados fijos actuales del servicio a sus turnos ya creados con fecha >= p_from_date (OD-11, 0080). O, A (FORBIDDEN si no). En cada turno: quita las asignaciones de origen fijo (assignments.from_fixed) de quienes ya no son fijos y asigna a los fijos que faltan con app.assign_employee_core en modo estricto (mismas validaciones que la asignación individual). No toca los turnos cancelados, que ya empezaron o que tienen fichajes o avisos, ni a los empleados agregados a mano. FROM_DATE_REQUIRED, SERVICE_NOT_FOUND. Devuelve {"service_id", "from_date", "fixed_employee_ids", "updated_count" (turnos con cambios), "unchanged_count", "skipped_count" (turnos salteados), "partial_count" (turnos donde algún fijo no se pudo asignar), "assignments_removed", "assignments_added", "updated": [{shift_id, shift_date, removed: [{employee_id, employee_name}], added: [...]}], "skipped": [{scope: "shift" | "employee", shift_id, shift_date, employee_id, employee_name, code, message}]}. Códigos de scope shift: SHIFT_CANCELLED, SHIFT_STARTED, HAS_ATTENDANCE, HAS_NOTICES. Códigos de scope employee: los de la asignación individual (ON_LEAVE, ASSIGNMENT_OVERLAP, OUTSIDE_AVAILABILITY, EMPLOYEE_NOT_ACTIVE, SHIFT_FULL...). Un solo llamado es una transacción: si falla algo inesperado no queda nada a medias.';

revoke execute on function public.apply_service_fixed_employees(uuid, date) from public, anon;
grant execute on function public.apply_service_fixed_employees(uuid, date) to authenticated, service_role;
