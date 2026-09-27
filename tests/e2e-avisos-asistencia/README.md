# `tests/e2e-avisos-asistencia`

Suite e2e de avisos del empleado y de asistencia administrativa (ABS-007/ATT-015/TEST-011, P14.4,
`08_Fases_y_Backlog.md` F14), contra un backend real (`App_dev`). Mismo criterio que las demás
suites de backend real de esta carpeta: en su propia carpeta porque necesita
`SUPABASE_SERVICE_ROLE_KEY` para armar y limpiar un empleado, un cliente y varias sedes/turnos
descartables (prefijo `E2E-P144`).

## Qué cubre cada archivo

- `employee-notices.spec.ts` (ABS-007, móvil 390 px): el empleado avisa una demora (minutos,
  siempre presentes por el `Stepper`) y una ausencia (motivo obligatorio; texto obligatorio si el
  motivo es "Otro"); se rechaza avisar sobre un servicio cuya hora de inicio ya pasó
  (`TOO_LATE_TO_NOTIFY`, aunque nunca se haya registrado el check-in); Hoy (EMP-03) muestra el
  texto del aviso vigente (ABS-005); el propio aviso NO enciende "Cambios desde tu última visita"
  (P-092, 0028).
- `admin-attendance.spec.ts` (ATT-015, escritorio 1280 px): registra el inicio en nombre del
  empleado "por teléfono" con motivo y hora editada; una hora futura se rechaza con el mensaje
  debajo del campo (validación de cliente, antes de llegar al servidor); cierra una asignación sin
  fin (`close_assignment`, "cierre manual"); ADM-10 muestra "Sin registro" para una asignación
  pasada la hora de inicio sin check-in; avisa una ausencia en nombre del empleado (P-073, después
  del inicio efectivo); la línea de tiempo de ADM-06 muestra el registro y el aviso con quién los
  cargó ("lo cargó `<nombre>`"); ADM-12 (pestaña de ADM-17) muestra el historial completo.
- `admin-attendance-mobile.spec.ts` (ATT-016, móvil 390 px): ADM-10 se ve como tarjetas (sin
  encabezados de tabla, sin scroll horizontal) y el panel "Registrar en nombre" (ADM-11) ocupa
  toda la pantalla; se completa un registro de inicio real para confirmar que también funciona a
  este ancho.

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables que el resto de suites de
backend real):

```bash
pnpm test:e2e:avisos-asistencia
```

Puerto 5173 (mismo que el resto de las suites de backend real): no se puede correr en paralelo
con `pnpm dev` en la misma máquina.

## Cuidado con la hora

Todos los turnos de fixture usan horas relativas a "ahora" en hora de Argentina (nunca fechas u
horas fijas): los fines se recortan a 23:59 si hiciera falta (`shifts_time_range_check` exige
`end_time > start_time` en el mismo día). Dos guardas simétricas, ambas con `test.skip` y un
motivo explícito:

- Los specs que necesitan un turno "que todavía no empezó" (varios minutos en el futuro, mismo
  `shift_date`) se saltean si faltan menos de 45-90 minutos para la medianoche de Argentina: un
  turno no puede cruzar de fecha, así que no hay margen para esa fixture a último momento del día.
- Los specs que arman varios turnos "que ya empezaron" (offset negativo) para el MISMO empleado se
  saltean si todavía no pasaron 25-40 minutos desde las 0:00 de Argentina: un offset negativo mayor
  a los minutos ya transcurridos se recorta a las 0:00 (`argentinaTimeWithOffset`) y dos turnos
  distintos pueden terminar con la misma hora de inicio, se superponen entre sí y
  `assign_employee` los rechaza (`ASSIGNMENT_OVERLAP`) -- hallazgo propio de esta suite,
  reproducido en vivo contra `App_dev` a las 00:0x de Argentina (ver el reporte del encargo P14.4).

## Independencia y limpieza

Cada test crea su propio empleado (cuenta descartable, sin pasar por la Edge Function
`admin-users`), su propio cliente, sus propias sedes y sus propios turnos de HOY. Al terminar, el
empleado queda baneado e inactivo y el cliente/las sedes quedan de baja lógica -- sin borrado
físico, mismo criterio que el resto de suites de backend real. Los turnos, `attendance_records` y
`attendance_notices` de fixture no se tocan: quedan fechados hoy, con un cliente ya cerrado.
