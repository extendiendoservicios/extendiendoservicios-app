-- pgTAP de la migración 0018_performance_shifts_board.sql (DB-024): confirma que el índice nuevo
-- existe y que, a diferencia de `assignments_shift_id_idx` (0007, parcial), NO tiene predicado --
-- tiene que cubrir todas las asignaciones de un turno, vigentes o quitadas, para la subconsulta
-- lateral de conteos de `v_shifts_board` (0011). Ver el comentario de la migración y
-- docs/database.md ("Rendimiento (DB-024)") para el `explain` completo que motivó el hallazgo.
--
-- Convención (ver supabase/tests/README.md): todo el archivo corre en una transacción que
-- termina en `rollback`. Sin fixtures: solo consulta el catálogo, no crea ni borra filas.

begin;

set local role postgres;
set local search_path = public, extensions, app, pg_temp;

create extension if not exists pgtap with schema extensions;

select plan(3);

select has_index('public', 'assignments', 'assignments_shift_id_all_idx', 'assignments.shift_id, sin predicado (DB-024)');

select isnt(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'assignments_shift_id_all_idx'),
  null,
  'assignments_shift_id_all_idx tiene definición en pg_indexes'
);

select ok(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'assignments_shift_id_all_idx') not ilike '%where%',
  'assignments_shift_id_all_idx no es parcial (sin WHERE) -- a diferencia de assignments_shift_id_idx (0007), que sí lo es'
);

select * from finish();

rollback;
