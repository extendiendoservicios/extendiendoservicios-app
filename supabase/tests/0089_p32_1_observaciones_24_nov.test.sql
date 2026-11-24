-- pgTAP de la migración 0089_p32_1_observaciones_24_nov.sql (P32.1):
--   OJ-01  recarga de tareas en lote: count_outdated_template_shifts / reload_template_shift_tasks.
--   OJ-03  consultas por rango: get_supervisor_shifts (coordinador) y get_my_services (empleado);
--          v_my_day y v_supervisor_upcoming sin cambios.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f89a0000-...'. Todos los turnos son relativos a app.today() (días enteros, sin
-- sumar horas a now()); los turnos «ya empezados» son los de AYER y el de HOY de 00:00 a 00:30, así
-- nada depende de la hora del día en que corra el CI.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0089;
grant usage on schema tests_0089 to authenticated, anon;

create or replace function tests_0089.as_user(p_email text)
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
    raise exception 'tests_0089.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0089.as_user(text) to authenticated, anon;

select plan(51);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f89a0000-0000-0000-0000-000000000001', 'Cliente 0089 SA', 'Cliente 0089', 'active', 2),
  ('f89a0000-0000-0000-0000-000000000002', 'Otro cliente 0089 SA', 'Otro 0089', 'active', 3);
insert into public.sites (id, client_id, name, address, status) values
  ('f89a0000-0000-0000-0000-000000000011', 'f89a0000-0000-0000-0000-000000000001', 'Sede propia 89', 'Dirección 89', 'active'),
  ('f89a0000-0000-0000-0000-000000000012', 'f89a0000-0000-0000-0000-000000000001', 'Sede sin propia 89', 'Dirección 89 bis', 'active'),
  ('f89a0000-0000-0000-0000-000000000013', 'f89a0000-0000-0000-0000-000000000002', 'Sede del otro 89', 'Dirección 89 ter', 'active');

-- Plantillas: la del cliente (21) con dos ítems vigentes y uno borrado; la de la sede 11 (22);
-- y la del otro cliente (23).
insert into public.checklist_templates (id, client_id, site_id, name) values
  ('f89a0000-0000-0000-0000-000000000021', 'f89a0000-0000-0000-0000-000000000001', null, 'Plantilla cliente 89'),
  ('f89a0000-0000-0000-0000-000000000022', 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011', 'Plantilla sede 89'),
  ('f89a0000-0000-0000-0000-000000000023', 'f89a0000-0000-0000-0000-000000000002', null, 'Plantilla otro 89');
insert into public.checklist_template_items (template_id, position, title, description, is_required, deleted_at) values
  ('f89a0000-0000-0000-0000-000000000021', 1, 'Barrer', null, true, null),
  ('f89a0000-0000-0000-0000-000000000021', 2, 'Trapear', 'Con desinfectante', false, null),
  ('f89a0000-0000-0000-0000-000000000021', 3, 'Ítem borrado', null, true, now()),
  ('f89a0000-0000-0000-0000-000000000022', 1, 'Vidrios', null, true, null),
  ('f89a0000-0000-0000-0000-000000000023', 1, 'Del otro cliente', null, true, null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f89a0000-0000-0000-0000-000000000081', 'test-db0089-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Ochenta y nueve')),
  ('f89a0000-0000-0000-0000-000000000082', 'test-db0089-admin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('f89a0000-0000-0000-0000-000000000083', 'test-db0089-admin-sin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('f89a0000-0000-0000-0000-000000000091', 'test-db0089-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f89a0000-0000-0000-0000-0000000000a1', 'test-db0089-e1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f89a0000-0000-0000-0000-0000000000a2', 'test-db0089-e2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter'));

insert into public.user_roles (profile_id, role) values
  ('f89a0000-0000-0000-0000-000000000081', 'owner'),
  ('f89a0000-0000-0000-0000-000000000082', 'admin'),
  ('f89a0000-0000-0000-0000-000000000083', 'admin'),
  ('f89a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f89a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f89a0000-0000-0000-0000-0000000000a2', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f89a0000-0000-0000-0000-000000000082', 'edit_checklists', true),
  ('f89a0000-0000-0000-0000-000000000083', 'edit_checklists', false);

insert into public.employees (profile_id, dni, status) values
  ('f89a0000-0000-0000-0000-000000000091', '98903091', 'active'),
  ('f89a0000-0000-0000-0000-0000000000a1', '98903101', 'active'),
  ('f89a0000-0000-0000-0000-0000000000a2', '98903102', 'active');

-- Turnos (sede 11 = con plantilla propia, 12 = sin propia):
--   101 sede 11  +1   scheduled, sin plantilla ni tareas                 -> desactualizado (plantilla distinta)
--   102 sede 12  +2   scheduled, sin plantilla ni tareas                 -> desactualizado
--   103 sede 12  +3   assigned, plantilla 21 y tareas iguales a la 21    -> al día
--   104 sede 12  +4   scheduled, sin plantilla, una tarea 'done'         -> se saltea
--   105 sede 12  AYER scheduled (ya empezó)                              -> no se toca
--   106 sede 12  +5   in_progress                                         -> no se toca
--   107 sede 12  +6   completed                                           -> no se toca
--   108 sede 12  +7   cancelled                                           -> no se toca
--   109 sede 12  +8   scheduled pero dado de baja (deleted_at)            -> no se toca
--   110 sede 11  +9   scheduled, plantilla 22 pero tarea no obligatoria  -> desactualizado (tareas distintas)
--   111 sede 13 (otro cliente) +2 scheduled sin plantilla                 -> de otro cliente
--   112 sede 12  +61  scheduled (fuera del rango de próximos días)
--   113 sede 12  +60  scheduled
--   114 sede 12  HOY de 00:00 a 00:30 scheduled (ya empezó)               -> no se toca
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, deleted_at) values
  ('f89a0000-0000-0000-0000-000000000101', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011', app.today() + 1, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000102', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 2, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000103', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 3, '09:00', '12:00', 1, 'assigned', false, null),
  ('f89a0000-0000-0000-0000-000000000104', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 4, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000105', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() - 1, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000106', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 5, '09:00', '12:00', 1, 'in_progress', false, null),
  ('f89a0000-0000-0000-0000-000000000107', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 6, '09:00', '12:00', 1, 'completed', false, null),
  ('f89a0000-0000-0000-0000-000000000108', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 7, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000109', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 8, '09:00', '12:00', 1, 'scheduled', false, now()),
  ('f89a0000-0000-0000-0000-000000000110', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011', app.today() + 9, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000111', null, 'f89a0000-0000-0000-0000-000000000002', 'f89a0000-0000-0000-0000-000000000013', app.today() + 2, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000112', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 61, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000113', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today() + 60, '09:00', '12:00', 1, 'scheduled', false, null),
  ('f89a0000-0000-0000-0000-000000000114', null, 'f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012', app.today(), '00:00', '00:30', 1, 'scheduled', false, null);

update public.shifts
set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f89a0000-0000-0000-0000-000000000081', cancel_reason = 'Prueba'
where id = 'f89a0000-0000-0000-0000-000000000108';
update public.shifts set checklist_template_id = 'f89a0000-0000-0000-0000-000000000021' where id = 'f89a0000-0000-0000-0000-000000000103';
update public.shifts set checklist_template_id = 'f89a0000-0000-0000-0000-000000000022' where id = 'f89a0000-0000-0000-0000-000000000110';

insert into public.shift_tasks (shift_id, position, title, description, is_required, status) values
  ('f89a0000-0000-0000-0000-000000000103', 1, 'Barrer', null, true, 'pending'),
  ('f89a0000-0000-0000-0000-000000000103', 2, 'Trapear', 'Con desinfectante', false, 'pending'),
  ('f89a0000-0000-0000-0000-000000000104', 1, 'Tarea vieja', null, true, 'done'),
  ('f89a0000-0000-0000-0000-000000000110', 1, 'Vidrios', null, false, 'pending');

-- Asignaciones: e1 en 102 (+2), 110 (+9), 112 (+61), 105 (ayer), 114 (hoy); e2 en 103.
insert into public.assignments (id, shift_id, employee_id, status) values
  ('f89a0000-0000-0000-0000-000000000201', 'f89a0000-0000-0000-0000-000000000102', 'f89a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f89a0000-0000-0000-0000-000000000202', 'f89a0000-0000-0000-0000-000000000110', 'f89a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f89a0000-0000-0000-0000-000000000203', 'f89a0000-0000-0000-0000-000000000112', 'f89a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f89a0000-0000-0000-0000-000000000204', 'f89a0000-0000-0000-0000-000000000105', 'f89a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f89a0000-0000-0000-0000-000000000205', 'f89a0000-0000-0000-0000-000000000114', 'f89a0000-0000-0000-0000-0000000000a1', 'expected'),
  ('f89a0000-0000-0000-0000-000000000206', 'f89a0000-0000-0000-0000-000000000103', 'f89a0000-0000-0000-0000-0000000000a2', 'expected');

-- Estructura y grants --------------------------------------------------------------------------

select has_function('app', 'outdated_template_shifts', array['uuid', 'uuid'], 'existe app.outdated_template_shifts');
select has_function('public', 'count_outdated_template_shifts', array['uuid', 'uuid'], 'existe count_outdated_template_shifts');
select has_function('public', 'reload_template_shift_tasks', array['uuid', 'uuid'], 'existe reload_template_shift_tasks');
select has_function('public', 'get_supervisor_shifts', array['date', 'date'], 'existe get_supervisor_shifts');
select has_function('public', 'get_my_services', array['date', 'date'], 'existe get_my_services');
select has_function('app', 'supervisor_shifts_between', array['date', 'date'], 'existe app.supervisor_shifts_between');
select ok(
  has_function_privilege('authenticated', 'public.count_outdated_template_shifts(uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.reload_template_shift_tasks(uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.get_supervisor_shifts(date, date)', 'execute')
    and has_function_privilege('authenticated', 'public.get_my_services(date, date)', 'execute')
    and not has_function_privilege('anon', 'public.count_outdated_template_shifts(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.reload_template_shift_tasks(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.get_supervisor_shifts(date, date)', 'execute')
    and not has_function_privilege('anon', 'public.get_my_services(date, date)', 'execute')
    and not has_function_privilege('authenticated', 'app.outdated_template_shifts(uuid, uuid)', 'execute'),
  'grants: authenticated sí en las RPC públicas, anon no; la interna no se expone'
);

-- Permisos de la recarga -----------------------------------------------------------------------

select tests_0089.as_user('test-db0089-admin-sin@example.com');
select throws_ok(
  $$select public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001')$$,
  'P0001', null, 'count: un administrador sin edit_checklists no puede'
);
select throws_ok(
  $$select public.reload_template_shift_tasks('f89a0000-0000-0000-0000-000000000001')$$,
  'P0001', null, 'reload: un administrador sin edit_checklists no puede'
);
select tests_0089.as_user('test-db0089-sup@example.com');
select throws_ok(
  $$select public.reload_template_shift_tasks('f89a0000-0000-0000-0000-000000000001')$$,
  'P0001', null, 'reload: un coordinador no puede'
);
select tests_0089.as_user('test-db0089-e1@example.com');
select throws_ok(
  $$select public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001')$$,
  'P0001', null, 'count: un empleado no puede'
);

-- Alcance y conteo -----------------------------------------------------------------------------

select tests_0089.as_user('test-db0089-admin-cap@example.com');

select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011'),
  2, 'count sede 11 (propia): 101 (plantilla distinta) y 110 (tareas distintas)'
);
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001'),
  3, 'count cliente: 102, 112 y 113 (103 al día, 104 con tarea marcada, la sede 11 tiene plantilla propia)'
);
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000012'),
  3, 'count sede 12 explícita (sin plantilla propia): igual que el cliente'
);
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000002'),
  1, 'count otro cliente: solo su turno'
);
select throws_ok(
  $$select public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000013')$$,
  'P0001', 'No encontramos esa sede en este cliente.', 'count: una sede de otro cliente da SITE_NOT_FOUND'
);
select throws_ok(
  $$select public.count_outdated_template_shifts('f89a0000-0000-0000-0000-0000000000ff')$$,
  'P0001', 'No encontramos ese cliente.', 'count: cliente inexistente da CLIENT_NOT_FOUND'
);

-- Recarga de la sede ---------------------------------------------------------------------------

select is(
  public.reload_template_shift_tasks('f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011'),
  2, 'reload sede 11: actualiza 2 turnos'
);
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001', 'f89a0000-0000-0000-0000-000000000011'),
  0, 'count sede 11 después de recargar = 0'
);

set local role postgres;
select is(
  (select array_agg(title order by position) from public.shift_tasks where shift_id = 'f89a0000-0000-0000-0000-000000000101'),
  array['Vidrios'], '101 tiene ahora las tareas de la plantilla de la sede'
);
select is(
  (select is_required from public.shift_tasks where shift_id = 'f89a0000-0000-0000-0000-000000000110'),
  true, '110 recuperó la obligatoriedad de la plantilla'
);
select is(
  (select checklist_template_id from public.shifts where id = 'f89a0000-0000-0000-0000-000000000101'),
  'f89a0000-0000-0000-0000-000000000022'::uuid, '101 quedó con la plantilla de la sede'
);

select tests_0089.as_user('test-db0089-admin-cap@example.com');
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001'),
  3, 'recargar la sede no tocó los turnos de las sedes sin plantilla propia (siguen 102, 112 y 113)'
);

-- Recarga del cliente --------------------------------------------------------------------------

select is(
  public.reload_template_shift_tasks('f89a0000-0000-0000-0000-000000000001'),
  3, 'reload cliente: actualiza 3 turnos (102, 112 y 113; el 112 queda a 61 días pero sigue siendo un turno futuro)'
);
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001'),
  0, 'count cliente después de recargar = 0'
);
select is(
  public.reload_template_shift_tasks('f89a0000-0000-0000-0000-000000000001'),
  0, 'reload cliente otra vez: 0 (idempotente)'
);

-- Lo que no se toca
set local role postgres;
select is(
  (select array_agg(title order by position) from public.shift_tasks where shift_id = 'f89a0000-0000-0000-0000-000000000102'),
  array['Barrer', 'Trapear'], '102 tiene las tareas vigentes (sin el ítem borrado)'
);
select is(
  (select array_agg(title) from public.shift_tasks where shift_id = 'f89a0000-0000-0000-0000-000000000104'),
  array['Tarea vieja'], '104 (tarea marcada) conserva sus tareas'
);
select is(
  (select count(*)::int from public.shift_tasks where shift_id in (
    'f89a0000-0000-0000-0000-000000000105', 'f89a0000-0000-0000-0000-000000000106',
    'f89a0000-0000-0000-0000-000000000107', 'f89a0000-0000-0000-0000-000000000108',
    'f89a0000-0000-0000-0000-000000000109', 'f89a0000-0000-0000-0000-000000000114'
  )) + (select count(*)::int from public.shifts where checklist_template_id is not null and id in (
    'f89a0000-0000-0000-0000-000000000105', 'f89a0000-0000-0000-0000-000000000106',
    'f89a0000-0000-0000-0000-000000000107', 'f89a0000-0000-0000-0000-000000000108',
    'f89a0000-0000-0000-0000-000000000109', 'f89a0000-0000-0000-0000-000000000114'
  )),
  0, 'ya empezados, en curso, finalizado, cancelado, dado de baja y fuera de la sede: sin tareas ni plantilla'
);
select is(
  (select count(*)::int from public.shift_tasks where shift_id = 'f89a0000-0000-0000-0000-000000000111'),
  0, 'el turno de otro cliente no se tocó'
);

-- Un cambio en la plantilla vuelve a mostrar turnos pendientes
set local role postgres;
insert into public.checklist_template_items (template_id, position, title) values
  ('f89a0000-0000-0000-0000-000000000021', 4, 'Ítem nuevo');
select tests_0089.as_user('test-db0089-owner@example.com');
select is(
  public.count_outdated_template_shifts('f89a0000-0000-0000-0000-000000000001'),
  4, 'dueño: tras agregar un ítem a la plantilla del cliente, 102, 103, 112 y 113 quedan desactualizados'
);

-- Consultas por rango: coordinador -------------------------------------------------------------

select tests_0089.as_user('test-db0089-sup@example.com');

select is(
  (select count(*)::int from public.get_supervisor_shifts(app.today() - 5, app.today() + 100)
    where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  8, 'coordinador: se recorta a mañana..hoy+60 (sin ayer, hoy, hoy+61, cancelado ni dado de baja)'
);
select is(
  (select max(shift_date) from public.get_supervisor_shifts(app.today() - 5, app.today() + 100)
    where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  (select app.today() + 60), 'coordinador: el último día es hoy + 60'
);
select is(
  (select min(shift_date) from public.get_supervisor_shifts(app.today() - 5, app.today() + 100)
    where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  (select app.today() + 1), 'coordinador: el primer día es mañana'
);
select is(
  (select count(*)::int from public.get_supervisor_shifts(app.today() + 61, app.today() + 90)
    where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  0, 'coordinador: un rango totalmente fuera devuelve cero filas'
);
select is(
  (select count(*)::int from public.get_supervisor_shifts(app.today() + 2, app.today() + 2)
    where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  1, 'coordinador: un solo día (hoy + 2: el turno 102)'
);
select throws_ok(
  $$select * from public.get_supervisor_shifts(current_date + 10, current_date + 5)$$,
  'P0001', 'El período no es válido.', 'coordinador: desde > hasta da INVALID_DATE_RANGE'
);
select throws_ok(
  $$select * from public.get_supervisor_shifts(null, current_date + 5)$$,
  'P0001', 'El período no es válido.', 'coordinador: fecha nula da INVALID_DATE_RANGE'
);
select results_eq(
  $$select shift_id from public.get_supervisor_shifts(app.today() + 1, app.today() + 7) where client_id = 'f89a0000-0000-0000-0000-000000000001' order by shift_id$$,
  $$select shift_id from public.v_supervisor_upcoming where client_id = 'f89a0000-0000-0000-0000-000000000001' order by shift_id$$,
  'v_supervisor_upcoming sigue igual: mañana..hoy+7 es lo mismo que get_supervisor_shifts(+1, +7)'
);
select is(
  (select count(*)::int from public.v_supervisor_upcoming where client_id = 'f89a0000-0000-0000-0000-000000000001'),
  6, 'v_supervisor_upcoming: 6 turnos de este cliente entre mañana y hoy + 7 (sin el cancelado)'
);
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_supervisor_upcoming'),
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_supervisor_today'),
  'v_supervisor_upcoming conserva las columnas'
);

select tests_0089.as_user('test-db0089-admin-cap@example.com');
select throws_ok(
  $$select * from public.get_supervisor_shifts(app.today() + 1, app.today() + 7)$$,
  'P0001', 'No tenés permiso para hacer esto.', 'un administrador no puede usar get_supervisor_shifts'
);
select tests_0089.as_user('test-db0089-e1@example.com');
select throws_ok(
  $$select * from public.get_supervisor_shifts(app.today() + 1, app.today() + 7)$$,
  'P0001', 'No tenés permiso para hacer esto.', 'un empleado no puede usar get_supervisor_shifts'
);

-- Consultas por rango: empleado ----------------------------------------------------------------

select results_eq(
  $$select shift_id from public.get_my_services(app.today() - 5, app.today() + 100) order by shift_id$$,
  $$values ('f89a0000-0000-0000-0000-000000000102'::uuid), ('f89a0000-0000-0000-0000-000000000110'::uuid)$$,
  'empleado: solo sus servicios entre mañana y hoy + 60 (sin ayer, hoy ni hoy + 61)'
);
select is(
  (select count(*)::int from public.get_my_services(app.today() + 61, app.today() + 90)),
  0, 'empleado: rango fuera de límites devuelve cero filas'
);
select is(
  (select array_agg(k order by k) from (
    select jsonb_object_keys(to_jsonb(s)) as k from public.get_my_services(app.today() + 2, app.today() + 2) s
  ) x),
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns where table_schema = 'public' and table_name = 'v_my_day'),
  'get_my_services tiene las mismas columnas que v_my_day'
);
select results_eq(
  $$select shift_id from public.v_my_day order by shift_id$$,
  $$values ('f89a0000-0000-0000-0000-000000000102'::uuid), ('f89a0000-0000-0000-0000-000000000114'::uuid)$$,
  'v_my_day sigue devolviendo de hoy a hoy + 7 (114 de hoy y 102)'
);
select is(
  (select count(*)::int from public.get_my_services(app.today() + 1, app.today() + 7) s
    join public.v_my_day d using (assignment_id)),
  1, 'get_my_services (+1..+7) coincide con las filas de v_my_day de esos días'
);
select throws_ok(
  $$select * from public.get_my_services(current_date + 10, current_date + 5)$$,
  'P0001', 'El período no es válido.', 'empleado: desde > hasta da INVALID_DATE_RANGE'
);

select tests_0089.as_user('test-db0089-e2@example.com');
select results_eq(
  $$select shift_id from public.get_my_services(app.today() + 1, app.today() + 60)$$,
  $$values ('f89a0000-0000-0000-0000-000000000103'::uuid)$$,
  'empleado 2: solo ve su propio servicio'
);
select tests_0089.as_user('test-db0089-sup@example.com');
select is(
  (select count(*)::int from public.get_my_services(app.today() + 1, app.today() + 60)),
  0, 'coordinador sin asignaciones propias: get_my_services vacío'
);

select * from finish();

rollback;
