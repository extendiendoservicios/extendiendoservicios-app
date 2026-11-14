-- pgTAP de la migración 0085_p29_1_observaciones_14_nov.sql (P29.1), solo de lo que toca:
--   OG-04  CUIT repetido permitido (se mantiene el check de 11 dígitos) y find_clients_by_cuit.
--   OG-02  attention_dismissals, dismiss_attention, reopen_attention y la limpieza de 30 días.
--   OG-05  shift_notes en v_my_day, v_my_history y v_my_supervisions (solo del asignado).
--   OG-01  map_active_sites().
--   OG-12  admin_users_directory() (legajo, DNI y email según CR-07).
--
-- Convención (ver supabase/tests/README.md): transacción que termina en `rollback`. Prefijo de
-- fixtures propio: 'f8500000-...'. CUIT de fixture '99985085001'.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

create schema if not exists tests_0085;
grant usage on schema tests_0085 to authenticated, anon;

create or replace function tests_0085.as_user(p_email text)
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
    raise exception 'tests_0085.as_user: no existe auth.users.email = %', p_email;
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

grant execute on function tests_0085.as_user(text) to authenticated, anon;

create or replace function tests_0085.hint_of(p_sql text)
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

grant execute on function tests_0085.hint_of(text) to authenticated, anon;

select plan(78);

-- Fixtures -------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, trade_name, cuit, status, calendar_color) values
  ('f8500000-0000-0000-0000-000000000001', 'Cliente 0085 A SA', 'A 0085', '99985085001', 'active', 3),
  ('f8500000-0000-0000-0000-000000000002', 'Cliente 0085 B SA', 'B 0085', '99985085001', 'active', 4),
  ('f8500000-0000-0000-0000-000000000003', 'Cliente 0085 C SA', 'C 0085', '99985085001', 'suspended', 5),
  ('f8500000-0000-0000-0000-000000000004', 'Cliente 0085 D SA', 'D 0085', null, 'active', 6),
  ('f8500000-0000-0000-0000-000000000005', 'Cliente 0085 E SA', 'E 0085', null, 'suspended', 7);

insert into public.sites (id, client_id, name, address, city, latitude, longitude, status) values
  ('f8500000-0000-0000-0000-000000000011', 'f8500000-0000-0000-0000-000000000001', 'Sede A1', 'Dirección A1', 'Rosario', -32.9, -60.6, 'active'),
  ('f8500000-0000-0000-0000-000000000012', 'f8500000-0000-0000-0000-000000000001', 'Sede A2 sin ubicación', 'Dirección A2', 'Rosario', null, null, 'active'),
  ('f8500000-0000-0000-0000-000000000013', 'f8500000-0000-0000-0000-000000000002', 'Sede B1', 'Dirección B1', 'Rosario', -32.8, -60.7, 'active'),
  ('f8500000-0000-0000-0000-000000000014', 'f8500000-0000-0000-0000-000000000004', 'Sede D1 vencida', 'Dirección D1', 'Rosario', -32.7, -60.5, 'active'),
  ('f8500000-0000-0000-0000-000000000015', 'f8500000-0000-0000-0000-000000000005', 'Sede E1', 'Dirección E1', 'Rosario', -32.6, -60.4, 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('f8500000-0000-0000-0000-000000000081', 'test-db0085-owner@example.com', jsonb_build_object('first_name', 'Dueño', 'last_name', 'Cinco')),
  ('f8500000-0000-0000-0000-000000000082', 'test-db0085-admin@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Cinco')),
  ('f8500000-0000-0000-0000-000000000083', 'test-db0085-admin2@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'Seis')),
  ('f8500000-0000-0000-0000-000000000091', 'test-db0085-sup@example.com', jsonb_build_object('first_name', 'Sofía', 'last_name', 'Supervisora')),
  ('f8500000-0000-0000-0000-000000000092', 'test-db0085-sup2@example.com', jsonb_build_object('first_name', 'Sergio', 'last_name', 'Supervisor')),
  ('f8500000-0000-0000-0000-0000000000a1', 'test-db0085-a1@example.com', jsonb_build_object('first_name', 'Aldana', 'last_name', 'Acosta')),
  ('f8500000-0000-0000-0000-0000000000a2', 'test-db0085-a2@example.com', jsonb_build_object('first_name', 'Bruno', 'last_name', 'Boutter'));

insert into public.user_roles (profile_id, role) values
  ('f8500000-0000-0000-0000-000000000081', 'owner'),
  ('f8500000-0000-0000-0000-000000000082', 'admin'),
  ('f8500000-0000-0000-0000-000000000083', 'admin'),
  ('f8500000-0000-0000-0000-000000000091', 'supervisor'),
  ('f8500000-0000-0000-0000-000000000092', 'supervisor'),
  ('f8500000-0000-0000-0000-0000000000a1', 'employee'),
  ('f8500000-0000-0000-0000-0000000000a2', 'employee');

-- admin tiene manage_users; admin2 no tiene ninguna capacidad.
insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('f8500000-0000-0000-0000-000000000082', 'manage_users', true);

insert into public.employees (profile_id, dni, status) values
  ('f8500000-0000-0000-0000-000000000091', '98508091', 'active'),
  ('f8500000-0000-0000-0000-000000000092', '98508092', 'active'),
  ('f8500000-0000-0000-0000-0000000000a1', '98508101', 'active'),
  ('f8500000-0000-0000-0000-0000000000a2', '98508102', 'active');

-- Servicios para el mapa: A1 con uno activo y uno pausado; B1 solo pausado; D1 activo pero vencido;
-- E1 activo pero el cliente está suspendido; A2 activo pero la sede no tiene ubicación.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status) values
  ('f8500000-0000-0000-0000-000000000021', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', 'Limpieza A1 mañana', array[1, 3]::smallint[], '08:00', '12:00', 1, '2199-01-01', null, 'active'),
  ('f8500000-0000-0000-0000-000000000022', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', 'Limpieza A1 pausada', array[2]::smallint[], '08:00', '12:00', 1, '2199-01-01', null, 'paused'),
  ('f8500000-0000-0000-0000-000000000023', 'f8500000-0000-0000-0000-000000000002', 'f8500000-0000-0000-0000-000000000013', 'Limpieza B1 pausada', array[2]::smallint[], '08:00', '12:00', 1, '2199-01-01', null, 'paused'),
  ('f8500000-0000-0000-0000-000000000024', 'f8500000-0000-0000-0000-000000000004', 'f8500000-0000-0000-0000-000000000014', 'Limpieza D1 vencida', array[2]::smallint[], '08:00', '12:00', 1, '2000-01-01', '2000-12-31', 'active'),
  ('f8500000-0000-0000-0000-000000000025', 'f8500000-0000-0000-0000-000000000005', 'f8500000-0000-0000-0000-000000000015', 'Limpieza E1', array[2]::smallint[], '08:00', '12:00', 1, '2199-01-01', null, 'active'),
  ('f8500000-0000-0000-0000-000000000026', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000012', 'Limpieza A2 sin ubicación', array[2]::smallint[], '08:00', '12:00', 1, '2199-01-01', null, 'active');

-- Turnos: hoy (con observación) con Acosta y Boutter; ayer (con observación) con Acosta; hoy con
-- observación en blanco con Acosta; hoy supervisado por Supervisora; uno sin cubrir (aviso «uncovered»).
insert into public.shifts (id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated, notes) values
  ('f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', app.today(), '08:00', '09:00', 2, 'assigned', false, '  Traer las llaves de la oficina  '),
  ('f8500000-0000-0000-0000-000000000032', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', app.today() - 1, '08:00', '09:00', 1, 'completed', false, 'Observación de ayer'),
  ('f8500000-0000-0000-0000-000000000033', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', app.today(), '10:00', '11:00', 1, 'assigned', false, '   '),
  ('f8500000-0000-0000-0000-000000000034', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', app.today(), '12:00', '13:00', 1, 'scheduled', false, 'Nota del turno supervisado'),
  ('f8500000-0000-0000-0000-000000000035', 'f8500000-0000-0000-0000-000000000001', 'f8500000-0000-0000-0000-000000000011', app.today(), '14:00', '15:00', 1, 'scheduled', false, null);

insert into public.assignments (id, shift_id, employee_id) values
  ('f8500000-0000-0000-0000-000000000101', 'f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-0000000000a1'),
  ('f8500000-0000-0000-0000-000000000102', 'f8500000-0000-0000-0000-000000000032', 'f8500000-0000-0000-0000-0000000000a1'),
  ('f8500000-0000-0000-0000-000000000103', 'f8500000-0000-0000-0000-000000000033', 'f8500000-0000-0000-0000-0000000000a1'),
  ('f8500000-0000-0000-0000-000000000104', 'f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-0000000000a2');

insert into public.supervisions (id, shift_id, supervisor_id, status) values
  ('f8500000-0000-0000-0000-0000000000d1', 'f8500000-0000-0000-0000-000000000034', 'f8500000-0000-0000-0000-000000000091', 'assigned');

-- Estructura -----------------------------------------------------------------------------------

select has_table('public', 'attention_dismissals', 'existe attention_dismissals');
select has_function('public', 'dismiss_attention', array['text', 'uuid', 'uuid'], 'dismiss_attention(text, uuid, uuid)');
select has_function('public', 'reopen_attention', array['uuid'], 'reopen_attention(uuid)');
select has_function('public', 'find_clients_by_cuit', array['text', 'uuid'], 'find_clients_by_cuit(text, uuid)');
select has_function('public', 'map_active_sites', 'map_active_sites()');
select has_function('public', 'admin_users_directory', 'admin_users_directory()');
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'public.clients'::regclass and conname = 'clients_cuit_key')
  and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'clients' and indexname = 'clients_cuit_idx'),
  'clients: sin unicidad de CUIT y con índice común clients_cuit_idx'
);
select ok(
  not has_table_privilege('authenticated', 'public.attention_dismissals', 'insert')
  and not has_table_privilege('authenticated', 'public.attention_dismissals', 'delete')
  and not has_table_privilege('anon', 'public.attention_dismissals', 'select')
  and has_table_privilege('authenticated', 'public.attention_dismissals', 'select'),
  'attention_dismissals: authenticated solo lee; anon nada; se escribe solo por las RPC'
);
select ok(
  not has_function_privilege('anon', 'public.dismiss_attention(text, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.reopen_attention(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.find_clients_by_cuit(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.map_active_sites()', 'execute')
  and not has_function_privilege('anon', 'public.admin_users_directory()', 'execute')
  and not has_function_privilege('authenticated', 'app.purge_attention_dismissals()', 'execute'),
  'grants: las RPC nuevas no son de anon; la limpieza interna no es de authenticated'
);

-- OG-04: CUIT repetido ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.clients where cuit = '99985085001'),
  3,
  'tres clientes comparten el mismo CUIT (la unicidad ya no existe)'
);
select throws_ok(
  $$insert into public.clients (id, legal_name, cuit, calendar_color) values ('f8500000-0000-0000-0000-0000000000f1', 'CUIT corto 0085', '1234567890', 0)$$,
  '23514',
  null,
  'se mantiene el check de 11 dígitos'
);

select tests_0085.as_user('test-db0085-admin@example.com');
select is(
  (select count(*)::int from public.find_clients_by_cuit('99-985085-001')),
  2,
  'find_clients_by_cuit: admin ve los 2 clientes ACTIVOS con ese CUIT (acepta guiones; excluye al suspendido)'
);
select is(
  (select count(*)::int from public.find_clients_by_cuit('99985085001', 'f8500000-0000-0000-0000-000000000001')),
  1,
  'find_clients_by_cuit: excluye el cliente que se está editando'
);
select is(
  (select id from public.find_clients_by_cuit('99985085001', 'f8500000-0000-0000-0000-000000000001')),
  'f8500000-0000-0000-0000-000000000002'::uuid,
  'find_clients_by_cuit: devuelve al otro cliente'
);
select is((select count(*)::int from public.find_clients_by_cuit('')), 0, 'find_clients_by_cuit: CUIT vacío no devuelve nada');
select tests_0085.as_user('test-db0085-owner@example.com');
select is((select count(*)::int from public.find_clients_by_cuit('99985085001')), 2, 'find_clients_by_cuit: el dueño también');
select tests_0085.as_user('test-db0085-sup@example.com');
select is(tests_0085.hint_of($$select * from public.find_clients_by_cuit('99985085001')$$), 'FORBIDDEN', 'find_clients_by_cuit: coordinador FORBIDDEN');
select tests_0085.as_user('test-db0085-a1@example.com');
select is(tests_0085.hint_of($$select * from public.find_clients_by_cuit('99985085001')$$), 'FORBIDDEN', 'find_clients_by_cuit: empleado FORBIDDEN');

-- OG-02: cerrar y reabrir avisos ----------------------------------------------------------------

select tests_0085.as_user('test-db0085-admin2@example.com');
select is(
  (select kind from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-000000000035', null)),
  'uncovered',
  'dismiss_attention: cualquier admin (sin capacidades) cierra un turno sin cubrir'
);
select is(
  (select dismissed_by from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000035' and kind = 'uncovered'),
  'f8500000-0000-0000-0000-000000000083'::uuid,
  'queda registrado quién lo cerró'
);
select ok(
  (select dismissed_at is not null from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000035' and kind = 'uncovered'),
  'queda registrado cuándo'
);

select tests_0085.as_user('test-db0085-owner@example.com');
select is(
  (select id from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-000000000035', null)),
  (select id from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000035' and kind = 'uncovered'),
  'dismiss_attention es idempotente: devuelve el cierre existente (cierre para todos)'
);
select is(
  (select dismissed_by from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000035' and kind = 'uncovered'),
  'f8500000-0000-0000-0000-000000000083'::uuid,
  'el segundo cierre no pisa quién lo cerró primero'
);
select is(
  (select assignment_id from public.dismiss_attention('noRecord', 'f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-000000000101')),
  'f8500000-0000-0000-0000-000000000101'::uuid,
  'dismiss_attention: noRecord por asignación'
);
select ok(
  (select id from public.dismiss_attention('delayNotified', 'f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-000000000101')) is not null,
  'dismiss_attention: delayNotified de la misma asignación es otra situación (se cierra aparte)'
);
select is(
  (select count(*)::int from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000031'),
  2,
  'cada situación (tipo + asignación) tiene su propia fila'
);
select is(tests_0085.hint_of($$select * from public.dismiss_attention('inventado', 'f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-000000000101')$$), 'INVALID_ATTENTION_KIND', 'tipo inválido');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('noRecord', 'f8500000-0000-0000-0000-000000000031', null)$$), 'INVALID_ATTENTION_TARGET', 'noRecord exige asignación');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-000000000035', 'f8500000-0000-0000-0000-000000000101')$$), 'INVALID_ATTENTION_TARGET', 'uncovered no lleva asignación');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('noRecord', 'f8500000-0000-0000-0000-000000000033', 'f8500000-0000-0000-0000-000000000101')$$), 'ASSIGNMENT_NOT_FOUND', 'la asignación tiene que ser del turno');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-0000000000ff', null)$$), 'SHIFT_NOT_FOUND', 'turno inexistente');

select tests_0085.as_user('test-db0085-sup@example.com');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-000000000035', null)$$), 'FORBIDDEN', 'dismiss_attention: coordinador FORBIDDEN');
select is((select count(*)::int from public.attention_dismissals), 0, 'attention_dismissals: el coordinador no lee nada (RLS)');
select tests_0085.as_user('test-db0085-a1@example.com');
select is(tests_0085.hint_of($$select * from public.dismiss_attention('uncovered', 'f8500000-0000-0000-0000-000000000035', null)$$), 'FORBIDDEN', 'dismiss_attention: empleado FORBIDDEN');
select is((select count(*)::int from public.attention_dismissals), 0, 'attention_dismissals: el empleado no lee nada (RLS)');
select is(tests_0085.hint_of($$select * from public.reopen_attention('f8500000-0000-0000-0000-000000000000')$$), 'FORBIDDEN', 'reopen_attention: empleado FORBIDDEN');
select throws_ok(
  $$insert into public.attention_dismissals (kind, shift_id, dismissed_by) values ('uncovered', 'f8500000-0000-0000-0000-000000000035', 'f8500000-0000-0000-0000-0000000000a1')$$,
  '42501',
  null,
  'attention_dismissals: nadie escribe directo a la tabla'
);

select tests_0085.as_user('test-db0085-admin@example.com');
select is((select count(*)::int from public.attention_dismissals where shift_id in ('f8500000-0000-0000-0000-000000000031', 'f8500000-0000-0000-0000-000000000035')), 3, 'attention_dismissals: el admin lee los cierres (de todos)');
select is(
  (select assignment_id from public.reopen_attention((select id from public.attention_dismissals where kind = 'noRecord' and shift_id = 'f8500000-0000-0000-0000-000000000031'))),
  'f8500000-0000-0000-0000-000000000101'::uuid,
  'reopen_attention: devuelve la fila reabierta'
);
select is(
  (select count(*)::int from public.attention_dismissals where kind = 'noRecord' and shift_id = 'f8500000-0000-0000-0000-000000000031'),
  0,
  'reopen_attention: el cierre desaparece (el aviso vuelve a mostrarse)'
);
select is(tests_0085.hint_of($$select * from public.reopen_attention('f8500000-0000-0000-0000-000000000000')$$), 'DISMISSAL_NOT_FOUND', 'reopen_attention: cierre inexistente');

-- Limpieza de más de 30 días
select set_config('role', 'postgres', true);
insert into public.attention_dismissals (id, kind, shift_id, assignment_id, dismissed_by, dismissed_at) values
  ('f8500000-0000-0000-0000-0000000000e1', 'late', 'f8500000-0000-0000-0000-000000000033', 'f8500000-0000-0000-0000-000000000103', 'f8500000-0000-0000-0000-000000000082', '2000-01-01 10:00+00');
select ok(app.purge_attention_dismissals() >= 1, 'purge_attention_dismissals: borra los de más de 30 días');
select is(
  (select count(*)::int from public.attention_dismissals where id = 'f8500000-0000-0000-0000-0000000000e1'),
  0,
  'el cierre viejo ya no está'
);
select is(
  (select count(*)::int from public.attention_dismissals where shift_id = 'f8500000-0000-0000-0000-000000000035'),
  1,
  'los cierres recientes se conservan'
);

-- OG-05: observación del turno ------------------------------------------------------------------

select tests_0085.as_user('test-db0085-a1@example.com');
select is(
  (select shift_notes from public.v_my_day where assignment_id = 'f8500000-0000-0000-0000-000000000101'),
  'Traer las llaves de la oficina',
  'v_my_day: el empleado asignado ve la observación del turno (sin espacios de los bordes)'
);
select is(
  (select shift_notes from public.v_my_day where assignment_id = 'f8500000-0000-0000-0000-000000000103'),
  null,
  'v_my_day: observación en blanco llega como null'
);
select is(
  (select shift_notes from public.v_my_history where assignment_id = 'f8500000-0000-0000-0000-000000000102'),
  'Observación de ayer',
  'v_my_history: observación del turno'
);
select is(
  (select count(*)::int from public.v_my_day where shift_id = 'f8500000-0000-0000-0000-000000000034'),
  0,
  'v_my_day: no aparecen turnos donde no está asignado (ni su observación)'
);
select tests_0085.as_user('test-db0085-a2@example.com');
select is(
  (select count(*)::int from public.v_my_day where shift_id <> 'f8500000-0000-0000-0000-000000000031' and shift_notes is not null and shift_id::text like 'f8500000-%'),
  0,
  'v_my_day: otro empleado ve solo las notas de su propio turno'
);
select is(
  (select count(*)::int from public.v_my_history where assignment_id = 'f8500000-0000-0000-0000-000000000102'),
  0,
  'v_my_history: otro empleado no ve el historial ajeno'
);
select tests_0085.as_user('test-db0085-sup@example.com');
select is(
  (select shift_notes from public.v_my_supervisions where shift_id = 'f8500000-0000-0000-0000-000000000034'),
  'Nota del turno supervisado',
  'v_my_supervisions: el coordinador ve la observación del turno que supervisa'
);
select tests_0085.as_user('test-db0085-sup2@example.com');
select is(
  (select count(*)::int from public.v_my_supervisions),
  0,
  'v_my_supervisions: otro coordinador no ve ese turno'
);

-- Un cambio de shifts.notes mueve updated_at y enciende changed_since_last_seen (P-092).
select set_config('role', 'postgres', true);
-- sin sesión de la app: el trigger de profiles mira auth.uid()
select set_config('request.jwt.claims', '', true);
update public.profiles set last_seen_changes_at = date_trunc('day', now()) - interval '1 day'
  where id = 'f8500000-0000-0000-0000-0000000000a1';
update public.shifts set notes = 'Cambio de la oficina', updated_by = 'f8500000-0000-0000-0000-000000000082'
  where id = 'f8500000-0000-0000-0000-000000000031';
select ok(
  (select updated_at is not null from public.shifts where id = 'f8500000-0000-0000-0000-000000000031'),
  'cambiar shifts.notes mueve shifts.updated_at (trigger set_updated_at)'
);
select tests_0085.as_user('test-db0085-a1@example.com');
select ok(
  (select changed_since_last_seen from public.v_my_day where assignment_id = 'f8500000-0000-0000-0000-000000000101'),
  'v_my_day: el cambio de la observación enciende changed_since_last_seen'
);
select is(
  (select shift_notes from public.v_my_day where assignment_id = 'f8500000-0000-0000-0000-000000000101'),
  'Cambio de la oficina',
  'v_my_day: trae la observación nueva'
);

-- OG-01: mapa «Todos los clientes» -----------------------------------------------------------------

select tests_0085.as_user('test-db0085-admin@example.com');
select is(
  (select count(*)::int from public.map_active_sites() where client_id::text like 'f8500000-%'),
  1,
  'map_active_sites: solo la sede con ubicación de un cliente activo con servicio activo y vigente'
);
select is(
  (select site_id from public.map_active_sites() where client_id::text like 'f8500000-%'),
  'f8500000-0000-0000-0000-000000000011'::uuid,
  'map_active_sites: es la sede A1'
);
select is(
  (select client_calendar_color::int from public.map_active_sites() where client_id::text like 'f8500000-%'),
  3,
  'map_active_sites: trae el color de calendario del cliente'
);
select is(
  (select jsonb_array_length(services) from public.map_active_sites() where client_id::text like 'f8500000-%'),
  1,
  'map_active_sites: solo el servicio activo (no el pausado)'
);
select is(
  (select services -> 0 ->> 'name' from public.map_active_sites() where client_id::text like 'f8500000-%'),
  'Limpieza A1 mañana',
  'map_active_sites: nombre del servicio'
);
select is(
  (select services -> 0 -> 'weekdays' from public.map_active_sites() where client_id::text like 'f8500000-%'),
  '[1, 3]'::jsonb,
  'map_active_sites: días del servicio'
);
select is(
  (select services -> 0 ->> 'start_time' from public.map_active_sites() where client_id::text like 'f8500000-%'),
  '08:00:00',
  'map_active_sites: horario del servicio'
);
select tests_0085.as_user('test-db0085-owner@example.com');
select is((select count(*)::int from public.map_active_sites() where client_id::text like 'f8500000-%'), 1, 'map_active_sites: el dueño también');
select tests_0085.as_user('test-db0085-sup@example.com');
select is(tests_0085.hint_of($$select * from public.map_active_sites()$$), 'FORBIDDEN', 'map_active_sites: coordinador FORBIDDEN');
select tests_0085.as_user('test-db0085-a1@example.com');
select is(tests_0085.hint_of($$select * from public.map_active_sites()$$), 'FORBIDDEN', 'map_active_sites: empleado FORBIDDEN');

-- OG-12: datos del listado de Usuarios -----------------------------------------------------------

select tests_0085.as_user('test-db0085-owner@example.com');
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-000000000083'),
  'test-db0085-admin2@example.com',
  'admin_users_directory: el dueño ve el email de un administrador'
);
select is(
  (select dni from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a1'),
  '98508101',
  'admin_users_directory: DNI de la ficha laboral'
);
select ok(
  (select employee_number is not null from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a1'),
  'admin_users_directory: legajo de la ficha laboral'
);
select is(
  (select dni from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-000000000081'),
  null,
  'admin_users_directory: sin ficha laboral, dni null'
);

select tests_0085.as_user('test-db0085-admin@example.com');
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a1'),
  'test-db0085-a1@example.com',
  'admin con manage_users: ve el email de un empleado'
);
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-000000000081'),
  null,
  'admin con manage_users: no ve el email del dueño (CR-07)'
);
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-000000000083'),
  null,
  'admin con manage_users: no ve el email de otro administrador (CR-07)'
);
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-000000000082'),
  'test-db0085-admin@example.com',
  'admin con manage_users: ve el propio email'
);
select is(
  (select dni from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a2'),
  '98508102',
  'admin: ve el DNI de un empleado'
);

select tests_0085.as_user('test-db0085-admin2@example.com');
select is(
  (select email from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a1'),
  null,
  'admin sin manage_users: no ve ningún email'
);
select is(
  (select dni from public.admin_users_directory() where profile_id = 'f8500000-0000-0000-0000-0000000000a1'),
  '98508101',
  'admin sin manage_users: el DNI (dato laboral) sí'
);
select tests_0085.as_user('test-db0085-sup@example.com');
select is(tests_0085.hint_of($$select * from public.admin_users_directory()$$), 'FORBIDDEN', 'admin_users_directory: coordinador FORBIDDEN');
select tests_0085.as_user('test-db0085-a1@example.com');
select is(tests_0085.hint_of($$select * from public.admin_users_directory()$$), 'FORBIDDEN', 'admin_users_directory: empleado FORBIDDEN');

select * from finish();

rollback;
