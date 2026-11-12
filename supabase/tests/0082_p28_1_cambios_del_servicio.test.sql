-- pgTAP de la migración 0082_p28_1_observaciones_11_nov.sql (P28.1), parte 3:
--   OF-05 preview_service_changes y apply_service_changes: los cambios guardados en el servicio
--   llegan a sus turnos (borra lo que ya no corresponde, actualiza lo que sigue revalidando a los
--   asignados, genera lo que falta en los meses que ya tenían turnos, saltea lo que no se toca).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f82c0000-...'. Fechas de 2199 (el 2199-07-01 es lunes) salvo un turno de hoy
-- a las 00:00 (siempre ya empezado), así el resultado no depende de la hora de la corrida.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0082c;
grant usage on schema tests_0082c to authenticated, anon;

create or replace function tests_0082c.as_user(p_email text)
returns void
language plpgsql
as $$
declare
  v_user_id uuid;
  v_claims jsonb;
begin
  perform set_config('role', 'postgres', true);
  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'tests_0082c.as_user: no existe auth.users.email = %', p_email;
  end if;
  v_claims := (
    app.custom_access_token_hook(
      jsonb_build_object(
        'user_id', v_user_id::text,
        'claims', jsonb_build_object('sub', v_user_id::text, 'email', p_email, 'role', 'authenticated')
      )
    )
  ) -> 'claims';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', v_claims::text, true);
end;
$$;

grant execute on function tests_0082c.as_user(text) to authenticated, anon;

create or replace function tests_0082c.err(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
  v_msg text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('hint', v_hint, 'message', v_msg, 'detail', v_detail, 'state', sqlstate);
end;
$$;

grant execute on function tests_0082c.err(text) to authenticated, anon;

select plan(47);

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'preview_service_changes', array['uuid', 'date', 'jsonb'], 'preview_service_changes');
select has_function('public', 'apply_service_changes', array['uuid', 'date', 'jsonb'], 'apply_service_changes');
select ok(
  not has_function_privilege('anon', 'public.apply_service_changes(uuid, date, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.apply_service_changes(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'app.service_changes_run(uuid, date, jsonb)', 'execute'),
  'grants: authenticated sí, anon no; el cuerpo interno no es de nadie'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f82c0000-0000-0000-0000-000000000001', 'Cliente 0082c', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f82c0000-0000-0000-0000-000000000011', 'f82c0000-0000-0000-0000-000000000001', 'Sede 0082c', 'Dirección 82c', -34.6, -58.4, 'active'),
  ('f82c0000-0000-0000-0000-000000000012', 'f82c0000-0000-0000-0000-000000000001', 'Sede 0082c bis', 'Dirección 82c bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f82c0000-0000-0000-0000-000000000081', 'test-db0082c-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Tres')),
  ('f82c0000-0000-0000-0000-000000000082', 'test-db0082c-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Tres')),
  ('f82c0000-0000-0000-0000-000000000091', 'test-db0082c-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Tres')),
  ('f82c0000-0000-0000-0000-0000000000a1', 'test-db0082c-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f82c0000-0000-0000-0000-0000000000a2', 'test-db0082c-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter')),
  ('f82c0000-0000-0000-0000-0000000000a3', 'test-db0082c-a3@example.com', jsonb_build_object('first_name', 'Camila', 'last_name', 'Cabrera'));

insert into public.user_roles (profile_id, role) values
  ('f82c0000-0000-0000-0000-000000000081', 'owner'),
  ('f82c0000-0000-0000-0000-000000000082', 'admin'),
  ('f82c0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f82c0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f82c0000-0000-0000-0000-0000000000a2', 'employee'),
  ('f82c0000-0000-0000-0000-0000000000a3', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f82c0000-0000-0000-0000-000000000091', '98203091', 'active'),
  ('f82c0000-0000-0000-0000-0000000000a1', '98203101', 'active'),
  ('f82c0000-0000-0000-0000-0000000000a2', '98203102', 'active'),
  ('f82c0000-0000-0000-0000-0000000000a3', '98203103', 'active');

insert into public.holidays (id, holiday_date, name) values
  ('f82c0000-0000-0000-0000-0000000000b1', '2199-07-15', 'Feriado de prueba 0082c');

-- El servicio ya guardado con los valores NUEVOS: lunes y viernes, 9 a 13, dotación 3, con fotos, sin
-- trabajar feriados y vigente hasta el 31/7. Antes era lunes y miércoles, 8 a 12, dotación 2, sin
-- fotos y con feriados. Fija: Cabrera.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, requires_photos, works_on_holidays, valid_from, valid_to, status) values
  ('f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', 'Servicio cambiado 0082c', array[1, 5]::smallint[], '09:00', '13:00', 3, true, false, '2199-01-01', '2199-07-31', 'active');
insert into public.service_fixed_employees (service_id, employee_id) values
  ('f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-0000000000a3');

-- Turnos viejos (8 a 12, dotación 2, sin fotos), desde p_from_date = 2199-07-08:
--   07-01 lun  anterior a la fecha: no se toca
--   07-08 lun  sigue: se actualiza; Acosta (asignada) queda superpuesta con un turno manual
--   07-10 mié  ya no es día del servicio: se borra
--   07-15 lun  feriado: se borra (con Boutter asignada)
--   07-17 mié  ya no es día, pero tiene fichaje: se saltea (HAS_HISTORY)
--   07-22 lun  horario cambiado a mano (10 a 12): conserva el horario, sigue con dotación y fotos
--   07-24 mié  cancelado: se saltea
--   07-29 lun  sigue: se actualiza
--   07-31 mié  creado a mano: se saltea
--   08-05 lun  fuera de vigencia: se borra
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, requires_photos, status, generated) values
  ('f82c0000-0000-0000-0000-000000000300', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-01', '08:00', '12:00', 2, false, 'scheduled', true),
  ('f82c0000-0000-0000-0000-000000000301', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-08', '08:00', '12:00', 2, false, 'assigned', true),
  ('f82c0000-0000-0000-0000-000000000302', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-10', '08:00', '12:00', 2, false, 'scheduled', true),
  ('f82c0000-0000-0000-0000-000000000303', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-15', '08:00', '12:00', 2, false, 'assigned', true),
  ('f82c0000-0000-0000-0000-000000000304', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-17', '08:00', '12:00', 2, false, 'assigned', true),
  ('f82c0000-0000-0000-0000-000000000305', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-22', '10:00', '12:00', 2, false, 'scheduled', true),
  ('f82c0000-0000-0000-0000-000000000307', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-29', '08:00', '12:00', 2, false, 'scheduled', true),
  ('f82c0000-0000-0000-0000-000000000308', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-31', '08:00', '12:00', 2, false, 'scheduled', false),
  ('f82c0000-0000-0000-0000-000000000309', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-08-05', '08:00', '12:00', 2, false, 'scheduled', true);
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, requires_photos, status, generated, cancelled_at, cancelled_by, cancel_reason) values
  ('f82c0000-0000-0000-0000-000000000306', 'f82c0000-0000-0000-0000-000000000021', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-24', '08:00', '12:00', 2, false, 'cancelled', true, now(), 'f82c0000-0000-0000-0000-000000000081', 'Cancelado de prueba');

-- Turno manual de Acosta el 07-08 de 12:30 a 13:30 en otra sede: el nuevo horario (9 a 13) la pisa.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f82c0000-0000-0000-0000-000000000310', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000012', '2199-07-08', '12:30', '13:30', 1, 'assigned');

insert into public.assignments (id, shift_id, employee_id) values
  ('f82c0000-0000-0000-0000-000000000401', 'f82c0000-0000-0000-0000-000000000301', 'f82c0000-0000-0000-0000-0000000000a1'),
  ('f82c0000-0000-0000-0000-000000000402', 'f82c0000-0000-0000-0000-000000000301', 'f82c0000-0000-0000-0000-0000000000a2'),
  ('f82c0000-0000-0000-0000-000000000403', 'f82c0000-0000-0000-0000-000000000303', 'f82c0000-0000-0000-0000-0000000000a2'),
  ('f82c0000-0000-0000-0000-000000000404', 'f82c0000-0000-0000-0000-000000000304', 'f82c0000-0000-0000-0000-0000000000a2'),
  ('f82c0000-0000-0000-0000-000000000405', 'f82c0000-0000-0000-0000-000000000310', 'f82c0000-0000-0000-0000-0000000000a1');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f82c0000-0000-0000-0000-000000000404', 'check_in', now(), 'employee_app');

-- Permisos y errores -----------------------------------------------------------------------------

select tests_0082c.as_user('test-db0082c-sup@example.com');
select is(tests_0082c.err($$select public.preview_service_changes('f82c0000-0000-0000-0000-000000000021', '2199-07-08')$$) ->> 'hint', 'FORBIDDEN', 'un coordinador no ve la vista previa');
select tests_0082c.as_user('test-db0082c-a1@example.com');
select is(tests_0082c.err($$select public.apply_service_changes('f82c0000-0000-0000-0000-000000000021', '2199-07-08')$$) ->> 'hint', 'FORBIDDEN', 'un empleado no aplica cambios');

select tests_0082c.as_user('test-db0082c-admin@example.com');
select is(tests_0082c.err($$select public.apply_service_changes('f82c0000-0000-0000-0000-000000000021', null)$$) ->> 'hint', 'FROM_DATE_REQUIRED', 'la fecha es obligatoria');
select is(tests_0082c.err($$select public.apply_service_changes('f82c0000-0000-0000-0000-0000000000ff', '2199-07-08')$$) ->> 'hint', 'SERVICE_NOT_FOUND', 'servicio inexistente');
select is(tests_0082c.err($$select public.preview_service_changes('f82c0000-0000-0000-0000-0000000000ff', '2199-07-08')$$) ->> 'hint', 'SERVICE_NOT_FOUND', 'la vista previa también informa el servicio inexistente');
select is(tests_0082c.err($$select public.apply_service_changes('f82c0000-0000-0000-0000-000000000021', '2199-07-08', '"texto"'::jsonb)$$) ->> 'hint', 'INVALID_PREVIOUS', 'los valores anteriores tienen que ser un objeto');
select is(tests_0082c.err($$select public.apply_service_changes('f82c0000-0000-0000-0000-000000000021', '2199-07-08', '{"start_time": "no es una hora", "end_time": "12:00"}'::jsonb)$$) ->> 'hint', 'INVALID_PREVIOUS', 'ni traer horas inválidas');

-- Vista previa -----------------------------------------------------------------------------------

select set_config(
  'tests_0082c.p',
  public.preview_service_changes(
    'f82c0000-0000-0000-0000-000000000021', '2199-07-08',
    '{"start_time": "08:00", "end_time": "12:00", "open_ended": false, "required_staff": 2, "requires_photos": false}'::jsonb
  )::text,
  true
) is not null as vista_previa;

select is((select current_setting('tests_0082c.p')::jsonb ->> 'preview'), 'true', 'la vista previa se marca como tal');
select is((select current_setting('tests_0082c.p')::jsonb ->> 'deleted_count'), '3', 'vista previa: 3 turnos a borrar');
select is((select current_setting('tests_0082c.p')::jsonb ->> 'updated_count'), '3', 'vista previa: 3 turnos a actualizar');
select is((select current_setting('tests_0082c.p')::jsonb ->> 'created_count'), '3', 'vista previa: 3 turnos a crear');

set local role postgres;
select is(
  (select count(*)::int from public.shifts where service_id = 'f82c0000-0000-0000-0000-000000000021' and shift_date >= '2199-07-08'),
  9, 'la vista previa no dejó nada escrito: siguen los 9 turnos'
);
select is(
  (select start_time::text from public.shifts where id = 'f82c0000-0000-0000-0000-000000000301'),
  '08:00:00', 'ni cambió el horario'
);
select is(
  (select removed_at is null from public.assignments where id = 'f82c0000-0000-0000-0000-000000000401'),
  true, 'ni quitó asignaciones'
);
select is(
  (select count(*)::int from public.security_events where event_type = 'record_deleted' and details ->> 'record_id' = 'f82c0000-0000-0000-0000-000000000021'),
  0, 'ni dejó eventos'
);

-- Aplicar ----------------------------------------------------------------------------------------

select tests_0082c.as_user('test-db0082c-admin@example.com');
select set_config(
  'tests_0082c.a',
  public.apply_service_changes(
    'f82c0000-0000-0000-0000-000000000021', '2199-07-08',
    '{"start_time": "08:00", "end_time": "12:00", "open_ended": false, "required_staff": 2, "requires_photos": false}'::jsonb
  )::text,
  true
) is not null as aplicado;

select is((select current_setting('tests_0082c.a')::jsonb ->> 'preview'), 'false', 'apply_service_changes no es vista previa');
select is(
  (select (current_setting('tests_0082c.a')::jsonb - 'preview' - 'created' - 'event_id' - 'deleted' - 'updated' - 'skipped' - 'unassigned' - 'months')
        = (current_setting('tests_0082c.p')::jsonb - 'preview' - 'created' - 'event_id' - 'deleted' - 'updated' - 'skipped' - 'unassigned' - 'months')),
  true, 'los conteos de aplicar coinciden con los de la vista previa'
);
select is((select current_setting('tests_0082c.a')::jsonb ->> 'deleted_count'), '3', 'borrados: 3');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'updated_count'), '3', 'actualizados: 3');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'created_count'), '3', 'creados: 3 (los viernes 12, 19 y 26 de julio)');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'skipped_count'), '3', 'salteados: 3');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'partial_count'), '2', 'parciales: el del asignado quitado y el del horario conservado');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'assignments_removed'), '2', 'asignaciones quitadas: Acosta por superposición y Boutter del turno borrado');
select is((select current_setting('tests_0082c.a')::jsonb ->> 'assignments_added'), '3', 'asignaciones nuevas: la fija en los tres viernes');
select is(
  (select jsonb_object_agg(d ->> 'shift_date', d ->> 'reason') from jsonb_array_elements(current_setting('tests_0082c.a')::jsonb -> 'deleted') d),
  '{"2199-07-10": "WEEKDAY", "2199-07-15": "HOLIDAY", "2199-08-05": "OUT_OF_VALIDITY"}'::jsonb,
  'los borrados dicen por qué: día de la semana, feriado y fuera de vigencia'
);
select is(
  (select jsonb_object_agg(s ->> 'shift_date', s ->> 'code') from jsonb_array_elements(current_setting('tests_0082c.a')::jsonb -> 'skipped') s),
  '{"2199-07-17": "HAS_HISTORY", "2199-07-24": "SHIFT_CANCELLED", "2199-07-31": "MANUAL_SHIFT"}'::jsonb,
  'los salteados dicen por qué: con historia, cancelado, creado a mano'
);
select is(
  (select e -> 'removed' -> 0 ->> 'code'
   from jsonb_array_elements(current_setting('tests_0082c.a')::jsonb -> 'updated') e
   where e ->> 'shift_date' = '2199-07-08'),
  'ASSIGNMENT_OVERLAP', 'el asignado que queda superpuesto se informa'
);
select is(
  (select e -> 'removed' -> 0 ->> 'message'
   from jsonb_array_elements(current_setting('tests_0082c.a')::jsonb -> 'updated') e
   where e ->> 'shift_date' = '2199-07-08'),
  'Acosta ya está en Sede 0082c bis (turno manual) el lun 8/7 de 12:30 a 13:30.',
  'con el mensaje de OF-08 (dónde choca)'
);
select is(
  (select e -> 'kept' -> 0 ->> 'code'
   from jsonb_array_elements(current_setting('tests_0082c.a')::jsonb -> 'updated') e
   where e ->> 'shift_date' = '2199-07-22'),
  'MANUAL_TIME', 'el turno con horario cambiado a mano lo conserva y lo dice'
);
select is((select jsonb_array_length(current_setting('tests_0082c.a')::jsonb -> 'months')), 2, 'meses con turnos generados: julio y agosto');

set local role postgres;
select is(
  (select start_time::text || '-' || end_time::text || ' / ' || required_staff || ' / ' || requires_photos
   from public.shifts where id = 'f82c0000-0000-0000-0000-000000000301'),
  '09:00:00-13:00:00 / 3 / true', 'el turno del 08/7 quedó con el horario, la dotación y las fotos del servicio'
);
select is(
  (select status::text from public.shifts where id = 'f82c0000-0000-0000-0000-000000000301'),
  'scheduled', 'y con la dotación incompleta volvió a «scheduled»'
);
select is(
  (select removed_reason from public.assignments where id = 'f82c0000-0000-0000-0000-000000000401'),
  'Cambio de horario del servicio: ASSIGNMENT_OVERLAP', 'la asignada superpuesta se quitó con su motivo'
);
select is(
  (select removed_at is null from public.assignments where id = 'f82c0000-0000-0000-0000-000000000402'),
  true, 'quien no se superpone sigue asignada'
);
select is(
  (select start_time::text || ' / ' || required_staff || ' / ' || requires_photos
   from public.shifts where id = 'f82c0000-0000-0000-0000-000000000305'),
  '10:00:00 / 3 / true', 'el turno con horario a mano conserva su hora y recibe dotación y fotos'
);
select is(
  (select start_time::text from public.shifts where id = 'f82c0000-0000-0000-0000-000000000300'),
  '08:00:00', 'el turno anterior a la fecha no se tocó'
);
select is(
  (select count(*)::int from public.shifts where id in ('f82c0000-0000-0000-0000-000000000302', 'f82c0000-0000-0000-0000-000000000303', 'f82c0000-0000-0000-0000-000000000309')),
  0, 'los tres turnos que ya no corresponden se borraron'
);
select is(
  (select count(*)::int from public.shifts where id in ('f82c0000-0000-0000-0000-000000000304', 'f82c0000-0000-0000-0000-000000000306', 'f82c0000-0000-0000-0000-000000000308')),
  3, 'el de la historia, el cancelado y el creado a mano siguen'
);
select is(
  (select array_agg(shift_date::text order by shift_date) from public.shifts
   where service_id = 'f82c0000-0000-0000-0000-000000000021' and generated and created_at > now() - interval '1 minute' and shift_date in ('2199-07-12', '2199-07-19', '2199-07-26')),
  array['2199-07-12', '2199-07-19', '2199-07-26'], 'se generaron los viernes que faltaban'
);
select is(
  (select count(*)::int from public.assignments a join public.shifts sh on sh.id = a.shift_id
   where sh.service_id = 'f82c0000-0000-0000-0000-000000000021' and sh.shift_date in ('2199-07-12', '2199-07-19', '2199-07-26')
     and a.employee_id = 'f82c0000-0000-0000-0000-0000000000a3' and a.removed_at is null),
  3, 'con la fija asignada en cada uno'
);
select is(
  (select count(*)::int from public.security_events where event_type = 'record_deleted' and details ->> 'entity' = 'service_changes' and details ->> 'record_id' = 'f82c0000-0000-0000-0000-000000000021'),
  1, 'los borrados dejaron un evento record_deleted'
);

-- Segunda aplicación: ya no hay nada que borrar ni crear ni actualizar --------------------------------

select tests_0082c.as_user('test-db0082c-owner@example.com');
select is(
  (select public.apply_service_changes('f82c0000-0000-0000-0000-000000000021', '2199-07-08') ->> 'deleted_count'),
  '0', 'es idempotente: la segunda vez no borra nada'
);

-- Sin p_previous: se fuerza el valor del servicio; y un turno que ya empezó no se toca ------------------

set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f82c0000-0000-0000-0000-000000000022', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', 'Servicio forzado 0082c', array[0, 1, 2, 3, 4, 5, 6]::smallint[], '09:00', '11:00', 1, app.today() - 1, 'active');
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f82c0000-0000-0000-0000-000000000321', 'f82c0000-0000-0000-0000-000000000022', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', '2199-07-09', '09:00', '12:00', 1, 'scheduled', true),
  ('f82c0000-0000-0000-0000-000000000322', 'f82c0000-0000-0000-0000-000000000022', 'f82c0000-0000-0000-0000-000000000001', 'f82c0000-0000-0000-0000-000000000011', app.today(), '00:00', '00:01', 1, 'scheduled', true);

select tests_0082c.as_user('test-db0082c-admin@example.com');
select set_config('tests_0082c.f', public.apply_service_changes('f82c0000-0000-0000-0000-000000000022', '2199-07-01')::text, true) is not null as forzado;
select is(
  (select e -> 'changes' -> 'time' -> 'to' ->> 'end_time'
   from jsonb_array_elements(current_setting('tests_0082c.f')::jsonb -> 'updated') e
   where e ->> 'shift_date' = '2199-07-09'),
  '11:00:00', 'sin p_previous el horario del servicio se fuerza'
);

select set_config('tests_0082c.g', public.apply_service_changes('f82c0000-0000-0000-0000-000000000022', app.today())::text, true) is not null as hoy;
select is(
  (select s ->> 'code' from jsonb_array_elements(current_setting('tests_0082c.g')::jsonb -> 'skipped') s where s ->> 'shift_id' = 'f82c0000-0000-0000-0000-000000000322'),
  'SHIFT_STARTED', 'un turno que ya empezó se saltea'
);

select * from finish();

rollback;
