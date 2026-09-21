-- pgTAP de la migración 0011_views.sql (DB-013), parte 2: v_my_day, v_supervisions_admin,
-- v_my_supervisions, v_public_branding, v_people_basic, v_clients y v_search. Existencia +
-- security_invoker de las diez vistas y las columnas derivadas de v_employees/v_shifts_board/
-- v_assignments_board están en 0011_views.test.sql.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'c1600000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

-- tests.as_user(email) (TEST-002) -- ver supabase/tests/README.md y
-- 0003_profiles_roles_capabilities_permissions.test.sql para el detalle comentado.
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

select plan(22);

-- Fixtures comunes: cliente, sede, un empleado, otro empleado (compañero), una supervisora -------

insert into public.clients (id, legal_name) values ('c1600000-0000-0000-0000-000000000001', 'Cliente vistas 2');
insert into public.sites (id, client_id, name, address)
values ('c1600000-0000-0000-0000-000000000011', 'c1600000-0000-0000-0000-000000000001', 'Sede vistas 2', 'Dirección');

insert into auth.users (id, email, raw_user_meta_data) values
  ('c1600000-0000-0000-0000-000000000081', 'test-db013-myday-empleado@example.com', jsonb_build_object('first_name', 'Mi', 'last_name', 'Día')),
  ('c1600000-0000-0000-0000-000000000082', 'test-db013-myday-companero@example.com', jsonb_build_object('first_name', 'Compa', 'last_name', 'Ñero')),
  ('c1600000-0000-0000-0000-000000000083', 'test-db013-mysupervisions@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora'));

insert into public.employees (profile_id, dni) values
  ('c1600000-0000-0000-0000-000000000081', '50100081'),
  ('c1600000-0000-0000-0000-000000000082', '50100082'),
  ('c1600000-0000-0000-0000-000000000083', '50100083');

insert into public.user_roles (profile_id, role) values
  ('c1600000-0000-0000-0000-000000000081', 'employee'),
  ('c1600000-0000-0000-0000-000000000082', 'employee'),
  ('c1600000-0000-0000-0000-000000000083', 'supervisor');

-- 1. v_my_day ---------------------------------------------------------------------------------

-- Turno de hoy, con el empleado y un compañero asignados (para probar que v_my_day de uno no
-- trae la fila del otro).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1600000-0000-0000-0000-000000000041', 'c1600000-0000-0000-0000-000000000001', 'c1600000-0000-0000-0000-000000000011', app.today(), '08:00', '16:00', 2);

insert into public.shift_tasks (shift_id, position, title, is_required, status)
values
  ('c1600000-0000-0000-0000-000000000041', 1, 'Barrer', true, 'done'),
  ('c1600000-0000-0000-0000-000000000041', 2, 'Trapear', true, 'pending'),
  ('c1600000-0000-0000-0000-000000000041', 3, 'Vidrios', false, 'pending');

insert into public.assignments (id, shift_id, employee_id)
values
  ('c1600000-0000-0000-0000-000000000051', 'c1600000-0000-0000-0000-000000000041', 'c1600000-0000-0000-0000-000000000081'),
  ('c1600000-0000-0000-0000-000000000052', 'c1600000-0000-0000-0000-000000000041', 'c1600000-0000-0000-0000-000000000082');

-- Turno dentro de 3 días (adentro de la ventana de 7 días) y otro a 10 días (afuera).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values
  ('c1600000-0000-0000-0000-000000000042', 'c1600000-0000-0000-0000-000000000001', 'c1600000-0000-0000-0000-000000000011', app.today() + 3, '09:00', '13:00', 1),
  ('c1600000-0000-0000-0000-000000000043', 'c1600000-0000-0000-0000-000000000001', 'c1600000-0000-0000-0000-000000000011', app.today() + 10, '09:00', '13:00', 1);

insert into public.assignments (id, shift_id, employee_id)
values
  ('c1600000-0000-0000-0000-000000000053', 'c1600000-0000-0000-0000-000000000042', 'c1600000-0000-0000-0000-000000000081'),
  ('c1600000-0000-0000-0000-000000000054', 'c1600000-0000-0000-0000-000000000043', 'c1600000-0000-0000-0000-000000000081');

select tests.as_user('test-db013-myday-empleado@example.com');

select is(
  (select count(*)::int from public.v_my_day where shift_id = 'c1600000-0000-0000-0000-000000000041'),
  1,
  'v_my_day: el turno de hoy compartido con un compañero trae solo MI fila (filtra employee_id = auth.uid())'
);

select is(
  (select is_today from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000051'),
  true,
  'v_my_day: is_today = true para el turno de shift_date = hoy'
);

select is(
  (select is_today from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000053'),
  false,
  'v_my_day: is_today = false para el turno dentro de 3 días'
);

select is(
  (select count(*)::int from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000054'),
  0,
  'v_my_day: el turno a 10 días (fuera de la ventana de 7 días, P-093) no aparece'
);

select is(
  (select tasks_total from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000051'),
  3::bigint,
  'v_my_day: tasks_total cuenta las tareas del turno'
);

select is(
  (select tasks_done from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000051'),
  1::bigint,
  'v_my_day: tasks_done cuenta solo status = done'
);

-- changed_since_last_seen (P-092): last_seen_changes_at ANTERIOR a la creación de la asignación
-- -> true; last_seen_changes_at POSTERIOR -> false.
set local role postgres;

update public.profiles
set last_seen_changes_at = (
  select created_at from public.assignments where id = 'c1600000-0000-0000-0000-000000000051'
) - interval '1 hour'
where id = 'c1600000-0000-0000-0000-000000000081';

select tests.as_user('test-db013-myday-empleado@example.com');

select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000051'),
  'v_my_day: last_seen_changes_at anterior a la creación de la asignación -> changed_since_last_seen = true'
);

set local role postgres;

update public.profiles
set last_seen_changes_at = now()
where id = 'c1600000-0000-0000-0000-000000000081';

select tests.as_user('test-db013-myday-empleado@example.com');

select ok(
  not (select changed_since_last_seen from public.v_my_day where assignment_id = 'c1600000-0000-0000-0000-000000000051'),
  'v_my_day: last_seen_changes_at posterior a los cambios -> changed_since_last_seen = false'
);

set local role postgres;

-- 2. v_supervisions_admin y v_my_supervisions --------------------------------------------------

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff)
values ('c1600000-0000-0000-0000-000000000044', 'c1600000-0000-0000-0000-000000000001', 'c1600000-0000-0000-0000-000000000011', app.today() - 3, '08:00', '16:00', 2);

insert into public.assignments (id, shift_id, employee_id)
values
  ('c1600000-0000-0000-0000-000000000055', 'c1600000-0000-0000-0000-000000000044', 'c1600000-0000-0000-0000-000000000081'),
  ('c1600000-0000-0000-0000-000000000056', 'c1600000-0000-0000-0000-000000000044', 'c1600000-0000-0000-0000-000000000082');

insert into public.supervisions (id, shift_id, supervisor_id, status)
values ('c1600000-0000-0000-0000-000000000061', 'c1600000-0000-0000-0000-000000000044', 'c1600000-0000-0000-0000-000000000083', 'completed');

insert into public.ratings (supervision_id, assignment_id, score)
values
  ('c1600000-0000-0000-0000-000000000061', 'c1600000-0000-0000-0000-000000000055', 4),
  ('c1600000-0000-0000-0000-000000000061', 'c1600000-0000-0000-0000-000000000056', 2);

select is(
  (select ratings_count from public.v_supervisions_admin where id = 'c1600000-0000-0000-0000-000000000061'),
  2::bigint,
  'v_supervisions_admin: ratings_count cuenta las calificaciones de la supervisión'
);

select is(
  (select ratings_avg from public.v_supervisions_admin where id = 'c1600000-0000-0000-0000-000000000061'),
  3.00::numeric(3, 2),
  'v_supervisions_admin: ratings_avg = promedio simple del turno (4 y 2 -> 3.00)'
);

select tests.as_user('test-db013-mysupervisions@example.com');

select is(
  (select count(*)::int from public.v_my_supervisions where id = 'c1600000-0000-0000-0000-000000000061'),
  1,
  'v_my_supervisions: filtra supervisor_id = auth.uid(), la propia supervisión aparece'
);

select is(
  (select jsonb_array_length(assigned_employees) from public.v_my_supervisions where id = 'c1600000-0000-0000-0000-000000000061'),
  2,
  'v_my_supervisions: assigned_employees trae los 2 empleados asignados vigentes del turno'
);

set local role postgres;

-- 3. v_public_branding: solo tres columnas, sin location_consent_text -----------------------------

-- Limpieza defensiva (DB-019, P04.6): `supabase/seed.sql` puede haber dejado su propia fila de
-- company_settings en App_dev; este archivo corre en su propia transacción con `rollback`, así
-- que borrarla acá adentro no la borra de verdad, solo evita chocar con la primary key (id = 1).
delete from public.company_settings;

insert into public.company_settings (id, name, logo_path, support_phone, location_consent_text)
values (1, 'Extendiendo Servicios', 'branding/logo.png', '+54 11 5555-5555', 'Texto de consentimiento de prueba');

select columns_are(
  'public', 'v_public_branding',
  array['name', 'logo_path', 'support_phone'],
  'v_public_branding: expone exactamente name, logo_path, support_phone (04 sección 7.2), sin location_consent_text'
);

select is(
  (select name from public.v_public_branding),
  'Extendiendo Servicios',
  'v_public_branding: refleja company_settings.name'
);

-- 4. v_people_basic: solo nombre y foto -----------------------------------------------------------

select columns_are(
  'public', 'v_people_basic',
  array['profile_id', 'first_name', 'last_name', 'avatar_path'],
  'v_people_basic: expone exactamente profile_id, first_name, last_name, avatar_path (04 sección 7.2, P-103)'
);

select is(
  (select first_name from public.v_people_basic where profile_id = 'c1600000-0000-0000-0000-000000000081'),
  'Mi',
  'v_people_basic: refleja profiles.first_name'
);

-- 5. v_clients: conteo de sedes y servicios activos -----------------------------------------------

insert into public.clients (id, legal_name) values ('c1600000-0000-0000-0000-000000000002', 'Cliente conteo');
insert into public.sites (id, client_id, name, address, deleted_at) values
  ('c1600000-0000-0000-0000-000000000021', 'c1600000-0000-0000-0000-000000000002', 'Sede vigente', 'Dirección', null),
  ('c1600000-0000-0000-0000-000000000022', 'c1600000-0000-0000-0000-000000000002', 'Sede dada de baja', 'Dirección', now());

insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, status) values
  ('c1600000-0000-0000-0000-000000000031', 'c1600000-0000-0000-0000-000000000002', 'c1600000-0000-0000-0000-000000000021', 'Servicio activo', array[1]::smallint[], '08:00', '12:00', app.today(), 'active'),
  ('c1600000-0000-0000-0000-000000000032', 'c1600000-0000-0000-0000-000000000002', 'c1600000-0000-0000-0000-000000000021', 'Servicio pausado', array[1]::smallint[], '08:00', '12:00', app.today(), 'paused');

select is(
  (select sites_count from public.v_clients where id = 'c1600000-0000-0000-0000-000000000002'),
  1::bigint,
  'v_clients: sites_count cuenta solo las sedes vigentes (deleted_at is null)'
);

select is(
  (select active_services_count from public.v_clients where id = 'c1600000-0000-0000-0000-000000000002'),
  1::bigint,
  'v_clients: active_services_count cuenta solo services.status = active'
);

-- 6. v_search: empleados, clientes y sedes por texto (PROPUESTO) -----------------------------------

select is(
  (select title from public.v_search where kind = 'employee' and id = 'c1600000-0000-0000-0000-000000000081'),
  'Mi Día',
  'v_search: fila de empleado con title = nombre completo'
);

select ok(
  (select search_text from public.v_search where kind = 'client' and id = 'c1600000-0000-0000-0000-000000000002') like '%cliente conteo%',
  'v_search: search_text de cliente en minúsculas incluye el nombre legal'
);

select is(
  (select title from public.v_search where kind = 'site' and id = 'c1600000-0000-0000-0000-000000000021'),
  'Sede vigente',
  'v_search: fila de sede con title = sites.name'
);

select is(
  (select count(*)::int from public.v_search where kind = 'site' and id = 'c1600000-0000-0000-0000-000000000022'),
  0,
  'v_search: no incluye sedes dadas de baja lógica (deleted_at is null)'
);

select * from finish();

rollback;
