-- pgTAP de la migración 0001_extensions_and_schema_app.sql (DB-001, TEST-001).
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`, así ninguna corrida deja cambios en App_dev (que también sirve de
-- staging). La extensión pgtap se crea (si hace falta) dentro de esta misma transacción: no va
-- en una migración porque las migraciones también llegan a producción.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Extensión, esquema y funciones existen -------------------------------------------------

select has_extension('btree_gist', 'la extensión btree_gist está instalada');

select has_schema('app', 'existe el esquema app');

select has_function('app', 'set_updated_at', array[]::text[], 'existe app.set_updated_at()');

select has_function(
  'app', 'local_ts', array['date', 'time'],
  'existe app.local_ts(date, time)'
);

select has_function(
  'app', 'valid_weekdays', array['smallint[]'],
  'existe app.valid_weekdays(smallint[])'
);

-- app.local_ts: mismo desplazamiento (-03:00) en verano y en invierno, sin horario de verano
-- (ADR-019: Argentina no tiene horario de verano desde 2009) -----------------------------

select is(
  app.local_ts('2026-01-15'::date, '10:00'::time),
  '2026-01-15 13:00:00+00'::timestamptz,
  'local_ts en verano (enero): 10:00 ART = 13:00 UTC'
);

select is(
  app.local_ts('2026-07-15'::date, '10:00'::time),
  '2026-07-15 13:00:00+00'::timestamptz,
  'local_ts en invierno (julio): 10:00 ART = 13:00 UTC (mismo desplazamiento, sin horario de verano)'
);

-- app.valid_weekdays: valores límite ------------------------------------------------------

select ok(
  app.valid_weekdays(array[0, 6]::smallint[]),
  'valid_weekdays: {0,6} (domingo y sábado) es válido'
);

select ok(
  app.valid_weekdays(array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  'valid_weekdays: la semana completa es válida'
);

select ok(
  app.valid_weekdays(array[3]::smallint[]),
  'valid_weekdays: un solo día es válido'
);

select ok(
  not app.valid_weekdays(array[]::smallint[]),
  'valid_weekdays: el arreglo vacío no es válido'
);

select ok(
  not app.valid_weekdays(null::smallint[]),
  'valid_weekdays: null no es válido'
);

select ok(
  not app.valid_weekdays(array[1, 1]::smallint[]),
  'valid_weekdays: no admite valores repetidos'
);

select ok(
  not app.valid_weekdays(array[-1]::smallint[]),
  'valid_weekdays: rechaza valores negativos'
);

select ok(
  not app.valid_weekdays(array[7]::smallint[]),
  'valid_weekdays: rechaza valores mayores a 6'
);

-- app.set_updated_at: trigger sobre una tabla temporal ------------------------------------

create temporary table tap_set_updated_at_demo (
  id serial primary key,
  note text,
  updated_at timestamptz not null default now()
) on commit drop;

create trigger trg_set_updated_at
before update on tap_set_updated_at_demo
for each row execute function app.set_updated_at();

insert into tap_set_updated_at_demo (note, updated_at) values ('inicial', '2000-01-01T00:00:00Z');

update tap_set_updated_at_demo set note = 'modificado' where note = 'inicial';

select ok(
  (select updated_at from tap_set_updated_at_demo where note = 'modificado') > '2000-01-01T00:00:00Z'::timestamptz,
  'app.set_updated_at actualiza updated_at en cada UPDATE'
);

select * from finish();

rollback;
