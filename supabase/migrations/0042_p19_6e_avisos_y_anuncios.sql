-- P19.6 paquete E: AJ2-03 «Avisos y anuncios» (base de datos).
--
-- Decisión de Mike (9 oct 2026): sección propia «Avisos y anuncios» en administración. Dueños y
-- administradores publican anuncios para solo empleados, solo supervisores, todos, o una selección
-- personalizada de personas. Fecha «hasta» opcional. En el celular aparece en la portada; cada
-- persona lo cierra con «Entendido» y queda registrado quién lo leyó y cuándo.
--
-- NOMBRES: el concepto `notices` (avisos de demora/ausencia del empleado, 0027) no se toca. Todo
-- lo nuevo se llama `announcements`.
--
-- Diseño:
--   - public.announcements(id, title, body, audience, visible_until, content_updated_at,
--     archived_at/by, created_*/updated_*). `audience` es el enum announcement_audience
--     (`employees`, `supervisors`, `all`, `custom`).
--   - public.announcement_recipients(announcement_id, profile_id): solo para `custom`.
--   - public.announcement_reads(announcement_id, profile_id, read_at): una fila por persona.
--   - Quién es «empleado» y «supervisor»: los roles de user_roles (el JWT, app.has_role, en la
--     RLS). Una persona con ambos roles lo ve si cualquiera coincide. `all` = empleados y
--     supervisores. Los administradores/dueños NO reciben los anuncios en su portada (la portada
--     del celular es de empleado/supervisor; administración los gestiona en su pantalla): solo los
--     ve el administrador que además tenga el rol employee o supervisor, o esté en una selección
--     custom (que solo admite personas con alguno de esos dos roles).
--   - Vigencia: `visible_until` es inclusive y es fecha de Buenos Aires (app.today()). Vigente =
--     no archivado y (visible_until is null o visible_until >= hoy).
--   - Editar: reemplaza todos los campos. Si cambia el título o el texto se marca
--     `content_updated_at` y las lecturas anteriores dejan de contar (la persona vuelve a ver el
--     anuncio corregido), pero las filas de announcement_reads NO se borran: se conserva quién
--     leyó la versión anterior. Cambiar audiencia, destinatarios o fecha no reinicia nada.
--     (Usa clock_timestamp() y no now(): dentro de una misma transacción now() no avanza y no
--     habría orden entre la lectura y la edición.)
--   - Criterio de destinatarios para el conteo de administración: se calculan en el momento de la
--     consulta sobre las personas ACTIVAS (profiles.is_active y sin deleted_at) con el rol
--     correspondiente; en `custom`, las de la lista que sigan activas. Quien entra o sale después
--     entra o sale del conteo; las lecturas de personas que ya no son destinatarias se conservan
--     pero no se cuentan.
--   - Escritura solo por RPC (authenticated sin insert/update/delete), igual que el resto.

-- ---------------------------------------------------------------------------------------------
-- 1. Enumeración y tablas
-- ---------------------------------------------------------------------------------------------

create type public.announcement_audience as enum ('employees', 'supervisors', 'all', 'custom');
comment on type public.announcement_audience is 'A quién va un anuncio: Empleados, Supervisores, Todos (empleados y supervisores), Selección personalizada.';

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience public.announcement_audience not null,
  visible_until date,
  content_updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  constraint announcements_title_check check (btrim(title) <> '' and char_length(title) <= 120),
  constraint announcements_body_check check (btrim(body) <> '' and char_length(body) <= 2000)
);

comment on table public.announcements is
  'Anuncio de administración para empleados y/o supervisores (0042, AJ2-03). Distinto de notices (avisos de demora/ausencia). Baja lógica con archived_at. Se escribe por create_announcement / update_announcement / archive_announcement.';
comment on column public.announcements.visible_until is 'Último día en que se muestra (inclusive), fecha de Buenos Aires. Null = sin vencimiento.';
comment on column public.announcements.content_updated_at is 'Última vez que cambió el título o el texto. Una lectura anterior a este instante ya no cuenta: la persona vuelve a ver el anuncio.';

create trigger trg_set_updated_at
before update on public.announcements
for each row execute function app.set_updated_at();

create table public.announcement_recipients (
  announcement_id uuid not null references public.announcements (id),
  profile_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

comment on table public.announcement_recipients is 'Destinatarios de un anuncio con audiencia custom (0042, AJ2-03). Para las otras audiencias queda vacía.';

create index announcement_recipients_profile_idx on public.announcement_recipients (profile_id);

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements (id),
  profile_id uuid not null references public.profiles (id),
  read_at timestamptz not null default clock_timestamp(),
  primary key (announcement_id, profile_id)
);

comment on table public.announcement_reads is 'Quién tocó «Entendido» en un anuncio y cuándo (0042, AJ2-03). Se escribe por acknowledge_announcement.';

create index announcement_reads_profile_idx on public.announcement_reads (profile_id);

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.announcement_reads enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. Función auxiliar: ¿el anuncio es para la sesión actual?
-- ---------------------------------------------------------------------------------------------

-- Solo audiencia (no vigencia ni archivo). security definer para que la búsqueda en
-- announcement_recipients no dependa de la RLS de esa tabla. Usa los roles del JWT
-- (app.has_role, que además exige perfil activo) y app.current_uid() para la lista custom.
create function app.announcement_targets_me(p_id uuid, p_audience public.announcement_audience)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select case p_audience
    when 'employees' then app.has_role('employee')
    when 'supervisors' then app.has_role('supervisor')
    when 'all' then app.has_role('employee') or app.has_role('supervisor')
    else exists (
      select 1 from public.announcement_recipients r
      where r.announcement_id = p_id and r.profile_id = app.current_uid()
    )
  end;
$$;

comment on function app.announcement_targets_me(uuid, public.announcement_audience) is
  'True si el anuncio le corresponde a la sesión actual por audiencia (0042, AJ2-03): rol employee/supervisor según la audiencia o, en custom, estar en la lista. No mira vigencia ni archivo.';

revoke execute on function app.announcement_targets_me(uuid, public.announcement_audience) from public, anon;
grant execute on function app.announcement_targets_me(uuid, public.announcement_audience) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. Políticas RLS
-- ---------------------------------------------------------------------------------------------

create policy announcements_select_admin
  on public.announcements for select to authenticated
  using (app.is_admin());

create policy announcements_select_target
  on public.announcements for select to authenticated
  using (
    archived_at is null
    and (visible_until is null or visible_until >= app.today())
    and app.announcement_targets_me(id, audience)
  );

create policy announcement_recipients_select_admin
  on public.announcement_recipients for select to authenticated
  using (app.is_admin());

create policy announcement_recipients_select_own
  on public.announcement_recipients for select to authenticated
  using (profile_id = app.current_uid());

create policy announcement_reads_select_admin
  on public.announcement_reads for select to authenticated
  using (app.is_admin());

create policy announcement_reads_select_own
  on public.announcement_reads for select to authenticated
  using (profile_id = app.current_uid());

-- ---------------------------------------------------------------------------------------------
-- 4. Vistas
-- ---------------------------------------------------------------------------------------------

-- Anuncios vigentes que le corresponden a la persona de la sesión (celular). Incluye los ya leídos
-- con `read_at` para poder mostrar el historial; la portada filtra `read_at is null`.
--   read_at   : cuándo tocó «Entendido» sobre la versión actual; null si no lo leyó o si el texto
--               cambió después de su lectura.
--   was_edited: true si el anuncio se corrigió después de que la persona lo había leído.
create view public.v_my_announcements
with (security_invoker = true)
as
select
  a.id,
  a.title,
  a.body,
  a.audience,
  a.visible_until,
  a.created_at,
  a.content_updated_at,
  case when r.read_at >= a.content_updated_at then r.read_at end as read_at,
  (r.read_at is not null and r.read_at < a.content_updated_at) as was_edited
from public.announcements a
left join public.announcement_reads r
  on r.announcement_id = a.id and r.profile_id = app.current_uid()
where a.archived_at is null
  and (a.visible_until is null or a.visible_until >= app.today())
  and app.announcement_targets_me(a.id, a.audience);

comment on view public.v_my_announcements is
  'Anuncios vigentes y no archivados que le corresponden a la persona de la sesión, con su read_at (null = falta el «Entendido»). Portada del celular: where read_at is null (0042, AJ2-03). Un administrador solo ve acá los que le corresponden como empleado/supervisor.';

-- Detalle por persona (administración): destinatarios actuales de cada anuncio y su lectura.
-- Solo dueño/administrador (el where app.is_admin() deja la vista vacía para el resto).
create view public.v_announcement_recipients
with (security_invoker = true)
as
select
  a.id as announcement_id,
  p.id as profile_id,
  p.first_name,
  p.last_name,
  array(
    select ur.role::text from public.user_roles ur
    where ur.profile_id = p.id and ur.role in ('employee', 'supervisor')
    order by ur.role::text
  ) as roles,
  case when r.read_at >= a.content_updated_at then r.read_at end as read_at
from public.announcements a
join public.profiles p
  on p.is_active and p.deleted_at is null
 and (
   (a.audience in ('employees', 'all')
     and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'employee'))
   or (a.audience in ('supervisors', 'all')
     and exists (select 1 from public.user_roles ur where ur.profile_id = p.id and ur.role = 'supervisor'))
   or (a.audience = 'custom'
     and exists (select 1 from public.announcement_recipients ar where ar.announcement_id = a.id and ar.profile_id = p.id))
 )
left join public.announcement_reads r
  on r.announcement_id = a.id and r.profile_id = p.id
where app.is_admin();

comment on view public.v_announcement_recipients is
  'Una fila por destinatario actual (persona activa con el rol de la audiencia, o de la lista custom) de cada anuncio, con su read_at (null = no lo leyó, o lo leyó antes de la última edición del texto). Solo dueño/administrador (0042, AJ2-03).';

-- Listado de administración: cada anuncio con su estado y los conteos.
--   status: 'archived' | 'expired' | 'active'
create view public.v_announcements_admin
with (security_invoker = true)
as
select
  a.id,
  a.title,
  a.body,
  a.audience,
  a.visible_until,
  a.created_at,
  a.updated_at,
  a.content_updated_at,
  a.archived_at,
  a.created_by,
  nullif(btrim(coalesce(cp.first_name, '') || ' ' || coalesce(cp.last_name, '')), '') as created_by_name,
  case
    when a.archived_at is not null then 'archived'
    when a.visible_until is not null and a.visible_until < app.today() then 'expired'
    else 'active'
  end as status,
  c.recipient_count,
  c.read_count
from public.announcements a
left join public.profiles cp on cp.id = a.created_by
cross join lateral (
  select count(*)::int as recipient_count, count(vr.read_at)::int as read_count
  from public.v_announcement_recipients vr
  where vr.announcement_id = a.id
) c
where app.is_admin();

comment on view public.v_announcements_admin is
  'Anuncios para administración (todos, también archivados y vencidos) con status, cantidad de destinatarios y de lecturas (0042, AJ2-03). Destinatarios = personas activas en este momento. Solo dueño/administrador.';

-- ---------------------------------------------------------------------------------------------
-- 5. RPC
-- ---------------------------------------------------------------------------------------------

-- Valida y reemplaza la lista de destinatarios. Solo para las RPC de abajo.
create function app.set_announcement_recipients(
  p_id uuid,
  p_audience public.announcement_audience,
  p_recipient_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_ids uuid[];
  v_bad int;
begin
  delete from public.announcement_recipients where announcement_id = p_id;

  if p_audience <> 'custom' then
    return;
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids
  from unnest(coalesce(p_recipient_ids, '{}')) as t(x)
  where x is not null;

  if cardinality(v_ids) = 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Elegí al menos una persona para el anuncio.',
      hint = 'RECIPIENTS_REQUIRED';
  end if;

  select count(*) into v_bad
  from unnest(v_ids) as t(x)
  where not exists (
    select 1
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id and ur.role in ('employee', 'supervisor')
    where p.id = t.x and p.is_active and p.deleted_at is null
  );

  if v_bad > 0 then
    raise exception using
      errcode = 'P0001',
      message = 'Hay personas elegidas que no están activas o no son empleados ni supervisores.',
      hint = 'RECIPIENT_INVALID';
  end if;

  insert into public.announcement_recipients (announcement_id, profile_id)
  select p_id, x from unnest(v_ids) as t(x);
end;
$$;

comment on function app.set_announcement_recipients(uuid, public.announcement_audience, uuid[]) is
  'Auxiliar de create/update_announcement (0042): vacía la lista y, si la audiencia es custom, la reemplaza validando que haya al menos una persona activa con rol employee o supervisor (RECIPIENTS_REQUIRED, RECIPIENT_INVALID).';

revoke execute on function app.set_announcement_recipients(uuid, public.announcement_audience, uuid[]) from public, anon, authenticated;

create function public.create_announcement(
  p_title text,
  p_body text,
  p_audience public.announcement_audience,
  p_visible_until date default null,
  p_recipient_ids uuid[] default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_row public.announcements;
begin
  perform app.require_admin();

  if v_title is null or v_title = '' then
    raise exception using errcode = 'P0001', message = 'Escribí un título para el anuncio.', hint = 'TITLE_REQUIRED';
  end if;
  if char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'El título puede tener hasta 120 caracteres.', hint = 'TITLE_TOO_LONG';
  end if;
  if v_body is null or v_body = '' then
    raise exception using errcode = 'P0001', message = 'Escribí el texto del anuncio.', hint = 'BODY_REQUIRED';
  end if;
  if char_length(v_body) > 2000 then
    raise exception using errcode = 'P0001', message = 'El texto puede tener hasta 2000 caracteres.', hint = 'BODY_TOO_LONG';
  end if;
  if p_audience is null then
    raise exception using errcode = 'P0001', message = 'Elegí a quién va dirigido el anuncio.', hint = 'AUDIENCE_REQUIRED';
  end if;
  if p_visible_until is not null and p_visible_until < app.today() then
    raise exception using errcode = 'P0001', message = 'La fecha «hasta» no puede ser anterior a hoy.', hint = 'VISIBLE_UNTIL_IN_PAST';
  end if;

  insert into public.announcements (title, body, audience, visible_until, created_by, updated_by)
  values (v_title, v_body, p_audience, p_visible_until, auth.uid(), auth.uid())
  returning * into v_row;

  perform app.set_announcement_recipients(v_row.id, p_audience, p_recipient_ids);

  return v_row;
end;
$$;

comment on function public.create_announcement(text, text, public.announcement_audience, date, uuid[]) is
  'Publica un anuncio (0042, AJ2-03). O, A; FORBIDDEN si no. TITLE_REQUIRED/TITLE_TOO_LONG (120), BODY_REQUIRED/BODY_TOO_LONG (2000), AUDIENCE_REQUIRED, VISIBLE_UNTIL_IN_PAST (anterior a hoy en Buenos Aires), RECIPIENTS_REQUIRED (custom sin personas), RECIPIENT_INVALID (inactiva o sin rol employee/supervisor). Fuera de custom se ignoran los destinatarios. Devuelve la fila.';

create function public.update_announcement(
  p_id uuid,
  p_title text,
  p_body text,
  p_audience public.announcement_audience,
  p_visible_until date default null,
  p_recipient_ids uuid[] default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
  v_old public.announcements;
  v_row public.announcements;
begin
  perform app.require_admin();

  select * into v_old from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'No encontramos ese anuncio.', hint = 'ANNOUNCEMENT_NOT_FOUND';
  end if;
  if v_old.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'El anuncio está archivado y no se puede editar.', hint = 'ANNOUNCEMENT_ARCHIVED';
  end if;

  if v_title is null or v_title = '' then
    raise exception using errcode = 'P0001', message = 'Escribí un título para el anuncio.', hint = 'TITLE_REQUIRED';
  end if;
  if char_length(v_title) > 120 then
    raise exception using errcode = 'P0001', message = 'El título puede tener hasta 120 caracteres.', hint = 'TITLE_TOO_LONG';
  end if;
  if v_body is null or v_body = '' then
    raise exception using errcode = 'P0001', message = 'Escribí el texto del anuncio.', hint = 'BODY_REQUIRED';
  end if;
  if char_length(v_body) > 2000 then
    raise exception using errcode = 'P0001', message = 'El texto puede tener hasta 2000 caracteres.', hint = 'BODY_TOO_LONG';
  end if;
  if p_audience is null then
    raise exception using errcode = 'P0001', message = 'Elegí a quién va dirigido el anuncio.', hint = 'AUDIENCE_REQUIRED';
  end if;
  -- Al editar solo se rechaza una fecha pasada si cambió (se puede corregir un anuncio vencido sin tocar la fecha).
  if p_visible_until is not null and p_visible_until < app.today()
     and p_visible_until is distinct from v_old.visible_until then
    raise exception using errcode = 'P0001', message = 'La fecha «hasta» no puede ser anterior a hoy.', hint = 'VISIBLE_UNTIL_IN_PAST';
  end if;

  update public.announcements
  set title = v_title,
      body = v_body,
      audience = p_audience,
      visible_until = p_visible_until,
      content_updated_at = case
        when v_title is distinct from v_old.title or v_body is distinct from v_old.body
          then clock_timestamp() else v_old.content_updated_at end,
      updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  perform app.set_announcement_recipients(p_id, p_audience, p_recipient_ids);

  return v_row;
end;
$$;

comment on function public.update_announcement(uuid, text, text, public.announcement_audience, date, uuid[]) is
  'Edita un anuncio reemplazando todos sus campos (0042, AJ2-03). O, A. ANNOUNCEMENT_NOT_FOUND, ANNOUNCEMENT_ARCHIVED y las validaciones de create_announcement (VISIBLE_UNTIL_IN_PAST solo si la fecha cambia). Si cambia el título o el texto, las lecturas anteriores dejan de contar (content_updated_at) pero se conservan. Devuelve la fila.';

create function public.archive_announcement(p_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.announcements;
begin
  perform app.require_admin();

  update public.announcements
  set archived_at = coalesce(archived_at, now()),
      archived_by = coalesce(archived_by, auth.uid()),
      updated_by = auth.uid()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception using errcode = 'P0001', message = 'No encontramos ese anuncio.', hint = 'ANNOUNCEMENT_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

comment on function public.archive_announcement(uuid) is
  'Archiva un anuncio (baja lógica; deja de mostrarse a todos y conserva las lecturas) (0042, AJ2-03). O, A. ANNOUNCEMENT_NOT_FOUND. Idempotente. Devuelve la fila.';

create function public.acknowledge_announcement(p_id uuid)
returns public.announcement_reads
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_uid uuid := app.current_uid();
  v_a public.announcements;
  v_row public.announcement_reads;
begin
  if v_uid is null then
    raise exception using errcode = 'P0001', message = 'No tenés permiso para hacer esto.', hint = 'FORBIDDEN';
  end if;

  select * into v_a from public.announcements where id = p_id;

  if not found
     or v_a.archived_at is not null
     or (v_a.visible_until is not null and v_a.visible_until < app.today())
     or not app.announcement_targets_me(v_a.id, v_a.audience) then
    raise exception using errcode = 'P0001', message = 'Ese anuncio ya no está disponible para vos.', hint = 'ANNOUNCEMENT_NOT_AVAILABLE';
  end if;

  select * into v_row from public.announcement_reads
  where announcement_id = p_id and profile_id = v_uid;

  -- Idempotente: si ya lo había leído en la versión actual se conserva la lectura original.
  if found and v_row.read_at >= v_a.content_updated_at then
    return v_row;
  end if;

  insert into public.announcement_reads (announcement_id, profile_id, read_at)
  values (p_id, v_uid, clock_timestamp())
  on conflict (announcement_id, profile_id) do update set read_at = excluded.read_at
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.acknowledge_announcement(uuid) is
  'La persona de la sesión marca «Entendido» (0042, AJ2-03). Idempotente: repetirlo devuelve la lectura original; si el texto se editó después, registra una lectura nueva. ANNOUNCEMENT_NOT_AVAILABLE si no existe, está archivado, vencido o no le corresponde. FORBIDDEN si el perfil no está activo. Devuelve la fila de announcement_reads.';

-- ---------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------

-- Tablas y vistas nuevas nacen con select para authenticated (default privileges de 0017) y sin
-- nada para anon; la RLS (o el where de cada vista) limita. Sin insert/update/delete: solo RPC.
revoke execute on function public.create_announcement(text, text, public.announcement_audience, date, uuid[]) from public, anon;
grant execute on function public.create_announcement(text, text, public.announcement_audience, date, uuid[]) to authenticated;

revoke execute on function public.update_announcement(uuid, text, text, public.announcement_audience, date, uuid[]) from public, anon;
grant execute on function public.update_announcement(uuid, text, text, public.announcement_audience, date, uuid[]) to authenticated;

revoke execute on function public.archive_announcement(uuid) from public, anon;
grant execute on function public.archive_announcement(uuid) to authenticated;

revoke execute on function public.acknowledge_announcement(uuid) from public, anon;
grant execute on function public.acknowledge_announcement(uuid) to authenticated;
