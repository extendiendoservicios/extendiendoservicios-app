-- pgTAP de la migración 0092_p37_agenda.sql (P37.1): Agenda.
--   Estructura, RLS (solo dueño y administradores leen), RPC save_agenda_item, delete_agenda_item,
--   set_agenda_item_resolved, duplicate_agenda_item_to_next_month, mark_agenda_item_client y
--   set_agenda_employee_color.
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f92a0000-...'. Las fechas son fijas (años 2196 y 2199): nada depende de la hora.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0092;
grant usage on schema tests_0092 to authenticated, anon;

create or replace function tests_0092.as_user(p_email text)
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
    raise exception 'tests_0092.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0092.as_user(text) to authenticated, anon;

-- Corre una sentencia y devuelve {hint, message, state} del error, o null si no falló.
create or replace function tests_0092.err(p_sql text)
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

grant execute on function tests_0092.err(text) to authenticated, anon;

create table tests_0092.res (k text primary key, r jsonb);
grant select, insert on tests_0092.res to authenticated;

select plan(47);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, status, calendar_color) values
  ('f92a0000-0000-0000-0000-000000000001', 'Cliente 0092 SA', 'Cliente 0092', 'active', 2);

insert into auth.users (id, email, raw_user_meta_data) values
  ('f92a0000-0000-0000-0000-000000000081', 'test-db0092-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Noventa')),
  ('f92a0000-0000-0000-0000-000000000082', 'test-db0092-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Noventa')),
  ('f92a0000-0000-0000-0000-000000000091', 'test-db0092-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f92a0000-0000-0000-0000-0000000000a1', 'test-db0092-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta'));

insert into public.user_roles (profile_id, role) values
  ('f92a0000-0000-0000-0000-000000000081', 'owner'),
  ('f92a0000-0000-0000-0000-000000000082', 'admin'),
  ('f92a0000-0000-0000-0000-000000000091', 'supervisor'),
  ('f92a0000-0000-0000-0000-0000000000a1', 'employee');

insert into public.employees (profile_id, dni, status) values
  ('f92a0000-0000-0000-0000-000000000091', '99202091', 'active'),
  ('f92a0000-0000-0000-0000-0000000000a1', '99202101', 'active');

-- Estructura y grants --------------------------------------------------------------------------

select has_table('public', 'agenda_items', 'existe agenda_items');
select has_table('public', 'agenda_employee_colors', 'existe agenda_employee_colors');
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.oid in ('public.agenda_items'::regclass, 'public.agenda_employee_colors'::regclass)),
  'RLS habilitada en las dos tablas'
);
select ok(
  not has_table_privilege('anon', 'public.agenda_items', 'select')
    and has_table_privilege('authenticated', 'public.agenda_items', 'select')
    and not has_table_privilege('authenticated', 'public.agenda_items', 'insert')
    and not has_table_privilege('authenticated', 'public.agenda_employee_colors', 'update'),
  'grants: authenticated solo select, anon nada'
);
select ok(
  has_function_privilege('authenticated', 'public.save_agenda_item(uuid, text, date, date, smallint, int, jsonb, smallint, smallint)', 'execute')
    and not has_function_privilege('anon', 'public.save_agenda_item(uuid, text, date, date, smallint, int, jsonb, smallint, smallint)', 'execute')
    and not has_function_privilege('anon', 'public.delete_agenda_item(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.set_agenda_item_resolved(uuid, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.duplicate_agenda_item_to_next_month(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.mark_agenda_item_client(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.set_agenda_employee_color(uuid, smallint, smallint)', 'execute'),
  'grants de las RPC: authenticated sí, anon no'
);

-- Dueño: altas, validaciones y duplicados ------------------------------------------------------

select tests_0092.as_user('test-db0092-owner@example.com');

insert into tests_0092.res (k, r)
select 'ev31oct', to_jsonb(i) from public.save_agenda_item(
  null, 'evento', null, '2199-10-31', null, null,
  '{"work_type": "  Final de obra ", "time_text": "8 a 12", "place": "Sede Norte"}'::jsonb, 3::smallint, 5::smallint) i;
insert into tests_0092.res (k, r)
select 'ev31ene', to_jsonb(i) from public.save_agenda_item(
  null, 'evento', null, '2199-01-31', null, null, '{"work_type": "Reunión"}'::jsonb, null, null) i;
insert into tests_0092.res (k, r)
select 'ev31ene_bis', to_jsonb(i) from public.save_agenda_item(
  null, 'evento', null, '2196-01-31', null, null, '{"work_type": "Presupuesto"}'::jsonb, null, null) i;
insert into tests_0092.res (k, r)
select 'nuevo', to_jsonb(i) from public.save_agenda_item(
  null, 'nuevo', '2199-10-17', null, 3::smallint, null,
  '{"place_name": "Edificio Sol", "client_name": "Consorcio Sol", "budget": "150000.50"}'::jsonb, null, 7::smallint) i;
insert into tests_0092.res (k, r)
select 'nota', to_jsonb(i) from public.save_agenda_item(
  null, 'nota', '2199-10-01', null, null, null, '{"body": "Llamar al contador"}'::jsonb, null, null) i;

select is((select r ->> 'month' from tests_0092.res where k = 'ev31oct'), '2199-10-01', 'evento: month sale del día');
select is((select r ->> 'work_type' from tests_0092.res where k = 'ev31oct'), 'Final de obra', 'evento: recorta los bordes del texto');
select is((select r ->> 'created_by' from tests_0092.res where k = 'ev31oct'), 'f92a0000-0000-0000-0000-000000000081', 'created_by es quien lo cargó');
select is((select r ->> 'month' from tests_0092.res where k = 'nuevo'), '2199-10-01', 'nuevo: month normalizado al primer día');
select is((select (r ->> 'budget')::numeric from tests_0092.res where k = 'nuevo'), 150000.50, 'nuevo: guarda el presupuesto');

-- Duplicar al mes siguiente.
insert into tests_0092.res (k, r)
select 'dup31oct', to_jsonb(i) from public.duplicate_agenda_item_to_next_month((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31oct')) i;
insert into tests_0092.res (k, r)
select 'dup31ene', to_jsonb(i) from public.duplicate_agenda_item_to_next_month((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31ene')) i;
insert into tests_0092.res (k, r)
select 'dup31ene_bis', to_jsonb(i) from public.duplicate_agenda_item_to_next_month((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31ene_bis')) i;
insert into tests_0092.res (k, r)
select 'dupnuevo', to_jsonb(i) from public.duplicate_agenda_item_to_next_month((select (r ->> 'id')::uuid from tests_0092.res where k = 'nuevo')) i;

select is((select r ->> 'day' from tests_0092.res where k = 'dup31oct'), '2199-11-30', 'duplicar: 31 oct cae el 30 nov');
select is((select r ->> 'month' from tests_0092.res where k = 'dup31oct'), '2199-11-01', 'duplicar: el mes es el siguiente');
select is((select r ->> 'day' from tests_0092.res where k = 'dup31ene'), '2199-02-28', 'duplicar: 31 ene cae el 28 feb');
select is((select r ->> 'day' from tests_0092.res where k = 'dup31ene_bis'), '2196-02-29', 'duplicar: 31 ene cae el 29 feb en año bisiesto');
select is((select r ->> 'slot' from tests_0092.res where k = 'dupnuevo'), '3', 'duplicar: el bloque de Nuevos conserva la columna');
select is(
  (select r ->> 'copied_from' from tests_0092.res where k = 'dup31oct'),
  (select r ->> 'id' from tests_0092.res where k = 'ev31oct'),
  'duplicar: copied_from apunta al original'
);
select ok(
  (select (r ->> 'resolved')::boolean = false and r ->> 'client_id' is null and r ->> 'resolved_at' is null
   from tests_0092.res where k = 'dup31oct'),
  'duplicar: la copia sale sin resolver y sin cliente'
);

-- Resolver y desresolver.
insert into tests_0092.res (k, r)
select 'resuelto', to_jsonb(i) from public.set_agenda_item_resolved((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31oct'), true) i;

select is((select r ->> 'fill_color' from tests_0092.res where k = 'resuelto'), '20', 'resolver: el relleno pasa al verde (20)');
select is((select r ->> 'fill_before_resolved' from tests_0092.res where k = 'resuelto'), '5', 'resolver: guarda el relleno anterior');
select ok((select r ->> 'resolved_at' is not null and (r ->> 'resolved')::boolean from tests_0092.res where k = 'resuelto'), 'resolver: marca resolved y resolved_at');

insert into tests_0092.res (k, r)
select 'dupresuelto', to_jsonb(i) from public.duplicate_agenda_item_to_next_month((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31oct')) i;
select is((select r ->> 'fill_color' from tests_0092.res where k = 'dupresuelto'), '5', 'duplicar un resuelto: la copia toma el relleno anterior');

insert into tests_0092.res (k, r)
select 'desresuelto', to_jsonb(i) from public.set_agenda_item_resolved((select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31oct'), false) i;
select is((select r ->> 'fill_color' from tests_0092.res where k = 'desresuelto'), '5', 'desresolver: restaura el relleno anterior');
select ok((select r ->> 'resolved_at' is null and not (r ->> 'resolved')::boolean from tests_0092.res where k = 'desresuelto'), 'desresolver: limpia resolved_at');

-- Vincular cliente.
select is(
  tests_0092.err($e$select public.mark_agenda_item_client((select (r ->> 'id')::uuid from tests_0092.res where k = 'nota'), 'f92a0000-0000-0000-0000-000000000001')$e$) ->> 'hint',
  'AGENDA_NOT_NUEVO', 'mark_agenda_item_client rechaza lo que no es nuevo'
);
insert into tests_0092.res (k, r)
select 'vinculado', to_jsonb(i) from public.mark_agenda_item_client((select (r ->> 'id')::uuid from tests_0092.res where k = 'nuevo'), 'f92a0000-0000-0000-0000-000000000001') i;
select ok(
  (select r ->> 'client_id' = 'f92a0000-0000-0000-0000-000000000001' and (r ->> 'resolved')::boolean and r ->> 'fill_color' = '20' and r ->> 'fill_before_resolved' = '7'
   from tests_0092.res where k = 'vinculado'),
  'mark_agenda_item_client: vincula, resuelve y pasa al verde'
);

-- Validaciones.
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'evento', null, null, null, null, '{"work_type": "Reunión"}'::jsonb, null, null)$e$) ->> 'hint',
  'INVALID_DATE', 'evento sin día: rechazado'
);
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'evento', null, '2199-10-05', null, null, '{"work_type": "  "}'::jsonb, null, null)$e$) ->> 'hint',
  'EMPTY_AGENDA_ITEM', 'evento vacío: rechazado'
);
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'nuevo', '2199-10-01', null, 9::smallint, null, '{"place_name": "X"}'::jsonb, null, null)$e$) ->> 'hint',
  'INVALID_SLOT', 'nuevo con columna fuera de rango: rechazado'
);
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'nota', '2199-10-01', null, null, null, '{"body": ""}'::jsonb, null, null)$e$) ->> 'hint',
  'EMPTY_AGENDA_ITEM', 'nota vacía: rechazada'
);
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'nota', '2199-10-01', null, null, null, '{"body": "x"}'::jsonb, 25::smallint, null)$e$) ->> 'hint',
  'INVALID_COLOR', 'color fuera de rango: rechazado'
);
select is(
  tests_0092.err(format($e$select public.save_agenda_item(%L, 'nota', '2199-10-01', null, null, null, '{"body": "x"}'::jsonb, null, null)$e$, (select r ->> 'id' from tests_0092.res where k = 'ev31oct'))) ->> 'hint',
  'AGENDA_KIND_MISMATCH', 'editar no cambia el tipo'
);

-- Mover un evento a otro día del mes siguiente.
insert into tests_0092.res (k, r)
select 'movido', to_jsonb(i) from public.save_agenda_item(
  (select (r ->> 'id')::uuid from tests_0092.res where k = 'ev31oct'), 'evento', null, '2199-11-02', null, null,
  '{"work_type": "Final de obra"}'::jsonb, 3::smallint, 5::smallint) i;
select is((select r ->> 'month' from tests_0092.res where k = 'movido'), '2199-11-01', 'mover el evento a otro mes actualiza month');

-- Color por empleado.
select is(
  (select border_color::int from public.set_agenda_employee_color('f92a0000-0000-0000-0000-0000000000a1', 4::smallint, 12::smallint)), 4,
  'color por empleado: alta'
);
select is(
  (select count(*)::int from public.agenda_employee_colors where employee_id = 'f92a0000-0000-0000-0000-0000000000a1'), 1,
  'color por empleado: queda una fila'
);
select public.set_agenda_employee_color('f92a0000-0000-0000-0000-0000000000a1', null, null);
select is(
  (select count(*)::int from public.agenda_employee_colors where employee_id = 'f92a0000-0000-0000-0000-0000000000a1'), 0,
  'color por empleado: con ambos null borra la fila'
);

-- Borrado físico.
select public.delete_agenda_item((select (r ->> 'id')::uuid from tests_0092.res where k = 'nota'));
select is(
  (select count(*)::int from public.agenda_items where id = (select (r ->> 'id')::uuid from tests_0092.res where k = 'nota')), 0,
  'delete_agenda_item borra físicamente'
);

-- Administrador, coordinador y empleado --------------------------------------------------------

select tests_0092.as_user('test-db0092-admin@example.com');
select ok(
  (select count(*) from public.agenda_items where month in ('2199-10-01', '2199-11-01')) >= 5,
  'el administrador lee la agenda'
);
select is(
  (select (r ->> 'kind') from (select to_jsonb(i) r from public.save_agenda_item(null, 'nota', '2199-10-01', null, null, null, '{"body": "Nota del admin"}'::jsonb, null, null) i) x),
  'nota', 'el administrador guarda'
);

select tests_0092.as_user('test-db0092-sup@example.com');
select is((select count(*)::int from public.agenda_items), 0, 'el coordinador no lee la agenda');
select is(
  tests_0092.err($e$select public.save_agenda_item(null, 'nota', '2199-10-01', null, null, null, '{"body": "x"}'::jsonb, null, null)$e$) ->> 'hint',
  'FORBIDDEN', 'el coordinador no puede guardar'
);

select tests_0092.as_user('test-db0092-a1@example.com');
select is((select count(*)::int from public.agenda_items), 0, 'el empleado no lee la agenda');
select is((select count(*)::int from public.agenda_employee_colors), 0, 'el empleado no lee los colores');
select is(
  tests_0092.err(format($e$select public.set_agenda_item_resolved(%L, true)$e$, (select r ->> 'id' from tests_0092.res where k = 'nuevo'))) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede resolver'
);
select is(
  tests_0092.err(format($e$select public.delete_agenda_item(%L)$e$, (select r ->> 'id' from tests_0092.res where k = 'nuevo'))) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede borrar'
);
select is(
  tests_0092.err(format($e$select public.duplicate_agenda_item_to_next_month(%L)$e$, (select r ->> 'id' from tests_0092.res where k = 'nuevo'))) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede duplicar'
);
select is(
  tests_0092.err(format($e$select public.mark_agenda_item_client(%L, 'f92a0000-0000-0000-0000-000000000001')$e$, (select r ->> 'id' from tests_0092.res where k = 'nuevo'))) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede vincular un cliente'
);
select is(
  tests_0092.err($e$select public.set_agenda_employee_color('f92a0000-0000-0000-0000-0000000000a1', 1::smallint, 1::smallint)$e$) ->> 'hint',
  'FORBIDDEN', 'el empleado no puede cambiar colores'
);

select * from finish();

rollback;
