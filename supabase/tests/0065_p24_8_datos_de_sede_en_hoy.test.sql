-- pgTAP de la migración 0065_p24_8_datos_de_sede_en_hoy.sql (P24.8, decisión de Mike).
--   v_supervisor_today trae los datos de la sede que lee SUP-04: site_contact_name,
--   site_contact_phone, access_instructions, building_hours y restrictions_notes. Nada del cliente.
--   El coordinador los ve en un turno de hoy; dueño, administrador y empleado siguen sin filas.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6500000-...'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0065;
grant usage on schema tests_0065 to authenticated, anon;

create or replace function tests_0065.as_user(p_email text)
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
    raise exception 'tests_0065.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0065.as_user(text) to authenticated, anon;


select plan(15);

-- Fixtures
insert into public.clients (id, legal_name, trade_name, status) values
  ('f6500000-0000-0000-0000-000000000001', 'Cliente de sede uno', 'Fantasía de sede uno', 'active');

insert into public.sites (id, client_id, name, address, latitude, longitude, status,
  contact_name, contact_phone, access_instructions, building_hours, restrictions_notes) values
  ('f6500000-0000-0000-0000-000000000011', 'f6500000-0000-0000-0000-000000000001', 'Sede con datos', 'Dirección 1', -34.6, -58.4, 'active',
   'Marta Encargada', '11-5555-0001', 'Entrar por la cochera', 'Lunes a viernes de 7 a 19', 'No mover los equipos'),
  ('f6500000-0000-0000-0000-000000000012', 'f6500000-0000-0000-0000-000000000001', 'Sede sin datos', 'Dirección 2', -34.7, -58.5, 'active',
   null, null, null, null, null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6500000-0000-0000-0000-000000000081', 'test-db065-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Sede')),
  ('f6500000-0000-0000-0000-000000000082', 'test-db065-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Sede')),
  ('f6500000-0000-0000-0000-000000000091', 'test-db065-sup@example.com', jsonb_build_object('first_name', 'Sara', 'last_name', 'Coordina')),
  ('f6500000-0000-0000-0000-000000000093', 'test-db065-emp@example.com', jsonb_build_object('first_name', 'Eva', 'last_name', 'Empleada'));

insert into public.user_roles (profile_id, role) values
  ('f6500000-0000-0000-0000-000000000081', 'owner'),
  ('f6500000-0000-0000-0000-000000000082', 'admin'),
  ('f6500000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6500000-0000-0000-0000-000000000093', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f6500000-0000-0000-0000-000000000091', '96500091', 'active'),
  ('f6500000-0000-0000-0000-000000000093', '96500093', 'active');

insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6500000-0000-0000-0000-000000000041', 'f6500000-0000-0000-0000-000000000001', 'f6500000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'in_progress'),
  ('f6500000-0000-0000-0000-000000000042', 'f6500000-0000-0000-0000-000000000001', 'f6500000-0000-0000-0000-000000000012', app.today(), '13:00', '17:00', 1, 'in_progress');

insert into public.assignments (shift_id, employee_id, status) values
  ('f6500000-0000-0000-0000-000000000041', 'f6500000-0000-0000-0000-000000000093', 'expected');

-- Estructura
select has_function('app', 'supervisor_today', 'app.supervisor_today()');
select has_view('public', 'v_supervisor_today', 'existe v_supervisor_today');
select col_type_is('public', 'v_supervisor_today', 'site_contact_name', 'text', 'site_contact_name es text');
select col_type_is('public', 'v_supervisor_today', 'site_contact_phone', 'text', 'site_contact_phone es text');
select col_type_is('public', 'v_supervisor_today', 'access_instructions', 'text', 'access_instructions es text');
select col_type_is('public', 'v_supervisor_today', 'building_hours', 'text', 'building_hours es text');
select col_type_is('public', 'v_supervisor_today', 'restrictions_notes', 'text', 'restrictions_notes es text');
select ok(
  not has_function_privilege('anon', 'app.supervisor_today()', 'execute')
  and has_function_privilege('authenticated', 'app.supervisor_today()', 'execute')
  and has_table_privilege('authenticated', 'public.v_supervisor_today', 'select')
  and not has_table_privilege('anon', 'public.v_supervisor_today', 'select'),
  'los grants de app.supervisor_today y v_supervisor_today se conservan'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'v_supervisor_today'
      and column_name in ('client_contact_name', 'client_contact_phone', 'client_email')
  ),
  'la vista no suma datos de contacto del cliente'
);

-- El coordinador ve los datos de la sede en un turno de hoy
select tests_0065.as_user('test-db065-sup@example.com');

select results_eq(
  $$select site_contact_name, site_contact_phone, access_instructions, building_hours, restrictions_notes
    from public.v_supervisor_today where shift_id = 'f6500000-0000-0000-0000-000000000041'$$,
  $$values ('Marta Encargada'::text, '11-5555-0001'::text, 'Entrar por la cochera'::text, 'Lunes a viernes de 7 a 19'::text, 'No mover los equipos'::text)$$,
  'SUP-03: el coordinador ve contacto, acceso, horario y restricciones de la sede'
);
select results_eq(
  $$select site_contact_name, site_contact_phone, access_instructions, building_hours, restrictions_notes
    from public.v_supervisor_today where shift_id = 'f6500000-0000-0000-0000-000000000042'$$,
  $$values (null::text, null::text, null::text, null::text, null::text)$$,
  'SUP-03: una sede sin datos cargados trae nulos'
);

-- Los demás roles siguen sin filas
select tests_0065.as_user('test-db065-owner@example.com');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el dueño no ve filas en v_supervisor_today');
select tests_0065.as_user('test-db065-admin@example.com');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el administrador no ve filas en v_supervisor_today');
select tests_0065.as_user('test-db065-emp@example.com');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el empleado no ve filas en v_supervisor_today');

set local role anon;
select throws_ok($$select * from public.v_supervisor_today$$, '42501', null, 'anon no puede leer v_supervisor_today');

select * from finish();

rollback;
