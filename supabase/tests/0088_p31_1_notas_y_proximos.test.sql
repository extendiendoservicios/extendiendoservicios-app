-- pgTAP de la migración 0088_p31_1_observaciones_23_nov.sql (P31.1), parte B:
--   D-08  employee_calendar_notes: estructura, RLS (solo dueño y administradores), RPC
--         save_employee_calendar_note / delete_employee_calendar_note / list_employee_calendar_notes.
--   D-09  v_supervisor_upcoming: próximos 7 días del coordinador (Mis sedes / Otras sedes).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f88b0000-...'. Los turnos son relativos a app.today() (hoy + 1 ... hoy + 8) y
-- las observaciones, de 2199. Nada depende de la hora del día.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0088b;
grant usage on schema tests_0088b to authenticated, anon;

create or replace function tests_0088b.as_user(p_email text)
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
    raise exception 'tests_0088b.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0088b.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, detail, state} del error, o null si no falló.
create or replace function tests_0088b.err(p_sql text)
returns jsonb
language plpgsql
as $$
declare
  v_hint text;
  v_msg text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text, v_detail = pg_exception_detail;
  return jsonb_build_object('hint', v_hint, 'message', v_msg, 'detail', v_detail, 'state', sqlstate);
end;
$$;

grant execute on function tests_0088b.err(text) to authenticated, anon;

create table tests_0088b.res (k text primary key, r jsonb);
grant select, insert on tests_0088b.res to authenticated;

select plan(71);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f88b0000-0000-0000-0000-000000000001', 'Cliente 0088b SA', 'YPF 0088b', 'active', 2);
insert into public.sites (id, client_id, name, address, latitude, longitude, status) values
  ('f88b0000-0000-0000-0000-000000000011', 'f88b0000-0000-0000-0000-000000000001', 'Sede Mía 88b', 'Dirección 88b', -34.6, -58.4, 'active'),
  ('f88b0000-0000-0000-0000-000000000012', 'f88b0000-0000-0000-0000-000000000001', 'Sede Otra 88b', 'Dirección 88b bis', -34.7, -58.5, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f88b0000-0000-0000-0000-000000000081', 'test-db0088b-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Ochenta')),
  ('f88b0000-0000-0000-0000-000000000082', 'test-db0088b-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Ochenta')),
  ('f88b0000-0000-0000-0000-000000000091', 'test-db0088b-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f88b0000-0000-0000-0000-0000000000a1', 'test-db0088b-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f88b0000-0000-0000-0000-0000000000a2', 'test-db0088b-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter'));

insert into public.user_roles (profile_id, role) values
  ('f88b0000-0000-0000-0000-000000000081', 'owner'),
  ('f88b0000-0000-0000-0000-000000000082', 'admin'),
  ('f88b0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f88b0000-0000-0000-0000-0000000000a1', 'employee'),
  ('f88b0000-0000-0000-0000-0000000000a2', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f88b0000-0000-0000-0000-000000000091', '98802091', 'active'),
  ('f88b0000-0000-0000-0000-0000000000a1', '98802101', 'active'),
  ('f88b0000-0000-0000-0000-0000000000a2', '98802102', 'active');

-- Estructura de la tabla -----------------------------------------------------------------------

select has_table('public', 'employee_calendar_notes', 'existe employee_calendar_notes');
select has_column('public', 'employee_calendar_notes', 'employee_id', 'employee_id');
select has_column('public', 'employee_calendar_notes', 'note_date', 'note_date');
select has_column('public', 'employee_calendar_notes', 'body', 'body');
select has_column('public', 'employee_calendar_notes', 'color', 'color');
select has_column('public', 'employee_calendar_notes', 'created_at', 'created_at');
select has_column('public', 'employee_calendar_notes', 'created_by', 'created_by');
select has_column('public', 'employee_calendar_notes', 'updated_at', 'updated_at');
select has_column('public', 'employee_calendar_notes', 'updated_by', 'updated_by');
select has_column('public', 'employee_calendar_notes', 'deleted_at', 'deleted_at');
select col_is_pk('public', 'employee_calendar_notes', 'id', 'id es la clave primaria');
select col_is_null('public', 'employee_calendar_notes', 'color', 'color admite null');
select col_not_null('public', 'employee_calendar_notes', 'body', 'body es obligatorio');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.employee_calendar_notes'::regclass),
  'RLS habilitada en employee_calendar_notes'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'employee_calendar_notes'
      and indexdef ilike '%(employee_id, note_date)%'
  ),
  'índice por (employee_id, note_date)'
);
select ok(
  not has_table_privilege('anon', 'public.employee_calendar_notes', 'select')
    and has_table_privilege('authenticated', 'public.employee_calendar_notes', 'select')
    and not has_table_privilege('authenticated', 'public.employee_calendar_notes', 'insert')
    and not has_table_privilege('authenticated', 'public.employee_calendar_notes', 'update')
    and not has_table_privilege('authenticated', 'public.employee_calendar_notes', 'delete'),
  'grants: authenticated solo lee; anon nada'
);
select ok(
  has_function_privilege('authenticated', 'public.save_employee_calendar_note(uuid, uuid, date, text, smallint)', 'execute')
    and has_function_privilege('authenticated', 'public.delete_employee_calendar_note(uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.list_employee_calendar_notes(uuid, date, date)', 'execute')
    and not has_function_privilege('anon', 'public.save_employee_calendar_note(uuid, uuid, date, text, smallint)', 'execute')
    and not has_function_privilege('anon', 'public.delete_employee_calendar_note(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.list_employee_calendar_notes(uuid, date, date)', 'execute'),
  'grants de las tres RPC: authenticated sí, anon no'
);

-- Alta, cambio y baja --------------------------------------------------------------------------

select tests_0088b.as_user('test-db0088b-owner@example.com');

insert into tests_0088b.res (k, r)
select 'n1', to_jsonb(n) from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', '  Sin turnos: tiene licencia  ', 3::smallint) n;
insert into tests_0088b.res (k, r)
select 'n2', to_jsonb(n) from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', 'Segunda observación del mismo día', null) n;

select is((select r ->> 'body' from tests_0088b.res where k = 'n1'), 'Sin turnos: tiene licencia', 'alta: guarda el texto sin espacios de los bordes');
select is((select (r ->> 'color')::int from tests_0088b.res where k = 'n1'), 3, 'alta: guarda el color');
select is((select r ->> 'color' from tests_0088b.res where k = 'n2'), null, 'alta: el color puede ser null');
select is((select r ->> 'created_by' from tests_0088b.res where k = 'n1'), 'f88b0000-0000-0000-0000-000000000081', 'alta: created_by es quien la cargó');
select is((select r ->> 'updated_by' from tests_0088b.res where k = 'n1'), 'f88b0000-0000-0000-0000-000000000081', 'alta: updated_by es quien la cargó');
select is((select r ->> 'deleted_at' from tests_0088b.res where k = 'n1'), null, 'alta: sin baja');
select is(
  (select count(*)::int from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-08-31')), 2,
  'lista: dos observaciones el mismo día (varias por día)'
);
select is(
  (select created_by_name from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-08-31') order by created_at, id limit 1),
  'Dueño Ochenta', 'lista: trae el nombre de quien la cargó'
);
select is(
  (select count(*)::int from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-09-01', '2199-09-30')), 0,
  'lista: otro mes no trae nada'
);
select is(
  (select count(*)::int from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a2', '2199-08-01', '2199-08-31')), 0,
  'lista: otra persona no trae nada'
);

-- Un administrador edita la observación del dueño.
select tests_0088b.as_user('test-db0088b-admin@example.com');
insert into tests_0088b.res (k, r)
select 'n1b', to_jsonb(n) from public.save_employee_calendar_note((select (r ->> 'id')::uuid from tests_0088b.res where k = 'n1'), 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-11', 'Cambiada por la administración', 7::smallint) n;

select is((select r ->> 'body' from tests_0088b.res where k = 'n1b'), 'Cambiada por la administración', 'cambio: guarda el texto nuevo');
select is((select r ->> 'note_date' from tests_0088b.res where k = 'n1b'), '2199-08-11', 'cambio: puede mover la observación de día');
select is((select (r ->> 'color')::int from tests_0088b.res where k = 'n1b'), 7, 'cambio: guarda el color nuevo');
select is((select r ->> 'updated_by' from tests_0088b.res where k = 'n1b'), 'f88b0000-0000-0000-0000-000000000082', 'cambio: updated_by es el administrador');
select is((select r ->> 'created_by' from tests_0088b.res where k = 'n1b'), 'f88b0000-0000-0000-0000-000000000081', 'cambio: created_by no cambia');

-- Validaciones.
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', '   ', null)$$) ->> 'hint',
  'INVALID_NOTE_BODY', 'valida: texto vacío'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', repeat('x', 501), null)$$) ->> 'hint',
  'INVALID_NOTE_BODY', 'valida: más de 500 caracteres'
);
select is(
  (select char_length(body) from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-12', repeat('x', 500), null)), 500,
  'valida: 500 caracteres es el máximo permitido'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', 'Algo', 12::smallint)$$) ->> 'hint',
  'INVALID_COLOR', 'valida: color fuera de 0 a 11'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', null, 'Algo', null)$$) ->> 'hint',
  'INVALID_DATE', 'valida: sin día'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000ff', '2199-08-10', 'Algo', null)$$) ->> 'hint',
  'EMPLOYEE_NOT_FOUND', 'valida: persona inexistente'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note('f88b0000-0000-0000-0000-0000000000ee', 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', 'Algo', null)$$) ->> 'hint',
  'NOTE_NOT_FOUND', 'valida: observación inexistente'
);
select is(
  tests_0088b.err(format($$select * from public.save_employee_calendar_note(%L, 'f88b0000-0000-0000-0000-0000000000a2', '2199-08-10', 'Algo', null)$$, (select r ->> 'id' from tests_0088b.res where k = 'n1'))) ->> 'hint',
  'NOTE_NOT_FOUND', 'valida: la observación es de otra persona'
);
select is(
  tests_0088b.err($$select * from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-31', '2199-08-01')$$) ->> 'hint',
  'INVALID_DATE_RANGE', 'lista: rango inválido'
);

-- Baja lógica.
select is(
  (select deleted_at is not null from public.delete_employee_calendar_note((select (r ->> 'id')::uuid from tests_0088b.res where k = 'n2'))), true,
  'baja: pone deleted_at'
);
select is(
  (select count(*)::int from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-08-31')), 2,
  'baja: la lista ya no trae la observación dada de baja (quedan la movida al 11 y la de 500 caracteres)'
);
select is(
  tests_0088b.err(format($$select * from public.delete_employee_calendar_note(%L)$$, (select r ->> 'id' from tests_0088b.res where k = 'n2'))) ->> 'hint',
  'NOTE_NOT_FOUND', 'baja: dar de baja dos veces da NOTE_NOT_FOUND'
);
select is(
  (select count(*)::int from public.employee_calendar_notes where employee_id = 'f88b0000-0000-0000-0000-0000000000a1' and deleted_at is not null), 1,
  'baja: la fila queda en la tabla (nada se borra)'
);

-- RLS por rol ----------------------------------------------------------------------------------

select is(
  (select count(*)::int from public.employee_calendar_notes where employee_id = 'f88b0000-0000-0000-0000-0000000000a1'), 3,
  'RLS: el administrador lee las observaciones (incluida la dada de baja, por select directo)'
);

select tests_0088b.as_user('test-db0088b-owner@example.com');
select is(
  (select count(*)::int from public.employee_calendar_notes where employee_id = 'f88b0000-0000-0000-0000-0000000000a1'), 3,
  'RLS: el dueño las lee'
);
select is(
  tests_0088b.err($$insert into public.employee_calendar_notes (employee_id, note_date, body) values ('f88b0000-0000-0000-0000-0000000000a1', '2199-08-20', 'Directo')$$) ->> 'state',
  '42501', 'RLS: ni el dueño escribe directo en la tabla (solo por las RPC)'
);

select tests_0088b.as_user('test-db0088b-a1@example.com');
select is(
  (select count(*)::int from public.employee_calendar_notes), 0,
  'RLS: la propia empleada NO ve sus observaciones'
);
select is(
  tests_0088b.err($$select * from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-08-31')$$) ->> 'hint',
  'FORBIDDEN', 'RPC: el empleado no puede listar'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', 'Algo', null)$$) ->> 'hint',
  'FORBIDDEN', 'RPC: el empleado no puede guardar'
);
select is(
  tests_0088b.err(format($$select * from public.delete_employee_calendar_note(%L)$$, (select 'f88b0000-0000-0000-0000-0000000000ee'))) ->> 'hint',
  'FORBIDDEN', 'RPC: el empleado no puede dar de baja'
);

select tests_0088b.as_user('test-db0088b-sup@example.com');
select is(
  (select count(*)::int from public.employee_calendar_notes), 0,
  'RLS: el coordinador no ve observaciones'
);
select is(
  tests_0088b.err($$select * from public.list_employee_calendar_notes('f88b0000-0000-0000-0000-0000000000a1', '2199-08-01', '2199-08-31')$$) ->> 'hint',
  'FORBIDDEN', 'RPC: el coordinador no puede listar'
);
select is(
  tests_0088b.err($$select * from public.save_employee_calendar_note(null, 'f88b0000-0000-0000-0000-0000000000a1', '2199-08-10', 'Algo', null)$$) ->> 'hint',
  'FORBIDDEN', 'RPC: el coordinador no puede guardar'
);

-- D-09: próximos turnos del coordinador --------------------------------------------------------

set local role postgres;

-- Turnos del cliente de prueba:
--   51 hoy + 1  sede mía (prioridad)        -> entra, is_priority = true
--   52 hoy + 7  sede otra                   -> entra, is_priority = false
--   53 hoy + 8                              -> fuera (más de 7 días)
--   54 hoy                                  -> fuera (es de «Hoy»)
--   55 hoy + 3  cancelado                   -> fuera
--   56 hoy + 2  dado de baja (deleted_at)   -> fuera
--   57 hoy - 1                              -> fuera
-- 58 hoy + 4 con una persona asignada (assigned_employees).
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('f88b0000-0000-0000-0000-000000000051', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000011', app.today() + 1, '09:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000052', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() + 7, '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000053', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() + 8, '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000054', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today(), '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000055', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() + 3, '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000056', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() + 2, '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000057', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() - 1, '10:00', '12:00', 1, 'scheduled', false),
  ('f88b0000-0000-0000-0000-000000000058', null, 'f88b0000-0000-0000-0000-000000000001', 'f88b0000-0000-0000-0000-000000000012', app.today() + 4, '08:00', '09:00', 1, 'scheduled', false);

update public.shifts set status = 'cancelled', cancelled_at = now(), cancelled_by = 'f88b0000-0000-0000-0000-000000000081', cancel_reason = 'Prueba'
where id = 'f88b0000-0000-0000-0000-000000000055';
update public.shifts set deleted_at = now() where id = 'f88b0000-0000-0000-0000-000000000056';

insert into public.assignments (id, shift_id, employee_id, status) values
  ('f88b0000-0000-0000-0000-000000000151', 'f88b0000-0000-0000-0000-000000000058', 'f88b0000-0000-0000-0000-0000000000a2', 'expected');

-- La coordinadora tiene prioridad en la sede 11.
insert into public.supervisor_priorities (supervisor_id, site_id, created_by) values
  ('f88b0000-0000-0000-0000-000000000091', 'f88b0000-0000-0000-0000-000000000011', 'f88b0000-0000-0000-0000-000000000081');

select has_view('public', 'v_supervisor_upcoming', 'existe v_supervisor_upcoming');
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_supervisor_upcoming'),
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'v_supervisor_today'),
  'v_supervisor_upcoming tiene las mismas columnas que v_supervisor_today'
);
select ok(
  has_table_privilege('authenticated', 'public.v_supervisor_upcoming', 'select')
    and not has_table_privilege('anon', 'public.v_supervisor_upcoming', 'select'),
  'v_supervisor_upcoming: authenticated sí, anon no'
);

select tests_0088b.as_user('test-db0088b-sup@example.com');

create temp table t_up on commit drop as
select * from public.v_supervisor_upcoming where client_id = 'f88b0000-0000-0000-0000-000000000001';
grant select on t_up to authenticated;

select is((select count(*)::int from t_up), 3, 'próximos: entran los de mañana a hoy + 7 no cancelados ni dados de baja (51, 52 y 58)');
select is(
  (select array_agg(shift_id::text order by shift_date, start_time) from t_up),
  array['f88b0000-0000-0000-0000-000000000051', 'f88b0000-0000-0000-0000-000000000058', 'f88b0000-0000-0000-0000-000000000052'],
  'próximos: ordenados por fecha y hora'
);
select is((select count(*)::int from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000053'), 0, 'próximos: hoy + 8 no entra');
select is((select count(*)::int from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000054'), 0, 'próximos: el de hoy no entra (es de «Hoy»)');
select is((select count(*)::int from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000055'), 0, 'próximos: el cancelado no entra');
select is((select count(*)::int from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000057'), 0, 'próximos: el de ayer no entra');
select is((select is_priority from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000051'), true, 'próximos: «Mis sedes» (sede con prioridad)');
select is((select priority_kind from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000051'), 'site', 'próximos: priority_kind = site');
select is((select is_priority from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000052'), false, 'próximos: «Otras sedes» (sin prioridad)');
select is((select shift_date from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000052'), (select app.today() + 7), 'próximos: trae la fecha del turno');
select is(
  (select jsonb_array_length(assigned_employees) from t_up where shift_id = 'f88b0000-0000-0000-0000-000000000058'), 1,
  'próximos: trae las personas asignadas'
);

select tests_0088b.as_user('test-db0088b-admin@example.com');
select is(
  (select count(*)::int from public.v_supervisor_upcoming where client_id = 'f88b0000-0000-0000-0000-000000000001'), 0,
  'próximos: un administrador no recibe filas (solo el rol coordinador)'
);
select tests_0088b.as_user('test-db0088b-a2@example.com');
select is(
  (select count(*)::int from public.v_supervisor_upcoming where client_id = 'f88b0000-0000-0000-0000-000000000001'), 0,
  'próximos: un empleado no recibe filas'
);

select * from finish();

rollback;
