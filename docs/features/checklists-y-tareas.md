# Checklists y tareas (F12 · P12.1, P12.2)

`08_Fases_y_Backlog.md` F12 "Checklists y tareas". P12.1 (TASK-001,
TASK-002) agregó las dos RPC que faltaban (`clone_checklist_template`,
`update_task_status`, `supabase/migrations/0025_rpc_tasks.sql`) y sus
pgTAP. Este paquete (P12.2, TASK-003 a TASK-007, TASK-009, TASK-010)
conecta esa capa a pantalla: ADM-26 (plantillas de tareas), la sección
Tareas de ADM-06 (edición de estado y "Recargar tareas") y el resumen de
plantilla en ADM-21/ADM-22.

La base es F10/F11: `create_shift`, `generate_shifts` y `reload_shift_tasks`
(que copian y recargan el checklist del turno) ya existían desde
`0023_rpc_shifts.sql`; este paquete no las toca, solo les agrega pantalla
(el botón "Recargar tareas" de ADM-06 llamaba a una RPC sin usar desde
SHIFT-007).

## `src/api/checklists.ts` (TASK-003)

Ver `docs/api.md` sección "checklists" para la tabla completa de funciones.
Dos decisiones a destacar:

- **Sin RPC para crear la plantilla de un cliente**: `06_API.md` sección 9
  solo trae una RPC para el dominio (`clone_checklist_template`, que crea
  la de una SEDE copiando la del cliente). La plantilla del cliente en sí
  se crea con un `insert` directo (protegido por RLS `O, A +
edit_checklists`, `0012_rls_policies.sql`), mismo criterio que
  `clients.ts`/`sites.ts` para las tablas sin RPC propia.
- **Nombre fijo (`"Plantilla de tareas"`) al crear la plantilla de un
  cliente**, sin pedirlo en un formulario aparte: mismo criterio que
  `clone_checklist_template` en el servidor, que copia el nombre de la
  plantilla del cliente tal cual, sin pedir uno nuevo. Si Mike prefiere
  pedir un nombre, es un campo más en el diálogo de creación.
- **`reorderTemplateItems` hace un solo `upsert`**, no varios `update`
  sueltos: la unicidad `(template_id, position)` es `deferrable initially
deferred` (`0008_checklists_tasks.sql`), pero PostgREST abre una
  transacción por request -- varios `update` de a uno (uno por request)
  chocarían en un intercambio simple de posiciones. Se manda la fila
  completa en cada elemento del `upsert` (no solo `id`/`position`) para no
  depender de qué pasa con las columnas `not null` omitidas en la rama de
  inserción de un `upsert` parcial.

## `src/api/tasks.ts` (TASK-003)

La tarea YA COPIADA a un turno (`shift_tasks`), a diferencia de
`checklists.ts` (plantillas). Una sola función nueva: `updateTaskStatus`
(`update_task_status`, `0025_rpc_tasks.sql`). `reloadShiftTasks` se
reexporta desde `src/api/shifts.ts` (ya existía ahí desde SHIFT-007, F10):
así ADM-06 importa todo lo de tareas desde un solo módulo, sin duplicar la
RPC.

## `src/features/checklists/` (ADM-26, TASK-004, TASK-005)

- `permissions.ts`: `canEditChecklists` (owner, o administrador con
  `edit_checklists`, P-064). La LECTURA de una plantilla es de cualquier
  O/A sin capacidad (`06` sección 9: "Plantillas por cliente | ... | O,
  A") -- por eso ADM-26 no se oculta del menú para un administrador sin la
  capacidad: queda de solo lectura (mismo criterio que `canCancelShift` en
  `features/shifts/permissions.ts`, que tampoco saca "Cancelar" del menú,
  solo el botón).
- `schemas.ts`: `checklistItemFormSchema` (título obligatorio, hasta 200
  caracteres; descripción opcional, hasta 500).
- `queries.ts`: `useChecklistTemplateQuery(clientId, siteId)`,
  `useChecklistItemsQuery(templateId)` y las mutaciones (crear plantilla de
  cliente, clonar para una sede, alta/edición/baja/reorden de ítems), todas
  con invalidación amplia (`checklistsKeys.all`): el volumen de plantillas
  e ítems por cliente es bajo, no justifica una invalidación más fina.
- `components/ChecklistItemsEditor.tsx`: lista de ítems ordenable con
  flechas (sin arrastre, mismo patrón que `RatingCriteriaPage`), alta,
  edición (`ChecklistItemFormDialog`) y baja lógica con confirmación
  (`SimpleConfirmDialog`, reexportado desde `features/settings/components`
  -- ya lo reutilizaba `ClientContactsPanel`, no hace falta duplicarlo).
- `components/ClientTemplateEditor.tsx`/`SiteTemplateEditor.tsx`: el
  contenido completo de ADM-26 según el ámbito elegido (ver más abajo).
- `components/ClientTemplateSummary.tsx`/`SiteTemplateSummary.tsx`: las
  versiones resumidas para ADM-21 y ADM-22 (TASK-007, ver más abajo).

## ADM-26 · Plantillas de tareas (`TaskTemplatesPage`, TASK-004, TASK-005)

`/admin/tareas?cliente=&sede=` (la ruta ya existía como placeholder desde
DS-015). Selector de cliente (`Combobox`, reutiliza `useClientsQuery`) y,
si hay uno elegido, un segundo `Combobox` de "ámbito": "Plantilla del
cliente" o una sede puntual (reutiliza `useClientSitesQuery`). Ambos
quedan en la URL (`?cliente=`/`?sede=`, mismo criterio que `?pestana=` de
`ClientDetailPage`), así los enlaces "Ir a plantillas de tareas" de ADM-21
y ADM-22 llegan con el cliente (y la sede, si corresponde) ya elegidos.

Según el ámbito:

- **Plantilla del cliente** (`ClientTemplateEditor`): si no existe, un
  `EmptyState` con el botón "Crear plantilla del cliente" (si `canEdit`);
  si existe, el nombre, un aviso de que cambiarla no modifica los turnos ya
  generados (P-061) y de que "Recargar tareas" desde ADM-06 es el camino
  para un turno puntual, y `ChecklistItemsEditor`.
- **Una sede** (`SiteTemplateEditor`): si la sede no tiene plantilla
  propia, un `EmptyState` "Esta sede usa la plantilla del cliente" con el
  botón "Crear plantilla propia para esta sede" (`clone_checklist_template`,
  solo si `canEdit` Y el cliente ya tiene su propia plantilla para copiar
  -- si no la tiene, el botón no aparece y el texto lo explica en vez de
  dejar que la RPC devuelva `CLIENT_TEMPLATE_NOT_FOUND` sin contexto,
  aunque el servidor ya lo devuelve en voseo si igual se llegara a
  intentar). Si ya tiene plantilla propia, mismo contenido que la del
  cliente (nombre, aviso, `ChecklistItemsEditor`), con una `Badge`
  "Plantilla propia de la sede".

**Sin `edit_checklists` (`canEdit` en `false`)**: la pantalla sigue en el
menú (`ADMIN_NAV_OPERATION`/`ADMIN_MORE_ITEMS`, `adminNav.ts`, sin cambios
en este paquete) pero de solo lectura -- sin los botones "Agregar ítem",
"Crear plantilla…", ni las flechas/editar/baja de cada ítem. Un aviso arriba
de la lista lo explica.

## ADM-21 y ADM-22 · Resumen de la plantilla (TASK-007)

- **ADM-21, pestaña "Tareas"** (`ClientDetailPage.tsx`): antes un
  `EmptyState` fijo (CLIENT-004, P08.4); ahora `ClientTemplateSummary`
  --nombre de la plantilla y cantidad de ítems si existe, o el aviso de que
  todavía no hay una-- con un enlace "Ir a plantillas de tareas" (sin botón
  de "crear": el alta se hace en ADM-26, `05` línea 75 solo pide "plantilla
  del cliente, enlace a ADM-26" para esta pestaña).
- **ADM-22, bloque "Plantilla de tareas"** (`SiteDetailPage.tsx`): antes un
  `EmptyState` fijo (SITE-002, P08.4); ahora `SiteTemplateSummary` -- mismo
  contenido que `SiteTemplateEditor` de ADM-26 pero sin el editor de ítems:
  resumen, el botón "Crear plantilla propia" (si corresponde y hay
  permiso) y el enlace a ADM-26 para editar los ítems (`05` línea 76:
  "crear plantilla propia (`clone_checklist_template`)").

## Tareas en ADM-06 (`AdminTaskList`, `ReloadTasksDialog`, TASK-006)

`ShiftDetail.tsx` (F11, `src/features/planning/components/`) reemplaza la
lista de solo lectura de las tareas del turno por `AdminTaskList`: cada
tarea tiene un `Select` con las cuatro etiquetas de `04` sección 6.3
(pendiente, en curso, realizada, no realizada) detrás de `canManageTasks`
(owner o CUALQUIER administrador, sin capacidad puntual -- `0025_rpc_tasks.sql`:
`app.is_admin()`, coincide hoy con `canManageAssignments` pero es una
función aparte porque no comparte código en el servidor). Elegir "No
realizada" no llama directo a la mutación: abre `ConfirmDialog` con motivo
obligatorio (mismo componente que `RemoveAssignmentDialog`); las otras tres
opciones se aplican directo. Sin la capacidad (empleado, supervisor, o
cualquier rol sin `canManageTasks`), la lista queda de solo lectura con
`StatusBadge`, como antes de este paquete.

"Recargar tareas" (`ReloadTasksDialog`, `SimpleConfirmDialog` sin motivo,
con la advertencia de que reemplaza lo ya cargado) aparece solo si
`canEditChecklists` (owner, o administrador con `edit_checklists`) Y el
turno sigue `scheduled`/`assigned` (`reload_shift_tasks` exige ese estado,
`0025_rpc_tasks.sql` no lo cambió, seguía en `0023_rpc_shifts.sql`) --
"solo en turnos no empezados" del encargo se tradujo al estado del turno,
no a la hora, porque es la misma condición que ya verifica el servidor. Un
turno sin tareas muestra un `EmptyState` que explica por qué ("puede ser
que se haya creado antes de que existiera una plantilla") y, si corresponde,
ofrece el mismo botón.

## Responsive (TASK-009)

ADM-26 ya era una sola columna de formularios y listas verticales (sin
tabla ni drawer): a 390 px los dos `Combobox` apilan solos
(`grid-cols-1 sm:grid-cols-2`) y la lista de ítems ya usaba tarjetas, no
`DataTable`. La sección Tareas de ADM-06 tampoco cambió de forma: ya era
una lista vertical dentro del drawer/página de `ShiftDetail` (drawer en
escritorio, página completa por debajo de 1024 px desde ASSIGN-014); el
`Select` de estado y los `IconButton` de `ChecklistItemsEditor` miden
44×44 px (`size` por defecto de esos componentes, sin ajuste propio de este
paquete).

## Decisiones tomadas en P12.2

- **Confirmación de baja de un ítem, sin motivo obligatorio**: "dar de baja
  un ítem de una plantilla de tareas" no está en la lista de `07` sección
  2.4 que sí exige motivo (cancelar turno, quitar asignación, cerrar
  asignación, registrar en nombre de) -- se usa `SimpleConfirmDialog`
  (confirmación simple), mismo criterio que dar de baja un feriado o cerrar
  un criterio de calificación.
- **`canManageTasks` como función aparte de `canManageAssignments`**,
  aunque hoy tengan la misma implementación: son dos reglas del servidor
  que no comparten código (`update_task_status` usa `app.is_admin()`
  directo; `assign_employee`/`remove_assignment` verifican rol y, después
  del inicio, `manage_attendance`) -- separarlas evita que un cambio futuro
  en una arrastre a la otra sin querer.
- **`SimpleConfirmDialog` se reutiliza desde `features/settings/components`**
  en vez de duplicarlo en `features/checklists`: ya lo hace
  `ClientContactsPanel` (`features/clients`) desde P08.4, así que este
  paquete no es el primero en cruzar ese límite de dominio.
