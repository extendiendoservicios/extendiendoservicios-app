# Servicios y turnos (F10)

`08_Fases_y_Backlog.md` (DOC-010) prevé un único archivo para todo F10
(servicios y generación de turnos). P10.2 cubrió servicios (SERVICE-001 a
SERVICE-004, SERVICE-006, sección "Servicios" de abajo); este paquete
(P10.3) suma la RPC de turnos y las pantallas que la usan (SHIFT-007 a
SHIFT-011, SERVICE-008, sección "Turnos"). La generación en sí
(`generate_shifts`) y las cinco RPC de `shifts` ya venían de P10.1
(SHIFT-001 a SHIFT-006, `supabase/migrations/0023_rpc_shifts.sql`); P10.3
es la primera capa de cliente que las usa.

## Servicios (ADM-25, más la pestaña/sección Servicios de ADM-21 y ADM-22)

Una pantalla nueva bajo `/admin/servicios...` (ADM-25, alta y edición) más
dos listas que reemplazan los placeholders que había dejado F8/F9 en la
pestaña "Servicios" de ADM-21 (cliente) y en la sección "Servicios" de
ADM-22 (sede). De P10.2 (SERVICE-001 a SERVICE-004, SERVICE-006). Sin
capacidad que las restrinja (`03_Plan_Maestro_Tecnico.md` sección 6,
`04_Modelo_de_Datos.md` sección 7.2: "O, A" para `services`) — las ve y las
edita cualquier dueño o administrador, protegidas solo por `RequireRole
allow={['owner','admin']}` del grupo `/admin` y por `services_write_admin`
del lado del servidor (`0012_rls_policies.sql`).

La generación de turnos (`generate_shifts`) y las pantallas de turnos
(ADM-05, ADM-07, ADM-09) se agregaron en P10.3 (sección "Turnos" de abajo);
ADM-06 (detalle completo del turno) sigue siendo de F11.

### ADM-25 · Servicio · formulario

Rutas `/admin/servicios/nuevo` (con `?sede=<id>`, documentado en `05`
sección 5, o `?cliente=<id>`, extensión propia de este paquete — ver más
abajo) y `/admin/servicios/:id/editar`, una sola página
(`ServiceFormPage.tsx`) que decide el modo con `useParams().id`, mismo
patrón que `ClientFormPage`/`SiteFormPage`.

A diferencia de `SiteFormPage` (donde el cliente es solo contexto, nunca un
campo del formulario), `05_Pantallas_y_Navegacion.md` línea 79 lista
"Cliente y sede" entre los campos de ADM-25: acá son dos `Combobox`
editables (`@/components/Combobox`, DS-004), no un dato fijo. Elegir un
cliente filtra la sede a las sedes de ese cliente (`useClientSitesQuery`,
el mismo hook que ya usaba la pestaña Sedes de ADM-21) y limpia la sede
elegida antes. El resto de los campos: nombre, días de la semana
(`Checkbox` por día, orden de exhibición lunes a domingo de `04` sección
2.1), franja horaria (`type="time"`), dotación (1 a 10), vigencia desde y
hasta (`DatePicker`, DS-005 -- "hasta" vacío es vigencia sin fin), "Trabaja
los feriados" (`Switch`, ver más abajo), horas mensuales mínimas y máximas
(informativas, P-047), estado y notas.

#### "Trabaja los feriados" marcado por defecto (decisión de Mike, P10.0)

`works_on_holidays` viene en `true` tanto en la base
(`0007_services_shifts_assignments.sql`) como en el formulario
(`defaultValues.worksOnHolidays = true`): "el servicio se presta también en
feriados salvo que se indique lo contrario". Se puede desmarcar por
servicio con el `Switch`.

#### Advertencia de edición (SERVICE-006)

En modo edición, un `Alert` arriba del formulario avisa: "Los turnos ya
generados no cambian. Si hace falta, generá el mes de nuevo para crear los
que falten con los datos actualizados" (`06_API.md` sección 6: "Editar un
servicio no modifica turnos ya generados; el administrador vuelve a generar
el mes si corresponde (solo crea faltantes)").

### Pestaña Servicios de ADM-21 y sección Servicios de ADM-22 (SERVICE-003)

`ServiceList`/`NewServiceButton`
(`src/features/services/components/ServiceList.tsx`), un único componente
reutilizado en las dos pantallas:

- Con `clientId` (ADM-21): lista los servicios del cliente, con el nombre
  de la sede de cada uno (un cliente puede tener varias sedes).
- Con `siteId` (ADM-22): lista los servicios de esa sede, sin repetir el
  nombre de la sede (ya se sabe cuál es).

Cada fila muestra nombre, `StatusBadge` de estado, sede (solo en el modo
`clientId`), días y franja (`formatWeekdays`, ver más abajo) y dotación. El
menú de acciones (⋮) tiene "Editar" (ADM-25) y "Cambiar estado"
(SERVICE-004, `ChangeServiceStatusDialog`). `NewServiceButton` arma el
enlace a ADM-25 con `?sede=` (si se conoce la sede, desde ADM-22) o
`?cliente=` (desde ADM-21, donde la sede todavía no está elegida).

#### `formatWeekdays` (`src/features/services/weekdays.ts`)

Arma el texto corto de los días de un servicio para la lista: agrupa días
consecutivos en el orden de exhibición (lunes a domingo, domingo al final)
en un rango ("lun a vie"), separa los sueltos con coma y muestra "Todos los
días" cuando son los 7. Es lógica pura, sin React ni Supabase, por eso tiene
su propio archivo con tests (`weekdays.test.ts`) en vez de vivir inline en
`ServiceList.tsx`.

#### Cambiar estado del servicio (SERVICE-004)

`ChangeServiceStatusDialog`: mismo patrón que `ChangeClientStatusDialog`/
`ChangeSiteStatusDialog` (confirmación simple, sin motivo obligatorio -- no
está en la lista de `07_Design_System.md` sección 2.4 que sí lo exige) con
un texto que explica el efecto de cada estado (`06_API.md` sección 6:
"Solo `active` genera turnos").

### Decisiones tomadas en P10.2 (servicios)

- **`?cliente=` en `/admin/servicios/nuevo` es una extensión propia, no
  documentada en `05_Pantallas_y_Navegacion.md` sección 5** (que solo lista
  `?sede=`): la tabla de rutas no cubre el caso de "Nuevo servicio" desde
  ADM-21, donde todavía no hay una sede elegida (un cliente puede tener
  varias). Se decidió pasar el cliente igual, mismo criterio que `?cliente=`
  de `/admin/sedes/nueva` (ADM-23), y dejar la sede sin precargar --
  reportado al orquestador como una laguna menor de `05`, con esta
  resolución como recomendación.
- **`INVALID_WEEKDAYS` no está en la tabla de `06_API.md` sección 15**
  (`INVALID_TIME_RANGE` sí), aunque la sección 6 lo nombra en la lista de
  errores de `services`. Contradicción menor entre ambas secciones,
  reportada al orquestador; se armó un mensaje en español acorde al check
  que lo genera ("Elegí al menos un día de la semana.").
- **Sin `CLIENT_NOT_ACTIVE`/`SITE_NOT_ACTIVE` al crear o editar un
  servicio**: a diferencia de lo que podría sugerir la lista de errores que
  sigue a la fila de `generate_shifts` en `06` sección 6, no hay ningún
  check ni trigger en `0007_services_shifts_assignments.sql` que rechace un
  cliente o una sede no activos al escribir en `services` -- esos dos
  códigos solo los devuelven `generate_shifts` y `create_shift` (comentario
  de `0005_clients_sites.sql`), ambas RPC de P10.1/P10.3. Un administrador
  puede cargar un servicio para un cliente suspendido o una sede inactiva;
  no se le van a generar turnos mientras siga así, pero la carga en sí no se
  bloquea. El `Combobox` de cliente y de sede sí marca con una etiqueta
  ("suspendido", "baja", "inactiva") los que no están activos, para que el
  administrador lo vea antes de elegir.
- **`StatusBadge` suma el dominio `service`** (`src/components/status/`):
  `07_Design_System.md` sección 3 no tenía una fila para servicios (todas
  las demás tablas del modelo sí la tienen, incluido `service_status` de
  `04_Modelo_de_Datos.md` sección 3). Variante elegida por analogía con
  Cliente (`active`/`suspended`/`closed` → éxito/warning/neutral):
  `active` → éxito, `paused` → warning, `ended` → neutral. Es un cambio
  chico y compatible hacia atrás a un componente de `src/components/`, que
  no es de este dominio -- señalado acá y en el reporte del encargo para
  que lo confirme front-plataforma y lo sume a `07`.
- **`requiredStaff`, como en `employeeNumberSchema`, es texto en el
  formulario, no `z.coerce.number()`**: mismo motivo que `employees/
schemas.ts` (el tipo de entrada y el de salida de `z.coerce` no coinciden,
  lo que rompe el tipado de `zodResolver` con `useForm`) -- se convierte a
  número recién en `serviceFormValuesToInput`.
- **Las horas mensuales mínimas y máximas no tienen una restricción en la
  base** (son informativas, P-047): se agregó de todos modos un `refine` en
  el esquema zod que exige que las máximas no sean menores que las mínimas,
  por prolijidad de la carga -- una validación de cliente sin equivalente en
  el servidor, señalada acá porque se aparta un poco del criterio general de
  "el esquema zod repite, no agrega, restricciones del servidor".

### Qué falta / para el orquestador (servicios)

- Sin detalle propio del servicio (no hay una pantalla "ADM-XX Servicio ·
  detalle" en `05`): la edición se hace directo desde la lista, con
  "Editar" abriendo ADM-25.
- e2e de alta y edición de servicio (SERVICE-007) quedan para qa-pruebas.

## Turnos (P10.3: SHIFT-007 a SHIFT-011)

`src/api/shifts.ts` (SHIFT-007) envuelve las cinco RPC de
`0023_rpc_shifts.sql` (`create_shift`, `generate_shifts`,
`update_shift_time`, `cancel_shift`, `reload_shift_tasks`) más dos lecturas
por PostgREST: `fetchShiftsByDate`/`fetchShiftForEdit` sobre
`v_shifts_board` y `fetchActiveServicesCountForMonth` sobre `services` (para
el resumen previo de ADM-09). A diferencia de `services.ts`, acá no hace
falta un `mapWriteError` a mano: todas las escrituras pasan por RPC
`security definer` que ya devuelven `hint`/`message` listos para
`fromPostgrestError` (`0012_rls_policies.sql` sección 9 confirma que
`shifts` no tiene ninguna política de escritura directa).

Esquemas en `src/features/shifts/schemas.ts` (`shiftFormSchema` para el
alta puntual, `shiftTimeFormSchema` para la edición de franja — ver más
abajo por qué son dos), hooks en `src/features/shifts/queries.ts`
(`shiftsKeys`, polling 30 s solo en la lista del día cuando la fecha es
hoy) y permisos en `src/features/shifts/permissions.ts`
(`canManageShiftTime`, `canGenerateShifts`, `canCancelShift` — matriz de
`03_Plan_Maestro_Tecnico.md` sección 6 y `06_API.md` sección 7).

> **Actualización P11.2 (ASSIGN-008 a ASSIGN-010):** ADM-03 (mes), ADM-04
> (semana) y la versión completa de ADM-05 (agrupada por franja, con "abrir
> turno") ya están construidas -- ver `docs/features/asignaciones-y-cronograma.md`. Lo
> que sigue en esta sección describe la versión mínima de ADM-05 tal como
> quedó en P10.3; se deja sin reescribir como registro histórico de esa
> fase.

### ADM-05 · Planificación · día (versión mínima, SHIFT-010)

`src/pages/admin/PlanningPage.tsx`, montada en `/admin/planificacion`
(`05_Pantallas_y_Navegacion.md` sección 5: "ADM-03 (mes) ?vista=semana →
ADM-04 ?vista=dia&fecha= → ADM-05"). Esta fase solo construye la lista del
día (`ShiftsDayList`, `src/features/shifts/components/`), con fecha
navegable (anterior/siguiente/selector), polling 30 s cuando la fecha es
hoy y "Actualizado hace n s" (`UpdatedAgo`, tercera copia del patrón — ver
"Decisiones" más abajo). ADM-03 (mes) y ADM-04 (semana por empleado) siguen
siendo el placeholder que ya existía: el encargo pide explícitamente no
adelantar calendario ni asignaciones (F11). Se agregó un enlace "Ver la
lista de turnos de hoy" en ese placeholder para llegar a ADM-05 sin escribir
`?vista=dia` a mano (decisión propia, no está en `05`).

Columnas de la tabla (`DataTable`, con `RowCard` automático bajo 1024 px):
horario, cliente · sede, dotación (asignados/requeridos), `StatusBadge` de
`display_status` (incluye los derivados `uncovered`/`upcoming`) y acciones
("Editar" a ADM-07 en edición, "Cancelar" con `CancelShiftDialog`) --
visibles solo con `canManageShiftTime`/`canCancelShift`. Sin agrupación por
franja, sin filtros de cliente/sede/estado y sin "abrir turno" a un detalle
completo: alcanza con lo que pide el encargo (probar que la generación
funciona), el resto es la versión completa de ADM-05 que trae F11 junto con
ADM-06.

### ADM-07 · Formulario de turno (SHIFT-008)

`src/pages/admin/ShiftFormPage.tsx`, una sola página que decide el modo con
`useParams().id`, mismo patrón que `ServiceFormPage`:

- **Alta** (`/admin/turnos/nuevo`, con `?fecha=` opcional desde el botón
  "Nuevo turno" de ADM-05): cliente y sede (`Combobox`, igual que ADM-25),
  fecha (`DatePicker`), franja, dotación (1 a 10) y notas. Si la fecha
  elegida es feriado, un `Alert` de aviso la marca antes de guardar
  (chequeo contra `useHolidaysQuery`, cliente); si además el servidor
  devuelve la advertencia `HOLIDAY` en la respuesta de `create_shift`, el
  toast de éxito lo repite (`toast.warning`) por si la persona no llegó a
  ver el aviso inline.
- **Edición** (`/admin/turnos/:id/editar`): **limitada a la franja
  horaria**. Ver la próxima sección para el motivo.

#### Por qué la edición no toca dotación ni notas (contradicción `05`/`06`/backend)

`05_Pantallas_y_Navegacion.md` línea 41 pide que en edición se pueda
cambiar "franja, dotación y notas, según estado". Pero:

- `06_API.md` sección 7 solo documenta `update_shift_time(p_shift_id,
p_start, p_end)` como RPC de edición -- ninguna toca `required_staff` ni
  `notes` de un turno existente.
- La misma sección 7 lista además "Editar notas administrativas | update
  `shifts.notes` | O, A", como si fuera una escritura directa por
  PostgREST, pero `0012_rls_policies.sql` sección 9 dice explícitamente
  "Insert/Update/Delete: RPC ... only" y no le da a `shifts` ninguna
  política de escritura directa (solo `select`).

O sea: el backend que ya está construido (`0023_rpc_shifts.sql`,
`0012_rls_policies.sql`) no tiene forma de cambiar la dotación ni las notas
de un turno ya creado, ni por RPC ni por PostgREST. `ShiftFormPage` en modo
edición refleja eso: muestra cliente, sede, fecha, dotación y notas de solo
lectura (con una `Alert` explicándolo) y solo deja tocar el horario, con las
reglas de `04_Modelo_de_Datos.md` sección 6.1 (`scheduled`/`assigned`:
franja completa; `in_progress`: solo el fin, con el campo de inicio
deshabilitado; `completed`/`cancelled`: nada, se muestra un aviso en vez del
formulario). Reportado al orquestador como una laguna real entre `05`/`06` y
el backend ya aplicado en `App_dev` -- no es algo que este paquete pueda
decidir por su cuenta (no toca `supabase/`).

### ADM-09 · Generar turnos del mes (SHIFT-009)

`src/pages/admin/ShiftsGeneratePage.tsx`, en `/admin/turnos/generar`, visible
solo con `canGenerateShifts` (dueño, o administrador con la capacidad
`generate_shifts`). Selector de mes (`MonthPicker`, DS-005), resumen previo
con dos cifras:

- **Servicios activos vigentes**: `fetchActiveServicesCountForMonth`
  cuenta servicios `active` cuya vigencia toca algún día del mes elegido.
  Es una aproximación para orientar antes de generar (no filtra por
  cliente/sede activos ni recorre día por día como sí hace
  `generate_shifts` de verdad) -- decisión propia, `05` línea 43 solo pide
  "servicios activos" sin precisar la fórmula.
- **Feriados del mes**: cuenta de `useHolidaysQuery(año)` (ya existía para
  ADM-29) filtrada por mes en el cliente.

Después de "Generar turnos del mes" (`generate_shifts`), un `Alert` muestra
el resultado real de la RPC: creados, omitidos (ya existían) y omitidos por
feriado. Un segundo `Alert`, siempre visible, aclara que "Regenerar solo
crea los turnos que todavía no existen para ese mes: nunca borra ni
modifica un turno ya generado" (`02_Decisiones.md` P-044), tal como pide el
encargo.

### Diálogo de cancelación (SHIFT-011)

`CancelShiftDialog` (`src/features/shifts/components/`) envuelve
`ConfirmDialog` (DS-010, ya construido por front-plataforma con motivo
obligatorio) para `cancel_shift`, visible solo con `canCancelShift`. Se usa
hoy desde ADM-05; queda listo para que ADM-06 (F11) lo reutilice tal cual,
como pide el encargo ("Diálogo de cancelación con motivo (reutilizado en
ADM-06)", `08` fila SHIFT-011).

### Decisiones tomadas en P10.3 (turnos)

- **`UpdatedAgo` se duplica una tercera vez**
  (`src/features/shifts/components/UpdatedAgo.tsx`): mismo componente que
  `users/components/UpdatedAgo.tsx` (ADM-27) y `clients/components/
UpdatedAgo.tsx` (ADM-19), ninguno de los tres con lógica específica de su
  dominio. Sigue en pie el pedido a front-plataforma de subirlo a
  `src/components/` -- con esta tercera copia, ya no es una corazonada.
- **`fetchActiveServicesCountForMonth` no repite la lógica exacta de
  `generate_shifts`**: ver el comentario de la sección ADM-09 de arriba.
  Documentado también como comentario en `src/api/shifts.ts`.
- **`shiftFormSchema`/`shiftTimeFormSchema` son dos esquemas separados**, no
  uno solo con campos opcionales: dado que la edición de verdad solo puede
  cambiar franja (ver la sección de ADM-07), separar el esquema evita
  arrastrar campos "requeridos pero deshabilitados" que complicarían la
  validación sin necesidad.
- **`PlanningPage` mezcla una pantalla real (ADM-05) con el placeholder que
  ya existía (ADM-03)** en la misma ruta `/admin/planificacion`, decidido
  por `?vista=`: es el mismo patrón de ruta compartida que ya define `05`
  sección 5 para las tres vistas de planificación: cuando F11 construya
  ADM-03/ADM-04, reemplaza la rama `else` de `PlanningPage` sin tocar la
  ruta ni el `handle`.
- **`todayInBuenosAires` se importa de `src/features/employees/
employeeLeaveStatus.ts`** en vez de duplicarse una vez más: ya es un
  dominio propio (EMP-008, no `employee` singular del front-móvil), así que
  no aplica la regla de "no importar de otro dominio" -- es la misma capa,
  reutilizarla evita una cuarta copia de una función sin nada específico de
  licencias. Señalado igual como candidato a moverse a `src/lib/format.ts`
  junto a `BUENOS_AIRES_TIME_ZONE`.
- **Rutas de `adminRoutes.tsx` (`src/app/`, no es de este dominio)**: se
  reemplazaron los placeholders de `planificacion`, `turnos/nuevo`,
  `turnos/generar` y `turnos/:id/editar` por las páginas reales, mismo
  precedente que P10.2 con `servicios/nuevo` y `servicios/:id/editar`.
  `turnos/:id` (ADM-06) sigue siendo placeholder (F11).

### Qué falta / para el orquestador (turnos)

- La contradicción de edición de ADM-07 (dotación/notas, ver arriba) ya
  tiene RPC (`update_shift_details`, P11.1): `ShiftFormPage` (P10.3) todavía
  no la usa -- queda para cuando ADM-06/ADM-07 completen la edición en
  P11.3. Envuelta desde ya en `src/api/assignments.ts` (`docs/api.md`).
- ADM-03, ADM-04 y la versión completa de ADM-05 se construyeron en P11.2
  (`docs/features/asignaciones-y-cronograma.md`). ADM-06 (detalle completo del turno) y
  ADM-08 (drawer "Asignar empleado") siguen siendo de P11.3.
- `reload_shift_tasks` está envuelta en `src/api/shifts.ts` pero sin
  pantalla que la use todavía (es de ADM-06, P11.3).
- e2e de "servicio → generar → lista del día → cancelar uno" (SHIFT-012)
  queda para qa-pruebas.
