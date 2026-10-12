-- 0044 (P19.7 paquete B, AJ3-05 y AJ3-01): repetición mensual y eliminación de servicios.
--
-- Aditiva y segura con datos existentes: la columna nueva admite null (= todas las semanas, el
-- comportamiento de siempre) y las dos RPC son funciones nuevas.
--
--   1. AJ3-05 · services.weeks_of_month smallint[] null: semanas del mes en que se presta el
--      servicio. null = todas. 1 a 4 = la 1.ª a 4.ª ocurrencia de ese día de la semana en el mes
--      (día del mes 1-7 = 1.ª, 8-14 = 2.ª, 15-21 = 3.ª, 22-28 = 4.ª) y 5 = la ÚLTIMA ocurrencia de
--      ese día de la semana en el mes (puede coincidir con la 4.ª; si coinciden, el turno se
--      genera una sola vez). Helpers inmutables app.valid_weeks_of_month y
--      app.date_matches_weeks_of_month, y generate_shifts (partiendo de la versión de 0041) que
--      los respeta. Editar el servicio no toca los turnos ya generados.
--   2. AJ3-01 · service_delete_preview y delete_service (O, A): borran el servicio y sus turnos
--      solo si ningún turno tiene fichajes, avisos de asistencia ni supervisiones. Deja un
--      registro en security_events (nuevo valor service_deleted).

alter type public.security_event_type add value if not exists 'service_deleted';

-- ---------------------------------------------------------------------------------------------
-- 1. Repetición mensual
-- ---------------------------------------------------------------------------------------------

create function app.valid_weeks_of_month(p_weeks smallint[])
returns boolean
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select
    p_weeks is null
    or (
      cardinality(p_weeks) > 0
      and array_ndims(p_weeks) = 1
      and not exists (
        select 1 from unnest(p_weeks) as w(value) where w.value is null or w.value not between 1 and 5
      )
      and cardinality(p_weeks) = (select count(distinct w.value) from unnest(p_weeks) as w(value))
    );
$$;

comment on function app.valid_weeks_of_month(smallint[]) is
  'Check de services.weeks_of_month (0044): null (todas las semanas) o un arreglo no vacío, unidimensional, con valores entre 1 y 5 y sin repetidos.';

create function app.date_matches_weeks_of_month(p_date date, p_weeks smallint[])
returns boolean
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select
    p_weeks is null
    or (((extract(day from p_date)::int - 1) / 7 + 1)::smallint = any(p_weeks))
    or (
      5 = any(p_weeks)
      and extract(month from p_date + 7) <> extract(month from p_date)
    );
$$;

comment on function app.date_matches_weeks_of_month(date, smallint[]) is
  'True si la fecha cae en alguna de las semanas del mes elegidas (0044, AJ3-05). p_weeks null = todas las semanas. 1 a 4 = n-ésima ocurrencia de ese día de la semana en el mes (día del mes 1-7, 8-14, 15-21, 22-28); 5 = la última ocurrencia de ese día de la semana en el mes (la que no tiene otra igual 7 días después). Una fecha del 29 al 31 solo coincide con 5.';

alter table public.services add column weeks_of_month smallint[];

alter table public.services
  add constraint services_weeks_of_month_check check (app.valid_weeks_of_month(weeks_of_month));

comment on column public.services.weeks_of_month is
  'Semanas del mes en que se presta el servicio (0044, AJ3-05). null = todas las semanas. Valores 1 a 5: 1 a 4 = 1.ª a 4.ª ocurrencia de cada día de weekdays en el mes; 5 = la última ocurrencia. No vacío y sin repetidos. generate_shifts solo crea el turno de una fecha si cumple weekdays y alguna de estas semanas.';

-- generate_shifts: versión de 0041 más la condición de semanas del mes (AJ3-05). Conserva los
-- permisos (create or replace) y todo lo de 0037 (A terminar), 0040 y 0041 (empleados fijos).

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
        and app.date_matches_weeks_of_month(gs::date, s.weeks_of_month)
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
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta days_of_week, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente. O, A + generate_shifts. Los turnos de un servicio «A terminar» nacen «A terminar» (0037). Desde 0041 (AJ2-17) cada turno recién creado asigna a los empleados fijos del servicio (service_fixed_employees) con app.assign_employee_core en modo estricto: lo que no se puede asignar NO frena la generación, se saltea y se informa. Devuelve {"created", "skipped", "holidays_skipped", "assigned" (asignaciones hechas), "unassigned" [{shift_id, shift_date, service_id, employee_id, employee_name, code, message}] con code ON_LEAVE, OUTSIDE_AVAILABILITY, ASSIGNMENT_OVERLAP, EMPLOYEE_NOT_ACTIVE, SHIFT_FULL..., "past_without_fixed" (turnos creados que ya habían empezado y por eso no reciben fijos)}. Desde 0044 (AJ3-05) solo crea el turno de una fecha si, además del día de la semana, cumple services.weeks_of_month (null = todas las semanas) con app.date_matches_weeks_of_month.';

-- ---------------------------------------------------------------------------------------------
-- 2. Eliminar servicio (AJ3-01)
-- ---------------------------------------------------------------------------------------------

-- Quién puede: dueño y administrador, igual que editar servicios (services_write_admin = is_admin).
-- Ninguna capacidad de admin_capability protege hoy la edición de servicios, así que tampoco esta.
-- Qué cuelga de un turno (FK a shifts): assignments, shift_tasks, shift_observations y
-- supervisions (y de ellas supervision_attendance y ratings). De una asignación: attendance_records
-- y attendance_notices. Del servicio: service_fixed_employees y shifts.
-- Bloquean el borrado (son historia que no se pierde): fichajes, avisos de demora/ausencia/en camino
-- y supervisiones (con sus calificaciones). Lo demás (asignaciones sin actividad, tareas copiadas,
-- observaciones, empleados fijos) se borra junto con los turnos.

-- Función interna: un renglón por turno del servicio, con la lista de motivos que lo bloquean.
create function app.service_delete_blockers(p_service_id uuid)
returns table (shift_id uuid, shift_date date, reasons text[])
language sql
stable
set search_path = public, app, pg_temp
as $$
  select
    sh.id,
    sh.shift_date,
    array_remove(array[
      case when exists (
        select 1 from public.attendance_records ar
        join public.assignments a on a.id = ar.assignment_id
        where a.shift_id = sh.id
      ) then 'ATTENDANCE_RECORDS' end,
      case when exists (
        select 1 from public.attendance_notices an
        join public.assignments a on a.id = an.assignment_id
        where a.shift_id = sh.id
      ) then 'ATTENDANCE_NOTICES' end,
      case when exists (
        select 1 from public.supervisions sv where sv.shift_id = sh.id
      ) then 'SUPERVISIONS' end
    ], null)
  from public.shifts sh
  where sh.service_id = p_service_id
  order by sh.shift_date, sh.id;
$$;

comment on function app.service_delete_blockers(uuid) is
  'Interna de service_delete_preview y delete_service (0044): por cada turno del servicio, los motivos que impiden borrarlo (ATTENDANCE_RECORDS, ATTENDANCE_NOTICES, SUPERVISIONS).';

revoke execute on function app.service_delete_blockers(uuid) from public, anon, authenticated;

create function public.service_delete_preview(p_service_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_blocking jsonb;
  v_shifts int;
  v_assignments int;
begin
  perform app.require_role('owner', 'admin');

  select * into v_service from public.services where id = p_service_id;
  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  select count(*) into v_shifts from public.shifts where service_id = p_service_id;

  select count(*) into v_assignments
  from public.assignments a
  join public.shifts sh on sh.id = a.shift_id
  where sh.service_id = p_service_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shift_id', b.shift_id,
    'shift_date', b.shift_date,
    'reasons', to_jsonb(b.reasons)
  ) order by b.shift_date, b.shift_id), '[]'::jsonb)
  into v_blocking
  from app.service_delete_blockers(p_service_id) b
  where cardinality(b.reasons) > 0;

  return jsonb_build_object(
    'service_id', v_service.id,
    'service_name', v_service.name,
    'shifts_to_delete', v_shifts,
    'assignments_to_delete', v_assignments,
    'blocking_shifts', v_blocking,
    'can_delete', jsonb_array_length(v_blocking) = 0
  );
end;
$$;

comment on function public.service_delete_preview(uuid) is
  'Qué pasaría al borrar el servicio (0044, AJ3-01). O, A (FORBIDDEN si no). SERVICE_NOT_FOUND. Devuelve jsonb {service_id, service_name, shifts_to_delete (todos los turnos del servicio, también cancelados), assignments_to_delete (asignaciones de esos turnos, también las quitadas), blocking_shifts [{shift_id, shift_date, reasons[]}] con reasons ATTENDANCE_RECORDS (fichajes), ATTENDANCE_NOTICES (avisos de demora, ausencia o en camino) o SUPERVISIONS (supervisiones, con sus calificaciones), can_delete (true si blocking_shifts está vacío)}. No modifica nada.';

revoke execute on function public.service_delete_preview(uuid) from public, anon;
grant execute on function public.service_delete_preview(uuid) to authenticated;

create function public.delete_service(p_service_id uuid)
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

  perform app.log_security_event(
    'service_deleted',
    auth.uid(),
    p_service_id,
    jsonb_build_object(
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
  'Elimina físicamente el servicio y todos sus turnos con lo que cuelga (asignaciones, tareas del turno, observaciones, empleados fijos) en una sola transacción (0044, AJ3-01). O, A (FORBIDDEN si no). SERVICE_NOT_FOUND. SERVICE_HAS_ATTENDANCE si algún turno tiene fichajes o avisos de asistencia y SERVICE_HAS_SUPERVISIONS si tiene supervisiones (no borra nada; se sugiere dar de baja). Registra service_deleted en security_events (actor, servicio, cantidades). Devuelve jsonb {service_id, shifts_deleted, assignments_deleted}. Excepción deliberada a «nada se borra físicamente», decidida por Mike para servicios cargados por duplicado.';

revoke execute on function public.delete_service(uuid) from public, anon;
grant execute on function public.delete_service(uuid) to authenticated;
