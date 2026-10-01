# Tablero operativo (F16 · P16.1)

`08_Fases_y_Backlog.md` F16 "Tablero operativo" (DASH-001 a DASH-007 y
DASH-010, DOC-016). Es la pantalla ADM-02 "Resumen" de `05`: la ruta índice
de `/admin`. Sin migraciones: todo sale de `v_shifts_board`,
`v_assignments_board` y `v_supervisions_admin`, que ya existían.

## Quién la ve

Dueña y administradores (`/admin`). Las acciones se ocultan según la matriz
de `03` sección 6; el servidor vuelve a verificar cada una:

- **Registrar en nombre de** (ADM-11): dueña, o administrador con
  `manage_attendance`, y solo si hay una acción con sentido para esa
  asignación (`getAvailableAttendanceActions`).
- **Asignar reemplazo / empleado** (ADM-08): dueña o administrador antes de
  la hora de inicio del turno; después del inicio hace falta además
  `manage_attendance` (`canManageAssignmentsAfterStart`, igual que ADM-06).
- **Abrir turno** (ADM-06) y **Llamar** (`tel:` con el teléfono del empleado):
  siempre.

## Qué muestra

De arriba abajo:

1. **KPIs** (`DashboardKpis`, `KpiCard`): turnos de hoy (con clientes y sedes
   distintos), presentes, próximos en 2 h, sin registro y avisos (ausencias y
   demoras). Un cero no se pinta como alarma: las tarjetas `crit`/`warn`
   vuelven a neutras.
2. **Requiere atención** (`AttentionBlock`): una tarjeta por alerta, de la más
   urgente a la menos urgente:
   1. Sin registro pasada la hora de inicio (`display_status = no_record`).
   2. En curso pasada la hora de fin sin fin registrado.
   3. Ausencia avisada (`status = absence_notified`).
   4. Turno sin cubrir (`display_status = uncovered`).
3. **Servicios de hoy** (`ServicesTodayTable`, sobre `DataTable`): empleado,
   cliente y sede, horario, inicio real, estado, salida anticipada y
   acciones. Filtro "Todo el día" o por franja (las franjas distintas del
   día). Filas `crit`/`warn` según el mapa de estados de `07` sección 3.
4. **Supervisiones de hoy** (`SupervisionsTodayBlock`): solo lectura, sin las
   canceladas, con enlace a ADM-15.

## Dónde está el código

- `src/features/dashboard/kpis.ts`: `computeKpis`, `isShiftUpcoming`,
  `shiftStartInstant`. Funciones puras, reciben `now`.
- `src/features/dashboard/attention.ts`: `computeAttention`.
- `src/features/dashboard/servicesToday.ts`: filtro por franja.
- `src/features/dashboard/fixtures.ts`: fixtures de los tests (día fijo y
  `NOW` fijo; no dependen de la hora de ejecución).
- `src/features/dashboard/components/`: `DashboardScreen` (orquesta consultas,
  permisos y paneles), `DashboardKpis`, `AttentionBlock`, `ServicesTodayTable`,
  `SupervisionsTodayBlock`, `RowActions`.
- `src/pages/admin/Dashboard.tsx`, montada en `src/app/routes/adminRoutes.tsx`.

No hay `queries.ts` propio: se reutilizan `useShiftsByDateQuery`
(`src/features/shifts`), `useAttendanceBoardByDateQuery` y
`useEmployeePhonesQuery` (`src/features/attendance`) y
`useSupervisionsAdminQuery` (`src/features/supervisions`). Comparten caché con
ADM-05 y ADM-10, y las mutaciones de asistencia y asignación ya invalidan esas
claves, así que el tablero se actualiza solo después de registrar o asignar.

## Consultas y rendimiento

Por carga: 1 consulta a `v_shifts_board` (turnos del día), 1 a
`v_assignments_board` (asignaciones vigentes del día), 1 a `v_employees` (los
teléfonos, un solo `in(...)` para todos los empleados del día) y 1 a
`v_supervisions_admin` filtrada por fecha. Ninguna por fila (sin N+1). El
criterio de F16 (24 turnos y 40 asignaciones en menos de 1,5 s) lo mide
DASH-009 con el día cargado.

## "Hoy" y el reloj

"Hoy" es el día de Buenos Aires (`todayInBuenosAires`), no el UTC del
navegador. `DashboardScreen` tiene un reloj interno que avanza cada 30 s: así
el "hoy", los "hace n min" y la ventana de "próximos" se recalculan aunque la
pestaña quede abierta pasada la medianoche. El instante de inicio de un turno
se arma con la fecha y hora del turno en horario de Argentina
(`shiftStartInstant`, con `@date-fns/tz`).

## Polling

30 s en turnos y asignaciones (`refetchInterval` de los hooks existentes);
60 s en supervisiones. Indicador "Actualizado hace n s" (`UpdatedAgo`) con el
dato más viejo de los dos principales.

## Responsive (D29)

Por debajo de 1024 px: KPIs en dos columnas (la quinta tarjeta ocupa el ancho
completo), bloque de atención en una columna, y `DataTable` se dibuja como
lista de tarjetas (`RowCard`). Sin scroll horizontal a 390 px.

## Decisiones tomadas

- **Cinco KPIs**, uno por cada ítem de `05` línea 36; "avisos" suma
  ausencias y demoras y detalla cada una.
- **"Próximos"** cuenta turnos `scheduled`/`assigned` que empiezan en los
  próximos 120 minutos (ventana cerrada en 2 h), calculado en el cliente con
  `now` en vez de leer `display_status = upcoming`, para que sea testeable.
- **Turnos cancelados** no cuentan en ningún KPI ni alerta.
- **Sin duplicados**: si un turno sin cubrir tiene una ausencia avisada, solo
  aparece la alerta de ausencia (que ya ofrece "Asignar reemplazo" sobre ese
  turno).
- "Asignar reemplazo" también se ofrece en las filas `no_record`, porque es el
  caso del mockup D01; el diálogo de ADM-08 muestra las advertencias de
  `assign_employee` sin bloquear (P-034).
- La grilla de la tabla no ofrece "Registrar en nombre" si no hay acciones
  con sentido (turno terminado o cancelado).

## No va en la Base

Ubicación validada, incidencias, insumos, solicitudes, exportar, campana: ver
`05` sección 8 y `10_Extension_Points.md`.

## Pruebas

`kpis.test.ts`, `attention.test.ts` (fixtures con día y hora fijos) y
`components/AttentionBlock.test.tsx`. El e2e del escenario del seed
(DASH-008) y la prueba de rendimiento (DASH-009) son de qa-pruebas.
