# Ajustes de la reunión del 9 oct 2026 · paquete B (P19.6)

Rama `feat/AJ2-B-pantallas-admin`. AJ2-09 (tope de horas) y AJ2-10 (turnos «A
terminar»). La base (migraciones 0037 y 0038) hace las cuentas; el front
muestra lo que viene. Esta página cubre la parte de **administración**; la del
celular va aparte.

## Reglas que ve la persona

- **A terminar.** Un servicio o un turno puede no tener hora de fin. La base lo
  guarda con fin 23:59 y la marca `open_ended`; en pantalla se muestra siempre
  «A terminar» (`formatShiftRange` y `OPEN_ENDED_LABEL` de
  `features/shifts/openEnded.ts`), nunca 23:59.
- **Tope.** Las horas de cada empleado cuentan solo lo que cae dentro de su
  franja (la propia de la asignación, si la tiene; si no, la del turno). El
  front muestra `worked_minutes` tal cual, sin recalcular. Las horas de los
  supervisores no llevan tope.
- **Sin salida.** Pasadas las 23:59, un empleado de un turno «A terminar» (sin
  fin propio) que no fichó la salida queda «Sin salida» con 0 horas, hasta que
  un administrador cargue la hora con «Registrar en nombre de».

## Qué cambió en pantalla

- **Servicio (ADM-25).** Debajo de Desde/Hasta hay una casilla «A terminar (sin
  hora de fin)». Tildada, «Hasta» pasa a decir «A terminar» y no se valida el
  fin. Al editar se puede tildar y destildar. La lista de servicios dice
  «08:00 a A terminar».
- **Turno (ADM-07).** Misma casilla al crear y al editar. En edición se puede
  pasar un turno a «A terminar» y volver a ponerle fin. Un turno «A terminar» ya
  **finalizado** se puede abrir en edición solo para ponerle la hora de fin (el
  inicio queda fijo y no se tocan dotación ni notas); las horas se recalculan
  con el tope. El detalle del turno (ADM-06) muestra el botón «Poner hora de
  fin» en ese caso.
- **Franja propia de una asignación (ADM-06 / ADM-08).** En un turno «A
  terminar» alcanza con el inicio propio: sin fin propio la asignación sigue «A
  terminar»; con fin propio queda con tope y ya no puede quedar «Sin salida».
  Un fin propio sin inicio propio se rechaza.
- **Horarios en todo el admin.** Lista del día, calendario, grilla semanal,
  detalle del turno, asignar empleado (incluye los conflictos del día),
  asistencia de hoy, ficha del empleado, tablero, supervisiones y el resumen
  del cliente con su hoja imprimible dicen «A terminar» en vez de 23:59.
- **Horas y tilde.** Con `planned_minutes` nulo (asignación «A terminar») la
  celda «Horas» muestra solo lo trabajado: sin tilde verde ni advertencia
  «Faltan X». Con «Sin salida» muestra 0 con una advertencia.
- **Estado «Sin salida».** `StatusBadge` (dominio asignación) suma
  `no_checkout` con la etiqueta «Sin salida» (variante de advertencia). Las
  filas de asistencia de ese estado se pintan en amarillo.
- **Tablero (ADM-02).** «Requiere atención» suma la categoría `noCheckout`
  («<nombre> quedó sin salida: cargá la hora para cerrar sus horas»), ordenada
  después de «sin registro» y antes de las ausencias. Ya no se confunde con
  «sigue en curso pasada su hora de fin». La lista del día muestra
  «· n sin salida» junto a la dotación del turno.
- **Resumen del cliente (ADM-21) y hoja imprimible.** La franja de los turnos
  abiertos dice «A terminar»; quien quedó sin salida figura con 0 h y la
  observación «Sin salida»; una nota arriba cuenta los turnos «A terminar»
  (`totals.open_ended_shifts`). Las horas previstas de turnos abiertos no suman
  (la base manda `planned_minutes` nulo).

## Código

- API: `shifts.ts` (`openEnded`, `noCheckoutCount`; `createShift` y
  `updateShiftTime` mandan `p_open_ended`), `services.ts` (`open_ended` en
  insert y update), `assignments.ts` (`effective_open_ended`, detalle del turno,
  conflictos), `attendance.ts`, `supervisions.ts` (`shift_open_ended`),
  `clients.ts` (`open_ended_shifts`, `open_ended` y `no_checkout` por empleado).
  `p_end` se manda en `'23:59:00'` con «A terminar» porque el tipo generado lo
  pide; la base lo ignora.
- Esquemas: `shifts/schemas.ts`, `services/schemas.ts` y `planning/schemas.ts`
  (`buildAssignmentTimeSchema(openEnded)`). Con «A terminar» no se pide el fin
  ni se lo compara con el inicio, y el inicio no puede ser 23:59.
- Componente nuevo del dominio: `shifts/components/OpenEndedToggle.tsx`.
- Derivaciones: `attendance/derive.ts` (`plain` y `no_checkout` en
  `getWorkedHoursIndicator`), `dashboard/attention.ts` (`noCheckout`).

## Pruebas

Vitest: esquemas (turno, servicio, franja propia), `derive` (indicador de
horas, etiqueta y color de «Sin salida»), `attention` (categoría `noCheckout`),
`serviceSummary` (hoja con «A terminar» y «Sin salida»), API (`create_shift` y
`update_shift_time` con `p_open_ended`, mapeo de las columnas nuevas) y
`StatusBadge`.
