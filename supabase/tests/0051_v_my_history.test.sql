-- pgTAP de la migración 0051_p19_8_historial_empleado.sql (P19.8b, AJ4-06): vista
-- public.v_my_history, el historial propio del empleado («Mis servicios anteriores»).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e5100000-...'.
--
-- Las fixtures son solo fechas relativas a app.today() con franjas fijas (08:00 a 16:00), sin
-- "ahora ± horas": así el resultado no depende de la hora a la que corra el CI.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0051;
grant usage on schema tests_0051 to authenticated, anon;

create or replace function tests_0051.as_user(p_email text)
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
    raise exception 'tests_0051.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0051.as_user(text) to authenticated, anon;

select plan(11);

-- Estructura --------------------------------------------------------------------------------------

select has_view('public', 'v_my_history', 'existe la vista v_my_history');

select is(
  (select reloptions::text from pg_class where oid = 'public.v_my_history'::regclass),
  '{security_invoker=true}',
  'v_my_history es security_invoker'
);

select is(
  (select array_agg(column_name::text || ':' || data_type || ':' || ordinal_position::text order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'v_my_history'),
  (select array_agg(column_name::text || ':' || data_type || ':' || ordinal_position::text order by ordinal_position)
     from information_schema.columns where table_schema = 'public' and table_name = 'v_my_day'),
  'v_my_history tiene las mismas columnas, tipos y orden que v_my_day'
);

select ok(
  has_table_privilege('authenticated', 'public.v_my_history', 'select')
  and not has_table_privilege('anon', 'public.v_my_history', 'select'),
  'authenticated puede leer v_my_history y anon no'
);

-- Fixtures ----------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('e5100000-0000-0000-0000-000000000001', 'Cliente de v_my_history', 'active', 0);

insert into public.sites (id, client_id, name, address, status) values
  ('e5100000-0000-0000-0000-000000000011', 'e5100000-0000-0000-0000-000000000001', 'Sede de v_my_history', 'Dirección 1', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e5100000-0000-0000-0000-000000000081', 'test-db051-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Historial')),
  ('e5100000-0000-0000-0000-000000000091', 'test-db051-emp-a@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'A')),
  ('e5100000-0000-0000-0000-000000000092', 'test-db051-emp-b@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'B'));

insert into public.user_roles (profile_id, role) values
  ('e5100000-0000-0000-0000-000000000081', 'admin'),
  ('e5100000-0000-0000-0000-000000000091', 'employee'),
  ('e5100000-0000-0000-0000-000000000092', 'employee');

insert into public.employees (profile_id, dni) values
  ('e5100000-0000-0000-0000-000000000091', '95100091'),
  ('e5100000-0000-0000-0000-000000000092', '95100092');

-- Turnos: hace 400 días (sin límite de antigüedad), ayer, anteayer (asignación quitada), hoy,
-- mañana y dentro de 30 días. El 207 es de ayer y pertenece solo al empleado B.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('e5100000-0000-0000-0000-000000000201', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() - 400, '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000202', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() - 1,   '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000203', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() - 2,   '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000204', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today(),       '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000205', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() + 1,   '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000206', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() + 30,  '08:00', '16:00', 1, 'scheduled'),
  ('e5100000-0000-0000-0000-000000000207', 'e5100000-0000-0000-0000-000000000001', 'e5100000-0000-0000-0000-000000000011', app.today() - 1,   '08:00', '16:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('e5100000-0000-0000-0000-000000000301', 'e5100000-0000-0000-0000-000000000201', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000302', 'e5100000-0000-0000-0000-000000000202', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000303', 'e5100000-0000-0000-0000-000000000203', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000304', 'e5100000-0000-0000-0000-000000000204', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000305', 'e5100000-0000-0000-0000-000000000205', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000306', 'e5100000-0000-0000-0000-000000000206', 'e5100000-0000-0000-0000-000000000091'),
  ('e5100000-0000-0000-0000-000000000307', 'e5100000-0000-0000-0000-000000000207', 'e5100000-0000-0000-0000-000000000092');

-- Asignación quitada (baja lógica) del empleado A sobre el turno de anteayer.
update public.assignments
   set removed_at = now(),
       removed_by = 'e5100000-0000-0000-0000-000000000081',
       removed_reason = 'Prueba de historial'
 where id = 'e5100000-0000-0000-0000-000000000303';

-- Empleado A -------------------------------------------------------------------------------------

select tests_0051.as_user('test-db051-emp-a@example.com');

select results_eq(
  $$select assignment_id from public.v_my_history order by shift_date desc, effective_start_time desc$$,
  $$values ('e5100000-0000-0000-0000-000000000302'::uuid), ('e5100000-0000-0000-0000-000000000301'::uuid)$$,
  'el empleado A ve solo sus días anteriores (ayer y hace 400 días), del más reciente al más antiguo'
);

select is(
  (select count(*)::int from public.v_my_history where shift_date >= app.today()),
  0,
  'el historial no incluye hoy ni días futuros'
);

select is(
  (select count(*)::int from public.v_my_history where assignment_id = 'e5100000-0000-0000-0000-000000000303'),
  0,
  'la asignación quitada (removed_at) no aparece en el historial'
);

select is(
  (select count(*)::int from public.v_my_history where assignment_id = 'e5100000-0000-0000-0000-000000000307'),
  0,
  'el empleado A no ve la asignación del empleado B'
);

select is(
  (select count(*)::int from public.v_my_day where assignment_id in ('e5100000-0000-0000-0000-000000000302', 'e5100000-0000-0000-0000-000000000301')),
  0,
  'v_my_day sigue sin mostrar los días anteriores (no se tocó)'
);

-- Empleado B -------------------------------------------------------------------------------------

select tests_0051.as_user('test-db051-emp-b@example.com');

select results_eq(
  $$select assignment_id from public.v_my_history$$,
  $$values ('e5100000-0000-0000-0000-000000000307'::uuid)$$,
  'el empleado B ve solo su fila de ayer'
);

-- Anon -------------------------------------------------------------------------------------------

set local role anon;
select throws_ok(
  $$select count(*) from public.v_my_history$$,
  '42501',
  null,
  'anon no puede leer v_my_history'
);

select * from finish();

rollback;
