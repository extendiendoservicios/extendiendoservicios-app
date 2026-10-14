-- P22.1 · Módulo B1 · correcciones de 0052 (aplicada en App_dev; no se edita, se corrige acá).
--
--   1. `geo_distance_m` devolvía la distancia máxima (20 015 087 m) cuando algún argumento era
--      nulo, porque `least(1, null)` ignora el nulo: ahora devuelve nulo, como dice su comentario.
--   2. `security_events.target_id` es una clave foránea a `profiles` (0004): los eventos de 0052
--      pasaban ahí el id de un registro o de una sede y fallaban. Ahora `target_id` es la persona
--      afectada (el empleado de la asignación o el supervisor) y el id del registro va en
--      `details.record_id`; el cambio de radio de una sede queda sin `target_id` y con
--      `details.site_id`.
--   Cambia el cuerpo de `geo_distance_m`, `correct_attendance_time`, `override_geo_validation` y
--   `app.log_geofence_radius_change`; las firmas, los permisos y los comentarios no se tocan.

create or replace function public.geo_distance_m(
  p_lat1 numeric,
  p_lng1 numeric,
  p_lat2 numeric,
  p_lng2 numeric
)
returns double precision
language sql
immutable
parallel safe
set search_path = public, app, pg_temp
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else 2 * 6371000::double precision * asin(least(1::double precision, sqrt(
      power(sin(radians(p_lat2::double precision - p_lat1::double precision) / 2), 2)
      + cos(radians(p_lat1::double precision)) * cos(radians(p_lat2::double precision))
        * power(sin(radians(p_lng2::double precision - p_lng1::double precision) / 2), 2)
    )))
  end;
$$;

-- B-28 · correct_attendance_time(record_id, new_time, reason). Regla de hora de
-- admin_record_attendance: desde las 0:00 del día del turno (Argentina) hasta ahora, nunca futura;
-- además, el inicio sigue siendo anterior al fin.
create or replace function public.correct_attendance_time(
  p_record_id uuid,
  p_new_time timestamptz,
  p_reason text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_record public.attendance_records;
  v_shift public.shifts;
  v_other public.attendance_records;
  v_reason text;
  v_old timestamptz;
  v_employee_id uuid;
begin
  perform app.require_capability('manage_attendance');

  select * into v_record from public.attendance_records where id = p_record_id for update;

  if v_record.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese registro.',
      hint = 'RECORD_NOT_FOUND';
  end if;

  select sh.* into v_shift
  from public.assignments a
  join public.shifts sh on sh.id = a.shift_id
  where a.id = v_record.assignment_id
  for update of sh;

  select a.employee_id into v_employee_id from public.assignments a where a.id = v_record.assignment_id;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_new_time is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la hora nueva.',
      hint = 'TIME_REQUIRED';
  end if;

  if p_new_time < app.local_ts(v_shift.shift_date, '00:00'::time) or p_new_time > now() then
    raise exception using
      errcode = 'P0001',
      message = 'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if p_new_time = v_record.recorded_at then
    raise exception using
      errcode = 'P0001',
      message = 'La hora nueva es igual a la actual.',
      hint = 'SAME_TIME';
  end if;

  -- El inicio tiene que seguir siendo anterior al fin.
  select * into v_other
  from public.attendance_records
  where assignment_id = v_record.assignment_id
    and kind = case when v_record.kind = 'check_in' then 'check_out'::public.attendance_kind
                    else 'check_in'::public.attendance_kind end;

  if v_other.id is not null then
    if (v_record.kind = 'check_in' and p_new_time >= v_other.recorded_at)
      or (v_record.kind = 'check_out' and p_new_time <= v_other.recorded_at)
    then
      raise exception using
        errcode = 'P0001',
        message = 'La hora de fin tiene que ser posterior a la de inicio.',
        hint = 'INVALID_TIME_RANGE';
    end if;
  end if;

  v_old := v_record.recorded_at;

  insert into public.attendance_corrections (
    attendance_record_id, kind, old_recorded_at, new_recorded_at, reason, corrected_by
  )
  values (v_record.id, 'time', v_old, p_new_time, v_reason, auth.uid());

  update public.attendance_records
  set recorded_at = p_new_time, time_corrected_at = now()
  where id = v_record.id
  returning * into v_record;

  perform app.log_security_event(
    'attendance_time_corrected',
    auth.uid(),
    v_employee_id,
    jsonb_build_object(
      'record_id', v_record.id,
      'assignment_id', v_record.assignment_id,
      'kind', v_record.kind,
      'old_recorded_at', v_old,
      'new_recorded_at', p_new_time,
      'reason', v_reason
    )
  );

  return v_record;
end;
$$;

comment on function public.correct_attendance_time(uuid, timestamptz, text) is
  'Corrige la hora de un inicio o fin ya registrado (B-28, B-41). O, A con manage_attendance (FORBIDDEN si no). RECORD_NOT_FOUND, SHIFT_CANCELLED, REASON_REQUIRED, TIME_REQUIRED, AT_OUT_OF_RANGE (entre las 0:00 del día del turno y ahora), SAME_TIME, INVALID_TIME_RANGE (el inicio tiene que ser anterior al fin). Guarda el valor anterior en attendance_corrections, marca time_corrected_at y registra attendance_time_corrected en security_events. Devuelve el registro actualizado.';

-- B-09 · override_geo_validation(record_type, record_id, reason). record_type: 'attendance'
-- (attendance_records) o 'supervision' (supervision_attendance). El resultado original se
-- conserva; se registra quién, cuándo y por qué.
create or replace function public.override_geo_validation(
  p_record_type text,
  p_record_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_reason text;
  v_att public.attendance_records;
  v_sup public.supervision_attendance;
  v_result jsonb;
  v_original public.geo_status;
  v_person_id uuid;
begin
  perform app.require_capability('manage_attendance');

  if p_record_type is null or p_record_type not in ('attendance', 'supervision') then
    raise exception using
      errcode = 'P0001',
      message = 'El tipo de registro no es válido.',
      hint = 'INVALID_RECORD_TYPE';
  end if;

  v_reason := nullif(btrim(p_reason), '');
  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_record_type = 'attendance' then
    select * into v_att from public.attendance_records where id = p_record_id for update;

    if v_att.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos ese registro.',
        hint = 'RECORD_NOT_FOUND';
    end if;

    v_original := v_att.geo_status;
    select a.employee_id into v_person_id from public.assignments a where a.id = v_att.assignment_id;

    if v_att.geo_status = 'valid' then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya está validado.',
        hint = 'GEO_ALREADY_VALID';
    end if;

    if v_att.geo_override_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya fue marcado como válido.',
        hint = 'GEO_ALREADY_OVERRIDDEN';
    end if;

    update public.attendance_records
    set geo_override_by = auth.uid(), geo_override_at = now(), geo_override_reason = v_reason
    where id = v_att.id
    returning * into v_att;

    insert into public.attendance_corrections (attendance_record_id, kind, reason, corrected_by)
    values (v_att.id, 'geo', v_reason, auth.uid());

    v_result := to_jsonb(v_att);
  else
    select * into v_sup from public.supervision_attendance where id = p_record_id for update;

    if v_sup.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'No encontramos ese registro.',
        hint = 'RECORD_NOT_FOUND';
    end if;

    v_original := v_sup.geo_status;
    select sv.supervisor_id into v_person_id from public.supervisions sv where sv.id = v_sup.supervision_id;

    if v_sup.geo_status = 'valid' then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya está validado.',
        hint = 'GEO_ALREADY_VALID';
    end if;

    if v_sup.geo_override_at is not null then
      raise exception using
        errcode = 'P0001',
        message = 'Este fichaje ya fue marcado como válido.',
        hint = 'GEO_ALREADY_OVERRIDDEN';
    end if;

    update public.supervision_attendance
    set geo_override_by = auth.uid(), geo_override_at = now(), geo_override_reason = v_reason
    where id = v_sup.id
    returning * into v_sup;

    v_result := to_jsonb(v_sup);
  end if;

  perform app.log_security_event(
    'geo_validation_overridden',
    auth.uid(),
    v_person_id,
    jsonb_build_object(
      'record_type', p_record_type,
      'record_id', p_record_id,
      'original_geo_status', v_original,
      'reason', v_reason
    )
  );

  return v_result;
end;
$$;

comment on function public.override_geo_validation(text, uuid, text) is
  'Marca como válido un fichaje fuera de zona o sin validar (B-09, B-41). p_record_type: attendance | supervision (INVALID_RECORD_TYPE). O, A con manage_attendance (FORBIDDEN si no). REASON_REQUIRED, RECORD_NOT_FOUND, GEO_ALREADY_VALID, GEO_ALREADY_OVERRIDDEN. El resultado original se conserva (geo_status); se guardan geo_override_by/at/reason, la constancia en attendance_corrections (solo attendance) y el evento geo_validation_overridden. Devuelve el registro actualizado como jsonb.';

create or replace function app.log_geofence_radius_change()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if tg_table_name = 'sites' then
    perform app.log_security_event(
      'geofence_radius_changed',
      auth.uid(),
      null,
      jsonb_build_object('scope', 'site', 'site_id', new.id, 'old', old.geofence_radius_m, 'new', new.geofence_radius_m)
    );
  else
    perform app.log_security_event(
      'geofence_radius_changed',
      auth.uid(),
      null,
      jsonb_build_object('scope', 'company', 'old', old.geofence_radius_m, 'new', new.geofence_radius_m)
    );
  end if;
  return new;
end;
$$;

comment on function app.log_geofence_radius_change() is
  'Trigger AFTER UPDATE (0052, B-02): registra geofence_radius_changed en security_events cuando cambia el radio general (company_settings) o el propio de una sede (sites), venga de set_geofence_radius o de un update directo.';
