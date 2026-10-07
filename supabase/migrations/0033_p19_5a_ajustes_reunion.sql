-- P19.5a (ajustes pedidos por los dueños en la reunión del 6 oct 2026), segunda migración.
-- Los valores nuevos de enumeración (notice_kind.on_the_way, security_event_type.name_changed)
-- están en 0032_p19_5a_enums.sql: Postgres no deja usarlos en la misma transacción que los crea.
--
-- Contenido, en orden:
--   0. Auxiliares en `app`: `late_grace_minutes()` (los 15 minutos de «Llegada tarde», un solo
--      lugar) y `minutes_between(a, b)` (cómo se redondean los minutos, un solo lugar).
--   1. `update_person_name(p_profile_id, p_first_name, p_last_name)` + el trigger de columnas
--      propias de profiles deja pasar el cambio de nombre que viene de esa RPC.
--   2. "En camino": columna `attendance_notices.estimated_arrival_at` y
--      `notify_on_the_way(p_assignment_id, p_eta_minutes?)`.
--   3. `v_assignments_board`: display_status con `on_the_way` y `late`, más
--      `last_notice_estimated_arrival_at`, `planned_minutes` y `worked_minutes` al final.
--   4. `v_my_day`: `last_notice_estimated_arrival_at` al final.
--   5. `v_employee_ratings`: cantidad y promedio de calificaciones por empleado.
--   6. `v_supervisions_admin`: `planned_minutes` y `worked_minutes` al final (horas de un
--      supervisor por supervisión, pestaña Asistencia de la ficha, ADM-12).
--   7. `client_service_summary(p_client_id, p_from, p_to)` y `clients_worked_minutes(p_from, p_to)`,
--      más el índice shifts (client_id, shift_date).
--   8. Grants.
--
-- Decisiones de este archivo (también en el reporte de la tarea):
--   - "En camino" NO cambia `assignments.status`: el empleado sigue "esperado"; el estado visible
--     (`display_status = 'on_the_way'`) se deriva en la vista a partir del último aviso. Así no se
--     toca el modelo de estados de 04 sección 6.2 ni `record_check_in`, que sigue pasando la
--     asignación a `present` como siempre.
--   - "Turno realizado" (resumen por cliente): turno vigente, no cancelado, que está finalizado
--     (`completed`) o tiene al menos un inicio registrado en alguna de sus asignaciones.

-- ---------------------------------------------------------------------------------------------
-- 0. Auxiliares en app
-- ---------------------------------------------------------------------------------------------

-- Ventana de gracia de «Llegada tarde» (decisión de Mike, 7 oct 2026): durante los primeros 15
-- minutos desde el inicio efectivo sin fichaje, display_status = 'late'; pasados, 'no_record'
-- (P-071). Es el ÚNICO lugar donde vive el número: v_assignments_board lo lee de acá. Si cambia,
-- se reemplaza esta función (`create or replace`) y las vistas siguen igual.
create function app.late_grace_minutes()
returns integer
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select 15;
$$;

comment on function app.late_grace_minutes() is
  'Minutos de gracia de «Llegada tarde» (0033, P19.5a, decisión de Mike del 7 oct 2026): hasta este tiempo después del inicio efectivo sin fichaje, v_assignments_board.display_status = late; pasado, no_record (P-071). Único lugar de la constante.';

-- Minutos entre dos instantes, redondeados al minuto más cercano (mismo criterio que
-- minutes_late / minutes_early_leave de v_assignments_board). null si falta alguno de los dos.
create function app.minutes_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql
immutable
set search_path = public, app, pg_temp
as $$
  select case
    when p_from is null or p_to is null then null
    else round(extract(epoch from (p_to - p_from)) / 60)::integer
  end;
$$;

comment on function app.minutes_between(timestamptz, timestamptz) is
  'Minutos entre dos instantes, redondeados al minuto más cercano; null si falta alguno (0033, P19.5a). Lo usan planned_minutes y worked_minutes de las vistas y los resúmenes por cliente, para que el redondeo sea el mismo en todos lados.';

-- ---------------------------------------------------------------------------------------------
-- 1. update_person_name
-- ---------------------------------------------------------------------------------------------

-- Hasta ahora el único camino para cambiar un nombre era el update directo sobre profiles que
-- hacen owner/admin desde la ficha (profiles_update_admin + trigger app.enforce_profile_admin_
-- update_rules); la propia persona no podía (trigger app.enforce_profile_self_update_columns).
-- Esta RPC agrega el camino del dueño (para cualquiera, incluido él y otros dueños) y el de "Mi
-- perfil" (cualquier persona activa sobre su propia fila), con rastro en security_events. El
-- camino directo de owner/admin sobre la ficha del empleado queda como está (el administrador
-- sigue editando a empleados y supervisores por ahí; no a otros administradores ni dueños, regla
-- del trigger de 0030).
--
-- El trigger de columnas propias bloquea el cambio de first_name/last_name/updated_by cuando lo
-- hace la propia persona sin ser admin. Como esta RPC es security definer pero auth.uid() sigue
-- siendo la persona, el trigger la frenaría: la RPC marca la transacción con la variable local
-- `app.allow_name_update = 'on'` (set_config con is_local = true, se limpia sola al terminar la
-- transacción) y el trigger deja pasar SOLO esas tres columnas mientras esté marcada. Nadie puede
-- marcarla desde afuera: PostgREST no expone set_config ni deja ejecutar SQL libre.
create or replace function app.enforce_profile_self_update_columns()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_name_update boolean := coalesce(current_setting('app.allow_name_update', true), '') = 'on';
begin
  if auth.uid() = old.id and not app.is_admin() then
    if (
        not v_name_update
        and (
          new.first_name is distinct from old.first_name
          or new.last_name is distinct from old.last_name
          or new.updated_by is distinct from old.updated_by
        )
      )
      or new.is_active is distinct from old.is_active
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
      or new.deleted_at is distinct from old.deleted_at
    then
      raise exception using
        errcode = 'P0001',
        message = 'Desde tu perfil solo podés editar el email de contacto, el teléfono, la foto y el consentimiento de ubicación.',
        hint = 'FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

comment on function app.enforce_profile_self_update_columns() is
  'Trigger BEFORE UPDATE en profiles: cuando quien edita es la propia persona (auth.uid() = old.id) y no es owner/admin, rechaza el update si cambió alguna columna fuera de contact_email/phone/avatar_path/location_consent_at/last_seen_changes_at (FORBIDDEN). security definer desde 0020. Desde 0033 (P19.5a) deja pasar first_name/last_name/updated_by cuando la transacción viene de update_person_name (variable local app.allow_name_update = on); el resto de las columnas sigue bloqueado.';

create function public.update_person_name(
  p_profile_id uuid,
  p_first_name text,
  p_last_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_first text;
  v_last text;
  v_old public.profiles;
  v_new public.profiles;
begin
  -- Perfil activo y (dueño, o la propia fila). El administrador no edita el nombre de otros por
  -- esta vía. Se corta con FORBIDDEN antes de buscar la fila para no revelar quién existe.
  if not app.current_profile_active()
    or not (app.has_role('owner') or coalesce(p_profile_id = auth.uid(), false))
  then
    raise exception using
      errcode = 'P0001',
      message = 'No tenés permiso para hacer esto.',
      hint = 'FORBIDDEN';
  end if;

  select * into v_old from public.profiles where id = p_profile_id for update;

  if v_old.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos a esa persona.',
      hint = 'PROFILE_NOT_FOUND';
  end if;

  -- Sin espacios de más: se recortan los bordes y los espacios repetidos del medio pasan a uno.
  v_first := nullif(regexp_replace(btrim(coalesce(p_first_name, '')), '\s+', ' ', 'g'), '');
  v_last := nullif(regexp_replace(btrim(coalesce(p_last_name, '')), '\s+', ' ', 'g'), '');

  if v_first is null or v_last is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el nombre y el apellido.',
      hint = 'NAME_REQUIRED';
  end if;

  -- El modelo no fija largos para nombre y apellido; se pone un tope razonable (a confirmar).
  if char_length(v_first) > 100 or char_length(v_last) > 100 then
    raise exception using
      errcode = 'P0001',
      message = 'El nombre y el apellido pueden tener hasta 100 caracteres cada uno.',
      hint = 'NAME_TOO_LONG';
  end if;

  -- Sin cambios: no se escribe ni se deja rastro.
  if v_first = v_old.first_name and v_last = v_old.last_name then
    return v_old;
  end if;

  perform set_config('app.allow_name_update', 'on', true);

  update public.profiles
  set first_name = v_first, last_name = v_last, updated_by = auth.uid()
  where id = p_profile_id
  returning * into v_new;

  perform set_config('app.allow_name_update', '', true);

  perform app.log_security_event(
    'name_changed'::public.security_event_type,
    auth.uid(),
    p_profile_id,
    jsonb_build_object(
      'first_name_previous', v_old.first_name,
      'last_name_previous', v_old.last_name,
      'first_name_new', v_new.first_name,
      'last_name_new', v_new.last_name
    )
  );

  return v_new;
end;
$$;

comment on function public.update_person_name(uuid, text, text) is
  'Cambia nombre y apellido de una persona (0033, P19.5a). Dueño: a cualquiera, incluido él y otros dueños. Cualquier persona activa (empleado, supervisor, administrador, dueño): a su propia fila ("Mi perfil"). El administrador no edita el de otros por esta vía (la ficha del empleado usa el update directo de profiles). Recorta y compacta espacios; NAME_REQUIRED si falta alguno, NAME_TOO_LONG si pasa de 100 caracteres, PROFILE_NOT_FOUND, FORBIDDEN. El nombre vive solo en profiles (employees no lo duplica). Registra name_changed en security_events con el nombre anterior y el nuevo. Devuelve la fila de profiles.';

-- ---------------------------------------------------------------------------------------------
-- 2. "En camino": estimated_arrival_at y notify_on_the_way
-- ---------------------------------------------------------------------------------------------

-- Vive en attendance_notices porque "En camino" es un aviso más del empleado (mismo patrón que
-- demora y ausencia: varios por asignación, el último manda, ya hay índice por asignación y fecha
-- de creación). La hora estimada solo tiene sentido para ese tipo de aviso.
alter table public.attendance_notices
  add column estimated_arrival_at timestamptz;

alter table public.attendance_notices
  add constraint attendance_notices_estimated_arrival_check
  check (estimated_arrival_at is null or kind = 'on_the_way');

comment on column public.attendance_notices.estimated_arrival_at is
  'Hora estimada de llegada informada en un aviso en camino (now() + minutos del aviso); null si el empleado no la indicó. Solo para kind = on_the_way (0033, P19.5a).';

comment on table public.attendance_notices is
  'Avisos de demora, ausencia y en camino (04 sección 2.3, P-072, P-073; on_the_way desde 0033). Varios por asignación; el último es el vigente. minutes_late obligatorio (1..600) si kind = delay; reason_code obligatorio si kind = absence; reason_text obligatorio si reason_code = other; estimated_arrival_at solo si kind = on_the_way. Una ausencia avisada no libera el cupo (P-073): lo decide el administrador. El aviso en camino no cambia el estado de la asignación.';

create function public.notify_on_the_way(
  p_assignment_id uuid,
  p_eta_minutes integer default null
)
returns public.attendance_notices
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_assignment public.assignments;
  v_shift public.shifts;
  v_notice public.attendance_notices;
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

  -- Se bloquea el turno (mismo orden que record_check_in) y se relee la asignación: así un
  -- inicio que se registra en paralelo no se cruza con este aviso.
  select * into v_shift from public.shifts where id = v_assignment.shift_id for update;
  select * into v_assignment from public.assignments where id = p_assignment_id;

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

  if v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  -- present/finished: ya fichó el inicio.
  if v_assignment.status in ('present', 'finished') then
    raise exception using
      errcode = 'P0001',
      message = 'La asignación ya empezó.',
      hint = 'ASSIGNMENT_STARTED';
  end if;

  if v_assignment.status = 'absence_notified' then
    raise exception using
      errcode = 'P0001',
      message = 'Ya avisaste que no vas a ir a este servicio.',
      hint = 'ABSENCE_ALREADY_NOTIFIED';
  end if;

  if p_eta_minutes is not null and (p_eta_minutes < 1 or p_eta_minutes > 240) then
    raise exception using
      errcode = 'P0001',
      message = 'La hora estimada de llegada tiene que ser de entre 1 y 240 minutos.',
      hint = 'INVALID_ETA';
  end if;

  -- Ventana: desde 3 horas antes del inicio efectivo hasta el fin efectivo.
  if now() < lower(v_assignment."window") - interval '3 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía es muy temprano para avisar que vas en camino: podés hacerlo desde 3 horas antes del inicio.',
      hint = 'ON_THE_WAY_TOO_EARLY';
  end if;

  if now() >= upper(v_assignment."window") then
    raise exception using
      errcode = 'P0001',
      message = 'El servicio ya terminó: no podés avisar que vas en camino.',
      hint = 'ON_THE_WAY_TOO_LATE';
  end if;

  -- created_at = clock_timestamp() (no el now() de la transacción): dos avisos seguidos tienen
  -- que ordenarse de verdad aunque caigan en la misma transacción; "el último manda".
  insert into public.attendance_notices (
    assignment_id, kind, estimated_arrival_at, reported_by, source, created_at
  )
  values (
    p_assignment_id,
    'on_the_way',
    case when p_eta_minutes is null then null else now() + make_interval(mins => p_eta_minutes) end,
    auth.uid(),
    'employee_app',
    clock_timestamp()
  )
  returning * into v_notice;

  return v_notice;
end;
$$;

comment on function public.notify_on_the_way(uuid, integer) is
  'Aviso "En camino" (0033, P19.5a). Solo el empleado de la asignación (E propia; FORBIDDEN para cualquier otro rol, NOT_YOUR_ASSIGNMENT si es ajena). Ventana: desde 3 horas antes del inicio efectivo hasta el fin efectivo (ON_THE_WAY_TOO_EARLY / ON_THE_WAY_TOO_LATE). Rechaza ASSIGNMENT_NOT_FOUND (inexistente o quitada), SHIFT_CANCELLED, SHIFT_COMPLETED, ASSIGNMENT_STARTED (ya fichó el inicio), ABSENCE_ALREADY_NOTIFIED, INVALID_ETA (p_eta_minutes fuera de 1..240). p_eta_minutes opcional: estimated_arrival_at = now() + minutos. Repetirla inserta un aviso nuevo (el último manda). No cambia assignments.status.';

-- ---------------------------------------------------------------------------------------------
-- 3. v_assignments_board (create or replace, columnas nuevas al final)
-- ---------------------------------------------------------------------------------------------

-- Respecto de 0027 (mismas columnas, mismo orden y tipo):
--   - display_status: antes de 'no_record' hay dos casos nuevos, en este orden de prioridad:
--       1. 'on_the_way': estado expected/delay_notified (sin inicio registrado), el último aviso
--          es on_the_way y la franja efectiva no terminó. Prevalece sobre late y no_record.
--       2. 'late' («Llegada tarde»): estado expected/delay_notified, ya pasó el inicio efectivo
--          pero no más de app.late_grace_minutes() minutos (el minuto 15 exacto sigue siendo
--          late; pasado, no_record). Es lo que antes era no_record desde el primer segundo.
--   - last_notice_estimated_arrival_at: hora estimada del último aviso (null si no es en camino
--     o no la indicó).
--   - planned_minutes: duración de la franja efectiva. worked_minutes: del inicio real al fin
--     real (null si falta alguno). Regla de visualización (decisión de Mike, 7 oct 2026): tilde
--     verde si worked_minutes >= planned_minutes SIN margen; advertencia si es menor o si hay
--     salida anticipada (minutes_early_leave no nulo). Se exponen los dos enteros y la regla la
--     aplica el front: no se agrega un booleano para no tener la regla en dos lugares.
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
    when co.recorded_at is not null and co.recorded_at < upper(a."window")
      then round(extract(epoch from (upper(a."window") - co.recorded_at)) / 60)::int
    else null
  end as minutes_early_leave,
  case
    when a.status in ('expected', 'delay_notified')
      and notice.kind = 'on_the_way'
      and ci.recorded_at is null
      and now() < upper(a."window")
      then 'on_the_way'
    when a.status in ('expected', 'delay_notified')
      and now() > lower(a."window")
      and now() <= lower(a."window") + make_interval(mins => app.late_grace_minutes())
      then 'late'
    when a.status in ('expected', 'delay_notified') and now() > lower(a."window")
      then 'no_record'
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
  app.minutes_between(lower(a."window"), upper(a."window")) as planned_minutes,
  app.minutes_between(ci.recorded_at, co.recorded_at) as worked_minutes
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
  'Filas del tablero y de asistencia de hoy, e historial de un empleado (04 sección 4, 06_API.md sección 10). display_status deriva (no se persiste): on_the_way (último aviso en camino, sin inicio, franja sin terminar; prevalece), late («Llegada tarde»: pasó el inicio efectivo hace app.late_grace_minutes() = 15 minutos o menos, sin fichaje, P19.5a) y no_record (pasados esos minutos, P-071) sobre expected/delay_notified; en los demás casos es assignments.status. minutes_late / minutes_early_leave (P-076) comparan contra la franja efectiva (assignments."window"). check_in_source/check_in_recorded_by, check_out_source/check_out_recorded_by (0027). last_notice_*: último aviso de la asignación (por created_at), null si nunca avisó; last_notice_estimated_arrival_at es la hora estimada de un aviso en camino (0033). planned_minutes: duración de la franja efectiva; worked_minutes: fin real menos inicio real (null si falta alguno), ambos redondeados al minuto (0033); el front muestra tilde si worked_minutes >= planned_minutes sin margen y advertencia si es menor o hubo salida anticipada. Incluye asignaciones quitadas (removed_at not null). security_invoker: visibilidad de filas por RLS de assignments/shifts/clients/sites/profiles/attendance_records/attendance_notices.';

-- ---------------------------------------------------------------------------------------------
-- 4. v_my_day (create or replace, una columna nueva al final)
-- ---------------------------------------------------------------------------------------------

-- Igual que 0030 más last_notice_estimated_arrival_at. El empleado ya veía last_notice_kind (que
-- ahora puede ser on_the_way) y last_notice_at: con la hora estimada la app muestra "Avisaste que
-- vas en camino (llegás a las HH:MM)" y deja corregirla repitiendo notify_on_the_way.
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
  notice.estimated_arrival_at as last_notice_estimated_arrival_at
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
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028); límite conocido de 0028 sobre una sola pareja updated_at/updated_by por fila. is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_kind puede ser delay, absence u on_the_way (0033); last_notice_estimated_arrival_at (0033) es la hora estimada de llegada del último aviso en camino, para mostrar "Avisaste que vas en camino" y permitir corregirla con notify_on_the_way. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices.';

-- ---------------------------------------------------------------------------------------------
-- 5. v_employee_ratings
-- ---------------------------------------------------------------------------------------------

-- Cantidad y promedio de calificaciones por empleado, para el listado de Empleados y la ficha.
-- Visibilidad: la de las calificaciones (04 sección 7.2, P-084): dueño y administradores; la
-- condición `app.is_admin()` en la vista deja a un supervisor (que sí lee sus propias
-- calificaciones en `ratings`) sin filas acá: el promedio de una persona es del equipo
-- administrativo. El empleado no lee ratings por ninguna vía. Aparecen TODOS los empleados (con
-- ratings_count = 0 y promedio null si no tienen), así el listado completo se resuelve con una
-- sola consulta. Rendimiento: el promedio se agrupa por empleado en una subconsulta (assignments
-- join ratings, group by employee_id) unida por LEFT JOIN. Con ~35 empleados y 35.000
-- calificaciones medido en Docker local: el listado completo tarda ~27 ms (una sola pasada con
-- hash) y una ficha puntual (filtro por employee_id, que Postgres empuja dentro del group by y
-- resuelve por assignments_employee_id_shift_date_idx) ~8 ms. Un lateral por empleado salía a
-- ~195 ms para el listado, porque repetía un recorrido de ratings por cada empleado.
create view public.v_employee_ratings
with (security_invoker = true)
as
select
  e.profile_id as employee_id,
  coalesce(r.ratings_count, 0)::integer as ratings_count,
  r.ratings_avg
from public.employees e
left join (
  select
    a.employee_id,
    count(*) as ratings_count,
    avg(rt.score)::numeric(3, 2) as ratings_avg
  from public.assignments a
  join public.ratings rt on rt.assignment_id = a.id
  group by a.employee_id
) r on r.employee_id = e.profile_id
where (select app.is_admin());

comment on view public.v_employee_ratings is
  'Cantidad y promedio (1 a 5, dos decimales) de calificaciones por empleado (0033, P19.5a), para el listado de Empleados y la ficha. Una fila por cada empleado (ratings_count 0 y ratings_avg null si no tiene). Solo dueño y administradores ven filas (P-084). Cuenta todas las calificaciones de sus asignaciones, también las de asignaciones quitadas. security_invoker: además queda sujeta a la RLS de employees/assignments/ratings.';

-- ---------------------------------------------------------------------------------------------
-- 6. v_supervisions_admin (create or replace, dos columnas nuevas al final)
-- ---------------------------------------------------------------------------------------------

-- Horas de un supervisor por período (pestaña Asistencia de la ficha, ADM-12): sus supervisiones
-- ya traen fecha, cliente, sede, franja (start_time/end_time) y el inicio y fin reales
-- (check_in_at/check_out_at, de supervision_attendance); faltaban los minutos. planned_minutes es
-- la duración de la franja del turno; worked_minutes, fin real menos inicio real (null si falta
-- alguno). Mismas columnas y orden que 0029.
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
  app.minutes_between(sh.starts_at, sh.ends_at) as planned_minutes,
  app.minutes_between(ci.recorded_at, co.recorded_at) as worked_minutes
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
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). ratings_count/ratings_avg: cantidad y promedio simple del turno. start_time/end_time/starts_at/ends_at: franja del turno (0029, ADM-13). criteria_snapshot: criterios vigentes al iniciar (ADM-15). assigned_employees_count: empleados asignados vigentes del turno (0029). planned_minutes/worked_minutes (0033, P19.5a): duración de la franja y minutos entre el inicio y el fin reales de la supervisión (null si falta alguno), para las horas del supervisor en la pestaña Asistencia de su ficha (ADM-12). security_invoker: visibilidad de filas por RLS (0012) -- en la práctica solo O/A ven filas.';

-- ---------------------------------------------------------------------------------------------
-- 7. Resumen por cliente
-- ---------------------------------------------------------------------------------------------

-- clients_worked_minutes y client_service_summary recorren turnos por cliente y fecha: el índice
-- existente más cercano es (site_id, shift_date), que no sirve para "todos los turnos de un
-- cliente en un rango".
create index shifts_client_id_shift_date_idx
  on public.shifts (client_id, shift_date)
  where deleted_at is null;

-- "Turno realizado": turno vigente (deleted_at null), no cancelado, finalizado (completed) o con
-- al menos un inicio registrado en alguna de sus asignaciones. Minutos trabajados: suma, por
-- asignación, de fin real menos inicio real (solo si existen los dos; un inicio sin fin no suma
-- minutos pero la persona sí cuenta como "empleado que trabajó"). Minutos previstos: suma de la
-- duración de la franja efectiva de las asignaciones que tienen inicio registrado.
create function public.client_service_summary(
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
    select sh.id, sh.shift_date, sh.site_id, si.name as site_name, sh.start_time, sh.end_time, sh.status
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
      app.minutes_between(lower(a."window"), upper(a."window")) as planned_minutes,
      app.minutes_between(ci.recorded_at, co.recorded_at) as worked_minutes
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
            'worked_minutes', r.worked_minutes
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
      'planned_minutes', coalesce((select sum(planned_minutes) from rows where check_in_at is not null), 0)
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
            'employees', ps.employees
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
  'Resumen de servicios de un cliente en un período, para la hoja imprimible (0033, P19.5a). O, A (quien ve clientes, clients_select_admin); FORBIDDEN si no; INVALID_DATE_RANGE (fechas nulas o desde > hasta), CLIENT_NOT_FOUND. "Turno realizado": vigente, no cancelado, completed o con al menos un inicio registrado, con shift_date entre p_from y p_to. Devuelve jsonb { client_id, from, to, totals { shifts_done, employees_count (distintos con inicio), worked_minutes (suma de fin menos inicio de los pares completos), planned_minutes (franja efectiva de las asignaciones con inicio) }, shifts [ { shift_id, shift_date, site_id, site_name, start_time, end_time, status, worked_minutes, planned_minutes, employees [ { assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at, planned_minutes, worked_minutes } ] } ] } ordenado por fecha, hora y sede. employees lista las asignaciones vigentes del turno (también las sin inicio, con worked_minutes null).';

-- Una fila por cliente (todos, también los dados de baja) con los minutos trabajados en el
-- período: misma definición que los totales de client_service_summary (turnos vigentes no
-- cancelados; solo cuentan los pares inicio-fin), así la columna del listado de Clientes y la
-- hoja del cliente coinciden. 0 si no hubo trabajo.
create function public.clients_worked_minutes(p_from date, p_to date)
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
    select sum(app.minutes_between(ci.recorded_at, co.recorded_at)) as minutes
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
  'Minutos trabajados por cliente en un período, para la columna del listado de Clientes (0033, P19.5a). O, A; FORBIDDEN si no; INVALID_DATE_RANGE. Devuelve (client_id, worked_minutes) para TODOS los clientes (0 si no hubo trabajo); suma fin real menos inicio real de las asignaciones vigentes de turnos vigentes no cancelados con shift_date entre p_from y p_to -- mismo criterio que client_service_summary.totals.worked_minutes. El front pasa el mes en curso: del 1 a hoy en hora de Argentina.';

-- ---------------------------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------------------------

-- Las vistas corren con los permisos de quien consulta (security_invoker): las funciones de app
-- que usan tienen que ser ejecutables por authenticated (y por service_role, que también lee las
-- vistas, ver 0031).
grant execute on function app.late_grace_minutes() to authenticated, service_role;
grant execute on function app.minutes_between(timestamptz, timestamptz) to authenticated, service_role;

revoke execute on function public.update_person_name(uuid, text, text) from public, anon;
grant execute on function public.update_person_name(uuid, text, text) to authenticated;

revoke execute on function public.notify_on_the_way(uuid, integer) from public, anon;
grant execute on function public.notify_on_the_way(uuid, integer) to authenticated;

revoke execute on function public.client_service_summary(uuid, date, date) from public, anon;
grant execute on function public.client_service_summary(uuid, date, date) to authenticated;

revoke execute on function public.clients_worked_minutes(date, date) from public, anon;
grant execute on function public.clients_worked_minutes(date, date) to authenticated;

revoke all on public.v_employee_ratings from anon;
grant select on public.v_employee_ratings to authenticated;
