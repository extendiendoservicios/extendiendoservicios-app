-- pgTAP de la migración 0025_rpc_tasks.sql (TASK-001/TASK-002, F12 · Checklists y tareas, P12.1):
-- clone_checklist_template, update_task_status y los permisos por rol de las dos. Las pruebas de
-- "una plantilla por cliente y una por sede" y "not_done_reason obligatorio" ya viven en
-- `0008_checklists_tasks.test.sql`; las de "la copia al turno usa la de la sede si existe, si no
-- la del cliente" y "reload_shift_tasks solo en turnos no empezados" ya viven en
-- `0023_rpc_shifts.test.sql` -- este archivo no las repite, salvo "cambiar la plantilla no altera
-- turnos existentes" (P-061), que el encargo pide explícitamente y todavía no tenía pgTAP propio.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2500000-...'. Fechas en
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

select plan(30);

-- Existencia y firma --------------------------------------------------------------------------

select has_function('public', 'clone_checklist_template', array['uuid', 'uuid'], 'existe public.clone_checklist_template(uuid, uuid)');
select has_function('public', 'update_task_status', array['uuid', 'task_status', 'text'], 'existe public.update_task_status(uuid, task_status, text)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: dos clientes (uno activo con plantilla propia, uno activo SIN plantilla), sedes
-- (activa sin plantilla propia, activa CON plantilla propia ya cargada, inactiva), personas con
-- los cuatro roles y las capacidades relevantes (edit_checklists activada o no).
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2500000-0000-0000-0000-000000000001', 'Cliente de tareas', 'active'),
  ('e2500000-0000-0000-0000-000000000002', 'Cliente sin plantilla', 'active'),
  ('e2500000-0000-0000-0000-000000000003', 'Cliente suspendido de tareas', 'suspended');

insert into public.sites (id, client_id, name, address, status) values
  ('e2500000-0000-0000-0000-000000000011', 'e2500000-0000-0000-0000-000000000001', 'Sede sin plantilla propia', 'Dirección 1', 'active'),
  ('e2500000-0000-0000-0000-000000000012', 'e2500000-0000-0000-0000-000000000001', 'Sede con plantilla propia', 'Dirección 2', 'active'),
  ('e2500000-0000-0000-0000-000000000013', 'e2500000-0000-0000-0000-000000000001', 'Sede inactiva', 'Dirección 3', 'inactive'),
  ('e2500000-0000-0000-0000-000000000021', 'e2500000-0000-0000-0000-000000000002', 'Sede de cliente sin plantilla', 'Dirección 4', 'active');

-- Plantilla del cliente 1 con dos ítems (uno opcional) -- fuente para clonar.
insert into public.checklist_templates (id, client_id, site_id, name) values
  ('e2500000-0000-0000-0000-000000000031', 'e2500000-0000-0000-0000-000000000001', null, 'Plantilla del cliente de tareas');

insert into public.checklist_template_items (id, template_id, position, title, description, is_required) values
  ('e2500000-0000-0000-0000-000000000041', 'e2500000-0000-0000-0000-000000000031', 1, 'Barrer y trapear', 'Todas las áreas comunes', true),
  ('e2500000-0000-0000-0000-000000000042', 'e2500000-0000-0000-0000-000000000031', 2, 'Vaciar cestos', null, false);

-- La sede 0012 ya tiene su propia plantilla (para SITE_TEMPLATE_EXISTS).
insert into public.checklist_templates (id, client_id, site_id, name) values
  ('e2500000-0000-0000-0000-000000000032', 'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000012', 'Plantilla propia de la sede 0012');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2500000-0000-0000-0000-000000000081', 'test-db025-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Tareas')),
  ('e2500000-0000-0000-0000-000000000082', 'test-db025-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('e2500000-0000-0000-0000-000000000083', 'test-db025-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('e2500000-0000-0000-0000-000000000084', 'test-db025-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e2500000-0000-0000-0000-000000000085', 'test-db025-empleado-presente@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Presente')),
  ('e2500000-0000-0000-0000-000000000086', 'test-db025-empleado-sin-asignacion@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'SinAsig')),
  ('e2500000-0000-0000-0000-000000000087', 'test-db025-empleado-finalizado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Finalizado'));

insert into public.user_roles (profile_id, role) values
  ('e2500000-0000-0000-0000-000000000081', 'owner'),
  ('e2500000-0000-0000-0000-000000000082', 'admin'),
  ('e2500000-0000-0000-0000-000000000083', 'admin'),
  ('e2500000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2500000-0000-0000-0000-000000000085', 'employee'),
  ('e2500000-0000-0000-0000-000000000086', 'employee'),
  ('e2500000-0000-0000-0000-000000000087', 'employee');

-- admin-con-cap tiene edit_checklists; admin-sin-cap no.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2500000-0000-0000-0000-000000000082', 'edit_checklists', true),
  ('e2500000-0000-0000-0000-000000000083', 'edit_checklists', false);

insert into public.employees (profile_id, dni) values
  ('e2500000-0000-0000-0000-000000000084', '92500084'),
  ('e2500000-0000-0000-0000-000000000085', '92500085'),
  ('e2500000-0000-0000-0000-000000000086', '92500086'),
  ('e2500000-0000-0000-0000-000000000087', '92500087');

-- ---------------------------------------------------------------------------------------------
-- clone_checklist_template ------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Permisos: supervisor y empleado no pueden llamarla.
select tests.as_user('test-db025-supervisora@example.com');

prepare clone_as_supervisor as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'clone_checklist_template: una supervisora no puede llamarla (FORBIDDEN)'
);

select tests.as_user('test-db025-empleado-presente@example.com');

prepare clone_as_employee as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_as_employee', 'P0001', 'No tenés permiso para hacer esto.',
  'clone_checklist_template: un empleado no puede llamarla (FORBIDDEN)'
);

-- Un admin sin edit_checklists tampoco.
select tests.as_user('test-db025-admin-sin-cap@example.com');

prepare clone_as_admin_sin_cap as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_as_admin_sin_cap', 'P0001', 'No tenés permiso para hacer esto.',
  'clone_checklist_template: admin sin edit_checklists no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- Con capacidad: CLIENT_NOT_ACTIVE si el cliente está suspendido.
select tests.as_user('test-db025-admin-con-cap@example.com');

prepare clone_client_suspended as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000003', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_client_suspended', 'P0001', 'El cliente no está activo.',
  'clone_checklist_template: cliente suspendido -> CLIENT_NOT_ACTIVE'
);

-- SITE_NOT_ACTIVE con la sede inactiva.
prepare clone_site_inactive as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000013');

select throws_ok(
  'clone_site_inactive', 'P0001', 'La sede no está activa.',
  'clone_checklist_template: sede inactiva -> SITE_NOT_ACTIVE'
);

-- SITE_NOT_ACTIVE también cuando la sede no pertenece al cliente indicado.
prepare clone_site_other_client as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000002', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_site_other_client', 'P0001', 'La sede no está activa.',
  'clone_checklist_template: sede de otro cliente -> SITE_NOT_ACTIVE'
);

-- SITE_TEMPLATE_EXISTS: la sede 0012 ya tiene su propia plantilla.
prepare clone_site_template_exists as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000012');

select throws_ok(
  'clone_site_template_exists', 'P0001', 'Esta sede ya tiene su propia plantilla de tareas.',
  'clone_checklist_template: la sede ya tiene plantilla propia -> SITE_TEMPLATE_EXISTS'
);

-- CLIENT_TEMPLATE_NOT_FOUND: el cliente 0002 no tiene plantilla propia para copiar.
prepare clone_client_template_not_found as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000002', 'e2500000-0000-0000-0000-000000000021');

select throws_ok(
  'clone_client_template_not_found', 'P0001', 'Este cliente todavía no tiene una plantilla de tareas para copiar.',
  'clone_checklist_template: cliente sin plantilla -> CLIENT_TEMPLATE_NOT_FOUND'
);

-- Alta correcta: la sede 0011 no tiene plantilla propia -> se crea copiando los dos ítems de la
-- plantilla del cliente, mismo orden y misma obligatoriedad (P-058).
-- Ojo: se llama con `select (func(...)).columna` directo (sin sub-`select ... from tabla where
-- id = (func(...)).id`) porque, al usar el resultado de una función volátil dentro del `where` de
-- un `select` sobre una tabla, Postgres puede evaluarla más de una vez (una por fila candidata del
-- seqscan) -- se vio en vivo contra App_dev: la segunda llamada volvía a intentar clonar sobre la
-- misma sede y tiraba SITE_TEMPLATE_EXISTS. Con la forma de abajo se llama una sola vez.
select is(
  (select (public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011')).name),
  'Plantilla del cliente de tareas',
  'clone_checklist_template: la plantilla nueva copia el nombre de la del cliente'
);

set local role postgres;

select is(
  (select site_id from public.checklist_templates
   where client_id = 'e2500000-0000-0000-0000-000000000001' and site_id = 'e2500000-0000-0000-0000-000000000011'),
  'e2500000-0000-0000-0000-000000000011'::uuid,
  'clone_checklist_template: la plantilla nueva queda asociada a la sede'
);

select is(
  (select count(*)::int from public.checklist_template_items i
   join public.checklist_templates t on t.id = i.template_id
   where t.site_id = 'e2500000-0000-0000-0000-000000000011'),
  2,
  'clone_checklist_template: copia los dos ítems de la plantilla del cliente'
);

select is(
  (select array_agg(i.title order by i.position) from public.checklist_template_items i
   join public.checklist_templates t on t.id = i.template_id
   where t.site_id = 'e2500000-0000-0000-0000-000000000011'),
  array['Barrer y trapear', 'Vaciar cestos'],
  'clone_checklist_template: mantiene el orden (position) de los ítems'
);

select is(
  (select is_required from public.checklist_template_items i
   join public.checklist_templates t on t.id = i.template_id
   where t.site_id = 'e2500000-0000-0000-0000-000000000011' and i.title = 'Vaciar cestos'),
  false,
  'clone_checklist_template: mantiene la obligatoriedad (is_required) de cada ítem'
);

-- Con la plantilla propia ya creada, un segundo intento sobre la misma sede da SITE_TEMPLATE_EXISTS.
select tests.as_user('test-db025-owner@example.com');

prepare clone_again_same_site as
  select public.clone_checklist_template('e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011');

select throws_ok(
  'clone_again_same_site', 'P0001', 'Esta sede ya tiene su propia plantilla de tareas.',
  'clone_checklist_template: repetir la clonación sobre la misma sede -> SITE_TEMPLATE_EXISTS'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- P-061: cambiar la plantilla (editar sus ítems) no altera los turnos ya generados -----------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db025-owner@example.com');

-- El turno usa la plantilla del cliente (la sede 0021, del cliente sin plantilla, no tiene
-- plantilla propia ni de cliente todavía: se agrega una recién ahora al cliente 0002 para poder
-- crear el turno con checklist).
set local role postgres;

insert into public.checklist_templates (id, client_id, site_id, name) values
  ('e2500000-0000-0000-0000-000000000033', 'e2500000-0000-0000-0000-000000000002', null, 'Plantilla del cliente 0002');
insert into public.checklist_template_items (id, template_id, position, title) values
  ('e2500000-0000-0000-0000-000000000043', 'e2500000-0000-0000-0000-000000000033', 1, 'Ítem original');

select tests.as_user('test-db025-owner@example.com');

select is(
  (public.create_shift(
    'e2500000-0000-0000-0000-000000000002', 'e2500000-0000-0000-0000-000000000021',
    '2199-05-02', '08:00', '12:00', 1::smallint
  ) -> 'shift' ->> 'checklist_template_id'),
  'e2500000-0000-0000-0000-000000000033',
  'create_shift: usa la plantilla del cliente 0002 (fixture del bloque P-061)'
);

set local role postgres;

select is(
  (select array_agg(title order by position) from public.shift_tasks st
   join public.shifts sh on sh.id = st.shift_id
   where sh.client_id = 'e2500000-0000-0000-0000-000000000002' and sh.shift_date = '2199-05-02'),
  array['Ítem original'],
  'create_shift: el turno copió el único ítem de la plantilla en ese momento'
);

-- Se edita la plantilla del cliente: se agrega un ítem y se cambia el título del existente.
update public.checklist_template_items
set title = 'Ítem editado después del turno'
where id = 'e2500000-0000-0000-0000-000000000043';

insert into public.checklist_template_items (template_id, position, title)
values ('e2500000-0000-0000-0000-000000000033', 2, 'Ítem agregado después del turno');

select is(
  (select array_agg(title order by position) from public.shift_tasks st
   join public.shifts sh on sh.id = st.shift_id
   where sh.client_id = 'e2500000-0000-0000-0000-000000000002' and sh.shift_date = '2199-05-02'),
  array['Ítem original'],
  'P-061: editar la plantilla del cliente después de creado el turno no altera shift_tasks (sin reload_shift_tasks)'
);

-- ---------------------------------------------------------------------------------------------
-- update_task_status -------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Un turno con una tarea, y tres asignaciones para tres empleados en distintas condiciones:
-- presente (dentro de su ventana), sin asignación en este turno, y ya finalizado (fuera de su
-- ventana, P-063).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e2500000-0000-0000-0000-000000000051', 'e2500000-0000-0000-0000-000000000001', 'e2500000-0000-0000-0000-000000000011', '2199-06-01', '08:00', '12:00', 2, 'in_progress');

insert into public.shift_tasks (id, shift_id, position, title, is_required, status) values
  ('e2500000-0000-0000-0000-000000000061', 'e2500000-0000-0000-0000-000000000051', 1, 'Tarea del turno 0051', true, 'pending');

insert into public.assignments (id, shift_id, employee_id, status) values
  ('e2500000-0000-0000-0000-000000000071', 'e2500000-0000-0000-0000-000000000051', 'e2500000-0000-0000-0000-000000000085', 'present'),
  ('e2500000-0000-0000-0000-000000000072', 'e2500000-0000-0000-0000-000000000051', 'e2500000-0000-0000-0000-000000000087', 'finished');

-- TASK_NOT_FOUND con un id que no existe.
select tests.as_user('test-db025-owner@example.com');

prepare update_task_not_found as
  select public.update_task_status('00000000-0000-0000-0000-000000000000', 'in_progress');

select throws_ok(
  'update_task_not_found', 'P0001', 'No encontramos esa tarea.',
  'update_task_status: id inexistente -> TASK_NOT_FOUND'
);

set local role postgres;

-- Supervisor: FORBIDDEN.
select tests.as_user('test-db025-supervisora@example.com');

prepare update_task_as_supervisor as
  select public.update_task_status('e2500000-0000-0000-0000-000000000061', 'in_progress');

select throws_ok(
  'update_task_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'update_task_status: una supervisora no puede llamarla (FORBIDDEN)'
);

-- Empleado sin ninguna asignación en ese turno: TASK_LOCKED.
select tests.as_user('test-db025-empleado-sin-asignacion@example.com');

prepare update_task_sin_asignacion as
  select public.update_task_status('e2500000-0000-0000-0000-000000000061', 'in_progress');

select throws_ok(
  'update_task_sin_asignacion', 'P0001', 'Las tareas se marcan entre el inicio y el fin del servicio.',
  'update_task_status: empleado sin asignación en el turno -> TASK_LOCKED'
);

-- Empleado con asignación ya finalizada (fuera de su ventana, P-063): TASK_LOCKED.
select tests.as_user('test-db025-empleado-finalizado@example.com');

prepare update_task_finalizado as
  select public.update_task_status('e2500000-0000-0000-0000-000000000061', 'in_progress');

select throws_ok(
  'update_task_finalizado', 'P0001', 'Las tareas se marcan entre el inicio y el fin del servicio.',
  'update_task_status: empleado con asignación ya finalizada -> TASK_LOCKED (fuera de ventana)'
);

set local role postgres;

-- Empleado presente (dentro de su ventana): puede pasar a in_progress.
select tests.as_user('test-db025-empleado-presente@example.com');

select is(
  (public.update_task_status('e2500000-0000-0000-0000-000000000061', 'in_progress')).status::text,
  'in_progress',
  'update_task_status: empleado presente puede marcar in_progress'
);

-- not_done sin motivo: REASON_REQUIRED.
prepare update_task_not_done_sin_motivo as
  select public.update_task_status('e2500000-0000-0000-0000-000000000061', 'not_done');

select throws_ok(
  'update_task_not_done_sin_motivo', 'P0001', 'Indicá el motivo.',
  'update_task_status: not_done sin motivo -> REASON_REQUIRED'
);

-- not_done con motivo: éxito, y queda el motivo guardado.
select is(
  (public.update_task_status('e2500000-0000-0000-0000-000000000061', 'not_done', 'Faltó insumo')).not_done_reason,
  'Faltó insumo',
  'update_task_status: not_done con motivo guarda not_done_reason'
);

set local role postgres;

select ok(
  (select status_changed_at is not null and status_changed_by = 'e2500000-0000-0000-0000-000000000085'
   from public.shift_tasks where id = 'e2500000-0000-0000-0000-000000000061'),
  'update_task_status: registra status_changed_at/status_changed_by'
);

-- Admin SIN edit_checklists también puede (la capacidad no aplica a esta RPC, 06 sección 9: "O, A").
select tests.as_user('test-db025-admin-sin-cap@example.com');

select is(
  (public.update_task_status('e2500000-0000-0000-0000-000000000061', 'pending')).status::text,
  'pending',
  'update_task_status: admin sin edit_checklists igual puede cambiar el estado (no depende de esa capacidad)'
);

select is(
  (public.update_task_status('e2500000-0000-0000-0000-000000000061', 'pending')).not_done_reason,
  null,
  'update_task_status: al volver a pending se limpia not_done_reason'
);

-- El owner también puede, en cualquier momento (P-063).
select tests.as_user('test-db025-owner@example.com');

select is(
  (public.update_task_status('e2500000-0000-0000-0000-000000000061', 'done')).status::text,
  'done',
  'update_task_status: el owner puede cambiar el estado en cualquier momento'
);

set local role postgres;

select * from finish();

rollback;
