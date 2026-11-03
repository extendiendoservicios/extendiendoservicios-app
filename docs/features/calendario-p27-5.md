# Calendario de Planificación: ajustes de la reunión del 2 de noviembre (P27.5)

Paquete P27.5, observaciones OD-12 a OD-17. Sin migraciones: todo sale de las vistas y funciones que ya existen.

## OD-12: filtros en las tres vistas

Mes, semana y día comparten los cuatro filtros: cliente, sede, empleado y estado.

- El estado de los filtros vive en la URL de `/admin/planificacion`: `?cliente=&sede=&empleado=&estado=`. Por eso se conservan al cambiar de vista y quedan en el enlace.
- Lógica en `src/features/planning/calendarFilters.ts`; el hook es `useCalendarFilters` y la barra, `CalendarFiltersBar` (la misma en las tres vistas).
- Cambiar el cliente limpia la sede.
- **Mes**: sin cambios en la consulta (`v_shifts_board` con los filtros del servidor).
- **Semana**: cliente, sede y empleado van a `v_assignments_board`. El estado es el del turno (`display_status`, con «Sin cubrir» y «Próximo»), que esa vista no trae: se pide el tablero de turnos con los mismos filtros y se dejan las asignaciones de esos turnos. La búsqueda por nombre sigue.
- **Día**: la lista del día se filtra en el cliente por cliente, sede y estado (se conserva el refresco de 30 s si la fecha es hoy). El empleado se resuelve con una consulta aparte de sus turnos del día.

## OD-13: colorear por estado en el día

En «Colorear por: Estado» (por defecto), la celda «Cliente · sede» de la vista de día lleva el color del estado, el mismo del chip del mes. «Cliente» sigue pintando con el color del cliente y el estado en el puntito.

## OD-14: licencias en el calendario

Se leen con `fetchLeavesInRange` (`employee_leaves` vigentes que tocan el rango).

- **Mes**: una línea punteada por día («Licencia: Ana Gómez» o «3 licencias», con los nombres en el título) y el conteo en la lista del celular.
- **Semana**: la celda del día de licencia dice «Licencia».
- **Día**: bloque «De licencia (n)» con los nombres.
- Con un empleado filtrado se ven sus turnos y sus licencias. Con cliente, sede o estado filtrados y sin empleado no se muestran licencias: no pertenecen a un cliente, una sede ni un estado de turno. Sin filtros, todas.

## OD-15: imprimir calendario

Botón «Imprimir calendario» en cada vista, con lo que está filtrado en pantalla. Encabezado con el título de la vista y los filtros aplicados («Cliente: …· Estado: …» o «Sin filtros»).

- `CalendarPrintButton` monta la hoja en un portal pegado al `<body>`, llama a `window.print()` y la desmonta con `afterprint`.
- `calendarPrint.css` define la página con nombre: `@page calendario { size: A4 landscape; margin: 10mm }` y `page: calendario` sobre la hoja. No toca el `@page` general (A4 vertical) de `features/print/print.css`.
- Al imprimir se oculta todo lo que cuelga del `<body>` salvo la hoja (`body:has(> .calendar-print-portal)`).
- La hoja es una versión estática de cada vista (`CalendarPrintViews.tsx`): sin recortes («+n más» no existe en papel), con el estado escrito al lado del color para que se lea en blanco y negro.

## OD-16: asignar desde «Editar turno»

`/admin/turnos/:id/editar` (el mismo panel al que lleva «Editar franja» del detalle) suma la sección «Empleados asignados» con el mismo `EmployeeMultiPicker` del alta:

- Muestra quiénes ya están asignados y deja sumar más hasta completar la dotación (el tope baja con lo ya asignado y sube si se aumenta la dotación en el mismo formulario).
- Quien está de licencia ese día no se puede elegir.
- Al guardar, primero se actualiza el turno y después se llama a `assign_employee` de a uno (`assignEmployeesOnEdit`). Lo que el servidor rechaza o avisa (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`) se muestra en un aviso con el `message` tal cual; no deshace el guardado del turno.
- Quitar a alguien sigue siendo desde el detalle del turno (exige motivo).
- Después del inicio del turno la sección solo aparece con `manage_attendance`, como en el detalle.

## OD-17: llegada tarde

En «Servicios de hoy» del Resumen y en «Asistencia de hoy», la celda «Inicio real» va con fondo amarillo y la píldora «Llegada tarde» (el mismo `StatusBadge` del estado `late`) cuando el fichaje de inicio es posterior al inicio programado de la asignación (`effective_starts_at`).

- Sin tolerancia, pero comparando **al minuto**: se descartan los segundos de los dos instantes. La celda muestra «HH:mm», así que un fichaje a las 08:00:40 contra un inicio de 08:00 no se marca (diría «08:00» igual que el horario).
- Lógica en `isLateArrival` (`src/features/attendance/derive.ts`); la celda es `CheckInCell`.

## OD-26: acciones en las tres vistas

«Generar turnos del mes» y «Nuevo turno» salieron de la vista de mes (y de la de día) a una barra común en `PlanningPage`, a la derecha del selector Mes/Semana/Día. Se ven en mes, semana y día, también en celular y tablet. Debajo de 640 px quedan como íconos con el texto solo para lectores de pantalla (`max-sm:sr-only`) y la barra envuelve sin desbordar. En la vista de día «Nuevo turno» conserva `?fecha=`. Los permisos son los de siempre (`canGenerateShifts`, `canManageShiftTime`).
