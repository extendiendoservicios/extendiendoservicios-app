# Ajustes de la reunión del 9 oct 2026 · paquete D (P19.6)

Dos ajustes: **AJ2-04** (banco, CBU y alias de clientes y empleados) y
**AJ2-15** (observación del turno con la casilla «Mostrar en la impresión»).
La base está en la migración `0040` (ver `docs/database.md`); acá va la parte
de pantallas.

## AJ2-04 · Datos bancarios

**Quién los ve.** Dueño y administrador, en el formulario y en la ficha del
cliente y del empleado (sección «Datos bancarios»). El empleado ve los suyos,
solo lectura, en «Más» del celular. El supervisor no los ve nunca (la RLS de
las tablas aparte se lo impide: no es solo ocultar en pantalla).

**Código.**

- `src/api/bankDetails.ts`: `fetchClientBankDetails`, `fetchEmployeeBankDetails`
  (tablas `client_bank_details` y `employee_bank_details`, solo `select`) y
  `setClientBankDetails`, `setEmployeeBankDetails` (RPC; cada llamada reemplaza
  los tres campos). Los errores `INVALID_CBU`, `INVALID_ALIAS`,
  `BANK_NAME_TOO_LONG`, `CLIENT_NOT_FOUND`, `PROFILE_NOT_FOUND` y `FORBIDDEN`
  llegan como `ApiError` con el `message` del servidor.
- `src/features/bank/schemas.ts`: validación espejo (CBU de 22 dígitos, se
  acepta con espacios, guiones o puntos; alias de 6 a 20 caracteres con
  letras, números, punto y guion; banco hasta 100). `bankFormValuesToInput`
  manda el CBU solo con dígitos y los vacíos como `null`.
- `src/features/bank/queries.ts`: hooks de lectura y de escritura (sin
  polling, son lecturas de ficha o formulario).
- Componentes: `BankDetailsFields` (campos del formulario, el CBU se agrupa
  «8 + 14» mientras se escribe), `BankDetailsCard` (ficha en lectura, con
  «Sin datos bancarios cargados.» si no hay nada) y `BankDetailsList`.

**Cómo se guardan.** Los datos bancarios no van en el `insert`/`update` del
cliente o del empleado: primero se crea o edita el registro y después se llama
a la RPC.

- Alta: si falló la RPC, el cliente o la persona ya existe; se avisa con una
  advertencia («Se creó …, pero no se guardaron los datos bancarios: …») y se
  va a la ficha para cargarlos de nuevo desde Editar.
- Edición: si falló, se avisa y se queda en el formulario.
- No se llama a la RPC si los tres campos están vacíos y no había datos
  guardados, ni si falló la lectura de lo guardado (para no pisar nada).
- En edición el formulario espera a que cargue la lectura de los datos
  bancarios antes de mostrarse.

**Pantallas.** `ClientFormPage` (ADM-20), `ClientDetailPage` (ADM-21),
`EmployeeFormPage` (ADM-18, alta y edición), `EmployeeDetailPage` (ADM-17,
pestaña «Datos») y `pages/app/MorePage` (EMP-13): «Mis datos bancarios» solo
aparece si la persona los tiene cargados.

## AJ2-15 · Observación del turno

La observación vive en `shift_observations` (solo dueño y administrador);
`shifts.notes` quedó vacía y en desuso. El front ya no la lee de `shifts.notes`.

- **Lectura:** `fetchShiftDetail` trae la observación por el embebido
  `shift_observations(observation, show_in_print)`; el tablero y la edición
  la leen de `v_shifts_board.notes` y `v_shifts_board.show_in_print`.
  `show_in_print` en `null` es «sin observación» (la casilla se muestra
  tildada).
- **Escritura:** `createShift` manda `p_show_in_print` (por defecto `true`);
  `updateShiftDetails` lo manda solo si se indica. Formularios: turno nuevo,
  edición del turno (ADM-07) y el diálogo «Dotación y observación del turno»
  del detalle (ADM-06). El rótulo «Notas» / «Notas administrativas» pasó a
  «Observación». Componente común: `ShiftObservationField`.
- **Detalle (ADM-06):** la sección «Observación» indica si se muestra o no en
  la impresión.
- **Imprimibles:** la observación va en la columna «Observaciones», unida con
  « · » a lo que ya iba (inasistencia, «Sin salida»), con `joinObservations`
  (`features/shifts/observation.ts`).
  - Detalle de asistencia: `v_assignments_board.shift_observation`
    (`AttendanceBoardRow.shiftObservation`).
  - Resumen de servicios del cliente: `client_service_summary` →
    `shifts[].observation`; en las inasistencias, `shiftObservation`.
  - La base ya manda `null` si la casilla está destildada, así que el front
    no filtra nada.
- **No** se muestra en el celular. Las notas anteriores a la migración
  quedaron con la casilla destildada (decisión de Mike).

## Tests

`api/bankDetails.test.ts`, `features/bank/schemas.test.ts`,
`features/bank/components/BankDetails.test.tsx`,
`features/shifts/observation.test.ts`,
`features/shifts/components/ShiftObservationField.test.tsx`,
`features/attendance/detailSheetObservation.test.ts`,
`features/clients/serviceSummaryObservation.test.ts`, y ajustes en
`api/assignments.test.ts`, `api/shifts.test.ts`, `features/shifts/schemas.test.ts`,
`features/planning/schemas.test.ts` y `pages/app/MorePage.test.tsx`.
