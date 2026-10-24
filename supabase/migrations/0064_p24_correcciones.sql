-- 0064_p24_correcciones.sql
-- Correcciones de P24 (coordinación libre y jornada del coordinador), 24 oct 2026.
--
--   DEF-P24-01: la administración no podía corregir el fin de una jornada cerrada sola cuando
--     quedaba una supervisión «Sin cerrar» y la hora nueva era anterior a las 23:55: el cierre
--     automático registra un supervision_end a las 23:55 y, al mover el fin de la jornada, ese
--     evento quedaba posterior al fin (INVALID_EVENT_ORDER), mientras que los eventos de
--     supervisión no se corrigen (EVENT_NOT_CORRECTABLE). Cancelar o descartar la supervisión
--     tampoco daba de baja su evento.
--   DEF-P24-02 (parte de base): app.supervisor_today / v_supervisor_today suman site_radius_m y
--     max_accuracy_m, para que SUP-03 muestre el radio propio de la sede y la precisión máxima.
--
-- Regla elegida (CJ-17, CJ-32):
--   1. Al corregir el evento `end` de un cierre automático (reason = 'Cierre automático'), los
--      supervision_end que generó ese mismo cierre (reason = 'Cierre automático', misma hora que
--      el fin) y el check_out sin posición de su supervisión se mueven solos a la hora nueva, en
--      la misma transacción y con la misma traza (corrected_from, corrected_at, corrected_by,
--      correction_reason). El supervision_end que registró el coordinador no se toca nunca.
--   2. Caso borde: si la hora nueva queda ANTES del inicio de una de esas supervisiones se rechaza
--      con END_BEFORE_SUPERVISION_START (hay que cancelarla antes, o elegir una hora posterior).
--   3. Cancelar (cancel_supervision) o descartar (discard_supervision) una supervisión da de baja
--      lógica (P-014) todos sus eventos de jornada (inicio y, si lo tenía, el fin automático),
--      para que no impongan orden. Los datos anteriores a esta migración se regularizan abajo.
-- Los grants no cambian: create or replace conserva los de las funciones existentes.

-- ---------------------------------------------------------------------------------------------
-- 1. Baja de los eventos de jornada de una supervisión cancelada o descartada
-- ---------------------------------------------------------------------------------------------

create function app.remove_supervision_workday_events(p_supervision_id uuid)
returns integer
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_count integer;
begin
  update public.supervisor_workday_events
  set removed_at = now(), removed_by = auth.uid()
  where supervision_id = p_supervision_id
    and kind in ('supervision_start', 'supervision_end')
    and removed_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function app.remove_supervision_workday_events(uuid) is
  'Uso interno (0064, DEF-P24-01): da de baja lógica los eventos supervision_start y supervision_end vigentes de una supervisión cancelada o descartada, para que no impongan orden a la jornada.';

revoke execute on function app.remove_supervision_workday_events(uuid) from public, anon, authenticated;

-- 1.1 cancel_supervision: igual que 0029 más la baja de los eventos de jornada.
create or replace function public.cancel_supervision(p_supervision_id uuid, p_reason text)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
begin
  perform app.require_capability('manage_supervisions');

  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_supervision.status not in ('assigned', 'in_progress') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'CANCEL_REASON_REQUIRED';
  end if;

  update public.supervisions
  set status = 'cancelled', cancel_reason = p_reason, updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  -- 0064: sus eventos de jornada (inicio y fin automático) se dan de baja.
  perform app.remove_supervision_workday_events(p_supervision_id);

  return v_supervision;
end;
$$;

comment on function public.cancel_supervision(uuid, text) is
  'Cancela una supervisión assigned/in_progress con motivo obligatorio (04 sección 6.4, 9; 06 sección 12). Desde 0064 también da de baja sus eventos de jornada (supervision_start y, si la jornada se cerró sola, el supervision_end automático), de modo que una supervisión «Sin cerrar» cancelada no traba la corrección de la jornada. O, A + manage_supervisions. SUPERVISION_NOT_FOUND, SUPERVISION_NOT_EDITABLE (ya completed/not_done/cancelled), CANCEL_REASON_REQUIRED sin motivo.';

-- 1.2 discard_supervision: igual que 0063 pero da de baja también el fin automático, si lo hay.
create or replace function public.discard_supervision(p_supervision_id uuid)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
begin
  perform app.require_role('supervisor');

  select * into v_supervision from public.supervisions where id = p_supervision_id for update;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if v_supervision.supervisor_id <> auth.uid() then
    raise exception using
      errcode = 'P0001',
      message = 'Esa supervisión no es tuya.',
      hint = 'NOT_YOUR_SUPERVISION';
  end if;

  if v_supervision.status <> 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  if exists (select 1 from public.ratings r where r.supervision_id = p_supervision_id) then
    raise exception using
      errcode = 'P0001',
      message = 'Ya calificaste a alguien: no podés descartar esta supervisión.',
      hint = 'SUPERVISION_HAS_RATINGS';
  end if;

  update public.supervisions
  set status = 'cancelled', cancel_reason = 'Descartada por el coordinador', updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  -- Los eventos de la jornada de una supervisión descartada se dan de baja (baja lógica, P-014): no
  -- queda un inicio sin fin ni un fin automático que imponga orden (0064).
  perform app.remove_supervision_workday_events(p_supervision_id);

  return v_supervision;
end;
$$;

comment on function public.discard_supervision(uuid) is
  'Descarta una supervisión empezada por error, si todavía no calificó a nadie (CJ-27): queda cancelled con el motivo «Descartada por el coordinador», sus eventos de jornada (supervision_start y el fin automático, si lo hay) se dan de baja y puede volver a tomar ese turno. S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, SUPERVISION_NOT_EDITABLE (no está in_progress), SUPERVISION_HAS_RATINGS.';

-- ---------------------------------------------------------------------------------------------
-- 2. Corrección de horarios (CJ-17, CJ-32)
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_correct_workday_event(
  p_event_id uuid,
  p_reason text,
  p_new_time timestamptz default null,
  p_remove boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_event public.supervisor_workday_events;
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_old timestamptz;
  v_next public.supervisor_workday_events;
  v_auto_ids uuid[] := array[]::uuid[];
begin
  perform app.require_capability('manage_attendance');

  select * into v_event from public.supervisor_workday_events where id = p_event_id for update;

  if v_event.id is null or v_event.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese evento de la jornada.',
      hint = 'EVENT_NOT_FOUND';
  end if;

  select * into v_wd from public.supervisor_workdays where id = v_event.workday_id for update;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if v_event.kind in ('supervision_start', 'supervision_end') then
    raise exception using
      errcode = 'P0001',
      message = case
        when v_event.kind = 'supervision_end' and v_event.reason = 'Cierre automático'
          then 'El fin automático de una supervisión se ajusta solo cuando corregís el fin de la jornada.'
        else 'Los eventos de una supervisión no se corrigen desde la jornada.'
      end,
      hint = 'EVENT_NOT_CORRECTABLE';
  end if;

  v_old := v_event.recorded_at;

  if coalesce(p_remove, false) then
    if v_event.kind <> 'pause' then
      raise exception using
        errcode = 'P0001',
        message = 'Solo se pueden quitar las pausas.',
        hint = 'EVENT_NOT_REMOVABLE';
    end if;

    -- La pausa se quita junto con la reanudación que la cierra (si la cierra una).
    select e.* into v_next
    from public.supervisor_workday_events e
    where e.workday_id = v_event.workday_id
      and e.removed_at is null
      and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
      and (e.recorded_at, e.seq) > (v_event.recorded_at, v_event.seq)
    order by e.recorded_at, e.seq
    limit 1;

    update public.supervisor_workday_events
    set removed_at = now(), removed_by = auth.uid(), correction_reason = v_reason,
        corrected_by = auth.uid(), corrected_at = now()
    where id = v_event.id;

    if v_next.id is not null and v_next.kind = 'resume' then
      update public.supervisor_workday_events
      set removed_at = now(), removed_by = auth.uid(), correction_reason = v_reason,
          corrected_by = auth.uid(), corrected_at = now()
      where id = v_next.id;
    end if;
  else
    if p_new_time is null then
      raise exception using
        errcode = 'P0001',
        message = 'Indicá la hora nueva.',
        hint = 'TIME_REQUIRED';
    end if;

    if p_new_time < app.local_ts(v_wd.work_date, time '00:00')
      or p_new_time >= app.local_ts(v_wd.work_date + 1, time '00:00')
      or p_new_time > now()
    then
      raise exception using
        errcode = 'P0001',
        message = 'La hora tiene que estar dentro del día de la jornada y no puede ser futura.',
        hint = 'AT_OUT_OF_RANGE';
    end if;

    if p_new_time = v_event.recorded_at then
      raise exception using
        errcode = 'P0001',
        message = 'La hora nueva es igual a la actual.',
        hint = 'SAME_TIME';
    end if;

    -- 0064 (DEF-P24-01): si es el fin de un cierre automático, los supervision_end que generó ese
    -- mismo cierre (reason «Cierre automático», misma hora que el fin, supervisión no cancelada)
    -- acompañan a la hora nueva. El que registró el coordinador (sin reason) no se toca.
    if v_event.kind = 'end' and v_event.reason = 'Cierre automático' then
      select coalesce(array_agg(e.id), array[]::uuid[]) into v_auto_ids
      from public.supervisor_workday_events e
      join public.supervisions sv on sv.id = e.supervision_id
      where e.workday_id = v_wd.id
        and e.kind = 'supervision_end'
        and e.reason = 'Cierre automático'
        and e.removed_at is null
        and e.recorded_at = v_old
        and sv.status <> 'cancelled';

      -- Caso borde: la hora nueva no puede quedar antes del inicio de esas supervisiones.
      if exists (
        select 1
        from public.supervisor_workday_events e
        join public.supervision_attendance ci on ci.supervision_id = e.supervision_id and ci.kind = 'check_in'
        where e.id = any (v_auto_ids)
          and ci.recorded_at > p_new_time
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'La hora de fin queda antes del inicio de una supervisión que se cerró sola. Elegí una hora posterior o cancelá esa supervisión antes.',
          hint = 'END_BEFORE_SUPERVISION_START';
      end if;

      update public.supervisor_workday_events
      set recorded_at = p_new_time,
          corrected_from = coalesce(corrected_from, v_old),
          corrected_at = now(),
          corrected_by = auth.uid(),
          correction_reason = v_reason
      where id = any (v_auto_ids);

      update public.supervision_attendance sa
      set recorded_at = p_new_time
      from public.supervisor_workday_events e
      where e.id = any (v_auto_ids)
        and sa.supervision_id = e.supervision_id
        and sa.kind = 'check_out'
        and sa.recorded_at = v_old;
    end if;

    update public.supervisor_workday_events
    set recorded_at = p_new_time,
        corrected_from = coalesce(corrected_from, v_old),
        corrected_at = now(),
        corrected_by = auth.uid(),
        correction_reason = v_reason
    where id = v_event.id;
  end if;

  perform app.assert_workday_consistent(v_wd.id);
  perform app.sync_workday(v_wd.id);

  update public.supervisor_workdays
  set corrected = true, updated_by = auth.uid()
  where id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_wd.supervisor_id,
    jsonb_build_object(
      'action', case when coalesce(p_remove, false) then 'remove_pause' else 'correct_event' end,
      'workday_id', v_wd.id,
      'event_id', v_event.id,
      'kind', v_event.kind,
      'old_recorded_at', v_old,
      'new_recorded_at', case when coalesce(p_remove, false) then null else p_new_time end,
      'reason', v_reason,
      'adjusted_supervision_event_ids', to_jsonb(v_auto_ids)
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean) is
  'Corrige la hora de un evento de la jornada de un coordinador (inicio, pausa, reanudación, fin o reapertura) o, con p_remove = true, da de baja una pausa junto con su reanudación (CJ-32). O, A con manage_attendance (FORBIDDEN si no). Motivo obligatorio. Guarda la hora anterior en el evento (corrected_from), marca la jornada como corrected y registra workday_corrected en security_events. Desde 0064 (CJ-17), al corregir el fin de una jornada cerrada sola, el fin automático de sus supervisiones «Sin cerrar» (evento y check_out sin posición) se ajusta a la hora nueva en la misma transacción, con la misma traza; el fin que registró el coordinador no se toca. EVENT_NOT_FOUND, REASON_REQUIRED, EVENT_NOT_CORRECTABLE (eventos de supervisión, también el fin automático: se ajusta solo), EVENT_NOT_REMOVABLE (solo se quitan pausas), TIME_REQUIRED, AT_OUT_OF_RANGE (dentro del día de la jornada y no futura), SAME_TIME, END_BEFORE_SUPERVISION_START (la hora nueva queda antes del inicio de una supervisión cerrada sola), INVALID_EVENT_ORDER (la secuencia queda inválida). Devuelve el estado de la jornada.';


-- ---------------------------------------------------------------------------------------------
-- 3. Datos anteriores: eventos de supervisiones ya canceladas
-- ---------------------------------------------------------------------------------------------

-- Una supervisión cancelada no debe imponer orden a la jornada. Las descartadas ya tenían dado de
-- baja el inicio; falta el fin automático de las que quedaron «Sin cerrar». Baja lógica (P-014);
-- el autor es quien hizo el último cambio de la supervisión (removed_by es obligatorio).
update public.supervisor_workday_events e
set removed_at = now(),
    removed_by = coalesce(sv.updated_by, sv.supervisor_id)
from public.supervisions sv
where sv.id = e.supervision_id
  and sv.status = 'cancelled'
  and e.kind in ('supervision_start', 'supervision_end')
  and e.removed_at is null;

-- ---------------------------------------------------------------------------------------------
-- 4. SUP-03: radio de la sede y precisión máxima en la pantalla Hoy (DEF-P24-02)
-- ---------------------------------------------------------------------------------------------

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
  max_accuracy_m smallint
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
    cs.geofence_max_accuracy_m
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
  'Turnos de hoy de todos los clientes y sedes para el coordinador (0063, CJ-02, CJ-25). Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Interna: la lee v_supervisor_today. Desde 0064 trae site_radius_m (radio vigente de la sede: el propio o el general) y max_accuracy_m (precisión máxima de la empresa), los mismos valores que usa la validación al tomar la supervisión (app.geo_for_site).';

revoke execute on function app.supervisor_today() from public, anon;
grant execute on function app.supervisor_today() to authenticated, service_role;

create view public.v_supervisor_today
with (security_invoker = true)
as
select * from app.supervisor_today();

comment on view public.v_supervisor_today is
  'Pantalla Hoy del coordinador (SUP-02, SUP-03; 0063, CJ-02, CJ-04, CJ-25): todos los turnos de hoy no cancelados. priority_kind (site | client | null) / is_priority: la prioridad del coordinador (CJ-03, CJ-24). display_state: in_progress | pending | finished (según el estado del turno). assigned_employees: [{ assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at }]. supervisors: quién lo supervisa o ya lo supervisó, sin las canceladas: [{ supervision_id, supervisor_id, first_name, last_name, status, check_in_at, check_out_at, is_me }]. my_supervision_id / my_supervision_status: la supervisión propia no cancelada. site_radius_m (smallint) y max_accuracy_m (smallint), desde 0064: radio vigente de la sede (el propio o el general de la empresa) y precisión máxima aceptada del GPS, para el detalle del turno (SUP-03). Solo trae filas para el rol supervisor.';

revoke all on public.v_supervisor_today from public, anon, authenticated;
grant select on public.v_supervisor_today to authenticated;
