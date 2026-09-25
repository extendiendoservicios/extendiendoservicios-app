-- SHIFT-001 a SHIFT-005 (08_Fases_y_Backlog.md, F10 · Servicios y generación de turnos, P10.1)
--
-- Las cinco RPC de turnos de 04_Modelo_de_Datos.md sección 9 y 06_API.md sección 7: `create_shift`,
-- `generate_shifts`, `update_shift_time`, `cancel_shift`, `reload_shift_tasks`. El plan nombraba
-- este archivo `0013_rpc_shifts.sql` (04 sección 11), pero ese número ya está usado por
-- `0013_rpc_users.sql` desde P04.5: las migraciones no reservan números (decisión del 21 sep 2026,
-- `12_Registro_de_Progreso.md`), así que toma el siguiente libre, `0023`.
--
-- Todas `security definer`, `set search_path = public, app, pg_temp`, `app.require_role`/
-- `app.require_capability` primero (mismo patrón que `0013_rpc_users.sql`), transacción única,
-- error `P0001` con mensaje en voseo y `hint` estable (06 sección 15). Viven en `public` (no
-- `app`): `supabase/config.toml` solo expone `public`/`graphql_public` a PostgREST.
--
-- Contenido, en orden:
--   1. `app.checklist_template_for(client_id, site_id)`: resuelve la plantilla vigente (la de la
--      sede si existe, si no la del cliente, P-058) -- auxiliar interno, no es RPC de la sección 9.
--   2. `app.copy_checklist_to_shift(shift_id)`: copia (o reemplaza, si ya había) los ítems de esa
--      plantilla a `shift_tasks` y fija `shifts.checklist_template_id` (P-061, ADR-011) -- interno,
--      usado por `create_shift`, `generate_shifts` y `reload_shift_tasks` para no triplicar la
--      lógica de copia.
--   3. `create_shift(...)`: turno puntual o manual (P-045). Devuelve `jsonb` con la fila y
--      `warnings` (advertencia `HOLIDAY`, informativa, cuando la fecha es feriado -- 06 sección 15:
--      "no bloquea").
--   4. `generate_shifts(year, month)`: generación mensual idempotente (P-044, ADR-010). Devuelve
--      `jsonb` con `{created, skipped, holidays_skipped}` (06 sección 6).
--   5. `update_shift_time(shift_id, start, end)`: recálculo de ventanas vía el trigger de 0007;
--      anticipa la superposición (`exclusion_violation`, `23P01`) que el trigger puede disparar
--      sobre `assignments` y la traduce a `ASSIGNMENT_OVERLAP` (pendiente anotado desde P04.4,
--      verificado en vivo el 21 sep 2026, `12_Registro_de_Progreso.md` sección "Pendiente").
--   6. `cancel_shift(shift_id, reason)`: motivo obligatorio, capacidad `cancel_shifts`, cancela las
--      supervisiones asignadas del turno; las asignaciones NO se tocan (quedan para historia,
--      P-049).
--   7. `reload_shift_tasks(shift_id)`: solo si el turno sigue `scheduled`/`assigned`.
--   8. Grants: `revoke`/`grant execute` a `authenticated`, mismo patrón que `0017_grants.sql`.
--
-- Decisiones menores (documentadas también en el reporte de la tarea):
--   - `06_API.md` sección 15 no trae mensaje en voseo para `SHIFT_CANCELLED`, `SHIFT_COMPLETED`,
--     `SHIFT_NOT_EDITABLE`, `CANCEL_REASON_REQUIRED` ni `SHIFT_NOT_FOUND` (este último ni siquiera
--     está en la lista de códigos de la sección 7, pero hace falta uno para "ese turno no existe" --
--     mismo criterio que `app.sync_assignment_window`, 0007, que ya usa ese hint). Se redactan acá,
--     mismo criterio que `ROLE_REQUIRES_EMPLOYEE`/`ADMIN_ROLE_REQUIRED` en `0013_rpc_users.sql`.
--   - `create_shift` y `generate_shifts` devuelven `jsonb` (fila más advertencias/contadores, 06
--     sección 0); `update_shift_time` y `cancel_shift` devuelven la fila de `shifts` directamente
--     (no hay advertencia posible para ninguna de las dos: `update_shift_time` no cambia la fecha,
--     así que `HOLIDAY` no aplica). `reload_shift_tasks` devuelve `setof shift_tasks`, igual
--     criterio que `set_user_roles` (0013): la operación reemplaza un conjunto de filas, no hay una
--     única "fila afectada".
--   - `create_shift`/`update_shift_time`/`cancel_shift`/`reload_shift_tasks` no exigen una
--     capacidad de administrador puntual más allá de `require_role('owner','admin')`: 06 sección 7
--     los marca "O, A" a secas, a diferencia de `generate_shifts` ("O, A + generate_shifts") y
--     `cancel_shift` ("O, A + cancel_shifts"), que sí la tienen.

-- ---------------------------------------------------------------------------------------------
-- 1. app.checklist_template_for(p_client_id, p_site_id) -- P-058
-- ---------------------------------------------------------------------------------------------

-- `security definer`: mismo motivo que `app.current_employee_id`/`app.shares_shift` (0007) --
-- `checklist_templates` ya tiene RLS habilitada (sin acceso S/E, 04 sección 7.2) y esta función se
-- llama desde otras `security definer` con el dueño de las funciones, no con `authenticated`.
-- `stable`: mismo resultado dentro de la misma transacción/consulta.
create function app.checklist_template_for(p_client_id uuid, p_site_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select coalesce(
    (
      select ct.id
      from public.checklist_templates ct
      where ct.client_id = p_client_id
        and ct.site_id = p_site_id
        and ct.is_active
        and ct.deleted_at is null
      limit 1
    ),
    (
      select ct.id
      from public.checklist_templates ct
      where ct.client_id = p_client_id
        and ct.site_id is null
        and ct.is_active
        and ct.deleted_at is null
      limit 1
    )
  );
$$;

comment on function app.checklist_template_for(uuid, uuid) is
  'Plantilla vigente para un cliente y una sede (P-058): la propia de la sede si existe, si no la del cliente; null si no hay ninguna. Uso interno de create_shift/generate_shifts/reload_shift_tasks (0023).';

revoke execute on function app.checklist_template_for(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. app.copy_checklist_to_shift(p_shift_id) -- P-061, ADR-011
-- ---------------------------------------------------------------------------------------------

-- Reemplaza el contenido de shift_tasks por el de la plantilla vigente (borra lo que había e
-- inserta de nuevo): sirve tanto para "copiar por primera vez" (create_shift, generate_shifts,
-- turno recién creado sin tareas) como para "recargar" (reload_shift_tasks) sin duplicar lógica.
-- Sin verificación de rol/estado acá adentro: eso lo hace quien llama (reload_shift_tasks exige
-- scheduled/assigned antes de invocarla; create_shift/generate_shifts la llaman apenas crean el
-- turno, siempre en scheduled).
create function app.copy_checklist_to_shift(p_shift_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_template_id uuid;
begin
  select * into v_shift from public.shifts where id = p_shift_id;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  v_template_id := app.checklist_template_for(v_shift.client_id, v_shift.site_id);

  update public.shifts set checklist_template_id = v_template_id where id = p_shift_id;

  delete from public.shift_tasks where shift_id = p_shift_id;

  if v_template_id is not null then
    insert into public.shift_tasks (shift_id, position, title, description, is_required, created_by)
    select p_shift_id, i.position, i.title, i.description, i.is_required, auth.uid()
    from public.checklist_template_items i
    where i.template_id = v_template_id and i.deleted_at is null
    order by i.position;
  end if;
end;
$$;

comment on function app.copy_checklist_to_shift(uuid) is
  'Copia (o reemplaza) los ítems de la plantilla vigente (app.checklist_template_for) a shift_tasks y fija shifts.checklist_template_id (P-061, ADR-011). Un turno sin plantilla vigente queda con cero tareas. Uso interno de create_shift/generate_shifts/reload_shift_tasks (0023).';

revoke execute on function app.copy_checklist_to_shift(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. create_shift(...) -- 04 sección 9, 06 sección 7, P-045
-- ---------------------------------------------------------------------------------------------

create function public.create_shift(
  p_client_id uuid,
  p_site_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_required_staff smallint,
  p_service_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
  v_warnings text[] := array[]::text[];
begin
  perform app.require_role('owner', 'admin');

  if p_end <= p_start then
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

  insert into public.shifts (
    service_id, client_id, site_id, shift_date, start_time, end_time,
    required_staff, status, generated, notes, created_by
  ) values (
    p_service_id, p_client_id, p_site_id, p_date, p_start, p_end,
    p_required_staff, 'scheduled', false, p_notes, auth.uid()
  )
  returning * into v_shift;

  perform app.copy_checklist_to_shift(v_shift.id);

  if exists (select 1 from public.holidays h where h.holiday_date = p_date and h.deleted_at is null) then
    v_warnings := array_append(v_warnings, 'HOLIDAY');
  end if;

  select * into v_shift from public.shifts where id = v_shift.id;

  return jsonb_build_object('shift', to_jsonb(v_shift), 'warnings', v_warnings);
end;
$$;

comment on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text) is
  'Turno puntual o manual (04 sección 9, 06 sección 7, P-045). O, A. CLIENT_NOT_ACTIVE/SITE_NOT_ACTIVE si el cliente o la sede no están activos; INVALID_TIME_RANGE si end <= start. Copia el checklist vigente (app.copy_checklist_to_shift). Devuelve {"shift": <fila>, "warnings": [...]}; "HOLIDAY" (informativo, no bloquea) si la fecha es feriado.';

-- ---------------------------------------------------------------------------------------------
-- 4. generate_shifts(p_year, p_month) -- 04 sección 9, 06 sección 6, P-044, ADR-010
-- ---------------------------------------------------------------------------------------------

-- Recorre, para el mes pedido, cada día de cada servicio `active` vigente cuyo cliente y sede
-- estén activos y cuyo día de semana esté en `weekdays` (04 sección 2.3: 0 = domingo, igual
-- convención que `extract(dow from ...)` de Postgres). Por cada combinación: si el día es feriado
-- y el servicio no trabaja en feriados, cuenta como `holidays_skipped` y no crea nada; si ya existe
-- un turno vigente para ese servicio y esa fecha (la unicidad parcial de 0007 lo evitaría de
-- cualquier forma, pero se verifica antes para no depender de capturar la excepción), cuenta como
-- `skipped`; si no, crea el turno `scheduled`/`generated = true` y copia el checklist. Nunca borra
-- ni modifica un turno existente (P-044): la RPC ni siquiera lo intenta, solo lee para decidir si
-- lo salta. Con un `loop` en vez de un `insert ... select` masivo porque cada turno creado necesita
-- su propia copia de checklist (app.copy_checklist_to_shift) -- medido contra App_dev con un mes
-- típico, ver el reporte de la tarea.
create function public.generate_shifts(p_year int, p_month int)
returns jsonb
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_from date;
  v_to date;
  v_rec record;
  v_shift_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_holidays_skipped int := 0;
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
      s.required_staff,
      s.works_on_holidays,
      d.shift_date,
      (h.holiday_date is not null) as is_holiday
    from public.services s
    join public.clients c on c.id = s.client_id and c.status = 'active'
    join public.sites st on st.id = s.site_id and st.client_id = s.client_id and st.status = 'active'
    cross join lateral (
      select gs::date as shift_date
      from generate_series(v_from, v_to, interval '1 day') as gs
      where extract(dow from gs)::smallint = any(s.weekdays)
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
      service_id, client_id, site_id, shift_date, start_time, end_time,
      required_staff, status, generated, created_by
    ) values (
      v_rec.service_id, v_rec.client_id, v_rec.site_id, v_rec.shift_date,
      v_rec.start_time, v_rec.end_time, v_rec.required_staff, 'scheduled', true, auth.uid()
    )
    returning id into v_shift_id;

    perform app.copy_checklist_to_shift(v_shift_id);

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped, 'holidays_skipped', v_holidays_skipped);
end;
$$;

comment on function public.generate_shifts(int, int) is
  'Genera los turnos faltantes del mes pedido para los servicios active y vigentes con cliente y sede activos (04 sección 9, 06 sección 6, P-044, ADR-010). Respeta days_of_week, feriados (works_on_holidays) y la unicidad (service_id, shift_date); nunca toca un turno existente. Copia el checklist vigente en cada turno creado. Idempotente: una segunda corrida no crea nada. Devuelve {"created", "skipped", "holidays_skipped"}. O, A + generate_shifts.';

-- ---------------------------------------------------------------------------------------------
-- 5. update_shift_time(p_shift_id, p_start, p_end) -- 04 sección 9, 06 sección 7, 6.1
-- ---------------------------------------------------------------------------------------------

-- Reglas de 04 sección 6.1: permitido en scheduled/assigned (cambia inicio y fin); en in_progress
-- solo el fin (si p_start difiere del actual, SHIFT_NOT_EDITABLE); nunca en completed/cancelled.
-- El trigger `trg_sync_assignment_window_from_shift` (0007) recalcula la ventana de las
-- asignaciones vigentes del turno en el mismo `update`; si eso deja a un empleado con dos
-- asignaciones superpuestas, `assignments_no_overlap` (gist, 0007) corta con `exclusion_violation`
-- (23P01) -- un error crudo de Postgres, no un P0001 de dominio. Pendiente anotado desde P04.4,
-- verificado en vivo el 21 sep 2026 (`12_Registro_de_Progreso.md`, "Pendiente"): se anticipa acá
-- con un bloque `exception when exclusion_violation`, así el cliente siempre recibe
-- ASSIGNMENT_OVERLAP con mensaje en voseo, nunca el 23P01 crudo.
create function public.update_shift_time(p_shift_id uuid, p_start time, p_end time)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  perform app.require_role('owner', 'admin');

  select * into v_shift from public.shifts where id = p_shift_id;

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

  if p_end <= p_start then
    raise exception using
      errcode = 'P0001',
      message = 'La hora de fin tiene que ser posterior a la de inicio.',
      hint = 'INVALID_TIME_RANGE';
  end if;

  if v_shift.status = 'in_progress' and p_start is distinct from v_shift.start_time then
    raise exception using
      errcode = 'P0001',
      message = 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  begin
    update public.shifts
    set start_time = p_start, end_time = p_end
    where id = p_shift_id
    returning * into v_shift;
  exception
    when exclusion_violation then
      raise exception using
        errcode = 'P0001',
        message = 'El empleado ya tiene otro turno en ese horario.',
        hint = 'ASSIGNMENT_OVERLAP';
  end;

  return v_shift;
end;
$$;

comment on function public.update_shift_time(uuid, time, time) is
  'Cambia la franja de un turno (04 sección 6.1, 9; 06 sección 7). O, A. SHIFT_CANCELLED/SHIFT_COMPLETED si el turno no admite cambios; SHIFT_NOT_EDITABLE si está in_progress y se intenta cambiar el inicio; INVALID_TIME_RANGE. El trigger de 0007 recalcula la ventana de las asignaciones vigentes; si eso las deja superpuestas, se traduce el exclusion_violation crudo (23P01) a ASSIGNMENT_OVERLAP (pendiente de P04.4, verificado el 21 sep 2026).';

-- ---------------------------------------------------------------------------------------------
-- 6. cancel_shift(p_shift_id, p_reason) -- 04 sección 9, 06 sección 7, P-049
-- ---------------------------------------------------------------------------------------------

-- Las asignaciones del turno NO se tocan (P-049: "conserva sus asignaciones para historia") --
-- ni siquiera se marcan, quedan tal cual estaban. Las supervisiones asignadas (assigned/in_progress,
-- no ya completed/not_done/cancelled) sí se cancelan (04 sección 9: "cancelación de supervisiones
-- asignadas a ese turno").
create function public.cancel_shift(p_shift_id uuid, p_reason text)
returns public.shifts
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  perform app.require_capability('cancel_shifts');

  select * into v_shift from public.shifts where id = p_shift_id;

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

  if p_reason is null or btrim(p_reason) = '' then
    raise exception using
      errcode = 'P0001',
      message = 'Indicá el motivo.',
      hint = 'CANCEL_REASON_REQUIRED';
  end if;

  update public.shifts
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
  where id = p_shift_id
  returning * into v_shift;

  update public.supervisions
  set status = 'cancelled', cancel_reason = 'Turno cancelado: ' || p_reason, updated_by = auth.uid()
  where shift_id = p_shift_id and status in ('assigned', 'in_progress');

  return v_shift;
end;
$$;

comment on function public.cancel_shift(uuid, text) is
  'Cancela un turno con motivo obligatorio (04 sección 9, 6.1; 06 sección 7; P-049). O, A + cancel_shifts. SHIFT_CANCELLED/SHIFT_COMPLETED si ya está en ese estado; CANCEL_REASON_REQUIRED sin motivo. Cancela las supervisiones assigned/in_progress de ese turno. Las asignaciones NO se tocan: quedan para historia.';

-- ---------------------------------------------------------------------------------------------
-- 7. reload_shift_tasks(p_shift_id) -- 04 sección 9, 06 sección 7, ADR-011
-- ---------------------------------------------------------------------------------------------

create function public.reload_shift_tasks(p_shift_id uuid)
returns setof public.shift_tasks
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_shift public.shifts;
begin
  perform app.require_capability('edit_checklists');

  select * into v_shift from public.shifts where id = p_shift_id;

  if v_shift.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'No encontramos ese turno.',
      hint = 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status not in ('scheduled', 'assigned') then
    raise exception using
      errcode = 'P0001',
      message = 'Este turno no admite ese cambio en su estado actual.',
      hint = 'SHIFT_NOT_EDITABLE';
  end if;

  perform app.copy_checklist_to_shift(p_shift_id);

  return query
    select * from public.shift_tasks where shift_id = p_shift_id order by position;
end;
$$;

comment on function public.reload_shift_tasks(uuid) is
  'Reemplaza las tareas del turno por las de la plantilla vigente (04 sección 9, 06 sección 7, ADR-011). O, A + edit_checklists. Solo si el turno sigue scheduled/assigned (si no, SHIFT_NOT_EDITABLE). Devuelve el conjunto de tareas resultante (setof), mismo criterio que set_user_roles (0013) para operaciones que reemplazan varias filas.';

-- ---------------------------------------------------------------------------------------------
-- 8. Grants: execute a authenticated, revocado de public/anon (04 sección 7.2, mismo patrón que
--    0017_grants.sql punto 6) -----------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

revoke execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text) from public, anon;
grant execute on function public.create_shift(uuid, uuid, date, time, time, smallint, uuid, text) to authenticated;

revoke execute on function public.generate_shifts(int, int) from public, anon;
grant execute on function public.generate_shifts(int, int) to authenticated;

revoke execute on function public.update_shift_time(uuid, time, time) from public, anon;
grant execute on function public.update_shift_time(uuid, time, time) to authenticated;

revoke execute on function public.cancel_shift(uuid, text) from public, anon;
grant execute on function public.cancel_shift(uuid, text) to authenticated;

revoke execute on function public.reload_shift_tasks(uuid) from public, anon;
grant execute on function public.reload_shift_tasks(uuid) to authenticated;
