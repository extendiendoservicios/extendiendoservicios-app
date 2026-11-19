# P30.3b · Licencias, turnos pasados y cambios del servicio (OH-08 a OH-11)

Observaciones de la dirección del 18 nov 2026 (`modulos/P30_observaciones_de_la_duena_18_nov.md`). Base: migración `0087`.

## OH-08 · Las licencias liberan los turnos

Pantalla: pestaña «Licencias» de la ficha del empleado (`EmployeeLeavesTab`).

1. Al tocar **Guardar** (alta o cambio) se llama a `save_employee_leave` con `p_preview = true`.
2. Si la vista previa no libera ni toca nada, se guarda directo.
3. Si hay turnos, se abre un diálogo: **«Se van a liberar N turnos de <nombre>»** con la lista (fecha, horario, cliente y sede, servicio) y, aparte, **«Estos N turnos tienen fichajes y no se tocan»**. **Confirmar** llama sin vista previa; **Cancelar** no guarda nada.
4. Después de guardar, si hubo turnos liberados, un aviso lista los que **quedaron sin cubrir**, cada uno con **Reemplazar** (abre `AssignEmployeeSheet`, que ya ordena a los disponibles primero) y «Ver turno». Al asignar a alguien, el turno sale de la lista.
5. La baja lógica sigue igual (`update` de `deleted_at` y `updated_by`). Borrar o acortar una licencia **no** vuelve a asignar.

Se invalidan las consultas de la licencia, la ficha y el listado de empleados, la planificación, los turnos del día, la asistencia y los avisos/atención (`useSaveEmployeeLeaveMutation`).

Se eliminó el aviso anterior basado en `get_leave_conflicts` (`useLeaveConflictsMutation`, `fetchLeaveConflicts`, `createEmployeeLeave`, `updateEmployeeLeave`).

## OH-09 · Turno pasado: «Registrar como realizado»

Pantalla: alta de turno (`/admin/turnos/nuevo`, `ShiftFormPage`).

- Si la fecha y la hora de fin ya pasaron (hora de Argentina, `isShiftPast`), aparece el aviso **«Este turno ya pasó»** y el botón principal pasa a **«Registrar como realizado»**, que llama a `register_past_shift`.
- En ese modo «Repetir este turno» y «A terminar» quedan deshabilitados con su explicación (hace falta la hora de fin y no hay repetición). Con «A terminar» y una fecha ya pasada se explica que hay que desmarcarlo para registrarlo como realizado.
- Exige al menos una persona. Quien tiene licencia ese día se puede elegir (en un día pasado la licencia no bloquea) y se avisa al guardar.
- Las advertencias que devuelve el servidor (feriado, licencia) salen en un aviso. Si una persona falla, **no se guarda nada** y se muestra el mensaje del servidor.
- Solo dueño y administración con «Gestionar asistencia» (`canRegisterPastShift`). Quien no puede ve la explicación y el botón deshabilitado.
- Al terminar vuelve al día del turno en Planificación.

## OH-10 · «Ya hay un turno»

- El aviso de superposición del alta (OF-02) se reemplazó por `ExistingShiftDialog`: muestra el turno que ya existe (fecha, horario, cliente y sede, servicio y asignados) con **«Editar ese turno»** (`/admin/turnos/:id/editar`), **«Crear igual»** y **«Cancelar»**. Si hay varios turnos superpuestos se muestra el primero.
- Si el servidor devuelve `SHIFT_DATE_TAKEN` (servicio con turno ese día) se muestra el mismo diálogo con el turno del `detail`, **sin «Crear igual»** (el servicio no admite dos turnos el mismo día). No se ofrece «Crear sin servicio»: el alta de turno de esta pantalla no elige servicio, así que ese caso no se da desde acá.
- «Editar ese turno» reemplaza la entrada del historial, así «atrás» desde la edición no vuelve al formulario de alta.

## OH-11 · Editar el servicio: gana el último cambio

`ApplyServiceChangesDialog` y `serviceChanges.ts` dejaron de hablar de turnos «cambiados a mano que se conservan». La vista previa y el resultado dicen, por ejemplo, **«Se actualizan 12 turnos, 3 de ellos tenían cambios a mano que se reemplazan»**, y cada turno actualizado lista los campos con cambios a mano («Tenía cambios a mano en el horario y la dotación: se reemplazan»). Siguen sin tocarse los turnos cancelados, los cargados a mano sin servicio, los empezados y los que tienen historia.

## Pruebas

- `src/features/employees/components/EmployeeLeavesTab.test.tsx`, `src/api/employees.test.ts` (OH-08).
- `src/pages/admin/ShiftFormPage.test.tsx`, `src/features/shifts/pastShift.test.ts`, `src/features/shifts/existingShift.test.ts`, `src/api/shifts.test.ts` (OH-09 y OH-10).
- `src/features/services/serviceChanges.test.ts`, `src/features/services/components/ApplyServiceChangesDialog.test.tsx`, `src/api/services.test.ts` (OH-11).
