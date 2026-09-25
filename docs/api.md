# API

Resumen de la API real, tal como quedó implementada (no el contrato
conceptual — para eso está `Docs/Plan_Maestro/06_API.md`, fuera del
repo). Se actualiza en el mismo cambio que agrega o modifica un módulo de
`src/api/`.

## Cómo se organiza

Sin servidor de API propio (P-003, ADR-004): el frontend habla con
Supabase por tres canales, cada uno con su capa en `src/api/`:

| Canal                                                                           | Cómo se usa desde `src/api/`                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgREST (`supabase.from('tabla')`)                                            | Lecturas de listas/detalle y escrituras simples.                                                                                                 |
| RPC (`supabase.rpc('funcion', {...})`)                                          | Toda operación con reglas o que toca varias tablas.                                                                                              |
| Edge Function `admin-users` (`supabase.functions.invoke('admin-users', {...})`) | Lo único que necesita la clave de servicio de Auth (crear usuarios, resetear contraseñas, cambiar email, cerrar sesiones, desactivar/reactivar). |

Cada dominio tiene un módulo en `src/api/<dominio>.ts` que envuelve estos
tres canales y traduce cualquier error a `ApiError` (`src/api/errors.ts`):
`message` (texto en español del servidor, se muestra tal cual) y `hint`
(código estable para lógica). El patrón completo, con los pasos exactos
para agregar un dominio nuevo, está en `src/api/README.md` — esta página
es el índice de qué hay implementado y sus particularidades, no el
tutorial.

## Dominios implementados

### `users` (`src/api/users.ts`, P07.2 — USERS-007 a USERS-011)

Usuarios, roles y capacidades de ADM-27 "Usuarios y roles".

| Función                                                                           | Canal                                                                    | Notas                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchUsers()`                                                                    | `from('profiles')` + embed `user_roles!user_roles_profile_id_fkey(role)` | El embed necesita el nombre de la FK a mano: `user_roles` tiene DOS foreign keys hacia `profiles` (`profile_id` y `granted_by`), PostgREST no puede elegir sola. Incluye perfiles desactivados (RLS `profiles_select_admin` no los filtra para O/A). No trae el email de login: no está en `profiles` (vive en `auth.users`, fuera de PostgREST) y la pantalla no lo pide en la lista. |
| `fetchLastSignIns()`                                                              | `from('security_events')`                                                | Solo devuelve algo si quien pregunta es el dueño (`security_events_select_owner`); para un administrador vuelve un mapa vacío por RLS, sin error — la pantalla muestra "—" en esa columna.                                                                                                                                                                                             |
| `fetchAdminCapabilities(profileId)`                                               | `from('admin_capabilities')`                                             | Solo el dueño puede leer capacidades ajenas (RLS); completa en `false` las capacidades sin fila.                                                                                                                                                                                                                                                                                       |
| `setUserRoles(profileId, roles)`                                                  | `rpc('set_user_roles', ...)`                                             | Errores: `FORBIDDEN`, `PROFILE_NOT_FOUND`, `ROLE_REQUIRES_EMPLOYEE`, `LAST_OWNER`. Si el conjunto nuevo saca un rol, quien llama tiene que invocar después `signOutUser` (la RPC no cierra sesiones sola) — lo hace `useSetUserRolesMutation` automáticamente.                                                                                                                         |
| `setAdminCapability(profileId, capability, enabled)`                              | `rpc('set_admin_capability', ...)`                                       | Solo el dueño (ni siquiera un administrador con `manage_users`). Errores: `FORBIDDEN`, `ADMIN_ROLE_REQUIRED`.                                                                                                                                                                                                                                                                          |
| `createAdminUser(input)`                                                          | Edge `admin-users`, `create_user`                                        | Siempre `roles: ['admin']` desde ADM-27 (ver `docs/features/usuarios-y-configuracion.md`). Si el rol incluye `admin`, la propia Edge Function activa las siete capacidades.                                                                                                                                                                                                            |
| `resetPassword`, `updateEmail`, `signOutUser`, `deactivateUser`, `reactivateUser` | Edge `admin-users`                                                       | Un `invokeAdminUsers<T>(action, body)` interno arma el cuerpo `{ action, ...body }` y traduce `{ error: { message, hint } }` a `ApiError`. `deactivateUser` exige `reason`. `reactivateUser` es solo del dueño.                                                                                                                                                                        |

Particularidad de `supabase.functions.invoke`: nunca lanza; en error
devuelve `error: FunctionsHttpError` con el cuerpo SIN LEER en
`error.context` (una `Response`, tipada `any` en `@supabase/functions-js`).
Hay que hacer `await (error.context as Response).json()` para sacar
`{ message, hint }` — ver el comentario de `invokeAdminUsers` en
`users.ts`.

Límite de acciones: la Edge Function corta con `RATE_LIMITED` (429) a
partir de la undécima acción sensible (`create_user`, `deactivate_user`,
`reactivate_user`, `reset_password`, `sign_out_user`, `update_email`) de
la misma persona en 60 segundos (P07.1). El frontend no reintenta
automáticamente: muestra el mensaje del servidor tal cual.

### `employees` (`src/api/employees.ts`, P09.3 — EMP-001, EMP-003, EMP-004; P09.4 — EMP-006 a EMP-010)

Empleados y supervisores de ADM-16 a ADM-18. Una misma tabla `employees`
para los dos roles (P-038). El alta y las acciones de cuenta (resetear
contraseña, cerrar sesiones, dar de baja) reutilizan tal cual las funciones
de `src/api/users.ts` en vez de repetir el `invokeAdminUsers` interno de la
Edge Function: se extendió `createAdminUser`/`CreateAdminUserInput` de
`users.ts` con un `employee` opcional (`CreateUserEmployeeInput`) para que
también sirva para EMP-003.

| Función                                           | Canal                                                        | Notas                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchEmployees(filters)`                         | `from('v_employees')`                                        | Filtros de texto (nombre, apellido, DNI y legajo si es numérico), rol (`.contains('roles', [...])`) y `effective_status`. El filtro "cliente habilitado" no se resuelve acá (ver `fetchEmployeeClientPermissions`).                                                                                                                                                                              |
| `fetchEmployeeClientPermissions()`                | `from('employee_client_permissions')`                        | Mapa `employeeId → clientId[]`. La regla "lista vacía = habilitado para todos" (P-034) la aplica `filterEmployeesByClient` (`features/employees/employeeListFilters.ts`), no esta función.                                                                                                                                                                                                       |
| `fetchSuggestedEmployeeNumber()`                  | `from('employees')`                                          | `max(employee_number) + 1` (1 si no hay ninguno). Solo una sugerencia para el formulario: la Edge Function `create_user` no acepta elegir el legajo, lo asigna `employee_number_seq`.                                                                                                                                                                                                            |
| `fetchEmployeeDetail(profileId)`                  | `from('v_employees')`                                        | Ficha de ADM-17.                                                                                                                                                                                                                                                                                                                                                                                 |
| `createEmployeeUser(input)`                       | `createAdminUser` (Edge `admin-users`) + `from('employees')` | Una sola llamada a la Edge Function crea el usuario de Auth y la fila de `employees` (sin paso intermedio que pueda dejar un usuario huérfano). Si el legajo pedido difiere del que asignó la secuencia, un `update` aparte lo corrige; si ese `update` fallara, la función NO lanza (la persona ya quedó creada) — devuelve `employeeNumberWarning` con un texto para mostrar aparte del éxito. |
| `updateEmployee(profileId, input, updatedBy)`     | `from('profiles')` + `from('employees')`                     | Dos `update`: datos personales (`profiles`) y laborales (`employees`, incluido `employee_number`, editable y único). Sin tocar el email de login (acción de usuario, `updateEmail` de `users.ts`).                                                                                                                                                                                               |
| `terminateEmployee(profileId, reason, updatedBy)` | `deactivateUser` (Edge `admin-users`) + `from('employees')`  | Baja en dos pasos, en este orden: primero se revoca el acceso (banea el login y cierra sesiones), recién después se marca `employees.status = 'terminated'`. Si el segundo paso fallara, se avisa con `ApiError('...', 'EMPLOYEE_STATUS_NOT_UPDATED')` — se prefiere ese estado parcial (acceso ya bloqueado, estado laboral desactualizado) al inverso.                                         |
| `resetEmployeePassword`, `signOutEmployee`        | Re-exportadas de `users.ts`                                  | Mismas funciones que USERS-011 usa para administradores — la Edge Function no distingue el tipo de cuenta.                                                                                                                                                                                                                                                                                       |

P09.4 (EMP-006 a EMP-008) suma tres bloques, todos escritura directa por
PostgREST (sin RPC, `06` sección 3), con el mismo `mapWriteError` de arriba
extendido para traducir sus errores propios:

| Función                                                                                 | Canal                                                      | Notas                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchEmployeeClientPermissionsFor(employeeId)`                                         | `from('employee_client_permissions')` embebiendo `clients` | Clientes habilitados de una persona puntual (pestaña Habilitaciones), a diferencia de `fetchEmployeeClientPermissions()` (mapa para el listado).                                                                                                                                                                                                                                |
| `addEmployeeClientPermission`, `removeEmployeeClientPermission`                         | `insert`/`delete`                                          | Sin baja lógica: la tabla no tiene `deleted_at` (P-034). Un `23505` al agregar un cliente ya habilitado se traduce a `DUPLICATE` con un mensaje propio (no debería pasar: la pantalla ya saca del selector los clientes ya habilitados).                                                                                                                                        |
| `fetchEmployeeAvailability`, `createEmployeeAvailability`, `deleteEmployeeAvailability` | `from('employee_availability')`                            | Franjas por día de la semana (`0`..`6` = domingo..sábado). `mapWriteError` traduce el check `end_time > start_time` (`23514`) a un mensaje claro.                                                                                                                                                                                                                               |
| `fetchEmployeeLeaves`, `createEmployeeLeave`, `deactivateEmployeeLeave`                 | `from('employee_leaves')`                                  | `deactivateEmployeeLeave` marca `deleted_at` (baja lógica, nunca `delete` físico). `mapWriteError` traduce dos errores propios de esta tabla: el check `ends_on >= starts_on` (`23514`) y, sobre todo, la exclusión de solapamiento `employee_leaves_no_overlap` (`23P01`, sin `hint` propio porque no pasa por una RPC) → `ApiError('...', 'LEAVE_OVERLAP')` (`06` sección 3). |

Los roles `employee`/`supervisor` editables desde la ficha (decisión de
Mike del 24 sep 2026) reutilizan `setUserRoles`/`signOutUser` de
`src/api/users.ts` tal cual (misma RPC `set_user_roles` que ADM-27) — no
suman funciones nuevas a este módulo, solo un hook propio en
`features/employees/queries.ts` (`useSetEmployeeRolesMutation`) que invalida
las consultas de este dominio en vez de las de `users`.

### `settings` (`src/api/settings.ts`, P07.3 — USERS-012 a USERS-016)

Las cuatro pantallas de "Configuración" que siguen a ADM-27: empresa
(ADM-28), feriados (ADM-29), criterios de calificación (ADM-30) y eventos
de seguridad (ADM-31, solo lectura). A diferencia de `users`, ninguna
tiene una RPC propia — todas las escrituras son `.from('tabla').insert
/update(...)` directas, protegidas solo por RLS (`06_API.md` sección 9
dejaba las dos opciones abiertas; el backend construido optó por
mantenimiento simple sin RPC). Como no hay una función que arme el mensaje
en español, `mapWriteError` traduce el único código de restricción que
puede pisar acá (`23505`, unicidad de `holidays.holiday_date`); el resto
de los códigos caen en el texto de Postgres tal cual. `created_by`/
`updated_by` no los completa un trigger: cada función recibe el
`profileId` de quien está logueado como parámetro y lo escribe a mano.

| Función                                                                                                                  | Canal                               | Notas                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchCompanySettings()`, `updateCompanySettings(input)`                                                                 | `from('company_settings')`          | Fila única (`id = 1`). Cualquier persona logueada puede leerla completa; la pantalla decide qué campos mostrar según el rol (dueño ve todo, administrador solo el logo), no el servidor.                                                                                                                        |
| `uploadCompanyLogo(file, updatedBy, previousLogoPath)`                                                                   | `storage.from('branding')` + update | Nombre fijo `logo.{ext}` con `upsert`; valida tipo (PNG/JPEG/SVG/WebP) y tamaño (1 MB) antes de subir. Si la extensión cambió, borra el archivo anterior (best effort, no interrumpe la operación si falla). Login y sidebar lo leen con `useBranding`/`brandingLogoUrl` (`src/features/auth/`).                |
| `fetchHolidays(year)`, `createHoliday`, `deactivateHoliday`                                                              | `from('holidays')`                  | `fetchHolidays` trae también los dados de baja (hace falta para no chocar con `holiday_date unique` al recargar feriados nacionales); la pantalla filtra los borrados de la lista.                                                                                                                              |
| `loadNationalHolidays(year, createdBy)`                                                                                  | Varias llamadas a `holidays`        | No hay tabla de fechas: `computeNationalHolidays` (`src/features/settings/nationalHolidays.ts`) calcula, con reglas fijas (Gauss para Pascua, "n-ésimo lunes del mes" para los trasladables), los feriados nacionales de cualquier año. No duplica fechas existentes: reactiva las de baja, saltea las activas. |
| `fetchRatingCriteria`, `createRatingCriterion`, `updateRatingCriterion`, `closeRatingCriterion`, `reorderRatingCriteria` | `from('rating_criteria')`           | `closeRatingCriterion` pone `valid_to` en hoy, no borra. `reorderRatingCriteria` reescribe `position` de cada fila en el orden final que ya armó la pantalla (mismo patrón que ADM-26).                                                                                                                         |
| `fetchSecurityEvents(filters)`                                                                                           | `from('security_events')`           | Solo el dueño ve resultados (`security_events_select_owner`); para cualquier otra sesión vuelve vacío por RLS, sin error. Embebe `profiles` dos veces (actor y destinatario), nombrando cada FK a mano por la misma ambigüedad que `fetchUsers`. `limit(500)`, sin paginado real.                               |

### `clients` (`src/api/clients.ts`, P08.3 — CLIENT-001 a CLIENT-006, CLIENT-009)

Clientes y contactos de ADM-19 a ADM-21. Igual que `settings`: sin RPC
propia (`06_API.md` sección 4, todo `insert/update`/`update status`/`insert
/update/delete lógico` directo por PostgREST); `mapWriteError` traduce a
mano el único código que documenta `06` sección 15 para este dominio
(`CUIT_IN_USE`, restricción `clients.cuit unique`); `created_by`/
`updated_by` los pasa cada función como parámetro, no un trigger.

| Función                                                                                        | Canal                                   | Notas                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchClients(filters)`                                                                        | `from('v_clients')`                     | Filtros de texto (`ilike` sobre razón social, fantasía y CUIT) y estado, siempre `deleted_at is null`. `sites_count` cuenta sedes vigentes sin filtrar por estado (la pantalla lo etiqueta "Sedes", no "Sedes activas" — ver `docs/features/clientes-y-sedes.md`). |
| `fetchPrimaryContactNames()`                                                                   | `from('client_contacts')`               | Mapa `clientId → nombre` del contacto con `is_primary = true`, para la columna de ADM-19 (`v_clients` no lo trae).                                                                                                                                                 |
| `fetchClientDetail(id)`, `createClient`, `updateClient`                                        | `from('clients')`                       | `createClient`/`updateClient` mapean `ClientFormInput` ↔ columnas `snake_case`; CUIT repetido → `ApiError('Ese CUIT ya está registrado.', 'CUIT_IN_USE')`.                                                                                                         |
| `setClientStatus(id, status, updatedBy)`                                                       | `from('clients')`                       | Solo toca `status` (CLIENT-006), aparte del formulario completo.                                                                                                                                                                                                   |
| `fetchClientContacts`, `createClientContact`, `updateClientContact`, `deactivateClientContact` | `from('client_contacts')`               | Baja lógica con `deleted_at`.                                                                                                                                                                                                                                      |
| `setPrimaryClientContact(clientId, contactId, updatedBy)`                                      | `from('client_contacts')`, dos `update` | Sin RPC que lo haga en una transacción: primero le saca `is_primary` al contacto anterior, después se lo pone al nuevo (el índice único parcial `client_contacts_one_primary_per_client_idx` rechaza tener dos filas en `true` a la vez).                          |
| `fetchClientSites(clientId)`                                                                   | `from('sites')`                         | Listado simple para la pestaña Sedes de ADM-21.                                                                                                                                                                                                                    |

### `sites` (`src/api/sites.ts`, P08.4 — SITE-001 a SITE-003, SITE-005, SITE-006)

Sedes de ADM-22, ADM-23 y ADM-24. Igual que `clients`: sin RPC propia
(`06_API.md` sección 5, todo `insert/update`/`update status` directo por
PostgREST); `mapWriteError` traduce a mano el único código que documenta
`06` sección 15 para este dominio (`SITE_NAME_IN_USE`, índice
`sites_client_id_name_key`); `created_by`/`updated_by` los pasa cada
función como parámetro, no un trigger.

| Función                                           | Canal             | Notas                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchSiteDetail(id)`, `createSite`, `updateSite` | `from('sites')`   | Embeben `clients(legal_name, trade_name, status)`: la cabecera de ADM-22 necesita el nombre del cliente y `sites` no lo trae. Nombre repetido en el cliente → `ApiError('Ya hay una sede con ese nombre para este cliente.', 'SITE_NAME_IN_USE')`. |
| `setSiteStatus(id, status, updatedBy)`            | `from('sites')`   | Solo toca `status` (SITE-006), aparte del formulario completo.                                                                                                                                                                                     |
| `fetchSitesForMap(filters)`                       | `from('sites')`   | Para ADM-24: trae todas las sedes vigentes del cliente filtrado, con y sin coordenadas (el filtrado por coordenadas lo hace la pantalla, para poder avisar cuántas quedaron afuera del mapa).                                                      |
| `fetchClientFilterOptions()`                      | `from('clients')` | Opciones del filtro "Cliente" del mapa de sedes: todos los clientes vigentes, sin filtrar por `status`.                                                                                                                                            |

### `services` (`src/api/services.ts`, P10.2 — SERVICE-001 a SERVICE-004, SERVICE-006)

Servicios recurrentes de ADM-25 y las listas de servicios de ADM-21 y
ADM-22. Igual que `clients`/`sites`: sin RPC propia (`06_API.md` sección 6,
todo `insert/update`/`update status` directo por PostgREST); `mapWriteError`
traduce a mano los checks de `services` (`services_weekdays_check`,
`services_time_range_check`, `services_required_staff_check`,
`0007_services_shifts_assignments.sql`); `created_by`/`updated_by` los pasa
cada función como parámetro, no un trigger. A diferencia de `clients.ts`/
`sites.ts`, no hay `CLIENT_NOT_ACTIVE`/`SITE_NOT_ACTIVE` en la escritura de
`services`: esos códigos solo los devuelven `generate_shifts`/`create_shift`
(P10.1/P10.3, fuera de este paquete).

| Función                                                          | Canal              | Notas                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchServicesByClient(clientId)`, `fetchServicesBySite(siteId)` | `from('services')` | Para la pestaña Servicios de ADM-21 y la sección Servicios de ADM-22. Embeben `sites(name)`.                                                                                                                                         |
| `fetchServiceDetail(id)`, `createService`, `updateService`       | `from('services')` | Embeben `clients(legal_name, trade_name)` y `sites(name)` para la cabecera de ADM-25. Días de la semana inválidos → `INVALID_WEEKDAYS`; rango horario inválido → `INVALID_TIME_RANGE`; dotación fuera de 1..10 → `VALIDATION_ERROR`. |
| `setServiceStatus(id, status, updatedBy)`                        | `from('services')` | Solo toca `status` (SERVICE-004), aparte del formulario completo.                                                                                                                                                                    |

### `shifts` (`src/api/shifts.ts`, P10.3 — SHIFT-007 a SHIFT-011)

Turnos de ADM-05, ADM-07 y ADM-09. A diferencia de `clients`/`sites`/
`services`, acá sí hay RPC propia para cada escritura
(`0023_rpc_shifts.sql`, P10.1): `create_shift`, `generate_shifts`,
`update_shift_time`, `cancel_shift`, `reload_shift_tasks`.
`0012_rls_policies.sql` sección 9 confirma que `shifts` no tiene ninguna
política de insert/update/delete directa, así que no hace falta un
`mapWriteError` a mano como en `services.ts`: los cinco `P0001` que puede
lanzar cada RPC ya traen `hint`/`message` listos, `fromPostgrestError` los
deja pasar tal cual.

**Contradicción con `06_API.md` sección 7, resuelta en P11.1** (documentada
también en el código y en `docs/features/servicios-y-turnos.md`): esa
sección listaba "Editar notas administrativas | update `shifts.notes` | O,
A" como si fuera una escritura directa por PostgREST, pero no existe esa
política. `0024_rpc_assignments.sql` (P11.1) agregó la RPC que faltaba,
`update_shift_details(p_shift_id, p_required_staff, p_notes)`: vive en
`src/api/assignments.ts` (ver más abajo), no en `shifts.ts`, porque el
encargo de ASSIGN-007 la agrupó con las otras tres RPC de asignaciones.
ADM-07 en edición sigue sin usarla todavía (`ShiftFormPage` de P10.3 solo
cambia la franja); queda lista para cuando ADM-06/ADM-07 completen la
edición de dotación y notas en P11.3.

| Función                                         | Canal                    | Notas                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchShiftsByDate(date)`                       | `from('v_shifts_board')` | Lista del día de ADM-05, ordenada por hora. Incluye `display_status` (con los derivados `uncovered`/`upcoming`) y los cinco contadores (`assigned_count`, `present_count`, `finished_count`, `absent_count`, `delayed_count`). |
| `fetchShiftForEdit(id)`                         | `from('v_shifts_board')` | Datos mínimos para el modo edición de ADM-07 (franja, estado, nombres de cliente/sede de solo lectura). No es el detalle completo de ADM-06 (F11).                                                                             |
| `fetchActiveServicesCountForMonth(year, month)` | `from('services')`       | Resumen previo de ADM-09: cuenta servicios `active` vigentes en el mes. Aproximación de cliente, no repite la lógica exacta (día por día, cliente/sede activos) de `generate_shifts`.                                          |
| `createShift(input)`                            | RPC `create_shift`       | Turno puntual (ADM-07 alta). Errores: `INVALID_TIME_RANGE`, `CLIENT_NOT_ACTIVE`, `SITE_NOT_ACTIVE`. Advertencia informativa `HOLIDAY` (no bloquea).                                                                            |
| `generateShifts(year, month)`                   | RPC `generate_shifts`    | Generación mensual idempotente (ADM-09). Capacidad `generate_shifts`. Devuelve `{created, skipped, holidaysSkipped}`.                                                                                                          |
| `updateShiftTime(shiftId, start, end)`          | RPC `update_shift_time`  | Único endpoint de edición de un turno existente (ADM-07 edición). Errores: `SHIFT_NOT_FOUND`, `SHIFT_CANCELLED`, `SHIFT_COMPLETED`, `INVALID_TIME_RANGE`, `SHIFT_NOT_EDITABLE`, `ASSIGNMENT_OVERLAP`.                          |
| `cancelShift(shiftId, reason)`                  | RPC `cancel_shift`       | Diálogo de cancelación (SHIFT-011). Capacidad `cancel_shifts`. Motivo obligatorio → `CANCEL_REASON_REQUIRED`.                                                                                                                  |
| `reloadShiftTasks(shiftId)`                     | RPC `reload_shift_tasks` | Capacidad `edit_checklists`. Sin pantalla que la use todavía (es de ADM-06, F11); se agrega igual porque `shifts.ts` es el único módulo del dominio.                                                                           |

### `assignments` (`src/api/assignments.ts`, P11.2 — ASSIGN-007 a ASSIGN-010; P11.3 — ASSIGN-011 a ASSIGN-013)

Lecturas por rango de fechas de `v_shifts_board`/`v_assignments_board` para
el calendario mensual (ADM-03), la grilla semanal (ADM-04) y la lista del
día completa (ADM-05, en `src/features/shifts/`), el detalle de un turno
(ADM-06) y los candidatos para asignar (ADM-08), más las cuatro RPC de
`0024_rpc_assignments.sql` (P11.1): `assign_employee`, `remove_assignment`,
`update_assignment_time`, `update_shift_details`. Mismo criterio que
`shifts.ts`: las cuatro RPC ya traen `hint`/`message` listos, sin
`mapWriteError` propio.

**Falta de columna en `v_assignments_board`** (reportado al orquestador): a
diferencia de `v_shifts_board`, que trae `client_legal_name` y
`client_trade_name`, `v_assignments_board` solo trae la razón social. La
grilla semanal (ADM-04) muestra `client_legal_name` sin nombre de fantasía
hasta que la vista lo sume.

**`set_assignment_notes` no existe** (reportado al orquestador, P11.3): `06`
sección 8 la documenta ("Observación del servicio", P-062), pero
`0024_rpc_assignments.sql` no la trae. ADM-06 muestra `assignments.notes` de
solo lectura; no hay forma de cargarla o editarla hasta que se agregue esa
RPC.

| Función                                                                                         | Canal                                           | Notas                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchShiftsBoardByRange(from, to, filters)`                                                    | `from('v_shifts_board')`                        | Calendario mensual (ADM-03). Filtros cliente, sede, estado mostrado por columna; filtro empleado resuelto con una consulta previa a `assignments` (ids de turno con asignación vigente de ese empleado).                                                                                                                                                        |
| `fetchAssignmentsBoardByRange(from, to, filters)`                                               | `from('v_assignments_board')`                   | Grilla semanal (ADM-04). Filtros cliente, sede.                                                                                                                                                                                                                                                                                                                 |
| `fetchShiftDetail(shiftId)`                                                                     | `from('shifts')` + embebidos                    | Detalle del turno (ADM-06). Un solo `select` con `clients`, `sites`, `assignments` (solo vigentes, con `employees`/`profiles` embebidos), `shift_tasks` (ordenadas por `position`) y `supervisions` (con supervisor embebido). Sin `attendance_records`/`attendance_notices` (ATT-014, F14).                                                                    |
| `fetchAssignCandidates({shiftId, clientId, shiftDate, startTime, endTime, excludeEmployeeIds})` | `from('v_employees')` + 4 consultas en paralelo | Candidatos de ADM-08: `effective_status = 'active'`, marcas de habilitación (`employee_client_permissions`), disponibilidad (`employee_availability`, contra el día de semana y el horario del turno) y licencia (`employee_leaves`, contra `shiftDate`), más otras asignaciones vigentes del empleado ese mismo día. Ordena habilitados y disponibles primero. |
| `assignEmployee({shiftId, employeeId, start?, end?})`                                           | RPC `assign_employee`                           | Devuelve `{assignment, warnings}`. Advertencias `NOT_ENABLED_FOR_CLIENT`/`OUTSIDE_AVAILABILITY`/`ON_LEAVE` (no bloquean, P-034/P-035/P-033). Errores: `SHIFT_FULL`, `ASSIGNMENT_OVERLAP`, `ALREADY_ASSIGNED`, `ASSIGNMENT_TIME_OUT_OF_SHIFT`, `EMPLOYEE_NOT_ACTIVE`, `SHIFT_STARTED`.                                                                           |
| `removeAssignment(assignmentId, reason)`                                                        | RPC `remove_assignment`                         | Motivo obligatorio → `REASON_REQUIRED`. `ASSIGNMENT_STARTED` si ya tiene inicio registrado (se cierra con `close_assignment`, F14).                                                                                                                                                                                                                             |
| `updateAssignmentTime(assignmentId, start?, end?)`                                              | RPC `update_assignment_time`                    | Franja propia (P-046), solo antes del inicio efectivo → `ASSIGNMENT_STARTED`.                                                                                                                                                                                                                                                                                   |
| `updateShiftDetails(shiftId, requiredStaff, notes?)`                                            | RPC `update_shift_details`                      | Dotación 1..10 (`REQUIRED_STAFF_RANGE`) y notas administrativas. Rechaza bajar la dotación por debajo de los asignados vigentes (`REQUIRED_STAFF_BELOW_ASSIGNED`). Usada también desde ADM-07 en edición (ASSIGN-013).                                                                                                                                          |

## Próximos dominios

Cada paquete de F10 en adelante agrega su sección acá (`attendance`,
`supervisions`, `tasks`) siguiendo el mismo formato: función, canal,
particularidades que no se deducen de leer el nombre.
