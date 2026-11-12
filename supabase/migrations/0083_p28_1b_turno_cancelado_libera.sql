-- P28.1b (0083): un turno cancelado libera a los empleados sin quitarles la asignación (OF-04b,
-- decisión de Mike del 12 nov 2026, opción b).
--
-- La 0082 quitaba con removed_at las asignaciones sin fichajes de un turno cancelado. Eso dejaba al
-- empleado sin ver el turno cancelado en Hoy, historial y demás lecturas que filtran por
-- removed_at (DEF-01 / P-049: el empleado tiene que ver su turno como cancelado). Esta migración:
--   1. agrega assignments.released_at / released_by: «liberada» = la asignación sigue vigente para
--      la lectura (el empleado ve el turno cancelado) pero ya no ocupa horario;
--   2. reconstruye assignments_no_overlap y app.overlap_conflict para ignorar las liberadas;
--   3. cancel_shift libera (released_at) en lugar de quitar (removed_at);
--   4. corrige los datos: lo que la 0082 quitó con «Turno cancelado» pasa a liberada, y las vivas
--      de turnos cancelados sin fichajes también (idempotente).
-- Las asignaciones con fichajes siguen vivas y sin liberar (son historia de asistencia).

alter table public.assignments
  add column released_at timestamptz,
  add column released_by uuid references public.profiles (id);

alter table public.assignments
  add constraint assignments_released_fields_check check (
    released_at is null or released_by is not null
  );

comment on column public.assignments.released_at is
  'Liberada por la cancelación del turno (0083, OF-04b): la asignación sigue vigente (removed_at nulo, el empleado ve el turno cancelado) pero ya no ocupa su horario: queda fuera de assignments_no_overlap y de app.overlap_conflict.';
comment on column public.assignments.released_by is
  'Quién canceló el turno que liberó la asignación (0083).';

-- Restricción de exclusión sin las liberadas. Se suelta y se vuelve a crear antes de corregir los
-- datos para que la corrección no dependa del orden.
alter table public.assignments drop constraint assignments_no_overlap;

-- Corrección de datos (idempotente) ------------------------------------------------------------
-- a) Lo que la 0082 quitó por la cancelación vuelve a vigente, ahora como liberada.
update public.assignments a
set released_at = a.removed_at,
    released_by = a.removed_by,
    removed_at = null,
    removed_by = null,
    removed_reason = null
from public.shifts sh
where sh.id = a.shift_id
  and sh.status = 'cancelled'
  and a.removed_at is not null
  and a.removed_reason = 'Turno cancelado'
  and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

-- b) Las vivas de turnos cancelados sin fichajes quedan liberadas.
update public.assignments a
set released_at = now(),
    released_by = coalesce(sh.cancelled_by, a.updated_by, a.created_by)
from public.shifts sh
where sh.id = a.shift_id
  and sh.status = 'cancelled'
  and a.removed_at is null
  and a.released_at is null
  and coalesce(sh.cancelled_by, a.updated_by, a.created_by) is not null
  and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

alter table public.assignments
  add constraint assignments_no_overlap
  exclude using gist (
    employee_id with =,
    "window" with &&
  )
  where (removed_at is null and released_at is null);

-- app.overlap_conflict ignora las liberadas ------------------------------------------------------
create or replace function app.overlap_conflict(
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
    and b.released_at is null
    and b."window" && tstzrange(p_from, p_to, '[)')
    and (p_except_shift_id is null or b.shift_id <> p_except_shift_id)
  order by lower(b."window"), b.id
  limit 1;
$$;

comment on function app.overlap_conflict(uuid, timestamptz, timestamptz, uuid) is
  'Uso interno (0082, OF-08; 0083): la primera asignación vigente y no liberada del empleado que se superpone con [p_from, p_to), con sede, servicio, fecha y horario, y el mensaje «Acosta ya está en YPF RUTA (YPF RUTA TURNO TARDE) el lun 9/11 de 15:00 a 17:00.». Las liberadas por la cancelación del turno no cuentan. Null si no hay choque.';

-- cancel_shift libera en lugar de quitar ----------------------------------------------------------
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

  -- OF-04b (0083): libera a los empleados sin fichajes; la asignación sigue vigente para que vean el turno cancelado.
  update public.assignments a
  set released_at = now(), released_by = auth.uid(), updated_by = auth.uid()
  where a.shift_id = p_shift_id
    and a.removed_at is null
    and a.released_at is null
    and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);

  return v_shift;
end;
$$;

comment on function public.cancel_shift(uuid, text) is
  'Cancela un turno con motivo obligatorio (04 sección 9, 6.1; 06 sección 7; P-049). O, A + cancel_shifts. SHIFT_CANCELLED/SHIFT_COMPLETED si ya está en ese estado; CANCEL_REASON_REQUIRED sin motivo. Cancela las supervisiones assigned/in_progress de ese turno. Desde 0083 (OF-04b) libera (released_at/released_by) las asignaciones vigentes que no tienen fichajes: dejan de ocupar el horario del empleado pero siguen vigentes, así que el empleado ve el turno como cancelado (DEF-01, P-049). Las que ya tienen algún fichaje se conservan sin liberar como historia. No hay acción para descancelar un turno.';
