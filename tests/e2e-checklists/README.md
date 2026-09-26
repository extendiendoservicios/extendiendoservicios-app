# `tests/e2e-checklists`

e2e de checklists y tareas (TASK-004 a TASK-009, TEST-009 — `08_Fases_y_Backlog.md` F12
"Checklists y tareas", encargo P12.3) contra un backend real (`App_dev`): la plantilla de un
cliente con varios ítems (uno opcional), reordenada; la plantilla propia de una sede (clonada y
modificada); un turno generado para esa sede con exactamente sus ítems, en orden; un turno de otra
sede del mismo cliente que toma la plantilla del cliente; cambiar la plantilla del cliente sin
alterar un turno ya creado (P-061); "Recargar tareas" desde ADM-06 actualizándolo; el administrador
marcando tareas desde ADM-06, incluida "No realizada" con motivo obligatorio; y un caso a 390 px de
ADM-26 y de la sección Tareas de ADM-06.

## Por qué está separada de las demás suites de backend real

Mismo motivo que `tests/e2e-shifts-services/`, `tests/e2e-assignments/` y el resto (ver sus propios
README): necesita `SUPABASE_SERVICE_ROLE_KEY` para armar y limpiar clientes, sedes, plantillas y
turnos descartables sin gastar pasos de interfaz en algo que no es lo que cada spec prueba. Ninguno
de los flujos de esta carpeta (`clone_checklist_template`, `update_task_status`,
`reload_shift_tasks`, `create_shift`, altas/ediciones directas de `checklist_templates`/
`checklist_template_items`) invoca ninguna Edge Function desde el navegador: no hace falta el
puerto 5173 que exige el CORS de `admin-users`, así que usa uno propio (4177, ver
`helpers/baseUrl.ts`).

## Fechas: año 2199 reservado, fuera de cualquier rango real

El encargo P12.3 pide explícitamente fechas fuera de rango real ("por ejemplo, 2199"), a
diferencia de `tests/e2e-assignments` (que usa fechas cercanas a "hoy" porque sus turnos puntuales
no interactúan con `generate_shifts`). Esta suite tampoco usa `generate_shifts` — los turnos se
crean puntuales con `create_shift` sobre un cliente y sedes propios y descartables, así que en
rigor no había riesgo de contaminar nada real con una fecha cercana — pero se sigue el criterio
explícito del encargo igual: año 2199, ver `helpers/farDate.ts` (distinto del 2190 de
`e2e-shifts-services` y del 2191 de `e2e-assignments`, por si alguna vez corren en paralelo).

## Cómo correrla

Desde `app/`, con `.env.local` completo:

```bash
pnpm test:e2e:checklists                      # los dos proyectos (chromium, mobile)
pnpm test:e2e:checklists --project=chromium   # uno solo
```

`pnpm test:e2e:checklists` corre `pnpm build` primero (carga `.env.local` con la convención de
Vite, así apunta de verdad a `App_dev`) y recién después Playwright, que sirve ese `dist/` en el
puerto 4177.

## Organización

- `helpers/env.ts`, `helpers/login.ts` — mismo patrón que el resto de suites de backend real.
- `helpers/baseUrl.ts` — puerto propio 4177 (ver arriba).
- `helpers/farDate.ts` — año 2199 reservado (ver arriba) y las fechas puntuales de cada spec.
- `helpers/datePicker.ts` — copia de `tests/e2e-shifts-services/helpers/datePicker.ts` para
  navegar el `DatePicker` de ADM-07 por teclado hasta un año lejano.
- `helpers/noHorizontalScroll.ts` — comprobación mecánica de scroll horizontal.
- `helpers/adminClient.ts` — cliente con la clave de servicio: cliente/sedes de precondición
  (`E2E-P123`), lectura de `shift_tasks` en orden (`fetchShiftTasks`), resolución de un turno por
  sede y fecha (`findShiftId`), y limpieza sin borrado físico (plantillas e ítems de baja lógica,
  sedes inactivas, cliente cerrado).
- `template-hierarchy-and-shift-copy.spec.ts` (TASK-004 a TASK-008, TEST-009, proyecto
  `chromium`) — el flujo completo descripto arriba, en un solo test con varios `test.step`: la
  plantilla del cliente con reordenamiento, la plantilla propia de una sede (clon + edición), dos
  turnos (uno por sede) verificados por API contra el contenido exacto y el orden de sus tareas,
  P-061, "Recargar tareas", y el administrador marcando las cuatro transiciones de estado de una
  tarea (incluida "No realizada" con motivo obligatorio, `ConfirmDialog`).
- `mobile-templates-and-tasks.spec.ts` (TASK-009, proyecto `mobile`, 390 px) — ADM-26 (alta de
  plantilla e ítem) y la sección Tareas de ADM-06 (marcar una tarea como realizada), sin scroll
  horizontal en ninguna de las dos pantallas.

## Independencia y limpieza

Prefijo `E2E-P123` en la razón social del cliente y el nombre de las sedes, distinto del de las
demás suites de backend real. Sin borrado físico: las plantillas y sus ítems quedan de baja
lógica (`deleted_at`), las sedes inactivas y el cliente cerrado (`cleanupDisposableClient`, en un
`finally` que corre aunque el test falle). Los turnos y sus `shift_tasks` (año 2199) NO se borran:
no hay ninguna acción del dominio que los borre y, al estar tan lejos en el tiempo, no molestan a
nada real — mismo criterio que el mes lejano de `tests/e2e-shifts-services`/`tests/e2e-assignments`.

## Qué no cubre (para el orquestador)

- La suite de permisos completa por API directa de `checklist_templates`, `checklist_template_items`,
  `clone_checklist_template`, `update_task_status` y `reload_shift_tasks` vive en
  `tests/permissions/` (`admin.permissions.ts`, `employee.permissions.ts`,
  `supervisor.permissions.ts`), no acá: esta carpeta es solo por interfaz.
- La baja lógica de un ítem de plantilla (botón "Dar de baja") no tiene un caso propio: ya la
  cubre `ChecklistItemsEditor.test.tsx` (unitario) y no es parte de los criterios de aceptación de
  F12 citados por el encargo ("un turno generado... tiene exactamente sus ítems"; "el administrador
  puede marcar tareas..."). Si Mike quiere un e2e explícito, es un `test.step` más.
- El resumen de la plantilla en ADM-21/ADM-22 (TASK-007) no tiene un caso propio: son enlaces de
  solo lectura hacia ADM-26 (`docs/features/checklists-y-tareas.md`), sin lógica de dominio propia
  que no esté ya cubierta acá o en las suites de clientes/sedes.
- Lighthouse, accesibilidad y la revisión sistemática a 768/1024/1366/1440 px son de F17
  (RESP-*).
