# Observaciones de uso del 12 de octubre — paquete A (pantallas)

## AJ3-04 · Próximos turnos en la ficha del empleado

- Pestaña `proximos-turnos` de ADM-17 (`EmployeeUpcomingShiftsTab`): turnos con asignación vigente desde hoy (hora de Buenos Aires) y los próximos 30 días, ordenados por fecha y hora.
- Datos: `fetchAssignmentsBoardByRange` con los filtros nuevos `employeeId` y `onlyActive` (descarta `removed_at`), vía `useEmployeeUpcomingAssignmentsQuery` (refresco cada 60 s). La RLS de `v_assignments_board` ya restringe a dueño y administrador.
- Columnas: fecha (enlace al detalle del turno), horario (con «A terminar»), cliente y sede, estado del turno (`StatusBadge`). DataTable pasa a RowCard en celular.
- Los turnos cancelados se muestran con el estado «Cancelado» (gris tachado), igual que en la planificación; las asignaciones quitadas no aparecen.

## AJ3-06 · Observación del turno a la vista

- El detalle del turno (`ShiftDetail`) es un único componente: lo usa el panel derecho (Sheet de escritorio) y la página en celular de `ShiftDetailPage`. Se abre desde el calendario mensual, la grilla semanal y la lista del día.
- `ShiftObservationSection`: para dueño y administrador, sección «Observación» siempre visible con el campo, la casilla «Mostrar en la impresión» (tildada por defecto) y «Guardar», con `update_shift_details`. Si el turno está cancelado o terminado la RPC no deja editar (`SHIFT_CANCELLED`, `SHIFT_COMPLETED`): ahí se muestra solo lectura, y solo si hay texto.
- «Editar dotación y notas» pasó a «Editar dotación» y el diálogo ya no tiene la observación. Como la RPC siempre reemplaza `p_notes`, el diálogo reenvía la observación actual para no borrarla.

## AJ3-03 · Editar el texto del informe en la vista previa

- `PrintSheet` (todas las hojas imprimibles pasan por él): botón conmutador «Editar texto» / «Terminar edición» (`aria-pressed`) y «Deshacer cambios».
- Al editar, el contenido de la hoja es `contentEditable` (el membrete no), con borde punteado y fondo suave que no salen en la impresión, y el aviso «Los cambios valen solo para esta impresión: no se guardan en la app.».
- Al empezar a editar se congela el contenido, así los refrescos de datos no pisan lo escrito; «Deshacer cambios» descarta la edición y vuelve a renderizar con datos actuales. Escape no cierra la vista previa mientras se edita.
- Imprimibles con edición: detalle de asistencia de la ficha del empleado (y su planilla del período) con `AttendanceDetailSheet`, y el resumen de servicio por cliente con `ClientSummarySheet`.
