-- pgTAP de la migración 0023_rpc_shifts.sql: generate_shifts (SHIFT-002, SHIFT-006, 04 sección 9,
-- 06 sección 6, P-044, ADR-010). Archivo separado de 0023_rpc_shifts.test.sql por tamaño (fixtures
-- de un mes completo, ver supabase/tests/README.md).
--
-- Cubre: idempotencia (segunda corrida no crea nada), respeto de weekdays y vigencia, feriado con
-- works_on_holidays = false (no genera; con true, sí), servicio pausado no genera, cliente
-- suspendido no genera, sede inactiva no genera, un turno existente modificado no se toca, copia
-- del checklist, permisos (owner, admin con/sin generate_shifts, supervisor, empleado).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Prefijo de fixtures propio de este archivo: 'e2301000-...'. Mes de
-- prueba: 2199-03 (marzo de 2199, fuera del rango real de uso). 2199-03-01 es lunes (mismo
-- calendario que 2021-03-01, año no bisiesto con el mismo día de la semana para el 1º de marzo);
-- se verifica con `extract(dow from date '2199-03-01')` más abajo, sin asumirlo a ciegas.

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

select plan(17);

select has_function('public', 'generate_shifts', array['int', 'int'], 'existe public.generate_shifts(int, int)');

-- ---------------------------------------------------------------------------------------------
-- Fixtures: un cliente activo con dos sedes (una activa, una inactiva), un cliente suspendido;
-- servicios: A (activo, lunes y miércoles, sin feriados=trabaja igual, con plantilla),
-- B (activo, todos los días, works_on_holidays = false, para el feriado del mes),
-- C (pausado, no debe generar nada), D (en la sede inactiva, no debe generar nada),
-- E (en el cliente suspendido, no debe generar nada), F (vigencia que no cubre marzo 2199).
-- ---------------------------------------------------------------------------------------------

insert into public.clients (id, legal_name, status) values
  ('e2301000-0000-0000-0000-000000000001', 'Cliente activo de generación', 'active'),
  ('e2301000-0000-0000-0000-000000000002', 'Cliente suspendido de generación', 'suspended');

insert into public.sites (id, client_id, name, address, status) values
  ('e2301000-0000-0000-0000-000000000011', 'e2301000-0000-0000-0000-000000000001', 'Sede activa', 'Dirección 1', 'active'),
  ('e2301000-0000-0000-0000-000000000012', 'e2301000-0000-0000-0000-000000000001', 'Sede inactiva', 'Dirección 2', 'inactive'),
  ('e2301000-0000-0000-0000-000000000013', 'e2301000-0000-0000-0000-000000000002', 'Sede del cliente suspendido', 'Dirección 3', 'active');

insert into public.checklist_templates (id, client_id, site_id, name) values
  ('e2301000-0000-0000-0000-000000000021', 'e2301000-0000-0000-0000-000000000001', null, 'Plantilla del cliente de generación');
insert into public.checklist_template_items (template_id, position, title) values
  ('e2301000-0000-0000-0000-000000000021', 1, 'Ítem único');

insert into public.holidays (holiday_date, name) values ('2199-03-11', 'Feriado de prueba de generación');

-- Servicio A: lunes (1) y miércoles (3), vigente todo marzo 2199, works_on_holidays true (default).
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, status) values
  ('e2301000-0000-0000-0000-000000000031', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000011', 'Servicio A (lun/mié)', array[1, 3]::smallint[], '08:00', '12:00', '2199-01-01', 'active');

-- Servicio B: todos los días, works_on_holidays = false -- no genera el 2199-03-11.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, works_on_holidays, status) values
  ('e2301000-0000-0000-0000-000000000032', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000011', 'Servicio B (todos, sin feriados)', array[0, 1, 2, 3, 4, 5, 6]::smallint[], '14:00', '18:00', '2199-01-01', false, 'active');

-- Servicio C: pausado -- no genera nada.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, status) values
  ('e2301000-0000-0000-0000-000000000033', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000011', 'Servicio C (pausado)', array[1]::smallint[], '08:00', '12:00', '2199-01-01', 'paused');

-- Servicio D: en la sede inactiva -- no genera nada.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, status) values
  ('e2301000-0000-0000-0000-000000000034', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000012', 'Servicio D (sede inactiva)', array[1]::smallint[], '08:00', '12:00', '2199-01-01', 'active');

-- Servicio E: en el cliente suspendido -- no genera nada.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, status) values
  ('e2301000-0000-0000-0000-000000000035', 'e2301000-0000-0000-0000-000000000002', 'e2301000-0000-0000-0000-000000000013', 'Servicio E (cliente suspendido)', array[1]::smallint[], '08:00', '12:00', '2199-01-01', 'active');

-- Servicio F: vigencia que termina antes de marzo 2199 -- no genera nada.
insert into public.services (id, client_id, site_id, name, weekdays, start_time, end_time, valid_from, valid_to, status) values
  ('e2301000-0000-0000-0000-000000000036', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000011', 'Servicio F (vigencia vencida)', array[1]::smallint[], '08:00', '12:00', '2199-01-01', '2199-02-28', 'active');

insert into auth.users (id, email, raw_user_meta_data) values
  ('e2301000-0000-0000-0000-000000000081', 'test-db023gen-owner@example.com', jsonb_build_object('first_name', 'Owner', 'last_name', 'Genera')),
  ('e2301000-0000-0000-0000-000000000082', 'test-db023gen-admin-con-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'ConCap')),
  ('e2301000-0000-0000-0000-000000000083', 'test-db023gen-admin-sin-cap@example.com', jsonb_build_object('first_name', 'Admin', 'last_name', 'SinCap')),
  ('e2301000-0000-0000-0000-000000000084', 'test-db023gen-supervisora@example.com', jsonb_build_object('first_name', 'Super', 'last_name', 'Visora')),
  ('e2301000-0000-0000-0000-000000000085', 'test-db023gen-empleado@example.com', jsonb_build_object('first_name', 'Emp', 'last_name', 'Leado'));

insert into public.user_roles (profile_id, role) values
  ('e2301000-0000-0000-0000-000000000081', 'owner'),
  ('e2301000-0000-0000-0000-000000000082', 'admin'),
  ('e2301000-0000-0000-0000-000000000083', 'admin'),
  ('e2301000-0000-0000-0000-000000000084', 'supervisor'),
  ('e2301000-0000-0000-0000-000000000085', 'employee');

insert into public.admin_capabilities (profile_id, capability, enabled) values
  ('e2301000-0000-0000-0000-000000000082', 'generate_shifts', true),
  ('e2301000-0000-0000-0000-000000000083', 'generate_shifts', false);

insert into public.employees (profile_id, dni) values
  ('e2301000-0000-0000-0000-000000000084', '92301084'),
  ('e2301000-0000-0000-0000-000000000085', '92301085');

-- Un turno YA EXISTENTE del servicio A, el lunes 2199-03-04, que el administrador ya modificó a
-- mano (franja distinta a la del servicio): generate_shifts NO lo tiene que tocar (P-044).
insert into public.shifts (id, service_id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, generated) values
  ('e2301000-0000-0000-0000-000000000041', 'e2301000-0000-0000-0000-000000000031', 'e2301000-0000-0000-0000-000000000001', 'e2301000-0000-0000-0000-000000000011', '2199-03-04', '09:30', '12:30', 3, 'scheduled', false);

-- ---------------------------------------------------------------------------------------------
-- Permisos --------------------------------------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db023gen-supervisora@example.com');

prepare generate_as_supervisor as select public.generate_shifts(2199, 3);

select throws_ok(
  'generate_as_supervisor', 'P0001', 'No tenés permiso para hacer esto.',
  'generate_shifts: un supervisor no puede llamarla (FORBIDDEN)'
);

select tests.as_user('test-db023gen-empleado@example.com');

prepare generate_as_employee as select public.generate_shifts(2199, 3);

select throws_ok(
  'generate_as_employee', 'P0001', 'No tenés permiso para hacer esto.',
  'generate_shifts: un empleado no puede llamarla (FORBIDDEN)'
);

select tests.as_user('test-db023gen-admin-sin-cap@example.com');

prepare generate_as_admin_no_cap as select public.generate_shifts(2199, 3);

select throws_ok(
  'generate_as_admin_no_cap', 'P0001', 'No tenés permiso para hacer esto.',
  'generate_shifts: admin sin generate_shifts no puede llamarla (FORBIDDEN)'
);

set local role postgres;

-- ---------------------------------------------------------------------------------------------
-- Primera corrida (admin CON generate_shifts) ------------------------------------------------------
-- ---------------------------------------------------------------------------------------------

-- Verificación del supuesto del calendario, sin asumirlo a ciegas (ver comentario del encabezado):
-- cuántos lunes y miércoles hay en marzo de 2199, para calcular el resultado esperado del
-- servicio A sin depender de un número fijo que dependa del día de la semana del 1º de marzo.
select is(
  (
    select count(*)::int from generate_series('2199-03-01'::date, '2199-03-31'::date, interval '1 day') d
    where extract(dow from d)::smallint in (1, 3)
  ),
  8,
  'marzo de 2199 tiene 8 días lunes/miércoles (verificado con generate_series, no asumido)'
);

-- `generate_shifts` opera sobre TODOS los servicios activos del sistema para el mes pedido (06
-- sección 6: sin filtro por cliente), y App_dev tiene datos reales de uso (12_Registro_de_Progreso.md,
-- sección "Pendiente"): puede haber servicios reales, vigentes sin `valid_to`, que también generen
-- turnos para 2199-03 (mes muy futuro pero sin límite de horizonte, P-054). Por eso las siguientes
-- aserciones NO fijan los totales exactos de `created`/`skipped`/`holidays_skipped` del sistema
-- completo: verifican (a) que el mínimo esperado de las fixtures de este archivo está incluido, y
-- (b) la consistencia interna del contador `created` contra el conteo real de filas nuevas en
-- `shifts` para el mes, sin depender de cuántos servicios reales existan. Los conteos POR
-- SERVICIO (más abajo, filtrados por `service_id` de esta fixture) sí son exactos: no dependen de
-- ningún dato ajeno a este archivo.
create temporary table tests_e2301000_before on commit drop as
  select count(*)::int as n from public.shifts where shift_date between '2199-03-01' and '2199-03-31' and deleted_at is null;

select tests.as_user('test-db023gen-admin-con-cap@example.com');

-- Servicio A: 8 días lunes/miércoles, uno ya existe (2199-03-04, modificado a mano) -> 7 creados,
-- 1 omitido (skipped). Servicio B: 31 días, works_on_holidays = false, 1 feriado (2199-03-11)
-- -> 30 creados, 1 en holidays_skipped. Mínimo esperado de esta fixture: created >= 37.
create temporary table tests_e2301000_run1 on commit drop as
  select public.generate_shifts(2199, 3) as result;

set local role postgres;

select cmp_ok(
  (select (result ->> 'created')::int from tests_e2301000_run1), '>=', 37,
  'generate_shifts: primera corrida crea al menos los 37 turnos esperados de las fixtures de este archivo (servicio A: 7 nuevos + 1 existente respetado; servicio B: 30 de 31, 1 feriado; puede haber más si hay servicios reales del sistema vigentes para ese mes)'
);

select is(
  (select count(*)::int from public.shifts where shift_date between '2199-03-01' and '2199-03-31' and deleted_at is null)
    - (select n from tests_e2301000_before),
  (select (result ->> 'created')::int from tests_e2301000_run1),
  'generate_shifts: el total de turnos nuevos del mes coincide exactamente con "created" devuelto (consistencia interna, sin depender de cuántos servicios reales del sistema caigan en 2199-03)'
);

select is(
  (select count(*)::int from public.shifts where service_id = 'e2301000-0000-0000-0000-000000000031' and deleted_at is null),
  8,
  'generate_shifts: servicio A termina con 8 turnos en total (7 nuevos + el que ya existía)'
);

select is(
  (select count(*)::int from public.shifts where service_id = 'e2301000-0000-0000-0000-000000000032' and deleted_at is null),
  30,
  'generate_shifts: servicio B genera 30 de 31 días (works_on_holidays = false se salta el feriado)'
);

select is(
  (select count(*)::int from public.shifts where service_id in (
    'e2301000-0000-0000-0000-000000000033', 'e2301000-0000-0000-0000-000000000034',
    'e2301000-0000-0000-0000-000000000035', 'e2301000-0000-0000-0000-000000000036'
  )),
  0,
  'generate_shifts: servicio pausado, sede inactiva, cliente suspendido y vigencia vencida no generan nada'
);

-- El turno modificado a mano sigue exactamente igual (P-044: "nunca toca un turno existente").
select is(
  (select row(start_time, end_time, required_staff, status)::text from public.shifts where id = 'e2301000-0000-0000-0000-000000000041'),
  (select row(time '09:30', time '12:30', 3::smallint, 'scheduled'::public.shift_status)::text),
  'generate_shifts: el turno existente modificado a mano no se tocó'
);

select is(
  (select generated from public.shifts where id = 'e2301000-0000-0000-0000-000000000041'),
  false,
  'generate_shifts: el turno existente sigue con generated = false (nunca lo pisó)'
);

-- Los turnos nuevos nacen generated = true.
select ok(
  (select bool_and(generated) from public.shifts where service_id = 'e2301000-0000-0000-0000-000000000032'),
  'generate_shifts: los turnos del servicio B nacen con generated = true'
);

-- Copia el checklist vigente (plantilla del cliente, sin plantilla de sede en este fixture).
select ok(
  (
    select bool_and(checklist_template_id = 'e2301000-0000-0000-0000-000000000021')
    from public.shifts
    where service_id = 'e2301000-0000-0000-0000-000000000032'
  ),
  'generate_shifts: copia la plantilla vigente del cliente en cada turno creado'
);

select is(
  (
    select count(*)::int
    from public.shift_tasks st
    join public.shifts sh on sh.id = st.shift_id
    where sh.service_id = 'e2301000-0000-0000-0000-000000000032'
  ),
  30,
  'generate_shifts: cada turno creado tiene exactamente el ítem de la plantilla copiado'
);

-- ---------------------------------------------------------------------------------------------
-- Segunda corrida: idempotente -- no crea nada -----------------------------------------------------
-- ---------------------------------------------------------------------------------------------

select tests.as_user('test-db023gen-owner@example.com');

-- Esta aserción SÍ es exacta e independiente de los datos reales del sistema: una corrida
-- inmediatamente después de otra siempre tiene que crear cero turnos (idempotencia, P-044,
-- ADR-010), sin importar cuántos servicios reales existan.
select is(
  public.generate_shifts(2199, 3) ->> 'created',
  '0',
  'generate_shifts: segunda corrida no crea nada (created = 0), sin importar cuántos servicios reales del sistema hayan generado en la primera corrida'
);

set local role postgres;

select is(
  (select count(*)::int from public.shifts where service_id in (
    'e2301000-0000-0000-0000-000000000031', 'e2301000-0000-0000-0000-000000000032'
  ) and deleted_at is null),
  38,
  'generate_shifts: la segunda corrida no duplicó ningún turno de esta fixture (siguen siendo 8 + 30)'
);

select * from finish();

rollback;
