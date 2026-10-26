-- P24.1 · Coordinación libre y jornada del coordinador (acordado con Mike el 23 oct 2026; ver
-- Docs/Plan_Maestro/modulos/P24_coordinacion_libre_y_jornada.md, decisiones CJ-01 a CJ-34, todas
-- CONFIRMADAS). Segunda de dos migraciones: la primera (0062) solo agrega valores de enumeración.
--
-- Deja sin efecto la asignación manual de coordinadores (P-078, P-079) y la ausencia de supervisión
-- espontánea (P-086): el coordinador elige el turno y «Supervisar» registra el inicio. Las horas
-- del coordinador pasan a ser las de su jornada (inicio a fin menos pausas), no la suma de sus
-- supervisiones.
--
-- Contenido, en orden:
--   1. Tipo `workday_event_kind` y tablas `supervisor_priorities`, `supervisor_workdays` y
--      `supervisor_workday_events`, con RLS, grants y privacidad de coordenadas (criterio de 0054).
--   2. `supervisions.workday_id`.
--   3. Auxiliares del esquema `app`: validación de posición, estado, minutos, pausas, supervisiones
--      y eventos de una jornada; consistencia de eventos; posición de un evento (solo
--      administración).
--   4. RPC de jornada: start_workday, pause_workday, resume_workday, end_workday, reopen_workday.
--   5. RPC de supervisión: take_supervision, discard_supervision, complete_supervision (reescrita:
--      CJ-10, CJ-28 y registra el fin) y rate_employee (la ventana de P-083 no corre mientras la
--      supervisión sigue abierta).
--   6. RPC de administración: admin_correct_workday_event, admin_add_workday_pause,
--      admin_record_workday, set_supervisor_priority, remove_supervisor_priority.
--   7. Cierre automático: app.auto_close_workdays() y su programación en pg_cron (23:55 hora de
--      Argentina).
--   8. Vistas: v_supervisor_today, v_supervisor_status, v_supervisor_workdays_admin, v_my_workdays
--      y v_supervisions_admin (columnas nuevas al final).
--   9. Se revoca `execute` de assign_supervision, mark_supervision_not_done, supervision_check_in y
--      supervision_check_out.
--  10. Datos (CJ-23): las supervisiones `assigned` pasan a `cancelled`.
--
-- Decisiones menores (también en el informe del paquete):
--   - Se revocan además supervision_check_in y supervision_check_out (el encargo pedía solo
--     assign_supervision y mark_supervision_not_done): «Supervisar» (take_supervision) reemplaza al
--     inicio y complete_supervision registra el fin. Dejar el fin suelto permitiría cerrar la
--     medición de una supervisión sin pasar por CJ-10 y abrir otra (CJ-08).
--   - «Supervisión abierta» (CJ-08, CJ-29) = status `in_progress`, sin fin registrado y colgada de
--     la jornada de hoy. Las `in_progress` anteriores a esta migración (sin workday_id) no cuentan,
--     para que no bloqueen para siempre al coordinador.
--   - «Sin cerrar» (CJ-31) no es un valor nuevo de la enumeración: es una supervisión `in_progress`
--     con fin registrado por el cierre automático (columna derivada `unclosed` de las vistas). La
--     administración puede cancelarla con cancel_supervision.
--   - Eventos de la jornada: la pausa que sigue abierta al finalizar se cierra con el propio
--     evento `end` (no se inventa un `resume`). El tiempo entre `end` y `reopen` cuenta como pausa
--     con el motivo «Jornada reabierta» (CJ-30). Se puede finalizar la jornada estando en pausa.
--   - Capacidades: las correcciones de jornada piden `manage_attendance` (son correcciones de
--     horas, igual que correct_attendance_time de B1); las prioridades piden `manage_supervisions`.
--   - Los eventos `supervision_start` y `supervision_end` no se corrigen desde la jornada (su hora
--     es la de la supervisión y es informativa, CJ-14); sí inicio, pausa, reanudación, fin y
--     reapertura. Una pausa se da de baja con `p_remove` (se quita junto con su reanudación; nada
--     se borra, P-014) y la traza queda en el evento y en security_events.
--   - Una corrección deja `auto_closed = true` como constancia y `corrected = true`; la advertencia
--     de CJ-31 (`auto_close_warning` en las vistas) es `auto_closed and not corrected`.
--   - Lectura de la jornada propia: v_my_workdays (no figura en la especificación; la pantalla del
--     celular necesita el estado y el historial propios y el esquema `app` no está expuesto).
--   - Fechas y horas: la jornada nunca cruza la medianoche (restricción de la tabla); los instantes
--     de las correcciones se validan contra el día de la jornada y contra `now()`.
--   - El valor de work_date de la jornada es app.today() en el momento de iniciarla.

-- ---------------------------------------------------------------------------------------------
-- 1. Tipo y tablas
-- ---------------------------------------------------------------------------------------------

create type public.workday_event_kind as enum (
  'start',
  'pause',
  'resume',
  'end',
  'reopen',
  'supervision_start',
  'supervision_end'
);

comment on type public.workday_event_kind is
  'Evento de la jornada del coordinador (CJ-20): inicio, pausa, reanudación, fin, reapertura (CJ-30) e inicio y fin de cada supervisión.';

-- 1.1 supervisor_priorities (CJ-03, CJ-24) ------------------------------------------------------

create table public.supervisor_priorities (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.employees (profile_id),
  client_id uuid references public.clients (id),
  site_id uuid references public.sites (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  constraint supervisor_priorities_target_check check ((client_id is null) <> (site_id is null)),
  constraint supervisor_priorities_removed_check check ((removed_at is null) = (removed_by is null))
);

comment on table public.supervisor_priorities is
  'Clientes y sedes preferenciales de cada coordinador (CJ-03, CJ-24). Sirven para ordenar la lista, no para restringir. Una prioridad es de un cliente entero (cubre todas sus sedes, también las futuras) o de una sede. Una sede puede tener varios coordinadores preferenciales. Baja = removed_at / removed_by (P-014, sin borrado físico). Solo la escriben set_supervisor_priority y remove_supervisor_priority.';

create unique index supervisor_priorities_client_key
  on public.supervisor_priorities (supervisor_id, client_id)
  where client_id is not null and removed_at is null;
create unique index supervisor_priorities_site_key
  on public.supervisor_priorities (supervisor_id, site_id)
  where site_id is not null and removed_at is null;
create index supervisor_priorities_client_idx on public.supervisor_priorities (client_id) where client_id is not null;
create index supervisor_priorities_site_idx on public.supervisor_priorities (site_id) where site_id is not null;

alter table public.supervisor_priorities enable row level security;

create policy supervisor_priorities_select_admin
  on public.supervisor_priorities for select to authenticated
  using ((select app.is_admin()));

create policy supervisor_priorities_select_own
  on public.supervisor_priorities for select to authenticated
  using ((select app.has_role('supervisor')) and supervisor_id = (select app.current_uid()));

revoke all on public.supervisor_priorities from public, anon, authenticated;
grant select on public.supervisor_priorities to authenticated;

-- 1.2 supervisor_workdays (CJ-12 a CJ-17, CJ-30, CJ-31) -----------------------------------------

create table public.supervisor_workdays (
  id uuid primary key default gen_random_uuid(),
  supervisor_id uuid not null references public.employees (profile_id),
  work_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  auto_closed boolean not null default false,
  corrected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint supervisor_workdays_supervisor_work_date_key unique (supervisor_id, work_date),
  -- ADR-019 / CJ-15: la jornada nunca pasa la medianoche de Argentina. El día se compara con
  -- app.local_ts (inmutable), no con una conversión de zona.
  constraint supervisor_workdays_same_day_check check (
    started_at >= app.local_ts(work_date, time '00:00')
    and started_at < app.local_ts(work_date + 1, time '00:00')
    and (
      ended_at is null
      or (ended_at >= started_at and ended_at < app.local_ts(work_date + 1, time '00:00'))
    )
  )
);

comment on table public.supervisor_workdays is
  'Jornada del coordinador: una por coordinador y por día (CJ-30), que nunca pasa la medianoche (CJ-15). started_at / ended_at reflejan los eventos start y end de supervisor_workday_events (los mantienen las RPC y app.sync_workday). auto_closed = la cerró sola el cierre de las 23:55 (CJ-31, constancia que no se borra). corrected = la administración la corrigió o la registró (CJ-32). Las horas salen de app.workday_minutes (inicio a fin menos pausas, CJ-13). Solo la escriben las RPC.';

create index supervisor_workdays_work_date_idx on public.supervisor_workdays (work_date);
create index supervisor_workdays_open_idx on public.supervisor_workdays (work_date) where ended_at is null;

alter table public.supervisor_workdays enable row level security;

create trigger trg_set_updated_at
before update on public.supervisor_workdays
for each row execute function app.set_updated_at();

create policy supervisor_workdays_select_admin
  on public.supervisor_workdays for select to authenticated
  using ((select app.is_admin()));

create policy supervisor_workdays_select_own
  on public.supervisor_workdays for select to authenticated
  using ((select app.has_role('supervisor')) and supervisor_id = (select app.current_uid()));

revoke all on public.supervisor_workdays from public, anon, authenticated;
grant select on public.supervisor_workdays to authenticated;

-- 1.3 supervisor_workday_events (CJ-20, CJ-32) --------------------------------------------------

create table public.supervisor_workday_events (
  id uuid primary key default gen_random_uuid(),
  workday_id uuid not null references public.supervisor_workdays (id),
  -- Desempata los eventos con el mismo instante (dentro de una transacción now() no cambia).
  seq bigint generated always as identity,
  kind public.workday_event_kind not null,
  recorded_at timestamptz not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  accuracy_m numeric(7, 1),
  has_position boolean generated always as (latitude is not null) stored,
  reason text,
  supervision_id uuid references public.supervisions (id),
  corrected_from timestamptz,
  corrected_at timestamptz,
  corrected_by uuid references public.profiles (id),
  correction_reason text,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint supervisor_workday_events_position_check check (
    (latitude is null) = (longitude is null) and (latitude is null) = (accuracy_m is null)
  ),
  constraint supervisor_workday_events_range_check check (
    (latitude is null or (latitude between -90 and 90))
    and (longitude is null or (longitude between -180 and 180))
    and (accuracy_m is null or accuracy_m >= 0)
  ),
  constraint supervisor_workday_events_supervision_check check (
    (kind in ('supervision_start', 'supervision_end')) = (supervision_id is not null)
  ),
  constraint supervisor_workday_events_removed_check check ((removed_at is null) = (removed_by is null))
);

comment on table public.supervisor_workday_events is
  'Eventos de la jornada del coordinador (CJ-20): inicio, pausa, reanudación, fin, reapertura e inicio/fin de cada supervisión, con la hora del servidor (ADR-009) y la posición opcional. corrected_from / corrected_at / corrected_by / correction_reason: traza de la corrección administrativa (CJ-32); cada corrección queda además en security_events. removed_*: baja lógica de una pausa (P-014). Las coordenadas (latitude, longitude, accuracy_m) no se leen con select directo (criterio de 0054): se leen por app.workday_event_position y las vistas de administración. Solo las escriben las RPC.';

comment on column public.supervisor_workday_events.latitude is
  'Posición del evento (CJ-20, B-40). Sin select para authenticated: solo app.workday_event_position (administración).';
comment on column public.supervisor_workday_events.longitude is
  'Posición del evento (CJ-20, B-40). Sin select para authenticated: ver latitude.';
comment on column public.supervisor_workday_events.accuracy_m is
  'Precisión del GPS del evento (B-40). Sin select para authenticated: ver latitude.';
comment on column public.supervisor_workday_events.has_position is
  'true si el evento trae posición. Columna generada: permite saber «Sin ubicación» (CJ-33) sin leer las coordenadas.';
comment on column public.supervisor_workday_events.seq is
  'Orden de inserción: desempata los eventos con el mismo recorded_at.';

create index supervisor_workday_events_workday_idx
  on public.supervisor_workday_events (workday_id, recorded_at, seq);
create index supervisor_workday_events_supervision_idx
  on public.supervisor_workday_events (supervision_id) where supervision_id is not null;

alter table public.supervisor_workday_events enable row level security;

create policy supervisor_workday_events_select_admin
  on public.supervisor_workday_events for select to authenticated
  using ((select app.is_admin()));

create policy supervisor_workday_events_select_own
  on public.supervisor_workday_events for select to authenticated
  using (
    (select app.has_role('supervisor'))
    and workday_id in (
      select w.id from public.supervisor_workdays w where w.supervisor_id = (select app.current_uid())
    )
  );

-- Select de tabla fuera y select por columna, todas menos las coordenadas (mismo recurso que 0054).
revoke all on public.supervisor_workday_events from public, anon, authenticated;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into v_columns
  from pg_attribute a
  where a.attrelid = 'public.supervisor_workday_events'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname::text <> all (array['latitude', 'longitude', 'accuracy_m']);

  execute format('grant select (%s) on table public.supervisor_workday_events to authenticated', v_columns);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. supervisions.workday_id
-- ---------------------------------------------------------------------------------------------

alter table public.supervisions
  add column workday_id uuid references public.supervisor_workdays (id);

comment on column public.supervisions.workday_id is
  'Jornada del coordinador a la que pertenece la supervisión (0063, P24.1). Nulo en las anteriores a esta migración. assigned_by y assigned_at quedan como historial de la asignación manual (CJ-01), que ya no existe.';

create index supervisions_workday_id_idx on public.supervisions (workday_id) where workday_id is not null;

-- La columna nueva también queda con select para authenticated (la tabla no tiene grants por
-- columna, el select de tabla de 0017 la cubre); se deja el comentario para el próximo que lo toque.

-- ---------------------------------------------------------------------------------------------
-- 3. Auxiliares del esquema app
-- ---------------------------------------------------------------------------------------------

-- 3.1 Validación de la posición que manda el celular (mismos códigos que 0052).
create function app.validate_position(
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_outside_reason text default null
)
returns text
language plpgsql
immutable
set search_path = public, app, pg_temp
as $$
declare
  v_reason text;
begin
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

  v_reason := nullif(btrim(p_outside_reason), '');
  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'OUTSIDE_REASON_TOO_LONG';
  end if;

  return v_reason;
end;
$$;

comment on function app.validate_position(numeric, numeric, numeric, text) is
  'Uso interno (0063): valida que la posición venga completa y en rango y devuelve el motivo limpio (nulo si está vacío). COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG.';

revoke execute on function app.validate_position(numeric, numeric, numeric, text) from public, anon, authenticated;

-- 3.2 Estado de una jornada según su último evento de jornada (no de supervisión):
--     running (inicio, reanudación o reapertura), paused o ended. Nulo si no tiene eventos.
create function app.workday_state(p_workday_id uuid)
returns text
language sql
stable
set search_path = public, app, pg_temp
as $$
  select case e.kind when 'pause' then 'paused' when 'end' then 'ended' else 'running' end
  from public.supervisor_workday_events e
  where e.workday_id = p_workday_id
    and e.removed_at is null
    and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  order by e.recorded_at desc, e.seq desc
  limit 1;
$$;

comment on function app.workday_state(uuid) is
  'Estado de la jornada (0063): running, paused o ended, según su último evento start / pause / resume / end / reopen que no esté dado de baja. Invocador: respeta la RLS.';

-- 3.3 Minutos netos (CJ-13): suma de los tramos «en marcha» (desde inicio, reanudación o
--     reapertura hasta la pausa o el fin siguiente). Si la jornada sigue en marcha cuenta hasta
--     ahora. Redondeo al minuto más cercano, como app.minutes_between. Los viajes entre sedes
--     cuentan porque no son pausa. El tiempo de cada supervisión no suma (CJ-14).
create function app.workday_minutes(p_workday_id uuid)
returns integer
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    round(
      sum(extract(epoch from greatest(coalesce(ev.next_at, now()) - ev.recorded_at, interval '0'))) / 60
    )::integer,
    0
  )
  from (
    select
      e.kind,
      e.recorded_at,
      lead(e.recorded_at) over (order by e.recorded_at, e.seq) as next_at
    from public.supervisor_workday_events e
    where e.workday_id = p_workday_id
      and e.removed_at is null
      and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  ) ev
  where ev.kind in ('start', 'resume', 'reopen');
$$;

comment on function app.workday_minutes(uuid) is
  'Minutos netos de la jornada (0063, CJ-13): de inicio a fin descontando las pausas (y el tiempo entre el fin y la reapertura, CJ-30). Si la jornada está en marcha cuenta hasta ahora. Redondeo al minuto más cercano. Invocador: respeta la RLS.';

-- 3.4 Pausas de la jornada como jsonb: cada pausa (evento pause hasta la reanudación o el fin) y
--     cada hueco entre un fin y su reapertura (tipo reopened, motivo «Jornada reabierta»).
create function app.workday_pauses(p_workday_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'type', case when ev.kind = 'pause' then 'pause' else 'reopened' end,
        'pause_event_id', ev.id,
        'resume_event_id', case when ev.next_kind in ('resume', 'reopen') then ev.next_id end,
        'starts_at', ev.recorded_at,
        'ends_at', ev.next_at,
        'minutes', round(extract(epoch from greatest(coalesce(ev.next_at, now()) - ev.recorded_at, interval '0')) / 60)::integer,
        'reason', case when ev.kind = 'pause' then ev.reason else coalesce(ev.next_reason, 'Jornada reabierta') end,
        'corrected', (ev.corrected_at is not null)
      )
      order by ev.recorded_at, ev.seq
    ),
    '[]'::jsonb
  )
  from (
    select
      e.id, e.seq, e.kind, e.recorded_at, e.reason, e.corrected_at,
      lead(e.id) over w as next_id,
      lead(e.kind) over w as next_kind,
      lead(e.recorded_at) over w as next_at,
      lead(e.reason) over w as next_reason
    from public.supervisor_workday_events e
    where e.workday_id = p_workday_id
      and e.removed_at is null
      and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
    window w as (order by e.recorded_at, e.seq)
  ) ev
  where ev.kind = 'pause' or (ev.kind = 'end' and ev.next_kind = 'reopen');
$$;

comment on function app.workday_pauses(uuid) is
  'Pausas de la jornada (0063): arreglo jsonb de { type (pause | reopened), pause_event_id, resume_event_id, starts_at, ends_at (nulo si sigue abierta), minutes, reason, corrected }. Una pausa cerrada por el fin de la jornada no tiene resume_event_id. Invocador: respeta la RLS.';

-- 3.5 Supervisiones de la jornada (sin las canceladas) como jsonb. La duración es informativa
--     (CJ-14): no suma horas. `unclosed` = «Sin cerrar» (CJ-31).
create function app.workday_supervisions(p_workday_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'supervision_id', sv.id,
        'shift_id', sv.shift_id,
        'client_id', sh.client_id,
        'client_legal_name', cl.legal_name,
        'site_id', sh.site_id,
        'site_name', si.name,
        'status', sv.status,
        'check_in_at', ci.recorded_at,
        'check_out_at', co.recorded_at,
        'duration_minutes', app.minutes_between(
          ci.recorded_at,
          coalesce(co.recorded_at, case when sv.status = 'in_progress' then now() end)
        ),
        'unclosed', (sv.status = 'in_progress' and co.recorded_at is not null)
      )
      order by ci.recorded_at nulls last, sv.created_at
    ),
    '[]'::jsonb
  )
  from public.supervisions sv
  join public.shifts sh on sh.id = sv.shift_id
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
  left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
  where sv.workday_id = p_workday_id
    and sv.status <> 'cancelled';
$$;

comment on function app.workday_supervisions(uuid) is
  'Supervisiones no canceladas de la jornada (0063): arreglo jsonb de { supervision_id, shift_id, client_id, client_legal_name, site_id, site_name, status, check_in_at, check_out_at, duration_minutes (informativa, CJ-14), unclosed (CJ-31) }. Invocador: respeta la RLS.';

-- 3.6 Eventos de la jornada como jsonb (sin coordenadas: solo has_position). Incluye los dados
--     de baja, marcados con `removed`, para que la administración vea la traza.
create function app.workday_events_json(p_workday_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'kind', e.kind,
        'recorded_at', e.recorded_at,
        'reason', e.reason,
        'supervision_id', e.supervision_id,
        'has_position', e.has_position,
        'corrected', (e.corrected_at is not null),
        'corrected_from', e.corrected_from,
        'correction_reason', e.correction_reason,
        'removed', (e.removed_at is not null)
      )
      order by e.recorded_at, e.seq
    ),
    '[]'::jsonb
  )
  from public.supervisor_workday_events e
  where e.workday_id = p_workday_id;
$$;

comment on function app.workday_events_json(uuid) is
  'Eventos de la jornada (0063) como arreglo jsonb ordenado, sin coordenadas (has_position avisa si trae). Los dados de baja vienen con removed = true. Invocador: respeta la RLS.';

-- 3.7 Posición de un evento: solo administración (definidor, criterio de 0054).
create function app.workday_event_position(p_event_id uuid)
returns table (o_latitude numeric, o_longitude numeric, o_accuracy_m numeric)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select e.latitude::numeric, e.longitude::numeric, e.accuracy_m::numeric
  from public.supervisor_workday_events e
  where e.id = p_event_id and app.is_admin();
$$;

comment on function app.workday_event_position(uuid) is
  'Posición de un evento de la jornada para las vistas de administración (0063, B-40, CJ-22). Definidor: lee las columnas protegidas. Sin filas si la sesión no es del dueño ni de un administrador. Interna: no se expone en la API.';

-- Las vistas (invocador) llaman a estas funciones: authenticated y service_role necesitan execute
-- (lección de 0031 y 0055).
revoke execute on function app.workday_state(uuid) from public, anon;
revoke execute on function app.workday_minutes(uuid) from public, anon;
revoke execute on function app.workday_pauses(uuid) from public, anon;
revoke execute on function app.workday_supervisions(uuid) from public, anon;
revoke execute on function app.workday_events_json(uuid) from public, anon;
revoke execute on function app.workday_event_position(uuid) from public, anon;
grant execute on function app.workday_state(uuid) to authenticated, service_role;
grant execute on function app.workday_minutes(uuid) to authenticated, service_role;
grant execute on function app.workday_pauses(uuid) to authenticated, service_role;
grant execute on function app.workday_supervisions(uuid) to authenticated, service_role;
grant execute on function app.workday_events_json(uuid) to authenticated, service_role;
grant execute on function app.workday_event_position(uuid) to authenticated, service_role;

-- 3.8 Alta de un evento de la jornada (interno).
create function app.add_workday_event(
  p_workday_id uuid,
  p_kind public.workday_event_kind,
  p_at timestamptz,
  p_lat numeric,
  p_lng numeric,
  p_accuracy numeric,
  p_reason text,
  p_supervision_id uuid default null
)
returns public.supervisor_workday_events
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_event public.supervisor_workday_events;
begin
  insert into public.supervisor_workday_events (
    workday_id, kind, recorded_at, latitude, longitude, accuracy_m, reason, supervision_id, created_by
  )
  values (p_workday_id, p_kind, p_at, p_lat, p_lng, p_accuracy, p_reason, p_supervision_id, auth.uid())
  returning * into v_event;

  return v_event;
end;
$$;

comment on function app.add_workday_event(uuid, public.workday_event_kind, timestamptz, numeric, numeric, numeric, text, uuid) is
  'Uso interno (0063): inserta un evento de la jornada.';

revoke execute on function app.add_workday_event(uuid, public.workday_event_kind, timestamptz, numeric, numeric, numeric, text, uuid) from public, anon, authenticated;

-- 3.9 Consistencia de los eventos (CJ-32): después de una corrección la secuencia tiene que seguir
--     siendo válida. start -> (pause -> resume)* -> end -> reopen -> ... ; supervision_start y
--     supervision_end solo en marcha. Orden por (recorded_at, seq).
create function app.assert_workday_consistent(p_workday_id uuid)
returns void
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  r record;
  v_state text := 'none';
  v_valid boolean;
begin
  for r in
    select e.kind
    from public.supervisor_workday_events e
    where e.workday_id = p_workday_id and e.removed_at is null
    order by e.recorded_at, e.seq
  loop
    v_valid := true;

    if r.kind = 'start' and v_state = 'none' then
      v_state := 'running';
    elsif r.kind = 'pause' and v_state = 'running' then
      v_state := 'paused';
    elsif r.kind = 'resume' and v_state = 'paused' then
      v_state := 'running';
    elsif r.kind = 'end' and v_state in ('running', 'paused') then
      v_state := 'ended';
    elsif r.kind = 'reopen' and v_state = 'ended' then
      v_state := 'running';
    elsif r.kind in ('supervision_start', 'supervision_end') and v_state = 'running' then
      null;
    else
      v_valid := false;
    end if;

    if not v_valid then
      raise exception using
        errcode = 'P0001',
        message = 'Los horarios quedan fuera de orden: la jornada tiene que ir inicio, pausas, fin y reapertura en secuencia, sin pausas ni cierres dentro de una supervisión.',
        hint = 'INVALID_EVENT_ORDER';
    end if;
  end loop;
end;
$$;

comment on function app.assert_workday_consistent(uuid) is
  'Uso interno (0063): corta con INVALID_EVENT_ORDER si los eventos vigentes de la jornada no forman una secuencia válida.';

revoke execute on function app.assert_workday_consistent(uuid) from public, anon, authenticated;

-- 3.10 started_at / ended_at de la jornada según sus eventos vigentes (interno).
create function app.sync_workday(p_workday_id uuid)
returns void
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_started timestamptz;
  v_last_kind public.workday_event_kind;
  v_last_at timestamptz;
begin
  select e.recorded_at into v_started
  from public.supervisor_workday_events e
  where e.workday_id = p_workday_id and e.removed_at is null and e.kind = 'start'
  order by e.recorded_at, e.seq
  limit 1;

  select e.kind, e.recorded_at into v_last_kind, v_last_at
  from public.supervisor_workday_events e
  where e.workday_id = p_workday_id
    and e.removed_at is null
    and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  order by e.recorded_at desc, e.seq desc
  limit 1;

  update public.supervisor_workdays
  set started_at = v_started,
      ended_at = case when v_last_kind = 'end' then v_last_at end,
      updated_by = auth.uid()
  where id = p_workday_id;
end;
$$;

comment on function app.sync_workday(uuid) is
  'Uso interno (0063): recalcula started_at (evento start) y ended_at (nulo si el último evento de jornada no es end) de la jornada.';

revoke execute on function app.sync_workday(uuid) from public, anon, authenticated;

-- 3.11 Estado de la jornada para devolver desde las RPC (interno).
create function app.workday_snapshot(p_workday_id uuid)
returns jsonb
language sql
stable
set search_path = public, app, pg_temp
as $$
  select jsonb_build_object(
    'workday_id', w.id,
    'supervisor_id', w.supervisor_id,
    'work_date', w.work_date,
    'state', app.workday_state(w.id),
    'started_at', w.started_at,
    'ended_at', w.ended_at,
    'minutes', app.workday_minutes(w.id),
    'paused_since', case when app.workday_state(w.id) = 'paused' then lm.recorded_at end,
    'pause_reason', case when app.workday_state(w.id) = 'paused' then lm.reason end,
    'auto_closed', w.auto_closed,
    'corrected', w.corrected
  )
  from public.supervisor_workdays w
  left join lateral (
    select e.recorded_at, e.reason
    from public.supervisor_workday_events e
    where e.workday_id = w.id
      and e.removed_at is null
      and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
    order by e.recorded_at desc, e.seq desc
    limit 1
  ) lm on true
  where w.id = p_workday_id;
$$;

comment on function app.workday_snapshot(uuid) is
  'Uso interno (0063): estado de la jornada que devuelven las RPC { workday_id, supervisor_id, work_date, state (running | paused | ended), started_at, ended_at, minutes, paused_since, pause_reason, auto_closed, corrected }.';

revoke execute on function app.workday_snapshot(uuid) from public, anon, authenticated;

-- 3.12 Supervisión abierta de una jornada (interno): in_progress sin fin registrado (CJ-08, CJ-29).
create function app.open_supervision_id(p_workday_id uuid)
returns uuid
language sql
stable
set search_path = public, app, pg_temp
as $$
  select sv.id
  from public.supervisions sv
  where sv.workday_id = p_workday_id
    and sv.status = 'in_progress'
    and not exists (
      select 1 from public.supervision_attendance sa
      where sa.supervision_id = sv.id and sa.kind = 'check_out'
    )
  order by sv.created_at
  limit 1;
$$;

comment on function app.open_supervision_id(uuid) is
  'Supervisión abierta (in_progress, sin fin registrado) de la jornada, o nulo (0063, CJ-08, CJ-29). Invocador: respeta la RLS.';

-- La leen las vistas de invocador (v_supervisor_status): authenticated y service_role necesitan execute.
revoke execute on function app.open_supervision_id(uuid) from public, anon;
grant execute on function app.open_supervision_id(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. RPC de jornada (CJ-07, CJ-12, CJ-20, CJ-29, CJ-30)
-- ---------------------------------------------------------------------------------------------

create function public.start_workday(
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := app.today();
  v_wd public.supervisor_workdays;
begin
  perform app.require_role('supervisor');
  perform app.validate_position(p_lat, p_lng, p_accuracy);

  if not exists (
    select 1 from public.employees e
    where e.profile_id = v_uid and e.status = 'active' and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Tu perfil de coordinador no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  -- CJ-29: con licencia ese día no se puede iniciar la jornada (mismo criterio que 0061).
  if exists (
    select 1 from public.employee_leaves el
    where el.employee_id = v_uid
      and el.deleted_at is null
      and el.starts_on <= v_today
      and (el.ends_on is null or el.ends_on >= v_today)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Estás de licencia hoy: no podés iniciar la jornada.',
      hint = 'ON_LEAVE';
  end if;

  begin
    insert into public.supervisor_workdays (supervisor_id, work_date, started_at, created_by)
    values (v_uid, v_today, now(), v_uid)
    returning * into v_wd;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ya iniciaste tu jornada de hoy. Si la finalizaste y volvés a trabajar, reabrila.',
        hint = 'WORKDAY_ALREADY_STARTED';
  end;

  perform app.add_workday_event(v_wd.id, 'start', now(), p_lat, p_lng, p_accuracy, null);

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.start_workday(numeric, numeric, numeric) is
  'Inicia la jornada de hoy del coordinador con la hora del servidor y la posición opcional (CJ-12, CJ-20). S. SUPERVISOR_ROLE_REQUIRED (perfil sin ficha activa), ON_LEAVE (licencia vigente hoy, CJ-29), WORKDAY_ALREADY_STARTED (una jornada por día, CJ-30), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE. Devuelve el estado { workday_id, state, started_at, minutes, ... }.';

create function public.pause_workday(
  p_reason text default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_wd public.supervisor_workdays;
  v_state text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  perform app.require_role('supervisor');
  perform app.validate_position(p_lat, p_lng, p_accuracy);

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no iniciaste tu jornada de hoy.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada ya está finalizada.',
      hint = 'WORKDAY_ENDED';
  end if;

  if v_state = 'paused' then
    raise exception using
      errcode = 'P0001',
      message = 'Ya estás en pausa.',
      hint = 'WORKDAY_PAUSED';
  end if;

  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'REASON_TOO_LONG';
  end if;

  -- CJ-29.
  if app.open_supervision_id(v_wd.id) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cerrá o descartá la supervisión abierta antes de pausar tu jornada.',
      hint = 'SUPERVISION_OPEN';
  end if;

  perform app.add_workday_event(v_wd.id, 'pause', now(), p_lat, p_lng, p_accuracy, v_reason);

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.pause_workday(text, numeric, numeric, numeric) is
  'Pausa la jornada de hoy del coordinador; el motivo es opcional (CJ-16, CJ-20). S. WORKDAY_NOT_STARTED, WORKDAY_ENDED, WORKDAY_PAUSED (ya en pausa), REASON_TOO_LONG (más de 300 caracteres), SUPERVISION_OPEN (hay una supervisión abierta, CJ-29), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE. Devuelve el estado de la jornada.';

create function public.resume_workday(
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_wd public.supervisor_workdays;
  v_state text;
begin
  perform app.require_role('supervisor');
  perform app.validate_position(p_lat, p_lng, p_accuracy);

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no iniciaste tu jornada de hoy.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada ya está finalizada.',
      hint = 'WORKDAY_ENDED';
  end if;

  if v_state <> 'paused' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada no está en pausa.',
      hint = 'WORKDAY_NOT_PAUSED';
  end if;

  perform app.add_workday_event(v_wd.id, 'resume', now(), p_lat, p_lng, p_accuracy, null);

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.resume_workday(numeric, numeric, numeric) is
  'Reanuda la jornada de hoy (CJ-12, CJ-20). S. WORKDAY_NOT_STARTED, WORKDAY_ENDED, WORKDAY_NOT_PAUSED, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE. Devuelve el estado de la jornada.';

create function public.end_workday(
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_wd public.supervisor_workdays;
  v_state text;
begin
  perform app.require_role('supervisor');
  perform app.validate_position(p_lat, p_lng, p_accuracy);

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no iniciaste tu jornada de hoy.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada ya está finalizada.',
      hint = 'WORKDAY_ENDED';
  end if;

  -- CJ-29.
  if app.open_supervision_id(v_wd.id) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cerrá o descartá la supervisión abierta antes de finalizar tu jornada.',
      hint = 'SUPERVISION_OPEN';
  end if;

  perform app.add_workday_event(v_wd.id, 'end', now(), p_lat, p_lng, p_accuracy, null);

  update public.supervisor_workdays
  set ended_at = now(), updated_by = v_uid
  where id = v_wd.id;

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.end_workday(numeric, numeric, numeric) is
  'Finaliza la jornada de hoy (CJ-12, CJ-20); se puede finalizar estando en pausa. S. WORKDAY_NOT_STARTED, WORKDAY_ENDED, SUPERVISION_OPEN (hay una supervisión abierta, CJ-29), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE. Devuelve el estado de la jornada.';

create function public.reopen_workday(
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_wd public.supervisor_workdays;
  v_state text;
begin
  perform app.require_role('supervisor');
  perform app.validate_position(p_lat, p_lng, p_accuracy);

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no iniciaste tu jornada de hoy.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state <> 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada no está finalizada.',
      hint = 'WORKDAY_NOT_ENDED';
  end if;

  -- CJ-30: el tiempo entre el fin y la reapertura cuenta como pausa, con este motivo.
  perform app.add_workday_event(v_wd.id, 'reopen', now(), p_lat, p_lng, p_accuracy, 'Jornada reabierta');

  update public.supervisor_workdays
  set ended_at = null, updated_by = v_uid
  where id = v_wd.id;

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.reopen_workday(numeric, numeric, numeric) is
  'Reabre la jornada de hoy ya finalizada (CJ-30): el tiempo entre el fin y la reapertura cuenta como pausa con el motivo «Jornada reabierta». S. WORKDAY_NOT_STARTED, WORKDAY_NOT_ENDED, COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE. Devuelve el estado de la jornada.';

-- ---------------------------------------------------------------------------------------------
-- 5. RPC de supervisión (CJ-04 a CJ-10, CJ-26, CJ-27, CJ-28)
-- ---------------------------------------------------------------------------------------------

-- 5.1 take_supervision: reemplaza a assign_supervision + supervision_check_in. «Supervisar» registra
--     el inicio con la posición en un solo paso (CJ-26). Cualquier turno de hoy, en curso o ya
--     terminado (CJ-06), con la jornada iniciada y sin pausa (CJ-07), y de a una (CJ-08).
create function public.take_supervision(
  p_shift_id uuid,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts;
  v_wd public.supervisor_workdays;
  v_state text;
  v_supervision public.supervisions;
  v_record public.supervision_attendance;
  v_criteria jsonb;
  v_geo record;
  v_outside_reason text;
  v_warnings text[] := array[]::text[];
begin
  perform app.require_role('supervisor');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado: no se puede supervisar.',
      hint = 'SHIFT_NOT_SUPERVISABLE';
  end if;

  if v_shift.shift_date <> app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no es de hoy.',
      hint = 'NOT_TODAY';
  end if;

  select * into v_wd
  from public.supervisor_workdays
  where supervisor_id = v_uid and work_date = app.today()
  for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'Primero iniciá tu jornada.',
      hint = 'WORKDAY_NOT_STARTED';
  end if;

  v_state := app.workday_state(v_wd.id);

  if v_state = 'ended' then
    raise exception using
      errcode = 'P0001',
      message = 'Tu jornada está finalizada: reabrila para supervisar.',
      hint = 'WORKDAY_ENDED';
  end if;

  if v_state = 'paused' then
    raise exception using
      errcode = 'P0001',
      message = 'Estás en pausa: reanudá tu jornada para supervisar.',
      hint = 'WORKDAY_PAUSED';
  end if;

  -- CJ-08: de a una.
  if app.open_supervision_id(v_wd.id) is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Cerrá o descartá tu supervisión abierta antes de empezar otra.',
      hint = 'SUPERVISION_ALREADY_OPEN';
  end if;

  v_outside_reason := app.validate_position(p_lat, p_lng, p_accuracy, p_outside_reason);

  -- criteria_snapshot (P-087): criterios vigentes hoy, ordenados por position.
  select coalesce(
      jsonb_agg(
        jsonb_build_object('id', rc.id, 'title', rc.title, 'description', rc.description, 'position', rc.position)
        order by rc.position
      ),
      '[]'::jsonb
    )
    into v_criteria
  from public.rating_criteria rc
  where rc.valid_from <= app.today() and (rc.valid_to is null or rc.valid_to >= app.today());

  begin
    insert into public.supervisions (shift_id, supervisor_id, status, workday_id, criteria_snapshot, created_by)
    values (p_shift_id, v_uid, 'in_progress', v_wd.id, v_criteria, v_uid)
    returning * into v_supervision;
  exception
    when unique_violation then
      -- CJ-27: una supervisión por coordinador y por turno entre las no canceladas.
      raise exception using
        errcode = 'P0001',
        message = 'Ya supervisaste este turno.',
        hint = 'ALREADY_SUPERVISED';
  end;

  -- Validación contra la sede supervisada (B-07).
  select * into v_geo from app.geo_for_site(v_shift.site_id, p_lat, p_lng, p_accuracy);

  insert into public.supervision_attendance (
    supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
    geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
  )
  values (
    v_supervision.id, 'check_in', now(), p_lat, p_lng, p_accuracy,
    v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
    case when v_geo.status = 'outside' then v_outside_reason end
  )
  returning * into v_record;

  perform app.add_workday_event(
    v_wd.id, 'supervision_start', now(), p_lat, p_lng, p_accuracy, null, v_supervision.id
  );

  -- Advertencia (no bloquea, P15.0): el coordinador también está asignado como empleado.
  if exists (
    select 1 from public.assignments a
    where a.shift_id = p_shift_id and a.employee_id = v_uid and a.removed_at is null
  ) then
    v_warnings := array_append(v_warnings, 'SUPERVISES_OWN_SHIFT');
  end if;

  return jsonb_build_object(
    'supervision', to_jsonb(v_supervision),
    'check_in', to_jsonb(v_record),
    'warnings', v_warnings
  );
end;
$$;

comment on function public.take_supervision(uuid, numeric, numeric, numeric, text) is
  'El coordinador toma un turno de hoy y empieza la supervisión en un solo paso (CJ-26): crea la supervisión en in_progress, registra el inicio con la hora del servidor y la validación contra la sede (B-07) y deja el evento supervision_start. Reemplaza a assign_supervision + supervision_check_in. S. SHIFT_NOT_FOUND, SHIFT_NOT_SUPERVISABLE (turno cancelado), NOT_TODAY, WORKDAY_NOT_STARTED, WORKDAY_ENDED, WORKDAY_PAUSED (CJ-07), SUPERVISION_ALREADY_OPEN (CJ-08), ALREADY_SUPERVISED (ya tiene una supervisión no cancelada de ese turno, CJ-27), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Devuelve { supervision, check_in, warnings } con SUPERVISES_OWN_SHIFT si también está asignado como empleado en ese turno.';

-- 5.2 discard_supervision (CJ-27)
create function public.discard_supervision(p_supervision_id uuid)
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

  -- El evento de inicio de una supervisión descartada se da de baja (baja lógica, P-014): no queda
  -- un inicio sin fin en la jornada.
  update public.supervisor_workday_events
  set removed_at = now(), removed_by = auth.uid()
  where supervision_id = p_supervision_id and kind = 'supervision_start' and removed_at is null;

  return v_supervision;
end;
$$;

comment on function public.discard_supervision(uuid) is
  'Descarta una supervisión empezada por error, si todavía no calificó a nadie (CJ-27): queda cancelled con el motivo «Descartada por el coordinador», su evento supervision_start se da de baja y puede volver a tomar ese turno. S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, SUPERVISION_NOT_EDITABLE (no está in_progress), SUPERVISION_HAS_RATINGS.';

-- 5.3 complete_supervision: exige calificar a todos (CJ-10, CJ-28) y registra el fin. Cambia la
--     firma (posición opcional): se elimina la anterior para no dejar una sobrecarga ambigua.
drop function public.complete_supervision(uuid, text);

create function public.complete_supervision(
  p_supervision_id uuid,
  p_general_notes text default null,
  p_lat numeric default null,
  p_lng numeric default null,
  p_accuracy numeric default null,
  p_outside_reason text default null
)
returns public.supervisions
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_site_id uuid;
  v_missing text;
  v_geo record;
  v_outside_reason text;
  v_has_checkout boolean;
  v_now timestamptz := now();
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

  if v_supervision.status = 'assigned' then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no registraste el inicio.',
      hint = 'NOT_STARTED';
  end if;

  if v_supervision.status <> 'in_progress' then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no admite ese cambio en su estado actual.',
      hint = 'SUPERVISION_NOT_EDITABLE';
  end if;

  v_outside_reason := app.validate_position(p_lat, p_lng, p_accuracy, p_outside_reason);

  -- CJ-10 y CJ-28: hay que calificar a los empleados asignados (vigentes) con inicio registrado.
  -- Los ausentes no se califican; si el coordinador también está asignado como empleado, no se
  -- califica a sí mismo y queda fuera del requisito (P15.0).
  select string_agg(p.first_name || ' ' || p.last_name, ', ' order by p.last_name, p.first_name)
  into v_missing
  from public.assignments a
  join public.profiles p on p.id = a.employee_id
  where a.shift_id = v_supervision.shift_id
    and a.removed_at is null
    and a.employee_id <> v_supervision.supervisor_id
    and exists (
      select 1 from public.attendance_records ar
      where ar.assignment_id = a.id and ar.kind = 'check_in'
    )
    and not exists (
      select 1 from public.ratings r
      where r.supervision_id = v_supervision.id and r.assignment_id = a.id
    );

  if v_missing is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Falta calificar a: ' || v_missing || '.',
      hint = 'RATINGS_PENDING';
  end if;

  -- Registro del fin (con la validación contra la sede, B-07). Si ya tenía un fin (supervisiones
  -- anteriores a 0063), no se vuelve a registrar.
  select exists (
    select 1 from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out'
  ) into v_has_checkout;

  if not v_has_checkout then
    select sh.site_id into v_site_id from public.shifts sh where sh.id = v_supervision.shift_id;

    select * into v_geo from app.geo_for_site(v_site_id, p_lat, p_lng, p_accuracy);

    insert into public.supervision_attendance (
      supervision_id, kind, recorded_at, latitude, longitude, accuracy_m,
      geo_status, geo_unvalidated_reason, site_distance_m, geofence_radius_m, outside_reason
    )
    values (
      p_supervision_id, 'check_out', v_now, p_lat, p_lng, p_accuracy,
      v_geo.status, v_geo.reason, v_geo.distance_m, v_geo.radius_m,
      case when v_geo.status = 'outside' then v_outside_reason end
    );

    if v_supervision.workday_id is not null then
      perform app.add_workday_event(
        v_supervision.workday_id, 'supervision_end', v_now, p_lat, p_lng, p_accuracy, null, v_supervision.id
      );
    end if;
  end if;

  update public.supervisions
  set status = 'completed', general_notes = nullif(btrim(p_general_notes), ''), updated_by = auth.uid()
  where id = p_supervision_id
  returning * into v_supervision;

  return v_supervision;
end;
$$;

comment on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text) is
  'Cierra una supervisión in_progress (04 sección 6.4; CJ-10, CJ-28, 0063): exige calificar a todos los empleados asignados vigentes con inicio registrado (excluye al propio coordinador si también está asignado) y registra el fin con la hora del servidor, la validación contra la sede y el evento supervision_end. S (propia). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, NOT_STARTED, SUPERVISION_NOT_EDITABLE (no está in_progress), RATINGS_PENDING (el mensaje nombra a quienes faltan), COORDINATES_INCOMPLETE, COORDINATES_OUT_OF_RANGE, OUTSIDE_REASON_TOO_LONG. Texto vacío de general_notes se guarda como null. Ya no exige un fin registrado antes (CHECK_OUT_REQUIRED desaparece).';

-- 5.4 rate_employee: igual que 0029 salvo la ventana de P-083. Mientras la supervisión sigue
--     abierta (sin fin registrado) no hay ventana: con un turno ya terminado (CJ-06), now() ya
--     superó el fin previsto y el coordinador no podría calificar. La ventana corre desde que se
--     registra el fin, como antes.
create or replace function public.rate_employee(
  p_supervision_id uuid,
  p_assignment_id uuid,
  p_score integer,
  p_comment text default null
)
returns public.ratings
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_supervision public.supervisions;
  v_assignment public.assignments;
  v_shift public.shifts;
  v_checkout_at timestamptz;
  v_can_always boolean;
  v_rating public.ratings;
begin
  v_can_always := app.has_capability('edit_ratings');

  select * into v_supervision from public.supervisions where id = p_supervision_id;

  if v_supervision.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa supervisión.',
      hint = 'SUPERVISION_NOT_FOUND';
  end if;

  if not v_can_always then
    if app.has_role('supervisor') and v_supervision.supervisor_id = auth.uid() then
      null;
    elsif app.has_role('supervisor') then
      raise exception using
        errcode = 'P0001',
        message = 'Esa supervisión no es tuya.',
        hint = 'NOT_YOUR_SUPERVISION';
    else
      raise exception using
        errcode = 'P0001',
        message = 'No tenés permiso para hacer esto.',
        hint = 'FORBIDDEN';
    end if;
  end if;

  if v_supervision.status not in ('in_progress', 'completed') then
    raise exception using
      errcode = 'P0001',
      message = 'Esta supervisión no está en curso ni completada.',
      hint = 'SUPERVISION_NOT_ACTIVE';
  end if;

  select * into v_assignment from public.assignments where id = p_assignment_id;

  if v_assignment.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa asignación.',
      hint = 'ASSIGNMENT_NOT_FOUND';
  end if;

  if v_assignment.shift_id <> v_supervision.shift_id or v_assignment.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Esa asignación no pertenece al turno de esta supervisión.',
      hint = 'ASSIGNMENT_NOT_IN_SHIFT';
  end if;

  -- CB-13: el coordinador no puede calificar su propia asignación (P-042).
  if v_assignment.employee_id = v_supervision.supervisor_id then
    raise exception using
      errcode = 'P0001',
      message = 'No podés calificarte a vos mismo.',
      hint = 'SELF_RATING_NOT_ALLOWED';
  end if;

  if p_score < 1 or p_score > 5 then
    raise exception using
      errcode = 'P0001',
      message = 'El puntaje tiene que ser entre 1 y 5.',
      hint = 'SCORE_OUT_OF_RANGE';
  end if;

  -- Ventana de edición (P-083), solo para la rama del coordinador y solo desde que la supervisión
  -- tiene fin registrado (0063).
  if not v_can_always then
    select sa.recorded_at into v_checkout_at
    from public.supervision_attendance sa
    where sa.supervision_id = p_supervision_id and sa.kind = 'check_out';

    if v_checkout_at is not null then
      select * into v_shift from public.shifts where id = v_supervision.shift_id;

      if now() > greatest(v_shift.ends_at, v_checkout_at) then
        raise exception using
          errcode = 'P0001',
          message = 'El plazo para editar esta calificación terminó.',
          hint = 'RATING_WINDOW_CLOSED';
      end if;
    end if;
  end if;

  insert into public.ratings (supervision_id, assignment_id, score, comment, created_by)
  values (p_supervision_id, p_assignment_id, p_score, nullif(btrim(p_comment), ''), auth.uid())
  on conflict (supervision_id, assignment_id) do update
    set score = excluded.score, comment = excluded.comment, updated_by = auth.uid()
  returning * into v_rating;

  return v_rating;
end;
$$;

comment on function public.rate_employee(uuid, uuid, integer, text) is
  'Upsert de la calificación de un empleado (04 sección 2.5, 6.4, 9; 06 sección 13; P-080, P-081). S (propia, dentro del plazo de P-083); O, A + edit_ratings (siempre, sin ventana). Cada coordinador califica con su criterio: un empleado puede tener varias calificaciones en el mismo turno, una por supervisión (CJ-09). SUPERVISION_NOT_FOUND, NOT_YOUR_SUPERVISION, FORBIDDEN, SUPERVISION_NOT_ACTIVE (ni in_progress ni completed), ASSIGNMENT_NOT_FOUND, ASSIGNMENT_NOT_IN_SHIFT (de otro turno o quitada), SELF_RATING_NOT_ALLOWED (CB-13), SCORE_OUT_OF_RANGE, RATING_WINDOW_CLOSED (now() > greatest(fin previsto del turno, fin registrado de la supervisión), solo para el coordinador y solo si la supervisión ya tiene fin registrado, 0063). El empleado no ve esta tabla por ninguna vía (P-084, RLS de 0012).';

-- ---------------------------------------------------------------------------------------------
-- 6. RPC de administración (CJ-03, CJ-24, CJ-32)
-- ---------------------------------------------------------------------------------------------

-- 6.1 admin_correct_workday_event: corrige la hora de un evento de la jornada (inicio, pausa,
--     reanudación, fin o reapertura) o da de baja una pausa. Motivo obligatorio y traza.
create function public.admin_correct_workday_event(
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
      message = 'Los eventos de una supervisión no se corrigen desde la jornada.',
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
      'reason', v_reason
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean) is
  'Corrige la hora de un evento de la jornada de un coordinador (inicio, pausa, reanudación, fin o reapertura) o, con p_remove = true, da de baja una pausa junto con su reanudación (CJ-32). O, A con manage_attendance (FORBIDDEN si no). Motivo obligatorio. Guarda la hora anterior en el evento (corrected_from), marca la jornada como corrected y registra workday_corrected en security_events. EVENT_NOT_FOUND, REASON_REQUIRED, EVENT_NOT_CORRECTABLE (eventos de supervisión), EVENT_NOT_REMOVABLE (solo se quitan pausas), TIME_REQUIRED, AT_OUT_OF_RANGE (dentro del día de la jornada y no futura), SAME_TIME, INVALID_EVENT_ORDER (la secuencia queda inválida). Devuelve el estado de la jornada.';

-- 6.2 admin_add_workday_pause: agrega una pausa a una jornada (inicio y fin de la pausa).
create function public.admin_add_workday_pause(
  p_workday_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text,
  p_pause_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_wd public.supervisor_workdays;
  v_reason text := nullif(btrim(p_reason), '');
  v_pause_reason text := nullif(btrim(p_pause_reason), '');
  v_pause public.supervisor_workday_events;
  v_resume public.supervisor_workday_events;
begin
  perform app.require_capability('manage_attendance');

  select * into v_wd from public.supervisor_workdays where id = p_workday_id for update;

  if v_wd.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa jornada.',
      hint = 'WORKDAY_NOT_FOUND';
  end if;

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_starts_at is null or p_ends_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá cuándo empieza y cuándo termina la pausa.',
      hint = 'TIME_REQUIRED';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception using
      errcode = 'P0001',
      message = 'El fin de la pausa tiene que ser posterior al inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if p_starts_at < app.local_ts(v_wd.work_date, time '00:00')
    or p_ends_at >= app.local_ts(v_wd.work_date + 1, time '00:00')
    or p_ends_at > now()
  then
    raise exception using
      errcode = 'P0001',
      message = 'La pausa tiene que estar dentro del día de la jornada y no puede ser futura.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if v_pause_reason is not null and char_length(v_pause_reason) > 300 then
    raise exception using
      errcode = 'P0001',
      message = 'El motivo es demasiado largo (máximo 300 caracteres).',
      hint = 'REASON_TOO_LONG';
  end if;

  v_pause := app.add_workday_event(v_wd.id, 'pause', p_starts_at, null, null, null, v_pause_reason);
  v_resume := app.add_workday_event(v_wd.id, 'resume', p_ends_at, null, null, null, null);

  update public.supervisor_workday_events
  set corrected_at = now(), corrected_by = auth.uid(), correction_reason = v_reason
  where id in (v_pause.id, v_resume.id);

  perform app.assert_workday_consistent(v_wd.id);

  update public.supervisor_workdays
  set corrected = true, updated_by = auth.uid()
  where id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    v_wd.supervisor_id,
    jsonb_build_object(
      'action', 'add_pause',
      'workday_id', v_wd.id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'reason', v_reason
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_add_workday_pause(uuid, timestamptz, timestamptz, text, text) is
  'Agrega una pausa a la jornada de un coordinador (CJ-32). O, A con manage_attendance. p_reason es el motivo de la corrección (obligatorio); p_pause_reason, el motivo de la pausa (opcional, CJ-16). WORKDAY_NOT_FOUND, REASON_REQUIRED, TIME_REQUIRED, INVALID_TIME_RANGE (el fin tiene que ser posterior al inicio), AT_OUT_OF_RANGE (dentro del día de la jornada y no futura), REASON_TOO_LONG, INVALID_EVENT_ORDER (cae fuera de la jornada, sobre otra pausa o dentro de una supervisión). Marca la jornada como corrected y registra workday_corrected. Devuelve el estado de la jornada.';

-- 6.3 admin_record_workday: registra una jornada en nombre del coordinador que se olvidó de
--     iniciarla (CJ-32).
create function public.admin_record_workday(
  p_supervisor_id uuid,
  p_work_date date,
  p_started_at timestamptz,
  p_reason text,
  p_ended_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_reason text := nullif(btrim(p_reason), '');
  v_wd public.supervisor_workdays;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  perform app.require_capability('manage_attendance');

  if v_reason is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'REASON_REQUIRED';
  end if;

  if p_work_date is null or p_started_at is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el día y la hora de inicio.',
      hint = 'TIME_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.employees e on e.profile_id = p.id
    join public.user_roles ur on ur.profile_id = p.id and ur.role = 'supervisor'
    where p.id = p_supervisor_id
      and p.is_active
      and p.deleted_at is null
      and e.status = 'active'
      and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese coordinador no tiene el rol vigente o no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  if p_work_date > app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'No se puede registrar una jornada de un día que todavía no llegó.',
      hint = 'DATE_IN_FUTURE';
  end if;

  v_day_start := app.local_ts(p_work_date, time '00:00');
  v_day_end := app.local_ts(p_work_date + 1, time '00:00');

  if p_started_at < v_day_start or p_started_at >= v_day_end or p_started_at > now()
    or (p_ended_at is not null and (p_ended_at < v_day_start or p_ended_at >= v_day_end or p_ended_at > now()))
  then
    raise exception using
      errcode = 'P0001',
      message = 'Las horas tienen que estar dentro del día de la jornada y no pueden ser futuras.',
      hint = 'AT_OUT_OF_RANGE';
  end if;

  if p_ended_at is not null and p_ended_at <= p_started_at then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  -- Una jornada de un día anterior no puede quedar abierta: la cerraría el cierre automático.
  if p_ended_at is null and p_work_date < app.today() then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá la hora de fin: la jornada es de un día anterior.',
      hint = 'ENDED_AT_REQUIRED';
  end if;

  begin
    insert into public.supervisor_workdays (supervisor_id, work_date, started_at, ended_at, corrected, created_by)
    values (p_supervisor_id, p_work_date, p_started_at, p_ended_at, true, auth.uid())
    returning * into v_wd;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese coordinador ya tiene una jornada ese día. Corregí sus horarios en lugar de registrarla de nuevo.',
        hint = 'WORKDAY_ALREADY_EXISTS';
  end;

  perform app.add_workday_event(v_wd.id, 'start', p_started_at, null, null, null, null);
  if p_ended_at is not null then
    perform app.add_workday_event(v_wd.id, 'end', p_ended_at, null, null, null, null);
  end if;

  update public.supervisor_workday_events
  set corrected_at = now(), corrected_by = auth.uid(), correction_reason = v_reason
  where workday_id = v_wd.id;

  perform app.log_security_event(
    'workday_corrected',
    auth.uid(),
    p_supervisor_id,
    jsonb_build_object(
      'action', 'record_workday',
      'workday_id', v_wd.id,
      'work_date', p_work_date,
      'started_at', p_started_at,
      'ended_at', p_ended_at,
      'reason', v_reason
    )
  );

  return app.workday_snapshot(v_wd.id);
end;
$$;

comment on function public.admin_record_workday(uuid, date, timestamptz, text, timestamptz) is
  'Registra la jornada de un coordinador que se olvidó de iniciarla (CJ-32). O, A con manage_attendance. p_ended_at nulo solo si la jornada es de hoy (queda abierta). La jornada queda marcada como corrected. REASON_REQUIRED, TIME_REQUIRED, SUPERVISOR_ROLE_REQUIRED, DATE_IN_FUTURE, AT_OUT_OF_RANGE (dentro del día y no futuras), INVALID_TIME_RANGE, ENDED_AT_REQUIRED (jornada de un día anterior sin fin), WORKDAY_ALREADY_EXISTS (una jornada por día, CJ-30). Registra workday_corrected. Devuelve el estado de la jornada.';

-- 6.4 set_supervisor_priority / remove_supervisor_priority (CJ-03, CJ-24)
create function public.set_supervisor_priority(
  p_supervisor_id uuid,
  p_client_id uuid default null,
  p_site_id uuid default null
)
returns public.supervisor_priorities
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_priority public.supervisor_priorities;
begin
  perform app.require_capability('manage_supervisions');

  if (p_client_id is null) = (p_site_id is null) then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá un cliente o una sede, no las dos cosas.',
      hint = 'INVALID_PRIORITY_TARGET';
  end if;

  if not exists (
    select 1
    from public.profiles p
    join public.employees e on e.profile_id = p.id
    join public.user_roles ur on ur.profile_id = p.id and ur.role = 'supervisor'
    where p.id = p_supervisor_id
      and p.is_active
      and p.deleted_at is null
      and e.status = 'active'
      and e.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Ese coordinador no tiene el rol vigente o no está activo.',
      hint = 'SUPERVISOR_ROLE_REQUIRED';
  end if;

  if p_client_id is not null and not exists (
    select 1 from public.clients c where c.id = p_client_id and c.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese cliente.',
      hint = 'CLIENT_NOT_FOUND';
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_site_id and s.deleted_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa sede.',
      hint = 'SITE_NOT_FOUND';
  end if;

  begin
    insert into public.supervisor_priorities (supervisor_id, client_id, site_id, created_by)
    values (p_supervisor_id, p_client_id, p_site_id, auth.uid())
    returning * into v_priority;
  exception
    when unique_violation then
      raise exception using
        errcode = 'P0001',
        message = 'Ese coordinador ya tiene esa prioridad.',
        hint = 'PRIORITY_ALREADY_EXISTS';
  end;

  return v_priority;
end;
$$;

comment on function public.set_supervisor_priority(uuid, uuid, uuid) is
  'Agrega un cliente o una sede preferencial a un coordinador (CJ-03, CJ-24). O, A con manage_supervisions. Exactamente uno de p_client_id / p_site_id. INVALID_PRIORITY_TARGET, SUPERVISOR_ROLE_REQUIRED, CLIENT_NOT_FOUND, SITE_NOT_FOUND, PRIORITY_ALREADY_EXISTS (unicidad parcial entre las vigentes). Devuelve la fila.';

create function public.remove_supervisor_priority(p_priority_id uuid)
returns public.supervisor_priorities
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_priority public.supervisor_priorities;
begin
  perform app.require_capability('manage_supervisions');

  select * into v_priority from public.supervisor_priorities where id = p_priority_id for update;

  if v_priority.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos esa prioridad.',
      hint = 'PRIORITY_NOT_FOUND';
  end if;

  if v_priority.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Esa prioridad ya estaba dada de baja.',
      hint = 'PRIORITY_ALREADY_REMOVED';
  end if;

  update public.supervisor_priorities
  set removed_at = now(), removed_by = auth.uid()
  where id = p_priority_id
  returning * into v_priority;

  return v_priority;
end;
$$;

comment on function public.remove_supervisor_priority(uuid) is
  'Da de baja una prioridad (removed_at / removed_by; sin borrado físico, P-014). O, A con manage_supervisions. PRIORITY_NOT_FOUND, PRIORITY_ALREADY_REMOVED. Devuelve la fila.';

-- ---------------------------------------------------------------------------------------------
-- 7. Cierre automático (CJ-31, ADR-019)
-- ---------------------------------------------------------------------------------------------

-- Cierra a las 23:55 (hora de Argentina) las jornadas abiertas (con la pausa que estuviera abierta,
-- que termina en el propio evento de fin) y las marca auto_closed. Si había una supervisión
-- abierta, registra su fin y la deja «Sin cerrar» (in_progress con fin registrado). Cada cierre
-- queda en security_events (workday_auto_closed): es el aviso a la administración. También cierra
-- las jornadas de días anteriores que hubieran quedado abiertas (por ejemplo, si la tarea no
-- corrió). p_now existe para las pruebas; la tarea de pg_cron lo llama sin argumentos.
create function app.auto_close_workdays(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_today date := (p_now at time zone 'America/Argentina/Buenos_Aires')::date;
  v_wd public.supervisor_workdays;
  v_close timestamptz;
  v_last timestamptz;
  v_sv record;
  v_unclosed uuid[];
  v_count integer := 0;
begin
  for v_wd in
    select w.*
    from public.supervisor_workdays w
    where w.ended_at is null
      and (
        w.work_date < v_today
        or (w.work_date = v_today and p_now >= app.local_ts(w.work_date, time '23:55'))
      )
    order by w.work_date, w.id
    for update
  loop
    select max(e.recorded_at) into v_last
    from public.supervisor_workday_events e
    where e.workday_id = v_wd.id and e.removed_at is null;

    -- 23:55, o el último evento si fue posterior; nunca pasa la medianoche (ADR-019, CJ-15).
    v_close := least(
      greatest(app.local_ts(v_wd.work_date, time '23:55'), coalesce(v_last, v_wd.started_at)),
      app.local_ts(v_wd.work_date + 1, time '00:00') - interval '1 second'
    );

    v_unclosed := array[]::uuid[];

    for v_sv in
      select sv.id
      from public.supervisions sv
      where sv.workday_id = v_wd.id
        and sv.status = 'in_progress'
        and not exists (
          select 1 from public.supervision_attendance sa
          where sa.supervision_id = sv.id and sa.kind = 'check_out'
        )
      order by sv.created_at
    loop
      -- Sin posición: queda «Sin validar / sin ubicación» (valores por defecto de la tabla).
      insert into public.supervision_attendance (supervision_id, kind, recorded_at)
      values (v_sv.id, 'check_out', v_close);

      perform app.add_workday_event(
        v_wd.id, 'supervision_end', v_close, null, null, null, 'Cierre automático', v_sv.id
      );

      v_unclosed := array_append(v_unclosed, v_sv.id);
    end loop;

    perform app.add_workday_event(v_wd.id, 'end', v_close, null, null, null, 'Cierre automático');

    update public.supervisor_workdays
    set ended_at = v_close, auto_closed = true
    where id = v_wd.id;

    perform app.log_security_event(
      'workday_auto_closed',
      null,
      v_wd.supervisor_id,
      jsonb_build_object(
        'workday_id', v_wd.id,
        'work_date', v_wd.work_date,
        'closed_at', v_close,
        'unclosed_supervisions', to_jsonb(v_unclosed)
      )
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function app.auto_close_workdays(timestamptz) is
  'Cierre automático de jornadas (0063, CJ-31): a las 23:55 de Argentina cierra las jornadas abiertas, con su pausa abierta, y las marca auto_closed. Si había una supervisión abierta registra su fin y la deja «Sin cerrar» (in_progress con fin). Registra workday_auto_closed en security_events (aviso a la administración). Devuelve cuántas cerró. La programa pg_cron a las 02:55 UTC; p_now existe para las pruebas.';

revoke execute on function app.auto_close_workdays(timestamptz) from public, anon, authenticated;

-- Programación con pg_cron. 23:55 de Argentina (UTC-3, sin horario de verano) = 02:55 UTC. pg_cron
-- corre en UTC. Si la extensión no se puede habilitar con este rol, la migración no falla: avisa y
-- la tarea se programa a mano (docs/database.md).
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise warning 'P24.1: no se pudo habilitar pg_cron (%). Habilitala desde el panel y programá la tarea (docs/database.md).', sqlerrm;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('auto-close-workdays', '55 2 * * *', 'select app.auto_close_workdays()');
  else
    raise warning 'P24.1: pg_cron no está habilitada: el cierre automático de jornadas NO quedó programado.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 8. Vistas
-- ---------------------------------------------------------------------------------------------

-- 8.1 v_supervisor_today (CJ-02, CJ-04, CJ-25): los turnos de hoy de todos los clientes y sedes,
--     con la prioridad del coordinador, quién los supervisa y su estado. El coordinador no tiene
--     acceso por RLS a los turnos que no supervisa, así que la lectura pasa por una función de
--     definidor que corta con el rol (mismo recurso que app.people_basic, 0030).
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
  my_supervision_status public.supervision_status
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
    mine.status
  from public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
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
  'Turnos de hoy de todos los clientes y sedes para el coordinador (0063, CJ-02, CJ-25). Definidor: devuelve filas solo si la sesión tiene el rol supervisor. Interna: la lee v_supervisor_today.';

revoke execute on function app.supervisor_today() from public, anon;
grant execute on function app.supervisor_today() to authenticated, service_role;

create view public.v_supervisor_today
with (security_invoker = true)
as
select * from app.supervisor_today();

comment on view public.v_supervisor_today is
  'Pantalla Hoy del coordinador (SUP-02, SUP-03; 0063, CJ-02, CJ-04, CJ-25): todos los turnos de hoy no cancelados. priority_kind (site | client | null) / is_priority: la prioridad del coordinador (CJ-03, CJ-24). display_state: in_progress | pending | finished (según el estado del turno). assigned_employees: [{ assignment_id, employee_id, first_name, last_name, status, check_in_at, check_out_at }]. supervisors: quién lo supervisa o ya lo supervisó, sin las canceladas: [{ supervision_id, supervisor_id, first_name, last_name, status, check_in_at, check_out_at, is_me }]. my_supervision_id / my_supervision_status: la supervisión propia no cancelada. Solo trae filas para el rol supervisor.';

revoke all on public.v_supervisor_today from public, anon, authenticated;
grant select on public.v_supervisor_today to authenticated;

-- 8.2 v_supervisor_status (CJ-22, CJ-33): el estado de cada coordinador hoy. Solo administración.
create view public.v_supervisor_status
with (security_invoker = true)
as
select
  p.id as supervisor_id,
  p.first_name,
  p.last_name,
  p.avatar_path,
  wd.id as workday_id,
  app.today() as work_date,
  case
    when wd.id is null then 'not_started'
    when st.state = 'ended' then 'finished'
    when st.state = 'paused' then 'paused'
    when os.id is not null then 'supervising'
    else 'in_activity'
  end as status,
  wd.started_at,
  wd.ended_at,
  case when wd.id is null then 0 else app.workday_minutes(wd.id) end as worked_minutes,
  coalesce(wd.auto_closed, false) as auto_closed,
  coalesce(wd.corrected, false) as corrected,
  le.id as last_event_id,
  le.kind as last_event_kind,
  le.recorded_at as last_event_at,
  (select pos.o_latitude from app.workday_event_position(le.id) pos)::numeric(9, 6) as latitude,
  (select pos.o_longitude from app.workday_event_position(le.id) pos)::numeric(9, 6) as longitude,
  (select pos.o_accuracy_m from app.workday_event_position(le.id) pos)::numeric(7, 1) as accuracy_m,
  case when st.state = 'paused' then lm.reason end as pause_reason,
  os.id as supervision_id,
  os.client_id,
  os.client_legal_name,
  os.site_id,
  os.site_name,
  exists (
    select 1 from public.employee_leaves el
    where el.employee_id = p.id
      and el.deleted_at is null
      and el.starts_on <= app.today()
      and (el.ends_on is null or el.ends_on >= app.today())
  ) as on_leave
from public.profiles p
join public.employees em on em.profile_id = p.id
left join lateral (
  select w.* from public.supervisor_workdays w
  where w.supervisor_id = p.id and w.work_date = app.today()
) wd on true
left join lateral (select app.workday_state(wd.id) as state) st on wd.id is not null
left join lateral (
  select e.id, e.kind, e.recorded_at
  from public.supervisor_workday_events e
  where e.workday_id = wd.id and e.removed_at is null
  order by e.recorded_at desc, e.seq desc
  limit 1
) le on wd.id is not null
left join lateral (
  select e.reason
  from public.supervisor_workday_events e
  where e.workday_id = wd.id
    and e.removed_at is null
    and e.kind in ('start', 'pause', 'resume', 'end', 'reopen')
  order by e.recorded_at desc, e.seq desc
  limit 1
) lm on wd.id is not null
left join lateral (
  select sv.id, sh.client_id, cl.legal_name as client_legal_name, sh.site_id, si.name as site_name
  from public.supervisions sv
  join public.shifts sh on sh.id = sv.shift_id
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  where sv.workday_id = wd.id
    and sv.id = app.open_supervision_id(wd.id)
) os on wd.id is not null
where app.is_admin()
  and p.is_active
  and p.deleted_at is null
  and em.status = 'active'
  and em.deleted_at is null
  and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'supervisor');

comment on view public.v_supervisor_status is
  'Estado de cada coordinador activo hoy, para el mapa del Resumen y Asistencia de hoy (0063, CJ-22, CJ-33). status: in_activity (jornada iniciada, entre sedes) | supervising (con supervision_id, cliente y sede) | paused (con pause_reason, si lo cargó) | finished | not_started. latitude / longitude / accuracy_m: posición del último evento (nula si el evento no la trae: «Sin ubicación»; solo la leen dueño y administradores por app.workday_event_position). worked_minutes: horas netas de hoy. auto_closed / corrected: constancias de CJ-31 y CJ-32. on_leave: licencia vigente hoy. Solo trae filas para dueño y administradores.';

revoke all on public.v_supervisor_status from public, anon, authenticated;
grant select on public.v_supervisor_status to authenticated;

-- 8.3 v_supervisor_workdays_admin y v_my_workdays: las jornadas con sus minutos, sus pausas, sus
--     supervisiones y sus eventos (sin coordenadas). La primera, para administración; la segunda,
--     para el coordinador (solo las propias).
create view public.v_supervisor_workdays_admin
with (security_invoker = true)
as
select
  w.id,
  w.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  w.work_date,
  w.started_at,
  w.ended_at,
  app.workday_state(w.id) as state,
  app.workday_minutes(w.id) as worked_minutes,
  greatest(
    app.minutes_between(w.started_at, coalesce(w.ended_at, now())) - app.workday_minutes(w.id),
    0
  ) as pause_minutes,
  w.auto_closed,
  (w.auto_closed and not w.corrected) as auto_close_warning,
  w.corrected,
  app.workday_pauses(w.id) as pauses,
  app.workday_supervisions(w.id) as supervisions,
  (select count(*) from public.supervisions sv where sv.workday_id = w.id and sv.status <> 'cancelled') as supervisions_count,
  app.workday_events_json(w.id) as events,
  w.created_at,
  w.updated_at
from public.supervisor_workdays w
join public.profiles p on p.id = w.supervisor_id
where app.is_admin();

comment on view public.v_supervisor_workdays_admin is
  'Jornadas de los coordinadores para la ficha, las correcciones y los informes (0063, CJ-13, CJ-19, CJ-32). state: running | paused | ended. worked_minutes: neto (inicio a fin menos pausas; las supervisiones no suman, CJ-14). pause_minutes: bruto menos neto. auto_closed: constancia del cierre automático (CJ-31); auto_close_warning: auto_closed y todavía sin corregir. pauses: [{ type (pause | reopened), pause_event_id, resume_event_id, starts_at, ends_at, minutes, reason, corrected }]. supervisions: [{ supervision_id, shift_id, client_id, client_legal_name, site_id, site_name, status, check_in_at, check_out_at, duration_minutes (informativa), unclosed }]. events: eventos ordenados con corrected_from / correction_reason y removed, sin coordenadas. Solo trae filas para dueño y administradores.';

revoke all on public.v_supervisor_workdays_admin from public, anon, authenticated;
grant select on public.v_supervisor_workdays_admin to authenticated;

create view public.v_my_workdays
with (security_invoker = true)
as
select
  w.id,
  w.supervisor_id,
  p.first_name as supervisor_first_name,
  p.last_name as supervisor_last_name,
  w.work_date,
  w.started_at,
  w.ended_at,
  app.workday_state(w.id) as state,
  app.workday_minutes(w.id) as worked_minutes,
  greatest(
    app.minutes_between(w.started_at, coalesce(w.ended_at, now())) - app.workday_minutes(w.id),
    0
  ) as pause_minutes,
  w.auto_closed,
  (w.auto_closed and not w.corrected) as auto_close_warning,
  w.corrected,
  app.workday_pauses(w.id) as pauses,
  app.workday_supervisions(w.id) as supervisions,
  (select count(*) from public.supervisions sv where sv.workday_id = w.id and sv.status <> 'cancelled') as supervisions_count,
  app.workday_events_json(w.id) as events,
  w.created_at,
  w.updated_at
from public.supervisor_workdays w
join public.profiles p on p.id = w.supervisor_id
where w.supervisor_id = auth.uid()
  and app.has_role('supervisor');

comment on view public.v_my_workdays is
  'Jornadas del coordinador que consulta (0063; SUP-02 barra de jornada, SUP-08 historial): las mismas columnas que v_supervisor_workdays_admin pero solo las propias. La jornada de hoy es la de work_date = hoy.';

revoke all on public.v_my_workdays from public, anon, authenticated;
grant select on public.v_my_workdays to authenticated;

-- 8.4 v_supervisions_admin: ahora hay varias supervisiones por turno (CJ-05). Mismas columnas y
--     orden que 0054; las nuevas van al final: la jornada, la duración informativa (CJ-14), la
--     marca «Sin cerrar» y si la jornada se cerró sola (CJ-31).
create or replace view public.v_supervisions_admin
with (security_invoker = true)
as
SELECT sv.id,
    sv.shift_id,
    sh.shift_date,
    sh.client_id,
    cl.legal_name AS client_legal_name,
    sh.site_id,
    si.name AS site_name,
    sv.supervisor_id,
    p.first_name AS supervisor_first_name,
    p.last_name AS supervisor_last_name,
    sv.status,
    sv.assigned_by,
    sv.assigned_at,
    sv.not_done_reason,
    sv.cancel_reason,
    sv.general_notes,
    ci.recorded_at AS check_in_at,
    co.recorded_at AS check_out_at,
    COALESCE(r.ratings_count, (0)::bigint) AS ratings_count,
    r.ratings_avg,
    sv.created_at,
    sv.updated_at,
    sh.start_time,
    sh.end_time,
    sh.starts_at,
    sh.ends_at,
    sv.criteria_snapshot,
    COALESCE(emp.assigned_employees_count, (0)::bigint) AS assigned_employees_count,
        CASE
            WHEN sh.open_ended THEN NULL::integer
            ELSE app.minutes_between(sh.starts_at, sh.ends_at)
        END AS planned_minutes,
    app.minutes_between(ci.recorded_at, co.recorded_at) AS worked_minutes,
    sh.open_ended AS shift_open_ended,
    ci.id as check_in_record_id,
    ci.geo_status as check_in_geo_status,
    ci.geo_unvalidated_reason as check_in_geo_reason,
    ci.site_distance_m as check_in_distance_m,
    ci.geofence_radius_m as check_in_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('supervision', ci.id) pos)::numeric(7,1) as check_in_accuracy_m,
    ci.outside_reason as check_in_outside_reason,
    (ci.geo_override_at is not null) as check_in_geo_overridden,
    co.id as check_out_record_id,
    co.geo_status as check_out_geo_status,
    co.geo_unvalidated_reason as check_out_geo_reason,
    co.site_distance_m as check_out_distance_m,
    co.geofence_radius_m as check_out_geofence_radius_m,
    (select pos.o_accuracy_m from app.attendance_position('supervision', co.id) pos)::numeric(7,1) as check_out_accuracy_m,
    co.outside_reason as check_out_outside_reason,
    (co.geo_override_at is not null) as check_out_geo_overridden,
    sv.workday_id,
    app.minutes_between(
      ci.recorded_at,
      coalesce(co.recorded_at, case when sv.status = 'in_progress' then now() end)
    ) as duration_minutes,
    (sv.status = 'in_progress' and co.recorded_at is not null) as unclosed,
    coalesce(wd.auto_closed, false) as workday_auto_closed
   FROM (((((((((supervisions sv
     JOIN shifts sh ON ((sh.id = sv.shift_id)))
     JOIN clients cl ON ((cl.id = sh.client_id)))
     JOIN sites si ON ((si.id = sh.site_id)))
     JOIN profiles p ON ((p.id = sv.supervisor_id)))
     LEFT JOIN supervision_attendance ci ON (((ci.supervision_id = sv.id) AND (ci.kind = 'check_in'::attendance_kind))))
     LEFT JOIN supervision_attendance co ON (((co.supervision_id = sv.id) AND (co.kind = 'check_out'::attendance_kind))))
     LEFT JOIN supervisor_workdays wd ON ((wd.id = sv.workday_id)))
     LEFT JOIN LATERAL ( SELECT count(*) AS ratings_count,
            (avg(rt.score))::numeric(3,2) AS ratings_avg
           FROM ratings rt
          WHERE (rt.supervision_id = sv.id)) r ON (true))
     LEFT JOIN LATERAL ( SELECT count(*) AS assigned_employees_count
           FROM assignments a
          WHERE ((a.shift_id = sv.shift_id) AND (a.removed_at IS NULL))) emp ON (true));

comment on view public.v_supervisions_admin is
  'Consulta administrativa de supervisiones (RB-A09, 04 sección 4, P-088). Desde 0063 (P24.1) un turno puede tener varias filas (CJ-05, un coordinador cada una). ratings_count / ratings_avg: cantidad y promedio simple de esa supervisión. start_time / end_time / starts_at / ends_at: franja del turno. criteria_snapshot: criterios vigentes al iniciar. assigned_employees_count: empleados asignados vigentes del turno. worked_minutes y duration_minutes son INFORMATIVAS (CJ-14): no suman horas; las horas del coordinador son las de su jornada (v_supervisor_workdays_admin). duration_minutes cuenta hasta ahora si la supervisión sigue abierta. workday_id: la jornada. unclosed: «Sin cerrar» (in_progress con fin registrado por el cierre automático, CJ-31). workday_auto_closed: la jornada se cerró sola. assigned_by / assigned_at: historial de la asignación manual anterior (CJ-01). Las columnas *_accuracy_m salen de app.attendance_position (0054): solo dueño y administradores ven la precisión. security_invoker: visibilidad de filas por RLS (en la práctica solo O/A ven filas).';

-- ---------------------------------------------------------------------------------------------
-- 9. Grants de las RPC y revocación de la asignación manual
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.start_workday(numeric, numeric, numeric) from public, anon;
revoke execute on function public.pause_workday(text, numeric, numeric, numeric) from public, anon;
revoke execute on function public.resume_workday(numeric, numeric, numeric) from public, anon;
revoke execute on function public.end_workday(numeric, numeric, numeric) from public, anon;
revoke execute on function public.reopen_workday(numeric, numeric, numeric) from public, anon;
revoke execute on function public.take_supervision(uuid, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.discard_supervision(uuid) from public, anon;
revoke execute on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text) from public, anon;
revoke execute on function public.rate_employee(uuid, uuid, integer, text) from public, anon;
revoke execute on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean) from public, anon;
revoke execute on function public.admin_add_workday_pause(uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke execute on function public.admin_record_workday(uuid, date, timestamptz, text, timestamptz) from public, anon;
revoke execute on function public.set_supervisor_priority(uuid, uuid, uuid) from public, anon;
revoke execute on function public.remove_supervisor_priority(uuid) from public, anon;

grant execute on function public.start_workday(numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.pause_workday(text, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.resume_workday(numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.end_workday(numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.reopen_workday(numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.take_supervision(uuid, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.discard_supervision(uuid) to authenticated, service_role;
grant execute on function public.complete_supervision(uuid, text, numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.rate_employee(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.admin_correct_workday_event(uuid, text, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.admin_add_workday_pause(uuid, timestamptz, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.admin_record_workday(uuid, date, timestamptz, text, timestamptz) to authenticated, service_role;
grant execute on function public.set_supervisor_priority(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.remove_supervisor_priority(uuid) to authenticated, service_role;

-- CJ-01 y CJ-26: desaparece la asignación manual y el estado «no realizada» deja de usarse. Las
-- funciones quedan (el historial y los valores de la enumeración no se tocan), pero nadie las
-- llama. supervision_check_in y supervision_check_out también (ver la nota del principio).
revoke execute on function public.assign_supervision(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_supervision_not_done(uuid, text) from public, anon, authenticated;
revoke execute on function public.supervision_check_in(uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke execute on function public.supervision_check_out(uuid, numeric, numeric, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. Datos (CJ-23)
-- ---------------------------------------------------------------------------------------------

-- Las supervisiones asignadas que no empezaron se cancelan (los dueños usaban este período como
-- prueba). Las completadas y las en curso quedan como historial. Nada se borra (P-014).
update public.supervisions
set status = 'cancelled',
    cancel_reason = 'Cambio de lógica de coordinación (23 oct 2026)'
where status = 'assigned';
