-- pgTAP de la migración 0012_rls_policies.sql (DB-014), parte 3: assignments (select + update de
-- notes propia), attendance_records, attendance_notices, checklist_templates,
-- checklist_template_items, shift_tasks. Las demás tablas están en 0012_rls_policies.test.sql,
-- 0012_rls_policies_clients_sites_services_shifts.test.sql y
-- 0012_rls_policies_supervisions_ratings_settings.test.sql.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2300000-...'.
--
-- Este archivo cubre uno de los dos criterios de aceptación explícitos de F4
-- (08_Fases_y_Backlog.md): "un empleado del seed, autenticado, no puede leer... asignaciones de
-- turnos ajenos" (el otro criterio, ratings, está en
-- 0012_rls_policies_supervisions_ratings_settings.test.sql).

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

select plan(23);

-- Fixtures: cliente/sede, turno1 (supervisado por S, con E1 y E2 asignados), turno2 (sin
-- relación con nadie, para el criterio de aceptación "no lee asignaciones de turnos ajenos) -------

insert into public.clients (id, legal_name) values ('c2300000-0000-0000-0000-000000000001', 'Cliente tareas y asistencia');
insert into public.sites (id, client_id, name, address)
values ('c2300000-0000-0000-0000-000000000011', 'c2300000-0000-0000-0000-000000000001', 'Sede', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2300000-0000-0000-0000-000000000081', 'test-db014c-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c2300000-0000-0000-0000-000000000082', 'test-db014c-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c2300000-0000-0000-0000-000000000083', 'test-db014c-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Tres')),
  ('c2300000-0000-0000-0000-000000000084', 'test-db014c-empleado1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('c2300000-0000-0000-0000-000000000085', 'test-db014c-empleado2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos')),
  ('c2300000-0000-0000-0000-000000000086', 'test-db014c-empleado-afuera@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Afuera'));

insert into public.user_roles (profile_id, role) values
  ('c2300000-0000-0000-0000-000000000081', 'owner'),
  ('c2300000-0000-0000-0000-000000000082', 'admin'),
  ('c2300000-0000-0000-0000-000000000083', 'supervisor'),
  ('c2300000-0000-0000-0000-000000000084', 'employee'),
  ('c2300000-0000-0000-0000-000000000085', 'employee'),
  ('c2300000-0000-0000-0000-000000000086', 'employee');

insert into public.employees (profile_id, dni) values
  ('c2300000-0000-0000-0000-000000000083', '52300083'),
  ('c2300000-0000-0000-0000-000000000084', '52300084'),
  ('c2300000-0000-0000-0000-000000000085', '52300085'),
  ('c2300000-0000-0000-0000-000000000086', '52300086');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values
  ('c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000001', 'c2300000-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 2),
  ('c2300000-0000-0000-0000-000000000042', 'c2300000-0000-0000-0000-000000000001', 'c2300000-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 1);

insert into public.assignments (id, shift_id, employee_id)
values
  ('c2300000-0000-0000-0000-000000000051', 'c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000084'),
  ('c2300000-0000-0000-0000-000000000052', 'c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000085'),
  ('c2300000-0000-0000-0000-000000000053', 'c2300000-0000-0000-0000-000000000042', 'c2300000-0000-0000-0000-000000000086');

insert into public.supervisions (shift_id, supervisor_id)
values ('c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000083');

-- ---------------------------------------------------------------------------------------------
-- 1. assignments: select (criterio de aceptación de F4) y update de notes propia
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db014c-owner@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.assignments
    where id = any(array[
      'c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052',
      'c2300000-0000-0000-0000-000000000053'
    ])),
  array[
    'c2300000-0000-0000-0000-000000000051', 'c2300000-0000-0000-0000-000000000052',
    'c2300000-0000-0000-0000-000000000053'
  ]::uuid[],
  'assignments: owner ve las 3 asignaciones del fixture'
);

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.assignments
    where id = any(array[
      'c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052',
      'c2300000-0000-0000-0000-000000000053'
    ])),
  array['c2300000-0000-0000-0000-000000000051', 'c2300000-0000-0000-0000-000000000052']::uuid[],
  'assignments: supervisora ve las dos asignaciones del turno que supervisa, no la del otro turno'
);

-- Criterio de aceptación de F4: un empleado ve la propia + la de un compañero del MISMO turno
-- (P-103), pero NO la asignación de un turno ajeno.
select tests.as_user('test-db014c-empleado1@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.assignments
    where id = any(array[
      'c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052',
      'c2300000-0000-0000-0000-000000000053'
    ])),
  array['c2300000-0000-0000-0000-000000000051', 'c2300000-0000-0000-0000-000000000052']::uuid[],
  'assignments: empleado 1 ve la propia + la del compañero del mismo turno (P-103), no la del otro turno'
);

select tests.as_user('test-db014c-empleado-afuera@example.com');
select is(
  (select coalesce(array_agg(id order by id), array[]::uuid[]) from public.assignments
    where id = any(array[
      'c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052',
      'c2300000-0000-0000-0000-000000000053'
    ])),
  array['c2300000-0000-0000-0000-000000000053']::uuid[],
  'assignments: CRITERIO DE ACEPTACIÓN F4 -- el empleado de afuera ve solo la propia, NO las asignaciones del turno ajeno (E1, E2)'
);

set local role postgres;

-- Update de notes propia: E1 puede sobre la propia (turno no completed); no puede sobre la de E2.
select tests.as_user('test-db014c-empleado1@example.com');

select lives_ok(
  $$update public.assignments set notes = 'nota propia' where id = 'c2300000-0000-0000-0000-000000000051'$$,
  'assignments: empleado 1 puede actualizar notes de su propia asignación (turno no completed)'
);

create temporary table c2300000_update_probe (n int) on commit drop;

with upd as (
  update public.assignments set notes = 'nota ajena'
  where id = 'c2300000-0000-0000-0000-000000000052'
  returning 1
)
insert into c2300000_update_probe select count(*) from upd;

select is(
  (select n from c2300000_update_probe),
  0,
  'assignments: empleado 1 NO puede actualizar notes de la asignación de su compañero (0 filas afectadas)'
);

set local role postgres;

-- Turno completed: ni siquiera la propia notes se puede tocar (04 sección 7.2: "mientras el
-- turno no esté completed").
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status)
values ('c2300000-0000-0000-0000-000000000043', 'c2300000-0000-0000-0000-000000000001', 'c2300000-0000-0000-0000-000000000011', current_date - 1, '08:00', '16:00', 1, 'completed');

insert into public.assignments (id, shift_id, employee_id, status)
values ('c2300000-0000-0000-0000-000000000054', 'c2300000-0000-0000-0000-000000000043', 'c2300000-0000-0000-0000-000000000084', 'finished');

select tests.as_user('test-db014c-empleado1@example.com');

create temporary table c2300000_update_probe_2 (n int) on commit drop;

with upd as (
  update public.assignments set notes = 'demasiado tarde'
  where id = 'c2300000-0000-0000-0000-000000000054'
  returning 1
)
insert into c2300000_update_probe_2 select count(*) from upd;

select is(
  (select n from c2300000_update_probe_2),
  0,
  'assignments: empleado 1 no puede actualizar notes de su propia asignación si el turno ya está completed'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 2. attendance_records, attendance_notices
-- ---------------------------------------------------------------------------------------------

insert into public.attendance_records (assignment_id, kind, recorded_at, source)
values
  ('c2300000-0000-0000-0000-000000000051', 'check_in', now(), 'employee_app'),
  ('c2300000-0000-0000-0000-000000000052', 'check_in', now(), 'employee_app');

insert into public.attendance_notices (assignment_id, kind, reason_code, source, reported_by)
values ('c2300000-0000-0000-0000-000000000053', 'absence', 'illness', 'employee_app', 'c2300000-0000-0000-0000-000000000086');

select tests.as_user('test-db014c-owner@example.com');
select is(
  (select count(*)::int from public.attendance_records
    where assignment_id = any(array['c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052'])),
  2,
  'attendance_records: owner ve los dos registros'
);

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select count(*)::int from public.attendance_records
    where assignment_id = any(array['c2300000-0000-0000-0000-000000000051'::uuid, 'c2300000-0000-0000-0000-000000000052'])),
  2,
  'attendance_records: supervisora ve los registros de su turno'
);

select tests.as_user('test-db014c-empleado1@example.com');
select is(
  (select count(*)::int from public.attendance_records
    where assignment_id = 'c2300000-0000-0000-0000-000000000051'),
  1,
  'attendance_records: empleado 1 ve su propio registro'
);

select is(
  (select count(*)::int from public.attendance_records
    where assignment_id = 'c2300000-0000-0000-0000-000000000052'),
  0,
  'attendance_records: empleado 1 NO ve el registro de su compañero (04 sección 7.2: "E: propios", sin la excepción de compañeros que sí tiene assignments)'
);

select tests.as_user('test-db014c-empleado-afuera@example.com');
select is(
  (select count(*)::int from public.attendance_notices where assignment_id = 'c2300000-0000-0000-0000-000000000053'),
  1,
  'attendance_notices: el empleado de afuera ve su propio aviso'
);

select tests.as_user('test-db014c-empleado1@example.com');
select is(
  (select count(*)::int from public.attendance_notices where assignment_id = 'c2300000-0000-0000-0000-000000000053'),
  0,
  'attendance_notices: empleado 1 no ve el aviso de un turno ajeno'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 3. checklist_templates, checklist_template_items (04 sección 7.2: "O, A. S, E: no.")
-- ---------------------------------------------------------------------------------------------

insert into public.checklist_templates (id, client_id, name)
values ('c2300000-0000-0000-0000-000000000061', 'c2300000-0000-0000-0000-000000000001', 'Plantilla');

insert into public.checklist_template_items (id, template_id, position, title)
values ('c2300000-0000-0000-0000-000000000062', 'c2300000-0000-0000-0000-000000000061', 1, 'Ítem 1');

select tests.as_user('test-db014c-owner@example.com');
select is(
  (select count(*)::int from public.checklist_templates where id = 'c2300000-0000-0000-0000-000000000061'),
  1,
  'checklist_templates: owner ve la plantilla'
);

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select count(*)::int from public.checklist_templates where id = 'c2300000-0000-0000-0000-000000000061'),
  0,
  'checklist_templates: la supervisora no ve plantillas (04 sección 7.2: "S, E: no")'
);

select tests.as_user('test-db014c-empleado1@example.com');
select is(
  (select count(*)::int from public.checklist_template_items where id = 'c2300000-0000-0000-0000-000000000062'),
  0,
  'checklist_template_items: el empleado no ve ítems de plantilla'
);

set local role postgres;

-- update con RLS: si el USING no matchea ninguna fila, el UPDATE afecta 0 filas sin lanzar
-- excepción (a diferencia de un INSERT, donde el WITH CHECK sí corta con 42501 -- ver
-- employees_insert_no_capability en 0012_rls_policies.test.sql). Se verifica con el patrón de
-- tabla temporal, mismo criterio que assignments más arriba.
select tests.as_user('test-db014c-admin@example.com');

create temporary table c2300000_checklist_probe (n int) on commit drop;

with upd as (
  update public.checklist_templates set name = 'renombrada'
  where id = 'c2300000-0000-0000-0000-000000000061'
  returning 1
)
insert into c2300000_checklist_probe select count(*) from upd;

select is(
  (select n from c2300000_checklist_probe),
  0,
  'checklist_templates: admin sin edit_checklists no puede escribir (0 filas afectadas)'
);

set local role postgres;
insert into public.admin_capabilities (profile_id, capability, enabled)
values ('c2300000-0000-0000-0000-000000000082', 'edit_checklists', true);

select tests.as_user('test-db014c-admin@example.com');
select lives_ok(
  $$update public.checklist_templates set name = 'renombrada' where id = 'c2300000-0000-0000-0000-000000000061'$$,
  'checklist_templates: admin con edit_checklists sí puede escribir'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- 4. shift_tasks (04 sección 7.2: "O, A. S, E: de sus turnos.")
-- ---------------------------------------------------------------------------------------------

insert into public.shift_tasks (id, shift_id, position, title, is_required)
values ('c2300000-0000-0000-0000-000000000071', 'c2300000-0000-0000-0000-000000000041', 1, 'Tarea', true);

select tests.as_user('test-db014c-owner@example.com');
select is(
  (select count(*)::int from public.shift_tasks where id = 'c2300000-0000-0000-0000-000000000071'),
  1,
  'shift_tasks: owner ve la tarea'
);

select tests.as_user('test-db014c-supervisora@example.com');
select is(
  (select count(*)::int from public.shift_tasks where id = 'c2300000-0000-0000-0000-000000000071'),
  1,
  'shift_tasks: supervisora ve la tarea de su turno'
);

select tests.as_user('test-db014c-empleado1@example.com');
select is(
  (select count(*)::int from public.shift_tasks where id = 'c2300000-0000-0000-0000-000000000071'),
  1,
  'shift_tasks: empleado 1 ve la tarea de su turno'
);

select tests.as_user('test-db014c-empleado-afuera@example.com');
select is(
  (select count(*)::int from public.shift_tasks where id = 'c2300000-0000-0000-0000-000000000071'),
  0,
  'shift_tasks: el empleado de afuera no ve la tarea de un turno ajeno'
);

-- Sin RPC todavía (update_task_status llega en fase 12/13): ni siquiera el admin escribe directo
-- -- sin ninguna política de update en la tabla, el intento afecta 0 filas sin excepción (mismo
-- comportamiento que checklist_templates más arriba).
set local role postgres;
select tests.as_user('test-db014c-admin@example.com');

create temporary table c2300000_shift_tasks_probe (n int) on commit drop;

with upd as (
  update public.shift_tasks set status = 'done'
  where id = 'c2300000-0000-0000-0000-000000000071'
  returning 1
)
insert into c2300000_shift_tasks_probe select count(*) from upd;

select is(
  (select n from c2300000_shift_tasks_probe),
  0,
  'shift_tasks: ni el admin puede actualizar directo (04 sección 7.2: "RPC update_task_status", todavía no escrita; 0 filas afectadas)'
);

set local role postgres;

select * from finish();

rollback;
