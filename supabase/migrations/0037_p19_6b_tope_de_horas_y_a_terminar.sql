-- P19.6 paquete B (ajustes de la reunión del 9 oct 2026): AJ2-09 tope de horas y AJ2-10 turnos «A terminar».
--
-- Contenido, en orden:
--   0. Diseño de «A terminar»: columna `open_ended` en `services` y `shifts`, con `end_time` fijo en
--      23:59 mientras esté prendida (trigger que lo normaliza + check). Ver el bloque 0.
--   1. `app.capped_worked_minutes(check_in, check_out, franja_desde, franja_hasta)`: la ÚNICA cuenta
--      de minutos trabajados (AJ2-09), usada por todas las vistas y RPC de abajo.
--   2. `create_shift` (parámetro nuevo `p_open_ended`), `generate_shifts` (copia `open_ended` del
--      servicio) y `update_shift_time` (parámetro nuevo `p_open_ended`; permite ponerle la hora de
--      fin a un turno «A terminar» ya finalizado).
--   3. `record_check_out`: un fin propio de una asignación «A terminar» deja de poder fichar pasadas
--      las 23:59 (queda «Sin salida» hasta que administración cargue la hora).
--   4. Vistas (mismas columnas y orden que 0034/0033/0030/0011; las nuevas, al final):
--      `v_shifts_board`, `v_assignments_board`, `v_my_day`, `v_supervisions_admin`, `v_my_supervisions`.
--   5. `client_service_summary` y `clients_worked_minutes` con el tope y con el aparte «A terminar».
--   6. Grants.
--
-- Decisiones de este archivo (también en el reporte de la tarea):
--   - «A terminar» NO es `end_time` nulo: es `open_ended = true` y `end_time = 23:59`. Así la
--     restricción de exclusión de asignaciones (`assignments."window"`), `shifts.ends_at`, el
--     trigger de ventanas, la regla «un turno A terminar ocupa al empleado hasta las 23:59» y todo
--     lo que ya lee la hora de fin siguen andando sin tocarse, y los tipos del front no cambian
--     (`end_time` sigue siendo `string`, no `string | null`): lo único que el front tiene que hacer
--     es mirar `open_ended` y mostrar «A terminar» en vez de «23:59».
--   - Franja propia de una asignación dentro de un turno «A terminar» (A CONFIRMAR con Mike): se
--     permiten inicio propio y fin propio, sin cambiar las RPC de asignaciones. Sin fin propio, la
--     asignación hereda «A terminar» (es abierta: sin tope superior, estado «Sin salida»). Con fin
--     propio, para ESA persona el fin está definido: tiene tope, no entra en «Sin salida» y sus
--     horas previstas suman.
--   - Horas de un fichaje = minutos de la intersección [entrada, salida] ∩ [inicio, fin] de la
--     franja efectiva (la propia de la asignación, si no la del turno), redondeados al minuto,
--     nunca negativos. Para una asignación «A terminar» la franja llega hasta las 23:59 del día
--     (no hay turnos que crucen la medianoche, ADR-019), así que «sin tope superior» queda acotado
--     por el propio día.
--   - «Sin salida»: asignación `present` (con inicio, sin fin) de un turno «A terminar» cuya franja
--     efectiva es abierta, pasadas las 23:59 del día del turno. Se deriva en las vistas (no se
--     persiste, como `no_record`): `v_assignments_board.display_status = 'no_checkout'` y
--     `worked_minutes = 0`. Sale del estado cuando administración carga la salida con
--     `admin_record_attendance` / `close_assignment` (la asignación pasa a `finished`).

-- ---------------------------------------------------------------------------------------------
-- 0. «A terminar»: columna open_ended + fin fijo en 23:59
-- ---------------------------------------------------------------------------------------------

alter table public.services add column open_ended boolean not null default false;
alter table public.shifts add column open_ended boolean not null default false;

comment on column public.services.open_ended is
  'Turnos «A terminar» (AJ2-10, 0037): si es true los turnos que se generen nacen sin hora de fin (shifts.open_ended = true). end_time queda en 23:59 (lo fija el trigger app.normalize_open_ended): es el tope del día y lo que ocupa al empleado en la restricción de superposición, no una hora de salida prevista.';
comment on column public.shifts.open_ended is
  'Turno «A terminar» (AJ2-10, 0037): sin hora de fin prevista. end_time queda en 23:59 (trigger app.normalize_open_ended) y ocupa al empleado hasta esa hora del día. Las horas de cada empleado van desde max(su inicio fichado, inicio de la franja) hasta su fin fichado; al ponerle hora de fin al turno (update_shift_time con p_open_ended = false) vale el tope de AJ2-09. Las horas previstas (planned_minutes) de un turno abierto son null.';

create function app.normalize_open_ended()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
begin
  if new.open_ended then
    new.end_time := time '23:59';
  end if;
  return new;
end;
$$;

comment on function app.normalize_open_ended() is
  'Trigger BEFORE INSERT/UPDATE en services y shifts (0037, AJ2-10): si open_ended es true fija end_time = 23:59, así el front no tiene que inventar una hora de fin y la base nunca queda con un turno abierto con otra hora.';

create trigger trg_normalize_open_ended
before insert or update on public.services
for each row execute function app.normalize_open_ended();

create trigger trg_normalize_open_ended
before insert or update on public.shifts
for each row execute function app.normalize_open_ended();

alter table public.services
  add constraint services_open_ended_end_check check (not open_ended or end_time = time '23:59');
alter table public.shifts
  add constraint shifts_open_ended_end_check check (not open_ended or end_time = time '23:59');

-- ---------------------------------------------------------------------------------------------
-- 1. app.capped_worked_minutes (AJ2-09)
-- ---------------------------------------------------------------------------------------------

-- Una sola cuenta de «horas trabajadas» para todo el sistema: la parte del fichaje que cae dentro
-- de la franja efectiva. Llegar tarde o salir antes descuenta (aunque esté dentro de la
-- tolerancia de «Llegada tarde», que solo decide el estado); llegar antes o salir después no suma.
-- Una punta nula de la franja significa «sin tope de ese lado». Null si falta el inicio o el fin
-- fichado (mismo criterio que app.minutes_between).
create function app.capped_worked_minutes(
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_from timestamptz,
  p_to timestamptz
)
returns integer
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select case
    when p_check_in is null or p_check_out is null then null
    else greatest(
      0,
      app.minutes_between(
        greatest(p_check_in, coalesce(p_from, '-infinity'::timestamptz)),
        least(p_check_out, coalesce(p_to, 'infinity'::timestamptz))
      )
    )
  end;
$$;

comment on function app.capped_worked_minutes(timestamptz, timestamptz, timestamptz, timestamptz) is
  'Minutos trabajados con tope (0037, AJ2-09): duración de [entrada, salida] ∩ [franja desde, franja hasta], redondeada al minuto, nunca negativa; null si falta la entrada o la salida. Una punta nula de la franja = sin tope de ese lado. Es el único lugar donde se calculan las horas trabajadas: v_assignments_board.worked_minutes, v_supervisions_admin.worked_minutes, client_service_summary y clients_worked_minutes la usan.';

-- ---------------------------------------------------------------------------------------------
-- 2. RPC de turnos
-- ---------------------------------------------------------------------------------------------

-- create_shift: parámetro nuevo al final. Cambia la firma, por eso se reemplaza (drop + create) y se
-- vuelven a dar los grants. Con p_open_ended = true, p_end se ignora (puede venir null).
drop function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text);

create function public.create_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_service_id uuid default null,
  p_notes text default null,
  p_open_ended boolean default false
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
    required_staff, status, generated, notes, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, v_end, coalesce(p_open_ended, false),
    p_required_staff, 'scheduled', false, p_notes, auth.uid()
  )
  returning * into v_shift;

  perform app.copy_checklist_to_shift(v_shift.id);

  if exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    v_warnings := array_append(v_warnings, 'HOLIDAY');
  end if;

  select * into v_shift from public.shifts where id = v_shift.id;

  return jsonb_build_object('shift', to_jsonb(v_shift), 'warnings', v_warnings);
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. CLIENT_NOT_ACTIVE/SITE_NOT_ACTIVE si el cliente o la sede no están activos; INVALID_TIME_RANGE si end <= start (o si falta p_end y el turno no es «A terminar»). Copia el checklist vigente (app.copy_checklist_to_shift). Devuelve {"shift": <fila>, "warnings": [...]}; "HOLIDAY" (informativo, no bloquea) si la fecha es feriado. Desde 0037 (AJ2-10) p_open_ended = true crea un turno «A terminar» (sin hora de fin; p_end se ignora y end_time queda en 23:59).';

-- generate_shifts: igual que 0023 salvo que los turnos generados heredan open_ended del servicio.
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
  v_shift_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_holidays_skipped int := 0;
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
    returning id into v_shift_id;

    perform app.copy_checklist_to_shift(v_shift_id);

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'holidays_skipped', v_holidays_skipped);
end;
$$;

comment on function public.generate_shifts(int, int) is
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta days_of_week, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente: una segunda corrida no crea nada. Devuelve {"created", "skipped", "holidays_skipped"}. O, A + generate_shifts. Desde 0037 (AJ2-10) los turnos generados de un servicio «A terminar» nacen «A terminar» (open_ended = true).';

-- update_shift_time: parámetro nuevo al final. Reglas de 0030 (estado y superposición) más:
--   - p_open_ended = true deja el turno «A terminar» (p_end se ignora).
--   - un turno «A terminar» ya finalizado (completed) admite ponerle la hora de fin (p_open_ended =
--     false) con el mismo inicio: las horas se recalculan solas con el tope de AJ2-09. Cualquier
--     otro cambio en un turno finalizado sigue dando SHIFT_COMPLETED.
drop function public.update_shift_time(uuid, time, time);

create function public.update_shift_time(
  p_shift_id uuid,
  p_start time,
  p_end time,
  p_open_ended boolean default false
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
begin
  perform app.require_role('owner', 'admin');

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

  if v_shift.status = 'completed'
    and not (v_shift.open_ended and not v_open and p_start is not distinct from v_shift.start_time)
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

  begin
    update public.shifts
    set start_time = p_start, end_time = v_end, open_ended = v_open, updated_by = auth.uid()
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      -- La actualización ya se deshizo (subtransacción del bloque): v_shift conserva el turno
      -- anterior, que es lo que hace falta para la fecha.
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
              app.local_ts(v_shift.shift_date, coalesce(a.start_time, p_start)),
              app.local_ts(v_shift.shift_date, coalesce(a.end_time, v_end)),
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
  end;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time, boolean) is
  'Cambia la franja de un turno (04 sección 6.1, 9; 06 sección 7). O, A. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula la ventana de las asignaciones vigentes; si eso las deja superpuestas, se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP nombrando a quien queda superpuesto (0030). Fija updated_by = auth.uid() (0028). Desde 0037 (AJ2-10): p_open_ended = true deja el turno «A terminar» (p_end se ignora, end_time = 23:59); un turno «A terminar» ya finalizado admite ponerle la hora de fin (p_open_ended = false, mismo inicio) y las horas se recalculan con el tope de AJ2-09.';

-- ---------------------------------------------------------------------------------------------
-- 3. record_check_out: sin fin propio pasadas las 23:59 en una asignación «A terminar»
-- ---------------------------------------------------------------------------------------------

-- Igual que 0027 más un control: la asignación abierta (turno «A terminar» y sin fin propio) que
-- llega a las 23:59 sin fin queda «Sin salida» con 0 horas hasta que administración cargue la
-- hora; si el empleado pudiera fichar la salida al día siguiente, eso no se sostendría.
create or replace function public.record_check_out(
  p_assignment_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_record public.attendance_records;
begin
  perform app.require_role('employee');

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_assignment.employee_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no es tuya.',
      hint = 'NOT_YOUR_ASSIGNMENT';
  end if;

  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  if not exists (
    select 1 from public.attendance_records ar
    where ar.assignment_id = p_assignment_id and ar.kind = 'check_in'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no registraste el inicio.',
      hint = 'NOT_CHECKED_IN';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.assignment_id = p_assignment_id and ar.kind = 'check_out'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ya registraste el fin.',
      hint = 'ALREADY_CHECKED_OUT';
  end if;

  if v_shift.open_ended and v_assignment.end_time is null and now() >= upper(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El día del turno ya terminó y quedó sin salida: pedile a un administrador que cargue tu hora de salida.',
      hint = 'OPEN_SHIFT_DAY_ENDED';
  end if;

  if (p_lat is not null or p_lng is not null or p_accuracy is not null)
    and (p_lat is null or p_lng is null or p_accuracy is null)
  then
    raise exception using
      errcode = 'P0001',
      message = 'Si mandás la ubicación, tiene que venir completa.',
      hint = 'COORDINATES_INCOMPLETE';
  end if;

  if (p_lat is not null and (p_lat < -90 or p_lat > 90))
    or (p_lng is not null and (p_lng < -180 or p_lng > 180))
    or (p_accuracy is not null and p_accuracy < 0)
  then
    raise exception using
      errcode = 'P0001',
      message = 'La ubicación recibida no es válida.',
      hint = 'COORDINATES_OUT_OF_RANGE';
  end if;

  insert into public.attendance_records (
    assignment_id, kind, recorded_at, latitude, longitude, accuracy_m, source, recorded_by
  )
  values (
    p_assignment_id, 'check_out', now(), p_lat, p_lng, p_accuracy, 'employee_app', auth.uid()
  )
  returning * into v_record;

  update public.assignments
  set status = 'finished', updated_by = auth.uid()
  where id = p_assignment_id;

  perform app.complete_shift_if_done(v_shift.id);

  return v_record;
end;
$$;

comment on function public.record_check_out(uuid, numeric, numeric, numeric) is
  'Registra el fin de una asignación con la hora del servidor (04 sección 6.1, 6.2; 06 sección 10; P-069, P-070). E (propia). ASSIGNMENT_NOT_FOUND, NOT_YOUR_ASSIGNMENT, SHIFT_CANCELLED, NOT_CHECKED_IN, ALREADY_CHECKED_OUT, COORDINATES_INCOMPLETE/COORDINATES_OUT_OF_RANGE. Sin NOT_TODAY (P-069). Asignación -> finished; turno -> completed si ya no queda ninguna asignación vigente sin finished/absence_notified (app.complete_shift_if_done). Desde 0037 (AJ2-10): OPEN_SHIFT_DAY_ENDED si la asignación es «A terminar» (turno abierto y sin fin propio) y ya pasaron las 23:59 del día del turno: queda «Sin salida» y la hora la carga administración (admin_record_attendance / close_assignment).';

-- ---------------------------------------------------------------------------------------------
-- 4. Vistas
-- ---------------------------------------------------------------------------------------------

-- v_shifts_board: mismas columnas y orden que 0011; al final `open_ended` y `no_checkout_count`
-- (asignaciones «Sin salida» del turno).
create or replace view public.v_shifts_board
with (security_invoker = true)
as
select
  sh.id,
  sh.service_id,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.city as site_city,
  sh.shift_date,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sh.required_staff,
  sh.status,
  sh.generated,
  sh.checklist_template_id,
  sh.cancelled_at,
  sh.cancelled_by,
  sh.cancel_reason,
  sh.notes,
  coalesce(counts.assigned_count, 0) as assigned_count,
  coalesce(counts.present_count, 0) as present_count,
  coalesce(counts.finished_count, 0) as finished_count,
  coalesce(counts.absent_count, 0) as absent_count,
  coalesce(counts.delayed_count, 0) as delayed_count,
  case
    when sh.status not in ('in_progress', 'completed', 'cancelled')
      and coalesce(counts.assigned_count, 0) < sh.required_staff
      and (now() > sh.starts_at or coalesce(counts.absent_count, 0) > 0)
      then 'uncovered'
    when sh.status in ('scheduled', 'assigned')
      and sh.starts_at > now()
      and sh.starts_at <= now() + interval '2 hours'
      then 'upcoming'
    else sh.status::text
  end as display_status,
  sh.created_at,
  sh.updated_at,
  sh.created_by,
  sh.updated_by,
  sh.deleted_at,
  sh.open_ended,
  coalesce(counts.no_checkout_count, 0) as no_checkout_count
from public.shifts sh
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join lateral (
  select
    count(*) filter (where a.removed_at is null) as assigned_count,
    count(*) filter (where a.removed_at is null and a.status = 'present') as present_count,
    count(*) filter (where a.removed_at is null and a.status = 'finished') as finished_count,
    count(*) filter (where a.removed_at is null and a.status = 'absence_notified') as absent_count,
    count(*) filter (where a.removed_at is null and a.status = 'delay_notified') as delayed_count,
    count(*) filter (
      where a.removed_at is null
        and a.status = 'present'
        and sh.open_ended
        and a.end_time is null
        and sh.status <> 'cancelled'
        and now() >= upper(a."window")
    ) as no_checkout_count
  from public.assignments a
  where a.shift_id = sh.id
) counts on true
where sh.deleted_at is null;

comment on view public.v_shifts_board is
  'Planificación, asistencia de hoy y tablero (04 sección 4). display_status agrega los derivados uncovered/upcoming sobre shifts.status (fórmula en el comentario de 0011). open_ended (0037, AJ2-10): turno «A terminar»; el front muestra «A terminar» en vez de end_time (que queda en 23:59). no_checkout_count (0037): asignaciones vigentes «Sin salida» (present, turno abierto, sin fin propio, pasadas las 23:59). security_invoker: visibilidad de filas por RLS de shifts/clients/sites (0012, DB-014).';

-- v_assignments_board: columnas de 0034. Cambia el significado de planned_minutes (null en una
-- asignación «A terminar»), minutes_early_leave (null en una asignación abierta), worked_minutes
-- (con tope, AJ2-09; 0 si está «Sin salida») y display_status (valor nuevo `no_checkout`). Al final
-- `effective_open_ended`.
create or replace view public.v_assignments_board
with (security_invoker = true)
as
select
  a.id,
  a.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  a.employee_id,
  p.first_name as employee_first_name,
  p.last_name as employee_last_name,
  p.avatar_path as employee_avatar_path,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  case
    when ci.recorded_at is not null and ci.recorded_at > lower(a."window")
      then round(extract(epoch from (ci.recorded_at - lower(a."window"))) / 60)::int
    else null
  end as minutes_late,
  case
    when sh.open_ended and a.end_time is null then null
    when co.recorded_at is not null and co.recorded_at < upper(a."window")
      then round(extract(epoch from (upper(a."window") - co.recorded_at)) / 60)::int
    else null
  end as minutes_early_leave,
  case
    when a.status in ('expected', 'delay_notified')
      and notice.kind = 'on_the_way'
      and ci.recorded_at is null
      and now() < upper(a."window")
      and now() <= coalesce(notice.estimated_arrival_at, lower(a."window"))
                   + make_interval(mins => app.late_grace_minutes())
      then 'on_the_way'
    when a.status in ('expected', 'delay_notified')
      and now() > lower(a."window")
      and now() <= lower(a."window") + make_interval(mins => app.late_grace_minutes())
      then 'late'
    when a.status in ('expected', 'delay_notified') and now() > lower(a."window")
      then 'no_record'
    when a.status = 'present'
      and a.removed_at is null
      and sh.open_ended
      and a.end_time is null
      and sh.status <> 'cancelled'
      and now() >= upper(a."window")
      then 'no_checkout'
    else a.status::text
  end as display_status,
  a.removed_at,
  a.removed_by,
  a.removed_reason,
  a.created_at,
  a.updated_at,
  a.created_by,
  a.updated_by,
  ci.source as check_in_source,
  ci.recorded_by as check_in_recorded_by,
  co.source as check_out_source,
  co.recorded_by as check_out_recorded_by,
  notice.kind as last_notice_kind,
  notice.minutes_late as last_notice_minutes_late,
  notice.reason_code as last_notice_reason_code,
  notice.reason_text as last_notice_reason_text,
  notice.reported_by as last_notice_reported_by,
  notice.source as last_notice_source,
  notice.created_at as last_notice_at,
  notice.estimated_arrival_at as last_notice_estimated_arrival_at,
  case
    when sh.open_ended and a.end_time is null then null
    else app.minutes_between(lower(a."window"), upper(a."window"))
  end as planned_minutes,
  case
    when a.status = 'present'
      and a.removed_at is null
      and sh.open_ended
      and a.end_time is null
      and sh.status <> 'cancelled'
      and now() >= upper(a."window")
      then 0
    else app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window"))
  end as worked_minutes,
  (sh.open_ended and a.end_time is null) as effective_open_ended
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source,
         an.created_at, an.estimated_arrival_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true;

comment on view public.v_assignments_board is
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status deriva (no se persiste), sobre expected/delay_notified sin inicio registrado y en este orden: on_the_way (último aviso en camino, franja sin terminar y now() <= vencimiento del aviso: hora estimada + app.late_grace_minutes(), o inicio efectivo + app.late_grace_minutes() si no indicó estimación; 0034), late («Llegada tarde»: pasó el inicio efectivo hace app.late_grace_minutes() = 15 minutos o menos, P19.5a) y no_record (más de esos minutos, P-071); no_checkout («Sin salida», 0037, AJ2-10): asignación present de un turno «A terminar» sin fin propio, vigente, pasadas las 23:59 del día del turno; en los demás casos es assignments.status. minutes_late / minutes_early_leave (P-076) comparan contra la franja efectiva (assignments."window"); minutes_early_leave es null en una asignación «A terminar» (no tiene fin previsto). planned_minutes: duración de la franja efectiva, null si la asignación es «A terminar» (0037). worked_minutes (AJ2-09, 0037): minutos de [inicio fichado, fin fichado] dentro de la franja efectiva (app.capped_worked_minutes), redondeados al minuto, nunca negativos; null si falta alguno; 0 si está «Sin salida». El front muestra tilde si worked_minutes >= planned_minutes sin margen y advertencia si es menor o hubo salida anticipada. effective_open_ended (0037): la asignación es «A terminar» (turno abierto y sin fin propio); el front muestra «A terminar» en vez de effective_end_time (23:59). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027). last_notice_*: último aviso de la asignación (por created_at). Incluye asignaciones quitadas (removed_at not null). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices.';

-- v_my_day: columnas de 0034 y, al final, `effective_open_ended` y `no_checkout`.
create or replace view public.v_my_day
with (security_invoker = true)
as
select
  a.id as assignment_id,
  a.shift_id,
  sh.shift_date,
  (sh.shift_date = app.today()) as is_today,
  sh.client_id,
  cl.legal_name as client_legal_name,
  cl.trade_name as client_trade_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions,
  si.building_hours,
  si.phone_restricted,
  si.photos_not_allowed,
  si.restrictions_notes,
  coalesce(a.start_time, sh.start_time) as effective_start_time,
  coalesce(a.end_time, sh.end_time) as effective_end_time,
  lower(a."window") as effective_starts_at,
  upper(a."window") as effective_ends_at,
  a.status,
  sh.status as shift_status,
  a.notes,
  coalesce(tasks.tasks_total, 0) as tasks_total,
  coalesce(tasks.tasks_done, 0) as tasks_done,
  (
    (
      coalesce(a.updated_at, a.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (a.updated_at is null or a.updated_by is distinct from a.employee_id)
    )
    or
    (
      coalesce(sh.updated_at, sh.created_at) > coalesce(p.last_seen_changes_at, '-infinity'::timestamptz)
      and (sh.updated_at is null or sh.updated_by is distinct from a.employee_id)
    )
  ) as changed_since_last_seen,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  ci.source as check_in_source,
  ci.recorded_by as check_in_recorded_by,
  co.source as check_out_source,
  co.recorded_by as check_out_recorded_by,
  notice.kind as last_notice_kind,
  notice.minutes_late as last_notice_minutes_late,
  notice.reason_code as last_notice_reason_code,
  notice.reason_text as last_notice_reason_text,
  notice.reported_by as last_notice_reported_by,
  notice.source as last_notice_source,
  notice.created_at as last_notice_at,
  notice.estimated_arrival_at as last_notice_estimated_arrival_at,
  case
    when notice.kind = 'on_the_way'
      then coalesce(notice.estimated_arrival_at, lower(a."window"))
           + make_interval(mins => app.late_grace_minutes())
    else null
  end as on_the_way_expires_at,
  (sh.open_ended and a.end_time is null) as effective_open_ended,
  (
    a.status = 'present'
    and sh.open_ended
    and a.end_time is null
    and sh.status <> 'cancelled'
    and now() >= upper(a."window")
  ) as no_checkout
from public.assignments a
join public.shifts sh on sh.id = a.shift_id
join public.v_clients_basic cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = a.employee_id
left join lateral (
  select
    count(*) as tasks_total,
    count(*) filter (where st.status = 'done') as tasks_done
  from public.shift_tasks st
  where st.shift_id = a.shift_id
) tasks on true
left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
left join lateral (
  select an.kind, an.minutes_late, an.reason_code, an.reason_text, an.reported_by, an.source,
         an.created_at, an.estimated_arrival_at
  from public.attendance_notices an
  where an.assignment_id = a.id
  order by an.created_at desc
  limit 1
) notice on true
where a.employee_id = auth.uid()
  and a.removed_at is null
  and sh.shift_date between app.today() and app.today() + 7;

comment on view public.v_my_day is
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028). is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_estimated_arrival_at (0033) y on_the_way_expires_at (0034): aviso «en camino» y hasta cuándo vale. effective_open_ended (0037, AJ2-10): la asignación es «A terminar» (turno abierto y sin fin propio): el celular muestra «A terminar» en vez de effective_end_time (23:59). no_checkout (0037): «Sin salida» (present, abierta, pasadas las 23:59 del día del turno); la salida ya no se puede fichar desde el celular (record_check_out da OPEN_SHIFT_DAY_ENDED) y la carga administración. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices.';

-- v_supervisions_admin: columnas de 0033. worked_minutes con tope contra la franja del turno
-- (AJ2-09), planned_minutes null si el turno es «A terminar». Al final `shift_open_ended`.
create or replace view public.v_supervisions_admin
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  sv.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  sv.status,
  sv.assigned_by,
  sv.assigned_at,
  sv.not_done_reason,
  sv.cancel_reason,
  sv.general_notes,
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(r.ratings_count, 0) as ratings_count,
  r.ratings_avg,
  sv.created_at,
  sv.updated_at,
  sh.start_time,
  sh.end_time,
  sh.starts_at,
  sh.ends_at,
  sv.criteria_snapshot,
  coalesce(emp.assigned_employees_count, 0) as assigned_employees_count,
  case when sh.open_ended then null else app.minutes_between(sh.starts_at, sh.ends_at) end as planned_minutes,
  app.capped_worked_minutes(ci.recorded_at, co.recorded_at, sh.starts_at, sh.ends_at) as worked_minutes,
  sh.open_ended as shift_open_ended
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
join public.profiles p on p.id = sv.supervisor_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select count(*) as ratings_count, avg(rt.score)::numeric(3, 2) as ratings_avg
  from public.ratings rt
  where rt.supervision_id = sv.id
) r on true
left join lateral (
  select count(*) as assigned_employees_count
  from public.assignments a
  where a.shift_id = sv.shift_id and a.removed_at is null
) emp on true;

comment on view public.v_supervisions_admin is
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). ratings_count/ratings_avg: cantidad y promedio simple del turno. start_time/end_time/starts_at/ends_at: franja del turno (0029, ADM-13). criteria_snapshot: criterios vigentes al iniciar (ADM-15). assigned_employees_count: empleados asignados vigentes del turno (0029). planned_minutes/worked_minutes (0033, P19.5a): duración de la franja y minutos de la supervisión, para las horas del supervisor en la pestaña Asistencia de su ficha (ADM-12). Desde 0037 (AJ2-09/AJ2-10) worked_minutes cuenta solo la parte de [inicio real, fin real] dentro de la franja del turno (app.capped_worked_minutes; A CONFIRMAR con Mike que el tope también rige para supervisores) y planned_minutes es null si el turno es «A terminar»; shift_open_ended (0037) avisa que el turno es «A terminar» (end_time = 23:59 no es una hora de fin). security_invoker: visibilidad de filas por RLS (0012) -- en la práctica solo O/A ven filas.';

-- v_my_supervisions: columnas de 0030 y, al final, `shift_open_ended` (el celular del supervisor
-- muestra «A terminar» en vez de la hora de fin).
create or replace view public.v_my_supervisions
with (security_invoker = true)
as
select
  sv.id,
  sv.shift_id,
  sh.shift_date,
  sh.client_id,
  cl.legal_name as client_legal_name,
  sh.site_id,
  si.name as site_name,
  si.address as site_address,
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
  ci.recorded_at as check_in_at,
  co.recorded_at as check_out_at,
  coalesce(emp.employees, '[]'::jsonb) as assigned_employees,
  si.city as site_city,
  si.latitude as site_latitude,
  si.longitude as site_longitude,
  si.contact_name as site_contact_name,
  si.contact_phone as site_contact_phone,
  si.access_instructions as site_access_instructions,
  si.building_hours as site_building_hours,
  si.phone_restricted as site_phone_restricted,
  si.photos_not_allowed as site_photos_not_allowed,
  si.restrictions_notes as site_restrictions_notes,
  sh.open_ended as shift_open_ended
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select jsonb_agg(
      jsonb_build_object(
        'employee_id', a.employee_id,
        'first_name', p2.first_name,
        'last_name', p2.last_name,
        'status', a.status,
        'check_in_at', ar.recorded_at
      )
      order by p2.last_name, p2.first_name
    ) as employees
  from public.assignments a
  join public.v_people_basic p2 on p2.profile_id = a.employee_id
  left join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
  where a.shift_id = sv.shift_id
    and a.removed_at is null
) emp on true
where sv.supervisor_id = auth.uid();

comment on view public.v_my_supervisions is
  'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", 0029, SUP-03); el nombre sale de v_people_basic (0030, DEF-P03). site_* (0029, SUP-006). shift_open_ended (0037, AJ2-10): el turno es «A terminar»; la pantalla muestra «A terminar» en vez de end_time (23:59). security_invoker: además queda sujeta a la RLS de supervisions/shifts/clients/sites/assignments.';

-- ---------------------------------------------------------------------------------------------
-- 5. Resumen por cliente y minutos por cliente (AJ2-09, AJ2-10)
-- ---------------------------------------------------------------------------------------------

-- Igual que 0033 salvo: minutos trabajados con tope contra la franja efectiva de cada asignación,
-- horas previstas null/no suman en las asignaciones «A terminar», y el aparte «A terminar»:
-- shifts[].open_ended, shifts[].employees[].open_ended / no_checkout y totals.open_ended_shifts.
create or replace function public.client_service_summary(
  p_client_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_client_exists boolean;
  v_result jsonb;
begin
  -- Lo ve quien puede ver clientes (clients_select_admin, 0012): dueño y cualquier administrador.
  perform app.require_admin();

  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El rango de fechas no es válido: la fecha desde no puede ser posterior a la fecha hasta.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  select exists (select 1 from public.clients c where c.id = p_client_id) into v_client_exists;

  if not v_client_exists then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  with done_shifts as (
    select sh.id, sh.shift_date, sh.site_id, si.name as site_name, sh.start_time, sh.end_time,
           sh.status, sh.open_ended
    from public.shifts sh
    join public.sites si on si.id = sh.site_id
    where sh.client_id = p_client_id
      and sh.deleted_at is null
      and sh.status <> 'cancelled'
      and sh.shift_date between p_from and p_to
      and (
        sh.status = 'completed'
        or exists (
          select 1
          from public.assignments a
          join public.attendance_records ar on ar.assignment_id = a.id and ar.kind = 'check_in'
          where a.shift_id = sh.id
        )
      )
  ),
  rows as (
    select
      ds.id as shift_id,
      a.id as assignment_id,
      a.employee_id,
      p.first_name,
      p.last_name,
      a.status,
      ci.recorded_at as check_in_at,
      co.recorded_at as check_out_at,
      (ds.open_ended and a.end_time is null) as open_ended,
      (
        a.status = 'present'
        and ds.open_ended
        and a.end_time is null
        and now() >= upper(a."window")
      ) as no_checkout,
      case
        when ds.open_ended and a.end_time is null then null
        else app.minutes_between(lower(a."window"), upper(a."window"))
      end as planned_minutes,
      app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window")) as worked_minutes
    from done_shifts ds
    join public.assignments a on a.shift_id = ds.id and a.removed_at is null
    join public.profiles p on p.id = a.employee_id
    left join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    left join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
  ),
  per_shift as (
    select
      ds.id,
      coalesce(sum(r.worked_minutes), 0)::integer as worked_minutes,
      coalesce(sum(r.planned_minutes) filter (where r.check_in_at is not null), 0)::integer as planned_minutes,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'assignment_id', r.assignment_id,
            'employee_id', r.employee_id,
            'first_name', r.first_name,
            'last_name', r.last_name,
            'status', r.status,
            'check_in_at', r.check_in_at,
            'check_out_at', r.check_out_at,
            'planned_minutes', r.planned_minutes,
            'worked_minutes', r.worked_minutes,
            'open_ended', r.open_ended,
            'no_checkout', r.no_checkout
          )
          order by r.last_name, r.first_name, r.assignment_id
        ) filter (where r.assignment_id is not null),
        '[]'::jsonb
      ) as employees
    from done_shifts ds
    left join rows r on r.shift_id = ds.id
    group by ds.id
  )
  select jsonb_build_object(
    'client_id', p_client_id,
    'from', p_from,
    'to', p_to,
    'totals', jsonb_build_object(
      'shifts_done', (select count(*) from done_shifts),
      'employees_count', (select count(distinct employee_id) from rows where check_in_at is not null),
      'worked_minutes', coalesce((select sum(worked_minutes) from rows), 0),
      'planned_minutes', coalesce((select sum(planned_minutes) from rows where check_in_at is not null), 0),
      'open_ended_shifts', (select count(*) from done_shifts where open_ended)
    ),
    'shifts', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'shift_id', ds.id,
            'shift_date', ds.shift_date,
            'site_id', ds.site_id,
            'site_name', ds.site_name,
            'start_time', ds.start_time,
            'end_time', ds.end_time,
            'status', ds.status,
            'worked_minutes', ps.worked_minutes,
            'planned_minutes', ps.planned_minutes,
            'employees', ps.employees,
            'open_ended', ds.open_ended
          )
          order by ds.shift_date, ds.start_time, ds.site_name, ds.id
        )
        from done_shifts ds
        join per_shift ps on ps.id = ds.id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.client_service_summary(uuid, date, date) is
  'Resumen de servicios de un cliente en un período, para la hoja imprimible (0033, P19.5a). O, A (quien ve clientes, clients_select_admin); FORBIDDEN si no; INVALID_DATE_RANGE (fechas nulas o desde > hasta), CLIENT_NOT_FOUND. "Turno realizado": vigente, no cancelado, completed o con al menos un inicio registrado, con shift_date entre p_from y p_to. Devuelve jsonb { client_id, from, to, totals { shifts_done, employees_count (distintos con inicio), worked_minutes, planned_minutes, open_ended_shifts (turnos «A terminar», 0037) }, shifts [ { shift_id, shift_date, site_id, site_name, start_time, end_time, status, worked_minutes, planned_minutes, open_ended (0037), employees [ { assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at, planned_minutes, worked_minutes, open_ended, no_checkout } ] } ] } ordenado por fecha, hora y sede. Desde 0037 (AJ2-09/AJ2-10): worked_minutes cuenta solo la parte del fichaje dentro de la franja efectiva de cada asignación (app.capped_worked_minutes); las asignaciones «A terminar» (open_ended) tienen planned_minutes null y no suman a las previstas; una asignación sin salida (no_checkout) suma 0 horas hasta que administración cargue la hora. employees lista las asignaciones vigentes del turno (también las sin inicio, con worked_minutes null). end_time = 23:59 en un turno open_ended no es una hora de fin: se muestra «A terminar».';

create or replace function public.clients_worked_minutes(p_from date, p_to date)
returns table (client_id uuid, worked_minutes bigint)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  perform app.require_admin();

  if p_from is null or p_to is null or p_from > p_to then
    raise exception using
      errcode = 'P0001',
      message = 'El rango de fechas no es válido: la fecha desde no puede ser posterior a la fecha hasta.',
      hint = 'INVALID_DATE_RANGE';
  end if;

  return query
  select
    c.id,
    coalesce(w.minutes, 0)::bigint
  from public.clients c
  left join lateral (
    select sum(app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window"))) as minutes
    from public.shifts sh
    join public.assignments a on a.shift_id = sh.id and a.removed_at is null
    join public.attendance_records ci on ci.assignment_id = a.id and ci.kind = 'check_in'
    join public.attendance_records co on co.assignment_id = a.id and co.kind = 'check_out'
    where sh.client_id = c.id
      and sh.deleted_at is null
      and sh.status <> 'cancelled'
      and sh.shift_date between p_from and p_to
  ) w on true
  order by c.id;
end;
$$;

comment on function public.clients_worked_minutes(date, date) is
  'Minutos trabajados por cliente en un período, para la columna del listado de Clientes (0033, P19.5a). O, A; FORBIDDEN si no; INVALID_DATE_RANGE. Devuelve (client_id, worked_minutes) para TODOS los clientes (0 si no hubo trabajo); suma, por asignación vigente de turnos vigentes no cancelados con shift_date entre p_from y p_to, los minutos del fichaje dentro de la franja efectiva (app.capped_worked_minutes, 0037, AJ2-09) -- mismo criterio que client_service_summary.totals.worked_minutes. Una asignación sin salida suma 0. El front pasa el mes en curso: del 1 a hoy en hora de Argentina.';

-- ---------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------

-- Las vistas corren con los permisos de quien consulta (security_invoker): la función de app que
-- usan tiene que ser ejecutable por authenticated y por service_role (0031, 0033).
grant execute on function app.capped_worked_minutes(timestamptz, timestamptz, timestamptz, timestamptz)
  to authenticated, service_role;

revoke execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean) from public, anon;
grant execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean) to authenticated;

revoke execute on function public.update_shift_time(uuid, time, time, boolean) from public, anon;
grant execute on function public.update_shift_time(uuid, time, time, boolean) to authenticated;
