# P31.3 · Calendarios del empleado y del Calendario general (OI-01, OI-02, OI-04, OI-06, OI-12 y D-03)

Observaciones de la dirección del 23 nov 2026
(`modulos/P31_observaciones_de_la_direccion_23_nov.md`). Se apoya en la
migración `0088` (P31.1). Todo es administración: dueño y administradores.

## D-01 · Fijos sin asignar: sin turnos cubiertos ni pasados

`employee_fixed_gaps` ya no devuelve turnos con la dotación completa, pasados,
cancelados ni finalizados, y desaparece el motivo `SHIFT_FULL`. En el front se
quitó el motivo de `FixedGapReason`, de `describeGap` («Turno completo») y de
los tests. Un motivo desconocido cae en «Sin asignar».

## D-05 · El color es el del cliente

Una sola fuente: `clients.calendar_color`.

- **Calendario del mes:** ya usaba el color del cliente. El menú ⋮ de cada
  tarjeta suma **«Cambiar color del cliente»**.
- **Cronograma semanal (pizarra):** cada tarjeta se pinta con el color de su
  cliente. El cliente de una tarjeta sale de su servicio (`serviceId`) cruzado
  con `employee_fixed_pattern`. `blocksFromPattern` arma las tarjetas sin
  color y, al guardar, los bloques con cliente se mandan con `color_index`
  `null` (`withoutClientColors`).
- **Tarjetas sin cliente** (agregadas con «+», o de un servicio que ya no es
  fijo de la persona) conservan su color propio y su opción «Cambiar color»
  de siempre.
- **Cambiar el color del cliente:** el menú ofrece los 12 colores de la paleta;
  elegir uno abre la confirmación «Cambia el color de RAESA en todos los
  calendarios.» y recién al confirmar hace `update clients set calendar_color`
  (`setClientCalendarColor`). Después invalida las consultas de planificación,
  turnos, clientes, empleados y calendario del empleado
  (`useSetClientCalendarColorMutation`).

Archivos: `features/planning/components/ClientColorChange.tsx`,
`features/employees/weekBoard.ts` (`clientsByService`, `boardBlockColor`,
`withoutClientColors`), `components/WeekBoard.tsx`,
`components/CalendarioMonthEditor.tsx`.

## D-06 · Eliminar turno

Reusa `OwnerDeleteDialog` (OD-22: solo la dirección; si el turno tiene
historia, el diálogo lo explica y no deja confirmar). «Eliminar turno» está en:

- el menú ⋮ de la tarjeta del calendario del mes del empleado;
- la tarjeta punteada del fijo sin asignar (`FixedGapBlock`);
- la fila de Calendario › Día (`ShiftsDayList`), como ícono de papelera en
  escritorio y botón con texto en celular.

En Calendario › Semana y › Mes los turnos son enlaces al detalle del turno
(sin menú): ahí se elimina desde «Eliminar turno» de la ficha del turno
(`DeleteShiftAction`), que ya existía. Al borrar se refrescan todas las
consultas afectadas (las invalida `useOwnerDeleteMutation`).

## D-07 · Editar el horario de un turno finalizado

Dueño y administradores pueden cambiar inicio y fin (no la fecha) de un turno
finalizado:

- **Ficha del turno:** «Editar horario» (en un turno «A terminar» finalizado
  sigue siendo «Poner hora de fin»). Abre `/admin/turnos/:id/editar`, que para
  un turno finalizado muestra solo Desde y Hasta: sin fecha, dotación ni
  notas, y guarda únicamente `update_shift_time`.
- **Calendario › Día:** el lápiz «Editar» también aparece en turnos finalizados.
- **Calendario del empleado:** las casillas de hora de una tarjeta finalizada
  se editan en el lugar. Mover el bloque a otro día muestra «Este turno ya
  terminó: solo se puede cambiar el horario, no la fecha.» sin llamar al
  servidor (`completedDateChangeBlocked`); el servidor lo vuelve a rechazar con
  `SHIFT_COMPLETED`.
- Ningún front compara el texto de `SHIFT_COMPLETED`: la lógica usa el `hint`
  y el mensaje se muestra tal cual.
- Después de guardar se refrescan turnos, planificación, asistencia y tablero
  (las horas trabajadas se recalculan en la base con la franja nueva).

## D-08 · Observaciones del calendario del mes

Pestaña «Calendario» de la ficha del empleado, solo para quien administra.

- Un botón **«+»** en cada día agrega una observación (texto de 1 a 500, color
  opcional de la paleta de los clientes). Puede haber varias por día.
- Cada observación tiene menú ⋮: **Editar**, **Cambiar color** (incluye «Sin
  color») y **Eliminar** (con confirmación).
- Salen en la hoja impresa del mes, en su día y con su color, debajo de los
  turnos (también en días de licencia o feriado). El «+» y el menú no se
  imprimen.
- No las ve el empleado ni aparecen en el Calendario general.

Archivos: `api/employeeCalendarNotes.ts`, `features/employees/calendarNotes.ts`,
`notesQueries.ts`, `components/CalendarNoteParts.tsx`, `cronograma.ts`
(`CronogramaDay.notes`) y `components/CronogramaGrid.tsx` (impresión).

## D-03 · Finalizar o pausar un servicio

En `ChangeServiceStatusDialog`, al elegir «Pausado» o «Finalizado»:

- **Dirección:** casilla marcada por defecto «Eliminar los turnos de este
  servicio desde <mañana>», con selector de fecha. Al confirmar cambia el
  estado y después llama a `owner_delete_service_shifts` (con el nombre del
  servicio como confirmación). Informa «Eliminamos N turnos. Quedaron M turnos
  por tener historia.» Si la eliminación falla, el estado ya quedó cambiado y
  se avisa con el mensaje del servidor.
- **Administrador:** en lugar de la casilla, el aviso «Quedan N turnos
  futuros. La dirección puede eliminarlos.» (N sale de
  `countServiceShiftsFrom`, porque la vista previa de borrado es solo de la
  dirección).
- Los textos de efecto de «Pausado» y «Finalizado» ya no dicen que los turnos
  no se tocan cuando se eliminan.

Archivos: `features/services/statusShifts.ts` y
`components/ChangeServiceStatusDialog.tsx`.
