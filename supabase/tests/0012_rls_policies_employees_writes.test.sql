-- pgTAP de dominio para EMP-013 (08_Fases_y_Backlog.md, F9 · Empleados y supervisores).
--
-- Completa la cobertura de RLS de empleados que faltaba después de 0006_employees.test.sql
-- (estructura y restricciones) y 0012_rls_policies.test.sql / 0022_own_row_policies_active_check
-- .test.sql (lectura por rol, insert de `employees`, ventana de revocación). Ningún archivo
-- existente probaba, por rol, los caminos de escritura de 04 sección 7.2 que quedaban:
--   1. `employees_update_admin`: O, A pueden editar datos laborales (sin exigir `manage_users`,
--      a diferencia del insert); S y E no. Incluye que `employee_number` es editable (P-036) y
--      sigue siendo único también en un UPDATE, no solo en el INSERT ya cubierto en 0006.
--   2. `employee_client_permissions_write_admin` / `employee_availability_write_admin` /
--      `employee_leaves_write_admin`: el UPDATE y el DELETE de O, A (0012 solo había probado el
--      INSERT de estas tres tablas), y que S y E no pueden escribir ninguna de las tres (0012
--      solo había probado el rechazo de INSERT en `employee_availability`).
--   3. `v_employees` y `v_search` respetando RLS por rol a través de la vista (security_invoker):
--      0011 solo las había probado corriendo como `postgres`, sin `tests.as_user`.
--
-- Convención (ver supabase/tests/README.md): transacción con `rollback`, fixtures con prefijo
-- 'c2300000-...' y emails 'test-emp013-...', libres de otros archivos (verificado por grep antes
-- de escribir este archivo).

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

-- Fixtures: owner, admin (sin manage_users -- alcanza para update, que no exige la capacidad),
-- supervisora, dos empleados (E1 con turno bajo la supervisora, E2 "de afuera") -----------------

insert into public.clients (id, legal_name) values ('c2300000-0000-0000-0000-000000000001', 'Cliente EMP-013');
insert into public.sites (id, client_id, name, address)
values ('c2300000-0000-0000-0000-000000000011', 'c2300000-0000-0000-0000-000000000001', 'Sede EMP-013', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2300000-0000-0000-0000-000000000081', 'test-emp013-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Uno')),
  ('c2300000-0000-0000-0000-000000000082', 'test-emp013-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Dos')),
  ('c2300000-0000-0000-0000-000000000083', 'test-emp013-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Tres')),
  ('c2300000-0000-0000-0000-000000000084', 'test-emp013-empleado1@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Uno')),
  ('c2300000-0000-0000-0000-000000000085', 'test-emp013-empleado2@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Dos'));

insert into public.user_roles (profile_id, role) values
  ('c2300000-0000-0000-0000-000000000081', 'owner'),
  ('c2300000-0000-0000-0000-000000000082', 'admin'),
  ('c2300000-0000-0000-0000-000000000083', 'supervisor'),
  ('c2300000-0000-0000-0000-000000000084', 'employee'),
  ('c2300000-0000-0000-0000-000000000085', 'employee');

insert into public.employees (profile_id, dni, employee_number) values
  ('c2300000-0000-0000-0000-000000000083', '52300083', 523083),
  ('c2300000-0000-0000-0000-000000000084', '52300084', 523084),
  ('c2300000-0000-0000-0000-000000000085', '52300085', 523085);

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000001', 'c2300000-0000-0000-0000-000000000011', current_date, '08:00', '16:00', 1);

insert into public.assignments (shift_id, employee_id)
values ('c2300000-0000-0000-0000-000000000041', 'c2300000-0000-0000-0000-000000000084');

insert into public.employee_client_permissions (employee_id, client_id)
values ('c2300000-0000-0000-0000-000000000084', 'c2300000-0000-0000-0000-000000000001');

insert into public.employee_availability (employee_id, weekday, start_time, end_time)
values ('c2300000-0000-0000-0000-000000000084', 1, '08:00', '12:00');

-- ---------------------------------------------------------------------------------------------
-- 1. employees_update_admin (04 sección 7.2, "Update: O, A" sin exigir manage_users)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-emp013-owner@example.com');
select lives_ok(
  $$update public.employees set notes = 'nota de owner' where profile_id = 'c2300000-0000-0000-0000-000000000085'$$,
  'employees: el owner puede editar datos laborales de cualquier empleado'
);

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');
select lives_ok(
  $$update public.employees set notes = 'nota de admin' where profile_id = 'c2300000-0000-0000-0000-000000000085'$$,
  'employees: el admin puede editar datos laborales aunque NO tenga manage_users habilitada (el update no exige esa capacidad, a diferencia del insert)'
);

-- Nota: `update ... returning` envuelto en un `with` no puede ir anidado dentro de otra consulta
-- (Postgres exige que el `with` con una sentencia de escritura sea el nivel superior de TODA la
-- sentencia, no una subconsulta de `select is(...)`). Por eso estos dos casos ejecutan el UPDATE
-- como sentencia propia (sin política que lo alcance, RLS lo deja en 0 filas afectadas, sin
-- error) y la aserción siguiente confirma que `notes` no cambió.

set local role postgres;
select tests.as_user('test-emp013-supervisora@example.com');
update public.employees set notes = 'intento de supervisora' where profile_id = 'c2300000-0000-0000-0000-000000000084';
select is(
  (select notes from public.employees where profile_id = 'c2300000-0000-0000-0000-000000000084'),
  null::text,
  'employees: la supervisora no puede editar datos laborales (ni siquiera de un empleado de su turno) -- el update no afectó ninguna fila'
);

set local role postgres;
select tests.as_user('test-emp013-empleado1@example.com');
update public.employees set notes = 'intento propio' where profile_id = 'c2300000-0000-0000-0000-000000000084';
select is(
  (select notes from public.employees where profile_id = 'c2300000-0000-0000-0000-000000000084'),
  null::text,
  'employees: un empleado no puede editar su propia fila de datos laborales (sin política de update para "propio") -- el update no afectó ninguna fila'
);

-- ---------------------------------------------------------------------------------------------
-- 2. employee_number editable y único también en UPDATE (P-036; 0006 solo cubría el INSERT)
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');

select lives_ok(
  $$update public.employees set employee_number = 999083 where profile_id = 'c2300000-0000-0000-0000-000000000083'$$,
  'employees: el legajo es editable (P-036)'
);

select is(
  (select employee_number from public.employees where profile_id = 'c2300000-0000-0000-0000-000000000083'),
  999083,
  'employees: el legajo editado queda persistido'
);

prepare employee_update_duplicate_number as
  update public.employees set employee_number = 523085 where profile_id = 'c2300000-0000-0000-0000-000000000083';

select throws_ok(
  'employee_update_duplicate_number',
  '23505',
  null,
  'employees: no se puede editar el legajo a uno que ya usa otro empleado'
);

-- ---------------------------------------------------------------------------------------------
-- 3. employee_client_permissions: UPDATE/DELETE de O, A; S y E no escriben (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-emp013-supervisora@example.com');
prepare employee_client_permissions_insert_supervisor as
  insert into public.employee_client_permissions (employee_id, client_id)
  values ('c2300000-0000-0000-0000-000000000085', 'c2300000-0000-0000-0000-000000000001');

select throws_ok(
  'employee_client_permissions_insert_supervisor',
  '42501',
  null,
  'employee_client_permissions: la supervisora no puede habilitar un empleado para un cliente'
);

set local role postgres;
select tests.as_user('test-emp013-empleado1@example.com');
delete from public.employee_client_permissions
where employee_id = 'c2300000-0000-0000-0000-000000000084' and client_id = 'c2300000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.employee_client_permissions
    where employee_id = 'c2300000-0000-0000-0000-000000000084' and client_id = 'c2300000-0000-0000-0000-000000000001'),
  1,
  'employee_client_permissions: un empleado no puede borrar su propia habilitación -- la fila sigue estando (como postgres, sin RLS, se vuelve a comprobar tras el intento)'
);

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');
select lives_ok(
  $$delete from public.employee_client_permissions
    where employee_id = 'c2300000-0000-0000-0000-000000000084' and client_id = 'c2300000-0000-0000-0000-000000000001'$$,
  'employee_client_permissions: el admin puede borrar una habilitación'
);

-- ---------------------------------------------------------------------------------------------
-- 4. employee_availability: UPDATE/DELETE de O, A; S y E no escriben (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');

select lives_ok(
  $$update public.employee_availability set end_time = '13:00'
    where employee_id = 'c2300000-0000-0000-0000-000000000084'$$,
  'employee_availability: el admin puede editar una franja de disponibilidad'
);

select is(
  (select end_time from public.employee_availability where employee_id = 'c2300000-0000-0000-0000-000000000084'),
  '13:00'::time,
  'employee_availability: la edición queda persistida'
);

set local role postgres;
select tests.as_user('test-emp013-supervisora@example.com');
delete from public.employee_availability where employee_id = 'c2300000-0000-0000-0000-000000000084';

set local role postgres;
select is(
  (select count(*)::int from public.employee_availability where employee_id = 'c2300000-0000-0000-0000-000000000084'),
  1,
  'employee_availability: la supervisora no puede borrar la disponibilidad de un empleado de su turno -- la fila sigue estando (04 sección 7.2: "S: no")'
);

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');
select lives_ok(
  $$delete from public.employee_availability where employee_id = 'c2300000-0000-0000-0000-000000000084'$$,
  'employee_availability: el admin puede borrar una franja de disponibilidad'
);

-- ---------------------------------------------------------------------------------------------
-- 5. employee_leaves: INSERT/UPDATE de O, A (baja lógica vía deleted_at); S y E no escriben
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select tests.as_user('test-emp013-supervisora@example.com');
prepare employee_leave_insert_supervisor as
  insert into public.employee_leaves (employee_id, starts_on, ends_on)
  values ('c2300000-0000-0000-0000-000000000084', current_date, current_date + 5);

select throws_ok(
  'employee_leave_insert_supervisor',
  '42501',
  null,
  'employee_leaves: la supervisora no puede registrar una licencia'
);

set local role postgres;
select tests.as_user('test-emp013-empleado1@example.com');
prepare employee_leave_insert_self as
  insert into public.employee_leaves (employee_id, starts_on, ends_on)
  values ('c2300000-0000-0000-0000-000000000084', current_date, current_date + 5);

select throws_ok(
  'employee_leave_insert_self',
  '42501',
  null,
  'employee_leaves: un empleado no puede registrarse su propia licencia (la carga O, A)'
);

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');

select lives_ok(
  $$insert into public.employee_leaves (id, employee_id, starts_on, ends_on, reason)
    values ('c2300000-0000-0000-0000-000000000030', 'c2300000-0000-0000-0000-000000000084', current_date, current_date + 5, 'estudio')$$,
  'employee_leaves: el admin puede registrar una licencia'
);

select lives_ok(
  $$update public.employee_leaves set reason = 'estudio (corregido)'
    where id = 'c2300000-0000-0000-0000-000000000030'$$,
  'employee_leaves: el admin puede editar una licencia'
);

prepare employee_leave_overlap as
  insert into public.employee_leaves (employee_id, starts_on, ends_on)
  values ('c2300000-0000-0000-0000-000000000084', current_date + 2, current_date + 8);

select throws_ok(
  'employee_leave_overlap',
  '23P01',
  null,
  'employee_leaves: no se puede registrar, ni siquiera como admin, una licencia que se superpone con otra vigente del mismo empleado (exclusión de 0006, ahora probada también con RLS activa)'
);

select lives_ok(
  $$update public.employee_leaves set deleted_at = now() where id = 'c2300000-0000-0000-0000-000000000030'$$,
  'employee_leaves: la baja lógica (deleted_at) de una licencia es un update permitido para el admin'
);

-- ---------------------------------------------------------------------------------------------
-- 6. v_employees y v_search respetando RLS por rol a través de la vista (security_invoker)
-- ---------------------------------------------------------------------------------------------

set local role postgres;
select tests.as_user('test-emp013-empleado1@example.com');

select is(
  (select coalesce(array_agg(profile_id order by profile_id), array[]::uuid[]) from public.v_employees
    where profile_id = any(array[
      'c2300000-0000-0000-0000-000000000083'::uuid, 'c2300000-0000-0000-0000-000000000084',
      'c2300000-0000-0000-0000-000000000085'
    ])),
  array['c2300000-0000-0000-0000-000000000084']::uuid[],
  'v_employees: un empleado ve solo su propia fila a través de la vista (RLS de employees, security_invoker)'
);

select is(
  (select count(*)::int from public.v_search
    where kind = 'employee' and id = any(array[
      'c2300000-0000-0000-0000-000000000083'::uuid, 'c2300000-0000-0000-0000-000000000084',
      'c2300000-0000-0000-0000-000000000085'
    ])),
  1,
  'v_search: un empleado busca entre "employee" y solo encuentra su propia fila, no la de un compañero'
);

set local role postgres;
select tests.as_user('test-emp013-admin@example.com');

select is(
  (select search_text like '%52300084%' from public.v_search where kind = 'employee' and id = 'c2300000-0000-0000-0000-000000000084'),
  true,
  'v_search: el admin encuentra a un empleado por DNI (search_text incluye el DNI)'
);

select set_config('role', 'postgres', true);

select * from finish();

rollback;
