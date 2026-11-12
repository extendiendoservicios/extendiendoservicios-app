# P28.3 · Observaciones de la dirección del 11 de noviembre (administración)

Frontend de OF-01, OF-04, OF-08, OF-14, OF-17 (complemento), OF-19, OF-19b y OF-20. La base es la migración `0082` (P28.1); el contrato está en `docs/database.md`.

## OF-01 · Precio por defecto 0

Alta de artículo (`SupplyFormScreen`): costo y venta arrancan en `0` y ya no son obligatorios; vacío se guarda como 0 (`supplyValuesToInput`). El esquema (`src/features/stock/schemas.ts`) sigue validando que, si se escribe algo, sea un monto válido con hasta dos decimales. El diálogo de cambio de precios usa el mismo campo.

## OF-14 · Aviso a administradores sin «Gestionar stock»

`StockScreen` muestra arriba, con discreción, «Para cargar o modificar insumos, pedile a la dirección la capacidad Gestionar stock.» cuando entra un administrador sin `manage_stock`. A la dirección y a quien ya tiene la capacidad no se les muestra. Sigue siendo solo un aviso: el servidor vuelve a verificar.

## OF-04 · Listado de servicios con detalle

`ServiceList` (pestaña Servicios del cliente y sección Servicios de la sede) agrega por servicio:

- los empleados fijos;
- el turno de hoy o el próximo no cancelado (hasta 35 días adelante), con su estado y quién está asignado, con el estado de cada asignación;
- la marca «Sin cubrir» y «Faltan N de M» cuando el turno tiene menos asignados que su dotación.

Una sola tanda de consultas por lista, sin importar cuántos servicios haya (`src/api/serviceCoverage.ts`): `service_fixed_employees`, `v_shifts_board` y `v_assignments_board`, las tres con `in(...)`. Hook `useServicesCoverageQuery` (clave `['services', 'coverage', ids]`, refresco cada 60 s, se invalida con cualquier cambio de servicio).

## OF-19 y OF-19b · Feriados

- El alta manual y «Cargar feriados nacionales» usan la RPC `upsert_holiday` (solo la dirección): crea, reactiva uno dado de baja o actualiza el nombre. Una fecha dada de baja ya no queda trabada.
- Después de crear un feriado a mano se consulta `holiday_shift_conflicts`. Si hay turnos sin historia de servicios que no trabajan feriados, se abre «Hay N turnos ese día de servicios que no trabajan feriados. ¿Eliminarlos?» con la lista (servicio, cliente, sede, horario y personas asignadas). «Eliminar los turnos» llama a `remove_holiday_shifts` y avisa lo borrado y lo salteado por tener historia. Solo se ofrece con la capacidad `cancel_shifts` (la dirección la tiene siempre); sin ella se ve la lista y se indica qué capacidad hace falta.
- Código: `HolidayFormDialog`, `HolidayShiftConflictsDialog`, `src/api/settings.ts` (`createHoliday`, `fetchHolidayShiftConflicts`, `removeHolidayShifts`).

## OF-20 · Licencias superpuestas

Se quitó el mapeo de `LEAVE_OVERLAP`; el formulario no tenía validación propia de superposición. Con dos licencias el mismo día:

- el cronograma del empleado muestra todas en la celda (`VACACIONES / ENFERMEDAD`);
- el calendario mensual junta los motivos de la persona (`leaveReasonOn`);
- la hoja de licencias y ausencias cuenta una sola vez los días comunes (`totalLeaveDaysInPeriod`).

## OF-08 · Mensajes que dicen dónde choca

`ApiError` ahora trae `detail` (`ConflictDetail`): el servidor manda en `error.details` (texto JSON) o en el campo `detail` de cada rechazo los datos del choque. Se muestra el `message` tal cual (ya dice «Acosta ya está en YPF RUTA (…) el lun 9/11 de 15:00 a 17:00.» o «Boutter tiene licencia (Vacaciones) del 3 al 10/11.») y, si viene `conflictShiftId`, el enlace «Ver turno» (`ConflictShiftLink`, o la acción «Ver turno» del aviso) abre ese turno en `/admin/turnos/:id`. Aplica a: asignar empleado, franja propia de la asignación, alta de turno (individual y repetido), edición de turno (fecha y asignados), generación del mes (fijos sin asignar) y fijos en lote. En cada resumen sigue apareciendo el mensaje por empleado.

## OF-17 (complemento)

- `WeekGrid` ya tenía contenedor con desplazamiento y ancho mínimo (`min-w-[760px]`): no se tocó.
- `CountLinesTable`: ancho mínimo de 480 px dentro de su contenedor con desplazamiento.
- `ControlSheet`: en pantalla, contenedor con `overflow-x-auto`; en papel `print:overflow-visible`, la impresión no cambia.
- El `DataTable` general lo cambia P28.2.
