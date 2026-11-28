# Agenda (P37, AG-01 a AG-25)

Pizarra mensual de la dirección: `/admin/agenda` (ADM-40), solo dueños y administradores. Reemplaza la agenda de papel. Especificación: `Docs/Plan_Maestro/modulos/P37_agenda.md`. Base de datos: migraciones 0092 (pizarra) y 0093 (lista diaria).

## Qué hay en pantalla

- **Calendario** (AG-04): lunes a domingo, número de día automático, feriados en rojo (`useHolidaysQuery`), días de otros meses atenuados, eventos como bloques con su borde y relleno y «+N» si no entran. Tocar un día abre `AgendaDayDialog`, con un formulario por evento (Trabajo, Hora, Lugar, Cliente/Persona, Personas, Observación, fecha para moverlo de día, colores, Resuelto, Duplicar al mes siguiente, Eliminar con confirmación).
- **Sugerencias** (AG-07): `SuggestInput` ofrece sedes, clientes y empleados, pero acepta cualquier texto. No guarda vínculos. «Personas» completa solo el último valor separado por coma.
- **Nuevos** (AG-08 y AG-09): siete columnas con «+» al pie; el bloque se edita en un diálogo (incluye la columna). «Crear cliente» abre `/admin/clientes/nuevo` con nombre, dirección y observación precargados.
- **Notas** (AG-10): renglones con viñeta y check, edición en el mismo renglón, colores, Duplicar y Eliminar.
- **Colores** (AG-11): `agendaColors.ts`, 20 colores (10 saturados y sus pasteles) más el verde «resuelto» (índice 20, el `--success` de la plataforma). El texto se elige por contraste (AA). `AgendaColorPicker` tiene los grupos «Borde» y «Relleno» y «Sin color».
- **Resuelto** (AG-12): el servidor pone el relleno en verde y lo devuelve al destildar.
- **Lista de empleados** (AG-15 y AG-21 a AG-25): todo el personal activo por legajo (2 dígitos; 3 si pasa de 99), con renglón fijo, turnos y licencias del día (automáticos, por hora) y renglones libres (agregar, editar, subir, bajar, borrar). Los coordinadores suman su jornada y supervisiones (solo lectura, con enlace al detalle). Desde cada turno se puede «Cambiar horario» (`AssignmentTimeDialog`) y «Cancelar turno» (`CancelShiftDialog`, con motivo y capacidad `cancel_shifts`; avisa si el turno tiene otras personas). «Copiar para WhatsApp» arma el texto del parte (`whatsappText.ts`) y, si el portapapeles falla, lo muestra en un diálogo.
- **Calculadora** (AG-18): `calculator.ts` (lógica pura) y `AgendaCalculator`; también con el teclado cuando tiene el foco.
- **Imprimir** (AG-19): hoja A4 apaisada con membrete, calendario, Nuevos y Notas; reusa la hoja `calendar-print-portal` de Planificación (`print-color-adjust: exact`).
- **Celular** (AG-20, menos de 768 px): lista de días con eventos y mini grilla para saltar; Nuevos en una columna; luego Notas, Lista de empleados y Calculadora.

## Código

- `src/api/agenda.ts`: lecturas por PostgREST (`agenda_items`, `agenda_employee_colors`, `agenda_staff_lines`, `v_employees`, `employee_leaves`, `shift_observations`) y RPC (`save_agenda_item`, `delete_agenda_item`, `set_agenda_item_resolved`, `duplicate_agenda_item_to_next_month`, `mark_agenda_item_client`, `set_agenda_employee_color`, `set_agenda_employee_fixed_line`, `save_agenda_staff_line`, `delete_agenda_staff_line`). Errores tipados con `ApiError` (`hint`: `AGENDA_ITEM_NOT_FOUND`, `INVALID_COLOR`, `INVALID_BUDGET`, `INVALID_DATE`, `INVALID_SLOT`, `EMPTY_AGENDA_ITEM`, `INVALID_AGENDA_TEXT`, `TEXT_TOO_LONG`, `STAFF_LINE_NOT_FOUND`, `EMPLOYEE_NOT_FOUND`, `CLIENT_NOT_FOUND`).
- `src/features/agenda/`: `schemas.ts` (zod), `queries.ts` (claves `['agenda', ...]`, sondeo de 60 s), `agendaMonth.ts` (grilla del mes), `dailyList.ts` y `whatsappText.ts` (lista diaria y parte), `calculator.ts`, `clientPrefill.ts` y `components/`.
- La edición de un evento, bloque o nota manda siempre el elemento completo: el servidor reemplaza todos los campos.

## Precarga del alta de cliente (AG-09)

La Agenda navega a `/admin/clientes/nuevo` con `location.state = { agendaPrefill: { agendaItemId, legalName, adminAddress, notes, returnTo } }`. `ClientFormPage` lo lee con `readAgendaClientPrefill` (solo en el alta), precarga razón social, dirección y notas y, al crear el cliente, llama a `mark_agenda_item_client` y vuelve a `returnTo` (la Agenda en el mismo mes). Si el vínculo falla, el cliente igual queda creado y se avisa.

## Pruebas

`agendaColors`, `calculator`, `dailyList` (orden por legajo, formato, parte de WhatsApp con el ejemplo del grupo), `agendaMonth`, `schemas`, `clientPrefill` y los componentes `AgendaCalculator` y `AgendaColorPicker`.
