-- DB-001 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Primer bloque de 04_Modelo_de_Datos.md sección 11: extensión `btree_gist`, esquema `app`
-- (funciones auxiliares de permisos y utilidades, sección 0 y sección 5) y las tres funciones
-- que no dependen de ninguna tabla ni del JWT:
--   - app.set_updated_at()           trigger de trazabilidad (sección 0, "Trazabilidad mínima")
--   - app.local_ts(date, time)       fecha+hora de Argentina -> instante UTC (ADR-019)
--   - app.valid_weekdays(smallint[]) validación de días de semana (sección 2.3, `services.weekdays`)
--
-- El resto de las funciones de la sección 5 (jwt_roles, jwt_capabilities, has_role, is_admin,
-- has_capability, current_employee_id, supervises_shift, shares_shift, handle_new_user,
-- custom_access_token_hook, log_security_event) depende de tablas que todavía no existen o del
-- hook de Auth: llegan en 0003 y siguientes.

-- btree_gist: requerida por la restricción de exclusión de `employee_leaves` (0006) y de
-- `assignments` (0007). Se agrega ahora porque es una extensión de una sola vez, sin relación con
-- ninguna tabla, y así queda disponible desde el primer momento (convención de Supabase: bucket
-- de extensiones separado del esquema de datos).
create extension if not exists btree_gist with schema extensions;

-- Esquema para funciones auxiliares de permisos, trazabilidad y utilidades del sistema. Las
-- tablas de negocio viven en `public` (04 sección 0).
create schema if not exists app;

comment on schema app is
  'Funciones auxiliares de permisos, trazabilidad y utilidades del sistema (04_Modelo_de_Datos.md sección 5). No contiene tablas de negocio.';

-- app.set_updated_at(): trigger genérico BEFORE UPDATE que mantiene `updated_at` en cada fila.
-- Se aplica en todas las tablas de negocio que tengan la columna (04 sección 0).
create function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Trigger BEFORE UPDATE: fija updated_at = now() en la fila modificada.';

-- app.local_ts(date, time): instante UTC correspondiente a una fecha y hora interpretadas en la
-- única zona del sistema, America/Argentina/Buenos_Aires (ADR-019, DT-21). Se marca IMMUTABLE
-- porque se usa en columnas generadas (`shifts.starts_at`, `shifts.ends_at`, 04 sección 2.3):
-- Argentina no tiene horario de verano desde 2009, así que el desplazamiento de esa zona es
-- constante y la función puede marcarse immutable sin riesgo (ADR-019).
create function app.local_ts(p_date date, p_time time)
returns timestamptz
language sql
immutable
as $$
  select (p_date + p_time) at time zone 'America/Argentina/Buenos_Aires';
$$;

comment on function app.local_ts(date, time) is
  'Instante UTC de una fecha y hora locales de America/Argentina/Buenos_Aires. Inmutable: la zona no tiene horario de verano (ADR-019).';

-- app.valid_weekdays(smallint[]): true si el arreglo no es nulo, tiene al menos un valor, todos
-- entre 0 (domingo) y 6 (sábado) y sin repetidos. La usa el check de `services.weekdays`
-- (04 sección 2.3, migración 0007).
create function app.valid_weekdays(p_weekdays smallint[])
returns boolean
language sql
immutable
as $$
  select
    p_weekdays is not null
    and cardinality(p_weekdays) > 0
    and not exists (
      select 1 from unnest(p_weekdays) as w(value)
      where w.value < 0 or w.value > 6
    )
    and cardinality(p_weekdays) = (
      select count(distinct w.value) from unnest(p_weekdays) as w(value)
    );
$$;

comment on function app.valid_weekdays(smallint[]) is
  'True si el arreglo de días de la semana (0 = domingo .. 6 = sábado) no es nulo, tiene al menos un valor, todos en rango y sin repetidos.';
