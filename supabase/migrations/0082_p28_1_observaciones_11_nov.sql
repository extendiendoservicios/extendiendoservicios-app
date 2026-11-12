-- 0082_p28_1_observaciones_11_nov.sql
-- P28.1 (observaciones de la dirección del 11 nov 2026, OF-02, OF-04b, OF-05, OF-08, OF-10, OF-11,
-- OF-13, OF-19, OF-19b y OF-20). Una sola migración. OF-18 (la excepción del dueño para los
-- bloqueos por horario) NO va acá: espera la respuesta C-04 de Mike (ver las marcas «OF-18» en
-- app.assign_employee_core y update_shift_time).
--
--   1. Ayudas internas: mensajes con nombre, sede, servicio, fecha y horario (OF-08).
--   2. Feriados (OF-19, OF-19b): unicidad solo entre los vigentes, upsert_holiday,
--      holiday_shift_conflicts y remove_holiday_shifts.
--   3. cancel_shift libera a los empleados (OF-04b), con corrección de los datos existentes.
--   4. Licencias superpuestas permitidas (OF-20): se quita employee_leaves_no_overlap.
--   5. ASSIGNMENT_OVERLAP y ON_LEAVE con detalle (OF-08): assign_employee_core, update_shift_time,
--      update_assignment_time, create_shift_core, generate_shifts y apply_service_fixed_employees.
--   6. Cierre automático de asignaciones (OF-11): auto_closed, app.auto_close_assignments y pg_cron.
--   7. Los cambios del servicio llegan a los turnos (OF-05): preview_service_changes y
--      apply_service_changes.
--   8. Avisos de duplicados (OF-02): service_overlaps y shift_overlaps_in_site.
--   9. Cronograma arrastrable (OF-10): move_assignment.
--  10. Mapa por estado de la sede (OF-13): v_sites_day_status.

-- ---------------------------------------------------------------------------------------------
-- 1. Ayudas internas de mensajes (OF-08)
-- ---------------------------------------------------------------------------------------------

-- Texto JSON a jsonb sin romper: devuelve null si no es JSON. Los llamadores que atrapan un error
-- de las RPC lo usan para pasar el campo `detail` del error a la respuesta como objeto.
create function app.try_jsonb(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return p_text::jsonb;
exception
  when others then
    return null;
end;
$$;

comment on function app.try_jsonb(text) is
  'Uso interno (0082): convierte un texto JSON en jsonb; null si viene vacío o no es JSON.';

-- Cómo se nombra a una persona en un mensaje: su apellido («Acosta ya está en...»).
create function app.person_label(p_profile_id uuid)
returns text
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (select coalesce(nullif(btrim(p.last_name), ''), nullif(btrim(p.first_name), ''))
     from public.profiles p where p.id = p_profile_id),
    'El empleado'
  );
$$;

comment on function app.person_label(uuid) is
  'Uso interno (0082, OF-08): apellido de la persona (o el nombre si no tiene apellido) para los mensajes; «El empleado» si no existe.';

-- «lun 9/11».
create function app.fmt_dia(p_date date)
returns text
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select (array['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'])[extract(dow from p_date)::int + 1]
    || ' ' || extract(day from p_date)::int || '/' || extract(month from p_date)::int;
$$;

comment on function app.fmt_dia(date) is
  'Uso interno (0082, OF-08): día abreviado y fecha corta para los mensajes, por ejemplo «lun 9/11».';

-- «15:00».
create function app.fmt_hora(p_time time)
returns text
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select to_char(p_time, 'HH24:MI');
$$;

comment on function app.fmt_hora(time) is
  'Uso interno (0082, OF-08): hora HH24:MI para los mensajes.';

-- «del 3 al 10/11», «del 28/10 al 3/11», «el 5/11», «desde el 3/11».
create function app.leave_range_text(p_starts date, p_ends date)
returns text
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select case
    when p_ends is null then
      'desde el ' || extract(day from p_starts)::int || '/' || extract(month from p_starts)::int
    when p_ends = p_starts then
      'el ' || extract(day from p_starts)::int || '/' || extract(month from p_starts)::int
    when date_trunc('month', p_starts) = date_trunc('month', p_ends) then
      'del ' || extract(day from p_starts)::int || ' al ' || extract(day from p_ends)::int || '/' || extract(month from p_ends)::int
    else
      'del ' || extract(day from p_starts)::int || '/' || extract(month from p_starts)::int
      || ' al ' || extract(day from p_ends)::int || '/' || extract(month from p_ends)::int
  end;
$$;

comment on function app.leave_range_text(date, date) is
  'Uso interno (0082, OF-08): rango de una licencia para los mensajes («del 3 al 10/11», «el 5/11», «desde el 3/11» si no tiene fin).';

-- Licencias que cubren una fecha: null si no hay ninguna; si hay (puede haber más de una desde
-- OF-20), un objeto {code: ON_LEAVE, employee_id, employee_name, date, leaves: [{leave_id, reason,
-- starts_on, ends_on}], message}. El mensaje dice motivo y rango: «Boutter tiene licencia
-- (Vacaciones) del 3 al 10/11.».
create function app.leave_conflict(p_employee_id uuid, p_date date)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'code', 'ON_LEAVE',
    'employee_id', p_employee_id,
    'employee_name', app.person_label(p_employee_id),
    'date', p_date,
    'leaves', jsonb_agg(
      jsonb_build_object('leave_id', l.id, 'reason', l.reason, 'starts_on', l.starts_on, 'ends_on', l.ends_on)
      order by l.starts_on, l.id
    ),
    'message', app.person_label(p_employee_id) || ' tiene licencia '
      || string_agg(
           case when nullif(btrim(l.reason), '') is null then '' else '(' || btrim(l.reason) || ') ' end
             || app.leave_range_text(l.starts_on, l.ends_on),
           ' y ' order by l.starts_on, l.id
         )
      || '.'
  )
  from public.employee_leaves l
  where l.employee_id = p_employee_id
    and l.deleted_at is null
    and l.starts_on <= p_date
    and (l.ends_on is null or l.ends_on >= p_date)
  having count(*) > 0;
$$;

comment on function app.leave_conflict(uuid, date) is
  'Uso interno (0082, OF-08, OF-20): las licencias vigentes que cubren la fecha, con motivo y rango, o null si no hay. Puede haber más de una (OF-20).';

-- Primera asignación vigente del empleado que se superpone con [p_from, p_to), o null. Objeto
-- {code: ASSIGNMENT_OVERLAP, employee_id, employee_name, conflict_shift_id, conflict_assignment_id,
-- client_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time,
-- end_time, open_ended, message}. p_except_shift_id deja afuera las asignaciones de ese turno (el
-- propio, que se está moviendo o editando).
create function app.overlap_conflict(
  p_employee_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_except_shift_id uuid default null
)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'code', 'ASSIGNMENT_OVERLAP',
    'employee_id', p_employee_id,
    'employee_name', app.person_label(p_employee_id),
    'conflict_shift_id', sh.id,
    'conflict_assignment_id', b.id,
    'client_id', sh.client_id,
    'client_name', coalesce(nullif(btrim(cl.trade_name), ''), cl.legal_name),
    'site_id', sh.site_id,
    'site_name', si.name,
    'service_id', sh.service_id,
    'service_name', sv.name,
    'shift_date', sh.shift_date,
    'start_time', coalesce(b.start_time, sh.start_time),
    'end_time', coalesce(b.end_time, sh.end_time),
    'open_ended', (sh.open_ended and b.end_time is null),
    'message', app.person_label(p_employee_id) || ' ya está en ' || si.name
      || ' (' || coalesce(sv.name, 'turno manual') || ') el ' || app.fmt_dia(sh.shift_date)
      || ' de ' || app.fmt_hora(coalesce(b.start_time, sh.start_time))
      || case
           when sh.open_ended and b.end_time is null then ' (a terminar).'
           else ' a ' || app.fmt_hora(coalesce(b.end_time, sh.end_time)) || '.'
         end
  )
  from public.assignments b
  join public.shifts sh on sh.id = b.shift_id
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  left join public.services sv on sv.id = sh.service_id
  where b.employee_id = p_employee_id
    and b.removed_at is null
    and b."window" && tstzrange(p_from, p_to, '[)')
    and (p_except_shift_id is null or b.shift_id <> p_except_shift_id)
  order by lower(b."window"), b.id
  limit 1;
$$;

comment on function app.overlap_conflict(uuid, timestamptz, timestamptz, uuid) is
  'Uso interno (0082, OF-08): la primera asignación vigente del empleado que se superpone con [p_from, p_to), con sede, servicio, fecha y horario, y el mensaje «Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.». Null si no hay choque.';

-- Detalle de un error con uno o varios choques: las claves del primero y el arreglo completo en
-- `conflicts`.
create function app.conflicts_detail(p_conflicts jsonb)
returns jsonb
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select coalesce(p_conflicts -> 0, '{}'::jsonb) || jsonb_build_object('conflicts', coalesce(p_conflicts, '[]'::jsonb));
$$;

comment on function app.conflicts_detail(jsonb) is
  'Uso interno (0082, OF-08): detalle del error de superposición o licencia = claves del primer choque + conflicts (todos los choques).';

revoke execute on function app.try_jsonb(text) from public, anon, authenticated;
revoke execute on function app.person_label(uuid) from public, anon, authenticated;
revoke execute on function app.fmt_dia(date) from public, anon, authenticated;
revoke execute on function app.fmt_hora(time) from public, anon, authenticated;
revoke execute on function app.leave_range_text(date, date) from public, anon, authenticated;
revoke execute on function app.leave_conflict(uuid, date) from public, anon, authenticated;
revoke execute on function app.overlap_conflict(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function app.conflicts_detail(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Feriados (OF-19, OF-19b)
-- ---------------------------------------------------------------------------------------------

-- La fecha era única contando los feriados dados de baja: una fecha baja quedaba trabada para
-- siempre. Ahora es única solo entre los vigentes.
alter table public.holidays drop constraint if exists holidays_holiday_date_key;

create unique index holidays_holiday_date_active_key
  on public.holidays (holiday_date)
  where deleted_at is null;

comment on index public.holidays_holiday_date_active_key is
  'Unicidad de holidays.holiday_date solo entre los feriados vigentes (deleted_at is null), 0082, OF-19: una fecha dada de baja se puede volver a cargar.';

create function public.upsert_holiday(p_date date, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_name text := nullif(btrim(p_name), '');
  v_row public.holidays;
  v_action text;
begin
  perform app.require_role('owner');

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la fecha del feriado.',
      hint = 'HOLIDAY_DATE_REQUIRED';
  end if;

  if v_name is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el nombre del feriado.',
      hint = 'HOLIDAY_NAME_REQUIRED';
  end if;

  -- Serializa las altas simultáneas de la misma fecha.
  perform pg_advisory_xact_lock(hashtext('holidays:' || p_date::text));

  select * into v_row
  from public.holidays h
  where h.holiday_date = p_date and h.deleted_at is null;

  if v_row.id is not null then
    if v_row.name is distinct from v_name then
      update public.holidays
      set name = v_name, updated_by = auth.uid()
      where id = v_row.id
      returning * into v_row;
      v_action := 'updated';
    else
      v_action := 'unchanged';
    end if;
  else
    select * into v_row
    from public.holidays h
    where h.holiday_date = p_date and h.deleted_at is not null
    order by h.deleted_at desc, h.id
    limit 1
    for update;

    if v_row.id is not null then
      update public.holidays
      set deleted_at = null, name = v_name, updated_by = auth.uid()
      where id = v_row.id
      returning * into v_row;
      v_action := 'reactivated';
    else
      insert into public.holidays (holiday_date, name, created_by)
      values (p_date, v_name, auth.uid())
      returning * into v_row;
      v_action := 'created';
    end if;
  end if;

  return jsonb_build_object('holiday', to_jsonb(v_row), 'action', v_action);
end;
$$;

comment on function public.upsert_holiday(date, text) is
  'Alta de un feriado (0082, OF-19). Solo el dueño (FORBIDDEN si no, igual que la política de escritura de holidays). Si la fecha tiene un feriado vigente le cambia el nombre (action = updated, o unchanged si es el mismo); si solo hay uno dado de baja lo reactiva (reactivated); si no, lo crea (created). HOLIDAY_DATE_REQUIRED, HOLIDAY_NAME_REQUIRED. Devuelve {"holiday": <fila>, "action": "created" | "reactivated" | "updated" | "unchanged"}. La unicidad es solo entre los vigentes (holidays_holiday_date_active_key).';

revoke execute on function public.upsert_holiday(date, text) from public, anon;
grant execute on function public.upsert_holiday(date, text) to authenticated;

-- Turnos de un día de servicios que no trabajan feriados. Solo lectura. No exige que la fecha ya
-- sea feriado (la pantalla puede consultarlo antes de cargarlo): is_holiday lo informa.
create function public.holiday_shift_conflicts(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shifts jsonb;
begin
  perform app.require_role('owner', 'admin');

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la fecha.',
      hint = 'HOLIDAY_DATE_REQUIRED';
  end if;

  select coalesce(jsonb_agg(x.j order by x.sort_time, x.sort_id), '[]'::jsonb)
  into v_shifts
  from (
    select
      jsonb_build_object(
        'shift_id', sh.id,
        'shift_date', sh.shift_date,
        'start_time', sh.start_time,
        'end_time', sh.end_time,
        'status', sh.status,
        'service_id', sv.id,
        'service_name', sv.name,
        'client_name', coalesce(nullif(btrim(cl.trade_name), ''), cl.legal_name),
        'site_name', si.name,
        'assignments_count', (select count(*) from public.assignments a where a.shift_id = sh.id and a.removed_at is null),
        'has_history', app.shift_has_history(sh.id)
      ) as j,
      sh.start_time as sort_time,
      sh.id as sort_id
    from public.shifts sh
    join public.services sv on sv.id = sh.service_id and sv.works_on_holidays = false
    join public.clients cl on cl.id = sh.client_id
    join public.sites si on si.id = sh.site_id
    where sh.shift_date = p_date
      and sh.deleted_at is null
      and sh.generated
      and sh.status <> 'cancelled'
  ) x;

  return jsonb_build_object(
    'date', p_date,
    'is_holiday', exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null),
    'deletable_count', (select count(*) from jsonb_array_elements(v_shifts) s where (s ->> 'has_history')::boolean = false),
    'with_history_count', (select count(*) from jsonb_array_elements(v_shifts) s where (s ->> 'has_history')::boolean),
    'shifts', v_shifts
  );
end;
$$;

comment on function public.holiday_shift_conflicts(date) is
  'Turnos de ese día que habría que sacar porque el servicio no trabaja feriados (0082, OF-19b). Solo lectura. O, A. Cuenta los turnos generados (generated = true), no cancelados, de servicios con works_on_holidays = false; los creados a mano no se tocan. HOLIDAY_DATE_REQUIRED. Devuelve {"date", "is_holiday", "deletable_count" (sin historia), "with_history_count" (con historia: no se borran), "shifts": [{shift_id, shift_date, start_time, end_time, status, service_id, service_name, client_name, site_name, assignments_count, has_history}]}.';

revoke execute on function public.holiday_shift_conflicts(date) from public, anon;
grant execute on function public.holiday_shift_conflicts(date) to authenticated;

create function public.remove_holiday_shifts(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row record;
  v_res jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_shifts integer := 0;
  v_assignments integer := 0;
  v_tasks integer := 0;
  v_observations integer := 0;
  v_event public.security_events;
begin
  perform app.require_capability('cancel_shifts');

  if p_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la fecha.',
      hint = 'HOLIDAY_DATE_REQUIRED';
  end if;

  if not exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    raise exception using
      errcode = 'P0001',
      message = 'Esa fecha no es feriado.',
      hint = 'NOT_A_HOLIDAY';
  end if;

  for v_row in
    select sh.id, sh.shift_date
    from public.shifts sh
    join public.services sv on sv.id = sh.service_id and sv.works_on_holidays = false
    where sh.shift_date = p_date
      and sh.deleted_at is null
      and sh.generated
      and sh.status <> 'cancelled'
    order by sh.start_time, sh.id
    for update of sh
  loop
    if app.shift_has_history(v_row.id) then
      v_skipped := v_skipped || jsonb_build_object(
        'shift_id', v_row.id,
        'shift_date', v_row.shift_date,
        'code', 'HAS_HISTORY',
        'message', (select string_agg(b ->> 'message', ' ') from jsonb_array_elements(app.od_shift_blockers(v_row.id)) b)
      );
      continue;
    end if;

    v_res := app.od_delete_shift_rows(v_row.id);
    v_shifts := v_shifts + 1;
    v_assignments := v_assignments + (v_res ->> 'assignments')::integer;
    v_tasks := v_tasks + (v_res ->> 'tasks')::integer;
    v_observations := v_observations + (v_res ->> 'observations')::integer;
    v_snapshots := v_snapshots || jsonb_build_array(v_res -> 'snapshot');
  end loop;

  if v_shifts > 0 then
    v_event := app.log_security_event(
      'record_deleted',
      auth.uid(),
      null,
      jsonb_build_object(
        'entity', 'holiday_shifts',
        'record_id', null,
        'name', 'Turnos del feriado ' || to_char(p_date, 'DD/MM/YYYY'),
        'date', p_date,
        'deleted_counts', jsonb_build_object(
          'shifts', v_shifts, 'assignments', v_assignments, 'tasks', v_tasks, 'observations', v_observations
        ),
        'skipped_count', jsonb_array_length(v_skipped),
        'snapshot', v_snapshots
      )
    );
  end if;

  return jsonb_build_object(
    'date', p_date,
    'deleted', jsonb_build_object(
      'shifts', v_shifts, 'assignments', v_assignments, 'tasks', v_tasks, 'observations', v_observations
    ),
    'skipped_count', jsonb_array_length(v_skipped),
    'skipped', v_skipped,
    'event_id', v_event.id
  );
end;
$$;

comment on function public.remove_holiday_shifts(date) is
  'Borra de verdad los turnos de ese feriado que no tienen historia, de servicios que no trabajan feriados (0082, OF-19b), con sus asignaciones, tareas y observación. O, A con cancel_shifts (FORBIDDEN si no). HOLIDAY_DATE_REQUIRED; NOT_A_HOLIDAY si la fecha no tiene un feriado vigente. Solo toca turnos generados (generated = true) y no cancelados; los que tienen historia (fichajes, avisos, supervisiones, fotos, stock, etc.) se saltean. Reusa app.shift_has_history y app.od_delete_shift_rows de 0078. Si borra alguno deja un evento record_deleted con la copia JSON (event_id; nulo si no borró nada). Devuelve {"date", "deleted": {shifts, assignments, tasks, observations}, "skipped_count", "skipped": [{shift_id, shift_date, code: HAS_HISTORY, message}], "event_id"}.';

revoke execute on function public.remove_holiday_shifts(date) from public, anon;
grant execute on function public.remove_holiday_shifts(date) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. cancel_shift libera a los empleados (OF-04b)
-- ---------------------------------------------------------------------------------------------

-- Antes las asignaciones quedaban vivas «para historia» y seguían ocupando el horario del
-- empleado: no se lo podía asignar a otro turno a esa hora. Ahora las asignaciones sin fichajes se
-- quitan con el motivo «Turno cancelado» (siguen en la tabla, dadas de baja). Las que tienen un
-- fichaje se conservan tal cual (son historia de asistencia).
create or replace function public.cancel_shift(p_shift_id uuid, p_reason text)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  perform app.require_capability('cancel_shifts');

  select * into v_shift from public.shifts where id = p_shift_id;

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

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'CANCEL_REASON_REQUIRED';
  end if;

  update public.shifts
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
  where id = p_shift_id
  returning * into v_shift;

  update public.supervisions
  set status = 'cancelled', cancel_reason = 'Turno cancelado: ' || p_reason, updated_by = auth.uid()
  where shift_id = p_shift_id and status in ('assigned', 'in_progress');

  -- OF-04b: libera a los empleados sin fichajes.
  update public.assignments a
  set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Turno cancelado', updated_by = auth.uid()
  where a.shift_id = p_shift_id
    and a.removed_at is null
    and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

  return v_shift;
end;
$$;

comment on function public.cancel_shift(uuid, text) is
  'Cancela un turno con motivo obligatorio (04 sección 9, 6.1; 06 sección 7; P-049). O, A + cancel_shifts. SHIFT_CANCELLED/SHIFT_COMPLETED si ya está en ese estado; CANCEL_REASON_REQUIRED sin motivo. Cancela las supervisiones assigned/in_progress de ese turno. Desde 0082 (OF-04b) quita (removed_at/removed_by, motivo «Turno cancelado») las asignaciones vigentes que no tienen fichajes, para que el empleado quede libre en ese horario; las que ya tienen algún fichaje se conservan como historia.';

-- Corrección de los datos: asignaciones vivas de turnos que ya estaban cancelados (idempotente:
-- después de correr no queda ninguna que cumpla la condición).
update public.assignments a
set removed_at = now(), removed_by = sh.cancelled_by, removed_reason = 'Turno cancelado'
from public.shifts sh
where sh.id = a.shift_id
  and sh.status = 'cancelled'
  and sh.cancelled_by is not null
  and a.removed_at is null
  and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

-- ---------------------------------------------------------------------------------------------
-- 4. Licencias superpuestas (OF-20)
-- ---------------------------------------------------------------------------------------------

-- Dos licencias del mismo empleado pueden pisarse (vacaciones y enfermedad, por ejemplo). Todas las
-- consultas que usan la licencia miran «existe alguna que cubra la fecha» (exists o limit 1), así
-- que no cambian.
alter table public.employee_leaves drop constraint employee_leaves_no_overlap;

create index employee_leaves_employee_id_starts_on_idx
  on public.employee_leaves (employee_id, starts_on)
  where deleted_at is null;

comment on table public.employee_leaves is
  'Licencias de un empleado; ends_on nulo = licencia abierta (04 sección 2.1, P-033). El estado "de licencia" de v_employees se deriva de que exista una fila vigente (deleted_at is null) con starts_on <= hoy <= coalesce(ends_on, hoy). Desde 0082 (OF-20) un empleado puede tener licencias que se superponen: ya no hay restricción de exclusión.';

-- ---------------------------------------------------------------------------------------------
-- 5. ASSIGNMENT_OVERLAP y ON_LEAVE con detalle (OF-08)
-- ---------------------------------------------------------------------------------------------

-- 5.1 app.assign_employee_core (versión de 0059): el mensaje dice con qué choca o qué licencia
--     tiene, y el campo `detail` del error trae el objeto con conflict_shift_id, sede, servicio,
--     fecha y horario (app.overlap_conflict / app.leave_conflict).
create or replace function app.assign_employee_core(
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
  v_conflict jsonb;
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

  -- OF-18 (pendiente de C-04): acá iría la excepción del dueño para asignar en un turno empezado.
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

  -- Licencia (P-033): bloquea siempre (0059). Desde 0082 (OF-08) el mensaje dice el motivo y el
  -- rango («Boutter tiene licencia (Vacaciones) del 3 al 10/11.») y el detalle trae las licencias.
  v_conflict := app.leave_conflict(p_employee_id, v_shift.shift_date);
  if v_conflict is not null then
    raise exception using
      errcode = 'P0001',
      message = v_conflict ->> 'message',
      hint = 'ON_LEAVE',
      detail = app.conflicts_detail(jsonb_build_array(v_conflict))::text;
  end if;

  -- Modo estricto (asignación automática de los fijos): la falta de disponibilidad bloquea,
  -- porque nadie está mirando la advertencia.
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
      v_conflict := app.overlap_conflict(
        p_employee_id,
        app.local_ts(v_shift.shift_date, coalesce(p_start, v_shift.start_time)),
        app.local_ts(v_shift.shift_date, coalesce(p_end, v_shift.end_time)),
        p_shift_id
      );
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_conflict ->> 'message', 'El empleado ya tiene otro turno en ese horario.'),
        hint = 'ASSIGNMENT_OVERLAP',
        detail = app.conflicts_detail(
          case when v_conflict is null then '[]'::jsonb else jsonb_build_array(v_conflict) end
        )::text;
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
  'Cuerpo de public.assign_employee (0024) sin el control de rol: lo llaman assign_employee, create_shift, generate_shifts, apply_service_fixed_employees, move_assignment y apply_service_changes, que ya validaron quién es el que llama. ON_LEAVE (licencia vigente en la fecha del turno) y ASSIGNMENT_OVERLAP son siempre un error. Desde 0082 (OF-08) el mensaje del error dice con qué choca («Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.») o qué licencia tiene («Boutter tiene licencia (Vacaciones) del 3 al 10/11.»), y el campo detail del error es un texto JSON con las claves del primer choque (ASSIGNMENT_OVERLAP: conflict_shift_id, conflict_assignment_id, client_name, site_id, site_name, service_id, service_name, shift_date, start_time, end_time, open_ended; ON_LEAVE: leaves [{leave_id, reason, starts_on, ends_on}]) y conflicts (arreglo con todos). p_strict = true (asignación automática) convierte además OUTSIDE_AVAILABILITY en error; NOT_ENABLED_FOR_CLIENT y OUTSIDE_AVAILABILITY (fuera del modo estricto) siguen siendo advertencias.';

comment on function public.assign_employee(uuid, uuid, time, time) is
  'Asigna un empleado a un turno (04 sección 9, 06 sección 8). O, A (después del inicio del turno: + manage_attendance, SHIFT_STARTED si falta). SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, EMPLOYEE_NOT_ACTIVE, ALREADY_ASSIGNED, SHIFT_FULL, ASSIGNMENT_OVERLAP (exclusión), ON_LEAVE (licencia vigente ese día), INVALID_TIME_RANGE/ASSIGNMENT_TIME_OUT_OF_SHIFT para la franja propia (P-046). Desde 0082 (OF-08) ASSIGNMENT_OVERLAP y ON_LEAVE traen en el mensaje con qué chocan y en el campo detail (texto JSON) conflict_shift_id, sede, servicio, fecha y horario, o las licencias (ver app.assign_employee_core). Devuelve {"assignment": <fila>, "warnings": [...]} con NOT_ENABLED_FOR_CLIENT (P-034) y OUTSIDE_AVAILABILITY (P-035) -- ninguna bloquea. Si completa la dotación, el turno pasa a assigned.';

-- 5.2 update_assignment_time (versión de 0028): ASSIGNMENT_OVERLAP con detalle.
create or replace function public.update_assignment_time(p_assignment_id uuid, p_start time default null, p_end time default null)
returns public.assignments
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_conflict jsonb;
begin
  perform app.require_role('owner', 'admin');

  select * into v_assignment from public.assignments where id = p_assignment_id and removed_at is null;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- "Solo antes del inicio" (06 sección 8): se toma la hora de inicio EFECTIVA de la asignación.
  -- OF-18 (pendiente de C-04): acá iría la excepción del dueño.
  if now() >= lower(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

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

  begin
    update public.assignments
    set start_time = p_start, end_time = p_end, updated_by = auth.uid()
    where id = p_assignment_id
    returning * into v_assignment;
  exception
    when exclusion_violation then
      v_conflict := app.overlap_conflict(
        v_assignment.employee_id,
        app.local_ts(v_shift.shift_date, coalesce(p_start, v_shift.start_time)),
        app.local_ts(v_shift.shift_date, coalesce(p_end, v_shift.end_time)),
        v_shift.id
      );
      raise exception using
        errcode = 'P0001',
        message = coalesce(v_conflict ->> 'message', 'El empleado ya tiene otro turno en ese horario.'),
        hint = 'ASSIGNMENT_OVERLAP',
        detail = app.conflicts_detail(
          case when v_conflict is null then '[]'::jsonb else jsonb_build_array(v_conflict) end
        )::text;
  end;

  return v_assignment;
end;
$$;

comment on function public.update_assignment_time(uuid, time, time) is
  'Cambia la franja propia de una asignación (P-046, 06 sección 8). O, A. Solo antes del inicio efectivo (lower(window)) -- ASSIGNMENT_STARTED si ya pasó. ASSIGNMENT_NOT_FOUND, SHIFT_CANCELLED/SHIFT_COMPLETED, INVALID_TIME_RANGE, ASSIGNMENT_TIME_OUT_OF_SHIFT (fuera de la franja del turno), ASSIGNMENT_OVERLAP si la nueva ventana pisa otra asignación del mismo empleado: desde 0082 (OF-08) el mensaje dice con qué choca y el campo detail (texto JSON) trae conflict_shift_id, sede, servicio, fecha y horario. Fija updated_by = auth.uid() (0028).';

-- 5.3 update_shift_time (versión de 0061): ON_LEAVE y ASSIGNMENT_OVERLAP con detalle por persona.
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
  v_conflicts jsonb;
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

  -- OF-18 (pendiente de C-04): acá iría la excepción del dueño para cambiar el inicio de un turno
  -- en curso y la fecha de uno empezado.
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

    -- Decisión de Mike del 20 oct 2026: no se mueve un turno al pasado.
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

    -- Licencia en la nueva fecha: bloquea (decisión del 19 oct 2026), igual que al asignar. Desde
    -- 0082 (OF-08) el mensaje dice motivo y rango de cada licencia.
    select coalesce(jsonb_agg(x.c order by x.c ->> 'employee_name'), '[]'::jsonb)
    into v_conflicts
    from (
      select app.leave_conflict(a.employee_id, v_new_date) as c
      from public.assignments a
      where a.shift_id = p_shift_id and a.removed_at is null
    ) x
    where x.c is not null;

    if jsonb_array_length(v_conflicts) > 0 then
      raise exception using
        errcode = 'P0001',
        message = (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_conflicts) e),
        hint = 'ON_LEAVE',
        detail = app.conflicts_detail(v_conflicts)::text;
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
      select coalesce(jsonb_agg(x.c order by x.c ->> 'employee_name'), '[]'::jsonb)
      into v_conflicts
      from (
        select app.overlap_conflict(
                 a.employee_id,
                 app.local_ts(v_new_date, coalesce(a.start_time, p_start)),
                 app.local_ts(v_new_date, coalesce(a.end_time, v_end)),
                 p_shift_id
               ) as c
        from public.assignments a
        where a.shift_id = p_shift_id and a.removed_at is null
      ) x
      where x.c is not null;

      raise exception using
        errcode = 'P0001',
        message = case
          when jsonb_array_length(v_conflicts) = 0 then 'El empleado ya tiene otro turno en ese horario.'
          else (select string_agg(e ->> 'message', ' ') from jsonb_array_elements(v_conflicts) e)
        end,
        hint = 'ASSIGNMENT_OVERLAP',
        detail = app.conflicts_detail(v_conflicts)::text;
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese servicio ya tiene un turno en esa fecha.',
        hint = 'SHIFT_DATE_TAKEN';
  end;

  -- Al mover de día los avisos dejan de valer (decisión del 20 oct 2026): cada aviso de las
  -- asignaciones del turno se anula (voided_at; queda como historial, nada se borra) y las
  -- asignaciones con demora o ausencia avisada vuelven a «esperado» (assigned en la UI).
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
  'Cambia la franja y la fecha de un turno (04 sección 6.1, 9; 06 sección 7). O, A. p_date null = misma fecha. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. Cambiar la fecha solo se puede si el turno no empezó (SHIFT_STARTED), no al pasado (SHIFT_DATE_IN_PAST) y si el servicio no tiene otro turno ese día (SHIFT_DATE_TAKEN); al mover de día se anulan los avisos del turno (0061). ON_LEAVE si algún asignado está de licencia en la nueva fecha, o el coordinador. ASSIGNMENT_OVERLAP si el cambio superpone a un asignado con otro turno. Desde 0082 (OF-08) ON_LEAVE y ASSIGNMENT_OVERLAP dicen en el mensaje a quién y con qué (una frase por persona) y el campo detail (texto JSON) trae las claves del primer choque más conflicts (todos, con conflict_shift_id, sede, servicio, fecha y horario). Para el cronograma arrastrable (OF-10) esta RPC mueve el turno entero de día u hora; el estado anterior (fecha, inicio, fin, a terminar) lo tiene la pantalla y es lo que usa para deshacer. Las advertencias (HOLIDAY, OUTSIDE_AVAILABILITY) las da get_shift_date_warnings.';

-- 5.4 create_shift_core (versión de 0047): rejected trae el detalle del error.
create or replace function app.create_shift_core(
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
  p_employee_ids uuid[] default null,
  p_series_id uuid default null,
  p_requires_photos boolean default null
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
  v_detail text;
  v_requires_photos boolean;
begin
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

  -- H-07: null = hereda del servicio (si el turno nace de uno); un turno suelto, sin fotos.
  v_requires_photos := coalesce(
    p_requires_photos,
    (select s.requires_photos from public.services s where s.id = p_service_id),
    false
  );

  insert into public.shifts (
    service_id, client_id, site_id, shift_date, start_time, end_time, open_ended,
    required_staff, status, generated, series_id, requires_photos, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, v_end, coalesce(p_open_ended, false),
    p_required_staff, 'scheduled', false, p_series_id, v_requires_photos, auth.uid()
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
  -- del turno: queda en "rejected" con su motivo (el resto sí se asigna). Desde 0082 (OF-08)
  -- cada rechazo trae `detail` (objeto con conflict_shift_id, sede, servicio, fecha y horario del
  -- choque, o las licencias) cuando el error lo tiene.
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
        get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
        v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
          'employee_id', v_emp,
          'employee_name', (select btrim(p.first_name || ' ' || p.last_name) from public.profiles p where p.id = v_emp),
          'code', v_code,
          'message', v_msg,
          'detail', app.try_jsonb(v_detail)
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

comment on function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid, boolean) is
  'Cuerpo de public.create_shift (0041) sin el control de rol, con p_series_id (0046) y p_requires_photos (0047, H-07: null = hereda del servicio, o false si es un turno suelto). Lo llaman create_shift y create_shift_series, que ya validaron quién es el que llama. Mismas validaciones, errores y retorno que create_shift. Desde 0082 (OF-08) cada elemento de rejected trae también detail (objeto o null): el detalle del error de la asignación (conflict_shift_id, sede, servicio, fecha y horario del choque, o las licencias), y su message dice con qué choca.';

-- 5.5 generate_shifts: el cuerpo pasa a app.generate_shifts_core (con p_from_date, que usa
--     apply_service_changes para no crear turnos hacia atrás) y public.generate_shifts queda como
--     envoltorio con el control de capacidad. Versión de 0081 + detail en unassigned.
create function app.generate_shifts_core(
  p_year int,
  p_month int,
  p_service_id uuid default null,
  p_from_date date default null
)
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
  v_created_shifts jsonb := '[]'::jsonb;
  v_code text;
  v_msg text;
  v_detail text;
begin
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
        and (p_from_date is null or gs::date >= p_from_date)
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
    v_created_shifts := v_created_shifts || jsonb_build_array(jsonb_build_object(
      'shift_id', v_shift_id, 'shift_date', v_rec.shift_date, 'service_id', v_rec.service_id
    ));

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
              get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
              v_unassigned := v_unassigned || jsonb_build_array(jsonb_build_object(
                'shift_id', v_shift_id,
                'shift_date', v_rec.shift_date,
                'service_id', v_rec.service_id,
                'employee_id', v_fixed.employee_id,
                'employee_name', v_fixed.employee_name,
                'code', v_code,
                'message', v_msg,
                'detail', app.try_jsonb(v_detail)
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
    'past_without_fixed', v_past_without_fixed,
    'created_shifts', v_created_shifts
  );
end;
$$;

comment on function app.generate_shifts_core(int, int, uuid, date) is
  'Cuerpo de public.generate_shifts (0081) sin el control de capacidad: lo llaman generate_shifts y apply_service_changes. p_from_date (opcional) deja afuera las fechas anteriores. Devuelve lo mismo que generate_shifts más created_shifts [{shift_id, shift_date, service_id}]; cada elemento de unassigned trae además detail (objeto o null, 0082 OF-08).';

revoke execute on function app.generate_shifts_core(int, int, uuid, date) from public, anon, authenticated;

create or replace function public.generate_shifts(p_year int, p_month int, p_service_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
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

  return app.generate_shifts_core(p_year, p_month, p_service_id, null) - 'created_shifts';
end;
$$;

comment on function public.generate_shifts(int, int, uuid) is
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta weekdays, weeks_of_month, valid_from / valid_to, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente. O, A + generate_shifts. Los turnos de un servicio «A terminar» nacen «A terminar» (0037). Cada turno recién creado asigna a los empleados fijos del servicio (0041, AJ2-17) con app.assign_employee_core en modo estricto: lo que no se puede asignar no frena la generación y se informa. Cada turno creado hereda services.requires_photos (0047, H-07). Desde 0081 (OD-27) el tercer parámetro p_service_id (default null) limita la generación a ese servicio. SERVICE_NOT_FOUND si p_service_id no existe o está borrado. Desde 0082 es un envoltorio de app.generate_shifts_core. Devuelve {"created", "skipped", "holidays_skipped", "assigned", "unassigned" [{shift_id, shift_date, service_id, employee_id, employee_name, code, message, detail}], "past_without_fixed"}; desde 0082 (OF-08) cada unassigned trae detail (objeto con el choque o la licencia, o null) y su message dice con qué choca.';

-- 5.6 apply_service_fixed_employees (versión de 0080): skipped trae detail.
create or replace function public.apply_service_fixed_employees(
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
  v_detail text;
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
        end,
        'detail', null
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
          get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
          v_shift_partial := true;
          v_skipped := v_skipped || jsonb_build_object(
            'scope', 'employee',
            'shift_id', v_shift.id,
            'shift_date', v_shift.shift_date,
            'employee_id', v_emp,
            'employee_name', v_name,
            'code', v_code,
            'message', v_msg,
            'detail', app.try_jsonb(v_detail)
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
  'Aplica los empleados fijos actuales del servicio a sus turnos ya creados con fecha >= p_from_date (OD-11, 0080). O, A (FORBIDDEN si no). En cada turno: quita las asignaciones de origen fijo (assignments.from_fixed) de quienes ya no son fijos y asigna a los fijos que faltan con app.assign_employee_core en modo estricto (mismas validaciones que la asignación individual). No toca los turnos cancelados, que ya empezaron o que tienen fichajes o avisos, ni a los empleados agregados a mano. FROM_DATE_REQUIRED, SERVICE_NOT_FOUND. Devuelve {"service_id", "from_date", "fixed_employee_ids", "updated_count" (turnos con cambios), "unchanged_count", "skipped_count" (turnos salteados), "partial_count" (turnos donde algún fijo no se pudo asignar), "assignments_removed", "assignments_added", "updated": [{shift_id, shift_date, removed: [{employee_id, employee_name}], added: [...]}], "skipped": [{scope: "shift" | "employee", shift_id, shift_date, employee_id, employee_name, code, message, detail}]}. Códigos de scope shift: SHIFT_CANCELLED, SHIFT_STARTED, HAS_ATTENDANCE, HAS_NOTICES. Códigos de scope employee: los de la asignación individual (ON_LEAVE, ASSIGNMENT_OVERLAP, OUTSIDE_AVAILABILITY, EMPLOYEE_NOT_ACTIVE, SHIFT_FULL...). Desde 0082 (OF-08) el message del scope employee dice con qué choca o qué licencia tiene, y detail (objeto o null) trae conflict_shift_id, sede, servicio, fecha y horario, o las licencias. Un solo llamado es una transacción.';

-- ---------------------------------------------------------------------------------------------
-- 6. Cierre automático de asignaciones (OF-11)
-- ---------------------------------------------------------------------------------------------

-- Marca del fichaje de fin que cerró el sistema. El registro es un fin con source = admin (el
-- único origen que el modelo tiene para «no lo ficha el empleado»), recorded_by nulo (no lo cargó
-- nadie), el motivo de siempre en `reason` y esta marca para filtrar. Se puede corregir con
-- correct_attendance_time como cualquier fichaje (la marca queda; time_corrected_at dice que se
-- corrigió).
alter table public.attendance_records
  add column auto_closed boolean not null default false;

comment on column public.attendance_records.auto_closed is
  'true si el fin lo registró el cierre automático (app.auto_close_assignments, 0082, OF-11): el empleado no fichó el fin. source = admin, recorded_by nulo y reason = «Cierre automático: no se registró el fin». Corregible con correct_attendance_time.';

-- attendance_records tiene select por columna (0054): la columna nueva necesita su grant.
grant select (auto_closed) on public.attendance_records to authenticated;

-- Cierra las asignaciones con inicio fichado y sin fin cuando pasó 1 hora del fin programado.
--   - Fin programado = el de la franja efectiva de la asignación (la propia si la tiene, si no la
--     del turno): upper(assignments."window").
--   - Turnos «A terminar» sin fin propio: NO se cierran. No tienen fin programado (23:59 es un
--     marcador) y cerrarlos a ese horario inventaría hasta 23:59 de trabajo. Siguen el circuito
--     de siempre (estado «Sin salida», la administración carga la hora de salida).
--   - Solo se cierran las asignaciones cuyo fin programado cayó en las últimas 48 horas: así el
--     primer pase no reescribe fichajes olvidados de semanas atrás, que la administración puede
--     estar corrigiendo a mano.
--   - Efecto: igual que el fichaje de fin normal (assignments.status = finished y, si era la
--     última, el turno pasa a completed). La hora de fin es la programada (o un segundo después
--     del inicio fichado si el inicio fue posterior al fin programado). p_now existe para las
--     pruebas; la tarea de pg_cron la llama sin argumentos.
create function app.auto_close_assignments(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row record;
  v_close timestamptz;
  v_record_id uuid;
  v_count integer := 0;
begin
  for v_row in
    select a.id as assignment_id, a.shift_id, upper(a."window") as scheduled_end, ci.recorded_at as check_in_at
    from public.assignments a
    join public.shifts sh on sh.id = a.shift_id and sh.deleted_at is null
    join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    where a.removed_at is null
      and a.status = 'present'
      and sh.status <> 'cancelled'
      and not (sh.open_ended and a.end_time is null)
      and not exists (
        select 1 from public.attendance_records co
        where co.assignment_id = a.id and co.kind = 'check_out'
      )
      and upper(a."window") + interval '1 hour' <= p_now
      and upper(a."window") >= p_now - interval '48 hours'
    order by upper(a."window"), a.id
    for update of a
  loop
    v_close := greatest(v_row.scheduled_end, v_row.check_in_at + interval '1 second');
    v_record_id := null;

    insert into public.attendance_records (
      assignment_id, kind, recorded_at, source, recorded_by, reason,
      geo_status, geo_unvalidated_reason, auto_closed
    )
    values (
      v_row.assignment_id, 'check_out', v_close, 'admin', null, 'Cierre automático: no se registró el fin',
      'unvalidated', 'admin_record', true
    )
    on conflict (assignment_id, kind) do nothing
    returning id into v_record_id;

    -- Otra transacción ya registró el fin: no se toca nada.
    if v_record_id is null then
      continue;
    end if;

    update public.assignments
    set status = 'finished'
    where id = v_row.assignment_id;

    perform app.complete_shift_if_done(v_row.shift_id);

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function app.auto_close_assignments(timestamptz) is
  'Cierre automático de asignaciones (0082, OF-11): cierra las asignaciones con inicio fichado y sin fin cuando pasó 1 hora del fin programado de su franja efectiva (y no más de 48 horas). Registra el fin con la hora de fin programada, source = admin, recorded_by nulo, auto_closed = true y el motivo «Cierre automático: no se registró el fin»; deja la asignación en finished y completa el turno si era la última (mismo efecto que record_check_out). No cierra turnos «A terminar» sin fin propio ni asignaciones sin inicio fichado (quedan como ausentes). Devuelve cuántas cerró. La programa pg_cron cada 15 minutos; p_now existe para las pruebas.';

revoke execute on function app.auto_close_assignments(timestamptz) from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise warning 'P28.1: no se pudo habilitar pg_cron (%). Habilitala desde el panel y programá la tarea (docs/database.md).', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('auto-close-assignments', '*/15 * * * *', 'select app.auto_close_assignments()');
  else
    raise warning 'P28.1: pg_cron no está habilitada: el cierre automático de asignaciones NO quedó programado.';
  end if;
end;
$$;

-- La vista del tablero y de Asistencia suma la marca del fin automático (columna nueva al final).
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
    notice.has_certificate AS last_notice_has_certificate,
    cl.calendar_color AS client_calendar_color,
    coalesce(co.auto_closed, false) AS check_out_auto_closed
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

comment on column public.v_assignments_board.check_out_auto_closed is
  'true si el fin de la asignación lo registró el cierre automático (0082, OF-11): el empleado no fichó el fin. Para filtrar y corregir en Asistencia (correct_attendance_time sobre check_out_record_id).';

-- ---------------------------------------------------------------------------------------------
-- 7. Los cambios del servicio llegan a los turnos (OF-05)
-- ---------------------------------------------------------------------------------------------

-- Cuerpo común de la vista previa y de la aplicación. Trabaja sobre los turnos del servicio con
-- fecha >= p_from_date, con los valores que el servicio YA tiene guardados. Orden:
--   1. se anotan los meses (desde el de p_from_date) en los que el servicio ya tenía turnos
--      generados (antes de borrar nada);
--   2. por cada turno del servicio: si ya no corresponde (día de la semana, semana del mes,
--      feriado sin trabajar feriados, fuera de vigencia) se borra; si corresponde, se actualiza lo
--      que difiera (horario, dotación, fotos);
--   3. por cada mes anotado se generan los turnos que faltan, desde p_from_date, con los fijos.
-- Reglas de seguridad (nunca se tocan, y se informan como salteados):
--   SHIFT_CANCELLED   turno cancelado
--   MANUAL_SHIFT      turno que no se generó desde el servicio (generated = false): creado a mano
--   SHIFT_STARTED     turno en curso, finalizado o que ya empezó
--   HAS_HISTORY       turno a borrar con historia (app.shift_has_history de 0078)
--   HAS_ATTENDANCE / HAS_NOTICES   turno a actualizar con fichajes o avisos vigentes
-- «Cambiado a mano»: p_previous trae los valores que el servicio tenía ANTES de guardarse
-- (start_time, end_time, open_ended, required_staff, requires_photos). Por cada campo presente, un
-- turno solo se actualiza si todavía tiene el valor anterior; si tiene otro se considera cambiado
-- a mano y conserva el suyo (nota MANUAL_TIME, MANUAL_STAFF o MANUAL_PHOTOS). Si el campo no
-- viene, el valor del servicio se fuerza en todos los turnos que siguen. La dotación no baja por
-- debajo de los asignados (nota STAFF_BELOW_ASSIGNED). Al cambiar el horario se revalida a cada
-- asignado: franja propia fuera del nuevo horario, licencia o superposición con otro turno ->
-- se lo quita (motivo «Cambio de horario del servicio») y se informa.
create function app.service_changes_run(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_has_time boolean := false;
  v_prev_start time;
  v_prev_end time;
  v_prev_open boolean;
  v_has_staff boolean := false;
  v_prev_staff smallint;
  v_has_photos boolean := false;
  v_prev_photos boolean;
  v_months date[];
  v_month date;
  v_shift public.shifts;
  v_asg record;
  v_reason text;
  v_reason_msg text;
  v_time_diff boolean;
  v_staff_diff boolean;
  v_photos_diff boolean;
  v_notes jsonb;
  v_block text;
  v_block_msg text;
  v_assigned_count integer;
  v_conf jsonb;
  v_removed jsonb;
  v_changes jsonb;
  v_failed boolean;
  v_res jsonb;
  v_gen jsonb;
  v_snapshots jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_unassigned jsonb := '[]'::jsonb;
  v_months_out jsonb := '[]'::jsonb;
  v_deleted_count integer := 0;
  v_deleted_assignments integer := 0;
  v_deleted_tasks integer := 0;
  v_deleted_observations integer := 0;
  v_updated_count integer := 0;
  v_unchanged_count integer := 0;
  v_skipped_shifts integer := 0;
  v_partial_count integer := 0;
  v_removed_total integer := 0;
  v_created_count integer := 0;
  v_assigned_new integer := 0;
  v_event public.security_events;
begin
  select * into v_service from public.services where id = p_service_id and deleted_at is null for update;

  if v_service.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese servicio.',
      hint = 'SERVICE_NOT_FOUND';
  end if;

  if p_previous is not null then
    begin
      if jsonb_typeof(p_previous) <> 'object' then
        raise exception 'no es un objeto';
      end if;
      v_has_time := (p_previous ? 'start_time') and (p_previous ? 'end_time');
      if v_has_time then
        v_prev_start := (p_previous ->> 'start_time')::time;
        v_prev_end := (p_previous ->> 'end_time')::time;
        v_prev_open := coalesce((p_previous ->> 'open_ended')::boolean, false);
      end if;
      v_has_staff := p_previous ? 'required_staff';
      if v_has_staff then
        v_prev_staff := (p_previous ->> 'required_staff')::smallint;
      end if;
      v_has_photos := p_previous ? 'requires_photos';
      if v_has_photos then
        v_prev_photos := (p_previous ->> 'requires_photos')::boolean;
      end if;
    exception
      when others then
        raise exception using
          errcode = 'P0001',
          message = 'Los valores anteriores del servicio no son válidos.',
          hint = 'INVALID_PREVIOUS';
    end;
  end if;

  -- 1. Meses con turnos generados (antes de borrar).
  select coalesce(array_agg(m.month order by m.month), array[]::date[])
  into v_months
  from (
    select distinct date_trunc('month', sh.shift_date)::date as month
    from public.shifts sh
    where sh.service_id = p_service_id
      and sh.deleted_at is null
      and sh.generated
      and sh.shift_date >= date_trunc('month', p_from_date)::date
  ) m;

  -- 2. Borrar lo que ya no corresponde y actualizar lo que sigue.
  for v_shift in
    select sh.*
    from public.shifts sh
    where sh.service_id = p_service_id
      and sh.deleted_at is null
      and sh.shift_date >= p_from_date
    order by sh.shift_date, sh.start_time, sh.id
    for update
  loop
    v_reason := case
      when not (extract(dow from v_shift.shift_date)::smallint = any (v_service.weekdays)) then 'WEEKDAY'
      when not app.date_matches_weeks_of_month(v_shift.shift_date, v_service.weeks_of_month) then 'WEEK_OF_MONTH'
      when not v_service.works_on_holidays and exists (
        select 1 from public.holidays h where h.holiday_date = v_shift.shift_date and h.deleted_at is null
      ) then 'HOLIDAY'
      when v_shift.shift_date < v_service.valid_from
        or (v_service.valid_to is not null and v_shift.shift_date > v_service.valid_to) then 'OUT_OF_VALIDITY'
      else null
    end;
    v_reason_msg := case v_reason
      when 'WEEKDAY' then 'El servicio ya no se presta ese día de la semana.'
      when 'WEEK_OF_MONTH' then 'El servicio ya no se presta esa semana del mes.'
      when 'HOLIDAY' then 'Es feriado y el servicio no trabaja feriados.'
      when 'OUT_OF_VALIDITY' then 'Está fuera de la vigencia del servicio.'
      else null
    end;

    v_notes := '[]'::jsonb;
    v_time_diff := false;
    v_staff_diff := false;
    v_photos_diff := false;

    if v_reason is null then
      select count(*) into v_assigned_count
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      if (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
         is distinct from (v_service.start_time, v_service.end_time, v_service.open_ended)
      then
        if v_has_time and (v_shift.start_time, v_shift.end_time, v_shift.open_ended)
           is distinct from (v_prev_start, v_prev_end, v_prev_open)
        then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_TIME',
            'message', 'El horario del turno es distinto al que tenía el servicio: se lo cambió a mano y se conserva.'
          ));
        else
          v_time_diff := true;
        end if;
      end if;

      if v_shift.required_staff <> v_service.required_staff then
        if v_has_staff and v_shift.required_staff <> v_prev_staff then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_STAFF',
            'message', 'La dotación del turno es distinta a la que tenía el servicio: se la cambió a mano y se conserva.'
          ));
        elsif v_service.required_staff < v_assigned_count then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'STAFF_BELOW_ASSIGNED',
            'message', 'La dotación nueva es menor que las personas ya asignadas: se conserva la del turno.'
          ));
        else
          v_staff_diff := true;
        end if;
      end if;

      if v_shift.requires_photos <> v_service.requires_photos then
        if v_has_photos and v_shift.requires_photos <> v_prev_photos then
          v_notes := v_notes || jsonb_build_array(jsonb_build_object(
            'code', 'MANUAL_PHOTOS',
            'message', 'La opción de fotos del turno es distinta a la que tenía el servicio: se la cambió a mano y se conserva.'
          ));
        else
          v_photos_diff := true;
        end if;
      end if;
    end if;

    -- Nada que hacer ni que informar.
    if v_reason is null and not (v_time_diff or v_staff_diff or v_photos_diff) and jsonb_array_length(v_notes) = 0 then
      v_unchanged_count := v_unchanged_count + 1;
      continue;
    end if;

    -- Turnos que no se tocan (solo si había algo para hacer).
    v_block := null;
    v_block_msg := null;
    if v_reason is not null or v_time_diff or v_staff_diff or v_photos_diff then
      v_block := case
        when v_shift.status = 'cancelled' then 'SHIFT_CANCELLED'
        when not v_shift.generated then 'MANUAL_SHIFT'
        when v_shift.status in ('in_progress', 'completed') or now() >= v_shift.starts_at then 'SHIFT_STARTED'
        when v_reason is not null and app.shift_has_history(v_shift.id) then 'HAS_HISTORY'
        when v_reason is null and exists (
          select 1 from public.attendance_records ar
          join public.assignments a on a.id = ar.assignment_id
          where a.shift_id = v_shift.id
        ) then 'HAS_ATTENDANCE'
        when v_reason is null and exists (
          select 1 from public.attendance_notices n
          join public.assignments a on a.id = n.assignment_id
          where a.shift_id = v_shift.id and n.voided_at is null
        ) then 'HAS_NOTICES'
        else null
      end;
      v_block_msg := case v_block
        when 'SHIFT_CANCELLED' then 'El turno está cancelado.'
        when 'MANUAL_SHIFT' then 'El turno se creó a mano, no desde el servicio.'
        when 'SHIFT_STARTED' then 'El turno ya empezó.'
        when 'HAS_HISTORY' then (
          select string_agg(b ->> 'message', ' ') from jsonb_array_elements(app.od_shift_blockers(v_shift.id)) b
        )
        when 'HAS_ATTENDANCE' then 'El turno ya tiene fichajes.'
        when 'HAS_NOTICES' then 'El turno ya tiene avisos de demora o ausencia.'
        else null
      end;
    end if;

    if v_block is not null then
      v_skipped_shifts := v_skipped_shifts + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'scope', 'shift',
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'code', v_block,
        'message', v_block_msg,
        'wanted', case when v_reason is not null then 'delete' else 'update' end
      );
      continue;
    end if;

    -- Borrar.
    if v_reason is not null then
      v_res := app.od_delete_shift_rows(v_shift.id);
      v_deleted_count := v_deleted_count + 1;
      v_deleted_assignments := v_deleted_assignments + (v_res ->> 'assignments')::integer;
      v_deleted_tasks := v_deleted_tasks + (v_res ->> 'tasks')::integer;
      v_deleted_observations := v_deleted_observations + (v_res ->> 'observations')::integer;
      v_snapshots := v_snapshots || jsonb_build_array(v_res -> 'snapshot');
      v_deleted := v_deleted || jsonb_build_object(
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'reason', v_reason,
        'message', v_reason_msg,
        'assignments', (v_res ->> 'assignments')::integer
      );
      continue;
    end if;

    -- Actualizar (con las asignaciones revalidadas si cambia el horario). Todo el bloque se deshace
    -- junto si falla.
    v_removed := '[]'::jsonb;
    v_failed := false;

    begin
      if v_time_diff then
        for v_asg in
          select a.id, a.employee_id, a.start_time, a.end_time
          from public.assignments a
          where a.shift_id = v_shift.id and a.removed_at is null
          order by a.created_at, a.id
        loop
          v_conf := null;

          if (v_asg.start_time is not null and (v_asg.start_time < v_service.start_time or v_asg.start_time >= v_service.end_time))
             or (v_asg.end_time is not null and (v_asg.end_time > v_service.end_time or v_asg.end_time <= v_service.start_time))
          then
            v_conf := jsonb_build_object(
              'code', 'ASSIGNMENT_TIME_OUT_OF_SHIFT',
              'employee_id', v_asg.employee_id,
              'employee_name', app.person_label(v_asg.employee_id),
              'message', app.person_label(v_asg.employee_id) || ' tenía una franja propia que queda fuera del nuevo horario.'
            );
          else
            v_conf := app.leave_conflict(v_asg.employee_id, v_shift.shift_date);
            if v_conf is null then
              v_conf := app.overlap_conflict(
                v_asg.employee_id,
                app.local_ts(v_shift.shift_date, coalesce(v_asg.start_time, v_service.start_time)),
                app.local_ts(v_shift.shift_date, coalesce(v_asg.end_time, v_service.end_time)),
                v_shift.id
              );
            end if;
          end if;

          if v_conf is not null then
            update public.assignments
            set removed_at = now(),
                removed_by = auth.uid(),
                removed_reason = 'Cambio de horario del servicio: ' || (v_conf ->> 'code'),
                updated_by = auth.uid()
            where id = v_asg.id;

            v_removed := v_removed || jsonb_build_array(
              (v_conf - 'leaves') || jsonb_build_object('assignment_id', v_asg.id)
            );
          end if;
        end loop;
      end if;

      update public.shifts
      set start_time = case when v_time_diff then v_service.start_time else start_time end,
          end_time = case when v_time_diff then v_service.end_time else end_time end,
          open_ended = case when v_time_diff then v_service.open_ended else open_ended end,
          required_staff = case when v_staff_diff then v_service.required_staff else required_staff end,
          requires_photos = case when v_photos_diff then v_service.requires_photos else requires_photos end,
          updated_by = auth.uid()
      where id = v_shift.id;

      select count(*) into v_assigned_count
      from public.assignments a
      where a.shift_id = v_shift.id and a.removed_at is null;

      -- scheduled <-> assigned según la dotación y los asignados que quedaron (04 sección 6.1).
      update public.shifts
      set status = case
        when status = 'scheduled' and v_assigned_count >= required_staff then 'assigned'
        when status = 'assigned' and v_assigned_count < required_staff then 'scheduled'
        else status
      end
      where id = v_shift.id and status in ('scheduled', 'assigned');
    exception
      when exclusion_violation then
        v_failed := true;
    end;

    if v_failed then
      v_skipped_shifts := v_skipped_shifts + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'scope', 'shift',
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'code', 'ASSIGNMENT_OVERLAP',
        'message', 'No se pudo cambiar el horario: alguien asignado queda superpuesto con otro turno.',
        'wanted', 'update'
      );
      continue;
    end if;

    v_changes := '{}'::jsonb;
    if v_time_diff then
      v_changes := v_changes || jsonb_build_object('time', jsonb_build_object(
        'from', jsonb_build_object('start_time', v_shift.start_time, 'end_time', v_shift.end_time, 'open_ended', v_shift.open_ended),
        'to', jsonb_build_object('start_time', v_service.start_time, 'end_time', v_service.end_time, 'open_ended', v_service.open_ended)
      ));
    end if;
    if v_staff_diff then
      v_changes := v_changes || jsonb_build_object('required_staff', jsonb_build_object(
        'from', v_shift.required_staff, 'to', v_service.required_staff
      ));
    end if;
    if v_photos_diff then
      v_changes := v_changes || jsonb_build_object('requires_photos', jsonb_build_object(
        'from', v_shift.requires_photos, 'to', v_service.requires_photos
      ));
    end if;

    if v_time_diff or v_staff_diff or v_photos_diff then
      v_updated_count := v_updated_count + 1;
      v_removed_total := v_removed_total + jsonb_array_length(v_removed);
      v_updated := v_updated || jsonb_build_object(
        'shift_id', v_shift.id,
        'shift_date', v_shift.shift_date,
        'changes', v_changes,
        'removed', v_removed,
        'kept', v_notes
      );
    end if;

    if jsonb_array_length(v_removed) > 0 or jsonb_array_length(v_notes) > 0 then
      v_partial_count := v_partial_count + 1;
    end if;

    -- Notas de campos conservados, también si el turno no cambió nada más.
    if not (v_time_diff or v_staff_diff or v_photos_diff) then
      v_skipped := v_skipped || (
        select coalesce(jsonb_agg(jsonb_build_object(
          'scope', 'field',
          'shift_id', v_shift.id,
          'shift_date', v_shift.shift_date,
          'code', n ->> 'code',
          'message', n ->> 'message'
        )), '[]'::jsonb)
        from jsonb_array_elements(v_notes) n
      );
    end if;
  end loop;

  -- 3. Generar los que faltan en los meses que ya tenían turnos generados.
  foreach v_month in array v_months
  loop
    v_gen := app.generate_shifts_core(
      extract(year from v_month)::int, extract(month from v_month)::int, p_service_id, p_from_date
    );
    v_created_count := v_created_count + (v_gen ->> 'created')::integer;
    v_assigned_new := v_assigned_new + (v_gen ->> 'assigned')::integer;
    v_created := v_created || (v_gen -> 'created_shifts');
    v_unassigned := v_unassigned || (v_gen -> 'unassigned');
    v_months_out := v_months_out || jsonb_build_array(jsonb_build_object(
      'year', extract(year from v_month)::int,
      'month', extract(month from v_month)::int,
      'created', (v_gen ->> 'created')::integer
    ));
  end loop;

  if v_deleted_count > 0 then
    v_event := app.log_security_event(
      'record_deleted',
      auth.uid(),
      null,
      jsonb_build_object(
        'entity', 'service_changes',
        'record_id', p_service_id,
        'name', v_service.name,
        'from_date', p_from_date,
        'deleted_counts', jsonb_build_object(
          'shifts', v_deleted_count, 'assignments', v_deleted_assignments,
          'tasks', v_deleted_tasks, 'observations', v_deleted_observations
        ),
        'snapshot', v_snapshots
      )
    );
  end if;

  return jsonb_build_object(
    'service_id', p_service_id,
    'from_date', p_from_date,
    'deleted_count', v_deleted_count,
    'updated_count', v_updated_count,
    'created_count', v_created_count,
    'unchanged_count', v_unchanged_count,
    'skipped_count', v_skipped_shifts,
    'partial_count', v_partial_count,
    'assignments_removed', v_removed_total + v_deleted_assignments,
    'assignments_added', v_assigned_new,
    'deleted', v_deleted,
    'updated', v_updated,
    'created', v_created,
    'skipped', v_skipped,
    'unassigned', v_unassigned,
    'months', v_months_out,
    'event_id', v_event.id
  );
end;
$$;

comment on function app.service_changes_run(uuid, date, jsonb) is
  'Uso interno (0082, OF-05): cuerpo común de preview_service_changes y apply_service_changes. Hace los cambios de verdad; la vista previa los deshace con una subtransacción.';

revoke execute on function app.service_changes_run(uuid, date, jsonb) from public, anon, authenticated;

create function public.apply_service_changes(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_role('owner', 'admin');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  return app.service_changes_run(p_service_id, p_from_date, p_previous) || jsonb_build_object('preview', false);
end;
$$;

comment on function public.apply_service_changes(uuid, date, jsonb) is
  'Aplica a los turnos del servicio con fecha >= p_from_date los cambios que el servicio ya tiene guardados (0082, OF-05). O, A (FORBIDDEN si no). Una sola transacción. (1) Borra los turnos generados, sin historia y que no empezaron, que ya no corresponden: día de la semana, semana del mes, feriado si el servicio no trabaja feriados, o fuera de vigencia. (2) Actualiza a la hora, dotación y opción de fotos del servicio los que siguen; al cambiar el horario revalida a los asignados y quita a los que quedan con franja propia fuera del nuevo horario, de licencia o superpuestos con otro turno (los informa). (3) Genera los turnos que faltan, desde p_from_date y con los empleados fijos, en los meses (desde el de p_from_date) en los que el servicio ya tenía turnos generados, calculados antes de borrar. p_previous (jsonb, opcional) = valores del servicio ANTES de guardarlo: {"start_time", "end_time", "open_ended", "required_staff", "requires_photos"}; por cada campo presente solo se actualizan los turnos que todavía tienen el valor anterior (los demás se consideran cambiados a mano y se conservan: notas MANUAL_TIME, MANUAL_STAFF, MANUAL_PHOTOS); un campo ausente se fuerza en todos los turnos que siguen. No toca turnos cancelados (SHIFT_CANCELLED), creados a mano (MANUAL_SHIFT), que ya empezaron (SHIFT_STARTED), con historia al borrar (HAS_HISTORY) ni con fichajes o avisos al actualizar (HAS_ATTENDANCE, HAS_NOTICES). FROM_DATE_REQUIRED, SERVICE_NOT_FOUND, INVALID_PREVIOUS. Si borra turnos deja un evento record_deleted (entity service_changes) con la copia JSON. Devuelve {"service_id", "from_date", "preview": false, "deleted_count", "updated_count", "created_count", "unchanged_count", "skipped_count" (turnos salteados), "partial_count" (actualizados con asignados quitados o con campos conservados), "assignments_removed", "assignments_added" (fijos de los turnos creados), "deleted": [{shift_id, shift_date, reason: WEEKDAY | WEEK_OF_MONTH | HOLIDAY | OUT_OF_VALIDITY, message, assignments}], "updated": [{shift_id, shift_date, changes: {time: {from, to}, required_staff: {from, to}, requires_photos: {from, to}}, removed: [{assignment_id, code, employee_id, employee_name, message, ...detalle}], kept: [{code, message}]}], "created": [{shift_id, shift_date, service_id}], "skipped": [{scope: "shift" | "field", shift_id, shift_date, code, message, wanted: "delete" | "update"}], "unassigned": [fijos de los turnos creados que no se pudieron asignar: {shift_id, shift_date, employee_id, employee_name, code, message, detail}], "months": [{year, month, created}], "event_id"}.';

revoke execute on function public.apply_service_changes(uuid, date, jsonb) from public, anon;
grant execute on function public.apply_service_changes(uuid, date, jsonb) to authenticated;

create function public.preview_service_changes(
  p_service_id uuid,
  p_from_date date,
  p_previous jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_result jsonb;
  v_hint text;
  v_detail text;
begin
  perform app.require_role('owner', 'admin');

  if p_from_date is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá desde qué fecha.',
      hint = 'FROM_DATE_REQUIRED';
  end if;

  -- Se corre el mismo cuerpo que apply_service_changes dentro de una subtransacción que se
  -- deshace al final: el resultado es exactamente el que daría aplicar, y no queda nada escrito.
  begin
    v_result := app.service_changes_run(p_service_id, p_from_date, p_previous);

    raise exception using
      errcode = 'P0001',
      message = 'Vista previa: se deshace.',
      hint = 'PREVIEW_ROLLBACK',
      detail = v_result::text;
  exception
    when sqlstate 'P0001' then
      get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
      if v_hint is distinct from 'PREVIEW_ROLLBACK' then
        raise;
      end if;
      v_result := v_detail::jsonb;
  end;

  return (v_result - 'event_id') || jsonb_build_object('preview', true);
end;
$$;

comment on function public.preview_service_changes(uuid, date, jsonb) is
  'Vista previa de apply_service_changes (0082, OF-05): devuelve lo mismo que devolvería aplicarlo (mismos conteos y listas, preview = true) sin dejar nada escrito. O, A. Mismos parámetros, errores y contrato que apply_service_changes. Implementación: corre el cuerpo real dentro de una subtransacción que se deshace, así que la vista previa y la aplicación no pueden diferir; toma bloqueos de fila un instante.';

revoke execute on function public.preview_service_changes(uuid, date, jsonb) from public, anon;
grant execute on function public.preview_service_changes(uuid, date, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. Avisos de duplicados (OF-02)
-- ---------------------------------------------------------------------------------------------

create function public.service_overlaps(
  p_site_id uuid,
  p_weekdays smallint[],
  p_start time,
  p_end time,
  p_except_id uuid default null
)
returns table (
  service_id uuid,
  service_name text,
  client_id uuid,
  site_id uuid,
  weekdays smallint[],
  common_weekdays smallint[],
  start_time time,
  end_time time,
  open_ended boolean,
  required_staff smallint,
  valid_from date,
  valid_to date,
  weeks_of_month smallint[]
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
declare
  v_end time := coalesce(p_end, time '23:59');
begin
  perform app.require_role('owner', 'admin');

  if p_site_id is null or p_start is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if p_weekdays is null or cardinality(p_weekdays) = 0 then
    return;
  end if;

  return query
  select s.id,
         s.name,
         s.client_id,
         s.site_id,
         s.weekdays,
         (select coalesce(array_agg(w order by w), array[]::smallint[]) from unnest(s.weekdays) w where w = any (p_weekdays)),
         s.start_time,
         s.end_time,
         s.open_ended,
         s.required_staff,
         s.valid_from,
         s.valid_to,
         s.weeks_of_month
  from public.services s
  where s.site_id = p_site_id
    and s.deleted_at is null
    and s.status = 'active'
    and s.weekdays && p_weekdays
    and s.start_time < v_end
    and s.end_time > p_start
    and (p_except_id is null or s.id <> p_except_id)
  order by s.name, s.id;
end;
$$;

comment on function public.service_overlaps(uuid, smallint[], time, time, uuid) is
  'Servicios activos de la misma sede que coinciden en algún día de la semana y se superponen en horario con el que se está cargando (0082, OF-02). Solo lectura. O, A. p_except_id deja afuera al servicio que se está editando; p_end null = 23:59 (servicio «A terminar»). INVALID_TIME_RANGE si el fin no es posterior al inicio. Devuelve filas {service_id, service_name, client_id, site_id, weekdays, common_weekdays (los días en común), start_time, end_time, open_ended, required_staff, valid_from, valid_to, weeks_of_month}. No bloquea nada: la pantalla avisa «Ya existe “X” en esta sede los lunes de 15 a 17. ¿Crear igual?».';

revoke execute on function public.service_overlaps(uuid, smallint[], time, time, uuid) from public, anon;
grant execute on function public.service_overlaps(uuid, smallint[], time, time, uuid) to authenticated;

create function public.shift_overlaps_in_site(
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_except_id uuid default null
)
returns table (
  shift_id uuid,
  service_id uuid,
  service_name text,
  client_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  open_ended boolean,
  status public.shift_status,
  generated boolean,
  required_staff smallint,
  assigned_count bigint
)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
#variable_conflict use_column
declare
  v_end time := coalesce(p_end, time '23:59');
begin
  perform app.require_role('owner', 'admin');

  if p_site_id is null or p_date is null or p_start is null or v_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  return query
  select sh.id,
         sh.service_id,
         sv.name,
         sh.client_id,
         sh.shift_date,
         sh.start_time,
         sh.end_time,
         sh.open_ended,
         sh.status,
         sh.generated,
         sh.required_staff,
         (select count(*) from public.assignments a where a.shift_id = sh.id and a.removed_at is null)
  from public.shifts sh
  left join public.services sv on sv.id = sh.service_id
  where sh.site_id = p_site_id
    and sh.shift_date = p_date
    and sh.deleted_at is null
    and sh.status <> 'cancelled'
    and sh.start_time < v_end
    and sh.end_time > p_start
    and (p_except_id is null or sh.id <> p_except_id)
  order by sh.start_time, sh.id;
end;
$$;

comment on function public.shift_overlaps_in_site(uuid, date, time, time, uuid) is
  'Turnos no cancelados de la misma sede y fecha que se superponen en horario con el que se está cargando (0082, OF-02), del servicio o manuales. Solo lectura. O, A. p_except_id deja afuera al turno que se está editando; p_end null = 23:59. INVALID_TIME_RANGE si el fin no es posterior al inicio. Devuelve filas {shift_id, service_id, service_name, client_id, shift_date, start_time, end_time, open_ended, status, generated, required_staff, assigned_count}. No bloquea nada: la pantalla avisa.';

revoke execute on function public.shift_overlaps_in_site(uuid, date, time, time, uuid) from public, anon;
grant execute on function public.shift_overlaps_in_site(uuid, date, time, time, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. Cronograma arrastrable (OF-10)
-- ---------------------------------------------------------------------------------------------

-- Pasa a una persona de un turno a otro en una sola transacción: quita la asignación del turno de
-- origen (remove_assignment, con sus reglas: no empezada, turno no cancelado ni finalizado) y la
-- asigna al de destino (app.assign_employee_core, con todas sus validaciones: dotación,
-- superposición, licencia, turno empezado, etc.). Si algo falla no se mueve nada. Mover el turno
-- entero de día u hora lo hace update_shift_time (no se duplica).
create function public.move_assignment(
  p_assignment_id uuid,
  p_target_shift_id uuid,
  p_start time default null,
  p_end time default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_old public.assignments;
  v_old_shift public.shifts;
  v_previous jsonb;
  v_res jsonb;
begin
  perform app.require_role('owner', 'admin');

  select * into v_old from public.assignments where id = p_assignment_id and removed_at is null;

  if v_old.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_old.shift_id = p_target_shift_id then
    raise exception using
      errcode = 'P0001',
      message = 'La persona ya está en ese turno.',
      hint = 'MOVE_SAME_SHIFT';
  end if;

  select * into v_old_shift from public.shifts where id = v_old.shift_id;

  v_previous := jsonb_build_object(
    'assignment_id', v_old.id,
    'shift_id', v_old.shift_id,
    'shift_date', v_old_shift.shift_date,
    'employee_id', v_old.employee_id,
    'start_time', v_old.start_time,
    'end_time', v_old.end_time,
    'from_fixed', v_old.from_fixed
  );

  perform public.remove_assignment(p_assignment_id, 'Movido a otro turno');

  v_res := app.assign_employee_core(p_target_shift_id, v_old.employee_id, p_start, p_end, false);

  return jsonb_build_object(
    'assignment', v_res -> 'assignment',
    'warnings', v_res -> 'warnings',
    'previous', v_previous,
    'removed_assignment_id', p_assignment_id
  );
end;
$$;

comment on function public.move_assignment(uuid, uuid, time, time) is
  'Pasa a una persona de un turno a otro (0082, OF-10), en una transacción. O, A. p_assignment_id = la asignación vigente de origen; p_target_shift_id = el turno de destino; p_start/p_end = franja propia opcional en el destino (por omisión, la del turno). Quita la asignación de origen con motivo «Movido a otro turno» (reglas de remove_assignment: ASSIGNMENT_STARTED si ya fichó, SHIFT_CANCELLED, SHIFT_COMPLETED, SHIFT_STARTED sin manage_attendance) y asigna en el destino con las validaciones de assign_employee (SHIFT_NOT_FOUND, SHIFT_CANCELLED, SHIFT_COMPLETED, SHIFT_STARTED, SHIFT_FULL, ALREADY_ASSIGNED, EMPLOYEE_NOT_ACTIVE, ON_LEAVE, ASSIGNMENT_OVERLAP con el detalle de OF-08, INVALID_TIME_RANGE, ASSIGNMENT_TIME_OUT_OF_SHIFT). MOVE_SAME_SHIFT si el destino es el turno de origen; ASSIGNMENT_NOT_FOUND. Si algo falla no se mueve nada. Devuelve {"assignment": <fila nueva>, "warnings": [...], "previous": {assignment_id, shift_id, shift_date, employee_id, start_time, end_time, from_fixed}, "removed_assignment_id"}. Para «Deshacer»: move_assignment(assignment.id, previous.shift_id, previous.start_time, previous.end_time). Para mover el turno entero de día u hora se usa update_shift_time (la pantalla guarda el estado anterior del turno para deshacer).';

revoke execute on function public.move_assignment(uuid, uuid, time, time) from public, anon;
grant execute on function public.move_assignment(uuid, uuid, time, time) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. Sedes por estado en el día (OF-13)
-- ---------------------------------------------------------------------------------------------

-- Las vistas anteriores no alcanzaban en una sola consulta: v_presence_today trae las sedes con
-- turno hoy y su ubicación pero no el estado de cada una. Esta vista cuenta, por sede, los turnos
-- de hoy por comenzar, en curso y finalizados.
create view public.v_sites_day_status
with (security_invoker = true)
as
select
  si.id as site_id,
  si.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  si.name as site_name,
  si.latitude,
  si.longitude,
  coalesce(si.geofence_radius_m, cs.geofence_radius_m) as radius_m,
  count(*) filter (where d.phase = 'upcoming') as upcoming_count,
  count(*) filter (where d.phase = 'in_progress') as in_progress_count,
  count(*) filter (where d.phase = 'finished') as finished_count,
  count(*) as shifts_count,
  case
    when count(*) filter (where d.phase = 'in_progress') > 0 then 'in_progress'
    when count(*) filter (where d.phase = 'upcoming') > 0 then 'upcoming'
    else 'finished'
  end as day_state,
  min(d.starts_at) filter (where d.phase = 'upcoming') as next_starts_at,
  max(d.ends_at) as last_ends_at
from public.sites si
join public.clients cl on cl.id = si.client_id
cross join public.company_settings cs
join lateral (
  select
    sh.starts_at,
    sh.ends_at,
    case
      when sh.status = 'completed' then 'finished'
      when sh.status = 'in_progress' then 'in_progress'
      when now() >= sh.ends_at then 'finished'
      when now() >= sh.starts_at then 'in_progress'
      else 'upcoming'
    end as phase
  from public.shifts sh
  where sh.site_id = si.id
    and sh.shift_date = app.today()
    and sh.deleted_at is null
    and sh.status <> 'cancelled'
) d on true
where app.is_admin()
  and cs.id = 1
group by si.id, cl.id, cs.geofence_radius_m;

comment on view public.v_sites_day_status is
  'Estado de hoy de cada sede con turnos (0082, OF-13). Solo dueño y administradores (app.is_admin() en la definición; security_invoker). Una fila por sede con al menos un turno de hoy no cancelado: upcoming_count (por comenzar: todavía no es la hora de inicio), in_progress_count (en curso: turno in_progress, o ya pasó el inicio y no el fin), finished_count (finalizado: turno completed o ya pasó el fin), shifts_count, day_state (in_progress si hay alguno en curso, si no upcoming si hay alguno por comenzar, si no finished), next_starts_at (el próximo inicio entre los por comenzar), last_ends_at, y la ubicación: latitude, longitude y radius_m (el radio propio o el general). Para pintar el mapa del Resumen: amarillo = upcoming, color actual = in_progress, gris = finished.';

revoke all on public.v_sites_day_status from public, anon, authenticated;
grant select on public.v_sites_day_status to authenticated;
