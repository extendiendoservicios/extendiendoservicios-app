-- pgTAP de 0068_p24_8_marcas_de_sede_en_hoy.sql: v_supervisor_today trae phone_restricted y
-- photos_not_allowed de la sede. Fixtures propios: 'f6800000-...'.

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


select plan(8);

select col_type_is('public', 'v_supervisor_today', 'phone_restricted', 'boolean', 'phone_restricted es boolean');
select col_type_is('public', 'v_supervisor_today', 'photos_not_allowed', 'boolean', 'photos_not_allowed es boolean');
select ok(
  not has_function_privilege('anon', 'app.supervisor_today()', 'execute')
  and has_function_privilege('authenticated', 'app.supervisor_today()', 'execute')
  and has_table_privilege('authenticated', 'public.v_supervisor_today', 'select')
  and not has_table_privilege('anon', 'public.v_supervisor_today', 'select'),
  'los grants de app.supervisor_today y v_supervisor_today se conservan'
);

insert into public.clients (id, legal_name, status) values
  ('f6800000-0000-0000-0000-000000000001', 'Cliente de marcas', 'active');
insert into public.sites (id, client_id, name, address, latitude, longitude, status, phone_restricted, photos_not_allowed) values
  ('f6800000-0000-0000-0000-000000000011', 'f6800000-0000-0000-0000-000000000001', 'Sede con marcas', 'Dirección 1', -34.6, -58.4, 'active', true, true),
  ('f6800000-0000-0000-0000-000000000012', 'f6800000-0000-0000-0000-000000000001', 'Sede sin marcas', 'Dirección 2', -34.7, -58.5, 'active', false, false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6800000-0000-0000-0000-000000000081', 'test-db068-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Marcas')),
  ('f6800000-0000-0000-0000-000000000091', 'test-db068-sup@example.com', jsonb_build_object('first_name', 'Sara', 'last_name', 'Coordina')),
  ('f6800000-0000-0000-0000-000000000093', 'test-db068-emp@example.com', jsonb_build_object('first_name', 'Eva', 'last_name', 'Empleada'));
insert into public.user_roles (profile_id, role) values
  ('f6800000-0000-0000-0000-000000000081', 'owner'),
  ('f6800000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6800000-0000-0000-0000-000000000093', 'employee');
insert into public.employees (profile_id, dni, status) values
  ('f6800000-0000-0000-0000-000000000091', '96800091', 'active'),
  ('f6800000-0000-0000-0000-000000000093', '96800093', 'active');
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6800000-0000-0000-0000-000000000041', 'f6800000-0000-0000-0000-000000000001', 'f6800000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'in_progress'),
  ('f6800000-0000-0000-0000-000000000042', 'f6800000-0000-0000-0000-000000000001', 'f6800000-0000-0000-0000-000000000012', app.today(), '13:00', '17:00', 1, 'in_progress');

select tests.as_user('test-db068-sup@example.com');
select results_eq(
  $$select phone_restricted, photos_not_allowed from public.v_supervisor_today where shift_id = 'f6800000-0000-0000-0000-000000000041'$$,
  $$values (true, true)$$,
  'el coordinador ve las dos marcas de una sede restringida'
);
select results_eq(
  $$select phone_restricted, photos_not_allowed from public.v_supervisor_today where shift_id = 'f6800000-0000-0000-0000-000000000042'$$,
  $$values (false, false)$$,
  'una sede sin marcas trae false y false'
);
select tests.as_user('test-db068-owner@example.com');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el dueño no ve filas');
select tests.as_user('test-db068-emp@example.com');
select is((select count(*)::integer from public.v_supervisor_today), 0, 'el empleado no ve filas');
set local role anon;
select throws_ok($$select * from public.v_supervisor_today$$, '42501', null, 'anon no puede leer la vista');

select * from finish();

rollback;
