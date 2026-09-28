# Supervisiones (F15 · P15.3 a P15.5)

`08_Fases_y_Backlog.md` F15 "Supervisiones". Dos vías sobre la misma base:

- **Administración** (P15.3, SUP-008 a SUP-012, DOC-015): ADM-13
  "Supervisiones · listado" (con la pestaña "Calificaciones"), ADM-14
  "Asignar supervisión", ADM-15 "Supervisión · detalle" y las ampliaciones de
  ADM-06 (sección "Supervisiones" con el botón "Asignar supervisión") y
  ADM-17 (pestaña "Calificaciones recibidas"). Documentada en las secciones
  de más abajo hasta "Decisiones tomadas en P15.3".
- **Móvil del supervisor** (P15.4, MOB-SUP-002 a MOB-SUP-005/009/012, y
  P15.5, MOB-SUP-006 a MOB-SUP-008/011, DOC-015 parte móvil): SUP-02 a SUP-09
  bajo `/sup`. Documentada en "## Vía del supervisor (móvil)", más abajo --
  P15.4 construyó SUP-02, SUP-03, SUP-04, SUP-07 y SUP-09 sin dejar
  documentación propia; este documento la suma junto con lo que agregó
  P15.5 (SUP-05, SUP-06, SUP-08).

La base de las dos es P15.1 (`supabase/migrations/0029_rpc_supervisions.sql`,
ya fusionada en `develop`): las siete RPC de supervisión y calificación
(`assign_supervision`, `cancel_supervision`, `supervision_check_in`,
`supervision_check_out`, `complete_supervision`, `mark_supervision_not_done`,
`rate_employee`) y la versión completa de `v_supervisions_admin`/
`v_my_supervisions`. `supervision_check_in`/`supervision_check_out`/
`complete_supervision`/`mark_supervision_not_done`/`rate_employee` son
"S (propia)" (`06_API.md` secciones 12 y 13): la vía móvil los usa desde
`src/api/mySupervisions.ts`, la administrativa desde `src/api/supervisions.ts`
y `src/api/ratings.ts` (sin capacidad adicional para O/A, o con
`manage_supervisions`/`edit_ratings` según la operación).

Ver `docs/api.md` secciones "supervisions" y "ratings" para la tabla
completa de funciones de la vía administrativa (`mySupervisions.ts` no está
ahí: es de front-movil, documentado en este archivo).

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

## Vía del supervisor (móvil, P15.4 y P15.5)

Bajo `/sup` (`src/app/routes/supervisorRoutes.tsx`), tabbar Hoy ·
Supervisiones · Historial · Más (`05_Pantallas_y_Navegacion.md` sección 4).
Referencia visual a 390 px, botones principales de 44 px o más
(`07_Design_System.md`).

### `src/api/mySupervisions.ts`

Único módulo de la vía: junta acceso a datos y hooks de TanStack Query en el
mismo archivo (decisión de P15.4, distinta del resto de `src/api/`, ver el
comentario de cabecera del archivo) porque nadie más lo toca, a diferencia
de `src/features/supervisions/` (compartido con la vía administrativa).

| Función/hook                                                                 | Para                           | Notas                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchMySupervisionsUpcoming`/`usePendingQuery`/`fetchMySupervisionsHistory` | SUP-02, SUP-07, SUP-08         | Hoy y próximos 7 días; todas las asignadas o en curso; completadas y no realizadas. `v_my_supervisions` filtra `supervisor_id = auth.uid()` en la vista misma.                                          |
| `fetchMySupervisionById`/`useMySupervisionQuery`                             | SUP-03, SUP-04, SUP-05, SUP-06 | El detalle por id, sin depender de por dónde se entró.                                                                                                                                                  |
| `fetchVigentRatingCriteria`/`useVigentRatingCriteriaQuery`                   | SUP-03, SUP-05                 | Guía de texto vigente (P-080); se usa `criteriaSnapshot` en vez de esto si la supervisión ya empezó (P-087).                                                                                            |
| `supervisionCheckIn`/`Out`                                                   | SUP-04                         | Mismo criterio de ubicación que `record_check_in`/`Out` del empleado (ADR-009): nunca bloquea.                                                                                                          |
| `fetchSupervisionAssignments` (P15.5)                                        | SUP-03, SUP-05                 | `assignment_id` por `employee_id` del turno -- `v_my_supervisions.assigned_employees` no lo trae, lo pide `rate_employee`.                                                                              |
| `fetchPeopleAvatars` (P15.5)                                                 | SUP-05                         | Foto de una persona (`v_people_basic`, P-103: "personal supervisado" es uno de sus dos usos documentados).                                                                                              |
| `fetchSupervisionRatings`/`fetchRatingsSummaryBySupervisionIds` (P15.5)      | SUP-03, SUP-05, SUP-08         | Calificaciones ya cargadas de una supervisión, y el resumen (cantidad + promedio) de un lote para el historial en una sola consulta.                                                                    |
| `isRatingWindowClosed`/`canRateNow` (P15.5)                                  | SUP-03, SUP-05                 | P-083 del lado del cliente: `now() > mayor(fin previsto del turno, fin registrado de la supervisión)`, mismo cálculo que la RPC -- MOB-SUP-011 pide anticiparlo, no solo mostrar el error del servidor. |
| `rateEmployee`/`useRateEmployeeMutation`                                     | SUP-05                         | Upsert. `SELF_RATING_NOT_ALLOWED` (CB-13), `RATING_WINDOW_CLOSED`, `SUPERVISION_NOT_ACTIVE`.                                                                                                            |
| `completeSupervision`/`markSupervisionNotDone`                               | SUP-06                         | `CHECK_OUT_REQUIRED` la primera; motivo obligatorio la segunda.                                                                                                                                         |

Las mutaciones devuelven la promesa de `invalidateQueries` desde `onSuccess`
(no solo la disparan): así el botón sigue "ocupado" hasta que llega el
estado nuevo, en vez de quedar habilitado en la ventana entre la respuesta
de la RPC y la recarga (donde un segundo toque respondería, por ejemplo,
`ALREADY_STARTED`).

### `src/pages/sup/`

| Pantalla                   | Archivo                         | Construida en                                                                |
| -------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| SUP-02 Hoy                 | `TodayPage.tsx`                 | P15.4                                                                        |
| SUP-07 Supervisiones (tab) | `SupervisionsPage.tsx`          | P15.4                                                                        |
| SUP-03 Detalle             | `SupervisionDetailPage.tsx`     | P15.4; ampliada en P15.5 con "Calificar" por empleado y "Cerrar supervisión" |
| SUP-04 Inicio y fin        | `SupervisionAttendancePage.tsx` | P15.4                                                                        |
| SUP-05 Calificar empleado  | `RateEmployeePage.tsx`          | P15.5                                                                        |
| SUP-06 Cerrar supervisión  | `CloseSupervisionPage.tsx`      | P15.5                                                                        |
| SUP-08 Historial           | `HistoryPage.tsx`               | P15.5                                                                        |
| SUP-09 Más                 | `MorePage.tsx`                  | P15.4                                                                        |

`src/features/supervisions/components/RatingCriteriaGuide.tsx` (P15.5): la
guía de criterios (un `<details>` por criterio), compartida entre SUP-03 y
SUP-05 -- vive en la carpeta de `supervisions` porque es parte de la vía del
supervisor, no del componente compartido `StarRating` (`src/components/`,
MOB-SUP-001, P13.4).

### Reglas de negocio de la vía móvil (P-080 a P-087, CB-13, CB-14)

- **CB-13, autocalificación**: si el supervisor también es empleado del
  turno, SUP-03 no ofrece "Calificar" para su propia fila (muestra "Vos" en
  su lugar) y SUP-05 rechaza igual si se llega por un enlace viejo
  (`SELF_RATING_NOT_ALLOWED`, verificado también por la RPC).
- **P-083/MOB-SUP-011, ventana de edición**: SUP-03 no ofrece "Calificar"
  para ningún empleado si el plazo ya cerró (con un aviso corto en la
  tarjeta) y SUP-05 muestra el mismo mensaje del servidor
  (`RATING_WINDOW_CLOSED`) en vez del formulario si se llega igual. El
  cálculo es puramente por hora (`isRatingWindowClosed`), sin mirar si la
  supervisión pasó a `completed`: P-083 permite seguir editando después de
  completar, mientras no venza el plazo (CB-14 es el caso contrario, al día
  siguiente).
- **P-082, cerrar sin haber empezado**: `mark_supervision_not_done` acepta
  `assigned` o `in_progress` (no exige inicio ni fin registrados), a
  diferencia de `complete_supervision` (`CHECK_OUT_REQUIRED`). Por eso SUP-03
  ofrece "Cerrar supervisión" en cualquier estado abierto, no solo con los
  dos registros hechos -- antes de P15.5 esta pantalla no ofrecía nada en
  ese último caso.
- **P-081, comentario opcional; P-084, privacidad**: SUP-05 no exige
  comentario; el empleado no tiene ninguna vía para leer `ratings` (RLS,
  `0012_rls_policies.sql`), la vía móvil del supervisor tampoco lo expone en
  ninguna pantalla de la vía del empleado.

### Responsive y patrones de UI

Mismos componentes que la vía del empleado (`ActionBar`, `SegmentedControl`,
`Textarea` con `mobile`, `Card`): SUP-06 reusa el patrón de `SegmentedControl`
de `NotifyPage` (EMP-12) para elegir entre completar y marcar no realizada, y
SUP-04 reusa `LocationConsentScreen`/`RegisterStartScreen` de la vía del
empleado (EMP-06/EMP-05) tal cual, sin acoplarse a ningún dominio.

## Decisiones tomadas en P15.5 (vía del supervisor)

- **`isRatingWindowClosed` se repite en el cliente** en vez de solo confiar
  en el error `RATING_WINDOW_CLOSED` del servidor: MOB-SUP-011 pide
  anticiparlo ("no ofrecer editar fuera de plazo"), así que SUP-03 oculta el
  acceso a calificar y SUP-05 no muestra el formulario cuando ya sabe que va
  a fallar.
- **"Cerrar supervisión" es un único botón/enlace** para las dos
  alternativas (completar o no realizada): SUP-06 decide con qué pestaña
  abre según haya o no fin registrado, en vez de que SUP-03 tenga dos
  accesos distintos según el estado.
- **El resumen de calificaciones del historial (SUP-08) es una sola consulta
  por lote** (`fetchRatingsSummaryBySupervisionIds`), no una por fila de la
  lista: la cantidad de supervisiones cerradas de un supervisor no
  justifica N consultas.
- **El promedio de estrellas de SUP-08 se redondea al entero más cercano**
  para mostrarlo con `StarRating` de solo lectura (que no admite medias
  estrellas): es una vista de lista, no el detalle -- el detalle (SUP-03)
  sigue mostrando el puntaje exacto de cada calificación.
- **SUP-03 (el detalle) hace de pantalla de solo lectura para el historial**
  ("`05` mapa de navegación: SUP-08 → SUP-03 (lectura)"), sin una bandera de
  "modo lectura" separada: para una supervisión `completed`/`not_done`, ya
  no hay ningún registro ni cierre que ofrecer (`isOpen` es `false`), y
  "Calificar" solo aparece si, además, el plazo de P-083 sigue abierto --
  ese último caso es intencional (ver la nota de reglas de negocio arriba),
  no un descuido.

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

- **Sin e2e**: quedan para qa-pruebas (SUP-013/TEST-012 de la vía
  administrativa; MOB-SUP-013 de la vía móvil), con la misma capacidad
  `manage_supervisions`/`edit_ratings` y los mismos seeds de F15.1.
- **`UpdatedAgo` duplicado** entre `src/features/attendance/components/`,
  `src/features/shifts/components/` y ahora
  `src/features/supervisions/components/`: pedido pendiente a
  front-plataforma para subirlo a `src/components/` (ya señalado por
  paquetes anteriores).
- **Pregunta sobre la ventana de edición post-`completed` (P15.5)**: la
  UI deja calificar/editar después de completar la supervisión mientras el
  plazo de P-083 siga abierto (lectura literal de la RPC y de P-083: "hasta
  el fin del turno o de su propia supervisión, lo que ocurra último"), en vez
  de tratar "completada" como automáticamente de solo lectura. `05` dice que
  SUP-08 lleva a "SUP-03 (lectura)", que podría leerse como una intención
  más estricta. Si Mike prefiere que completar cierre la edición al toque
  (sin esperar al plazo), es un cambio menor en `canRateNow`
  (`src/api/mySupervisions.ts`) y en el test que lo cubre.
