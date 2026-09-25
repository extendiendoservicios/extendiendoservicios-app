-- pgTAP de la migración 0023_rpc_shifts.sql (SHIFT-001 a SHIFT-006, F10 · Servicios y generación
-- de turnos, P10.1): create_shift, update_shift_time, cancel_shift, reload_shift_tasks, y los
-- permisos por rol de las cuatro. `generate_shifts` tiene su propio archivo
-- (0023_rpc_shifts_generate.test.sql) por tamaño (fixtures de un mes completo).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2300000-...'. Fechas en
-- 2199 (fuera del rango real de uso, ver `12_Registro_de_Progreso.md` sección "Pendiente": "Los
-- pgTAP corren contra App_dev, que tiene datos reales de uso").

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.as_user(p_email text)
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
    raise exception 'tests.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests.as_user(text) to authenticated, anon;

select plan(40);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'create_shift', array['uuid', 'uuid', 'date', 'time', 'time', 'smallint', 'uuid', 'text'], 'existe public.create_shift(...)');
select has_function('public', 'update_shift_time', array['uuid', 'time', 'time'], 'existe public.update_shift_time(uuid, time, time)');
select has_function('public', 'cancel_shift', array['uuid', 'text'], 'existe public.cancel_shift(uuid, text)');
select has_function('public', 'reload_shift_tasks', array['uuid'], 'existe public.reload_shift_tasks(uuid)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: dos clientes (uno activo, uno suspendido), sedes (una activa, una inactiva),
-- plantillas de checklist (una de cliente, una de sede -- P-058: precedencia de la de sede),
-- un servicio (para probar create_shift con service_id), dos empleados y personas con los cuatro
-- roles y las capacidades relevantes (cancel_shifts, edit_checklists) activadas o no.
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2300000-0000-0000-0000-000000000001', 'Cliente activo de turnos', 'active'),
  ('e2300000-0000-0000-0000-000000000002', 'Cliente suspendido de turnos', 'suspended');

insert into public.sites (id, client_id, name, address, status) values
  ('e2300000-0000-0000-0000-000000000011', 'e2300000-0000-0000-0000-000000000001', 'Sede activa', 'Dirección 1', 'active'),
  ('e2300000-0000-0000-0000-000000000012', 'e2300000-0000-0000-0000-000000000001', 'Sede inactiva', 'Dirección 2', 'inactive');

insert into public.checklist_templates (id, client_id, site_id, name) values
  ('e2300000-0000-0000-0000-000000000021', 'e2300000-0000-0000-0000-000000000001', null, 'Plantilla del cliente'),
  ('e2300000-0000-0000-0000-000000000022', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', 'Plantilla de la sede');

insert into public.checklist_template_items (template_id, position, title) values
  ('e2300000-0000-0000-0000-000000000021', 1, 'Ítem del cliente 1'),
  ('e2300000-0000-0000-0000-000000000021', 2, 'Ítem del cliente 2'),
  ('e2300000-0000-0000-0000-000000000022', 1, 'Ítem de la sede 1');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2300000-0000-0000-0000-000000000081', 'test-db023-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Turnos')),
  ('e2300000-0000-0000-0000-000000000082', 'test-db023-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('e2300000-0000-0000-0000-000000000083', 'test-db023-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('e2300000-0000-0000-0000-000000000084', 'test-db023-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e2300000-0000-0000-0000-000000000085', 'test-db023-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado')),
  ('e2300000-0000-0000-0000-000000000086', 'test-db023-empleado-x@example.com', jsonb_build_object('first_name', 'Empleado', 'last_name', 'Equis'));

insert into public.user_roles (profile_id, role) values
  ('e2300000-0000-0000-0000-000000000081', 'owner'),
  ('e2300000-0000-0000-0000-000000000082', 'admin'),
  ('e2300000-0000-0000-0000-000000000083', 'admin'),
  ('e2300000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2300000-0000-0000-0000-000000000085', 'employee'),
  ('e2300000-0000-0000-0000-000000000086', 'employee');

-- admin-con-cap tiene cancel_shifts y edit_checklists; admin-sin-cap no tiene ninguna de las dos.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2300000-0000-0000-0000-000000000082', 'cancel_shifts', true),
  ('e2300000-0000-0000-0000-000000000082', 'edit_checklists', true),
  ('e2300000-0000-0000-0000-000000000083', 'cancel_shifts', false),
  ('e2300000-0000-0000-0000-000000000083', 'edit_checklists', false);

insert into public.employees (profile_id, dni) values
  ('e2300000-0000-0000-0000-000000000084', '92300084'),
  ('e2300000-0000-0000-0000-000000000085', '92300085'),
  ('e2300000-0000-0000-0000-000000000086', '92300086');

-- ---------------------------------------------------------------------------------------------
-- create_shift ----------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Un supervisor no puede llamarla.
select tests.as_user('test-db023-supervisora@example.com');

prepare create_shift_as_supervisor as
  select public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-02', '08:00', '12:00', 2::smallint
  );

select throws_ok(
  'create_shift_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'create_shift: un supervisor no puede llamarla (FORBIDDEN)'
);

-- Un empleado tampoco.
select tests.as_user('test-db023-empleado@example.com');

prepare create_shift_as_employee as
  select public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-02', '08:00', '12:00', 2::smallint
  );

select throws_ok(
  'create_shift_as_employee', 'P0001', 'No tenés permiso para hacer esto.',
  'create_shift: un empleado no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- El owner sí puede: INVALID_TIME_RANGE con end <= start.
select tests.as_user('test-db023-owner@example.com');

prepare create_shift_invalid_range as
  select public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-02', '12:00', '08:00', 2::smallint
  );

select throws_ok(
  'create_shift_invalid_range', 'P0001', 'La hora de fin tiene que ser posterior a la de inicio.',
  'create_shift: end <= start -> INVALID_TIME_RANGE'
);

-- CLIENT_NOT_ACTIVE con el cliente suspendido.
prepare create_shift_client_suspended as
  select public.create_shift(
    'e2300000-0000-0000-0000-000000000002', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-02', '08:00', '12:00', 2::smallint
  );

select throws_ok(
  'create_shift_client_suspended', 'P0001', 'El cliente no está activo.',
  'create_shift: cliente suspendido -> CLIENT_NOT_ACTIVE'
);

-- SITE_NOT_ACTIVE con la sede inactiva.
prepare create_shift_site_inactive as
  select public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000012',
    '2199-03-02', '08:00', '12:00', 2::smallint
  );

select throws_ok(
  'create_shift_site_inactive', 'P0001', 'La sede no está activa.',
  'create_shift: sede inactiva -> SITE_NOT_ACTIVE'
);

-- Alta correcta: copia la plantilla de la SEDE (precedencia sobre la del cliente, P-058) y no
-- trae advertencia de feriado (2199-03-02 no está en holidays).
select is(
  (public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-02', '08:00', '12:00', 2::smallint
  ) ->> 'warnings')::jsonb,
  '[]'::jsonb,
  'create_shift: sin advertencias cuando la fecha no es feriado'
);

set local role postgres;

select is(
  (select checklist_template_id from public.shifts where client_id = 'e2300000-0000-0000-0000-000000000001' and shift_date = '2199-03-02' and site_id = 'e2300000-0000-0000-0000-000000000011'),
  'e2300000-0000-0000-0000-000000000022'::uuid,
  'create_shift: usa la plantilla de la sede cuando existe (P-058)'
);

select is(
  (select count(*)::int from public.shift_tasks st join public.shifts sh on sh.id = st.shift_id where sh.shift_date = '2199-03-02' and sh.client_id = 'e2300000-0000-0000-0000-000000000001'),
  1,
  'create_shift: copia exactamente el ítem de la plantilla de la sede (no la del cliente)'
);

-- Alta en una sede SIN plantilla propia: usa la del cliente.
insert into public.sites (id, client_id, name, address, status)
values ('e2300000-0000-0000-0000-000000000013', 'e2300000-0000-0000-0000-000000000001', 'Sede sin plantilla propia', 'Dirección 3', 'active');

select tests.as_user('test-db023-owner@example.com');

select is(
  (public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000013',
    '2199-03-03', '08:00', '12:00', 1::smallint
  ) -> 'shift' ->> 'checklist_template_id'),
  'e2300000-0000-0000-0000-000000000021',
  'create_shift: sin plantilla de sede, usa la del cliente (P-058)'
);

set local role postgres;

select is(
  (select count(*)::int from public.shift_tasks st join public.shifts sh on sh.id = st.shift_id where sh.shift_date = '2199-03-03' and sh.client_id = 'e2300000-0000-0000-0000-000000000001'),
  2,
  'create_shift: copia los dos ítems de la plantilla del cliente'
);

-- Advertencia HOLIDAY (informativa, no bloquea) cuando la fecha es feriado.
insert into public.holidays (holiday_date, name) values ('2199-03-04', 'Feriado de prueba 0023');

select tests.as_user('test-db023-owner@example.com');

select is(
  (public.create_shift(
    'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011',
    '2199-03-04', '08:00', '12:00', 1::smallint
  ) ->> 'warnings')::jsonb,
  '["HOLIDAY"]'::jsonb,
  'create_shift: advierte HOLIDAY (no bloquea) cuando la fecha es feriado'
);

set local role postgres;

select is(
  (select status::text from public.shifts where client_id = 'e2300000-0000-0000-0000-000000000001' and shift_date = '2199-03-04'),
  'scheduled',
  'create_shift: el turno se crea igual (HOLIDAY no bloquea)'
);

-- ---------------------------------------------------------------------------------------------
-- update_shift_time -------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Dos turnos el mismo día (2199-03-05) que no se pisan, con un empleado asignado a ambos.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff) values
  ('e2300000-0000-0000-0000-000000000041', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-05', '08:00', '12:00', 1),
  ('e2300000-0000-0000-0000-000000000042', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-05', '13:00', '17:00', 1);

insert into public.assignments (shift_id, employee_id) values
  ('e2300000-0000-0000-0000-000000000041', 'e2300000-0000-0000-0000-000000000086'),
  ('e2300000-0000-0000-0000-000000000042', 'e2300000-0000-0000-0000-000000000086');

-- Un empleado no puede llamarla.
select tests.as_user('test-db023-empleado@example.com');

prepare update_time_as_employee as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000041', '09:00', '12:00');

select throws_ok(
  'update_time_as_employee', 'P0001', 'No tenés permiso para hacer esto.',
  'update_shift_time: un empleado no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- SHIFT_NOT_FOUND.
select tests.as_user('test-db023-owner@example.com');

prepare update_time_not_found as
  select public.update_shift_time('00000000-0000-0000-0000-000000000000', '08:00', '12:00');

select throws_ok(
  'update_time_not_found', 'P0001', 'No encontramos ese turno.',
  'update_shift_time: turno inexistente -> SHIFT_NOT_FOUND'
);

-- INVALID_TIME_RANGE.
prepare update_time_invalid_range as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000041', '12:00', '08:00');

select throws_ok(
  'update_time_invalid_range', 'P0001', 'La hora de fin tiene que ser posterior a la de inicio.',
  'update_shift_time: end <= start -> INVALID_TIME_RANGE'
);

-- ASSIGNMENT_OVERLAP: extender el turno 2 (13-17) para que empiece a las 11:00 lo hace pisar con
-- el turno 1 (08-12), y el mismo empleado está asignado a los dos -> el trigger de 0007 dispara
-- la exclusión (23P01), la RPC la traduce a un error de dominio.
prepare update_time_overlap as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000042', '11:00', '17:00');

select throws_ok(
  'update_time_overlap', 'P0001', 'El empleado ya tiene otro turno en ese horario.',
  'update_shift_time: deja a un empleado con dos asignaciones superpuestas -> ASSIGNMENT_OVERLAP (no el 23P01 crudo)'
);

set local role postgres;

-- La franja NO cambió: la transacción interna de la RPC deshizo el update fallido.
select is(
  (select end_time::text from public.shifts where id = 'e2300000-0000-0000-0000-000000000042'),
  '17:00:00',
  'update_shift_time: el intento fallido no modificó la fila (end_time sigue en 17:00, no cambió el start que se pidió)'
);

select is(
  (select start_time::text from public.shifts where id = 'e2300000-0000-0000-0000-000000000042'),
  '13:00:00',
  'update_shift_time: el intento fallido no modificó start_time'
);

-- Cambio válido: el turno 1 pasa de 08-12 a 09-12 (sin pisar el turno 2, que sigue en 13-17).
select tests.as_user('test-db023-owner@example.com');

select is(
  (public.update_shift_time('e2300000-0000-0000-0000-000000000041', '09:00', '12:00')).start_time::text,
  '09:00:00',
  'update_shift_time: cambio válido aplica start_time'
);

set local role postgres;

select is(
  (select "window" from public.assignments where shift_id = 'e2300000-0000-0000-0000-000000000041')::text,
  tstzrange(app.local_ts('2199-03-05', '09:00'), app.local_ts('2199-03-05', '12:00'), '[)')::text,
  'update_shift_time: el trigger de 0007 recalculó la ventana de la asignación vigente'
);

-- SHIFT_STARTED / in_progress: solo se puede cambiar el fin.
update public.shifts set status = 'in_progress' where id = 'e2300000-0000-0000-0000-000000000041';

select tests.as_user('test-db023-owner@example.com');

prepare update_time_in_progress_start as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000041', '08:00', '13:00');

select throws_ok(
  'update_time_in_progress_start', 'P0001', 'El turno ya está en curso: solo se puede cambiar la hora de fin.',
  'update_shift_time: in_progress, intenta cambiar el inicio -> SHIFT_NOT_EDITABLE'
);

select is(
  (public.update_shift_time('e2300000-0000-0000-0000-000000000041', '09:00', '13:00')).end_time::text,
  '13:00:00',
  'update_shift_time: in_progress, solo cambia el fin -> se aplica'
);

set local role postgres;

-- SHIFT_CANCELLED / SHIFT_COMPLETED.
update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'e2300000-0000-0000-0000-000000000081', cancel_reason = 'motivo de prueba' where id = 'e2300000-0000-0000-0000-000000000041';
update public.shifts set status = 'completed' where id = 'e2300000-0000-0000-0000-000000000042';

select tests.as_user('test-db023-owner@example.com');

prepare update_time_cancelled as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000041', '09:00', '12:00');

select throws_ok(
  'update_time_cancelled', 'P0001', 'Este turno está cancelado.',
  'update_shift_time: turno cancelado -> SHIFT_CANCELLED'
);

prepare update_time_completed as
  select public.update_shift_time('e2300000-0000-0000-0000-000000000042', '13:00', '17:00');

select throws_ok(
  'update_time_completed', 'P0001', 'Este turno ya terminó.',
  'update_shift_time: turno finalizado -> SHIFT_COMPLETED'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- cancel_shift ------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2300000-0000-0000-0000-000000000051', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-06', '08:00', '12:00', 1, 'scheduled'),
  ('e2300000-0000-0000-0000-000000000052', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-06', '13:00', '17:00', 1, 'completed');

insert into public.assignments (shift_id, employee_id) values ('e2300000-0000-0000-0000-000000000051', 'e2300000-0000-0000-0000-000000000085');
insert into public.supervisions (shift_id, supervisor_id, status) values ('e2300000-0000-0000-0000-000000000051', 'e2300000-0000-0000-0000-000000000084', 'assigned');

-- Un admin sin cancel_shifts no puede llamarla.
select tests.as_user('test-db023-admin-sin-cap@example.com');

prepare cancel_as_admin_no_cap as
  select public.cancel_shift('e2300000-0000-0000-0000-000000000051', 'motivo');

select throws_ok(
  'cancel_as_admin_no_cap', 'P0001', 'No tenés permiso para hacer esto.',
  'cancel_shift: admin sin cancel_shifts no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- Motivo obligatorio.
select tests.as_user('test-db023-admin-con-cap@example.com');

prepare cancel_no_reason as
  select public.cancel_shift('e2300000-0000-0000-0000-000000000051', '   ');

select throws_ok(
  'cancel_no_reason', 'P0001', 'Indicá el motivo.',
  'cancel_shift: motivo vacío -> CANCEL_REASON_REQUIRED'
);

-- No se puede cancelar un turno completed.
prepare cancel_completed as
  select public.cancel_shift('e2300000-0000-0000-0000-000000000052', 'motivo');

select throws_ok(
  'cancel_completed', 'P0001', 'Este turno ya terminó.',
  'cancel_shift: turno finalizado -> SHIFT_COMPLETED'
);

-- Cancelación correcta: cancela el turno y la supervisión assigned; la asignación NO se toca.
select is(
  (public.cancel_shift('e2300000-0000-0000-0000-000000000051', 'Cliente canceló el servicio')).status::text,
  'cancelled',
  'cancel_shift: admin con cancel_shifts cancela el turno'
);

set local role postgres;

select is(
  (select status::text from public.supervisions where shift_id = 'e2300000-0000-0000-0000-000000000051'),
  'cancelled',
  'cancel_shift: cancela la supervisión assigned de ese turno'
);

select is(
  (select removed_at from public.assignments where shift_id = 'e2300000-0000-0000-0000-000000000051'),
  null::timestamptz,
  'cancel_shift: la asignación NO se toca -- queda para historia (P-049)'
);

-- Ya cancelado -> SHIFT_CANCELLED.
select tests.as_user('test-db023-admin-con-cap@example.com');

prepare cancel_already_cancelled as
  select public.cancel_shift('e2300000-0000-0000-0000-000000000051', 'de nuevo');

select throws_ok(
  'cancel_already_cancelled', 'P0001', 'Este turno está cancelado.',
  'cancel_shift: ya cancelado -> SHIFT_CANCELLED'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- reload_shift_tasks ------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2300000-0000-0000-0000-000000000061', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-07', '08:00', '12:00', 1, 'scheduled'),
  ('e2300000-0000-0000-0000-000000000062', 'e2300000-0000-0000-0000-000000000001', 'e2300000-0000-0000-0000-000000000011', '2199-03-07', '13:00', '17:00', 1, 'in_progress');

-- Un admin sin edit_checklists no puede llamarla.
select tests.as_user('test-db023-admin-sin-cap@example.com');

prepare reload_as_admin_no_cap as
  select public.reload_shift_tasks('e2300000-0000-0000-0000-000000000061');

select throws_ok(
  'reload_as_admin_no_cap', 'P0001', 'No tenés permiso para hacer esto.',
  'reload_shift_tasks: admin sin edit_checklists no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- Turno in_progress -> SHIFT_NOT_EDITABLE.
select tests.as_user('test-db023-admin-con-cap@example.com');

prepare reload_in_progress as
  select public.reload_shift_tasks('e2300000-0000-0000-0000-000000000062');

select throws_ok(
  'reload_in_progress', 'P0001', 'Este turno no admite ese cambio en su estado actual.',
  'reload_shift_tasks: turno in_progress -> SHIFT_NOT_EDITABLE'
);

-- Turno scheduled: recarga las tareas de la plantilla de la sede (1 ítem).
select is(
  (select count(*)::int from public.reload_shift_tasks('e2300000-0000-0000-0000-000000000061')),
  1,
  'reload_shift_tasks: devuelve exactamente el ítem de la plantilla vigente de la sede'
);

set local role postgres;

select is(
  (select count(*)::int from public.shift_tasks where shift_id = 'e2300000-0000-0000-0000-000000000061'),
  1,
  'reload_shift_tasks: quedó persistido -- una sola tarea'
);

-- Cambia la plantilla de la sede a dos ítems y recarga: reemplaza el contenido anterior.
insert into public.checklist_template_items (template_id, position, title) values
  ('e2300000-0000-0000-0000-000000000022', 2, 'Ítem de la sede 2');

select tests.as_user('test-db023-admin-con-cap@example.com');

select is(
  (select count(*)::int from public.reload_shift_tasks('e2300000-0000-0000-0000-000000000061')),
  2,
  'reload_shift_tasks: al recargar de nuevo, reemplaza -- ahora dos ítems'
);

set local role postgres;

select * from finish();

rollback;
