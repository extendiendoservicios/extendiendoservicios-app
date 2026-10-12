-- 0046 (P19.7 paquete R, AJ3-08): repetir un turno suelto.
--
-- Pedido de Mike (12 oct 2026): al crear un turno suelto (no desde un servicio) se puede repetir con
-- la misma regla que los servicios (días de la semana + «todas las semanas» o solo algunas semanas
-- del mes, app.date_matches_weeks_of_month de 0044), desde la fecha del turno hasta una fecha
-- «hasta» obligatoria de como máximo 3 meses después. Cada turno creado queda independiente.
--
-- Aditiva: columna nueva con null (= turno que no nació de una repetición) y funciones nuevas.
--
--   1. shifts.series_id: mismo valor en todos los turnos creados juntos. Solo informativa (sin FK,
--      ningún comportamiento depende de ella); sirve para agruparlos más adelante.
--   2. app.create_shift_core: el cuerpo de create_shift (0041) sin el control de rol y con
--      p_series_id. public.create_shift queda como envoltorio con la MISMA firma y comportamiento.
--   3. app.shift_series_dates: validación del rango y de la regla + fechas candidatas (compartida
--      por la vista previa y la creación).
--   4. preview_shift_series y create_shift_series (O, A).

-- ---------------------------------------------------------------------------------------------
-- 1. shifts.series_id
-- ---------------------------------------------------------------------------------------------

alter table public.shifts add column series_id uuid;

comment on column public.shifts.series_id is
  'Identificador de la repetición que creó el turno (0046, AJ3-08): todos los turnos creados juntos por create_shift_series comparten el valor. null = turno que no nació de una repetición. Solo informativa, sin FK: cada turno es independiente (se edita, cancela y asigna de a uno).';

create index shifts_series_id_idx on public.shifts (series_id) where series_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 2. app.create_shift_core + create_shift como envoltorio
-- ---------------------------------------------------------------------------------------------

create function app.create_shift_core(
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
  p_series_id uuid default null
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
    required_staff, status, generated, series_id, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, v_end, coalesce(p_open_ended, false),
    p_required_staff, 'scheduled', false, p_series_id, auth.uid()
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

comment on function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid) is
  'Cuerpo de public.create_shift (0041) sin el control de rol, con p_series_id (0046). Lo llaman create_shift y create_shift_series, que ya validaron quién es el que llama. Mismas validaciones, errores y retorno que create_shift.';

revoke execute on function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid) from public, anon, authenticated;

create or replace function public.create_shift(
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
begin
  perform app.require_role('owner', 'admin');
  return app.create_shift_core(
    p_client_id, p_site_id, p_date, p_start, p_end, p_required_staff, p_service_id,
    p_notes, p_open_ended, p_show_in_print, p_employee_ids, null
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. app.shift_series_dates
-- ---------------------------------------------------------------------------------------------

create function app.shift_series_dates(
  p_from date,
  p_to date,
  p_weekdays smallint[],
  p_weeks_of_month smallint[]
)
returns table (shift_date date, is_holiday boolean)
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using
      errcode = 'P0001',
      message = 'La fecha «hasta» tiene que ser igual o posterior a la fecha «desde».',
      hint = 'SERIES_RANGE_INVALID';
  end if;

  if p_to > (p_from + interval '3 months')::date then
    raise exception using
      errcode = 'P0001',
      message = 'La repetición puede abarcar como máximo 3 meses desde la primera fecha.',
      hint = 'SERIES_RANGE_TOO_LONG';
  end if;

  if not app.valid_weekdays(p_weekdays) then
    raise exception using
      errcode = 'P0001',
      message = 'Los días de la semana no son válidos.',
      hint = 'INVALID_WEEKDAYS';
  end if;

  if not app.valid_weeks_of_month(p_weeks_of_month) then
    raise exception using
      errcode = 'P0001',
      message = 'Las semanas del mes no son válidas.',
      hint = 'INVALID_WEEKS_OF_MONTH';
  end if;

  return query
    select gs::date,
           exists (select 1 from public.holidays h where h.holiday_date = gs::date and h.deleted_at is null)
    from generate_series(p_from, p_to, interval '1 day') as gs
    where extract(dow from gs)::smallint = any(p_weekdays)
      and app.date_matches_weeks_of_month(gs::date, p_weeks_of_month)
    order by gs;
end;
$$;

comment on function app.shift_series_dates(date, date, smallint[], smallint[]) is
  'Valida el rango (SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG: hasta <= desde + 3 meses) y la regla (INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH) de una repetición de turnos (0046) y devuelve las fechas que la cumplen, con is_holiday. Compartida por preview_shift_series y create_shift_series.';

revoke execute on function app.shift_series_dates(date, date, smallint[], smallint[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. preview_shift_series y create_shift_series
-- ---------------------------------------------------------------------------------------------

create function public.preview_shift_series(
  p_from date,
  p_to date,
  p_weekdays smallint[],
  p_weeks_of_month smallint[] default null,
  p_works_on_holidays boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_dates jsonb;
  v_skipped jsonb;
begin
  perform app.require_role('owner', 'admin');

  select
    coalesce(jsonb_agg(d.shift_date order by d.shift_date)
      filter (where coalesce(p_works_on_holidays, false) or not d.is_holiday), '[]'::jsonb),
    coalesce(jsonb_agg(d.shift_date order by d.shift_date)
      filter (where d.is_holiday and not coalesce(p_works_on_holidays, false)), '[]'::jsonb)
  into v_dates, v_skipped
  from app.shift_series_dates(p_from, p_to, p_weekdays, p_weeks_of_month) d;

  return jsonb_build_object(
    'dates', v_dates,
    'holidays_skipped', v_skipped,
    'count', jsonb_array_length(v_dates)
  );
end;
$$;

comment on function public.preview_shift_series(date, date, smallint[], smallint[], boolean) is
  'Vista previa de create_shift_series (0046, AJ3-08): no escribe nada. O, A. Mismas validaciones de rango y de regla: SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG, INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH. Devuelve {"dates": [fechas que se crearían], "holidays_skipped": [feriados salteados], "count"}. Si ninguna fecha cumple devuelve count 0 (no es error; create_shift_series sí falla con SERIES_EMPTY).';

revoke execute on function public.preview_shift_series(date, date, smallint[], smallint[], boolean) from public, anon;
grant execute on function public.preview_shift_series(date, date, smallint[], smallint[], boolean) to authenticated;

create function public.create_shift_series(
  p_client_id uuid,
  p_site_id uuid,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_from date,
  p_to date,
  p_weekdays smallint[],
  p_weeks_of_month smallint[] default null,
  p_works_on_holidays boolean default false,
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
  v_series_id uuid := gen_random_uuid();
  v_rec record;
  v_res jsonb;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_code text;
  v_msg text;
begin
  perform app.require_role('owner', 'admin');

  for v_rec in
    select d.shift_date, d.is_holiday from app.shift_series_dates(p_from, p_to, p_weekdays, p_weeks_of_month) d
  loop
    if v_rec.is_holiday and not coalesce(p_works_on_holidays, false) then
      v_skipped := v_skipped || to_jsonb(v_rec.shift_date);
      continue;
    end if;

    begin
      v_res := app.create_shift_core(
        p_client_id, p_site_id, v_rec.shift_date, p_start, p_end, p_required_staff, null,
        p_notes, p_open_ended, p_show_in_print, p_employee_ids, v_series_id
      );
    exception
      when sqlstate 'P0001' then
        -- Falla todo (la transacción se revierte) y el mensaje indica la fecha que falló.
        get stacked diagnostics v_code = pg_exception_hint, v_msg = message_text;
        raise exception using
          errcode = 'P0001',
          message = v_msg || ' (turno del ' || to_char(v_rec.shift_date, 'DD/MM/YYYY') || ')',
          hint = v_code;
    end;

    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'shift_id', v_res -> 'shift' ->> 'id',
      'shift_date', v_rec.shift_date,
      'warnings', v_res -> 'warnings',
      'assigned', v_res -> 'assigned',
      'rejected', v_res -> 'rejected'
    ));
  end loop;

  if jsonb_array_length(v_created) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Ninguna fecha del período cumple la regla elegida (o todas son feriados).',
      hint = 'SERIES_EMPTY';
  end if;

  return jsonb_build_object(
    'series_id', v_series_id,
    'created', v_created,
    'holidays_skipped', v_skipped
  );
end;
$$;

comment on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[]) is
  'Repite un turno suelto (0046, AJ3-08). O, A (igual que create_shift). Crea un turno por cada fecha entre p_from y p_to (hasta <= desde + 3 meses) que cae en p_weekdays y en p_weeks_of_month (null = todas; 1 a 4 y 5 = última, como services). Si p_works_on_holidays es false, las fechas feriadas se saltean y se informan. Cada turno es independiente y comparte shifts.series_id; copia el checklist y asigna a p_employee_ids como create_shift. Todo en una transacción: si el turno de una fecha falla por una validación (INVALID_TIME_RANGE, CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE...) falla todo y el mensaje indica la fecha; las asignaciones rechazadas no frenan y se informan por fecha. Errores propios: SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG, SERIES_EMPTY, INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH. Devuelve {"series_id", "created": [{shift_id, shift_date, warnings, assigned, rejected}], "holidays_skipped": [fechas]}.';

revoke execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[]) from public, anon;
grant execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[]) to authenticated;
