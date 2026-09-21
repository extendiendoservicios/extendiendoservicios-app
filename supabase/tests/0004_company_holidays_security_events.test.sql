-- pgTAP de la migración 0004_company_holidays_security_events.sql (DB-006).
--
-- Cubre: estructura y restricciones de company_settings/holidays/security_events, RLS habilitada
-- (todavía sin políticas: llegan en 0012, DB-014), la fila única de company_settings (check
-- id = 1 más la primary key), la unicidad de holidays.holiday_date y app.log_security_event(...)
-- (inserta lo que corresponde y no es invocable directamente por authenticated).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- Estructura ----------------------------------------------------------------------------------

select has_table('public', 'company_settings', 'existe public.company_settings');
select has_table('public', 'holidays', 'existe public.holidays');
select has_table('public', 'security_events', 'existe public.security_events');

select columns_are(
  'public', 'company_settings',
  array['id', 'name', 'logo_path', 'support_phone', 'location_consent_text', 'updated_by', 'updated_at'],
  'company_settings tiene exactamente las columnas de 04 sección 2.6'
);

select columns_are(
  'public', 'holidays',
  array['id', 'holiday_date', 'name', 'created_at', 'updated_at', 'created_by', 'updated_by', 'deleted_at'],
  'holidays tiene exactamente las columnas de 04 sección 2.6'
);

select columns_are(
  'public', 'security_events',
  array['id', 'event_type', 'actor_id', 'target_id', 'details', 'ip', 'created_at'],
  'security_events tiene exactamente las columnas de 04 sección 2.6'
);

select col_is_pk('public', 'company_settings', array['id'], 'company_settings: PK (id)');
select has_pk('public', 'holidays', 'holidays tiene primary key');
select has_pk('public', 'security_events', 'security_events tiene primary key');

select col_not_null('public', 'company_settings', 'updated_at', 'company_settings.updated_at not null');
select col_default_is('public', 'company_settings', 'updated_at', 'now()', 'company_settings.updated_at default now()');

select col_not_null('public', 'security_events', 'event_type', 'security_events.event_type not null');
select col_not_null('public', 'security_events', 'created_at', 'security_events.created_at not null');
select col_default_is('public', 'security_events', 'created_at', 'now()', 'security_events.created_at default now()');

select has_index('public', 'security_events', 'security_events_created_at_idx', 'security_events: índice (created_at desc), 04 sección 8');
select has_index('public', 'security_events', 'security_events_actor_id_idx', 'security_events: índice (actor_id), 04 sección 8');

-- Triggers --------------------------------------------------------------------------------------

select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'company_settings' and t.tgname = 'trg_set_updated_at'
  ),
  'company_settings tiene el trigger trg_set_updated_at'
);
select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'holidays' and t.tgname = 'trg_set_updated_at'
  ),
  'holidays tiene el trigger trg_set_updated_at'
);

-- RLS habilitada (sin políticas todavía) -------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.company_settings'::regclass),
  'company_settings tiene RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.holidays'::regclass),
  'holidays tiene RLS habilitada'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.security_events'::regclass),
  'security_events tiene RLS habilitada'
);

-- company_settings: fila única (id = 1) ----------------------------------------------------------

select lives_ok(
  $$insert into public.company_settings (id, name) values (1, 'Extendiendo Servicios')$$,
  'permite crear la fila 1 de company_settings'
);

prepare cs_insert_wrong_id as
  insert into public.company_settings (id, name) values (2, 'Otra empresa');

select throws_ok(
  'cs_insert_wrong_id',
  '23514',
  null,
  'rechaza una fila de company_settings con id distinto de 1 (check id = 1)'
);

prepare cs_insert_second_row as
  insert into public.company_settings (id, name) values (1, 'Empresa duplicada');

select throws_ok(
  'cs_insert_second_row',
  '23505',
  null,
  'rechaza una segunda fila de company_settings con id = 1 (primary key)'
);

-- holidays: unicidad de holiday_date -------------------------------------------------------------

select lives_ok(
  $$insert into public.holidays (id, holiday_date, name)
    values ('c0000000-0000-0000-0000-000000000001', '2026-12-25', 'Navidad')$$,
  'permite crear un feriado'
);

prepare holiday_duplicate_date as
  insert into public.holidays (id, holiday_date, name)
  values ('c0000000-0000-0000-0000-000000000002', '2026-12-25', 'Otro feriado el mismo día');

select throws_ok(
  'holiday_duplicate_date',
  '23505',
  null,
  'rechaza dos feriados con la misma fecha'
);

select lives_ok(
  $$insert into public.holidays (id, holiday_date, name)
    values ('c0000000-0000-0000-0000-000000000003', '2027-01-01', 'Año nuevo')$$,
  'permite feriados con fechas distintas'
);

-- app.log_security_event(...) --------------------------------------------------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000010', 'test-db006-actor@example.com', jsonb_build_object('first_name', 'Actor', 'last_name', 'Uno')),
  ('c0000000-0000-0000-0000-000000000011', 'test-db006-target@example.com', jsonb_build_object('first_name', 'Blanco', 'last_name', 'Dos'));

select is(
  (
    select (app.log_security_event(
      'roles_changed',
      'c0000000-0000-0000-0000-000000000010',
      'c0000000-0000-0000-0000-000000000011',
      jsonb_build_object('roles', array['supervisor']),
      '127.0.0.1'::inet
    )).event_type::text
  ),
  'roles_changed',
  'log_security_event: la fila devuelta trae el event_type indicado'
);

select is(
  (
    select count(*)::int from public.security_events
    where event_type = 'roles_changed'
      and actor_id = 'c0000000-0000-0000-0000-000000000010'
      and target_id = 'c0000000-0000-0000-0000-000000000011'
      and details = jsonb_build_object('roles', array['supervisor'])
      and ip = '127.0.0.1'::inet
  ),
  1,
  'log_security_event: insertó exactamente una fila con los datos indicados'
);

select ok(
  (
    select created_at is not null from public.security_events
    where actor_id = 'c0000000-0000-0000-0000-000000000010'
  ),
  'log_security_event: created_at queda con now(), no nulo'
);

-- authenticated no puede ejecutar log_security_event directamente (uso interno, ver comentario
-- de la migración) --------------------------------------------------------------------------------

set local role authenticated;

prepare log_event_as_authenticated as
  select app.log_security_event('sign_in', 'c0000000-0000-0000-0000-000000000010');

select throws_ok(
  'log_event_as_authenticated',
  '42501',
  null,
  'authenticated no puede ejecutar app.log_security_event directamente'
);

-- RLS habilitada + políticas de 0012 (DB-014, agregadas en P04.5): company_settings y holidays
-- son de lectura para "todos los autenticados" (04 sección 7.2), así que authenticated ahora SÍ
-- ve las filas que este archivo creó arriba (1 de company_settings, 2 de holidays -- Navidad y
-- Año Nuevo, ninguna dada de baja lógica). security_events sigue en 0 porque esa política es
-- solo para el rol owner (04 sección 7.2: "O.") y esta sesión de authenticated no tiene ningún
-- rol en el JWT (set local role authenticated puro, sin tests.as_user). El detalle de "quién ve
-- qué según su rol" para estas tres tablas está en
-- supabase/tests/0012_rls_policies_supervisions_ratings_settings.test.sql (DB-014).
select is(
  (select count(*)::int from public.company_settings),
  1,
  'company_settings: con las políticas de 0012, authenticated ve la fila (04 sección 7.2: "todos los autenticados")'
);
select is(
  (select count(*)::int from public.holidays),
  2,
  'holidays: con las políticas de 0012, authenticated ve los dos feriados vigentes (04 sección 7.2: "todos los autenticados")'
);
select is(
  (select count(*)::int from public.security_events),
  0,
  'security_events: sigue en 0 -- la política de 0012 es solo para el rol owner (04 sección 7.2: "O."), esta sesión no tiene ningún rol'
);

select * from finish();

rollback;
