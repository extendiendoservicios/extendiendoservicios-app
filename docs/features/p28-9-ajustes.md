# P28.9 · Ajustes después del pase de P28 (administración)

Frontend de OF-21, OF-22, OF-23, OF-05b y OF-08b. La base es la migración `0084` (P28.9a); el contrato está en `docs/database.md`.

## OF-21 · «Repetir este turno» avisa duplicados

Al crear la repetición (`ShiftFormPage`), antes de llamar a `create_shift_series` se piden las fechas con `preview_shift_series` y se consulta `shift_overlaps_in_site` por cada una (`fetchShiftOverlapsForDates` en `src/api/overlaps.ts`). La RPC recibe un solo día, así que son consultas en paralelo, de a 6 como máximo (`OVERLAP_PARALLEL_LIMIT`). Si una consulta falla, esa fecha cuenta como sin coincidencias: no bloquea.

Con coincidencias se abre «Posibles turnos duplicados» con una línea por turno («El mar 18/11 ya hay “X” de 08:00 a 12:00»; sin servicio: «un turno cargado a mano») y tres salidas:

- **Repetir igual**: crea toda la serie, como siempre.
- **Sacar esas fechas**: una sola llamada a `create_shift_series` con `p_exclude_dates` (las fechas con coincidencias; `excludeDates` en `ShiftSeriesRule`), todo en una transacción. Se deshabilita si todas las fechas están duplicadas.
- **Cancelar**: no crea nada.

Sin coincidencias, sigue como antes.

## OF-22 · Cierre automático en las hojas imprimibles

`client_service_summary` trae `check_out_auto_closed` por empleado (`checkOutAutoClosed` en `ClientSummaryEmployee`). Las hojas imprimibles con hora de fin fichada son dos:

- **Detalle de asistencia de la persona** (`detailSheet.ts`, columna «Fin»): el fin de un cierre automático lleva «*» (fuente: `v_assignments_board.check_out_auto_closed`).
- **Resumen de servicios del cliente** (`serviceSummary.ts`): esta hoja no imprime la hora de fin, así que la marca «*» va en la celda de «Horas», que depende de ese fin.

En ambas, si hay al menos un caso, el modelo trae `notes: ['* Cierre automático: no se registró el fin.']` y la hoja la imprime antes de las firmas. Texto y marca en `src/features/print/autoClosed.ts`. Las demás hojas (calendario, licencias, cronograma, control de stock) no muestran horas fichadas.

## OF-23 · «Solo a <nombre>» crea el turno destino

En el cronograma arrastrable (`CronogramaWeekEditor`), el diálogo «¿Mover el turno para todos o pasar solo a…?» suma siempre la opción «Crear un turno nuevo en <sede> el <día> de HH:MM a HH:MM y pasar a <nombre>» (si no hay otro turno de la sede ese día es la única, y ya no se explica que no se puede). Llama a `move_assignment_to_new_shift` (`moveAssignmentToNewShift` en `src/api/assignments.ts`, comando `move_new_shift`). El turno nuevo puede venir sin servicio (turno manual) si el servicio ya tiene turno ese día: el cliente no asume `service_id`. Los errores salen con el mensaje del servidor y «Ver turno» (OF-08); la advertencia `HOLIDAY` del turno nuevo se suma a las del pase.

**Deshacer**: devuelve a la persona con `move_assignment` al turno y horario de `previous` y después borra el turno creado con `owner_delete_shift`, que es solo de la dirección (P27). Quien no es la dirección no ve «Deshacer» en esta acción (igual que en «Quitar»).

## OF-05b · Cambio solo de dotación no crea turnos

`preview_service_changes` y `apply_service_changes` reciben `p_create_missing`. `ServiceFormPage` manda `false` cuando no cambiaron días, semanas del mes, «trabaja feriados» ni vigencia (`serviceChangesCanAddShifts`); `ApplyServiceChangesDialog` lo recibe como `createMissing` y entonces el texto dice «No se crean turnos nuevos» en lugar de prometerlos. «Actualizar turnos desde…» (sin cambios conocidos) lo deja en `true`.

## OF-08b · «Ver turno» en licencias y supervisiones

- **Licencias** (`EmployeeLeavesTab`): `get_leave_conflicts` suma `service_id`, `service_name` y `detail`. Después de guardar una licencia, cada turno de la lista muestra el servicio (o «Turno cargado a mano») y «Ver turno» (`/admin/turnos/:id`, con `conflictLink.tsx`), que reemplaza al viejo «Abrir turno». `LeaveConflict` trae también `message` (el texto del servidor).
- **Supervisiones**: `assign_supervision` ya no se llama desde el frontend (está revocada desde P24.3; el coordinador usa `take_supervision`), así que no hubo cambios de pantalla.
