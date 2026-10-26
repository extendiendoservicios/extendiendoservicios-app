-- 0067_p24_8_color_por_defecto.sql
-- Corrección de 0066 (P24.8): clients.calendar_color era not null sin valor por defecto, así que los
-- tipos generados lo exigían en cada insert y rompían las altas tipadas (src/api/clients.ts y los
-- scripts de prueba). Ahora la columna tiene un valor por defecto que calcula el índice menos usado
-- (la misma regla del trigger de 0066): un insert que no manda el color lo recibe solo, y el trigger
-- sigue cubriendo el caso de un null explícito. Un valor explícito se respeta igual que antes.

create function app.next_client_calendar_color()
returns smallint
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_color smallint;
begin
  -- Evita que dos altas simultáneas elijan el mismo índice.
  perform pg_advisory_xact_lock(hashtext('clients.calendar_color'));

  select g.i::smallint into v_color
  from generate_series(0, 11) as g(i)
  left join (
    select c.calendar_color as color, count(*) as n
    from public.clients c
    group by c.calendar_color
  ) u on u.color = g.i
  order by coalesce(u.n, 0), g.i
  limit 1;

  return v_color;
end;
$$;

comment on function app.next_client_calendar_color() is
  'Índice 0..11 de color de calendario menos usado entre todos los clientes (activos, inactivos y dados de baja) y, ante empate, el más bajo (0067, P24.8). Es el valor por defecto de clients.calendar_color y lo usa el trigger de asignación.';

revoke execute on function app.next_client_calendar_color() from public, anon;
grant execute on function app.next_client_calendar_color() to authenticated, service_role;

create or replace function app.assign_client_calendar_color()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.calendar_color is null then
    new.calendar_color := app.next_client_calendar_color();
  end if;
  return new;
end;
$$;

comment on function app.assign_client_calendar_color() is
  'Trigger before insert de clients (0066, P24.8): si calendar_color viene null (explícito), asigna app.next_client_calendar_color(). Desde 0067 la columna ya tiene ese valor por defecto, así que el trigger solo cubre el null explícito. Un valor explícito se respeta.';

alter table public.clients
  alter column calendar_color set default app.next_client_calendar_color();

comment on column public.clients.calendar_color is
  'Índice (0 a 11) del color del cliente en el calendario de Planificación (0066, P24.8). La paleta de 12 colores vive en el frontend. Se asigna solo al crear el cliente (valor por defecto de 0067: el menos usado, ante empate el más bajo) y lo pueden cambiar el dueño y los administradores.';
