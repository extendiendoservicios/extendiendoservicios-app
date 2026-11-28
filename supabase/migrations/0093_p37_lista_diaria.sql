-- 0093_p37_lista_diaria.sql
-- P37.1b: lista diaria de la Agenda como el parte de WhatsApp (AG-21..AG-25).
--
--   1. agenda_employee_colors suma fixed_line (renglón fijo por persona, AG-22). La fila puede
--      existir solo con el renglón fijo: set_agenda_employee_color ya no la borra si lo tiene.
--   2. RPC set_agenda_employee_fixed_line.
--   3. Tabla agenda_staff_lines (renglones libres por persona y día, AG-23), RLS de solo lectura
--      para owner o admin; se escribe con save_agenda_staff_line y delete_agenda_staff_line.
--
-- Los renglones automáticos (turnos y licencias, AG-24) se leen en el front de las tablas y vistas
-- existentes: no hace falta una vista nueva.

-- ---------------------------------------------------------------------------------------------
-- 1. agenda_employee_colors.fixed_line
-- ---------------------------------------------------------------------------------------------

alter table public.agenda_employee_colors
  add column fixed_line text,
  add constraint agenda_employee_colors_fixed_line_check
    check (fixed_line is null or char_length(fixed_line) between 1 and 1000);

comment on column public.agenda_employee_colors.fixed_line is
  'Renglón fijo de la persona en la lista diaria (puesto o zona, AG-22): se repite todos los días hasta que se edite. De 1 a 1000 caracteres; null = sin renglón. La fila existe mientras tenga algún color o el renglón fijo.';

comment on table public.agenda_employee_colors is
  'Color de borde y relleno (AG-16) y renglón fijo (AG-22) que la dirección le asigna a cada empleado en la lista diaria de la Agenda (0092, 0093). Una fila por empleado; sin colores ni renglón fijo no hay fila. Solo se lee por RLS (owner o admin) y se escribe con set_agenda_employee_color y set_agenda_employee_fixed_line.';

-- La fila se borra solo si no queda ni color ni renglón fijo.
create or replace function public.set_agenda_employee_color(
  p_employee_id uuid,
  p_border smallint,
  p_fill smallint
)
returns public.agenda_employee_colors
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.agenda_employee_colors;
begin
  perform app.require_role('owner', 'admin');

  if not exists (
    select 1 from public.employees e where e.profile_id = p_employee_id and e.deleted_at is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'No encontramos a esa persona.', hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  if (p_border is not null and (p_border < 0 or p_border > 19))
     or (p_fill is not null and (p_fill < 0 or p_fill > 19)) then
    raise exception using errcode = 'P0001',
      message = 'El color tiene que ser un número de 0 a 19.', hint = 'INVALID_COLOR';
  end if;

  insert into public.agenda_employee_colors (employee_id, border_color, fill_color, updated_by)
  values (p_employee_id, p_border, p_fill, auth.uid())
  on conflict (employee_id) do update
    set border_color = excluded.border_color, fill_color = excluded.fill_color, updated_by = auth.uid()
  returning * into v_row;

  if v_row.border_color is null and v_row.fill_color is null and v_row.fixed_line is null then
    delete from public.agenda_employee_colors where employee_id = p_employee_id;
  end if;

  return v_row;
end;
$$;

comment on function public.set_agenda_employee_color(uuid, smallint, smallint) is
  'Fija el color de borde y relleno de un empleado en la lista de la Agenda (0092, AG-16; 0093). Solo O, A. Upsert; no toca fixed_line. Si p_border y p_fill son null y la fila no tiene renglón fijo, la borra (devuelve la fila tal como quedó antes de borrarse, con colores en null); si tiene renglón fijo, la conserva con los colores en null. EMPLOYEE_NOT_FOUND, INVALID_COLOR (0 a 19).';

-- ---------------------------------------------------------------------------------------------
-- 2. set_agenda_employee_fixed_line
-- ---------------------------------------------------------------------------------------------

create function public.set_agenda_employee_fixed_line(p_employee_id uuid, p_text text)
returns public.agenda_employee_colors
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.agenda_employee_colors;
  v_text text := nullif(btrim(p_text), '');
begin
  perform app.require_role('owner', 'admin');

  if not exists (
    select 1 from public.employees e where e.profile_id = p_employee_id and e.deleted_at is null
  ) then
    raise exception using errcode = 'P0001',
      message = 'No encontramos a esa persona.', hint = 'EMPLOYEE_NOT_FOUND';
  end if;

  if v_text is not null and char_length(v_text) > 1000 then
    raise exception using errcode = 'P0001',
      message = 'El renglón fijo no puede pasar de 1000 caracteres.', hint = 'TEXT_TOO_LONG';
  end if;

  insert into public.agenda_employee_colors (employee_id, fixed_line, updated_by)
  values (p_employee_id, v_text, auth.uid())
  on conflict (employee_id) do update
    set fixed_line = excluded.fixed_line, updated_by = auth.uid()
  returning * into v_row;

  if v_row.border_color is null and v_row.fill_color is null and v_row.fixed_line is null then
    delete from public.agenda_employee_colors where employee_id = p_employee_id;
  end if;

  return v_row;
end;
$$;

comment on function public.set_agenda_employee_fixed_line(uuid, text) is
  'Fija el renglón fijo de una persona en la lista diaria de la Agenda (0093, AG-22). Solo O, A. Upsert en agenda_employee_colors; texto vacío o null lo quita, y la fila se borra si además no tiene colores (devuelve la fila tal como quedó antes de borrarse). EMPLOYEE_NOT_FOUND, TEXT_TOO_LONG (más de 1000).';

revoke execute on function public.set_agenda_employee_fixed_line(uuid, text) from public, anon;
grant execute on function public.set_agenda_employee_fixed_line(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. agenda_staff_lines
-- ---------------------------------------------------------------------------------------------

create table public.agenda_staff_lines (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (profile_id) on delete cascade,
  day date not null,
  body text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id),
  constraint agenda_staff_lines_body_check check (char_length(btrim(body)) between 1 and 1000)
);

comment on table public.agenda_staff_lines is
  'Renglones libres por persona y día de la lista diaria de la Agenda (0093, AG-23): «COORDINAR CON MIGUE», «11:20 UBER». Borrado físico. Solo se lee por RLS (owner o admin) y se escribe con save_agenda_staff_line y delete_agenda_staff_line.';
comment on column public.agenda_staff_lines.employee_id is 'Persona (employees.profile_id) a la que pertenece el renglón.';
comment on column public.agenda_staff_lines.day is 'Día del renglón.';
comment on column public.agenda_staff_lines.body is 'Texto del renglón, de 1 a 1000 caracteres.';
comment on column public.agenda_staff_lines.position is 'Orden entre los renglones de la misma persona y día.';

create index agenda_staff_lines_day_employee_position_idx
  on public.agenda_staff_lines (day, employee_id, position);

create trigger trg_set_updated_at
before update on public.agenda_staff_lines
for each row execute function app.set_updated_at();

alter table public.agenda_staff_lines enable row level security;

create policy agenda_staff_lines_select_admin
  on public.agenda_staff_lines
  for select
  to authenticated
  using ((select app.is_admin()));

revoke all on public.agenda_staff_lines from public, anon, authenticated;
grant select on public.agenda_staff_lines to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. RPC de renglones libres
-- ---------------------------------------------------------------------------------------------

create function public.save_agenda_staff_line(
  p_id uuid,
  p_employee_id uuid,
  p_day date,
  p_body text,
  p_position int
)
returns public.agenda_staff_lines
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.agenda_staff_lines;
  v_body text := nullif(btrim(p_body), '');
  v_day date;
  v_employee_id uuid;
begin
  perform app.require_role('owner', 'admin');

  if p_id is not null then
    select * into v_row from public.agenda_staff_lines where id = p_id for update;
    if v_row.id is null then
      raise exception using errcode = 'P0001',
        message = 'No encontramos ese renglón.', hint = 'STAFF_LINE_NOT_FOUND';
    end if;
    v_employee_id := v_row.employee_id;
    v_day := coalesce(p_day, v_row.day);
  else
    v_employee_id := p_employee_id;
    v_day := p_day;
    if not exists (
      select 1 from public.employees e where e.profile_id = v_employee_id and e.deleted_at is null
    ) then
      raise exception using errcode = 'P0001',
        message = 'No encontramos a esa persona.', hint = 'EMPLOYEE_NOT_FOUND';
    end if;
    if v_day is null then
      raise exception using errcode = 'P0001',
        message = 'Elegí el día del renglón.', hint = 'INVALID_DATE';
    end if;
  end if;

  if v_body is null then
    raise exception using errcode = 'P0001',
      message = 'Escribí el texto del renglón.', hint = 'EMPTY_AGENDA_ITEM';
  end if;
  if char_length(v_body) > 1000 then
    raise exception using errcode = 'P0001',
      message = 'El renglón no puede pasar de 1000 caracteres.', hint = 'TEXT_TOO_LONG';
  end if;

  if p_id is null then
    insert into public.agenda_staff_lines (employee_id, day, body, position, created_by, updated_by)
    values (
      v_employee_id, v_day, v_body,
      coalesce(
        p_position,
        (select coalesce(max(l.position), -1) + 1 from public.agenda_staff_lines l
          where l.employee_id = v_employee_id and l.day = v_day)
      ),
      auth.uid(), auth.uid()
    )
    returning * into v_row;
  else
    update public.agenda_staff_lines
    set body = v_body, day = v_day, position = coalesce(p_position, position), updated_by = auth.uid()
    where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

comment on function public.save_agenda_staff_line(uuid, uuid, date, text, int) is
  'Alta (p_id null) o cambio de un renglón libre de la lista diaria (0093, AG-23). Solo O, A. Alta: p_employee_id y p_day obligatorios (EMPLOYEE_NOT_FOUND, INVALID_DATE); p_position null = al final de esa persona y día. Cambio: se pueden cambiar body, day (null = sin cambio) y position (null = sin cambio); la persona no cambia. EMPTY_AGENDA_ITEM si el texto queda vacío, TEXT_TOO_LONG (más de 1000), STAFF_LINE_NOT_FOUND. Devuelve la fila.';

revoke execute on function public.save_agenda_staff_line(uuid, uuid, date, text, int) from public, anon;
grant execute on function public.save_agenda_staff_line(uuid, uuid, date, text, int) to authenticated;

create function public.delete_agenda_staff_line(p_id uuid)
returns public.agenda_staff_lines
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_row public.agenda_staff_lines;
begin
  perform app.require_role('owner', 'admin');

  delete from public.agenda_staff_lines where id = p_id returning * into v_row;

  if v_row.id is null then
    raise exception using errcode = 'P0001',
      message = 'No encontramos ese renglón.', hint = 'STAFF_LINE_NOT_FOUND';
  end if;

  return v_row;
end;
$$;

comment on function public.delete_agenda_staff_line(uuid) is
  'Borra de forma definitiva un renglón libre de la lista diaria (0093, AG-23). Solo O, A. STAFF_LINE_NOT_FOUND si no existe. Devuelve la fila borrada.';

revoke execute on function public.delete_agenda_staff_line(uuid) from public, anon;
grant execute on function public.delete_agenda_staff_line(uuid) to authenticated;
