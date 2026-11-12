# P28.6 · Cronograma arrastrable (OF-10)

Pestaña «Cronograma» de la ficha del empleado (ADM-17), vista **Semana (editar)**. Solo la ven el dueño y los administradores (`canManageAssignments` y `canManageShiftTime`); los coordinadores y la vista mensual (la que se imprime) no cambian.

## Qué se puede hacer

| Acción                       | Cómo                                                            | RPC                                                                                     |
| ---------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mover un turno de día u hora | Arrastrar el bloque                                             | `update_shift_time` (turno entero)                                                      |
| Cambiar el horario           | Arrastrar el borde superior o inferior                          | `update_shift_time` (turno entero)                                                      |
| Pasar solo a esta persona    | Misma acción, con más de una persona asignada                   | `move_assignment` (otro turno) o `update_assignment_time` (mismo turno, horario propio) |
| Asignar un turno sin cubrir  | Arrastrar desde el panel lateral a la grilla, o botón «Asignar» | `assign_employee`                                                                       |
| Quitar del turno             | Menú del bloque, con motivo obligatorio                         | `remove_assignment`                                                                     |

Los horarios se ajustan a 15 minutos y, durante el arrastre, un recuadro punteado muestra el horario resultante.

## Turno entero o solo esta persona

- Si la persona es la única asignada, se mueve el turno entero sin preguntar.
- Si hay más personas, se pregunta: «¿Mover el turno para todos o pasar solo a <nombre> a otro horario?». «Solo a» ofrece como destino el mismo turno (horario propio, solo si el día no cambia) y los otros turnos de la misma sede ese día. Si no hay ninguno, queda deshabilitado y se explica por qué.

### Turno entero con franja propia (P28.7b, DEF-P28-02)

El bloque dibuja la franja propia de la persona cuando es distinta de la del turno (por ejemplo, turno 08:00–12:00 y persona 09:00–11:00). Al mover o estirar el turno entero NO se copia el horario del bloque al turno (eso lo achicaba): se calcula cuánto se corrió cada borde y ese mismo corrimiento se aplica al horario del turno (`wholeShiftChange`), sin salirse del día y sin bajar de 15 minutos. Mover solo de día conserva el horario del turno.

La franja propia de la persona acompaña el mismo corrimiento (se actualiza con `update_assignment_time` después de `update_shift_time`): así sigue dentro del turno y se ve igual que lo que se arrastró. Si no tiene franja propia, no se toca. En un turno «A terminar» solo se corre el inicio. «Deshacer» restituye el turno y también la franja propia.

## Sin arrastre

- Menú del bloque (⋮): «Mover o cambiar horario…» (día y horas en un diálogo) y «Quitar del turno».
- Teclado: con el bloque enfocado, flechas arriba/abajo mueven 15 minutos, izquierda/derecha cambian de día, Mayús + flecha arriba/abajo cambia el fin; Enter confirma y Escape cancela.
- Celular: el bloque se arrastra desde el asa (⋮⋮) para no quitarle el desplazamiento a la página; la grilla se desplaza en horizontal (`min-w-[760px]`).

## Validaciones, avisos y deshacer

- Cada cambio pasa por las validaciones del servidor. Los errores se muestran con el mensaje tal cual (OF-08) y, si traen el turno de choque, con el enlace «Ver turno».
- Las advertencias de la respuesta (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`) se muestran como aviso; no bloquean.
- «Deshacer» en el aviso de éxito: turno entero, vuelve a la fecha y horario anteriores; pasar a otro turno, vuelve a llamar a `move_assignment` con `previous`; horario propio, restituye el horario anterior; asignar, quita la asignación. Quitar del turno no se deshace.
- Después de cada cambio se invalidan las consultas de planificación (`['planning']`: cronograma, asignaciones, cobertura) y de turnos (`['shifts']`).

## Panel «Turnos sin cubrir» (P28.7b)

- Con muchos turnos (en `App_dev` ≈150) la lista no crece sin tope: altura máxima con scroll propio (20 rem en celular, 32 rem en escritorio).
- En celular el panel viene plegado («Mostrar» / «Ocultar»); el título muestra la cantidad.
- Filtro por texto (sede o cliente, sin distinguir tildes ni mayúsculas) y por día de la semana (`filterUncoveredShifts`).
- El arrastre con el mouse no selecciona texto (DEF-P28-03: `select-none` y `preventDefault` al empezar a arrastrar); en pantallas táctiles chicas los ítems no bloquean el desplazamiento.

## Aviso «Ver turno» con hojas abiertas (P28.7b, DEF-P28-01)

Radix pone `pointer-events: none` en el `body` mientras hay una hoja o un diálogo modal, y el Toaster lo heredaba. Ahora el Toaster lleva `pointer-events-auto` y `SheetContent` y `DialogContent` ignoran los toques sobre `[data-sonner-toaster]` (`ignoreToasterInteraction`), así la hoja no se cierra antes de que el botón del aviso reciba el clic. Al tocar «Ver turno» desde `AssignEmployeeSheet` o `AssignmentTimeDialog` se cierra la hoja y se navega.

## Código

- `src/features/employees/cronogramaWeek.ts`: lógica pura (ajuste a 15 minutos, mover, estirar, turno entero o persona, sin cubrir, deshacer).
- `src/features/employees/cronogramaCommands.ts`: comando por RPC y acción inversa.
- `src/features/employees/components/CronogramaWeekEditor.tsx`: la vista.
- `src/api/assignments.ts`: `moveAssignment`.
- Sin librería de arrastre: eventos de puntero propios (mouse, lápiz y touch).
