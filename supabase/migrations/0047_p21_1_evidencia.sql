-- 0047 (P21.1, módulo H · evidencia fotográfica): base de datos.
--
-- Especificación: Docs/Plan_Maestro/modulos/H_evidencia_fotografica.md (decisiones H-01 a H-18,
-- acordadas con Mike el 13 oct 2026). Fotos y videos GENERALES DEL TURNO, subidos por el empleado
-- asignado o por el supervisor de una supervisión de ese turno.
--
--   1. Enumeración media_kind y bucket privado `evidence` (20 MB; jpeg, mp4, webm).
--   2. Tabla shift_media (RLS: el autor ve lo suyo, dueño y administradores ven todo; sin
--      políticas de insert/update/delete: se escribe solo por las RPC) y vista v_shift_media.
--   3. services.requires_photos / shifts.requires_photos (H-07) y su herencia: generate_shifts,
--      create_shift (y create_shift_core / create_shift_series) y edición en update_shift_details.
--   4. company_settings.photo_retention_days / video_retention_days (H-08, H-17) y set_media_retention.
--   5. RPC begin_shift_media, confirm_shift_media, remove_shift_media, set_shift_media_keep y
--      storage_usage; RPC internas del barrido nocturno (solo service_role).
--   6. Políticas de Storage del bucket `evidence`.
--   7. v_my_day y v_my_supervisions con requires_photos y la cantidad de medios propios.
--   8. delete_service: un servicio con fotos o videos subidos tampoco se puede eliminar.
--
-- Nada se borra físicamente (P-014): lo que se borra es el archivo de Storage; la fila queda como
-- constancia. Ruta de los archivos: {shift_id}/{media_id}.{jpg|mp4|webm} y
-- {shift_id}/{media_id}_thumb.jpg.

-- ---------------------------------------------------------------------------------------------
-- 1. Enumeración y bucket
-- ---------------------------------------------------------------------------------------------

create type public.media_kind as enum ('photo', 'video');

comment on type public.media_kind is 'Tipo de evidencia de un turno (0047, módulo H): foto o video.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 20971520, array['image/jpeg', 'video/mp4', 'video/webm'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- 2. Columnas nuevas: pide fotos y plazos de vencimiento
-- ---------------------------------------------------------------------------------------------

alter table public.services add column requires_photos boolean not null default false;
alter table public.shifts add column requires_photos boolean not null default false;

comment on column public.services.requires_photos is
  'El servicio pide fotos (0047, H-07). Los turnos que se generan lo heredan en shifts.requires_photos. Al finalizar sin fotos propias, la app advierte y deja seguir.';
comment on column public.shifts.requires_photos is
  'El turno pide fotos (0047, H-07): copiado de services.requires_photos al generar o crear el turno, editable con update_shift_details. Cambiar el servicio no toca los turnos ya generados.';

alter table public.company_settings
  add column photo_retention_days smallint not null default 60,
  add column video_retention_days smallint not null default 30,
  add constraint company_settings_photo_retention_check check (photo_retention_days between 7 and 365),
  add constraint company_settings_video_retention_check check (video_retention_days between 7 and 365);

comment on column public.company_settings.photo_retention_days is
  'Días que se conservan las fotos de los turnos antes del borrado nocturno (0047, H-08, H-17). 7 a 365, por defecto 60. Un plazo nuevo se aplica también a lo ya guardado.';
comment on column public.company_settings.video_retention_days is
  'Días que se conservan los videos de los turnos antes del borrado nocturno (0047, H-08, H-17). 7 a 365, por defecto 30.';

-- ---------------------------------------------------------------------------------------------
-- 3. shift_media
-- ---------------------------------------------------------------------------------------------

create table public.shift_media (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  assignment_id uuid references public.assignments (id),
  supervision_id uuid references public.supervisions (id),
  uploaded_by uuid not null references public.profiles (id),
  kind public.media_kind not null,
  storage_path text not null,
  thumb_path text not null,
  size_bytes bigint not null,
  width integer,
  height integer,
  duration_s numeric(6, 1),
  captured_at timestamptz,
  confirmed_at timestamptz,
  keep boolean not null default false,
  kept_by uuid references public.profiles (id),
  kept_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint shift_media_author_check check (num_nonnulls(assignment_id, supervision_id) = 1),
  constraint shift_media_size_check check (size_bytes > 0),
  constraint shift_media_dimensions_check check (
    (width is null or width > 0) and (height is null or height > 0) and (duration_s is null or duration_s >= 0)
  ),
  constraint shift_media_storage_path_key unique (storage_path),
  constraint shift_media_thumb_path_key unique (thumb_path)
);

comment on table public.shift_media is
  'Fotos y videos generales de un turno (0047, módulo H). Una fila pendiente (confirmed_at null) nace en begin_shift_media y habilita escribir en sus dos rutas de Storage; confirm_shift_media la confirma. assignment_id o supervision_id (uno solo) dicen con qué relación subió el autor (H-02). Nada se borra físicamente (P-014): remove_shift_media (H-15) marca removed_at y el borrado nocturno borra el archivo y marca expired_at (momento en que el archivo dejó de existir: por vencimiento, por haber sido quitado o por ser una subida pendiente abandonada de más de 24 h). keep = «Conservar»: no vence (H-08).';
comment on column public.shift_media.storage_path is 'Ruta en el bucket evidence: {shift_id}/{media_id}.{jpg|mp4|webm}.';
comment on column public.shift_media.thumb_path is 'Ruta de la miniatura en el bucket evidence: {shift_id}/{media_id}_thumb.jpg (H-16).';
comment on column public.shift_media.size_bytes is 'Archivo más miniatura, en bytes. Lo declara begin_shift_media y confirm_shift_media lo reemplaza por el tamaño real guardado en Storage.';
comment on column public.shift_media.captured_at is 'Fecha del archivo si el celular la conoce (se toma antes de quitar los metadatos EXIF).';
comment on column public.shift_media.confirmed_at is 'Null = subida pendiente (todavía no se confirmó). No figura en la especificación del módulo: hace falta para distinguir pendientes (H, §2).';
comment on column public.shift_media.removed_at is 'El autor la quitó (H-15) o el sistema descartó una subida pendiente abandonada. removed_by es null en el segundo caso.';
comment on column public.shift_media.expired_at is 'Momento en que se borró el archivo de Storage (vencimiento, quitada o pendiente abandonada). La fila queda como constancia.';

alter table public.shift_media enable row level security;

create trigger trg_set_updated_at
before update on public.shift_media
for each row execute function app.set_updated_at();

create index shift_media_shift_id_idx on public.shift_media (shift_id);
create index shift_media_uploaded_by_shift_id_idx on public.shift_media (uploaded_by, shift_id);
create index shift_media_assignment_id_idx on public.shift_media (assignment_id) where assignment_id is not null;
create index shift_media_supervision_id_idx on public.shift_media (supervision_id) where supervision_id is not null;
-- Barrido nocturno: pendientes viejas y vencimiento por tipo.
create index shift_media_pending_idx on public.shift_media (created_at) where confirmed_at is null and expired_at is null;
create index shift_media_cleanup_idx on public.shift_media (kind, created_at)
  where confirmed_at is not null and removed_at is null and keep = false and expired_at is null;

-- RLS (H-03): el autor ve lo suyo; dueño y administradores ven todo. Sin políticas de insert,
-- update ni delete: las filas solo las escriben las RPC (security definer).
create policy shift_media_select_admin
  on public.shift_media for select to authenticated
  using (app.is_admin());

create policy shift_media_select_author
  on public.shift_media for select to authenticated
  using (uploaded_by = app.current_uid());

grant select on public.shift_media to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Políticas de Storage del bucket evidence
-- ---------------------------------------------------------------------------------------------

-- Lectura: el autor de la fila y dueño y administradores. El bucket es privado: el front pide
-- URL firmadas de vida corta (que se firman con la sesión del que pide, por eso necesitan esto).
create policy evidence_select_admin
  on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and (select app.is_admin()));

create policy evidence_select_author
  on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and exists (
      select 1 from public.shift_media m
      where m.uploaded_by = (select app.current_uid())
        and name in (m.storage_path, m.thumb_path)
    )
  );

-- Escritura: solo en las rutas de una fila PENDIENTE propia (creada por begin_shift_media, que ya
-- validó rol, relación, ventana, topes y sede). No hay política de update: no se puede pisar nada.
create policy evidence_insert_pending_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and exists (
      select 1 from public.shift_media m
      where m.uploaded_by = (select app.current_uid())
        and m.confirmed_at is null
        and m.removed_at is null
        and name in (m.storage_path, m.thumb_path)
    )
  );

-- Borrado: solo el autor y solo de una fila que ya quitó con remove_shift_media (H-15), para que
-- el archivo desaparezca en el momento. Si el celular no llega, el barrido nocturno lo borra igual.
create policy evidence_delete_removed_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'evidence'
    and exists (
      select 1 from public.shift_media m
      where m.uploaded_by = (select app.current_uid())
        and m.removed_at is not null
        and name in (m.storage_path, m.thumb_path)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- 5. Herencia y edición de requires_photos en las RPC de turnos
-- ---------------------------------------------------------------------------------------------

-- generate_shifts: versión de 0044 más la herencia de requires_photos (H-07). Conserva los
-- permisos (create or replace) y todo lo de 0037, 0040, 0041 (empleados fijos) y 0044 (semanas del mes).

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
      required_staff, status, generated, requires_photos, created_by
    ) values (
      v_rec.service_id, v_rec.client_id, v_rec.site_id, v_rec.shift_date,
      v_rec.start_time, v_rec.end_time, v_rec.open_ended, v_rec.required_staff, 'scheduled', true, v_rec.requires_photos, auth.uid()
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
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta days_of_week, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente. O, A + generate_shifts. Los turnos de un servicio «A terminar» nacen «A terminar» (0037). Desde 0041 (AJ2-17) cada turno recién creado asigna a los empleados fijos del servicio (service_fixed_employees) con app.assign_employee_core en modo estricto: lo que no se puede asignar NO frena la generación, se saltea y se informa. Devuelve {"created", "skipped", "holidays_skipped", "assigned" (asignaciones hechas), "unassigned" [{shift_id, shift_date, service_id, employee_id, employee_name, code, message}] con code ON_LEAVE, OUTSIDE_AVAILABILITY, ASSIGNMENT_OVERLAP, EMPLOYEE_NOT_ACTIVE, SHIFT_FULL..., "past_without_fixed" (turnos creados que ya habían empezado y por eso no reciben fijos)}. Desde 0044 (AJ3-05) solo crea el turno de una fecha si, además del día de la semana, cumple services.weeks_of_month (null = todas las semanas) con app.date_matches_weeks_of_month. Desde 0047 (H-07) cada turno creado hereda services.requires_photos.';

drop function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid);

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

comment on function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid, boolean) is
  'Cuerpo de public.create_shift (0041) sin el control de rol, con p_series_id (0046) y p_requires_photos (0047, H-07: null = hereda del servicio, o false si es un turno suelto). Lo llaman create_shift y create_shift_series, que ya validaron quién es el que llama. Mismas validaciones, errores y retorno que create_shift.';

revoke execute on function app.create_shift_core(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], uuid, boolean) from public, anon, authenticated;

drop function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[]);

create function public.create_shift(
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
  p_requires_photos boolean default null
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
    p_notes, p_open_ended, p_show_in_print, p_employee_ids, null, p_requires_photos
  );
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], boolean) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. Mismas validaciones y retorno que en 0046 (CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE, INVALID_TIME_RANGE; {"shift", "warnings", "assigned", "rejected"}). Desde 0047 (H-07) p_requires_photos: null = hereda services.requires_photos del servicio (o false si es un turno suelto); true o false lo fijan.';

revoke execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], boolean) from public, anon;
grant execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text, boolean, boolean, uuid[], boolean) to authenticated;

drop function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[]);

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
  p_employee_ids uuid[] default null,
  p_requires_photos boolean default false
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
        p_notes, p_open_ended, p_show_in_print, p_employee_ids, v_series_id, coalesce(p_requires_photos, false)
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

comment on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean) is
  'Repite un turno suelto (0046, AJ3-08). O, A (igual que create_shift). Crea un turno por cada fecha entre p_from y p_to (hasta <= desde + 3 meses) que cae en p_weekdays y en p_weeks_of_month (null = todas; 1 a 4 y 5 = última, como services). Si p_works_on_holidays es false, las fechas feriadas se saltean y se informan. Cada turno es independiente y comparte shifts.series_id; copia el checklist y asigna a p_employee_ids como create_shift. Todo en una transacción: si el turno de una fecha falla por una validación (INVALID_TIME_RANGE, CLIENT_NOT_ACTIVE, SITE_NOT_ACTIVE...) falla todo y el mensaje indica la fecha; las asignaciones rechazadas no frenan y se informan por fecha. Errores propios: SERIES_RANGE_INVALID, SERIES_RANGE_TOO_LONG, SERIES_EMPTY, INVALID_WEEKDAYS, INVALID_WEEKS_OF_MONTH. Desde 0047 (H-07) p_requires_photos (por defecto false) marca todos los turnos creados. Devuelve {"series_id", "created": [{shift_id, shift_date, warnings, assigned, rejected}], "holidays_skipped": [fechas]}.';

revoke execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean) from public, anon;
grant execute on function public.create_shift_series(uuid, uuid, time, time, smallint, date, date, smallint[], smallint[], boolean, text, boolean, boolean, uuid[], boolean) to authenticated;

drop function public.update_shift_details(uuid, smallint, text, boolean);

create function public.update_shift_details(p_shift_id uuid, p_required_staff smallint, p_notes text default null, p_show_in_print boolean default null, p_requires_photos boolean default null)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_assigned_count int;
begin
  perform app.require_role('owner', 'admin');

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

  if p_required_staff < 1 or p_required_staff > 10 then
    raise exception using
      errcode = 'P0001',
      message = 'La dotación tiene que ser entre 1 y 10 personas.',
      hint = 'REQUIRED_STAFF_RANGE';
  end if;

  select count(*) into v_assigned_count
  from public.assignments a
  where a.shift_id = p_shift_id and a.removed_at is null;

  if p_required_staff < v_assigned_count then
    raise exception using
      errcode = 'P0001',
      message = 'No podés bajar la dotación por debajo de la cantidad de personas ya asignadas.',
      hint = 'REQUIRED_STAFF_BELOW_ASSIGNED';
  end if;

  update public.shifts
  set
    required_staff = p_required_staff,
    requires_photos = coalesce(p_requires_photos, requires_photos),
    status = case
      when status = 'scheduled' and v_assigned_count >= p_required_staff then 'assigned'
      when status = 'assigned' and v_assigned_count < p_required_staff then 'scheduled'
      else status
    end,
    updated_by = auth.uid()
  where id = p_shift_id
  returning * into v_shift;

  -- La observación se guarda aparte. p_notes siempre reemplaza (como antes con shifts.notes);
  -- p_show_in_print null = no cambia (si no había fila, nace tildada).
  if nullif(btrim(p_notes), '') is not null
     or p_show_in_print is not null
     or exists (select 1 from public.shift_observations o where o.shift_id = p_shift_id) then
    insert into public.shift_observations (shift_id, observation, show_in_print, created_by, updated_by)
    values (p_shift_id, nullif(btrim(p_notes), ''), coalesce(p_show_in_print, true), auth.uid(), auth.uid())
    on conflict (shift_id) do update
      set observation = excluded.observation,
          show_in_print = coalesce(p_show_in_print, public.shift_observations.show_in_print),
          updated_by = auth.uid();
  end if;

  -- La fila devuelta lleva la observación en `notes` (no se guarda en shifts) para no cambiar el contrato.
  select o.observation into v_shift.notes from public.shift_observations o where o.shift_id = p_shift_id;

  return v_shift;
end;
$$;

comment on function public.update_shift_details(uuid, smallint, text, boolean, boolean) is
  'Edita la dotación y las notas administrativas de un turno (corrige 06 sección 7, que traía "editar notas: update shifts.notes" -- 0012 no permite escritura directa de shifts, todo pasa por RPC; pendiente anotado en 12_Registro_de_Progreso.md, P10.3). O, A. SHIFT_NOT_FOUND/SHIFT_CANCELLED/SHIFT_COMPLETED, REQUIRED_STAFF_RANGE (1..10), REQUIRED_STAFF_BELOW_ASSIGNED si p_required_staff queda por debajo de los asignados vigentes. Recalcula scheduled/assigned según la nueva dotación (04 sección 6.1). Devuelve la fila de shifts. Desde 0028 (P14.2) fija updated_by = auth.uid(): esta RPC puede seguir editando notas/dotación con el turno in_progress, después de un check-in de otra persona, y no tiene que quedar atribuida a quien hizo ese check-in. Desde 0040 (AJ2-15) p_notes es la observación del turno (solo administración la ve) y p_show_in_print la casilla «mostrar en la impresión»: null = no cambia. Desde 0047 (H-07) p_requires_photos cambia la casilla «Pide fotos» del turno: null = no cambia.';


revoke execute on function public.update_shift_details(uuid, smallint, text, boolean, boolean) from public, anon;
grant execute on function public.update_shift_details(uuid, smallint, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Plazos de vencimiento (H-08, H-17)
-- ---------------------------------------------------------------------------------------------

-- company_settings ya se edita con update directo (dueño y administradores, 0017); el trigger de
-- 0030 solo restringe nombre, teléfono y consentimiento al dueño, así que los plazos los pueden
-- cambiar ambos. Esta RPC existe para devolver un error con código en vez del check de la tabla.
create function public.set_media_retention(
  p_photo_days integer default null,
  p_video_days integer default null
)
returns public.company_settings
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.company_settings;
begin
  perform app.require_role('owner', 'admin');

  if (p_photo_days is not null and p_photo_days not between 7 and 365)
    or (p_video_days is not null and p_video_days not between 7 and 365) then
    raise exception using
      errcode = 'P0001',
      message = 'Los plazos tienen que estar entre 7 y 365 días.',
      hint = 'RETENTION_OUT_OF_RANGE';
  end if;

  update public.company_settings
  set photo_retention_days = coalesce(p_photo_days, photo_retention_days),
      video_retention_days = coalesce(p_video_days, video_retention_days),
      updated_by = auth.uid()
  where id = 1
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_media_retention(integer, integer) is
  'Cambia los plazos de vencimiento de fotos y videos (0047, H-08, H-17). O, A (FORBIDDEN si no). Cada parámetro en null = no cambia. RETENTION_OUT_OF_RANGE si alguno no está entre 7 y 365. Un plazo nuevo se aplica a todo lo guardado, también a lo anterior (el vencimiento se calcula con el plazo vigente). Devuelve la fila de company_settings.';

revoke execute on function public.set_media_retention(integer, integer) from public, anon;
grant execute on function public.set_media_retention(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. RPC de evidencia
-- ---------------------------------------------------------------------------------------------

-- Tope de ventana: desde el inicio del turno hasta 2 horas después de su fin (H-12).
-- Tope por persona y por turno: 10 fotos y 2 videos (H-11). Video: hasta 30 s (H-06) y 20 MB.

create function public.begin_shift_media(
  p_shift_id uuid,
  p_kind public.media_kind,
  p_mime_type text,
  p_size_bytes bigint,
  p_thumb_size_bytes bigint,
  p_width integer default null,
  p_height integer default null,
  p_duration_s numeric default null,
  p_captured_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_shift public.shifts;
  v_site_photos_not_allowed boolean;
  v_assignment_id uuid;
  v_supervision_id uuid;
  v_count int;
  v_id uuid := gen_random_uuid();
  v_ext text;
  v_row public.shift_media;
begin
  perform app.require_role('employee', 'supervisor');

  select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;
  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  -- H-02: el empleado asignado (vigente) o el supervisor de una supervisión no cancelada.
  select a.id into v_assignment_id
  from public.assignments a
  where a.shift_id = p_shift_id and a.employee_id = v_uid and a.removed_at is null
  limit 1;

  if v_assignment_id is null then
    select sv.id into v_supervision_id
    from public.supervisions sv
    where sv.shift_id = p_shift_id and sv.supervisor_id = v_uid
      and sv.status in ('assigned', 'in_progress', 'completed')
    limit 1;
  end if;

  if v_assignment_id is null and v_supervision_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No participás de este turno.',
      hint = 'NOT_SHIFT_PARTICIPANT';
  end if;

  if v_shift.status = 'cancelled' then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno está cancelado.',
      hint = 'SHIFT_CANCELLED';
  end if;

  -- H-13: sede sin fotos (rige también para los videos).
  select s.photos_not_allowed into v_site_photos_not_allowed from public.sites s where s.id = v_shift.site_id;
  if coalesce(v_site_photos_not_allowed, false) then
    raise exception using
      errcode = 'P0001',
      message = 'En esta sede no se permiten fotos ni videos.',
      hint = 'PHOTOS_NOT_ALLOWED';
  end if;

  -- H-12: ventana de subida.
  if now() < v_shift.starts_at then
    raise exception using
      errcode = 'P0001',
      message = 'Todavía no podés subir fotos o videos: el turno no empezó.',
      hint = 'MEDIA_WINDOW_NOT_OPEN';
  end if;
  if now() > v_shift.ends_at + interval '2 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'Ya pasó el plazo para subir fotos o videos de este turno (2 horas después del fin).',
      hint = 'MEDIA_WINDOW_CLOSED';
  end if;

  -- Tipo y tamaño (H-05, H-06).
  if (p_kind = 'photo' and p_mime_type is distinct from 'image/jpeg')
    or (p_kind = 'video' and p_mime_type not in ('video/mp4', 'video/webm'))
    or p_mime_type is null then
    raise exception using
      errcode = 'P0001',
      message = 'El formato del archivo no es válido (fotos en JPEG, videos en MP4 o WebM).',
      hint = 'MEDIA_INVALID_TYPE';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 or p_thumb_size_bytes is null or p_thumb_size_bytes <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'El tamaño del archivo no es válido.',
      hint = 'MEDIA_INVALID_SIZE';
  end if;

  if p_size_bytes > 20971520 or p_thumb_size_bytes > 20971520 then
    raise exception using
      errcode = 'P0001',
      message = 'El archivo pesa más de 20 MB. Tiene que ser más liviano.',
      hint = 'MEDIA_TOO_LARGE';
  end if;

  if p_kind = 'video' then
    if p_duration_s is null or p_duration_s <= 0 then
      raise exception using
        errcode = 'P0001',
        message = 'Falta la duración del video.',
        hint = 'MEDIA_INVALID_DURATION';
    end if;
    -- Hasta 30 segundos; medio segundo de tolerancia por el corte automático de la grabación.
    if p_duration_s > 30.5 then
      raise exception using
        errcode = 'P0001',
        message = 'El video dura más de 30 segundos.',
        hint = 'MEDIA_TOO_LONG';
    end if;
  end if;

  if p_width is not null and p_width <= 0 or p_height is not null and p_height <= 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Las dimensiones del archivo no son válidas.',
      hint = 'MEDIA_INVALID_SIZE';
  end if;

  -- H-11: tope por persona, turno y tipo. Cuentan las confirmadas y las pendientes de la última
  -- hora (una subida cortada no bloquea para siempre); las quitadas no cuentan. El candado evita
  -- que dos pedidos simultáneos pasen el tope.
  perform pg_advisory_xact_lock(hashtextextended(p_shift_id::text || v_uid::text, 0));

  select count(*) into v_count
  from public.shift_media m
  where m.shift_id = p_shift_id
    and m.uploaded_by = v_uid
    and m.kind = p_kind
    and m.removed_at is null
    and (m.confirmed_at is not null or m.created_at > now() - interval '1 hour');

  if p_kind = 'photo' and v_count >= 10 then
    raise exception using
      errcode = 'P0001',
      message = 'Ya subiste las 10 fotos que se permiten por turno.',
      hint = 'MEDIA_LIMIT_REACHED';
  end if;
  if p_kind = 'video' and v_count >= 2 then
    raise exception using
      errcode = 'P0001',
      message = 'Ya subiste los 2 videos que se permiten por turno.',
      hint = 'MEDIA_LIMIT_REACHED';
  end if;

  v_ext := case p_mime_type when 'image/jpeg' then 'jpg' when 'video/mp4' then 'mp4' else 'webm' end;

  insert into public.shift_media (
    id, shift_id, assignment_id, supervision_id, uploaded_by, kind, storage_path, thumb_path,
    size_bytes, width, height, duration_s, captured_at, created_by
  ) values (
    v_id, p_shift_id, v_assignment_id, v_supervision_id, v_uid, p_kind,
    p_shift_id::text || '/' || v_id::text || '.' || v_ext,
    p_shift_id::text || '/' || v_id::text || '_thumb.jpg',
    p_size_bytes + p_thumb_size_bytes, p_width, p_height,
    case when p_kind = 'video' then round(p_duration_s, 1) end,
    p_captured_at, v_uid
  )
  returning * into v_row;

  return jsonb_build_object(
    'media', to_jsonb(v_row),
    'bucket', 'evidence',
    'storage_path', v_row.storage_path,
    'thumb_path', v_row.thumb_path
  );
end;
$$;

comment on function public.begin_shift_media(uuid, public.media_kind, text, bigint, bigint, integer, integer, numeric, timestamptz) is
  'Primer paso de la subida de una foto o video del turno (0047, H-02, H-06, H-11, H-12, H-13). Roles employee y supervisor (FORBIDDEN si no). Crea la fila pendiente y devuelve {"media": <fila>, "bucket": "evidence", "storage_path", "thumb_path"}: el celular sube el archivo y la miniatura a esas dos rutas con su sesión y llama a confirm_shift_media. Errores: SHIFT_NOT_FOUND, NOT_SHIFT_PARTICIPANT (ni asignado vigente ni supervisión no cancelada), SHIFT_CANCELLED, PHOTOS_NOT_ALLOWED (la sede no permite fotos ni videos), MEDIA_WINDOW_NOT_OPEN (antes del inicio del turno), MEDIA_WINDOW_CLOSED (más de 2 horas después del fin), MEDIA_INVALID_TYPE (foto: image/jpeg; video: video/mp4 o video/webm), MEDIA_INVALID_SIZE, MEDIA_TOO_LARGE (archivo o miniatura de más de 20 MB), MEDIA_INVALID_DURATION (video sin duración), MEDIA_TOO_LONG (video de más de 30 s, con 0,5 s de tolerancia), MEDIA_LIMIT_REACHED (10 fotos o 2 videos por persona y turno). size_bytes de la fila = archivo + miniatura. La hora de la fila la pone now().';

revoke execute on function public.begin_shift_media(uuid, public.media_kind, text, bigint, bigint, integer, integer, numeric, timestamptz) from public, anon;
grant execute on function public.begin_shift_media(uuid, public.media_kind, text, bigint, bigint, integer, integer, numeric, timestamptz) to authenticated;

create function public.confirm_shift_media(p_media_id uuid)
returns public.shift_media
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shift_media;
  v_objects int;
  v_bytes bigint;
begin
  perform app.require_role('employee', 'supervisor');

  select * into v_row from public.shift_media where id = p_media_id for update;
  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese archivo.',
      hint = 'MEDIA_NOT_FOUND';
  end if;

  if v_row.uploaded_by <> v_uid then
    raise exception using
      errcode = 'P0001',
      message = 'Ese archivo no es tuyo.',
      hint = 'NOT_YOUR_MEDIA';
  end if;

  if v_row.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Ese archivo ya fue descartado. Subilo de nuevo.',
      hint = 'MEDIA_REMOVED';
  end if;

  -- Confirmar dos veces no hace nada.
  if v_row.confirmed_at is not null then
    return v_row;
  end if;

  select count(*), coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  into v_objects, v_bytes
  from storage.objects o
  where o.bucket_id = 'evidence' and o.name in (v_row.storage_path, v_row.thumb_path);

  if v_objects < 2 then
    raise exception using
      errcode = 'P0001',
      message = 'La subida no terminó: falta el archivo o la miniatura. Probá de nuevo.',
      hint = 'MEDIA_UPLOAD_INCOMPLETE';
  end if;

  update public.shift_media
  set confirmed_at = now(), size_bytes = greatest(v_bytes, 1), updated_by = v_uid
  where id = p_media_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.confirm_shift_media(uuid) is
  'Segundo paso de la subida (0047): marca la fila como terminada si el archivo y la miniatura ya están en Storage, y reemplaza size_bytes por el tamaño real. Roles employee y supervisor, solo el autor. MEDIA_NOT_FOUND, NOT_YOUR_MEDIA, MEDIA_REMOVED (la fila ya fue quitada o descartada por pendiente vieja), MEDIA_UPLOAD_INCOMPLETE (falta alguno de los dos objetos). Idempotente: confirmar una fila ya confirmada la devuelve sin cambios. Devuelve la fila de shift_media.';

revoke execute on function public.confirm_shift_media(uuid) from public, anon;
grant execute on function public.confirm_shift_media(uuid) to authenticated;

create function public.remove_shift_media(p_media_id uuid)
returns public.shift_media
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shift_media;
  v_ends_at timestamptz;
begin
  perform app.require_role('employee', 'supervisor');

  select * into v_row from public.shift_media where id = p_media_id for update;
  if v_row.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese archivo.',
      hint = 'MEDIA_NOT_FOUND';
  end if;

  if v_row.uploaded_by <> v_uid then
    raise exception using
      errcode = 'P0001',
      message = 'Ese archivo no es tuyo.',
      hint = 'NOT_YOUR_MEDIA';
  end if;

  -- Ya quitada: no hace nada.
  if v_row.removed_at is not null then
    return v_row;
  end if;

  select sh.ends_at into v_ends_at from public.shifts sh where sh.id = v_row.shift_id;
  if now() > v_ends_at + interval '2 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'Ya pasó el plazo para quitar archivos de este turno.',
      hint = 'MEDIA_WINDOW_CLOSED';
  end if;

  update public.shift_media
  set removed_at = now(), removed_by = v_uid, updated_by = v_uid
  where id = p_media_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.remove_shift_media(uuid) is
  'El autor quita lo que subió mientras la ventana de subida siga abierta (0047, H-15). Roles employee y supervisor, solo el autor. Marca removed_at/removed_by: el archivo lo borra el celular de inmediato (política de Storage evidence_delete_removed_own) o, si no llega, el barrido nocturno. MEDIA_NOT_FOUND, NOT_YOUR_MEDIA, MEDIA_WINDOW_CLOSED (pasaron más de 2 horas del fin del turno). Idempotente. Devuelve la fila de shift_media.';

revoke execute on function public.remove_shift_media(uuid) from public, anon;
grant execute on function public.remove_shift_media(uuid) to authenticated;

create function public.set_shift_media_keep(p_media_id uuid, p_keep boolean)
returns public.shift_media
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.shift_media;
begin
  perform app.require_role('owner', 'admin');

  if p_keep is null then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá si querés conservar el archivo.',
      hint = 'KEEP_REQUIRED';
  end if;

  select * into v_row from public.shift_media where id = p_media_id for update;
  if v_row.id is null or v_row.confirmed_at is null or v_row.removed_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese archivo.',
      hint = 'MEDIA_NOT_FOUND';
  end if;

  if v_row.expired_at is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Ese archivo ya venció y se borró.',
      hint = 'MEDIA_EXPIRED';
  end if;

  update public.shift_media
  set keep = p_keep,
      kept_by = case when p_keep then auth.uid() end,
      kept_at = case when p_keep then now() end,
      updated_by = auth.uid()
  where id = p_media_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_shift_media_keep(uuid, boolean) is
  '«Conservar» o dejar de conservar un archivo (0047, H-08). Solo O, A (FORBIDDEN si no). KEEP_REQUIRED (null), MEDIA_NOT_FOUND (no existe, pendiente o quitada), MEDIA_EXPIRED (el archivo ya se borró). Lo conservado no vence. Devuelve la fila de shift_media.';

revoke execute on function public.set_shift_media_keep(uuid, boolean) from public, anon;
grant execute on function public.set_shift_media_keep(uuid, boolean) to authenticated;

create function public.storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_limit constant bigint := 1073741824;
  v_total bigint;
  v_buckets jsonb;
  v_percent numeric;
begin
  perform app.require_role('owner', 'admin');

  select
    coalesce(sum(b.bytes), 0)::bigint,
    coalesce(jsonb_agg(jsonb_build_object('bucket', b.bucket_id, 'bytes', b.bytes, 'objects', b.objects) order by b.bucket_id), '[]'::jsonb)
  into v_total, v_buckets
  from (
    select o.bucket_id,
           coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint as bytes,
           count(*) as objects
    from storage.objects o
    group by o.bucket_id
  ) b;

  v_percent := round(v_total * 100.0 / v_limit, 1);

  return jsonb_build_object(
    'total_bytes', v_total,
    'limit_bytes', v_limit,
    'percent', v_percent,
    'level', case when v_percent >= 90 then 'critical' when v_percent >= 70 then 'warning' else 'ok' end,
    'buckets', v_buckets
  );
end;
$$;

comment on function public.storage_usage() is
  'Espacio usado en Storage sobre el tope de 1 GB del plan gratuito (0047, H-09, H-10, H-14). Solo O, A (FORBIDDEN si no). Suma storage.objects.metadata->>''size'' de TODOS los buckets (evidence, avatars, branding, client-photos), porque el GB es uno solo. Devuelve {"total_bytes", "limit_bytes" (1073741824), "percent" (un decimal), "level" ("ok", "warning" desde 70 %, "critical" desde 90 %), "buckets": [{bucket, bytes, objects}]}. No bloquea nada (H-18): solo informa.';

revoke execute on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. RPC internas del barrido nocturno (solo service_role; las llama la Edge Function evidence-cleanup)
-- ---------------------------------------------------------------------------------------------

-- Qué archivos hay que borrar de Storage. Un renglón por fila, con el motivo:
--   removed       la quitó su autor (H-15) y el archivo todavía no se borró;
--   pending_stale subida pendiente de más de 24 h (nunca se confirmó);
--   expired       confirmada, sin «Conservar», más vieja que el plazo vigente de su tipo (H-08, H-17).
create function public.evidence_cleanup_candidates(p_limit integer default 200)
returns table (media_id uuid, storage_path text, thumb_path text, reason text)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select m.id, m.storage_path, m.thumb_path,
    case
      when m.removed_at is not null then 'removed'
      when m.confirmed_at is null then 'pending_stale'
      else 'expired'
    end
  from public.shift_media m
  cross join public.company_settings cs
  where m.expired_at is null
    and cs.id = 1
    and (
      m.removed_at is not null
      or (m.confirmed_at is null and m.created_at < now() - interval '24 hours')
      or (
        m.confirmed_at is not null
        and m.keep = false
        and m.created_at < now() - make_interval(
          days => case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end
        )
      )
    )
  order by m.created_at
  limit greatest(coalesce(p_limit, 200), 1);
$$;

comment on function public.evidence_cleanup_candidates(integer) is
  'Interna del barrido nocturno (0047, H-08): filas cuyo archivo hay que borrar de Storage, con reason removed, pending_stale (pendiente de más de 24 h) o expired (plazo vigente de su tipo, salvo keep). Solo service_role.';

create function public.evidence_cleanup_mark(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_count integer;
begin
  update public.shift_media
  set expired_at = now(),
      removed_at = case when confirmed_at is null and removed_at is null then now() else removed_at end
  where id = any(p_ids) and expired_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.evidence_cleanup_mark(uuid[]) is
  'Interna del barrido nocturno (0047): marca expired_at (el archivo ya se borró de Storage). Las pendientes abandonadas quedan además con removed_at (removed_by null = el sistema). Devuelve la cantidad de filas marcadas. Solo service_role.';

revoke execute on function public.evidence_cleanup_candidates(integer) from public, anon, authenticated;
revoke execute on function public.evidence_cleanup_mark(uuid[]) from public, anon, authenticated;
grant execute on function public.evidence_cleanup_candidates(integer) to service_role;
grant execute on function public.evidence_cleanup_mark(uuid[]) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 9. Vista v_shift_media
-- ---------------------------------------------------------------------------------------------

create view public.v_shift_media
with (security_invoker = true)
as
select
  m.id,
  m.shift_id,
  sh.shift_date,
  sh.client_id,
  coalesce(cl.trade_name, cl.legal_name) as client_name,
  sh.site_id,
  si.name as site_name,
  m.assignment_id,
  m.supervision_id,
  m.uploaded_by,
  pr.first_name as uploader_first_name,
  pr.last_name as uploader_last_name,
  case when m.supervision_id is not null then 'supervisor' else 'employee' end as uploader_role,
  m.kind,
  m.storage_path,
  m.thumb_path,
  m.size_bytes,
  m.width,
  m.height,
  m.duration_s,
  m.captured_at,
  m.created_at,
  m.keep,
  m.kept_by,
  m.kept_at,
  m.expired_at,
  (m.expired_at is null) as has_file,
  case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end as retention_days,
  case
    when m.keep or m.expired_at is not null then null
    else (m.created_at at time zone 'America/Argentina/Buenos_Aires')::date
         + (case m.kind when 'photo' then cs.photo_retention_days else cs.video_retention_days end)::int
  end as expires_on
from public.shift_media m
cross join public.company_settings cs
left join public.shifts sh on sh.id = m.shift_id
left join public.v_clients_basic cl on cl.id = sh.client_id
left join public.sites si on si.id = sh.site_id
left join public.profiles pr on pr.id = m.uploaded_by
where cs.id = 1
  and m.confirmed_at is not null
  and m.removed_at is null;

comment on view public.v_shift_media is
  'Fotos y videos confirmados y no quitados de los turnos, con turno, cliente, sede y autor, para la sección «Fotos y videos» y sus filtros (0047, H-09). expires_on = fecha (Argentina) de creación + plazo vigente de su tipo (H-17); null si está en «Conservar» o si el archivo ya se borró (expired_at; has_file = false: queda la constancia). uploader_role: supervisor si subió desde una supervisión. security_invoker: dueño y administradores ven todo; el autor, lo suyo (RLS de shift_media).';

grant select on public.v_shift_media to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10. v_my_day y v_my_supervisions con requires_photos y medios propios
-- ---------------------------------------------------------------------------------------------

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
  ) as no_checkout,
  sh.requires_photos,
  coalesce(media.photos_count, 0) as my_photos_count,
  coalesce(media.videos_count, 0) as my_videos_count
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
  select
    count(*) filter (where m.kind = 'photo') as photos_count,
    count(*) filter (where m.kind = 'video') as videos_count
  from public.shift_media m
  where m.assignment_id = a.id
    and m.uploaded_by = auth.uid()
    and m.confirmed_at is not null
    and m.removed_at is null
) media on true
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
  'Pantalla Hoy del empleado (04 sección 4, P-092, P-093): asignaciones propias de hoy y los próximos 7 días. Incluye los turnos cancelados (0030, DEF-01, P-049, CB-03): el indicador es shift_status = ''cancelled''. changed_since_last_seen compara, por separado, el último cambio de la asignación y el del turno contra profiles.last_seen_changes_at (P-092) e ignora el cambio si quien lo hizo (updated_by) es el mismo empleado (0028). is_today distingue el bloque "hoy en detalle" de la lista de próximos días (P-093). check_in_at/check_out_at (0026), site_city/site_latitude/site_longitude y check_*_source/recorded_by y last_notice_* (0027). last_notice_estimated_arrival_at (0033) y on_the_way_expires_at (0034): aviso «en camino» y hasta cuándo vale. effective_open_ended (0037, AJ2-10): la asignación es «A terminar» (turno abierto y sin fin propio): el celular muestra «A terminar» en vez de effective_end_time (23:59). no_checkout (0037): «Sin salida» (present, abierta, pasadas las 23:59 del día del turno); la salida ya no se puede fichar desde el celular (record_check_out da OPEN_SHIFT_DAY_ENDED) y la carga administración. El cliente se lee de v_clients_basic (0030, DEF-P05). Filtra employee_id = auth.uid() en la definición; security_invoker: además queda sujeta a la RLS de assignments/shifts/sites/attendance_records/attendance_notices. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en photos_not_allowed.';

-- v_my_supervisions: columnas de 0037 y, al final, `requires_photos` y las cantidades de fotos y videos propios.
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
  sh.open_ended as shift_open_ended,
  sh.requires_photos,
  coalesce(media.photos_count, 0) as my_photos_count,
  coalesce(media.videos_count, 0) as my_videos_count
from public.supervisions sv
join public.shifts sh on sh.id = sv.shift_id
join public.clients cl on cl.id = sh.client_id
join public.sites si on si.id = sh.site_id
left join public.supervision_attendance ci on ci.supervision_id = sv.id and ci.kind = 'check_in'
left join public.supervision_attendance co on co.supervision_id = sv.id and co.kind = 'check_out'
left join lateral (
  select
    count(*) filter (where m.kind = 'photo') as photos_count,
    count(*) filter (where m.kind = 'video') as videos_count
  from public.shift_media m
  where m.supervision_id = sv.id
    and m.uploaded_by = auth.uid()
    and m.confirmed_at is not null
    and m.removed_at is null
) media on true
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
  'Pantallas del supervisor: Hoy, próximos, detalle e historial (04 sección 4, SUP-02/03/07/08). Filtra supervisor_id = auth.uid() en la definición. assigned_employees: jsonb con los empleados asignados vigentes del turno (nombre, estado y check_in_at -- "inicio real", 0029, SUP-03); el nombre sale de v_people_basic (0030, DEF-P03). site_* (0029, SUP-006). shift_open_ended (0037, AJ2-10): el turno es «A terminar»; la pantalla muestra «A terminar» en vez de end_time (23:59). security_invoker: además queda sujeta a la RLS de supervisions/shifts/clients/sites/assignments. Desde 0047 (módulo H) agrega requires_photos (el turno pide fotos, H-07) y my_photos_count / my_videos_count (fotos y videos propios confirmados y no quitados, para el contador «3 de 10» y la advertencia de EMP-10). La sede sin fotos ya viene en site_photos_not_allowed.';

-- ---------------------------------------------------------------------------------------------
-- 11. delete_service: un servicio con fotos o videos tampoco se elimina
-- ---------------------------------------------------------------------------------------------

-- shift_media tiene FK a shifts y nada se borra físicamente (P-014): sin este cambio, borrar un
-- servicio con evidencia fallaría con un error de clave foránea sin código. Ahora es un bloqueo
-- más, con su código (SHIFT_MEDIA en service_delete_preview, SERVICE_HAS_MEDIA en delete_service).

create or replace function app.service_delete_blockers(p_service_id uuid)
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
      ) then 'SUPERVISIONS' end,
      case when exists (
        select 1 from public.shift_media m where m.shift_id = sh.id
      ) then 'SHIFT_MEDIA' end
    ], null)
  from public.shifts sh
  where sh.service_id = p_service_id
  order by sh.shift_date, sh.id;
$$;

comment on function app.service_delete_blockers(uuid) is
  'Interna de service_delete_preview y delete_service (0044): por cada turno del servicio, los motivos que impiden borrarlo (ATTENDANCE_RECORDS, ATTENDANCE_NOTICES, SUPERVISIONS y, desde 0047, SHIFT_MEDIA: fotos o videos subidos al turno, que quedan como constancia).';

revoke execute on function app.service_delete_blockers(uuid) from public, anon, authenticated;

create or replace function public.delete_service(p_service_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_service public.services;
  v_blocking_count int;
  v_attendance boolean;
  v_supervisions boolean;
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
    coalesce(bool_or(b.reasons && array['ATTENDANCE_RECORDS', 'ATTENDANCE_NOTICES']), false),
    coalesce(bool_or(b.reasons && array['SUPERVISIONS']), false)
  into v_blocking_count, v_attendance, v_supervisions
  from app.service_delete_blockers(p_service_id) b;

  if v_blocking_count > 0 then
    if v_attendance then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede eliminar: hay turnos de este servicio con fichajes o avisos de asistencia. Dalo de baja en su lugar.',
        hint = 'SERVICE_HAS_ATTENDANCE';
    end if;
    if v_supervisions then
      raise exception using
        errcode = 'P0001',
        message = 'No se puede eliminar: hay turnos de este servicio con supervisiones. Dalo de baja en su lugar.',
        hint = 'SERVICE_HAS_SUPERVISIONS';
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'No se puede eliminar: hay turnos de este servicio con fotos o videos subidos. Dalo de baja en su lugar.',
      hint = 'SERVICE_HAS_MEDIA';
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

  -- target_id queda null: security_events.target_id es FK a profiles (la persona afectada) y un
  -- servicio no es una persona. El servicio va en details.service_id (0045).
  perform app.log_security_event(
    'service_deleted',
    auth.uid(),
    null,
    jsonb_build_object(
      'service_id', p_service_id,
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
  'Elimina físicamente el servicio y todos sus turnos con lo que cuelga (asignaciones, tareas del turno, observaciones, empleados fijos) en una sola transacción (0044, AJ3-01). O, A (FORBIDDEN si no). SERVICE_NOT_FOUND. SERVICE_HAS_ATTENDANCE si algún turno tiene fichajes o avisos de asistencia y SERVICE_HAS_SUPERVISIONS si tiene supervisiones y, desde 0047, SERVICE_HAS_MEDIA si algún turno tiene fotos o videos subidos (no borra nada; se sugiere dar de baja). Registra service_deleted en security_events (actor; target_id null porque es FK a profiles; el servicio y las cantidades en details, 0045). Devuelve jsonb {service_id, shifts_deleted, assignments_deleted}. Excepción deliberada a «nada se borra físicamente», decidida por Mike para servicios cargados por duplicado.';
