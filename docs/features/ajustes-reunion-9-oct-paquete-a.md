# Ajustes de la reunión del 9 oct 2026 · paquete A (P19.6)

Rama `feat/AJ2-A-rapidos`. Puntos rápidos; los demás paquetes (B a G) van en
sus propios documentos.

## AJ2-01 · Empleados siempre por legajo

`fetchEmployees` (`src/api/employees.ts`) pide `v_employees` ordenada por
`employee_number` ascendente. Además `EmployeesPage` aplica
`sortByEmployeeNumber` (`features/employees/employeeListFilters.ts`) después de
filtrar por cliente y estado, así el orden por legajo vale también en las
tarjetas del celular, después de buscar o filtrar y al volver a la pantalla. La
única columna con orden clickeable es «Calificación»: ordena sobre la lista
completa y, como `sortByRating` es estable, los empates quedan por legajo.

## AJ2-05 · CUIL y CUIT formateados

Una sola función en `src/lib/taxId.ts` (con `taxId.test.ts`):

- `formatTaxId(valor)`: `XX-XXXXXXXX-X`. Si el valor guardado no tiene 11
  dígitos (datos viejos) se devuelve tal cual; `null` queda `null`.
- `formatTaxIdWhileTyping(valor)`: agrupa mientras se escribe en el campo.
- `cleanTaxId(valor)`: deja solo dígitos.

En los formularios (`EmployeeFormPage`, alta y edición; `ClientFormPage`) el
campo es un `Controller` que formatea al escribir. Al guardar se limpia
(`onlyDigits` en empleados, `cleanTaxId` en `clientFormValuesToInput`): la base
sigue recibiendo solo los 11 dígitos. Los esquemas aceptan guiones y puntos. Se
muestra formateado en la ficha del empleado (CUIL), la ficha y el listado de
clientes (tabla y tarjeta) y la hoja del resumen de servicios. La búsqueda de
clientes por CUIT acepta el texto con guiones (se limpia antes de consultar). El
listado de empleados y la búsqueda global no muestran CUIL/CUIT.

## AJ2-08 · Editar licencias

`updateEmployeeLeave` (`src/api/employees.ts`) hace `update` directo de
`employee_leaves` (fechas, motivo, `updated_by`) y `useUpdateEmployeeLeaveMutation`
invalida lo mismo que el alta. En la pestaña de licencias cada licencia vigente
tiene «Editar»: carga el mismo formulario del alta, el botón pasa a «Guardar
cambios» y aparece «Cancelar edición». Las dadas de baja no se editan. Un
`update` de la misma fila no choca consigo misma contra
`employee_leaves_no_overlap`; sí contra otras licencias vigentes, con el mensaje
«Esas fechas se superponen con otra licencia ya cargada de esa persona.»
(`LEAVE_OVERLAP`, redactado para servir al alta y a la edición).

## AJ2-11 y AJ2-12 · Usuarios y roles

`fetchUsers` trae `avatar_path` (`AdminUserRow.avatarPath`) y la columna Nombre
muestra la foto con `PersonCell`/`avatarUrl` (bucket público `avatars`, con
iniciales de respaldo). El nombre es un enlace a `/admin/empleados/:id` para
quien tiene ficha (rol empleado o supervisor, `userDetailPath` en
`features/users/userNavigation.ts`). El enlace vive solo en esa celda: el menú
«Acciones» no dispara la navegación y las columnas siguen memorizadas con
`useMemo`. Dueños y administradores sin ficha de empleado no navegan (no existe
una pantalla de perfil de otra persona en administración).

## AJ2-14 y AJ2-16 · Imprimibles de asistencia

Dos imprimibles: el **detalle de asistencia de una persona** (pestaña
Asistencia de la ficha, `features/attendance/detailSheet.ts`) y el **resumen de
servicios del cliente** (`features/clients/serviceSummary.ts`).

Inasistencia (`features/attendance/absences.ts`, `isAbsence`): asignación
vigente de un turno no cancelado, sin fichaje de inicio, con aviso de ausencia
o con la franja ya terminada. Un turno que todavía no terminó y sin aviso no
cuenta. En ambas hojas sale con la columna «Observaciones» («Ausencia avisada:
Enfermedad», «Inasistencia: sin fichaje de inicio»), horas «—» (no suman) y un
dato «Inasistencias: N» en el encabezado.

- Detalle por persona: usa las filas que ya trae el historial
  (`v_assignments_board`, ahora con `removed_at` para no contar asignaciones
  quitadas).
- Resumen por cliente: `client_service_summary` solo lista turnos realizados
  (algún inicio), así que un turno donde nadie fichó no aparece. Al abrir la
  hoja se hace una consulta aparte (`fetchClientUnstartedAssignments`:
  `v_assignments_board` del cliente y período, sin inicio, vigentes y no
  cancelados) y se une.

Nombre y DNI: el dato «Persona» de la hoja por persona pasa a «Nombre y
Apellido» y suma «DNI» (viene de la ficha). La hoja del cliente pasa a una fila
por persona y turno, con las columnas «Nombre y Apellido» y «DNI» (consulta
`fetchEmployeeDnisByIds` a `employees`, una sola para toda la hoja). La hoja
espera ambas consultas antes de armarse.

## AJ2-18 · Planificación por día con nombres

La lista del día (`ShiftsDayList`) suma las columnas «Asignados» (hasta dos
nombres y «+N») y «Supervisor» (supervisión no cancelada). Los datos salen de
`useShiftPeopleByDateQuery`: dos consultas por día (asignaciones vigentes de
`v_assignments_board` y `v_supervisions_admin`), no una por turno; agrupadas por
`groupShiftPeople`. Cada celda trunca en una línea y el `title` muestra la lista
completa. En celular las columnas pasan a datos de la tarjeta.

## AJ2-13 · Aviso de feriados del año siguiente

Desde el 1 de octubre, si el año siguiente no tiene feriados activos,
Configuración → Feriados muestra un aviso con el botón «Cargar feriados
nacionales de <año>» y la aclaración de que los puentes o turísticos por
decreto se agregan a mano (`NextYearHolidaysNotice`, regla en
`features/settings/holidayReminder.ts`). No aparece si ya se está mirando ese
año.

## Pruebas

`taxId.test.ts`, `employeeListFilters.test.ts` (orden por legajo),
`employees.test.ts` (orden, DNI, edición de licencias), `schemas.test.ts` de
clientes, `EmployeeLeavesTab.test.tsx`, `UsersPage.test.tsx`,
`userNavigation.test.ts`, `users.test.ts`, `absences.test.ts`,
`detailSheet.test.ts`, `serviceSummary.test.ts`,
`ClientServiceSummaryTab.test.tsx`, `attendance.test.ts`, `shiftPeople.test.ts`,
`holidayReminder.test.ts` y `NextYearHolidaysNotice.test.tsx`.
