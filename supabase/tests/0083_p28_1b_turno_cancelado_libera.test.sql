-- pgTAP de la migración 0083_p28_1b_turno_cancelado_libera.sql (P28.1b, OF-04b opción b):
--   assignments.released_at / released_by, assignments_no_overlap y app.overlap_conflict sin las liberadas,
--   cancel_shift libera y el empleado sigue viendo el turno cancelado, corrección de datos.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f83a0000-...'. Las fechas son relativas a hoy (v_my_day mira hoy y 7 días).

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0083;
grant usage on schema tests_0083 to authenticated, anon;

create or replace function tests_0083.as_user(p_email text)
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
    raise exception 'tests_0083.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0083.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, state} del error, o null si no falló.
create or replace function tests_0083.err(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
  v_msg text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  return jsonb_build_object('hint', v_hint, 'message', v_msg, 'state', sqlstate);
end;
$$;

grant execute on function tests_0083.err(text) to authenticated, anon;

select plan(20);

-- Estructura -----------------------------------------------------------------------------------

select has_column('public', 'assignments', 'released_at', 'assignments.released_at');
select has_column('public', 'assignments', 'released_by', 'assignments.released_by');
select ok(
  (select pg_get_constraintdef(oid) like '%released_at IS NULL%' from pg_constraint where conname = 'assignments_no_overlap'),
  'assignments_no_overlap excluye las liberadas'
);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status, calendar_color) values
  ('f83a0000-0000-0000-0000-000000000001', 'Cliente 0083', 'active', 0);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f83a0000-0000-0000-0000-000000000011', 'f83a0000-0000-0000-0000-000000000001', 'Sede 0083', 'Dirección 83', -34.6, -58.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f83a0000-0000-0000-0000-000000000081', 'test-db0083-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Cero83')),
  ('f83a0000-0000-0000-0000-0000000000a1', 'test-db0083-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta83')),
  ('f83a0000-0000-0000-0000-0000000000a2', 'test-db0083-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Benitez83'));

insert into public.user_roles (profile_id, role) values
  ('f83a0000-0000-0000-0000-000000000081', 'owner'),
  ('f83a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f83a0000-0000-0000-0000-0000000000a2', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f83a0000-0000-0000-0000-0000000000a1', '98301101', 'active'),
  ('f83a0000-0000-0000-0000-0000000000a2', '98301102', 'active');

-- Dos turnos de mañana a la misma hora (41 se cancela, 42 recibe al liberado) y uno de pasado mañana.
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status) values
  ('f83a0000-0000-0000-0000-000000000041', 'f83a0000-0000-0000-0000-000000000001', 'f83a0000-0000-0000-0000-000000000011', app.today() + 1, '09:00', '11:00', 2, 'assigned'),
  ('f83a0000-0000-0000-0000-000000000042', 'f83a0000-0000-0000-0000-000000000001', 'f83a0000-0000-0000-0000-000000000011', app.today() + 1, '09:00', '11:00', 3, 'scheduled'),
  ('f83a0000-0000-0000-0000-000000000043', 'f83a0000-0000-0000-0000-000000000001', 'f83a0000-0000-0000-0000-000000000011', app.today() + 2, '09:00', '11:00', 1, 'scheduled');

insert into public.assignments (id, shift_id, employee_id) values
  ('f83a0000-0000-0000-0000-000000000111', 'f83a0000-0000-0000-0000-000000000041', 'f83a0000-0000-0000-0000-0000000000a1'),
  ('f83a0000-0000-0000-0000-000000000112', 'f83a0000-0000-0000-0000-000000000041', 'f83a0000-0000-0000-0000-0000000000a2');

insert into public.attendance_records (assignment_id, kind, recorded_at, source) values
  ('f83a0000-0000-0000-0000-000000000112', 'check_in', now(), 'employee_app');

-- cancel_shift libera ---------------------------------------------------------------------------

select tests_0083.as_user('test-db0083-owner@example.com');
select lives_ok(
  $$select public.cancel_shift('f83a0000-0000-0000-0000-000000000041', 'El cliente suspendió')$$,
  'se cancela el turno'
);

set local role postgres;
select is(
  (select released_at is not null and removed_at is null and removed_reason is null
   from public.assignments where id = 'f83a0000-0000-0000-0000-000000000111'),
  true, 'la asignación sin fichajes queda liberada y NO quitada'
);
select is(
  (select released_by from public.assignments where id = 'f83a0000-0000-0000-0000-000000000111'),
  'f83a0000-0000-0000-0000-000000000081'::uuid, 'registra quién canceló'
);
select is(
  (select released_at is null and removed_at is null from public.assignments where id = 'f83a0000-0000-0000-0000-000000000112'),
  true, 'la asignación con fichaje no se libera (historia de asistencia)'
);

-- El empleado sigue viendo el turno cancelado (DEF-01, P-049) --------------------------------------

select tests_0083.as_user('test-db0083-a1@example.com');
select is(
  (select shift_status::text from public.v_my_day where assignment_id = 'f83a0000-0000-0000-0000-000000000111'),
  'cancelled', 'el empleado liberado ve el turno como cancelado en v_my_day'
);
select ok(
  'f83a0000-0000-0000-0000-000000000041'::uuid in (select app.my_shift_ids()),
  'app.my_shift_ids incluye el turno cancelado'
);
select is(
  (select count(*)::int from public.assignments where id = 'f83a0000-0000-0000-0000-000000000111'),
  1, 'assignments_select_employee deja ver la asignación liberada'
);

-- Ya no ocupa el horario -----------------------------------------------------------------------------

set local role postgres;
select is(
  app.overlap_conflict('f83a0000-0000-0000-0000-0000000000a1', app.local_ts(app.today() + 1, '09:30'), app.local_ts(app.today() + 1, '10:30')),
  null, 'overlap_conflict ignora la asignación liberada'
);
select is(
  app.overlap_conflict('f83a0000-0000-0000-0000-0000000000a2', app.local_ts(app.today() + 1, '09:30'), app.local_ts(app.today() + 1, '10:30')) ->> 'code',
  'ASSIGNMENT_OVERLAP', 'la que tiene fichaje sigue ocupando el horario'
);

select tests_0083.as_user('test-db0083-owner@example.com');
select lives_ok(
  $$select public.assign_employee('f83a0000-0000-0000-0000-000000000042', 'f83a0000-0000-0000-0000-0000000000a1')$$,
  'el empleado liberado se puede asignar a otro turno en el mismo horario'
);
select is(
  tests_0083.err($$select public.assign_employee('f83a0000-0000-0000-0000-000000000042', 'f83a0000-0000-0000-0000-0000000000a2')$$) ->> 'hint',
  'ASSIGNMENT_OVERLAP', 'quien conserva el fichaje sigue chocando'
);

set local role postgres;
select is(
  tests_0083.err($$insert into public.assignments (shift_id, employee_id) values ('f83a0000-0000-0000-0000-000000000042', 'f83a0000-0000-0000-0000-0000000000a1')$$) ->> 'state',
  '23505', 'la unicidad por turno sigue vigente'
);
select is(
  tests_0083.err($$insert into public.assignments (shift_id, employee_id, released_at, released_by) values ('f83a0000-0000-0000-0000-000000000043', 'f83a0000-0000-0000-0000-0000000000a1', now(), null)$$) ->> 'state',
  '23514', 'released_at exige released_by'
);

-- remove_assignment y move_assignment sobre una liberada ---------------------------------------------

select tests_0083.as_user('test-db0083-owner@example.com');
select is(
  tests_0083.err($$select public.remove_assignment('f83a0000-0000-0000-0000-000000000111', 'Prueba')$$) ->> 'hint',
  'SHIFT_CANCELLED', 'remove_assignment sobre una liberada: el turno está cancelado'
);
select is(
  tests_0083.err($$select public.move_assignment('f83a0000-0000-0000-0000-000000000111', 'f83a0000-0000-0000-0000-000000000043', null, null)$$) ->> 'hint',
  'SHIFT_CANCELLED', 'move_assignment sobre una liberada: el turno está cancelado'
);
select is(
  tests_0083.err($$select public.cancel_shift('f83a0000-0000-0000-0000-000000000041', 'Otra vez')$$) ->> 'hint',
  'SHIFT_CANCELLED', 'cancelar dos veces sigue fallando'
);

-- Corrección de los datos de la migración (idempotente) ------------------------------------------------

set local role postgres;
-- Estado que dejaba la 0082: quitada con «Turno cancelado».
update public.assignments
set released_at = null, released_by = null, removed_at = now(), removed_by = 'f83a0000-0000-0000-0000-000000000081', removed_reason = 'Turno cancelado'
where id = 'f83a0000-0000-0000-0000-000000000111';

do $$
begin
  for i in 1..2 loop
    update public.assignments a
    set released_at = a.removed_at, released_by = a.removed_by,
        removed_at = null, removed_by = null, removed_reason = null
    from public.shifts sh
    where sh.id = a.shift_id and sh.status = 'cancelled'
      and a.removed_at is not null and a.removed_reason = 'Turno cancelado'
      and not exists (select 1 from public.attendance_records ar where ar.assignment_id = a.id);
  end loop;
end;
$$;

select is(
  (select released_at is not null and removed_at is null and removed_by is null and removed_reason is null
   from public.assignments where id = 'f83a0000-0000-0000-0000-000000000111'),
  true, 'lo que la 0082 quitó por la cancelación vuelve a vigente, liberada (idempotente)'
);

select * from finish();

rollback;
