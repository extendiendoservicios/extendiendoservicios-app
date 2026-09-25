# `tests/e2e-assignments`

e2e de asignaciones y cronograma (ASSIGN-015, ASSIGN-016, TEST-008 — `08_Fases_y_Backlog.md`
F11, encargo P11.4) contra un backend real (`App_dev`): asignar hasta completar la dotación desde
el calendario mensual y verla en la grilla semanal, quitar con motivo y volver a "Programado",
superposición rechazada con su mensaje y la marca "Se superpone con…" en ADM-08, un turno
cancelado que conserva sus asignaciones (cierra el pendiente de `12_Registro_de_Progreso.md`),
asignar desde la lista del día en celular (390 px), la advertencia `NOT_ENABLED_FOR_CLIENT` sin
bloquear, y el rendimiento del calendario mensual con 600 turnos (menos de 1 s).

## Por qué está separada de las demás suites de backend real

Mismo motivo que `tests/e2e-shifts-services/` y el resto (ver sus propios README): necesita
`SUPABASE_SERVICE_ROLE_KEY` para armar y limpiar clientes, sedes y turnos descartables sin gastar
pasos de interfaz en algo que no es lo que cada spec prueba. A diferencia de esas suites, esta
**no** invoca ninguna Edge Function desde el navegador (las cuatro RPC de asignaciones y
`cancel_shift` son funciones de Postgres directas): no hace falta el puerto 5173 que exige el
CORS de `admin-users`, así que usa uno propio (4176, ver `helpers/baseUrl.ts`).

## Fechas: cercanas a hoy, salvo el test de rendimiento

Esta suite inserta siempre turnos puntuales directo con la clave de servicio (nunca
`generate_shifts`, que sí abarca TODO el sistema): por eso, a diferencia de
`tests/e2e-shifts-services` (que reserva el mes lejano 2190 justamente por ese riesgo), los specs
funcionales de acá usan fechas relativas a "hoy" (mañana, pasado mañana...) sobre un cliente y una
sede propios y descartables — no hay forma de que un turno puntual de un cliente fixture
contamine el mes real de nadie más. Solo `month-performance.spec.ts` (ASSIGN-016) reserva un mes
lejano propio (noviembre de 2191, distinto del 2190 de `e2e-shifts-services`), porque ahí sí
importa que el mes entero no tenga turnos reales con los que competir por la medición.

## Cómo correrla

Desde `app/`, con `.env.local` completo:

```bash
pnpm test:e2e:assignments                      # los dos proyectos (chromium, mobile)
pnpm test:e2e:assignments --project=chromium   # uno solo
```

`pnpm test:e2e:assignments` corre `pnpm build` primero (carga `.env.local` con la convención de
Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` en el
puerto 4176.

## Organización

- `helpers/env.ts`, `helpers/login.ts` — mismo patrón que el resto de suites de backend real.
- `helpers/baseUrl.ts` — puerto propio 4176 (ver arriba).
- `helpers/adminClient.ts` — cliente con la clave de servicio: cliente/sede/turno de
  precondición (`E2E-P114`), limpieza sin borrado físico (sede inactiva, cliente cerrado), y
  `markShiftCancelledDirectly` para el caso puntual del turno fixture fechado "hoy" (ver la nota
  de esa función).
- `helpers/nearDates.ts` — "hoy" y "hoy + n días" en hora de Argentina, sin `date-fns`; el mes
  lejano reservado para ASSIGN-016.
- `helpers/monthPicker.ts` — copia de `tests/e2e-shifts-services/helpers/monthPicker.ts` para
  navegar el `MonthPicker` de ADM-03 por año.
- `helpers/noHorizontalScroll.ts` — comprobación mecánica de scroll horizontal.
- `assign-until-full-and-remove.spec.ts` (ASSIGN-015 punto 1) — asigna dos empleados hasta
  completar la dotación (el turno pasa a Asignado), lo ve en la grilla semanal (ADM-04), quita
  uno con motivo y vuelve a Programado.
- `overlap-and-warning.spec.ts` (ASSIGN-015 puntos 2 y 5) — superposición rechazada con el
  mensaje exacto y la marca "Se superpone con…"; `NOT_ENABLED_FOR_CLIENT` visible sin bloquear
  (inserta una fila propia en `employee_client_permissions`, borrada físicamente al final: esa
  tabla no tiene baja lógica, es una habilitación pura).
- `cancelled-shift-keeps-assignments.spec.ts` (ASSIGN-015 punto 3) — arma la asignación con
  `assign_employee` real y cancela con `cancel_shift`: la asignación queda vigente
  (`removed_at` nulo) para historial. Cierra el pendiente que `tests/e2e-shifts-services`
  (P10.4) no pudo probar porque `assign_employee` todavía no existía. Limpieza propia: como
  `remove_assignment` rechaza el turno cancelado con `SHIFT_CANCELLED` (es justo lo que este
  spec comprueba), la asignación se libera directo con la clave de servicio DESPUÉS de la
  comprobación (`releaseAssignmentAfterCancelledShift`, ver el comentario en
  `helpers/adminClient.ts`), para no dejar a un empleado real del seed con una asignación
  vigente en la fecha de fixture de corrida en corrida.
- `mobile-day-list-assign.spec.ts` (ASSIGN-015 punto 4, proyecto `mobile`) — desde ADM-05 en 390
  px, entra a un turno con "Ver" y asigna un empleado desde la página completa de ADM-06, sin
  scroll horizontal.
- `month-performance.spec.ts` (ASSIGN-016) — 600 turnos en un mes lejano reservado (2191-11),
  medición con `performance.now()` del navegador entre la respuesta de `v_shifts_board` y el
  primer chip pintado. Los 600 turnos se BORRAN FÍSICAMENTE al final (ver "Independencia y
  limpieza" más abajo). Método y resultado también documentados en
  `docs/features/asignaciones-y-cronograma.md`.

## Independencia y limpieza

Prefijo `E2E-P114` en la razón social del cliente y el nombre de la sede, distinto del de las
demás suites de backend real. Sin borrado físico salvo la fila de `employee_client_permissions`
que crea `overlap-and-warning.spec.ts` (tabla sin baja lógica, ver el comentario ahí) y los 600
turnos de `month-performance.spec.ts`.

**Corrección de esta revisión (qa-pruebas, al retomar P11.4)**: el diseño original dejaba esos 600
turnos en la tabla ("no molestan a nada real por estar tan lejos en el tiempo", mismo criterio que
`tests/e2e-shifts-services`) -- válido para un cliente/sede con baja lógica, pero un defecto real
para ESTE spec en particular: como reutiliza siempre el mismo mes (2191-11), cada corrida sin
borrar sumaba 600 turnos más al mismo rango de fechas, y la corrida siguiente medía un mes cada
vez más poblado (encontrado en vivo: 6 corridas sin limpiar dejaron 3.600 turnos en 2191-11, y la
consulta a `v_shifts_board` para ese rango pasó de un resultado rápido a **6033 ms** ella sola,
antes de que el navegador pintara nada). El encargo de P11.4 pide explícitamente "creados y
borrados por el propio test": ahora `month-performance.spec.ts` borra sus 600 turnos con la clave
de servicio (bypassa RLS) en el `finally`, antes de cerrar el cliente/sede.

## Qué no cubre (para el orquestador)

- La suite de permisos completa por API directa de las cuatro RPC de asignaciones
  (`assign_employee`, `remove_assignment`, `update_assignment_time`, `update_shift_details`) vive
  en `tests/permissions/` (`employee.permissions.ts`, `supervisor.permissions.ts`,
  `admin.permissions.ts`), no acá: esta carpeta es solo por interfaz.
- La variante "por interfaz" de los permisos (botón oculto) no se agregó: `06_API.md` sección 8
  no da a empleado ni a supervisor ningún botón que pudiera aparecer indebidamente en ADM-06 (el
  componente ya condiciona todo a `canManageAssignments`/`canManageAssignmentsAfterStart`, que
  usan los mismos roles que la RPC) -- quedaría para TEST-019 (F18) si se quiere una prueba
  explícita de que el botón no aparece.
- Lighthouse, accesibilidad y la revisión sistemática a 768/1024/1366/1440 px son de F17
  (RESP-*).
