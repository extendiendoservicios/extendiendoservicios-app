# P30.4a · Calendario editable del empleado (OH-04, OH-05, OH-03)

Pestaña **Calendario** de la ficha del empleado (ADM-17). Antes se llamaba «Cronograma» y tenía dos vistas, «Mes» (solo lectura) y «Semana (editar)». Ahora hay una sola: el mes, editable. La palabra «Cronograma» queda reservada para la tabla semanal de OH-07 (otro paquete).

## Qué cambia

- **Nombre (OH-04).** La pestaña, los textos y el valor de la dirección pasan a `?pestana=calendario`. El valor viejo `cronograma` se acepta como alias, así los enlaces guardados siguen andando.
- **Mes en la dirección (OH-03).** El mes elegido vive en `?pestana=calendario&mes=2027-01`. Cambiar de mes reemplaza la entrada del historial (`replace`); al abrir un turno y volver con «Volver» o con el botón del navegador se queda en el mismo mes. Un `mes` roto o ausente muestra el mes actual. Al cambiar de pestaña se borra `mes`. La lógica del parámetro está en `calendarioMonth.ts` y la maneja la página (`EmployeeDetailPage`); cuando exista el hook común de P30.3 se unifica.
- **Solo el selector de mes (OH-05).** Desaparecen «Semana (editar)» y el selector Mes/Semana.

## El mes editable

Solo lo edita quien tiene `canManageAssignments` y `canManageShiftTime` (dueño y administradores). Los demás ven el mismo calendario de solo lectura y sin panel.

- **Bloque de tres casillas** por turno: hora de inicio, hora de fin y nombre de la sede, con el fondo del color del cliente (`clientChipColors`) en todo el bloque y una separación leve del bloque siguiente del mismo día. Feriados y licencias se pintan igual que en la hoja.
- **Hora en el lugar.** Se toca la hora de inicio o de fin y se edita con `TimeInput`. Enter o salir de la casilla confirman; Escape cancela. Un turno «A terminar» no tiene hora de fin editable. Si el fin queda antes o igual al inicio se muestra el error y no se llama al servidor.
- **Alcance.** Igual que en la semana: si la persona es la única asignada se cambia el turno entero (`update_shift_time`); si hay más, se pregunta «para todos» o «solo a esta persona» (`update_assignment_time`, `move_assignment` o `move_assignment_to_new_shift`, OF-23). Mismos mensajes y «Deshacer».
- **Nombre del cliente.** Abre el detalle del turno (`/admin/turnos/:id`, ADM-06) para editar el resto. También está en el menú del bloque como «Abrir el turno».
- **Arrastrar a otro día.** Con el mouse se arrastra un bloque a otro día: se mueve manteniendo el horario exacto y con las mismas preguntas de alcance que la semana (OF-10, OF-23). El día de destino se resalta mientras se arrastra.
- **Sin arrastre en pantallas táctiles.** Con el dedo los cambios se hacen tocando: las horas, el nombre del cliente y el menú del bloque («Mover o cambiar horario…», «Abrir el turno», «Quitar de este turno»). El menú es también la vía sin arrastre en escritorio.
- **Panel «Turnos sin cubrir del mes».** A la derecha (plegado en el celular), con todos los turnos del mes con dotación incompleta que todavía no terminaron. Filtro por texto y por día; se arrastran al calendario o se asignan con «Asignar» (`assign_employee`, con las advertencias de siempre).
- **Quitar.** «Quitar de este turno» abre el diálogo con motivo (`RemoveAssignmentDialog`).

## Impresión

«Imprimir» abre la misma hoja en A4 horizontal de siempre (`CronogramaGrid`: título del mes, líneas de firma, legajo y nombre). La grilla editable es otra pieza (`CalendarioMonthEditor`); la hoja impresa no se tocó. Lo único que cambia es el título del documento: «Calendario - <nombre> - <mes>».

## Archivos

- `src/features/employees/components/EmployeeCalendarioTab.tsx`: la pestaña (datos, selector de mes, imprimir).
- `src/features/employees/components/CalendarioMonthEditor.tsx`: el mes editable (bloques, edición en el lugar, arrastre, comandos y avisos).
- `src/features/employees/components/CalendarioDialogs.tsx`: `ScopeDialog` y `MoveDialog`.
- `src/features/employees/components/UncoveredPanel.tsx`: el panel de turnos sin cubrir.
- `src/features/employees/components/CronogramaGrid.tsx`: la hoja impresa (sin cambios de formato).
- `src/features/employees/calendarioMonth.ts`: lógica pura (mes en la dirección, día bajo el puntero, mover de día, validar una hora).
- `src/features/employees/cronogramaWeek.ts` y `cronogramaCommands.ts`: lógica de alcance, deshacer y comandos, reutilizada. Se quitó lo que solo usaba la grilla semanal (ajuste a 15 minutos, estirar bordes, rango de horas).

## Backend

Sin cambios: `update_shift_time`, `update_assignment_time`, `move_assignment`, `move_assignment_to_new_shift`, `assign_employee` y `remove_assignment` ya existen (P28).
