# Planificación y asignaciones (F11 · P11.2)

`08_Fases_y_Backlog.md` F11 "Asignaciones y cronograma". Este paquete
(P11.2, ASSIGN-007 a ASSIGN-010) construye la capa de datos de asignaciones
y las tres vistas de solo lectura del cronograma: calendario mensual
(ADM-03), grilla semanal por empleado (ADM-04) y la versión completa de la
lista del día (ADM-05, que ya tenía una versión mínima desde P10.3, ver
`docs/features/servicios-y-turnos.md`). El detalle del turno (ADM-06) y el
drawer "Asignar empleado" (ADM-08) son de P11.3: acá se dejan la API, los
esquemas y los hooks de las cuatro RPC de asignaciones, listos para que esas
pantallas los usen.

La base es P11.1 (`supabase/migrations/0024_rpc_assignments.sql`, todavía en
el PR #63 sin fusionar al momento de este paquete): las cuatro RPC
(`assign_employee`, `remove_assignment`, `update_assignment_time`,
`update_shift_details`) ya están aplicadas en `App_dev`.

## `src/api/assignments.ts` (ASSIGN-007)

Ver `docs/api.md` sección "assignments" para la tabla completa de
funciones. Dos decisiones a destacar:

- **`mapShiftBoardRow`/`ShiftBoardRow`/`SHIFT_BOARD_SELECT` se exportan
  desde `src/api/shifts.ts`** en vez de duplicarse: `fetchShiftsBoardByRange`
  arma el mismo `ShiftListRow` que `fetchShiftsByDate` (ADM-05 mínima),
  único lugar donde se traduce `v_shifts_board`.
- **El filtro "empleado" del calendario mensual (ADM-03) resuelve en dos
  pasos**: primero busca los `shift_id` con una asignación vigente de ese
  empleado en el rango (`from('assignments')`), después filtra
  `v_shifts_board` con `.in('id', ...)`. La vista no tiene una columna de
  empleado propia (es una vista de turnos, no de asignaciones), así que no
  hay una forma de hacerlo en una sola consulta.

## `src/features/planning/` (Calendar y WeekGrid, `11_Desglose_de_Tareas.md`

fila "Calendar mensual y WeekGrid")

- `schemas.ts`: `assignmentTimeSchema` (franja propia opcional, P-046),
  `assignEmployeeSchema` y `shiftDetailsSchema` -- repiten las restricciones
  de `0024_rpc_assignments.sql`, sin pantalla propia todavía (P11.3 las usa
  desde ADM-06/ADM-08).
- `planningDates.ts`: fechas del calendario mensual y la grilla semanal, sin
  React (`buildMonthGridDays`, `startOfWeekIso`, `weekDaysIso`,
  `addWeeksToIsoDate`, `addMonthsToYearMonth`, `monthRange`) -- mismo
  criterio "sin pasar por UTC" que `src/features/settings/dateOnly.ts`.
- `grouping.ts`: `groupShiftsByDate` (ADM-03), `groupAssignmentsByEmployeeAndDate`
  (ADM-04) y `shiftChipLabel`. El agrupado por franja de ADM-05
  (`groupShiftsByFranja`) vive en `src/features/shifts/grouping.ts`, no acá:
  la lista del día ya vivía en `features/shifts` desde P10.3, y la fila de
  ambigüedades de `11_Desglose_de_Tareas.md` solo asigna el calendario y la
  grilla a `features/planning`.
- `queries.ts`: `useShiftsBoardRangeQuery`/`useAssignmentsBoardRangeQuery`
  (`planningKeys`, `staleTime` 60 s, sin polling: ni el mes ni la semana
  están en la lista de pantallas con polling de `02_Decisiones.md` P-005) y
  las cuatro mutaciones (`useAssignEmployeeMutation`,
  `useRemoveAssignmentMutation`, `useUpdateAssignmentTimeMutation`,
  `useUpdateShiftDetailsMutation`), que invalidan tanto `planningKeys.all`
  como `shiftsKeys.all` (una asignación cambia `assigned_count`/
  `display_status` de `v_shifts_board`, que también lee ADM-05 mínima).
- `components/MonthCalendar.tsx` (ADM-03) y `components/WeekGrid.tsx`
  (ADM-04): ver más abajo.

## ADM-03 · Planificación · mes (`MonthCalendar`, ASSIGN-008)

Calendario de 7 columnas (lunes a domingo) con semanas completas
(`buildMonthGridDays` agrega los días de los meses vecinos, atenuados, para
completar la grilla). Por cada día: número, marca "Feriado" (`useHolidaysQuery`,
ya existía para ADM-29), contador de turnos y hasta 3 chips (cliente · sede
· franja, con `StatusBadge` del `display_status` mostrado -- "Sin cubrir" en
rojo, `04_Modelo_de_Datos.md` sección 4). Filtros: cliente, sede, empleado y
estado (`Combobox`/`Select`, reutilizando `useClientFilterOptionsQuery` y
`useSitesMapQuery` de `features/sites` y `useEmployeesQuery` de
`features/employees`). Selector de mes (`MonthPicker`, sin límite de
horizonte, P-054) y botones "Nuevo turno"/"Generar turnos del mes"
(visibles según `canManageShiftTime`/`canGenerateShifts`, ya definidos en
`features/shifts/permissions.ts`). Clic en un día navega a ADM-05 con esa
fecha (`onOpenDay`, resuelto por `PlanningPage`).

**Máximo 3 chips por día, con "+n más"** (decisión propia, no está en `05`):
un mes con 600 turnos reparte en promedio 20 por día -- mostrarlos todos en
la grilla no aporta nada que la lista del día (a un clic) no muestre mejor,
y arruinaría el criterio de rendimiento de F11 ("mes con 600 turnos en menos
de 1 s tras la carga"). El agrupado (`groupShiftsByDate`) y la grilla de
días (`buildMonthGridDays`) son funciones puras memoizadas con `useMemo`,
sin recalcularse en cada chip.

Debajo de 1024 px (`05` sección 7: "Calendario mensual → lista de días con
conteo"): se reemplaza la grilla por una lista vertical de los días del mes,
cada uno con su conteo de turnos.

## ADM-04 · Planificación · semana por empleado (`WeekGrid`, ASSIGN-009)

Tabla empleados (filas) × 7 días (columnas), sobre `v_assignments_board`
entre el lunes y el domingo de la semana elegida
(`useAssignmentsBoardRangeQuery`, agrupada con
`groupAssignmentsByEmployeeAndDate`). Cada celda muestra una tarjeta por
asignación (sede y franja efectiva -- la propia si la tiene, si no la del
turno, `effective_start_time`/`effective_end_time` de la vista) o "Libre" si
no hay ninguna. Los empleados de licencia (`effectiveStatus === 'on_leave'`)
se muestran atenuados (`opacity-50`) con la etiqueta "(de licencia)".
Filtros: cliente, sede y texto (busca por nombre/DNI/legajo, reutilizando
`useEmployeesQuery`). Semana anterior/siguiente y "Esta semana". Sin
arrastre (P-055, módulo G): cada tarjeta es un botón que navega directo al
turno (`onOpenShift`, `/admin/turnos/:id`, ADM-06 -- placeholder hasta
P11.3).

Debajo de 1024 px (`05` sección 7: "Grilla semanal → un empleado por vez con
selector"): un `Combobox` para elegir el empleado y una lista vertical de
sus 7 días.

**Falta de columna en `v_assignments_board`** (reportado al orquestador):
la vista no trae `client_trade_name` (solo `client_legal_name`), a
diferencia de `v_shifts_board`. La grilla muestra la razón social en la
tarjeta de asignación en vez del nombre de fantasía.

## ADM-05 · Planificación · día, completa (ASSIGN-010)

Se extiende `ShiftsDayList` (`src/features/shifts/components/`, ya existía
desde P10.3): ahora agrupa los turnos por franja
(`groupShiftsByFranja`/`shiftFranjaKey`, `features/shifts/grouping.ts`), con
un `DataTable` por franja y un encabezado "Franja HH:MM–HH:MM" arriba de
cada uno (`05` línea 39: "agrupados por franja"). Se agrega la acción "Ver"
en cada fila, que navega a `/admin/turnos/:id` (ADM-06 -- placeholder hasta
P11.3, la ruta ya existía en `adminRoutes.tsx`). Sigue sin filtros de
cliente/sede/estado: `05` línea 39 no los pide para ADM-05 (a diferencia de
ADM-03 y ADM-04), solo fecha navegable. El polling de 30 s cuando la fecha
es hoy y "Actualizado hace n s" (`UpdatedAgo`) no cambiaron.

## Navegación entre las tres vistas (`PlanningPage`)

`src/pages/admin/PlanningPage.tsx` agrega un `SegmentedControl` ("Mes" /
"Semana" / "Día") arriba de las tres vistas, sobre `?vista=mes|semana|dia`
(`05_Pantallas_y_Navegacion.md` sección 5). Decisión propia (no está en
`05`, que solo dice a dónde navega cada pantalla, no cómo se ve el
selector): sin él, no había una forma visible de volver de ADM-04/ADM-05 a
ADM-03 sin editar la URL a mano.

## Decisiones tomadas en P11.2

- **Los filtros de ADM-03 y ADM-04 son estado local del componente, no
  parte de la URL**: `05` sección 5 solo documenta `?vista=` y `?fecha=`
  para esta ruta, ninguno para cliente/sede/empleado/estado/texto. Mantener
  esos filtros fuera de la URL evita inventar parámetros que `05` no pide.
- **Año y mes del calendario también quedan en estado local** (no en la
  URL): mismo criterio que el punto anterior.
- **`update_shift_details` se envolvió en `src/api/assignments.ts`, no en
  `src/api/shifts.ts`**, tal como pide el encargo ("las mutaciones
  `assign_employee`, `remove_assignment`, `update_assignment_time`,
  `update_shift_details`"), aunque conceptualmente sea una operación sobre
  `shifts`: el encargo la agrupó con las otras tres RPC de asignaciones de
  `0024_rpc_assignments.sql`.
- **`shiftFranjaKey`/`groupShiftsByFranja` viven en `features/shifts`, no en
  `features/planning`**: la lista del día ya vivía en `features/shifts`
  desde P10.3 y la fila de ambigüedades de `11_Desglose_de_Tareas.md` solo
  asigna el calendario y la grilla a `features/planning` -- mover `ShiftsDayList`
  entero hubiera sido un cambio más grande de lo que pide este paquete.

## Qué falta / para el orquestador

- ADM-06 (detalle del turno: asignaciones, tareas, supervisiones, notas) y
  ADM-08 (drawer "Asignar empleado", con las advertencias de `assign_employee`
  antes de confirmar, P-034/P-035/P-033) son de P11.3: la API, los esquemas
  y los hooks de las cuatro mutaciones ya están listos y con tests acá.
- Falta de columna en `v_assignments_board` (`client_trade_name`, ver
  arriba): a decidir si se agrega a la vista o si ADM-04 se queda con la
  razón social.
- Medición formal del criterio de rendimiento de F11 (mes con 600 turnos en
  menos de 1 s) es de P11.4; este paquete solo diseñó pensando en eso (tope
  de 3 chips por día, agrupado memoizado).
- e2e de "asignar dos empleados desde el calendario", "ver la grilla
  semanal" y "quitar uno con motivo" quedan para qa-pruebas, después de
  P11.3 (necesitan ADM-06/ADM-08 para asignar/quitar de verdad).
