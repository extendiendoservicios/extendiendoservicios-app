-- Endurecimientos pendientes (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base, P04.5
-- tramo B). Cuatro correcciones sobre lo ya aplicado, revisadas y priorizadas por Mike:
--   1. search_path fijo en las tres funciones de 0001 que quedaron sin él.
--   2. Check de formato de CUIT, CUIL y DNI.
--   3. El hook del token exige usuario activo y no dado de baja.
--   4. app.sync_assignment_window filtra asignaciones quitadas al recalcular por cambio del turno.
--
-- Todos probados antes en transacciones deshechas contra App_dev (ver el reporte de la tarea).

-- ---------------------------------------------------------------------------------------------
-- 1. search_path fijo en las tres funciones de 0001_extensions_and_schema_app.sql
-- ---------------------------------------------------------------------------------------------

-- `alter function ... set search_path`, no `create or replace`: ninguna de las tres necesita
-- cambiar de cuerpo, y dos de ellas están referenciadas desde lugares sensibles a que el cuerpo
-- no se toque -- `app.local_ts` en las columnas generadas `shifts.starts_at`/`ends_at` (0007) y
-- `app.valid_weekdays` en el check `services_weekdays_check` (0007): recrearlas ahí sería pedir
-- problemas (04 sección 0 exige `search_path` fijo en toda función nueva desde P04.1, pero estas
-- tres, de la primera migración de la fase, quedaron afuera -- lección ya anotada en
-- `docs/database.md`, "Cómo escribir una migración").
alter function app.set_updated_at() set search_path = public, app, pg_temp;
alter function app.local_ts(date, time) set search_path = public, app, pg_temp;
alter function app.valid_weekdays(smallint[]) set search_path = public, app, pg_temp;

-- ---------------------------------------------------------------------------------------------
-- 2. Formato de documentos: CUIT, CUIL, DNI
-- ---------------------------------------------------------------------------------------------

-- clients.cuit: 11 dígitos (04 sección 2.2: "cuit unique | 11 dígitos"), columna opcional
-- (nullable) -- el check permite null. Tablas vacías (verificado antes de escribir esta
-- migración): entra sin `not valid`.
alter table public.clients
  add constraint clients_cuit_format_check
  check (cuit is null or cuit ~ '^[0-9]{11}$');

-- employees.dni: "Solo dígitos" (04 sección 2.1), sin largo fijo -- el modelo no lo da, así que
-- el check no impone longitud. Columna not null: sin permitir null.
alter table public.employees
  add constraint employees_dni_format_check
  check (dni ~ '^[0-9]+$');

-- employees.cuil: el modelo no describe su formato (04 sección 2.1 solo dice "cuil text").
-- Decisión menor (indicada por Mike, documentada en el reporte de la tarea): misma regla que
-- clients.cuit (11 dígitos), por ser el mismo tipo de documento (CUIL y CUIT comparten formato
-- en Argentina). Columna nullable: el check permite null.
alter table public.employees
  add constraint employees_cuil_format_check
  check (cuil is null or cuil ~ '^[0-9]{11}$');

-- ---------------------------------------------------------------------------------------------
-- 3. app.custom_access_token_hook: exige usuario activo y no dado de baja
-- ---------------------------------------------------------------------------------------------

-- Hasta ahora el hook armaba roles/capacidades solo a partir de user_roles/admin_capabilities,
-- sin mirar profiles.is_active/deleted_at: una persona desactivada (Edge Function
-- deactivate_user, F7, todavía no escrita) seguía recibiendo roles en cualquier JWT que se le
-- emitiera hasta que la sesión se revocara aparte. Ahora arma los claims solo si hay una fila en
-- profiles con is_active = true y deleted_at is null; si no (inactivo, dado de baja, o --
-- defensivo -- la fila de profiles todavía no existe, caso "usuario recién creado" que Mike pidió
-- cuidar: el hook no lanza excepción, corta el login del sistema entero, no solo el de esa
-- persona), devuelve roles y capabilities vacíos, sin cortar el login (la persona entra pero sin
-- ningún rol -- RequireRole y las políticas RLS la mandan a COM-05 "sin acceso").
-- `create or replace`, no `alter`: acá sí cambia el cuerpo (a diferencia del punto 1). Misma
-- firma exacta, así que conserva los grants ya otorgados a supabase_auth_admin y el revoke de
-- public/anon/authenticated de 0003 (Postgres los preserva en un replace con la misma firma;
-- verificado en la prueba en transacción deshecha).
create or replace function app.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_profile_id uuid;
  v_claims jsonb;
  v_roles jsonb;
  v_is_admin boolean;
  v_capabilities jsonb;
  v_is_active boolean;
  v_deleted_at timestamptz;
  v_profile_active boolean;
begin
  v_profile_id := (event ->> 'user_id')::uuid;
  v_claims := event -> 'claims';

  select p.is_active, p.deleted_at
    into v_is_active, v_deleted_at
  from public.profiles p
  where p.id = v_profile_id;

  -- `v_is_active is true`: no es lo mismo que `coalesce(v_is_active, false)` para el caso "no
  -- existe fila" (ambos dan false ahí), pero sí dice explícitamente "solo true cuenta, null o
  -- false no" sin depender de un coalesce adicional para deleted_at.
  v_profile_active := (v_is_active is true) and (v_deleted_at is null);

  if v_profile_active then
    select coalesce(jsonb_agg(ur.role order by ur.role), '[]'::jsonb), bool_or(ur.role = 'admin')
      into v_roles, v_is_admin
    from public.user_roles ur
    where ur.profile_id = v_profile_id;

    v_roles := coalesce(v_roles, '[]'::jsonb);

    if v_is_admin then
      select coalesce(jsonb_agg(ac.capability order by ac.capability), '[]'::jsonb)
        into v_capabilities
      from public.admin_capabilities ac
      where ac.profile_id = v_profile_id
        and ac.enabled = true;
    else
      v_capabilities := '[]'::jsonb;
    end if;
  else
    v_roles := '[]'::jsonb;
    v_capabilities := '[]'::jsonb;
  end if;

  v_claims := jsonb_set(v_claims, '{roles}', v_roles);
  v_claims := jsonb_set(v_claims, '{capabilities}', v_capabilities);

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function app.custom_access_token_hook(jsonb) is
  'Hook de Auth: agrega los claims "roles" y "capabilities" al JWT (04 sección 7.1), solo si profiles.is_active = true y deleted_at is null para ese user_id (0016_hardening.sql); si no (inactivo, dado de baja, o sin fila de profiles todavía), arreglos vacíos, sin cortar el login. Invocado únicamente por supabase_auth_admin.';

-- ---------------------------------------------------------------------------------------------
-- 4. app.sync_assignment_window: filtra asignaciones quitadas al recalcular por cambio del turno
-- ---------------------------------------------------------------------------------------------

-- La rama `tg_table_name = 'shifts'` (AFTER UPDATE en shifts, dispara cuando update_shift_time
-- cambia fecha/franja, 0007) recalculaba TODAS las asignaciones del turno, incluidas las
-- quitadas (removed_at not null) -- el comentario de la función y el de 0007 ya decían
-- "vigentes", pero el código no filtraba por eso: se agrega `and a.removed_at is null`, probado
-- en transacción deshecha (una asignación vigente y otra quitada del mismo turno; al cambiar
-- shifts.start_time, solo la vigente recalculó su window, la quitada conservó el valor con el
-- que quedó al quitarse).
-- `create or replace`, misma firma: los dos triggers que la usan (trg_sync_assignment_window,
-- trg_sync_assignment_window_from_shift, 0007) no necesitan recrearse.
create or replace function app.sync_assignment_window()
returns trigger
language plpgsql
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  if tg_table_name = 'assignments' then
    select * into v_shift from public.shifts where id = new.shift_id;

    if v_shift.id is null then
      raise exception using
        errcode = 'P0001',
        message = 'El turno de la asignación no existe.',
        hint = 'SHIFT_NOT_FOUND';
    end if;

    new.shift_date := v_shift.shift_date;
    new."window" := tstzrange(
      app.local_ts(v_shift.shift_date, coalesce(new.start_time, v_shift.start_time)),
      app.local_ts(v_shift.shift_date, coalesce(new.end_time, v_shift.end_time)),
      '[)'
    );
    return new;
  elsif tg_table_name = 'shifts' then
    update public.assignments a
    set shift_date = new.shift_date,
        "window" = tstzrange(
          app.local_ts(new.shift_date, coalesce(a.start_time, new.start_time)),
          app.local_ts(new.shift_date, coalesce(a.end_time, new.end_time)),
          '[)'
        )
    where a.shift_id = new.id
      and a.removed_at is null;
    return new;
  end if;

  return new;
end;
$$;

comment on function app.sync_assignment_window() is
  'Trigger: mantiene assignments.shift_date/window (franja efectiva en UTC, "[)" para que dos turnos consecutivos sin hueco no se consideren superpuestos). BEFORE INSERT/UPDATE en assignments recalcula la fila propia; AFTER UPDATE en shifts recalcula las asignaciones VIGENTES del turno (removed_at is null, corregido en 0016_hardening.sql -- antes recalculaba también las quitadas) (04 sección 2.3, P-053).';
