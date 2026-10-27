-- 0072_p25_5_retiro_en_nombre_de.sql
-- P25.5a (módulo E, IS-35): retiro de insumos cargado EN NOMBRE DE otra persona.
--
-- Problema: hay dueños y administradores que también trabajan turnos como empleados o
-- coordinadores. Para ellos v_withdrawal_shift_options / v_withdrawal_site_options devuelven las
-- opciones de su rol operativo (hoy a +7 días), no las de la administración.
--
-- Solución (sin tocar el contrato del celular):
--   1. app.withdrawal_shift_options_admin() y app.withdrawal_site_options_admin() + las vistas
--      v_withdrawal_shift_options_admin y v_withdrawal_site_options_admin: opciones de la
--      administración (todos los turnos de -30 a +7 días; todas las sedes activas) que NO
--      dependen de los roles operativos de quien consulta. Solo las ve quien tiene manage_stock
--      (el dueño siempre); el resto recibe cero filas.
--   2. app.resolve_stock_place(uuid, uuid, boolean): con p_restricted = false (retiro en nombre
--      de otra persona) ahora valida contra esas opciones de administración (ventana de -30 a +7
--      días) en vez de aceptar cualquier turno vigente. Con true no cambia.
--   register_withdrawal no cambia de cuerpo: ya usaba p_restricted = (retira para sí mismo).
--   El turno elegido no tiene que ser de la persona por la que se retira (así era antes).

-- 1. Turnos para un retiro en nombre de otra persona.
create function app.withdrawal_shift_options_admin()
returns table (
  shift_id uuid,
  shift_date date,
  start_time time,
  end_time time,
  starts_at timestamptz,
  open_ended boolean,
  shift_status public.shift_status,
  client_id uuid,
  client_name text,
  site_id uuid,
  site_name text,
  assigned_employee_ids uuid[],
  supervisor_ids uuid[]
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
    sh.open_ended,
    sh.status,
    sh.client_id,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name),
    sh.site_id,
    si.name,
    coalesce((
      select array_agg(a.employee_id order by a.employee_id)
      from public.assignments a
      where a.shift_id = sh.id and a.removed_at is null
    ), '{}'::uuid[]),
    coalesce((
      select array_agg(sv.supervisor_id order by sv.supervisor_id)
      from public.supervisions sv
      where sv.shift_id = sh.id and sv.status <> 'cancelled'
    ), '{}'::uuid[])
  from public.shifts sh
  join public.clients cl on cl.id = sh.client_id
  join public.sites si on si.id = sh.site_id
  where app.current_uid() is not null
    and app.has_capability('manage_stock')
    and sh.deleted_at is null
    and sh.status <> 'cancelled'
    and sh.shift_date between app.today() - 30 and app.today() + 7
  order by sh.shift_date, sh.start_time, 9, 11;
$$;

comment on function app.withdrawal_shift_options_admin() is
  'Turnos que la administración puede elegir al cargar un retiro en nombre de otra persona (0072, IS-35): todos, de -30 a +7 días, sin turnos cancelados ni dados de baja, sin importar los roles operativos de quien consulta. Solo con manage_stock (dueño siempre); sin la capacidad devuelve cero filas. Definidor. Interna: la lee v_withdrawal_shift_options_admin y la usa resolve_stock_place para validar.';

revoke execute on function app.withdrawal_shift_options_admin() from public, anon;
grant execute on function app.withdrawal_shift_options_admin() to authenticated, service_role;

-- 2. Sedes para un retiro en nombre de otra persona sin turno puntual.
create function app.withdrawal_site_options_admin()
returns table (
  site_id uuid,
  site_name text,
  client_id uuid,
  client_name text
)
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select
    si.id,
    si.name,
    si.client_id,
    coalesce(nullif(cl.trade_name, ''), cl.legal_name)
  from public.sites si
  join public.clients cl on cl.id = si.client_id
  where app.current_uid() is not null
    and app.has_capability('manage_stock')
    and si.deleted_at is null and si.status = 'active'
    and cl.deleted_at is null and cl.status = 'active'
  order by 4, 2;
$$;

comment on function app.withdrawal_site_options_admin() is
  'Sedes que la administración puede elegir al cargar un retiro en nombre de otra persona sin turno puntual (0072, IS-35): todas las activas de clientes activos. Solo con manage_stock (dueño siempre); sin la capacidad devuelve cero filas. Definidor. Interna: la lee v_withdrawal_site_options_admin y la usa resolve_stock_place para validar.';

revoke execute on function app.withdrawal_site_options_admin() from public, anon;
grant execute on function app.withdrawal_site_options_admin() to authenticated, service_role;

-- 3. Validación del lugar: en nombre de otra persona (p_restricted = false) rigen las opciones de
--    administración. Misma firma que en 0070.
create or replace function app.resolve_stock_place(p_shift_id uuid, p_site_id uuid, p_restricted boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  if p_shift_id is not null then
    select * into v_shift from public.shifts where id = p_shift_id and deleted_at is null;

    if v_shift.id is null then
      raise exception using errcode = 'P0001', message = 'El turno no existe.', hint = 'SHIFT_NOT_FOUND';
    end if;

    if v_shift.status = 'cancelled' then
      raise exception using errcode = 'P0001', message = 'El turno está cancelado.', hint = 'SHIFT_NOT_AVAILABLE';
    end if;

    if p_restricted and not exists (
      select 1 from app.withdrawal_shift_options() o where o.shift_id = p_shift_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'Ese turno no está entre los que podés elegir (hoy y los próximos 7 días).',
        hint = 'SHIFT_NOT_ALLOWED';
    end if;

    if not p_restricted and not exists (
      select 1 from app.withdrawal_shift_options_admin() o where o.shift_id = p_shift_id
    ) then
      raise exception using errcode = 'P0001',
        message = 'Ese turno no está entre los que podés elegir (de los últimos 30 días a los próximos 7).',
        hint = 'SHIFT_NOT_ALLOWED';
    end if;

    if p_site_id is not null and p_site_id <> v_shift.site_id then
      raise exception using errcode = 'P0001', message = 'La sede no es la del turno elegido.', hint = 'SITE_SHIFT_MISMATCH';
    end if;

    return v_shift.site_id;
  end if;

  if p_site_id is not null then
    if not exists (
      select 1
      from public.sites si
      join public.clients cl on cl.id = si.client_id
      where si.id = p_site_id and si.deleted_at is null and si.status = 'active'
        and cl.deleted_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'La sede no existe o está inactiva.', hint = 'SITE_NOT_FOUND';
    end if;

    if p_restricted and not exists (
      select 1 from app.withdrawal_site_options() o where o.site_id = p_site_id
    ) then
      raise exception using errcode = 'P0001', message = 'Esa sede no está entre las que podés elegir.', hint = 'SITE_NOT_ALLOWED';
    end if;

    if not p_restricted and not exists (
      select 1 from app.withdrawal_site_options_admin() o where o.site_id = p_site_id
    ) then
      raise exception using errcode = 'P0001', message = 'Esa sede no está entre las que podés elegir.', hint = 'SITE_NOT_ALLOWED';
    end if;

    return p_site_id;
  end if;

  return null;
end;
$$;

comment on function app.resolve_stock_place(uuid, uuid, boolean) is
  'Valida el turno o la sede de un retiro o de un aviso de faltante y devuelve la sede (0070, 0072; IS-12, IS-28, IS-35). p_restricted = true: lo que la sesión puede elegir según su rol (v_withdrawal_shift_options / v_withdrawal_site_options). p_restricted = false (retiro en nombre de otra persona): las opciones de administración (v_withdrawal_shift_options_admin: -30 a +7 días; v_withdrawal_site_options_admin). Errores: SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED. Interna.';

-- 4. Vistas.
create view public.v_withdrawal_shift_options_admin with (security_invoker = true) as
select * from app.withdrawal_shift_options_admin();

comment on view public.v_withdrawal_shift_options_admin is
  'Turnos para cargar un retiro EN NOMBRE DE otra persona (0072, IS-35): todos, de -30 a +7 días, sin cancelados; assigned_employee_ids y supervisor_ids para que la pantalla resalte los de la persona elegida. Solo con manage_stock (dueño siempre); sin la capacidad, cero filas. No depende de los roles operativos de quien consulta: para retirar para sí mismo se usa v_withdrawal_shift_options.';

create view public.v_withdrawal_site_options_admin with (security_invoker = true) as
select * from app.withdrawal_site_options_admin();

comment on view public.v_withdrawal_site_options_admin is
  'Sedes para cargar un retiro en nombre de otra persona sin turno puntual (0072, IS-35): todas las activas de clientes activos. Solo con manage_stock (dueño siempre); sin la capacidad, cero filas.';

revoke all on public.v_withdrawal_shift_options_admin from public, anon, authenticated;
revoke all on public.v_withdrawal_site_options_admin from public, anon, authenticated;
grant select on public.v_withdrawal_shift_options_admin to authenticated;
grant select on public.v_withdrawal_site_options_admin to authenticated;

-- 5. Documentación de la RPC (el cuerpo no cambia).
comment on function public.register_withdrawal(jsonb, uuid, uuid, text, uuid) is
  'Registra un retiro de insumos y descuenta el stock en el momento (0070, 0072; IS-11 a IS-13, IS-28, IS-35). Sin p_person_id (o el propio): retira la sesión, que tiene que ser empleado o coordinador (FORBIDDEN si no; PERSON_REQUIRED si es administración sin esos roles) y elige entre las opciones de su rol (turno de v_withdrawal_shift_options o sede de v_withdrawal_site_options). Con p_person_id de otra persona: la administración carga en su nombre (manage_stock; la persona tiene que ser empleado o coordinador activo) con las reglas de administración sin importar los roles operativos de quien carga: cualquier turno de -30 a +7 días (v_withdrawal_shift_options_admin; no hace falta que sea de esa persona) o sede activa (v_withdrawal_site_options_admin). p_lines: [{supply_id, qty (entero > 0)}]. Sin turno, p_note es obligatoria. Devuelve {"movement": <cabecera>, "lines": [{supply_id, code, name, presentation, qty, qty_delta}]}, sin precios ni stock. Errores: FORBIDDEN, PERSON_REQUIRED, PERSON_NOT_FOUND, SHIFT_OR_SITE_REQUIRED, SHIFT_NOT_FOUND, SHIFT_NOT_AVAILABLE, SHIFT_NOT_ALLOWED, SITE_SHIFT_MISMATCH, SITE_NOT_FOUND, SITE_NOT_ALLOWED, NOTE_REQUIRED, INVALID_LINES, INVALID_QTY, DUPLICATE_SUPPLY, SUPPLY_NOT_FOUND, SUPPLY_INACTIVE, INSUFFICIENT_STOCK («No alcanza el stock de X. Consultá en la oficina.», sin la cantidad para quien no es administración).';
