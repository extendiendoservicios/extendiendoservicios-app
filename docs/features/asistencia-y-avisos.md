# Asistencia administrativa y avisos (F14 · P14.3)

`08_Fases_y_Backlog.md` F14 "Ausencias y demoras, asistencia administrativa".
Este paquete (P14.3, ATT-010 a ATT-014, ABS-006, ABS-008, ATT-016, ABS-010)
construye la vía de administración de asistencia: ADM-11 "Registrar en
nombre del empleado", ADM-10 "Asistencia de hoy", ADM-12 "Historial de
asistencia del empleado" (pestaña de ADM-17) y la ampliación de ADM-06 con
inicio/fin reales, quién y cómo se registraron, y los avisos.

La base es P14.1 (`supabase/migrations/0027_rpc_notices_admin_attendance.sql`,
PR #82, todavía sin fusionar al momento de este paquete, aplicada en
`App_dev`): `admin_record_attendance`, `close_assignment`, `notify_delay`,
`notify_absence`, y las columnas nuevas de `v_assignments_board`/`v_my_day`
(origen y responsable de cada registro, último aviso).

**Trabajo en paralelo con P14.2** (front-movil, en otro worktree): ese
paquete construye `src/api/notices.ts` (aviso desde la app del empleado) y
la lista de motivos del lado del empleado. Este paquete usa en cambio:

- `src/api/attendance.ts` (ya existía desde P13.1/P13.2): se le agregan
  `adminRecordAttendance`, `closeAssignment` y las lecturas de
  `v_assignments_board`/`attendance_records`/`attendance_notices` para
  ADM-06, ADM-10 y ADM-12.
- `src/api/adminNotices.ts` (archivo nuevo, propio y mínimo): `notifyDelayOnBehalf`/
  `notifyAbsenceOnBehalf`, mismas RPC `notify_delay`/`notify_absence` que
  usa (o va a usar) `src/api/notices.ts` del otro paquete, para el uso "en
  nombre del empleado". El orquestador unifica los dos módulos al integrar.
- `src/features/attendance/reasonLabels.ts`: etiquetas de `absence_reason`/
  `notice_kind`/`attendance_source`/`attendance_kind`, con un comentario
  `// TODO(P14.2): unificar con la lista compartida` -- front-movil arma su
  propia lista de motivos para la pantalla del empleado; el orquestador
  las junta en un solo archivo al integrar las dos ramas.

Ver `docs/api.md` secciones "attendance" y "adminNotices" para la tabla
completa de funciones.

## `src/features/attendance/`

- `permissions.ts`: `canManageAttendance` (owner siempre; administrador con
  la capacidad `manage_attendance`, ADM-27) -- mismo criterio que
  `src/features/planning/permissions.ts`.
- `derive.ts`: reglas sin React, con sus propios tests.
  - `getAvailableAttendanceActions(ctx)`: qué acciones de ADM-11 tiene
    sentido ofrecer para una asignación (inicio, fin, cierre manual, demora,
    ausencia), replicando en el cliente las mismas condiciones que
    `0027_rpc_notices_admin_attendance.sql` (el servidor vuelve a validar
    todo). Reglas: inicio siempre que no haya check-in y el turno no haya
    terminado; fin y cierre manual cuando hay check-in sin check-out;
    demora solo antes de la hora de inicio efectiva, sin check-in ni
    ausencia ya avisada; ausencia sin check-in ni ausencia ya avisada,
    **antes o después** de la hora de inicio (P-073, ratificado el 26 sep
    2026 -- a diferencia del propio empleado, que solo puede antes).
  - `getAttendanceStatusBadgeInput(row)`: traduce una `AttendanceBoardRow`
    al estado que pinta `StatusBadge` -- `no_record` si `display_status` lo
    marca, `early_leave` (derivado, con los minutos) si terminó con salida
    anticipada, `delay_notified` con los minutos del último aviso, o el
    estado tal cual.
- `schemas.ts`: `recordAttendanceSchema` (hora + motivo, para inicio, fin y
  cierre manual), `notifyDelaySchema` (minutos 1..600, motivo opcional),
  `notifyAbsenceSchema` (motivo obligatorio, texto obligatorio si es
  "Otro") -- repiten las restricciones del servidor, no las reemplazan.
- `dateTimeLocal.ts`: conversión entre el valor de un
  `input type="datetime-local"` (hora de Argentina, sin zona) y un instante
  real, para el campo "Hora" de ADM-11. **Se usa `datetime-local`, no
  `TimeInput`** (que es solo `HH:mm`): el rango válido de
  `admin_record_attendance`/`close_assignment` (0:00 del día del turno hasta
  ahora) puede cruzar la medianoche si se carga la asistencia al día
  siguiente -- decisión propia, ver el reporte del encargo.
- `queries.ts`: `attendanceKeys`, `useAttendanceBoardByDateQuery` (ADM-10,
  polling 30 s si la fecha es hoy), `useEmployeeAttendanceHistoryQuery`
  (ADM-12), `useAssignmentsAttendanceQuery`/`useAttendanceTimelineQuery`
  (ADM-06), `useEmployeePhonesQuery`/`usePeopleNamesQuery` y las cuatro
  mutaciones (`useAdminRecordAttendanceMutation`, `useCloseAssignmentMutation`,
  `useAdminNotifyDelayMutation`, `useAdminNotifyAbsenceMutation`), que
  invalidan `attendanceKeys.all` más `planningKeys.all`/`shiftsKeys.all`
  (una asignación cambia `status`/`display_status` de `v_assignments_board`,
  que también leen la grilla semanal y la lista del día).

## ADM-11 · Registrar en nombre del empleado (`RecordAttendanceSheet`, ATT-010, ABS-008)

Sin ruta propia (drawer de ADM-06/ADM-10, mismo criterio que
`AssignEmployeeSheet` -- `adminRoutes.tsx` ya lo documentaba). Selector de
acción (`Select`, solo con las que `getAvailableAttendanceActions` devuelve
para esa asignación) y un formulario propio por tipo de acción:

- **Inicio, fin y cierre manual** (`RecordCheckForm`): hora (`datetime-local`,
  por defecto ahora, `min` las 0:00 del día del turno, `max` ahora -- P14.0)
  y motivo obligatorio. Llama `adminRecordAttendance('check_in'|'check_out', ...)`
  o `closeAssignment(...)` según la acción elegida.
- **Demora** (`NotifyDelayForm`): minutos (1 a 600) y motivo opcional.
  Llama `notifyDelayOnBehalf`.
- **Ausencia** (`NotifyAbsenceForm`): motivo (`Select` con
  `ABSENCE_REASON_LABELS`) y detalle (obligatorio solo si el motivo es
  "Otro"). Llama `notifyAbsenceOnBehalf`.

Los errores del servidor se muestran tal cual (`error.message`, regla común
de la capa): `AT_OUT_OF_RANGE`, `INVALID_TIME_RANGE`, `REASON_REQUIRED`,
`TOO_LATE_TO_NOTIFY`, `ASSIGNMENT_STARTED`, etc.

## ADM-10 · Asistencia de hoy (`AttendanceTodayList`, ATT-011, ATT-012)

`/admin/asistencia` (reemplaza el placeholder de F10). Tabla sobre
`fetchAttendanceBoardByDate`: empleado, cliente · sede, franja, inicio real,
fin real, estado (con `StatusBadge`/`getAttendanceStatusBadgeInput`) y
salida anticipada. Filtros por estado (`Select`, incluye el derivado
"Sin registro"), cliente, sede y texto (nombre del empleado); fecha
navegable (`DatePicker` + anterior/siguiente + "Hoy"), con polling 30 s y
"Actualizado hace n s" solo cuando la fecha es hoy (P-005). Filas pintadas
`crit`/`warn` con el mismo criterio que `07` sección 3 (`no_record`/
`absence_notified` → `crit`; `delay_notified`/salida anticipada → `warn`).

Acciones por fila: "Abrir turno" (`/admin/turnos/:id`, ADM-06, donde ya se
puede asignar a otro empleado), "Registrar en nombre" (abre
`RecordAttendanceSheet`, solo si `canManageAttendance` y hay alguna acción
disponible para esa asignación) y "Llamar" (`tel:`, solo si
`fetchEmployeePhonesByIds` devuelve un teléfono para esa persona).

**Decisión propia sobre el filtro de sede**: se arma con las sedes
presentes en la fecha elegida (no hay una lista global de sedes en este
módulo), no con una consulta aparte a `sites` -- alcanza para un tablero de
un solo día. Documentado en el reporte del encargo.

## ADM-12 · Historial de asistencia del empleado (`EmployeeAttendanceHistoryTab`, ATT-013)

Pestaña "asistencia" de ADM-17 (`EmployeeDetailPage`, antes con estado
vacío desde P09.4). `fetchEmployeeAttendanceHistory(employeeId, from, to)`:
lista por fecha con turno (enlace a ADM-06), franja, inicio y fin reales,
estado, aviso (tipo + motivo o minutos) y observación. Rango de fechas
editable (`DatePicker` "Desde"/"Hasta", por defecto los últimos 30 días),
paginado en el cliente (mismo criterio que `EmployeesPage`). Sin totales
(módulo F, fuera de la Base).

## ADM-06 · Detalle del turno, ampliado (`AssignmentAttendanceDetail`, ATT-014, ABS-006)

Cada fila de "Asignaciones" de `ShiftDetail`
(`src/features/planning/components/`) suma un bloque de asistencia
(`AssignmentAttendanceDetail`, `src/features/attendance/components/`):

- **Inicio y fin reales, quién y cómo**: "08:02 · marcó desde la app" o
  "08:02 · lo cargó María Pérez" (`fetchAssignmentsAttendance`, columnas
  `check_in_source`/`check_in_recorded_by` de `v_assignments_board`, más
  `fetchPeopleNamesByIds` para resolver el id del administrador a un
  nombre).
- **Avisos, en un `Timeline`**: a diferencia de `v_assignments_board`
  (que solo trae el ÚLTIMO aviso, pensada para un tablero), acá se lee
  `attendance_records`/`attendance_notices` directo
  (`fetchAttendanceTimeline`, RLS `..._select_admin` de
  `0012_rls_policies.sql`: el dueño y cualquier administrador pueden verlas
  todas) para mostrar el historial COMPLETO de la asignación, ordenado del
  más antiguo al más reciente.
- **"Registrar en nombre"**: mismo `RecordAttendanceSheet` que ADM-10, con
  las acciones que correspondan a esta asignación puntual.

`ShiftDetail` pide `useAssignmentsAttendanceQuery`/`useAttendanceTimelineQuery`
con los ids de las asignaciones vigentes en cuanto se conocen (no espera al
primer `return` condicional de la función, por las reglas de hooks de
React).

## Responsive (ATT-016)

Sin trabajo adicional más allá de lo ya construido por otros paquetes: el
`Sheet` de `RecordAttendanceSheet` se ajusta solo a pantalla completa por
debajo de 768 px (`components/ui/sheet.tsx`) y `DataTable` pasa de tabla a
`RowCard` por debajo de 1024 px (`AttendanceTodayList`/
`EmployeeAttendanceHistoryTab`) -- mismo comportamiento que
`AssignEmployeeSheet`/`EmployeesPage` de paquetes anteriores. Se probó
`AttendanceTodayList` y `RecordAttendanceSheet` a 390 px: la tabla se ve
como lista de tarjetas, con "Registrar en nombre"/"Abrir turno"/"Llamar" en
la zona `trailing` de cada tarjeta, y el panel de registro ocupa toda la
pantalla.

## Decisiones tomadas en P14.3

- **`adminRecordAttendance`/`closeAssignment`/lecturas de asistencia se
  agregaron a `src/api/attendance.ts`** (no un archivo nuevo): así lo pidió
  el encargo, para no duplicar el módulo que ya usa el empleado (P13.1/
  P13.2) -- ver la nota grande al principio de ese archivo.
- **`src/api/adminNotices.ts` es un archivo nuevo y aislado** (no
  `src/api/notices.ts`, que crea P14.2 en paralelo): instrucción explícita
  del orquestador para evitar una dependencia cruzada entre dos ramas que
  se editan al mismo tiempo. Se duplica la llamada a `notify_delay`/
  `notify_absence` en vez de importar el módulo del otro paquete.
- **`datetime-local` en vez de `TimeInput`** para la hora de ADM-11 (ver
  arriba, `dateTimeLocal.ts`).
- **El filtro de sede de ADM-10 se arma con las sedes de la fecha elegida**,
  no con una lista global (ver arriba).
- **`fetchAttendanceTimeline` consulta `attendance_records`/
  `attendance_notices` directo**, no a través de `v_assignments_board`
  (que solo trae el último aviso): es la única forma de mostrar el
  historial completo que pide ADM-06 ("avisos", en plural).

## Qué revisar / para el orquestador

- **P14.2 tiene que unificar `reasonLabels.ts`** (este paquete) con la
  lista de motivos que arme para la pantalla del empleado, y
  `adminNotices.ts` con `notices.ts` -- ver el comentario `TODO(P14.2)` y
  las notas de arriba.
- **Sin e2e**: quedan para qa-pruebas (P14.4), con la misma capacidad
  `manage_attendance` y los mismos seeds de F14.1.
