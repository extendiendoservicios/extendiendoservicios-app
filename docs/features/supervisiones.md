# Supervisiones (F15 · P15.3)

`08_Fases_y_Backlog.md` F15 "Supervisiones". Este paquete (P15.3, SUP-008 a
SUP-012, DOC-015) construye la vía de administración: ADM-13 "Supervisiones
· listado" (con la pestaña "Calificaciones"), ADM-14 "Asignar supervisión",
ADM-15 "Supervisión · detalle" y las ampliaciones de ADM-06 (sección
"Supervisiones" con el botón "Asignar supervisión") y ADM-17 (pestaña
"Calificaciones recibidas").

La base es P15.1 (`supabase/migrations/0029_rpc_supervisions.sql`, ya
fusionada en `develop`): las siete RPC de supervisión y calificación
(`assign_supervision`, `cancel_supervision`, `supervision_check_in`,
`supervision_check_out`, `complete_supervision`, `mark_supervision_not_done`,
`rate_employee`) y la versión completa de `v_supervisions_admin`/
`v_my_supervisions`. `supervision_check_in`/`supervision_check_out`/
`complete_supervision` son "S (propia)": las usa la app del supervisor
(`src/api/mySupervisions.ts`, de front-movil, en paralelo en otro
`worktree`), no este paquete.

Ver `docs/api.md` secciones "supervisions" y "ratings" para la tabla
completa de funciones.

## `src/api/`

- `supervisions.ts` (SUP-008): listado administrativo de
  `v_supervisions_admin` (ADM-13), detalle de una supervisión con las
  calificaciones por empleado (ADM-15), candidatos a supervisor (ADM-14) y
  las cuatro RPC de escritura que corresponden a esta capa
  (`assignSupervision`, `cancelSupervision`, `markSupervisionNotDone`).
- `ratings.ts` (SUP-008): calificaciones ya cargadas (`fetchRatings`, con
  filtros resueltos en el cliente -- decisión propia, ver el reporte del
  encargo) y `rateEmployee` (upsert, edición administrativa de ADM-15). Los
  criterios de calificación (ADM-30) siguen en `src/api/settings.ts`.

Las RPC de `0029` ya traen `hint` en mayúsculas y `message` en voseo, así
que `fromPostgrestError` las deja pasar tal cual (mismo criterio que
`shifts.ts`/`assignments.ts`): no hace falta un `mapWriteError` propio para
que los mensajes se vean en español.

## `src/features/supervisions/`

- `permissions.ts`: `canManageSupervisions` (`assign_supervision`/
  `cancel_supervision`, O; A + `manage_supervisions`),
  `canMarkSupervisionNotDone` (`mark_supervision_not_done`, O, A sin
  capacidad adicional) y `canEditRatingsAlways` (`rate_employee` sin la
  ventana de P-083, O; A + `edit_ratings` -- decide si ADM-15 muestra la
  edición de una calificación).
- `schemas.ts`: `assignSupervisionSchema` (turno y supervisor obligatorios) y
  `rateEmployeeSchema` (puntaje 1 a 5) -- repiten las restricciones del
  servidor, no las reemplazan.
- `queries.ts`: `supervisionsKeys`/`ratingsKeys`, `useSupervisionsAdminQuery`
  (ADM-13 "Supervisiones", polling 60 s), `useRatingsQuery` (ADM-13
  "Calificaciones" con polling y ADM-17 "Calificaciones recibidas" sin él,
  según el parámetro `poll`), `useSupervisionDetailQuery` (ADM-15, sin
  polling), `useSupervisorCandidatesQuery` (ADM-14) y las cuatro mutaciones
  (`useAssignSupervisionMutation`, `useCancelSupervisionMutation`,
  `useMarkSupervisionNotDoneMutation`, `useRateEmployeeMutation`), que
  invalidan `supervisionsKeys.all` y `ratingsKeys.all` juntas: toda mutación
  de este dominio toca `v_supervisions_admin` y/o `ratings`.
- `components/`:
  - `SupervisionsAdminScreen.tsx` (ADM-13): tabla con filtros (empleado,
    supervisor, cliente, sede, rango de fechas, estado) y dos pestañas
    (`Tabs`) que comparten el mismo estado de filtros -- el de estado no
    aplica a "Calificaciones" (las calificaciones no tienen estado propio).
    Las opciones de los selectores de supervisor/cliente/sede se arman con
    las filas ya cargadas de las dos consultas (mismo criterio que
    `AttendanceTodayList`); las de empleado, con `useEmployeesQuery` (ya
    cargada por ADM-16), porque el listado de supervisiones no trae nombres
    de empleado por sí solo -- decisión propia, ver el reporte del encargo.
  - `AssignSupervisionForm.tsx`/`AssignSupervisionPage.tsx` (ADM-14): fecha,
    turno (filtrado en el cliente a `scheduled`/`assigned`/`in_progress`,
    mismos estados que acepta `assign_supervision`) y supervisor. Acepta
    precarga (`initialDate`/`initialShiftId`) cuando se abre desde ADM-06
    (`Link` con `state`, sin query params). La advertencia
    `SUPERVISES_OWN_SHIFT` se muestra después de confirmar, sin bloquear
    (P15.0): la supervisión ya se creó, el panel queda abierto para que se
    vea antes de cerrarlo, mismo patrón que `AssignEmployeeSheet` (ADM-08).
  - `SupervisionDetail.tsx`/`SupervisionDetailPage.tsx` (ADM-15): cabecera
    (turno, sede, supervisor, estado, inicio y fin reales), motivo si está
    cancelada o no realizada, criterios usados (`criteria_snapshot`), nota
    general y la lista de calificaciones por empleado (una fila por cada
    asignación vigente del turno, con estrellas, comentario y "editado por
    `<nombre>` el `<fecha y hora>`" cuando corresponde). "Cancelar
    supervisión"/"Marcar como no realizada" solo si `canManageSupervisions`/
    `O, A` y el estado es `assigned`/`in_progress`; "Calificar"/"Editar
    calificación" solo si `canEditRatingsAlways` (la ventana de P-083 del
    supervisor no aplica a esta pantalla administrativa: si no tiene la
    capacidad, no ve el botón en absoluto, en vez de dejar que la RPC
    responda `FORBIDDEN`).
  - `CancelSupervisionDialog.tsx`/`MarkSupervisionNotDoneDialog.tsx`: motivo
    obligatorio, con `ConfirmDialog` (DS-010) -- mismo componente que
    `CancelShiftDialog`.
  - `RateEmployeeDialog.tsx`: upsert de una calificación (estrellas +
    comentario opcional), con `StarRating` (MOB-SUP-001). El título y el
    mensaje de éxito cambian según haya o no una calificación previa.
  - `UpdatedAgo.tsx`: "Actualizado hace n s" para ADM-13 (regla común de
    polling) -- copia de `src/features/attendance/components/UpdatedAgo.tsx`
    porque `src/components/` no es de este dominio; pedido pendiente a
    front-plataforma para subirlo a un lugar compartido.

## ADM-06 · Detalle del turno, ampliado (SUP-012)

La sección "Supervisiones" de `ShiftDetail`
(`src/features/planning/components/`, ya existía en lectura desde ASSIGN-011)
suma el botón "Asignar supervisión" (visible con `canManageSupervisions` y
el turno editable: no cancelado ni completado, mismo criterio que
`SHIFT_NOT_SUPERVISABLE` del servidor) que navega a ADM-14 con el turno y la
fecha precargados, y cada fila de supervisión ya asignada enlaza a su
detalle (ADM-15).

## ADM-17 · Ficha del empleado, ampliada (SUP-012)

La pestaña "calificaciones" (antes con un estado vacío fijo desde P09.4) usa
ahora `EmployeeRatingsTab` (`src/features/employees/components/`, dominio
`employees`, no `supervisions`): tabla de `fetchRatings({ employeeId })` sin
polling (pestaña dentro de una ficha, mismo criterio que
`EmployeeAttendanceHistoryTab`), con enlace a la supervisión (ADM-15).

## Responsive

Sin trabajo adicional más allá de lo ya construido por otros paquetes:
`DataTable` pasa de tabla a `RowCard` por debajo de 1024 px
(`SupervisionsAdminScreen`, `EmployeeRatingsTab`) y `Sheet` ocupa toda la
pantalla por debajo de 1024 px (`AssignSupervisionPage`,
`SupervisionDetailPage`), mismo comportamiento que `ShiftDetailPage`.

## Decisiones tomadas en P15.3

- **El filtro "empleado" de ADM-13 se resuelve con una consulta previa a
  `assignments`/`ratings`**, no con un filtro anidado de PostgREST sobre
  `v_supervisions_admin` (la vista no tiene esa columna): se buscan las
  asignaciones del empleado, después las supervisiones con una calificación
  de esas asignaciones, y se filtra el listado por esos ids.
- **`fetchRatings` trae todo y filtra en el cliente** (empleado, supervisor,
  sede, rango de fechas): evita depender de filtros `!inner` de PostgREST
  sobre columnas de dos niveles de profundidad sin un entorno para probarlos
  contra `App_dev`, y la escala esperada (dotación de decenas de personas)
  hace que sea una alternativa razonable.
- **Precarga de ADM-14 desde ADM-06 por `state` de navegación**, no por
  parámetros de la URL: son solo dos valores (turno y fecha) que no hace
  falta que sean parte de la URL compartible.
- **`EmployeeRatingsTab` vive en `src/features/employees/components/`**, no
  en `src/features/supervisions/`: es una pestaña de la ficha del empleado
  (ADM-17, dominio EMP), aunque consuma `useRatingsQuery` de
  `src/features/supervisions/queries.ts` -- mismo criterio que
  `EmployeeAttendanceHistoryTab` con `src/features/attendance/`.

## Qué revisar / para el orquestador

- **Sin e2e**: quedan para qa-pruebas (SUP-013/TEST-012), con la misma
  capacidad `manage_supervisions`/`edit_ratings` y los mismos seeds de F15.1.
- **`UpdatedAgo` duplicado** entre `src/features/attendance/components/`,
  `src/features/shifts/components/` y ahora
  `src/features/supervisions/components/`: pedido pendiente a
  front-plataforma para subirlo a `src/components/` (ya señalado por
  paquetes anteriores).
