-- pgTAP de la migración 0081_p27_1b_contacto_de_sede_y_generar_por_servicio.sql (P27.1b).
--   OD-24: el contacto de la sede (sites.contact_name, contact_phone) es solo de dueños y administradores.
--     Empleado y coordinador no lo obtienen por select directo, por select *, ni por las vistas
--     v_my_day, v_my_history, v_my_supervisions, v_supervisor_today ni por v_site_contacts.
--   OD-27: generate_shifts(p_year, p_month, p_service_id default null).
--   delete_service: solo el dueño (FORBIDDEN para administradores).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f8100000-...'. Mes de prueba: 2199-05.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0081;
grant usage on schema tests_0081 to authenticated, anon;

create or replace function tests_0081.as_user(p_email text)
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
    raise exception 'tests_0081.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0081.as_user(text) to authenticated, anon;

create or replace function tests_0081.hint_of(p_sql text)
returns text
language plpgsql
as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'sin error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(v_hint, sqlstate);
end;
$$;

grant execute on function tests_0081.hint_of(text) to authenticated, anon;

select plan(39);

-- Fixtures ---------------------------------------------------------------------------------------
insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f8100000-0000-0000-0000-000000000001', 'Cliente 0081', 'Fantasía 0081', 'active', 0);

insert into public.sites (id, client_id, name, address, latitude, longitude, status,
  contact_name, contact_phone, access_instructions) values
  ('f8100000-0000-0000-0000-000000000011', 'f8100000-0000-0000-0000-000000000001', 'Sede 0081', 'Dirección 81', -34.6, -58.4, 'active',
   'Marta Encargada 0081', '11-8100-0001', 'Entrar por la cochera');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f8100000-0000-0000-0000-000000000081', 'test-db0081-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Cero81')),
  ('f8100000-0000-0000-0000-000000000082', 'test-db0081-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Cero81')),
  ('f8100000-0000-0000-0000-000000000091', 'test-db0081-sup@example.com', jsonb_build_object('first_name', 'Sara', 'last_name', 'Coordina81')),
  ('f8100000-0000-0000-0000-000000000093', 'test-db0081-emp@example.com', jsonb_build_object('first_name', 'Eva', 'last_name', 'Empleada81'));

insert into public.user_roles (profile_id, role) values
  ('f8100000-0000-0000-0000-000000000081', 'owner'),
  ('f8100000-0000-0000-0000-000000000082', 'admin'),
  ('f8100000-0000-0000-0000-000000000091', 'supervisor'),
  ('f8100000-0000-0000-0000-000000000093', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f8100000-0000-0000-0000-000000000082', 'generate_shifts', true);

insert into public.employees (profile_id, dni, status) values
  ('f8100000-0000-0000-0000-000000000091', '98100091', 'active'),
  ('f8100000-0000-0000-0000-000000000093', '98100093', 'active');

-- Un turno de hoy con el empleado asignado y el coordinador supervisándolo: así la sede entra en
-- sus políticas (sites_select_shift_party) y en sus vistas.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f8100000-0000-0000-0000-000000000041', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', app.today(), '08:00', '12:00', 1, 'scheduled');
insert into public.assignments (shift_id, employee_id, status) values
  ('f8100000-0000-0000-0000-000000000041', 'f8100000-0000-0000-0000-000000000093', 'expected');
insert into public.supervisions (shift_id, supervisor_id, status) values
  ('f8100000-0000-0000-0000-000000000041', 'f8100000-0000-0000-0000-000000000091', 'assigned');

-- Servicios para generate_shifts: mismo día de la semana que el 1º de mayo de 2199.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from) values
  ('f8100000-0000-0000-0000-000000000101', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Servicio A 0081',
   array[extract(dow from date '2199-05-01')::smallint], '08:00', '12:00', '2199-01-01'),
  ('f8100000-0000-0000-0000-000000000102', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Servicio B 0081',
   array[extract(dow from date '2199-05-01')::smallint], '13:00', '17:00', '2199-01-01'),
  ('f8100000-0000-0000-0000-000000000103', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Servicio C desde el 16 0081',
   array[extract(dow from date '2199-05-01')::smallint], '18:00', '20:00', '2199-05-16'),
  ('f8100000-0000-0000-0000-000000000104', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Servicio D pausado 0081',
   array[extract(dow from date '2199-05-01')::smallint], '20:00', '22:00', '2199-01-01');
update public.services set status = 'paused' where id = 'f8100000-0000-0000-0000-000000000104';

-- Estructura -------------------------------------------------------------------------------------
select has_function('public', 'generate_shifts', array['int', 'int', 'uuid'], 'existe generate_shifts(int, int, uuid)');
select hasnt_function('public', 'generate_shifts', array['int', 'int'], 'ya no existe generate_shifts(int, int)');
select ok(
  has_function_privilege('authenticated', 'public.generate_shifts(int, int, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.generate_shifts(int, int, uuid)', 'execute'),
  'generate_shifts conserva sus grants (authenticated sí, anon no)'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('v_my_day', 'v_my_history', 'v_my_supervisions', 'v_supervisor_today')
      and column_name in ('site_contact_name', 'site_contact_phone')
  ),
  'OD-24: ninguna de las cuatro vistas del celular trae site_contact_name ni site_contact_phone'
);
select ok(
  not exists (
    select 1 from pg_proc p
    where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
      and p.proname = 'supervisor_today'
      and pg_get_function_result(p.oid) ~ 'contact'
  ),
  'OD-24: app.supervisor_today() no devuelve contacto'
);
select ok(
  (select bool_and(c.reloptions::text like '%security_invoker=true%')
     from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname in ('v_my_day', 'v_my_history', 'v_my_supervisions', 'v_supervisor_today')),
  'las cuatro vistas siguen con security_invoker = true'
);
select ok(
  has_table_privilege('authenticated', 'public.v_my_day', 'select')
  and has_table_privilege('authenticated', 'public.v_my_history', 'select')
  and has_table_privilege('authenticated', 'public.v_my_supervisions', 'select')
  and has_table_privilege('authenticated', 'public.v_supervisor_today', 'select')
  and not has_table_privilege('anon', 'public.v_my_day', 'select')
  and not has_table_privilege('anon', 'public.v_supervisor_today', 'select')
  and not has_table_privilege('anon', 'public.v_site_contacts', 'select'),
  'grants de las vistas: authenticated sí, anon no'
);
select ok(
  not has_column_privilege('authenticated', 'public.sites', 'contact_name', 'select')
  and not has_column_privilege('authenticated', 'public.sites', 'contact_phone', 'select')
  and has_column_privilege('authenticated', 'public.sites', 'name', 'select')
  and has_column_privilege('authenticated', 'public.sites', 'latitude', 'select')
  and has_column_privilege('authenticated', 'public.sites', 'access_instructions', 'select'),
  'sites: authenticated no tiene select de contact_name ni contact_phone, sí del resto'
);

-- OD-24: empleado ---------------------------------------------------------------------------------
select tests_0081.as_user('test-db0081-emp@example.com');

prepare emp_contact_name as select contact_name from public.sites where id = 'f8100000-0000-0000-0000-000000000011';
prepare emp_contact_phone as select contact_phone from public.sites where id = 'f8100000-0000-0000-0000-000000000011';
prepare emp_star as select * from public.sites;
prepare emp_whole_row as select to_jsonb(s) from public.sites s;

select throws_ok('emp_contact_name', '42501', null, 'empleado: select directo de contact_name denegado');
select throws_ok('emp_contact_phone', '42501', null, 'empleado: select directo de contact_phone denegado');
select throws_ok('emp_star', '42501', null, 'empleado: select * de sites denegado');
select throws_ok('emp_whole_row', '42501', null, 'empleado: to_jsonb de la fila de sites denegado');
select is(
  (select count(*)::int from public.sites where id = 'f8100000-0000-0000-0000-000000000011' and name = 'Sede 0081' and access_instructions = 'Entrar por la cochera'),
  1, 'empleado: sigue leyendo nombre, dirección e instrucciones de su sede'
);
select is((select count(*)::int from public.v_site_contacts), 0, 'empleado: v_site_contacts vacía');
select is(
  (select count(*)::int from public.v_my_day where shift_id = 'f8100000-0000-0000-0000-000000000041' and access_instructions = 'Entrar por la cochera'),
  1, 'empleado: v_my_day sigue trayendo la sede y las instrucciones'
);

-- OD-24: coordinador (rol supervisor) -------------------------------------------------------------
select tests_0081.as_user('test-db0081-sup@example.com');

prepare sup_contact_name as select contact_name from public.sites where id = 'f8100000-0000-0000-0000-000000000011';
prepare sup_star as select * from public.sites;

select throws_ok('sup_contact_name', '42501', null, 'coordinador: select directo de contact_name denegado');
select throws_ok('sup_star', '42501', null, 'coordinador: select * de sites denegado');
select is(
  (select count(*)::int from public.sites where id = 'f8100000-0000-0000-0000-000000000011' and name = 'Sede 0081'),
  1, 'coordinador: sigue leyendo nombre y dirección de la sede'
);
select is((select count(*)::int from public.v_site_contacts), 0, 'coordinador: v_site_contacts vacía');
select is(
  (select count(*)::int from public.v_supervisor_today where shift_id = 'f8100000-0000-0000-0000-000000000041' and access_instructions = 'Entrar por la cochera'),
  1, 'coordinador: v_supervisor_today sigue trayendo la sede y las instrucciones'
);
select is(
  (select count(*)::int from public.v_my_supervisions where shift_id = 'f8100000-0000-0000-0000-000000000041'),
  1, 'coordinador: v_my_supervisions sigue funcionando'
);

-- OD-24: dueño y administrador --------------------------------------------------------------------
select tests_0081.as_user('test-db0081-admin@example.com');
select is(
  (select contact_name || '|' || contact_phone from public.v_site_contacts where site_id = 'f8100000-0000-0000-0000-000000000011'),
  'Marta Encargada 0081|11-8100-0001', 'administrador: lee el contacto por v_site_contacts'
);
select lives_ok(
  $$update public.sites set contact_name = 'Contacto nuevo 0081' where id = 'f8100000-0000-0000-0000-000000000011'$$,
  'administrador: puede escribir el contacto'
);
select tests_0081.as_user('test-db0081-owner@example.com');
select is(
  (select contact_name from public.v_site_contacts where site_id = 'f8100000-0000-0000-0000-000000000011'),
  'Contacto nuevo 0081', 'dueño: lee el contacto por v_site_contacts (con lo que escribió el administrador)'
);

-- OD-27: generate_shifts con servicio -------------------------------------------------------------
select tests_0081.as_user('test-db0081-admin@example.com');

select is(
  (public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000101') ->> 'created')::int,
  (select count(*)::int from generate_series('2199-05-01'::date, '2199-05-31'::date, interval '1 day') d
    where extract(dow from d) = extract(dow from date '2199-05-01')),
  'generate_shifts con servicio A: crea todos los turnos del mes de ese servicio'
);
select is(
  (select count(*)::int from public.shifts
    where service_id in ('f8100000-0000-0000-0000-000000000102', 'f8100000-0000-0000-0000-000000000103', 'f8100000-0000-0000-0000-000000000104')),
  0, 'generate_shifts con servicio A: no creó turnos de los demás servicios'
);
select is(
  (public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000101') ->> 'created')::int,
  0, 'generate_shifts con servicio: segunda corrida idempotente'
);
select is(
  (public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000103') ->> 'created')::int,
  (select count(*)::int from generate_series('2199-05-16'::date, '2199-05-31'::date, interval '1 day') d
    where extract(dow from d) = extract(dow from date '2199-05-01')),
  'generate_shifts con servicio C: genera desde su fecha de inicio (valid_from)'
);
select is(
  (public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000104') ->> 'created')::int,
  0, 'generate_shifts con un servicio pausado: genera 0, no es error'
);
select is(
  tests_0081.hint_of($$select public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-0000000000ff')$$),
  'SERVICE_NOT_FOUND', 'generate_shifts con un servicio inexistente: SERVICE_NOT_FOUND'
);

-- Sin servicio: igual que antes (genera el servicio B, que todavía no tenía turnos, y saltea los ya hechos).
select ok(
  (public.generate_shifts(2199, 5) ->> 'skipped')::int >= (
    select count(*)::int from generate_series('2199-05-01'::date, '2199-05-31'::date, interval '1 day') d
    where extract(dow from d) = extract(dow from date '2199-05-01')
  ),
  'generate_shifts sin servicio (firma de 2 argumentos): sigue funcionando y saltea los turnos que ya existían'
);
select is(
  (select count(*)::int from public.shifts
    where service_id = 'f8100000-0000-0000-0000-000000000102' and shift_date between '2199-05-01' and '2199-05-31'),
  (select count(*)::int from generate_series('2199-05-01'::date, '2199-05-31'::date, interval '1 day') d
    where extract(dow from d) = extract(dow from date '2199-05-01')),
  'generate_shifts sin servicio: generó también el servicio B'
);

-- Permisos de generate_shifts con servicio
select tests_0081.as_user('test-db0081-emp@example.com');
select is(
  tests_0081.hint_of($$select public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000101')$$),
  'FORBIDDEN', 'generate_shifts con servicio: un empleado no puede'
);
select tests_0081.as_user('test-db0081-sup@example.com');
select is(
  tests_0081.hint_of($$select public.generate_shifts(2199, 5, 'f8100000-0000-0000-0000-000000000101')$$),
  'FORBIDDEN', 'generate_shifts con servicio: un coordinador no puede'
);

-- delete_service: solo el dueño ----------------------------------------------------------------
set local role postgres;
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from) values
  ('f8100000-0000-0000-0000-000000000111', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Para borrar 0081 uno',
   array[1]::smallint[], '08:00', '12:00', '2199-01-01'),
  ('f8100000-0000-0000-0000-000000000112', 'f8100000-0000-0000-0000-000000000001', 'f8100000-0000-0000-0000-000000000011', 'Para borrar 0081 dos',
   array[1]::smallint[], '08:00', '12:00', '2199-01-01');

select tests_0081.as_user('test-db0081-admin@example.com');
select is(
  tests_0081.hint_of($$select public.delete_service('f8100000-0000-0000-0000-000000000111')$$),
  'FORBIDDEN', 'delete_service: un administrador con capacidades no puede (FORBIDDEN)'
);
select is(
  (select count(*)::int from public.services where id = 'f8100000-0000-0000-0000-000000000111'),
  1, 'delete_service: el servicio sigue existiendo después del intento del administrador'
);
select tests_0081.as_user('test-db0081-owner@example.com');
select is(
  (select public.delete_service('f8100000-0000-0000-0000-000000000111') ->> 'service_id'),
  'f8100000-0000-0000-0000-000000000111', 'delete_service: el dueño puede'
);
select is(
  tests_0081.hint_of($$select public.delete_service('f8100000-0000-0000-0000-0000000000ff')$$),
  'SERVICE_NOT_FOUND', 'delete_service: el dueño con un servicio inexistente recibe SERVICE_NOT_FOUND'
);
select ok(
  not has_function_privilege('anon', 'public.delete_service(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_service(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.delete_service_core(uuid)', 'execute'),
  'delete_service: authenticated sí, anon no; el cuerpo interno no es ejecutable'
);

select * from finish();

rollback;
