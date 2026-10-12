-- 0045 (P19.7 paquete B, AJ3-01): arreglo de delete_service.
--
-- 0044 pasaba el id del servicio como target_id de security_events, pero esa columna es FK a
-- profiles (la persona afectada por el evento): el insert fallaba y, con él, todo el borrado.
-- Ahora target_id va null y el servicio queda en details.service_id. Mismo comportamiento en todo
-- lo demás. Detectado por el pgTAP de 0044 contra App_dev (12 oct 2026).

create or replace function public.delete_service(p_service_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_blocking_count int;
  v_attendance boolean;
  v_shifts int;
  v_assignments int;
  v_tasks int;
begin
  perform app.require_role('owner', 'admin');

  select * into v_service from public.services where id = p_service_id for update;
  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  -- Traba los turnos y las asignaciones para que nadie fiche mientras se decide.
  perform 1 from public.shifts where service_id = p_service_id for update;
  perform 1 from public.assignments a join public.shifts sh on sh.id = a.shift_id
    where sh.service_id = p_service_id for update of a;

  select
    count(*) filter (where cardinality(b.reasons) > 0),
    coalesce(bool_or(b.reasons && array['ATTENDANCE_RECORDS', 'ATTENDANCE_NOTICES']), false)
  into v_blocking_count, v_attendance
  from app.service_delete_blockers(p_service_id) b;

  if v_blocking_count > 0 then
    if v_attendance then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede eliminar: hay turnos de este servicio con fichajes o avisos de asistencia. Dalo de baja en su lugar.',
        hint = 'SERVICE_HAS_ATTENDANCE';
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'No se puede eliminar: hay turnos de este servicio con supervisiones. Dalo de baja en su lugar.',
      hint = 'SERVICE_HAS_SUPERVISIONS';
  end if;

  select count(*) into v_shifts from public.shifts where service_id = p_service_id;
  select count(*) into v_assignments from public.assignments a
    join public.shifts sh on sh.id = a.shift_id where sh.service_id = p_service_id;
  select count(*) into v_tasks from public.shift_tasks t
    join public.shifts sh on sh.id = t.shift_id where sh.service_id = p_service_id;

  delete from public.shift_tasks t using public.shifts sh
    where t.shift_id = sh.id and sh.service_id = p_service_id;
  delete from public.shift_observations o using public.shifts sh
    where o.shift_id = sh.id and sh.service_id = p_service_id;
  delete from public.assignments a using public.shifts sh
    where a.shift_id = sh.id and sh.service_id = p_service_id;
  delete from public.shifts where service_id = p_service_id;
  delete from public.service_fixed_employees where service_id = p_service_id;
  delete from public.services where id = p_service_id;

  -- target_id queda null: security_events.target_id es FK a profiles (la persona afectada) y un
  -- servicio no es una persona. El servicio va en details.service_id (0045).
  perform app.log_security_event(
    'service_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'service_id', p_service_id,
      'service_name', v_service.name,
      'client_id', v_service.client_id,
      'site_id', v_service.site_id,
      'shifts_deleted', v_shifts,
      'assignments_deleted', v_assignments,
      'tasks_deleted', v_tasks
    )
  );

  return jsonb_build_object(
    'service_id', p_service_id,
    'shifts_deleted', v_shifts,
    'assignments_deleted', v_assignments
  );
end;
$$;

comment on function public.delete_service(uuid) is
  'Elimina físicamente el servicio y todos sus turnos con lo que cuelga (asignaciones, tareas del turno, observaciones, empleados fijos) en una sola transacción (0044, AJ3-01). O, A (FORBIDDEN si no). SERVICE_NOT_FOUND. SERVICE_HAS_ATTENDANCE si algún turno tiene fichajes o avisos de asistencia y SERVICE_HAS_SUPERVISIONS si tiene supervisiones (no borra nada; se sugiere dar de baja). Registra service_deleted en security_events (actor; target_id null porque es FK a profiles; el servicio y las cantidades en details, 0045). Devuelve jsonb {service_id, shifts_deleted, assignments_deleted}. Excepción deliberada a «nada se borra físicamente», decidida por Mike para servicios cargados por duplicado.';
