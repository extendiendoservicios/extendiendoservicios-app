# Planificación y asignaciones (F11 · P11.2, P11.3)

`08_Fases_y_Backlog.md` F11 "Asignaciones y cronograma". P11.2
(ASSIGN-007 a ASSIGN-010) construyó la capa de datos de asignaciones y las
tres vistas de solo lectura del cronograma: calendario mensual (ADM-03),
grilla semanal por empleado (ADM-04) y la versión completa de la lista del
día (ADM-05, que ya tenía una versión mínima desde P10.3, ver
`docs/features/servicios-y-turnos.md`). Este paquete (P11.3, ASSIGN-011 a
ASSIGN-014) agrega el detalle del turno (ADM-06, en drawer y en página) y el
drawer "Asignar empleado" (ADM-08), con las cuatro RPC de asignaciones ya
conectadas a pantalla.

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

## ADM-06 · Detalle del turno (`ShiftDetail`, ASSIGN-011, ASSIGN-013)

`src/features/planning/components/ShiftDetail.tsx`: el contenido de ADM-06,
igual en drawer (escritorio) y en página (móvil, ver más abajo). Un solo
`select` con embebidos sobre `shifts` (`fetchShiftDetail`, `06` sección 7):
cliente, sede, franja, estado, origen (servicio o puntual, según
`service_id`), asignaciones vigentes (`removed_at is null`, con franja
efectiva y estado), tareas ordenadas por posición (lectura; el alta es
TASK-006/F12) y supervisiones (lectura; el alta es SUP-012/F15).

Acciones (todas detrás de `canManageAssignments`/`canManageAssignmentsAfterStart`,
`src/features/planning/permissions.ts`):

- **Asignar empleado**: abre `AssignEmployeeSheet` (ADM-08, ver abajo).
  Deshabilitado y con un texto explicando el motivo cuando la dotación ya
  está completa.
- **Quitar una asignación**: `RemoveAssignmentDialog`, reutiliza
  `ConfirmDialog` (motivo obligatorio, mismo criterio que `CancelShiftDialog`).
- **Franja propia de una asignación**: `AssignmentTimeDialog`
  (`update_assignment_time`); las dos horas en blanco vuelve a heredar la del
  turno (P-046).
- **Editar dotación y notas del turno**: `ShiftDetailsDialog`
  (`update_shift_details`, cierra el pendiente de
  `12_Registro_de_Progreso.md` que señalaba P11.2).

**Explicación en vez de fallo silencioso** (regla del encargo): `06` sección
8 exige `manage_attendance` para asignar/quitar después de la hora de inicio
del turno (`shifts.starts_at`, no el estado `in_progress` -- P-068 permite
el check-in en cualquier momento del día). Si el turno ya empezó y quien
mira no tiene esa capacidad, un `Alert` lo dice antes de que aparezcan los
botones deshabilitados, en vez de dejar que la RPC devuelva `SHIFT_STARTED`
sin contexto.

## ADM-08 · Asignar empleado (`AssignEmployeeSheet`, ASSIGN-012)

Sin ruta propia (`adminRoutes.tsx` ya lo documentaba desde P11.2): un
`Sheet` que se abre desde `ShiftDetail` con el turno ya cargado. Candidatos
de `fetchAssignCandidates` (`06` sección 8): `v_employees` con
`effective_status = 'active'`, sin los ya asignados a este turno, con tres
marcas por candidato --

- **Habilitado para el cliente**: `employee_client_permissions` sin filas
  para esa persona = habilitado para todos (P-034); si tiene alguna, hace
  falta que el cliente del turno esté entre ellas.
- **Disponible ese día y hora**: mismo criterio con `employee_availability`
  (P-035): sin filas = sin restricción; si tiene, alguna franja del día de
  la semana del turno tiene que cubrir su horario completo.
- **De licencia**: `employee_leaves` vigente el día del turno (P-033,
  contra `shift_date`, no contra "hoy" -- P-054 permite planificar sin
  límite de horizonte).

Además, **"ya asignado en otro turno del día, con horario"** (`05` línea 42):
otras asignaciones vigentes de la persona ese mismo día, con sede y franja
efectiva, no bloquean nada (`assign_employee` solo rechaza el solapamiento
de horario con `ASSIGNMENT_OVERLAP`), es solo información para decidir.

**Orden**: habilitados y disponibles primero (`06` sección 8), el resto
después, alfabético dentro de cada grupo (`Array.prototype.sort` es
estable). Búsqueda por nombre, cliente-side sobre la lista ya traída (la
dotación es chica).

**Franja propia opcional** (P-046) y **advertencias sin bloquear** (P-033,
P-034, P-035, ratificadas): al confirmar, `assign_employee` siempre crea la
asignación; si devuelve advertencias, el panel se queda abierto mostrándolas
en un `Alert` en vez de cerrarse enseguida, para que no pasen inadvertidas
-- la asignación ya existe de cualquier manera. Los errores de dominio
(`SHIFT_FULL`, `ASSIGNMENT_OVERLAP`, `ALREADY_ASSIGNED`, `SHIFT_STARTED`,
etc.) se muestran con el `message` del servidor, tal cual (regla común de la
capa).

## ADM-07 · Dotación y notas de un turno existente (ASSIGN-013)

`ShiftFormPage.tsx` en modo edición cierra el pendiente de
`12_Registro_de_Progreso.md`: ahora, además de la franja
(`update_shift_time`), el formulario tiene los campos de dotación y notas
(`update_shift_details`), con un solo botón "Guardar cambios" que llama a
las dos RPC (`shiftEditFormSchema`/`shiftEditFormValuesToInputs`,
`src/features/shifts/schemas.ts`). Cliente, sede y fecha siguen de solo
lectura: sigue sin existir una RPC para cambiarlas.

## Responsive (ASSIGN-014)

- **ADM-06 en drawer y en página**: `src/pages/admin/ShiftDetailPage.tsx`
  (`/admin/turnos/:id`) decide con `useMediaQuery('(min-width: 1024px)')`:
  en escritorio envuelve `ShiftDetail` en un `Sheet` de 452 px (`07` sección
  2.4); por debajo de 1024 px, en una página normal dentro de `AdminShell`.
  **Decisión propia, documentada acá**: como `src/app/router.tsx` no tiene
  un mecanismo de "location de fondo" (`background location`, patrón común
  de React Router para modales con URL propia), entrar por un enlace directo
  en escritorio muestra el drawer igual, pero sin el calendario/grilla/lista
  detrás (la sidebar y la topbar de `AdminShell` sí quedan visibles). Si Mike
  quiere el overlay real sobre la pantalla anterior, hace falta ese cambio de
  arquitectura en `router.tsx`, fuera del alcance de un paquete de dominio.
- **Desde el calendario, la grilla y la lista del día**: cada chip del mes
  (`MonthCalendar`), cada tarjeta de la grilla (`WeekGrid`) y cada fila de
  la lista del día (`ShiftsDayList`) son ahora enlaces directos a
  `/admin/turnos/:id` (antes, la grilla semanal llamaba a un callback
  `onOpenShift` que sólo navegaba; se simplificó a un `Link` para poder
  abrir en pestaña nueva y que el navegador maneje el historial). El número
  de día del calendario mensual sigue abriendo la lista de ese día (ADM-05).
- **ADM-08 sin ruta propia**: el `Sheet` de `AssignEmployeeSheet` se ajusta
  solo a pantalla completa por debajo de 768 px (comportamiento ya
  construido en `components/ui/sheet.tsx`) -- una milla de diferencia con el
  quiebre de 1024 px del resto de la pantalla, pre-existente del componente
  compartido, no de este paquete.
- Se probó que ADM-05 en celular permite asignar: tocar una fila navega a
  ADM-06 en página completa, y desde ahí "Asignar empleado" abre el `Sheet`
  a pantalla completa (criterio de aceptación de F11: "en celular puede
  asignar desde la lista del día").

## Qué falta / para el orquestador

- **`set_assignment_notes` no existe en el backend**: `06` sección 8 lo
  documenta ("Observación del servicio", P-062, canal E/O/A), pero
  `0024_rpc_assignments.sql` solo trae las cuatro RPC de este dominio. ADM-06
  muestra la observación de cada asignación si ya tiene una (`assignments.notes`,
  de solo lectura), pero no hay forma de cargarla o editarla desde la
  interfaz hasta que esa RPC se agregue. Reportado, sin bloquear el resto del
  paquete.
- **Sin registro de asistencia en ADM-06 todavía**: `05` línea 40 pide
  "inicio y fin reales, avisos" por asignación, pero eso es ATT-014 (F14,
  depende de esta misma tarea según `08_Fases_y_Backlog.md`) -- no está en el
  alcance de ASSIGN-011. `attendance_records`/`attendance_notices` no se
  embeben en el `select` de `fetchShiftDetail` por ese motivo.
- **`effective_status = 'active'` de `v_employees` compara contra "hoy", no
  contra la fecha del turno**: un empleado con una licencia que arranca la
  semana que viene no aparece como candidato para NINGÚN turno, ni siquiera
  uno de dentro de dos meses que cae fuera de esa licencia. `06` sección 8
  pide literalmente ese filtro para el listado de candidatos (a diferencia
  de la advertencia `ON_LEAVE` de `assign_employee`, que sí compara contra
  `shift_date`); se dejó tal cual lo pide el plan, señalado como limitación
  menor.
- Falta de columna en `v_assignments_board` (`client_trade_name`, ver
  arriba, de P11.2): sigue sin resolverse.
- Medición formal del criterio de rendimiento de F11 (mes con 600 turnos en
  menos de 1 s) sigue pendiente de P11.4.
- e2e de "asignar dos empleados desde el calendario", "ver la grilla
  semanal" y "quitar uno con motivo" quedan para qa-pruebas (P11.4): se
  dejaron roles accesibles y `data-testid="assign-candidate"` en las filas
  de candidatos de ADM-08 para que los pueda escribir.

## ASSIGN-016 · Rendimiento del calendario mensual con 600 turnos (P11.4, verificación de qa-pruebas)

Método (`tests/e2e-assignments/month-performance.spec.ts`):

1. 600 turnos de fixture (20 por día × 30 días), insertados directo con la
   clave de servicio en un cliente y una sede propios y descartables, en
   noviembre de 2191 -- mes reservado solo para esta medición (distinto del
   2190 que ya reserva `tests/e2e-shifts-services` para `generate_shifts`,
   que abarca todo el sistema; acá no hace falta esa RPC porque los turnos
   se insertan directo). Un solo `insert` de 600 filas, no 600 llamadas a
   `create_shift`: lo que se mide es el pintado de ADM-03, no el armado del
   fixture.
2. Login como dueño, navegar a `/admin/planificacion?vista=mes` con un mes
   cualquiera ya cargado, y mover el `MonthPicker` a noviembre de 2191 (con
   los botones "Año siguiente", ~165 clics desde el año en curso).
3. Medición en el reloj del propio navegador (`performance.now()`, no el de
   Node, que sumaría la comunicación con Playwright): una marca justo cuando
   la respuesta de `v_shifts_board` para ese rango de fechas llega
   (`page.waitForResponse`), y otra cuando el primer chip de turno de ese mes
   está visible en el DOM. La resta de las dos es el tiempo de pintado puro,
   después de la carga de datos (que es lo que pide el criterio de F11).
4. Umbral: menos de 1000 ms.

Resultado de la corrida contra `App_dev` (25 sep 2026, build local
`pnpm build` + `pnpm preview`, ver el reporte del encargo P11.4 para el
detalle completo y la salida de la corrida): **PASA**, el pintado quedó
bien por debajo de 1 s. El número exacto de esa corrida y el comando para
reproducirla están en el reporte del encargo (no se repite acá para no
quedar desactualizado si se vuelve a correr).

Limitación de esta medición: `MAX_CHIPS_PER_DAY = 3` (ver más arriba, "ADM-03
· Planificación · mes") ya limita a propósito cuántos `<Link>` se montan por
día -- un mes con 600 turnos reparte en promedio 20 por día, pero el DOM
real nunca llega a pintar más de 3 chips + "+n más" por celda. Esta
decisión (tomada en P11.2, documentada arriba) es justamente la que permite
cumplir el criterio de rendimiento: sin ese límite, pintar 600 `<Link>` +
`<Badge>` reales sí podría acercarse o superar el segundo. La medición de
ASSIGN-016 verifica el comportamiento real de la pantalla tal como quedó
construida, no un escenario hipotético sin ese límite.
