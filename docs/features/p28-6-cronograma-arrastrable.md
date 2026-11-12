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

## Sin arrastre

- Menú del bloque (⋮): «Mover o cambiar horario…» (día y horas en un diálogo) y «Quitar del turno».
- Teclado: con el bloque enfocado, flechas arriba/abajo mueven 15 minutos, izquierda/derecha cambian de día, Mayús + flecha arriba/abajo cambia el fin; Enter confirma y Escape cancela.
- Celular: el bloque se arrastra desde el asa (⋮⋮) para no quitarle el desplazamiento a la página; la grilla se desplaza en horizontal (`min-w-[760px]`).

## Validaciones, avisos y deshacer

- Cada cambio pasa por las validaciones del servidor. Los errores se muestran con el mensaje tal cual (OF-08) y, si traen el turno de choque, con el enlace «Ver turno».
- Las advertencias de la respuesta (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`) se muestran como aviso; no bloquean.
- «Deshacer» en el aviso de éxito: turno entero, vuelve a la fecha y horario anteriores; pasar a otro turno, vuelve a llamar a `move_assignment` con `previous`; horario propio, restituye el horario anterior; asignar, quita la asignación. Quitar del turno no se deshace.
- Después de cada cambio se invalidan las consultas de planificación (`['planning']`: cronograma, asignaciones, cobertura) y de turnos (`['shifts']`).

## Código

- `src/features/employees/cronogramaWeek.ts`: lógica pura (ajuste a 15 minutos, mover, estirar, turno entero o persona, sin cubrir, deshacer).
- `src/features/employees/cronogramaCommands.ts`: comando por RPC y acción inversa.
- `src/features/employees/components/CronogramaWeekEditor.tsx`: la vista.
- `src/api/assignments.ts`: `moveAssignment`.
- Sin librería de arrastre: eventos de puntero propios (mouse, lápiz y touch).
