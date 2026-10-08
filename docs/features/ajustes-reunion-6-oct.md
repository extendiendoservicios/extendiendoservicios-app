# Ajustes de la reunión del 6 oct 2026 · administración (P19.5b)

Ajustes pedidos por los dueños, parte de administración (la parte del
celular del empleado, «En camino», la hace front-movil). La base de datos
está en las migraciones `0032` y `0033` (P19.5a, ver `docs/database.md`).
Tareas: AJ-01 a AJ-10 (menos lo que es del celular).

## AJ-01 · Editar nombre

- **Configuración → Usuarios (ADM-27):** en el menú «…» de cada persona,
  «Editar nombre» (nombre y apellido). **Solo el dueño**, para cualquier
  persona, incluido él mismo y otros dueños, también cuentas desactivadas
  (`canEditPersonName`, `getVisibleUserActions` en `features/users/`).
- **Mi perfil (COM-04):** cada persona, de cualquier rol, edita su propio
  nombre y apellido. Al guardar se llama a `refreshProfile()` del
  `AuthProvider` y la cabecera muestra el nombre nuevo. El formulario es de
  una columna en celular (390 px) y de dos a partir de `sm`.
- Los dos usan `updatePersonName` (`src/api/users.ts`, RPC
  `update_person_name`). Validación espejo en `updatePersonNameSchema`
  (obligatorios, máximo 100 caracteres, con espacios recortados). Los errores
  `FORBIDDEN`, `PROFILE_NOT_FOUND`, `NAME_REQUIRED` y `NAME_TOO_LONG` llegan
  como `ApiError` con el `message` del servidor en español y su `hint`.
- Desde ADM-27 la mutación invalida todo el caché de lecturas (el nombre
  aparece en casi todas las pantallas).

## AJ-02 y AJ-07 · «En camino» y «Llegada tarde»

`display_status` de `v_assignments_board` ahora puede valer `on_the_way` y
`late` (además de los anteriores). Mapa en `statusMap.ts`:

| Estado     | Variante | Etiqueta      | Fila de tabla            |
| ---------- | -------- | ------------- | ------------------------ |
| on_the_way | info     | En camino     | `info` (celeste pastel)  |
| late       | warning  | Llegada tarde | `warn` (amarillo pastel) |

- Si el empleado informó la hora, la fila muestra «llega ~HH:MM» (hora de
  Argentina, `last_notice_estimated_arrival_at`).
- **Un turno cancelado manda** sobre `on_the_way` y `late` (la vista no los
  excluye): `getAttendanceStatusBadgeInput` y `getAttendanceRowVariant`
  (`features/attendance/derive.ts`) los ignoran si `shiftStatus = cancelled`.
- Consumidores revisados: `statusMap.ts`, `StatusBadge`, `DataTable`
  (`rowVariant` con la variante nueva `info`), `ServicesTodayTable`,
  `AttendanceTodayList` (más los filtros «En camino» y «Llegada tarde»),
  `EmployeeAttendanceHistoryTab`, `kpis.ts`, `attention.ts`,
  `AttentionBlock`, `DashboardKpis` y la pantalla `/dev/design`.

### Cómo cuentan en el tablero (decisión a confirmar)

- **Llegada tarde = alerta amarilla.** Entra en «Requiere atención» como
  categoría `late` («llegó tarde: todavía no registró el inicio», con los
  minutos desde el inicio), última en el orden (después de las críticas), con
  las mismas acciones de fila (registrar en nombre, llamar). Suma a la tarjeta
  **Avisos** («2 ausencias · 1 demora · 1 llegada tarde»), pero solo si la
  asignación no tenía ya una demora avisada (esa ya cuenta en «demoras»), para
  no duplicar.
- **En camino = informativo.** No entra en «Requiere atención», no suma a
  «Sin registro» ni a «Avisos»: se menciona en el detalle de la tarjeta
  **Presentes** («en servicio ahora · 2 en camino»).
- «Sin registro» sigue contando solo `no_record` (pasados los 15 minutos de
  gracia).
- Si una asignación con demora avisada pasa a `late`, la insignia dice
  «Llegada tarde» (manda `display_status`); la demora avisada sigue contando
  en «demoras».

## AJ-03 · Horas en «Servicios de hoy»

Columna **Horas** (`worked_minutes`, formato `3 h 58 min`) en
`ServicesTodayTable` y en `AttendanceTodayList` (y en `RowCard` en celular).
`WorkedHoursCell` + `getWorkedHoursIndicator`:

- **Tilde verde** si `worked_minutes >= planned_minutes` **sin margen** y sin
  salida anticipada (`minutes_early_leave` nulo).
- **Advertencia** si trabajó menos o hubo salida anticipada, con el motivo
  como `title` y como texto para lector de pantalla («Faltan 1 min»,
  «Salida anticipada», o «Salida anticipada · faltan 1 h 2 min»).
- Sin fin registrado: «en curso» si ya hay inicio, guion si no.

## AJ-04 y AJ-05 · Calificación promedio

- **Listado de Empleados:** columna «Calificación» con `RatingSummary`:
  estrellas (`StarRating` de solo lectura, el promedio redondeado al entero
  más cercano), el número con una decimal y coma («4,3») y «(12
  calificaciones)». Sin calificaciones: «Sin calificaciones».
- **Ficha del empleado:** el mismo indicador en una tercera línea, debajo del
  nombre y el legajo.
- Fuente: `v_employee_ratings` en **una sola consulta** para todo el listado
  (`fetchEmployeeRatingsSummary`, mapa por `employee_id`; solo dueño y
  administradores). La ficha comparte esa consulta (mismo caché).
- La columna es **ordenable**; el orden se aplica a la lista completa antes de
  paginar (`sortByRating`), con los «sin calificaciones» al final de mayor a
  menor.

## AJ-06 · Pestaña Asistencia de la ficha (empleado y supervisor)

- Columna **Horas trabajadas** por turno (mismo indicador que AJ-03).
- **Total del período** Desde–Hasta, a la derecha de los selectores y a la
  misma altura (se acomoda en otra línea en celular).
- Botón **Descargar detalle** (solo dueño y administradores) que abre la hoja
  imprimible (ver más abajo).
- **Doble rol:** si la persona es supervisora, sus supervisiones
  (`v_supervisions_admin`, filtro `supervisor_id` + fechas, con
  `planned_minutes`/`worked_minutes`) se suman al mismo listado, ordenadas
  por fecha, con una columna **Tipo** (Servicio / Supervisión). El total del
  período suma ambas. Quien es solo empleado no ve la columna.
- La hoja incluye solo las filas con inicio registrado (trabajo efectivo o en
  curso), en orden cronológico; quedan afuera cancelados, ausencias y «sin
  registro» (decisión a confirmar).

## Hoja imprimible (`src/features/print/`)

Sin dependencias nuevas: portal pegado al `<body>` + CSS `@media print` +
`window.print()`. Desde el diálogo del navegador se imprime o se guarda como
PDF (el título del documento propone el nombre del archivo).

- `PrintSheet`: vista previa a pantalla completa con barra «Imprimir o
  guardar como PDF» / «Cerrar» (también cierra con Escape). Al imprimir,
  `print.css` oculta la app y la barra, fija A4 con márgenes de 15 mm y repite
  el encabezado de la tabla en cada página; las filas y las firmas no se
  parten entre páginas.
- `PrintableLetterhead`: membrete reutilizable (logo de `company_settings` /
  bucket `branding`, nombre, teléfono, título y «Emitido el …»).
- `PrintTable`, `PrintFacts`, `PrintSignatures`: piezas de la hoja.
- Hoja de asistencia (`AttendanceDetailSheet`, armada por
  `buildAttendanceSheet`): título «Detalle de asistencia», persona (nombre,
  legajo, rol), período, tabla (fecha, cliente, sede, franja, inicio, fin,
  horas), total, leyenda de conformidad y **dos firmas con aclaración**:
  «Responsable (administración)» y la persona.

## AJ-08 · «Finalizado» en verde

`completed` (turno) y `finished` (asignación) pasan a `success`, el mismo
verde de «Completada». Para que no se confunda con «En curso», el `in_progress`
del turno pasa de `success` a `primary` (igual que tareas y supervisiones).
«Presente» sigue en `success`. Cambio documentado en `07_Design_System.md`
sección 3 (a confirmar).

## AJ-09 · Resumen por cliente

Pestaña **Resumen de servicios** en la ficha del cliente
(`?pestana=resumen`, `ClientServiceSummaryTab`): selector Desde–Hasta (por
defecto del 1 del mes a hoy), tres tarjetas (turnos realizados, empleados
distintos, horas totales) y el detalle por turno (fecha, sede, franja,
empleados que trabajaron y horas). Fuente: `client_service_summary`, sin
polling. «Descargar resumen» abre la misma hoja membretada con el detalle
filtrado y **una sola firma** (responsable de administración): es un resumen
informativo, no hay una segunda parte que preste conformidad (decisión a
confirmar). Errores: `INVALID_DATE_RANGE` (también se valida en el cliente
antes de llamar), `CLIENT_NOT_FOUND` y `FORBIDDEN` se muestran con el
`message` del servidor.

## AJ-10 · Horas del mes en Clientes

Columna **Horas (mes)** en el listado (`clients_worked_minutes` del día 1 a
hoy en hora de Argentina; **una sola llamada** para todo el listado). El
encabezado y cada celda aclaran el período con un `title` («Horas de
octubre»); en tarjeta (celular) la etiqueta es «Horas de octubre». Sin trabajo:
«0 h».

## Pruebas

`statusMap.test.ts`, `StatusBadge.test.tsx`, `derive.test.ts` (estados nuevos,
fila, «llega ~HH:MM», horas y tilde), `kpis.test.ts`, `attention.test.ts`,
`detailSheet.test.ts` (armado de la hoja y total), `AttendanceDetailSheet.test.tsx`,
`EmployeeAttendanceHistoryTab.test.tsx`, `WorkedHoursCell.test.tsx`,
`ratingSummary.test.ts`, `serviceSummary.test.ts`,
`ClientServiceSummaryTab.test.tsx`, `ProfilePage.test.tsx`,
`permissions.test.ts` y los tests de `src/api/` de usuarios, calificaciones y
clientes.
