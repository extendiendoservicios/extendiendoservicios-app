-- DB-024 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Único índice nuevo que salió de la revisión de rendimiento de DB-024 (`explain (analyze,
-- buffers)` sobre las vistas del tablero, con un seed ampliado a ~4600 turnos -- un año hacia
-- atrás además del mes actual y el siguiente que carga `supabase/seed.sql`, detalle completo en
-- docs/database.md sección "Rendimiento (DB-024)"). Las demás vistas revisadas (v_assignments_board,
-- v_my_day, v_supervisions_admin, v_clients) ya usaban los índices de 04 sección 8 sin `Seq Scan`
-- sobre tablas grandes; no hizo falta tocar nada ahí.
--
-- Hallazgo: `v_shifts_board` (0011_views.sql) calcula `assigned_count`/`present_count`/
-- `finished_count`/`absent_count`/`delayed_count` con una subconsulta lateral
-- `... from public.assignments a where a.shift_id = sh.id` y filtra por estado **dentro** de cada
-- `count(*) filter (where ...)`, no en el `where` de la subconsulta -- necesita ver TODAS las
-- asignaciones del turno (vigentes y quitadas) para contarlas por columna. El único índice que ya
-- existía sobre `assignments.shift_id` (`assignments_shift_id_idx`, 0007) es **parcial**
-- (`where removed_at is null`): sirve para "asignaciones vigentes de este turno" (04 sección 8),
-- pero Postgres no puede usarlo acá porque la condición del índice excluye filas que la
-- subconsulta sí necesita leer. Con ~2900 asignaciones cargadas, esto se veía como
-- `Seq Scan on assignments ... Rows Removed by Filter: 2894`, repetido una vez por cada turno del
-- resultado (`loops=9`, `loops=20` en los dos casos probados) -- crece linealmente con el volumen
-- total de `assignments`, no con el tamaño del resultado: es justo el patrón que un año de datos
-- deja ver y un seed chico no.
create index assignments_shift_id_all_idx on public.assignments (shift_id);

comment on index public.assignments_shift_id_all_idx is
  'DB-024: cubre la subconsulta lateral de v_shifts_board (0011), que necesita todas las asignaciones de un turno (vigentes y quitadas) para contarlas por estado. Complementa a assignments_shift_id_idx (0007, parcial, solo vigentes -- sigue siendo el mejor índice para "asignaciones vigentes de este turno"), no lo reemplaza.';

-- Verificado en App_dev, mismo volumen que motivó el hallazgo (~4600 shifts, ~2900 assignments):
-- el plan de v_shifts_board pasa de `Seq Scan on assignments` (buffers ~500-1000 por consulta) a
-- `Index Scan using assignments_shift_id_all_idx` (buffers de un solo dígito por turno). Detalle
-- completo (los dos `explain` antes/después) en docs/database.md.
