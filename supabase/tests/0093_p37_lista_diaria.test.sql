-- pgTAP de la migración 0093_p37_lista_diaria.sql (P37.1b): lista diaria de la Agenda.
--   Estructura, RLS (solo dueño y administradores leen), set_agenda_employee_fixed_line,
--   set_agenda_employee_color con renglón fijo, save_agenda_staff_line y delete_agenda_staff_line.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f93a0000-...'. Las fechas son fijas (año 2199): nada depende de la hora.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0093;
grant usage on schema tests_0093 to authenticated, anon;

create or replace function tests_0093.as_user(p_email text)
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
    raise exception 'tests_0093.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0093.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, state} del error, o null si no falló.
create or replace function tests_0093.err(p_sql text)
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

grant execute on function tests_0093.err(text) to authenticated, anon;

create table tests_0093.res (k text primary key, r jsonb);
grant select, insert on tests_0093.res to authenticated;

select plan(46);

-- Fixtures -------------------------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('f93a0000-0000-0000-0000-000000000081', 'test-db0093-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Noventa')),
  ('f93a0000-0000-0000-0000-000000000082', 'test-db0093-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Noventa')),
  ('f93a0000-0000-0000-0000-000000000091', 'test-db0093-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f93a0000-0000-0000-0000-0000000000a1', 'test-db0093-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f93a0000-0000-0000-0000-0000000000a2', 'test-db0093-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Benítez'));

insert into public.user_roles (profile_id, role) values
  ('f93a0000-0000-0000-0000-000000000081', 'owner'),
  ('f93a0000-0000-0000-0000-000000000082', 'admin'),
  ('f93a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f93a0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f93a0000-0000-0000-0000-0000000000a2', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f93a0000-0000-0000-0000-000000000091', '99303091', 'active'),
  ('f93a0000-0000-0000-0000-0000000000a1', '99303101', 'active'),
  ('f93a0000-0000-0000-0000-0000000000a2', '99303102', 'active');

-- Estructura y grants --------------------------------------------------------------------------

select has_table('public', 'agenda_staff_lines', 'existe agenda_staff_lines');
select has_column('public', 'agenda_employee_colors', 'fixed_line', 'agenda_employee_colors tiene fixed_line');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.agenda_staff_lines'::regclass),
  'RLS habilitada en agenda_staff_lines'
);
select ok(
  not has_table_privilege('anon', 'public.agenda_staff_lines', 'select')
    and has_table_privilege('authenticated', 'public.agenda_staff_lines', 'select')
    and not has_table_privilege('authenticated', 'public.agenda_staff_lines', 'insert')
    and not has_table_privilege('authenticated', 'public.agenda_staff_lines', 'update')
    and not has_table_privilege('authenticated', 'public.agenda_staff_lines', 'delete'),
  'grants de agenda_staff_lines: authenticated solo select, anon nada'
);
select ok(
  has_function_privilege('authenticated', 'public.set_agenda_employee_fixed_line(uuid, text)', 'execute')
    and has_function_privilege('authenticated', 'public.save_agenda_staff_line(uuid, uuid, date, text, int)', 'execute')
    and has_function_privilege('authenticated', 'public.delete_agenda_staff_line(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.set_agenda_employee_fixed_line(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.save_agenda_staff_line(uuid, uuid, date, text, int)', 'execute')
    and not has_function_privilege('anon', 'public.delete_agenda_staff_line(uuid)', 'execute'),
  'grants de las RPC: authenticated sí, anon no'
);

-- Dueño: renglón fijo y colores ----------------------------------------------------------------

select tests_0093.as_user('test-db0093-owner@example.com');

select is(
  (select fixed_line from public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a1', '  VENTAS Y COORDINACION  ')),
  'VENTAS Y COORDINACION', 'fixed_line: guarda y recorta los bordes'
);
select is(
  (select count(*)::int from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a1'),
  1, 'fixed_line: crea la fila aunque no haya colores'
);

select is(
  (select fixed_line from public.set_agenda_employee_color('f93a0000-0000-0000-0000-0000000000a1', 3::smallint, 4::smallint)),
  'VENTAS Y COORDINACION', 'color: no pisa el renglón fijo'
);

select is(
  (select fixed_line from public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a1', 'ADMINISTRACION')),
  'ADMINISTRACION', 'fixed_line: se puede cambiar'
);
select ok(
  (select border_color = 3 and fill_color = 4 from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a1'),
  'fixed_line: no pisa los colores'
);

-- Color en null con renglón fijo: la fila se conserva.
select lives_ok(
  $q$select public.set_agenda_employee_color('f93a0000-0000-0000-0000-0000000000a1', null, null)$q$,
  'color null con renglón fijo no falla'
);
select ok(
  (select border_color is null and fill_color is null and fixed_line = 'ADMINISTRACION'
   from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a1'),
  'color null: la fila con renglón fijo queda, con los colores en null'
);

-- Sin renglón fijo y con colores: la fila queda; con todo en null se borra.
select is(
  (select border_color::int from public.set_agenda_employee_color('f93a0000-0000-0000-0000-0000000000a1', 5::smallint, null)),
  5, 'color: se vuelve a pintar el borde'
);
select is(
  (select border_color::int from public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a1', '   ')),
  5, 'fixed_line vacío con colores: la fila queda'
);
select ok(
  (select fixed_line is null from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a1'),
  'fixed_line vacío: lo deja en null'
);
select lives_ok(
  $q$select public.set_agenda_employee_color('f93a0000-0000-0000-0000-0000000000a1', null, null)$q$,
  'color null sin renglón fijo no falla'
);
select is(
  (select count(*)::int from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a1'),
  0, 'sin colores ni renglón fijo la fila se borra'
);

-- Con solo renglón fijo, dejarlo vacío borra la fila.
select public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a2', 'ZONA SUR');
select public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a2', null);
select is(
  (select count(*)::int from public.agenda_employee_colors where employee_id = 'f93a0000-0000-0000-0000-0000000000a2'),
  0, 'fixed_line null sin colores borra la fila'
);

select is(
  tests_0093.err($e$select public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-00000000ffff', 'X')$e$) ->> 'hint',
  'EMPLOYEE_NOT_FOUND', 'fixed_line: persona inexistente'
);
select is(
  tests_0093.err(format($e$select public.set_agenda_employee_fixed_line(%L, %L)$e$, 'f93a0000-0000-0000-0000-0000000000a1', repeat('x', 1001))) ->> 'hint',
  'TEXT_TOO_LONG', 'fixed_line: más de 1000 caracteres'
);

-- Dueño: renglones libres ----------------------------------------------------------------------

insert into tests_0093.res (k, r)
select 'l1', to_jsonb(l) from public.save_agenda_staff_line(
  null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', '  11:20 UBER ', null) l;
insert into tests_0093.res (k, r)
select 'l2', to_jsonb(l) from public.save_agenda_staff_line(
  null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', 'COORDINAR CON MIGUE', null) l;
insert into tests_0093.res (k, r)
select 'l3', to_jsonb(l) from public.save_agenda_staff_line(
  null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-11', 'OTRO DIA', null) l;
insert into tests_0093.res (k, r)
select 'l4', to_jsonb(l) from public.save_agenda_staff_line(
  null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', 'CON POSICION', 7) l;
insert into tests_0093.res (k, r)
select 'l5', to_jsonb(l) from public.save_agenda_staff_line(
  null, 'f93a0000-0000-0000-0000-0000000000a2', '2199-03-10', 'OTRA PERSONA', null) l;

select is((select r ->> 'body' from tests_0093.res where k = 'l1'), '11:20 UBER', 'alta: recorta el texto');
select is((select (r ->> 'position')::int from tests_0093.res where k = 'l1'), 0, 'alta: el primero queda en la posición 0');
select is((select (r ->> 'position')::int from tests_0093.res where k = 'l2'), 1, 'alta: position null va al final de la persona y el día');
select is((select (r ->> 'position')::int from tests_0093.res where k = 'l3'), 0, 'alta: otro día arranca en 0');
select is((select (r ->> 'position')::int from tests_0093.res where k = 'l4'), 7, 'alta: respeta la posición indicada');
select is((select (r ->> 'position')::int from tests_0093.res where k = 'l5'), 0, 'alta: otra persona arranca en 0');
select is((select r ->> 'created_by' from tests_0093.res where k = 'l1'), 'f93a0000-0000-0000-0000-000000000081', 'created_by es quien lo cargó');

-- Edición: body, position y day; la persona no cambia.
insert into tests_0093.res (k, r)
select 'l1e', to_jsonb(l) from public.save_agenda_staff_line(
  (select (r ->> 'id')::uuid from tests_0093.res where k = 'l1'),
  'f93a0000-0000-0000-0000-0000000000a2', '2199-03-12', '11:30 UBER', 3) l;
select ok(
  (select r ->> 'body' = '11:30 UBER' and r ->> 'day' = '2199-03-12' and (r ->> 'position')::int = 3
   from tests_0093.res where k = 'l1e'),
  'edición: cambia texto, día y posición'
);
select is(
  (select r ->> 'employee_id' from tests_0093.res where k = 'l1e'),
  'f93a0000-0000-0000-0000-0000000000a1', 'edición: la persona no cambia'
);
insert into tests_0093.res (k, r)
select 'l2e', to_jsonb(l) from public.save_agenda_staff_line(
  (select (r ->> 'id')::uuid from tests_0093.res where k = 'l2'), null, null, 'COORDINAR CON MIGUEL', null) l;
select ok(
  (select r ->> 'day' = '2199-03-10' and (r ->> 'position')::int = 1 from tests_0093.res where k = 'l2e'),
  'edición: day y position null quedan como estaban'
);

-- Validaciones.
select is(
  tests_0093.err($e$select public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', '   ', null)$e$) ->> 'hint',
  'EMPTY_AGENDA_ITEM', 'alta: texto vacío rechazado'
);
select is(
  tests_0093.err(format($e$select public.save_agenda_staff_line(%L, null, null, '  ', null)$e$, (select r ->> 'id' from tests_0093.res where k = 'l2'))) ->> 'hint',
  'EMPTY_AGENDA_ITEM', 'edición: texto vacío rechazado'
);
select is(
  tests_0093.err(format($e$select public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', %L, null)$e$, repeat('x', 1001))) ->> 'hint',
  'TEXT_TOO_LONG', 'alta: más de 1000 caracteres'
);
select is(
  tests_0093.err($e$select public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-00000000ffff', '2199-03-10', 'X', null)$e$) ->> 'hint',
  'EMPLOYEE_NOT_FOUND', 'alta: persona inexistente'
);
select is(
  tests_0093.err($e$select public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-0000000000a1', null, 'X', null)$e$) ->> 'hint',
  'INVALID_DATE', 'alta: sin día'
);
select is(
  tests_0093.err($e$select public.save_agenda_staff_line('f93a0000-0000-0000-0000-00000000fff0', null, null, 'X', null)$e$) ->> 'hint',
  'STAFF_LINE_NOT_FOUND', 'edición: renglón inexistente'
);

-- Borrado.
select is(
  (select r ->> 'body' from (select to_jsonb(l) r from public.delete_agenda_staff_line((select (r ->> 'id')::uuid from tests_0093.res where k = 'l3')) l) x),
  'OTRO DIA', 'delete: devuelve la fila borrada'
);
select is(
  (select count(*)::int from public.agenda_staff_lines where id = (select (r ->> 'id')::uuid from tests_0093.res where k = 'l3')),
  0, 'delete: borra físicamente'
);
select is(
  tests_0093.err(format($e$select public.delete_agenda_staff_line(%L)$e$, (select r ->> 'id' from tests_0093.res where k = 'l3'))) ->> 'hint',
  'STAFF_LINE_NOT_FOUND', 'delete: renglón inexistente'
);

-- Administrador, coordinador y empleado --------------------------------------------------------

select tests_0093.as_user('test-db0093-admin@example.com');
select ok(
  (select count(*) from public.agenda_staff_lines where day between '2199-03-10' and '2199-03-12') >= 4,
  'el administrador lee los renglones'
);
select is(
  (select r ->> 'body' from (select to_jsonb(l) r from public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', 'Del admin', null) l) x),
  'Del admin', 'el administrador guarda'
);

select tests_0093.as_user('test-db0093-sup@example.com');
select is((select count(*)::int from public.agenda_staff_lines), 0, 'el coordinador no lee los renglones');
select is(
  tests_0093.err($e$select public.save_agenda_staff_line(null, 'f93a0000-0000-0000-0000-0000000000a1', '2199-03-10', 'x', null)$e$) ->> 'hint',
  'FORBIDDEN', 'el coordinador no puede guardar renglones'
);

select tests_0093.as_user('test-db0093-a1@example.com');
select is((select count(*)::int from public.agenda_staff_lines), 0, 'el empleado no lee los renglones');
select is(
  tests_0093.err(format($e$select public.delete_agenda_staff_line(%L)$e$, (select r ->> 'id' from tests_0093.res where k = 'l2'))) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede borrar renglones'
);
select is(
  tests_0093.err($e$select public.set_agenda_employee_fixed_line('f93a0000-0000-0000-0000-0000000000a1', 'x')$e$) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede cambiar el renglón fijo'
);

select * from finish();

rollback;
