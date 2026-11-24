# P30.4b · Fijos sin asignar y cronograma semanal (OH-06, OH-07)

Ficha del empleado (ADM-17), solo para quien administra turnos y horarios
(dueño o administrador con la capacidad). Se apoya en la migración `0087`
(P30.1): `employee_fixed_gaps`, `employee_fixed_pattern`,
`get_employee_week_board` y `save_employee_week_board`.

## OH-06 · Fijos sin asignar en el calendario

En la pestaña «Calendario», cada día muestra, además de los turnos
asignados, un bloque por cada turno de un servicio donde la persona es fija y
no quedó asignada.

- Mismo formato de tres casillas (inicio, fin, nombre de la sede), con
  **borde punteado** y fondo atenuado del color del cliente, más una línea con
  el motivo: «De licencia», «Se superpone con <sede> <horario>» (con enlace al
  turno del choque), «Quitado a mano», «Fijo agregado
  después de generar» y «Sin asignar».
- En los días de licencia (y feriado) la celda sigue pintada con el rótulo y
  los bloques punteados van debajo.
- **Reemplazar** abre `AssignEmployeeSheet` para ese turno, con los
  disponibles primero. No ofrece a la persona de la ficha ni a quienes ya
  están asignados al turno.
- **Asignar** (solo con motivo `REMOVED`, `ADDED_AFTER` o `NOT_ASSIGNED`)
  asigna a esta persona con `assign_employee`; si la base lo rechaza se
  muestra su mensaje de siempre y las advertencias no bloquean.
- No se arrastran ni se imprimen (la hoja impresa no cambia).
- La consulta cuelga de `planningKeys.all` (`['planning', 'fixedGaps', …]`):
  cualquier asignación, baja o cambio de turno la refresca; `staleTime` de 60 s.

Archivos: `src/api/employeeFixed.ts`, `src/features/employees/fixedGaps.ts`
(motivos y agrupado por día), `fixedQueries.ts`,
`components/FixedGapBlock.tsx`, y el cableado en `CalendarioMonthEditor.tsx` y
`EmployeeCalendarioTab.tsx`. `components/blockParts.tsx` reúne las piezas
compartidas con la pizarra (colores del bloque y casilla de hora editable).

## OH-07 · Cronograma semanal (pizarra)

En la cabecera de la ficha, debajo de las estrellas (en celular, a todo el
ancho debajo de la cabecera): «Cronograma semanal» con la aclaración
«Referencia de los turnos fijos. Los cambios no modifican el calendario».

- Tabla de lunes a domingo (la base usa `weekday` 0 = domingo a 6 = sábado;
  `src/features/employees/weekBoard.ts` hace la conversión) con bloques de tres
  casillas en el color del cliente. En pantallas angostas la tabla se
  desplaza horizontalmente dentro de su caja.
- Primera vez (`get_employee_week_board` devuelve `null`): se arma con
  `employee_fixed_pattern`, un bloque por servicio y día; si el servicio no se
  presta todas las semanas se agrega «(1.ª y 3.ª)» al nombre. Se avisa
  «Armado desde los fijos (todavía sin guardar)» y no se guarda hasta el primer
  cambio.
- Edición libre: arrastrar entre días (puntero, no táctil), tocar las horas
  (`TimeInput`) o el nombre para editarlos en el lugar, menú del bloque
  (Duplicar, Cambiar color con los 12 colores del cliente, Mover a… para el
  celular, Borrar) y «+» por día. Máximo 60 bloques y 80 caracteres por nombre,
  como valida el servidor.
- Cada cambio se guarda entero con `save_employee_week_board` tras 600 ms sin
  cambios (y al salir de la pantalla). Estados: «Guardando…» y «Editado por
  <nombre> el <fecha>, <hora>». El mensaje de `INVALID_BOARD` se muestra tal
  cual.
- «Volver a cargar desde los fijos» pide confirmación, rehace la pizarra con el
  patrón actual y la guarda.
- No toca turnos, asignaciones ni el calendario.

Archivos: `components/WeekBoard.tsx` (`WeekBoardPanel`), `weekBoard.ts`
(lógica pura) y `src/pages/admin/EmployeeDetailPage.tsx`.

## Pruebas

`weekBoard.test.ts`, `fixedGaps.test.ts`, `src/api/employeeFixed.test.ts`,
`components/CalendarioFixedGaps.test.tsx` y `components/WeekBoard.test.tsx`.
