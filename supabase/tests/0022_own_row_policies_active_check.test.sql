-- pgTAP de 0022_own_row_policies_active_check.sql: las políticas de "fila propia" que no pasan
-- por ninguna función de rol (profiles, user_roles, admin_capabilities, employees,
-- employee_client_permissions, employee_availability, employee_leaves) también respetan la
-- ventana de revocación (04 sección 7.1, decisión de Mike del 23 sep 2026).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c2200000-...'.
--
-- Misma nota de método que 0020_permission_functions_active_check.test.sql: se forjan los claims
-- a mano (simulando un token ya emitido) y se cambia profiles.is_active DESPUÉS, sin volver a
-- pasar por el hook -- si no, el hook (0016) ya dejaría los claims vacíos y el test no probaría
-- nada de esta migración.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Fixture: una empleada con datos en varias de las tablas que tocó esta migración ---------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c2200000-0000-0000-0000-000000000001', 'test-db022-empleada@example.com', jsonb_build_object('first_name', 'Empleada', 'last_name', 'Propia'));

insert into public.user_roles (profile_id, role) values
  ('c2200000-0000-0000-0000-000000000001', 'employee');

insert into public.employees (profile_id, dni) values
  ('c2200000-0000-0000-0000-000000000001', '53220001');

insert into public.employee_availability (employee_id, weekday, start_time, end_time) values
  ('c2200000-0000-0000-0000-000000000001', 1, '08:00', '16:00');

-- Forja los claims "como si" un token ya se hubiese emitido mientras la persona estaba activa ----

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c2200000-0000-0000-0000-000000000001","role":"authenticated","roles":["employee"],"capabilities":[]}', true);

select is(
  (select count(*)::int from public.profiles where id = 'c2200000-0000-0000-0000-000000000001'),
  1,
  'profiles_select_own: activa, se ve a sí misma'
);

select is(
  (select count(*)::int from public.user_roles where profile_id = 'c2200000-0000-0000-0000-000000000001'),
  1,
  'user_roles_select_own: activa, ve su propio rol'
);

select is(
  (select count(*)::int from public.employees where profile_id = 'c2200000-0000-0000-0000-000000000001'),
  1,
  'employees_select_own: activa, ve su propia fila de empleado'
);

select is(
  (select count(*)::int from public.employee_availability where employee_id = 'c2200000-0000-0000-0000-000000000001'),
  1,
  'employee_availability_select_own: activa, ve su propia disponibilidad'
);

prepare update_own_profile_active as
  update public.profiles set phone = '1122334455' where id = 'c2200000-0000-0000-0000-000000000001';

select lives_ok(
  'update_own_profile_active',
  'profiles_update_own: activa, puede actualizar su propio teléfono'
);

-- Desactiva el perfil, sin tocar los claims (simula el paso del tiempo con el mismo token) -------

select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);
update public.profiles set is_active = false where id = 'c2200000-0000-0000-0000-000000000001';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"c2200000-0000-0000-0000-000000000001","role":"authenticated","roles":["employee"],"capabilities":[]}', true);

select is(
  (select count(*)::int from public.profiles where id = 'c2200000-0000-0000-0000-000000000001'),
  0,
  'profiles_select_own: mismo token, ya inactivo el perfil -> deja de verse a sí misma (app.current_uid() da null)'
);

select is(
  (select count(*)::int from public.employees where profile_id = 'c2200000-0000-0000-0000-000000000001'),
  0,
  'employees_select_own: ídem, deja de ver su propia fila de empleado'
);

-- Update de verdad (no envuelto en `select`, porque un `with` que modifica datos tiene que ir en
-- el nivel superior de la consulta): si RLS deniega, no toca ninguna fila y no tira error -- se
-- confirma abajo, con el rol de nuevo en postgres, que el teléfono siguió en el valor que dejó el
-- update anterior (mientras la persona todavía estaba activa), no en este nuevo valor.
update public.profiles set phone = '9988776655' where id = 'c2200000-0000-0000-0000-000000000001';

select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '{}', true);

select is(
  (select phone from public.profiles where id = 'c2200000-0000-0000-0000-000000000001'),
  '1122334455',
  'profiles_update_own: mismo token, ya inactivo el perfil -> el update de arriba no tocó ninguna fila (RLS deniega, no hay error, el teléfono sigue en el valor de cuando estaba activa)'
);

select * from finish();

rollback;
