-- P22.4b · módulo B1 · resumen de servicios con la validación por ubicación y consentimiento por RPC.
--
--   1. `client_service_summary`: cada elemento de `employees` suma, para el fichaje de inicio y el
--      de fin, `check_in_geo_status`, `check_in_geo_reason`, `check_in_distance_m` y
--      `check_in_geo_overridden` (y los equivalentes `check_out_*`). Son null si no hay fichaje.
--      Sin coordenadas ni precisión (B-20, B-40). Misma firma y retorno (jsonb): no cambian los
--      permisos; se redefine con `create or replace`.
--   2. `accept_location_consent()` y `revoke_location_consent()`: el consentimiento de ubicación
--      (B-22) lo fija el servidor con now(), para auth.uid(); la hora del dispositivo no cuenta.

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
           sh.status, sh.open_ended,
           case when o.show_in_print then nullif(btrim(o.observation), '') end as observation
    from public.shifts sh
    join public.sites si on si.id = sh.site_id
    left join public.shift_observations o on o.shift_id = sh.id
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
      app.capped_worked_minutes(ci.recorded_at, co.recorded_at, lower(a."window"), upper(a."window")) as worked_minutes,
      ci.geo_status as check_in_geo_status,
      ci.geo_unvalidated_reason as check_in_geo_reason,
      ci.site_distance_m as check_in_distance_m,
      (ci.geo_override_at is not null) as check_in_geo_overridden,
      co.geo_status as check_out_geo_status,
      co.geo_unvalidated_reason as check_out_geo_reason,
      co.site_distance_m as check_out_distance_m,
      (co.geo_override_at is not null) as check_out_geo_overridden
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
            'no_checkout', r.no_checkout,
            'check_in_geo_status', r.check_in_geo_status,
            'check_in_geo_reason', r.check_in_geo_reason,
            'check_in_distance_m', r.check_in_distance_m,
            'check_in_geo_overridden', r.check_in_geo_overridden,
            'check_out_geo_status', r.check_out_geo_status,
            'check_out_geo_reason', r.check_out_geo_reason,
            'check_out_distance_m', r.check_out_distance_m,
            'check_out_geo_overridden', r.check_out_geo_overridden
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
            'open_ended', ds.open_ended,
            'observation', ds.observation
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
  'Resumen de servicios de un cliente en un período, para la hoja imprimible (0033, P19.5a). O, A (quien ve clientes, clients_select_admin); FORBIDDEN si no; INVALID_DATE_RANGE (fechas nulas o desde > hasta), CLIENT_NOT_FOUND. "Turno realizado": vigente, no cancelado, completed o con al menos un inicio registrado, con shift_date entre p_from y p_to. Devuelve jsonb { client_id, from, to, totals { shifts_done, employees_count (distintos con inicio), worked_minutes, planned_minutes, open_ended_shifts (0037) }, shifts [ { shift_id, shift_date, site_id, site_name, start_time, end_time, status, worked_minutes, planned_minutes, open_ended (0037), observation (0040, AJ2-15: solo si tiene tildada «mostrar en la impresión»), employees [ { assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at, planned_minutes, worked_minutes, open_ended, no_checkout, check_in_geo_status, check_in_geo_reason, check_in_distance_m, check_in_geo_overridden, check_out_geo_status, check_out_geo_reason, check_out_distance_m, check_out_geo_overridden } ] } ] } ordenado por fecha, hora y sede. worked_minutes cuenta solo la parte del fichaje dentro de la franja efectiva (app.capped_worked_minutes); las asignaciones «A terminar» tienen planned_minutes null. Desde 0056 (P22.4b, B-20, B-40) cada empleado trae la validación por ubicación del inicio y del fin (estado, motivo de «Sin validar», distancia a la sede en metros y si un administrador la corrigió); null si no hay fichaje. Nunca trae coordenadas ni precisión.';

-- Ya tenía los permisos de 0033 (create or replace los conserva); se repiten por claridad.
revoke execute on function public.client_service_summary(uuid, date, date) from public, anon;
grant execute on function public.client_service_summary(uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Consentimiento de ubicación por RPC (B-22)
-- ---------------------------------------------------------------------------------------------

create function public.accept_location_consent()
returns timestamptz
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz := now();
begin
  if v_uid is null then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  update public.profiles
  set location_consent_at = v_at, updated_by = v_uid
  where id = v_uid;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  return v_at;
end;
$$;

comment on function public.accept_location_consent() is
  'Registra el consentimiento de ubicación de quien llama (0056, P22.4b, B-22): profiles.location_consent_at = now() del servidor, solo para auth.uid(). Devuelve el instante guardado. FORBIDDEN sin sesión; PROFILE_NOT_FOUND si no hay perfil.';

create function public.revoke_location_consent()
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  update public.profiles
  set location_consent_at = null, updated_by = v_uid
  where id = v_uid;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos tu perfil.',
      hint = 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

comment on function public.revoke_location_consent() is
  'Retira el consentimiento de ubicación de quien llama (0056, P22.4b): profiles.location_consent_at = null, solo para auth.uid(). FORBIDDEN sin sesión; PROFILE_NOT_FOUND si no hay perfil.';

revoke execute on function public.accept_location_consent() from public, anon;
revoke execute on function public.revoke_location_consent() from public, anon;
grant execute on function public.accept_location_consent() to authenticated, service_role;
grant execute on function public.revoke_location_consent() to authenticated, service_role;
