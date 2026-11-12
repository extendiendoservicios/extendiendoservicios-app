# P28.4 · Los cambios del servicio llegan a los turnos y aviso de duplicados

Observaciones de la dirección del 11 de noviembre (OF-05 y OF-02). Backend: migración `0082` (`preview_service_changes`, `apply_service_changes`, `service_overlaps`, `shift_overlaps_in_site`). Cliente: `src/api/services.ts` y `src/api/overlaps.ts`; lógica en `src/features/services/serviceChanges.ts`.

## OF-05 · «¿Aplicar los cambios a los turnos desde el [fecha]?»

Pantalla: ADM-25 (`ServiceFormPage`), modo edición. Reemplaza el aviso viejo «Los turnos ya generados no cambian».

- Al guardar, si cambió algo que llega a los turnos (días, semanas del mes, horario, «A terminar», dotación, «Trabaja los feriados», vigencia o fotos) y el servicio queda **activo**, se abre `ApplyServiceChangesDialog`.
- La vista previa sale de `preview_service_changes` y se calcula **después de guardar** (la RPC trabaja con los valores ya guardados del servicio). Muestra cuántos turnos se borran, se actualizan, se crean y se saltean, con un detalle desplegable por sección y el motivo de cada uno en lenguaje claro (mensajes del servidor: «Es feriado y el servicio no trabaja feriados.», «El turno se creó a mano, no desde el servicio.», etc.).
- La fecha es elegible y por defecto es hoy; al cambiarla se recalcula la vista previa.
- «Aplicar» llama a `apply_service_changes(service_id, from_date, p_previous)`. `p_previous` son los valores del servicio **antes de guardar**: `{start_time, end_time, open_ended, required_staff, requires_photos}`. El servidor solo actualiza los turnos que todavía tenían esos valores; los que tienen otros se consideran cambiados a mano y se conservan.
- «No aplicar» deja los turnos como están.
- Si la vista previa no trae nada para cambiar (y no cambiaron los fijos), no se muestra el diálogo: aparece un aviso breve y se sigue.
- El resumen final repite los conteos y lista lo que se saltó, los empleados quitados por el cambio de horario y los fijos que no se pudieron asignar en los turnos nuevos.

### Un solo diálogo con los fijos (OD-11) y con generar (OD-27)

- Si cambiaron los fijos **y** otros campos: un solo diálogo, una sola fecha. «Aplicar» corre primero `apply_service_changes` y después `apply_service_fixed_employees` con la misma fecha. Se eligió ese orden porque los fijos se validan (licencias, superposiciones) contra el horario ya corregido, y los turnos nuevos ya salen con los fijos guardados. El resumen final junta las dos partes; si fallan los fijos, se dice que lo del servicio sí se aplicó.
- Si solo cambiaron los fijos: queda el diálogo de OD-11 de siempre.
- Si además se reactivó el servicio, después del diálogo anterior sigue «¿Generar los turnos de este mes?» (OD-27). Como mucho, dos diálogos seguidos.

### «Actualizar turnos desde…»

Botón en el aviso de la parte de arriba del formulario de edición del servicio. Corre la misma vista previa y aplicación **sin** `p_previous`: el servidor fuerza los valores del servicio en todos los turnos que siguen. Sirve para reparar casos como Lutova (dotación) y Foster (horario viejo, feriados). Se desactiva si el formulario tiene cambios sin guardar, porque trabaja con lo guardado.

## OF-02 · Aviso de duplicados

- **Servicio** (alta y edición): antes de guardar se llama a `service_overlaps`. Si hay otro servicio activo en la misma sede que coincide en algún día y se superpone en horario, se pregunta «Ya existe “X” en esta sede los lunes y martes de 15:00 a 17:00. ¿Guardar igual?». Con varios, se listan. No bloquea. En la edición solo se consulta si cambió la sede, los días, el horario o si el servicio vuelve a estar activo; los servicios pausados o finalizados no se revisan.
- **Turno suelto** (ADM-07, alta, sin «Repetir este turno»): antes de crear se llama a `shift_overlaps_in_site`: «Esta sede ya tiene el turno “X” ese día de 12:30 a 14:30. ¿Crear igual?» (o «un turno cargado a mano» si no tiene servicio). No bloquea.
- Si la consulta falla, se guarda igual: el aviso es solo ayuda.

## Pruebas

`serviceChanges.test.ts` (cálculo de `p_previous`, qué cambios preguntan, textos), `ApplyServiceChangesDialog.test.tsx` (vista previa, aplicar, orden con fijos, errores, reparación), `ServiceFormPage.test.tsx` (flujo completo y duplicados) y `ShiftFormPage.test.tsx` (duplicados del turno).
