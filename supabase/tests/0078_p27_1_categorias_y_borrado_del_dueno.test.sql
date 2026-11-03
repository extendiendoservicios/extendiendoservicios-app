-- pgTAP de la migración 0078_p27_1_categorias_y_borrado_del_dueno.sql (P27.1, OD-20, OD-22, OD-23).
--   1. Categorías de clientes: estructura, RLS, upsert / reorder / remove (con la capacidad de
--      clientes: dueño o administrador) y validación de clients.category_id.
--   2. Borrado físico del dueño: vista previa y borrado de turno, servicio, turnos de un servicio
--      desde una fecha, sede, cliente y empleado. Solo el dueño; bloqueos por historia con sus
--      códigos; confirmación por nombre; evento record_deleted con copia JSON.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f7800000-...'. Los nombres de categorías llevan «0078» para no chocar con los
-- de otros archivos (el índice único es por nombre).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0078;
grant usage on schema tests_0078 to authenticated, anon;

create or replace function tests_0078.as_user(p_email text)
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
    raise exception 'tests_0078.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0078.as_user(text) to authenticated, anon;

create or replace function tests_0078.err_hint(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end;
$$;

grant execute on function tests_0078.err_hint(text) to authenticated, anon;

create or replace function tests_0078.err_detail(p_sql text)
returns text
language plpgsql
as $$
declare
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail;
end;
$$;

grant execute on function tests_0078.err_detail(text) to authenticated, anon;

select plan(97);

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f7800000-0000-0000-0000-000000000081', 'test-db0078-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Cero78')),
  ('f7800000-0000-0000-0000-000000000082', 'test-db0078-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Cero78')),
  ('f7800000-0000-0000-0000-000000000091', 'test-db0078-sup@example.com', jsonb_build_object('first_name', 'Sup', 'last_name', 'Cero78')),
  ('f7800000-0000-0000-0000-0000000000a1', 'test-db0078-e1@example.com', jsonb_build_object('first_name', 'Elena', 'last_name', 'Libre')),
  ('f7800000-0000-0000-0000-0000000000a2', 'test-db0078-e2@example.com', jsonb_build_object('first_name', 'Esteban', 'last_name', 'Fichado')),
  ('f7800000-0000-0000-0000-0000000000a3', 'test-db0078-e3@example.com', jsonb_build_object('first_name', 'Emilia', 'last_name', 'Autora')),
  ('f7800000-0000-0000-0000-0000000000a4', 'test-db0078-e4@example.com', jsonb_build_object('first_name', 'Ernesto', 'last_name', 'Dueño'));

insert into public.user_roles (profile_id, role) values
  ('f7800000-0000-0000-0000-000000000081', 'owner'),
  ('f7800000-0000-0000-0000-000000000082', 'admin'),
  ('f7800000-0000-0000-0000-000000000091', 'supervisor'),
  ('f7800000-0000-0000-0000-0000000000a1', 'employee'),
  ('f7800000-0000-0000-0000-0000000000a2', 'employee'),
  ('f7800000-0000-0000-0000-0000000000a3', 'employee'),
  ('f7800000-0000-0000-0000-0000000000a4', 'owner'),
  ('f7800000-0000-0000-0000-0000000000a4', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f7800000-0000-0000-0000-000000000081', '97800081', 'active'),
  ('f7800000-0000-0000-0000-000000000091', '97800091', 'active'),
  ('f7800000-0000-0000-0000-0000000000a1', '97800101', 'active'),
  ('f7800000-0000-0000-0000-0000000000a2', '97800102', 'active'),
  ('f7800000-0000-0000-0000-0000000000a3', '97800103', 'active'),
  ('f7800000-0000-0000-0000-0000000000a4', '97800104', 'active');

-- ---------------------------------------------------------------------------------------------
-- 1. Categorías de clientes
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'client_categories', 'existe client_categories');
select ok((select relrowsecurity from pg_class where oid = 'public.client_categories'::regclass), 'client_categories tiene RLS habilitada');
select has_column('public', 'clients', 'category_id', 'clients.category_id existe');
select col_is_null('public', 'clients', 'category_id', 'clients.category_id admite nulo');
select has_index('public', 'client_categories', 'client_categories_name_key', 'nombre único entre las vigentes');
select has_column('public', 'v_clients', 'category_name', 'v_clients.category_name');
select ok(
  not has_table_privilege('authenticated', 'public.client_categories', 'insert')
  and not has_table_privilege('authenticated', 'public.client_categories', 'update')
  and not has_table_privilege('authenticated', 'public.client_categories', 'delete')
  and has_table_privilege('authenticated', 'public.client_categories', 'select')
  and not has_table_privilege('anon', 'public.client_categories', 'select'),
  'authenticated solo lee client_categories; anon nada; se escribe por RPC'
);
select ok(
  (select count(*) >= 1 from public.client_categories where deleted_at is null),
  'hay categorías vigentes (las iniciales de OD-20 se cargan en la migración)'
);

select tests_0078.as_user('test-db0078-admin@example.com');
select is(
  (select name from public.upsert_client_category('Cat0078 Alta')),
  'Cat0078 Alta', 'un administrador da de alta una categoría'
);
select is(
  (select sort_order from public.client_categories where name = 'Cat0078 Alta'),
  (select max(sort_order) from public.client_categories where deleted_at is null), 'sin orden, queda al final'
);
select is(
  tests_0078.err_hint($$select public.upsert_client_category('  cat0078 ALTA ')$$),
  'CATEGORY_NAME_TAKEN', 'el nombre es único entre las vigentes, sin distinguir mayúsculas'
);
select is(tests_0078.err_hint($$select public.upsert_client_category('   ')$$), 'NAME_REQUIRED', 'el nombre es obligatorio');
select is(tests_0078.err_hint($$select public.upsert_client_category(repeat('x', 61))$$), 'NAME_TOO_LONG', 'el nombre admite hasta 60 caracteres');
select is(
  tests_0078.err_hint($$select public.upsert_client_category('Cat0078 X', 'f7800000-0000-0000-0000-0000000000ff')$$),
  'CATEGORY_NOT_FOUND', 'editar una categoría inexistente'
);
select is(
  (select name from public.upsert_client_category('Cat0078 Renombrada', (select id from public.client_categories where name = 'Cat0078 Alta'))),
  'Cat0078 Renombrada', 'cambia el nombre'
);
select lives_ok($$select public.upsert_client_category('Cat0078 Segunda')$$, 'segunda categoría');
select lives_ok($$select public.upsert_client_category('Cat0078 Tercera')$$, 'tercera categoría');

select is(
  (select array_agg(name order by sort_order) from public.reorder_client_categories(array[
     (select id from public.client_categories where name = 'Cat0078 Tercera'),
     (select id from public.client_categories where name = 'Cat0078 Renombrada')
   ]) where name like 'Cat0078%'),
  array['Cat0078 Tercera', 'Cat0078 Renombrada', 'Cat0078 Segunda'],
  'reorder: las de la lista primero y en ese orden; las que no vienen, después'
);
select is(
  tests_0078.err_hint($$select public.reorder_client_categories(array['f7800000-0000-0000-0000-0000000000ff'::uuid])$$),
  'CATEGORY_NOT_FOUND', 'reorder con una categoría inexistente'
);

-- Un cliente con categoría; baja lógica de la categoría.
set local role postgres;
insert into public.clients (id, legal_name, status, calendar_color, category_id) values
  ('f7800000-0000-0000-0000-000000000501', 'Cliente categorizado 0078', 'active', 0, (select id from public.client_categories where name = 'Cat0078 Segunda'));
select is(
  (select category_name from public.v_clients where id = 'f7800000-0000-0000-0000-000000000501'),
  'Cat0078 Segunda', 'v_clients trae category_name'
);
select tests_0078.as_user('test-db0078-admin@example.com');
select is(
  tests_0078.err_hint($$update public.clients set category_id = 'f7800000-0000-0000-0000-0000000000ff' where id = 'f7800000-0000-0000-0000-000000000501'$$),
  'CATEGORY_NOT_FOUND', 'una categoría inexistente no se puede asignar'
);
select is(
  (select (public.remove_client_category((select id from public.client_categories where name = 'Cat0078 Segunda'))) ->> 'clients_cleared'),
  '1', 'remove_client_category: baja lógica y avisa cuántos clientes quedaron sin categoría'
);
select ok(
  (select deleted_at is not null from public.client_categories where name = 'Cat0078 Segunda')
  and (select category_id is null from public.clients where id = 'f7800000-0000-0000-0000-000000000501'),
  'la categoría quedó dada de baja y el cliente sin categoría'
);
select is(
  tests_0078.err_hint($$update public.clients set category_id = (select id from public.client_categories where name = 'Cat0078 Segunda') where id = 'f7800000-0000-0000-0000-000000000501'$$),
  'CATEGORY_NOT_FOUND', 'una categoría dada de baja no se puede asignar'
);
select lives_ok($$select public.upsert_client_category('Cat0078 Segunda')$$, 'el nombre de una dada de baja se puede volver a usar');
select is(
  tests_0078.err_hint($$select public.remove_client_category('f7800000-0000-0000-0000-0000000000ff')$$),
  'CATEGORY_NOT_FOUND', 'baja de una categoría inexistente'
);

select tests_0078.as_user('test-db0078-sup@example.com');
select is(tests_0078.err_hint($$select public.upsert_client_category('Cat0078 Sup')$$), 'FORBIDDEN', 'un coordinador no edita categorías');
select is((select count(*)::integer from public.client_categories), 0, 'un coordinador no lee client_categories');
select tests_0078.as_user('test-db0078-owner@example.com');
select lives_ok($$select public.upsert_client_category('Cat0078 Dueño')$$, 'el dueño también edita categorías');
select tests_0078.as_user('test-db0078-e1@example.com');
select is(tests_0078.err_hint($$select public.remove_client_category('f7800000-0000-0000-0000-0000000000ff')$$), 'FORBIDDEN', 'un empleado no da de baja categorías');

-- ---------------------------------------------------------------------------------------------
-- 2. Borrado del dueño: fixtures
-- ---------------------------------------------------------------------------------------------

set local role postgres;

insert into public.clients (id, legal_name, trade_name, status, calendar_color, photo_path) values
  ('f7800000-0000-0000-0000-000000000601', 'Razón Social Uno 0078 SA', 'Uno 0078', 'active', 0, null),
  ('f7800000-0000-0000-0000-000000000602', 'Razón Social Dos 0078 SA', 'Dos 0078', 'active', 0, 'f7800000/foto.webp');

insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f7800000-0000-0000-0000-000000000611', 'f7800000-0000-0000-0000-000000000601', 'Sede Uno 0078', 'Dirección 1', -34.6, -58.4, 'active'),
  ('f7800000-0000-0000-0000-000000000612', 'f7800000-0000-0000-0000-000000000601', 'Sede Vacía 0078', 'Dirección 2', -34.6, -58.4, 'active'),
  ('f7800000-0000-0000-0000-000000000613', 'f7800000-0000-0000-0000-000000000602', 'Sede Dos 0078', 'Dirección 3', -34.6, -58.4, 'active');

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, status) values
  ('f7800000-0000-0000-0000-000000000621', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', 'Servicio Uno 0078', array[1,2,3,4,5]::smallint[], '08:00', '12:00', 2, app.today(), 'active'),
  ('f7800000-0000-0000-0000-000000000622', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', 'Servicio Sin Turnos 0078', array[1]::smallint[], '08:00', '12:00', 2, app.today(), 'active');

insert into public.service_fixed_employees (service_id, employee_id) values
  ('f7800000-0000-0000-0000-000000000622', 'f7800000-0000-0000-0000-0000000000a1');

-- Turnos del servicio uno: limpio (con asignación, tareas y observación), con fichaje, con tarea trabajada.
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f7800000-0000-0000-0000-000000000701', 'f7800000-0000-0000-0000-000000000621', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', app.today() + 3, '08:00', '12:00', 2, 'scheduled'),
  ('f7800000-0000-0000-0000-000000000702', 'f7800000-0000-0000-0000-000000000621', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', app.today() + 4, '08:00', '12:00', 2, 'scheduled'),
  ('f7800000-0000-0000-0000-000000000703', 'f7800000-0000-0000-0000-000000000621', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', app.today() + 5, '08:00', '12:00', 2, 'scheduled'),
  ('f7800000-0000-0000-0000-000000000704', 'f7800000-0000-0000-0000-000000000621', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', app.today() + 6, '08:00', '12:00', 2, 'scheduled');
-- Turno puntual (sin servicio) de la sede uno, limpio, con Elena asignada.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f7800000-0000-0000-0000-000000000705', 'f7800000-0000-0000-0000-000000000601', 'f7800000-0000-0000-0000-000000000611', app.today() + 40, '08:00', '12:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('f7800000-0000-0000-0000-000000000801', 'f7800000-0000-0000-0000-000000000701', 'f7800000-0000-0000-0000-0000000000a1'),
  ('f7800000-0000-0000-0000-000000000802', 'f7800000-0000-0000-0000-000000000702', 'f7800000-0000-0000-0000-0000000000a2'),
  ('f7800000-0000-0000-0000-000000000803', 'f7800000-0000-0000-0000-000000000704', 'f7800000-0000-0000-0000-0000000000a1'),
  ('f7800000-0000-0000-0000-000000000804', 'f7800000-0000-0000-0000-000000000705', 'f7800000-0000-0000-0000-0000000000a1');

insert into public.shift_tasks (shift_id, position, title, is_required) values
  ('f7800000-0000-0000-0000-000000000701', 1, 'Barrer', true),
  ('f7800000-0000-0000-0000-000000000701', 2, 'Trapear', true);
insert into public.shift_observations (shift_id, observation) values
  ('f7800000-0000-0000-0000-000000000701', 'Observación del turno limpio');

-- Con historia: fichaje del turno 702 (Esteban) y tarea trabajada del turno 703.
insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f7800000-0000-0000-0000-000000000802', 'check_in', now(), 'employee_app');
insert into public.shift_tasks (shift_id, position, title, is_required, status) values
  ('f7800000-0000-0000-0000-000000000703', 1, 'Vidrios', true, 'done');

-- Cliente dos: contactos, banco, habilitaciones, preferencia y plantilla con tareas.
insert into public.client_contacts (client_id, name) values ('f7800000-0000-0000-0000-000000000602', 'Contacta 0078');
insert into public.client_bank_details (client_id, bank_name) values ('f7800000-0000-0000-0000-000000000602', 'Banco 0078');
insert into public.employee_client_permissions (employee_id, client_id) values
  ('f7800000-0000-0000-0000-0000000000a1', 'f7800000-0000-0000-0000-000000000602');
insert into public.supervisor_priorities (supervisor_id, client_id) values
  ('f7800000-0000-0000-0000-000000000091', 'f7800000-0000-0000-0000-000000000602');
insert into public.supervisor_priorities (supervisor_id, site_id) values
  ('f7800000-0000-0000-0000-000000000091', 'f7800000-0000-0000-0000-000000000612');
insert into public.checklist_templates (id, client_id, name) values
  ('f7800000-0000-0000-0000-000000000901', 'f7800000-0000-0000-0000-000000000602', 'Plantilla 0078');
insert into public.checklist_template_items (template_id, position, title) values
  ('f7800000-0000-0000-0000-000000000901', 1, 'Tarea de plantilla');

-- Empleados: Elena (libre, con disponibilidad, licencia, habilitación y un evento de seguridad),
-- Esteban (fichó), Emilia (figura como autora de un registro de otro), Ernesto (dueño y empleado).
insert into public.employee_availability (employee_id, weekday, start_time, end_time) values
  ('f7800000-0000-0000-0000-0000000000a1', 1, '08:00', '12:00');
insert into public.employee_leaves (employee_id, starts_on, ends_on, reason) values
  ('f7800000-0000-0000-0000-0000000000a1', app.today() + 30, app.today() + 32, 'Vacaciones');
insert into public.clients (id, legal_name, status, calendar_color, created_by) values
  ('f7800000-0000-0000-0000-000000000603', 'Cliente creado por Emilia 0078', 'active', 0, 'f7800000-0000-0000-0000-0000000000a3');
select app.log_security_event('sign_in'::public.security_event_type, 'f7800000-0000-0000-0000-0000000000a1', null, jsonb_build_object('ok', true));

-- ---------------------------------------------------------------------------------------------
-- 2.1 Permisos: solo el dueño
-- ---------------------------------------------------------------------------------------------

select tests_0078.as_user('test-db0078-admin@example.com');
select is(tests_0078.err_hint($$select public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000701')$$), 'FORBIDDEN', 'un administrador no ve la vista previa de un borrado');
select is(tests_0078.err_hint($$select public.owner_delete_shift('f7800000-0000-0000-0000-000000000701')$$), 'FORBIDDEN', 'un administrador no borra turnos');
select is(tests_0078.err_hint($$select public.owner_delete_service('f7800000-0000-0000-0000-000000000622', 'Servicio Sin Turnos 0078')$$), 'FORBIDDEN', 'un administrador no borra servicios');
select is(tests_0078.err_hint($$select public.owner_delete_service_shifts('f7800000-0000-0000-0000-000000000621', app.today(), 'Servicio Uno 0078')$$), 'FORBIDDEN', 'un administrador no borra turnos de un servicio');
select is(tests_0078.err_hint($$select public.owner_delete_site('f7800000-0000-0000-0000-000000000612', 'Sede Vacía 0078')$$), 'FORBIDDEN', 'un administrador no borra sedes');
select is(tests_0078.err_hint($$select public.owner_delete_client('f7800000-0000-0000-0000-000000000602', 'Dos 0078')$$), 'FORBIDDEN', 'un administrador no borra clientes');
select is(tests_0078.err_hint($$select public.owner_delete_employee('f7800000-0000-0000-0000-0000000000a1', 'Elena Libre')$$), 'FORBIDDEN', 'un administrador no borra empleados');
select tests_0078.as_user('test-db0078-sup@example.com');
select is(tests_0078.err_hint($$select public.owner_delete_preview_client('f7800000-0000-0000-0000-000000000602')$$), 'FORBIDDEN', 'un coordinador no ve la vista previa');
select tests_0078.as_user('test-db0078-e1@example.com');
select is(tests_0078.err_hint($$select public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a1')$$), 'FORBIDDEN', 'un empleado no ve la vista previa');
select ok(
  not has_function_privilege('anon', 'public.owner_delete_shift(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.owner_delete_employee(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.owner_delete_employee(uuid, text)', 'execute'),
  'anon no ejecuta los borrados; authenticated sí (la RPC valida el rol)'
);

-- ---------------------------------------------------------------------------------------------
-- 2.2 Turno
-- ---------------------------------------------------------------------------------------------

select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  tests_0078.err_hint($$select public.owner_delete_preview_shift('f7800000-0000-0000-0000-0000000000ff')$$),
  'SHIFT_NOT_FOUND', 'vista previa de un turno inexistente'
);
select is(
  (select (public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000701')) ->> 'can_delete'),
  'true', 'turno sin historia: se puede borrar'
);
select is(
  (select jsonb_path_query_first(public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000701') -> 'will_delete', '$[*] ? (@.code == "assignments")') ->> 'count'),
  '1', 'la vista previa cuenta las asignaciones que se borran'
);
select is(
  (select public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000702') -> 'blockers' -> 0 ->> 'code'),
  'HAS_ATTENDANCE', 'turno con fichaje: bloqueo HAS_ATTENDANCE'
);
select is(
  (select public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000702') -> 'blockers' -> 0 ->> 'message'),
  'Este turno tiene 1 fichaje.', 'mensaje del bloqueo, en singular'
);
select is(
  (select public.owner_delete_preview_shift('f7800000-0000-0000-0000-000000000703') -> 'blockers' -> 0 ->> 'code'),
  'HAS_DONE_TASKS', 'turno con tarea trabajada: bloqueo HAS_DONE_TASKS'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_shift('f7800000-0000-0000-0000-000000000702')$$),
  'DELETE_BLOCKED', 'borrar un turno con historia -> DELETE_BLOCKED'
);
select is(
  (tests_0078.err_detail($$select public.owner_delete_shift('f7800000-0000-0000-0000-000000000702')$$)::jsonb) -> 0 ->> 'code',
  'HAS_ATTENDANCE', 'el detalle del error trae los bloqueos como JSON'
);
select is(
  (select public.owner_delete_shift('f7800000-0000-0000-0000-000000000701') -> 'deleted' ->> 'assignments'),
  '1', 'borra el turno sin historia (con su asignación)'
);
set local role postgres;
select ok(
  not exists (select 1 from public.shifts where id = 'f7800000-0000-0000-0000-000000000701')
  and not exists (select 1 from public.assignments where shift_id = 'f7800000-0000-0000-0000-000000000701')
  and not exists (select 1 from public.shift_tasks where shift_id = 'f7800000-0000-0000-0000-000000000701')
  and not exists (select 1 from public.shift_observations where shift_id = 'f7800000-0000-0000-0000-000000000701'),
  'el turno, sus asignaciones, tareas y observación ya no existen'
);
select ok(
  (select e.details ->> 'entity' = 'shift'
     and e.details -> 'snapshot' -> 'shift' ->> 'id' = 'f7800000-0000-0000-0000-000000000701'
     and jsonb_array_length(e.details -> 'snapshot' -> 'tasks') = 2
     and e.actor_id = 'f7800000-0000-0000-0000-000000000081'
   from public.security_events e
   where e.event_type = 'record_deleted' and e.details ->> 'record_id' = 'f7800000-0000-0000-0000-000000000701'),
  'record_deleted: quién, qué y la copia JSON del turno con sus tareas'
);
select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  tests_0078.err_hint($$select public.owner_delete_shift('f7800000-0000-0000-0000-000000000701')$$),
  'SHIFT_NOT_FOUND', 'borrar de nuevo -> SHIFT_NOT_FOUND'
);

-- ---------------------------------------------------------------------------------------------
-- 2.3 Servicio y turnos de un servicio
-- ---------------------------------------------------------------------------------------------

select is(
  (select public.owner_delete_preview_service('f7800000-0000-0000-0000-000000000621') -> 'blockers' -> 0 ->> 'code'),
  'HAS_SHIFTS', 'servicio con turnos: bloqueo HAS_SHIFTS'
);
select is(
  (select public.owner_delete_preview_service('f7800000-0000-0000-0000-000000000621') -> 'blockers' -> 0 ->> 'message'),
  'Este servicio todavía tiene 3 turnos. Eliminá primero sus turnos.', 'mensaje del bloqueo del servicio'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_service('f7800000-0000-0000-0000-000000000621', 'Otro nombre')$$),
  'CONFIRM_NAME_MISMATCH', 'el nombre escrito tiene que coincidir (se verifica antes que los bloqueos)'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_service('f7800000-0000-0000-0000-000000000621', 'servicio uno 0078')$$),
  'DELETE_BLOCKED', 'con el nombre bien escrito (sin importar mayúsculas), los turnos bloquean'
);
select is(
  (select public.owner_delete_preview_service_shifts('f7800000-0000-0000-0000-000000000621', app.today()) ->> 'deletable_count'),
  '1', 'turnos desde la fecha: 1 borrable'
);
select is(
  (select public.owner_delete_preview_service_shifts('f7800000-0000-0000-0000-000000000621', app.today()) -> 'skipped' -> 0 ->> 'reasons'),
  '["HAS_ATTENDANCE"]', 'turnos desde la fecha: se saltean los que tienen historia, con su motivo'
);
select is(
  (select public.owner_delete_preview_service_shifts('f7800000-0000-0000-0000-000000000621', app.today() + 6) ->> 'deletable_count'),
  '1', 'la fecha acota: desde hoy + 6 solo queda el último'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_preview_service_shifts('f7800000-0000-0000-0000-000000000621', null)$$),
  'FROM_DATE_REQUIRED', 'la fecha es obligatoria'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_service_shifts('f7800000-0000-0000-0000-000000000621', app.today(), 'No es')$$),
  'CONFIRM_NAME_MISMATCH', 'borrar turnos del servicio pide el nombre del servicio'
);
select is(
  (select public.owner_delete_service_shifts('f7800000-0000-0000-0000-000000000621', app.today(), 'Servicio Uno 0078') -> 'deleted' ->> 'shifts'),
  '1', 'borra los turnos sin historia (1) y saltea los otros'
);
select is(
  (select public.owner_delete_preview_service('f7800000-0000-0000-0000-000000000621') -> 'blockers' -> 0 ->> 'count'),
  '2', 'al servicio le quedan los 2 turnos con historia'
);
set local role postgres;
select is(
  (select count(*)::integer from public.security_events where event_type = 'record_deleted' and details ->> 'entity' = 'service_shifts' and details ->> 'record_id' = 'f7800000-0000-0000-0000-000000000621'),
  1, 'record_deleted de los turnos del servicio'
);
select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  (select public.owner_delete_service_shifts('f7800000-0000-0000-0000-000000000621', app.today(), 'Servicio Uno 0078') ->> 'event_id'),
  null, 'sin nada para borrar no deja evento'
);
select is(
  (select public.owner_delete_service('f7800000-0000-0000-0000-000000000622', 'servicio sin turnos 0078') -> 'deleted' ->> 'fixed_employees'),
  '1', 'borra el servicio sin turnos con sus empleados fijos'
);
set local role postgres;
select ok(
  not exists (select 1 from public.services where id = 'f7800000-0000-0000-0000-000000000622')
  and not exists (select 1 from public.service_fixed_employees where service_id = 'f7800000-0000-0000-0000-000000000622')
  and exists (select 1 from public.security_events where event_type = 'record_deleted' and details ->> 'entity' = 'service' and details ->> 'record_id' = 'f7800000-0000-0000-0000-000000000622'),
  'el servicio y sus fijos ya no existen; queda el evento'
);

-- ---------------------------------------------------------------------------------------------
-- 2.4 Sede
-- ---------------------------------------------------------------------------------------------

select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  (select public.owner_delete_preview_site('f7800000-0000-0000-0000-000000000611') -> 'blockers' -> 0 ->> 'message'),
  'Esta sede todavía tiene 1 servicio.', 'sede con servicios: HAS_SERVICES'
);
select is(
  (select public.owner_delete_preview_site('f7800000-0000-0000-0000-000000000611') -> 'blockers' -> 1 ->> 'message'),
  'Esta sede todavía tiene 3 turnos.', 'sede con turnos: HAS_SHIFTS'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_site('f7800000-0000-0000-0000-000000000611', 'Sede Uno 0078')$$),
  'DELETE_BLOCKED', 'borrar una sede con servicios y turnos -> DELETE_BLOCKED'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_site('f7800000-0000-0000-0000-000000000612', 'Otra')$$),
  'CONFIRM_NAME_MISMATCH', 'borrar una sede pide su nombre'
);
select is(
  (select public.owner_delete_site('f7800000-0000-0000-0000-000000000612', 'sede vacía 0078') -> 'deleted' ->> 'priorities'),
  '1', 'borra la sede vacía junto con su preferencia de coordinador'
);
set local role postgres;
select ok(
  not exists (select 1 from public.sites where id = 'f7800000-0000-0000-0000-000000000612')
  and not exists (select 1 from public.supervisor_priorities where site_id = 'f7800000-0000-0000-0000-000000000612'),
  'la sede y su preferencia ya no existen'
);

-- ---------------------------------------------------------------------------------------------
-- 2.5 Cliente
-- ---------------------------------------------------------------------------------------------

select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  (select public.owner_delete_preview_client('f7800000-0000-0000-0000-000000000601') -> 'blockers' -> 0 ->> 'message'),
  'Este cliente todavía tiene 1 sede.', 'cliente con sedes: HAS_SITES'
);
select is(
  (select public.owner_delete_preview_client('f7800000-0000-0000-0000-000000000601') -> 'blockers' -> 1 ->> 'message'),
  'Este cliente todavía tiene 1 servicio.', 'cliente con servicios: HAS_SERVICES'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_client('f7800000-0000-0000-0000-000000000601', 'Uno 0078')$$),
  'DELETE_BLOCKED', 'borrar un cliente con sedes y servicios -> DELETE_BLOCKED'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_client('f7800000-0000-0000-0000-000000000602', 'Otro')$$),
  'CONFIRM_NAME_MISMATCH', 'borrar un cliente pide su nombre'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_client('f7800000-0000-0000-0000-000000000602', 'Dos 0078')$$),
  'DELETE_BLOCKED', 'el cliente dos todavía tiene su sede'
);
select lives_ok(
  $$select public.owner_delete_site('f7800000-0000-0000-0000-000000000613', 'Sede Dos 0078')$$,
  'se borra primero la sede del cliente dos'
);
select is(
  (select public.owner_delete_client('f7800000-0000-0000-0000-000000000602', 'razón social dos 0078 sa') ->> 'photo_path'),
  'f7800000/foto.webp', 'borra el cliente (se acepta la razón social) y devuelve la foto para limpiar Storage'
);
set local role postgres;
select ok(
  not exists (select 1 from public.clients where id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.client_contacts where client_id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.client_bank_details where client_id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.employee_client_permissions where client_id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.supervisor_priorities where client_id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.checklist_templates where client_id = 'f7800000-0000-0000-0000-000000000602')
  and not exists (select 1 from public.checklist_template_items where template_id = 'f7800000-0000-0000-0000-000000000901'),
  'el cliente y todo lo que colgaba de él ya no existen'
);
select ok(
  (select e.details -> 'snapshot' -> 'client' ->> 'trade_name' = 'Dos 0078'
     and jsonb_array_length(e.details -> 'snapshot' -> 'contacts') = 1
     and jsonb_array_length(e.details -> 'snapshot' -> 'checklist_templates') = 1
   from public.security_events e
   where e.event_type = 'record_deleted' and e.details ->> 'record_id' = 'f7800000-0000-0000-0000-000000000602'),
  'el evento guarda la copia JSON del cliente, sus contactos y su plantilla'
);

-- ---------------------------------------------------------------------------------------------
-- 2.6 Empleado
-- ---------------------------------------------------------------------------------------------

select tests_0078.as_user('test-db0078-owner@example.com');
select is(
  (select public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a2') -> 'blockers' -> 0 ->> 'code'),
  'HAS_ATTENDANCE', 'empleado con fichajes: HAS_ATTENDANCE'
);
select ok(
  (select exists (select 1 from jsonb_array_elements(public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a2') -> 'blockers') b where b ->> 'code' = 'HAS_HISTORY_ASSIGNMENTS')),
  'empleado asignado a un turno con historia: HAS_HISTORY_ASSIGNMENTS'
);
select is(
  (select public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a3') -> 'blockers' -> 0 ->> 'code'),
  'HAS_OTHER_RECORDS', 'empleado que figura como autor de otro registro: HAS_OTHER_RECORDS'
);
select ok(
  (select (public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a3') -> 'blockers' -> 0 ->> 'message') like '%clients.created_by%'),
  'el mensaje nombra la tabla y la columna'
);
select is(
  (select public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a4') -> 'blockers' -> 0 ->> 'code'),
  'IS_OWNER', 'un dueño no se elimina'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_employee('f7800000-0000-0000-0000-0000000000a2', 'Esteban Fichado')$$),
  'DELETE_BLOCKED', 'borrar un empleado con historia -> DELETE_BLOCKED'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_employee('f7800000-0000-0000-0000-0000000000a1', 'Otra Persona')$$),
  'CONFIRM_NAME_MISMATCH', 'borrar un empleado pide su nombre'
);
select is(
  tests_0078.err_hint($$select public.owner_delete_employee('f7800000-0000-0000-0000-0000000000ff', 'Nadie')$$),
  'EMPLOYEE_NOT_FOUND', 'empleado inexistente'
);
select is(
  (select public.owner_delete_preview_employee('f7800000-0000-0000-0000-000000000081')) -> 'blockers' -> 0 ->> 'code',
  'IS_SELF', 'el dueño que consulta no se elimina a sí mismo'
);
select is(
  (select public.owner_delete_preview_employee('f7800000-0000-0000-0000-0000000000a1') ->> 'can_delete'),
  'true', 'Elena (solo asignaciones sin historia, disponibilidad, licencia) se puede borrar'
);
select is(
  (select public.owner_delete_employee('f7800000-0000-0000-0000-0000000000a1', 'libre elena') -> 'deleted' ->> 'assignments'),
  '1', 'borra a Elena (se acepta «Apellido Nombre») con su asignación sin historia (el turno puntual del futuro)'
);
set local role postgres;
select ok(
  not exists (select 1 from public.profiles where id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.employees where profile_id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.user_roles where profile_id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.assignments where employee_id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.employee_availability where employee_id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.employee_leaves where employee_id = 'f7800000-0000-0000-0000-0000000000a1')
  and not exists (select 1 from public.employee_client_permissions where employee_id = 'f7800000-0000-0000-0000-0000000000a1'),
  'Elena y todo lo suyo ya no existen en la base'
);
select ok(
  exists (select 1 from auth.users where id = 'f7800000-0000-0000-0000-0000000000a1'),
  'el usuario de Auth queda: lo borra la Edge Function admin-users (delete_user)'
);
select ok(
  (select e.actor_id is null and e.details -> 'actor_deleted' ->> 'id' = 'f7800000-0000-0000-0000-0000000000a1'
     and e.details -> 'actor_deleted' ->> 'name' = 'Elena Libre'
   from public.security_events e
   where e.event_type = 'sign_in' and e.details ->> 'ok' = 'true' and e.details -> 'actor_deleted' ->> 'id' = 'f7800000-0000-0000-0000-0000000000a1'),
  'los eventos de seguridad anteriores quedan desvinculados, con quién era en details'
);
select ok(
  (select e.details -> 'snapshot' -> 'profile' ->> 'first_name' = 'Elena'
     and jsonb_array_length(e.details -> 'snapshot' -> 'assignments') = 1
     and not (e.details -> 'snapshot' ? 'credentials')
   from public.security_events e
   where e.event_type = 'record_deleted' and e.details ->> 'record_id' = 'f7800000-0000-0000-0000-0000000000a1'),
  'record_deleted con la copia JSON de la ficha y las asignaciones, sin contraseña'
);

select * from finish();

rollback;
