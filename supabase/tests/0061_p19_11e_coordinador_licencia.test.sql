-- pgTAP de la migración 0061_p19_11e_coordinador_licencia.sql (P19.11e, decisión del 20 oct 2026):
-- un coordinador de licencia no puede recibir supervisiones.
--   1. (Quitado en P24.1, 0063: assign_supervision ya no se puede ejecutar, CJ-01. La licencia del
--      coordinador ahora la cubre start_workday con ON_LEAVE: ver 0063_p24_1_jornada_coordinador.)
--   3. update_shift_time(p_date): mover la fecha a un día de licencia del coordinador de la
--      supervisión vigente da ON_LEAVE nombrándolo; una supervisión cancelada no cuenta.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f6100000-...'. Fechas de prueba en 2199.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0061;
grant usage on schema tests_0061 to authenticated, anon;

create or replace function tests_0061.as_user(p_email text)
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
    raise exception 'tests_0061.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0061.as_user(text) to authenticated, anon;

-- Devuelve el `hint` del error (código estable) o el SQLSTATE si no trae hint; null si anduvo.
create or replace function tests_0061.err_hint(p_sql text)
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

grant execute on function tests_0061.err_hint(text) to authenticated, anon;

create or replace function tests_0061.err_message(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

grant execute on function tests_0061.err_message(text) to authenticated, anon;

select plan(10);

-- Estructura -----------------------------------------------------------------------------------

select has_function('public', 'assign_supervision', array['uuid', 'uuid'], 'assign_supervision(uuid, uuid)');
select ok(
  not has_function_privilege('anon', 'public.assign_supervision(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.assign_supervision(uuid, uuid)', 'execute'),
  'assign_supervision revocada en 0063 (P24.1, CJ-01): ni anon ni authenticated'
);
select ok(
  not has_function_privilege('anon', 'public.update_shift_time(uuid, time, time, boolean, date)', 'execute')
    and has_function_privilege('authenticated', 'public.update_shift_time(uuid, time, time, boolean, date)', 'execute'),
  'grants de update_shift_time: anon no, authenticated sí'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('f6100000-0000-0000-0000-000000000001', 'Cliente de coordinador de licencia', 'active');

insert into public.sites (id, client_id, name, address, status) values
  ('f6100000-0000-0000-0000-000000000011', 'f6100000-0000-0000-0000-000000000001', 'Sede de coordinador de licencia', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f6100000-0000-0000-0000-000000000081', 'test-db061-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Sesentayuno')),
  ('f6100000-0000-0000-0000-000000000091', 'test-db061-ca@example.com', jsonb_build_object('first_name', 'Ana', 'last_name', 'Licenciada')),
  ('f6100000-0000-0000-0000-000000000092', 'test-db061-cb@example.com', jsonb_build_object('first_name', 'Beto', 'last_name', 'Abierto')),
  ('f6100000-0000-0000-0000-000000000093', 'test-db061-cc@example.com', jsonb_build_object('first_name', 'Carla', 'last_name', 'Dadadebaja')),
  ('f6100000-0000-0000-0000-000000000094', 'test-db061-cd@example.com', jsonb_build_object('first_name', 'Dora', 'last_name', 'SinFicha'));

insert into public.user_roles (profile_id, role) values
  ('f6100000-0000-0000-0000-000000000081', 'owner'),
  ('f6100000-0000-0000-0000-000000000091', 'supervisor'),
  ('f6100000-0000-0000-0000-000000000092', 'supervisor'),
  ('f6100000-0000-0000-0000-000000000093', 'supervisor'),
  ('f6100000-0000-0000-0000-000000000094', 'supervisor');

-- Dora (94) es coordinadora sin fila en employees.
insert into public.employees (profile_id, dni, status) values
  ('f6100000-0000-0000-0000-000000000091', '97000091', 'active'),
  ('f6100000-0000-0000-0000-000000000092', '97000092', 'active'),
  ('f6100000-0000-0000-0000-000000000093', '97000093', 'active');

-- Licencias:
--   Ana   2199-03-05 a 2199-03-15
--   Beto  desde 2199-04-01, abierta
--   Carla 2199-03-05 a 2199-03-15, dada de baja
insert into public.employee_leaves (employee_id, starts_on, ends_on, deleted_at) values
  ('f6100000-0000-0000-0000-000000000091', '2199-03-05', '2199-03-15', null),
  ('f6100000-0000-0000-0000-000000000092', '2199-04-01', null, null),
  ('f6100000-0000-0000-0000-000000000093', '2199-03-05', '2199-03-15', now());

-- Turnos:
--   S1 2199-03-10 (dentro de la licencia de Ana y de la baja de Carla)
--   S2 2199-03-20 (después de la licencia de Ana)
--   S3 2199-06-01 (dentro de la licencia abierta de Beto)
--   S4 2199-05-01 con supervisión vigente de Ana (se mueve de fecha)
--   S5 2199-02-01 con supervisión cancelada de Ana (se mueve de fecha)
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f6100000-0000-0000-0000-000000000041', 'f6100000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000011', '2199-03-10', '08:00', '12:00', 1, 'scheduled'),
  ('f6100000-0000-0000-0000-000000000042', 'f6100000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000011', '2199-03-20', '08:00', '12:00', 1, 'scheduled'),
  ('f6100000-0000-0000-0000-000000000043', 'f6100000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000011', '2199-06-01', '08:00', '12:00', 1, 'scheduled'),
  ('f6100000-0000-0000-0000-000000000044', 'f6100000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000011', '2199-05-01', '08:00', '12:00', 1, 'scheduled'),
  ('f6100000-0000-0000-0000-000000000045', 'f6100000-0000-0000-0000-000000000001', 'f6100000-0000-0000-0000-000000000011', '2199-02-01', '08:00', '12:00', 1, 'scheduled');

insert into public.supervisions (id, shift_id, supervisor_id, status, cancel_reason) values
  ('f6100000-0000-0000-0000-000000000051', 'f6100000-0000-0000-0000-000000000044', 'f6100000-0000-0000-0000-000000000091', 'assigned', null),
  ('f6100000-0000-0000-0000-000000000052', 'f6100000-0000-0000-0000-000000000045', 'f6100000-0000-0000-0000-000000000091', 'cancelled', 'Cancelada de prueba');

-- 1. (assign_supervision: quitado en P24.1) -------------------------------------------------------

select tests_0061.as_user('test-db061-owner@example.com');

-- 2. update_shift_time(p_date) -------------------------------------------------------------------

select is(
  tests_0061.err_hint($$select public.update_shift_time('f6100000-0000-0000-0000-000000000044', '08:00', '12:00', false, date '2199-03-10')$$),
  'ON_LEAVE',
  'update_shift_time: mover a un día de licencia del coordinador -> ON_LEAVE'
);
select matches(
  tests_0061.err_message($$select public.update_shift_time('f6100000-0000-0000-0000-000000000044', '08:00', '12:00', false, date '2199-03-10')$$),
  'Ana Licenciada',
  'update_shift_time: el mensaje nombra al coordinador'
);
select is(
  (select shift_date from public.shifts where id = 'f6100000-0000-0000-0000-000000000044'),
  date '2199-05-01',
  'update_shift_time: la fecha del turno no cambió'
);
select lives_ok(
  $$select public.update_shift_time('f6100000-0000-0000-0000-000000000044', '08:00', '12:00', false, date '2199-03-20')$$,
  'update_shift_time: mover a un día sin licencia anda'
);
select lives_ok(
  $$select public.update_shift_time('f6100000-0000-0000-0000-000000000045', '08:00', '12:00', false, date '2199-03-10')$$,
  'update_shift_time: una supervisión cancelada no cuenta'
);
select lives_ok(
  $$select public.update_shift_time('f6100000-0000-0000-0000-000000000042', '09:00', '12:00', false, null)$$,
  'update_shift_time: cambiar solo la hora no mira las licencias'
);
select is(
  (select start_time from public.shifts where id = 'f6100000-0000-0000-0000-000000000042'),
  time '09:00',
  'update_shift_time: la hora cambió'
);

select * from finish();

rollback;
