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
| `uploadCompanyLogo(file, updatedBy, previousLogoPath)`                                                                   | `storage.from('branding')` + update | Nombre fijo `logo.{ext}` con `upsert`; valida tipo (PNG/JPEG/WebP) y tamaño (1 MB) antes de subir. Si la extensión cambió, borra el archivo anterior (best effort, no interrumpe la operación si falla). Login y sidebar lo leen con `useBranding`/`brandingLogoUrl` (`src/features/auth/`).                    |
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

**`set_assignment_notes` ya existe** (resuelto en P13.1, `0026_rpc_attendance.sql`
-- esta nota quedó desactualizada desde P11.3, cuando todavía no se había
escrito): la función vive en `src/api/attendance.ts` (`setAssignmentNotes`),
la usa el empleado desde EMP-09 (`docs/features/app-del-empleado.md`, P13.3).
ADM-06 (esta sección) sigue mostrando `assignments.notes` de solo lectura --
no hay pantalla administrativa que la edite todavía, pero ya no es porque la
RPC no exista.

| Función                                                                                         | Canal                                           | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchShiftsBoardByRange(from, to, filters)`                                                    | `from('v_shifts_board')`                        | Calendario mensual (ADM-03). Filtros cliente, sede, estado mostrado por columna; filtro empleado resuelto con una consulta previa a `assignments` (ids de turno con asignación vigente de ese empleado).                                                                                                                                                                                                                                                  |
| `fetchAssignmentsBoardByRange(from, to, filters)`                                               | `from('v_assignments_board')`                   | Grilla semanal (ADM-04). Filtros cliente, sede.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `fetchShiftDetail(shiftId)`                                                                     | `from('shifts')` + embebidos                    | Detalle del turno (ADM-06). Un solo `select` con `clients`, `sites`, `assignments` (solo vigentes, con `employees`/`profiles` embebidos), `shift_tasks` (ordenadas por `position`) y `supervisions` (con supervisor embebido). El inicio/fin real y los avisos de cada asignación (ATT-014, P14.3) se piden aparte, con `fetchAssignmentsAttendance`/`fetchAttendanceTimeline` de `attendance.ts` -- no se embeben acá, para no acoplar los dos dominios. |
| `fetchAssignCandidates({shiftId, clientId, shiftDate, startTime, endTime, excludeEmployeeIds})` | `from('v_employees')` + 4 consultas en paralelo | Candidatos de ADM-08: `effective_status = 'active'`, marcas de habilitación (`employee_client_permissions`), disponibilidad (`employee_availability`, contra el día de semana y el horario del turno) y licencia (`employee_leaves`, contra `shiftDate`), más otras asignaciones vigentes del empleado ese mismo día. Ordena habilitados y disponibles primero.                                                                                           |
| `assignEmployee({shiftId, employeeId, start?, end?})`                                           | RPC `assign_employee`                           | Devuelve `{assignment, warnings}`. Advertencias `NOT_ENABLED_FOR_CLIENT`/`OUTSIDE_AVAILABILITY`/`ON_LEAVE` (no bloquean, P-034/P-035/P-033). Errores: `SHIFT_FULL`, `ASSIGNMENT_OVERLAP`, `ALREADY_ASSIGNED`, `ASSIGNMENT_TIME_OUT_OF_SHIFT`, `EMPLOYEE_NOT_ACTIVE`, `SHIFT_STARTED`.                                                                                                                                                                     |
| `removeAssignment(assignmentId, reason)`                                                        | RPC `remove_assignment`                         | Motivo obligatorio → `REASON_REQUIRED`. `ASSIGNMENT_STARTED` si ya tiene inicio registrado (se cierra con `close_assignment`, F14).                                                                                                                                                                                                                                                                                                                       |
| `updateAssignmentTime(assignmentId, start?, end?)`                                              | RPC `update_assignment_time`                    | Franja propia (P-046), solo antes del inicio efectivo → `ASSIGNMENT_STARTED`.                                                                                                                                                                                                                                                                                                                                                                             |
| `updateShiftDetails(shiftId, requiredStaff, notes?)`                                            | RPC `update_shift_details`                      | Dotación 1..10 (`REQUIRED_STAFF_RANGE`) y notas administrativas. Rechaza bajar la dotación por debajo de los asignados vigentes (`REQUIRED_STAFF_BELOW_ASSIGNED`). Usada también desde ADM-07 en edición (ASSIGN-013).                                                                                                                                                                                                                                    |

### `attendance` (`src/api/attendance.ts`, P13.1/P13.2 — ATT-005; P14.3 — ATT-010 a ATT-014, ABS-006)

Empieza en P13.1/P13.2 (`record_check_in`, `record_check_out`,
`set_assignment_notes` de `0026_rpc_attendance.sql`, para EMP-05/EMP-07/
EMP-09 del empleado -- sección nunca agregada acá, se completa ahora de
paso) y se extiende en P14.3 con `admin_record_attendance`/
`close_assignment` (`0027_rpc_notices_admin_attendance.sql`) y las lecturas
de `v_assignments_board` para ADM-06, ADM-10 y ADM-12. El aviso de demora o
ausencia está en `src/api/notices.ts` (abajo).

| Función                                                  | Canal                                                       | Notas                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordCheckIn(assignmentId, coords)`                    | RPC `record_check_in`                                       | E propia. `coords` `null` = sin ubicación (ADR-009, nunca bloquea). `NOT_TODAY`, `ALREADY_CHECKED_IN`, `COORDINATES_*`.                                                                                                                               |
| `recordCheckOut(assignmentId, coords)`                   | RPC `record_check_out`                                      | Igual criterio. `NOT_CHECKED_IN`, `ALREADY_CHECKED_OUT`.                                                                                                                                                                                              |
| `setAssignmentNotes(assignmentId, notes)`                | RPC `set_assignment_notes`                                  | Observación del servicio (P-062). `NOTES_TOO_LONG`.                                                                                                                                                                                                   |
| `adminRecordAttendance(assignmentId, kind, reason, at?)` | RPC `admin_record_attendance`                               | ADM-11. O; A + `manage_attendance`. Motivo siempre obligatorio. `at` opcional (por defecto ahora), entre las 0:00 del día del turno y ahora → `AT_OUT_OF_RANGE`. `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN`, `ALREADY_CHECKED_OUT`, `INVALID_TIME_RANGE`. |
| `closeAssignment(assignmentId, reason, at?)`             | RPC `close_assignment`                                      | ADM-11, "cierre manual" (P-069). Mismas validaciones que `adminRecordAttendance('check_out', ...)`: es un atajo semántico de la misma regla del servidor.                                                                                             |
| `fetchAttendanceBoardByDate(date, filters?)`             | `from('v_assignments_board')`                               | ADM-10: asignaciones vigentes de una fecha, con `display_status`, inicio/fin reales, origen (`check_in_source`/`recorded_by`) y último aviso. Filtros cliente, sede, estado mostrado.                                                                 |
| `fetchEmployeeAttendanceHistory(employeeId, from, to)`   | `from('v_assignments_board')`                               | ADM-12: historial por empleado y rango, incluidas las asignaciones quitadas (a diferencia de `fetchAttendanceBoardByDate`).                                                                                                                           |
| `fetchAssignmentsAttendance(assignmentIds)`              | `from('v_assignments_board')`                               | ADM-06: mismas columnas, por lista de ids de asignación (las vigentes de un turno puntual).                                                                                                                                                           |
| `fetchAttendanceTimeline(assignmentIds)`                 | `from('attendance_records')` + `from('attendance_notices')` | ADM-06: historial COMPLETO (todos los avisos, no solo el último de `v_assignments_board`), para el `Timeline`. RLS `..._select_admin` de `0012_rls_policies.sql`.                                                                                     |
| `fetchEmployeePhonesByIds(employeeIds)`                  | `from('v_employees')`                                       | Para "llamar" (`tel:`) desde ADM-10; `v_assignments_board` no trae el teléfono.                                                                                                                                                                       |
| `fetchPeopleNamesByIds(profileIds)`                      | `from('v_people_basic')`                                    | Resuelve `recorded_by`/`reported_by` (ids) a nombre y apellido, para "lo cargó `<nombre>`" (ATT-014).                                                                                                                                                 |

### `notices` (`src/api/notices.ts`, P14.2 y P14.3 — ABS-004, ABS-008)

`notifyDelay(assignmentId, minutes, reasonText?)` y
`notifyAbsence(assignmentId, reasonCode, reasonText?)`, sobre las RPC
`notify_delay` y `notify_absence`. Las usan el empleado desde EMP-12 y el
dueño o el administrador con `manage_attendance` desde ADM-11, en nombre del
empleado: la RPC decide según quién llama. La demora es solo antes del inicio
efectivo, con minutos de 1 a 600 (P-072). La ausencia exige motivo, y texto si
es `other`; en nombre del empleado se acepta también después del inicio
mientras no haya inicio registrado (P14.0). Los motivos con sus etiquetas
están en `src/lib/absenceReasons.ts`.

`notifyOnTheWay(assignmentId, etaMinutes?)` (P19.5c, RPC `notify_on_the_way`,
migración 0033): «Estoy en camino», solo el empleado de la asignación. Ventana:
desde 3 horas antes del inicio efectivo hasta el fin; se rechaza si ya fichó el
inicio, avisó ausencia o el turno está cancelado o terminado. `etaMinutes`
opcional, de 1 a 240; el servidor calcula `estimated_arrival_at` con su reloj.
Repetirla corrige la estimación (el último aviso manda) y no cambia el estado de
la asignación. Errores nuevos: `ABSENCE_ALREADY_NOTIFIED`, `INVALID_ETA`,
`ON_THE_WAY_TOO_EARLY`, `ON_THE_WAY_TOO_LATE`; sus textos de respaldo están en
`src/features/employee/onTheWay.ts`. En la app, el botón y la hoja «¿En cuánto
llegás?» son `OnTheWayAction` (Hoy y detalle del servicio), y el estado
(«Avisaste que estás en camino · llegás ~HH:MM») sale de
`v_my_day.last_notice_kind = 'on_the_way'` y `last_notice_estimated_arrival_at`.
El aviso vence a la hora estimada + 15 min (`v_my_day.on_the_way_expires_at`,
mapeado como `onTheWayExpiresAt`; migración 0034). Vencido, la tarjeta dice «Tu
aviso de llegada venció. Si seguís en camino, avisá de nuevo.» y el botón pasa
a «Avisar de nuevo». La vigencia usa el reloj del dispositivo solo para la UI
(`useNow` cada 30 s en Hoy y en el detalle); el servidor manda.

### `checklists` (`src/api/checklists.ts`, P12.2 — TASK-003 a TASK-005)

Plantillas de tareas por cliente y por sede (ADM-26, ADM-21, ADM-22). Igual
que `clients.ts`: la lectura y edición de `checklist_templates`/
`checklist_template_items` es directa por PostgREST, sin RPC propia salvo
`clone_checklist_template` (crea la plantilla de una sede copiando los
ítems de la del cliente, P-058). `mapWriteError` traduce un `23505` (dos
plantillas para el mismo cliente/sede) a `TEMPLATE_EXISTS`.

| Función                                                      | Canal                              | Notas                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchChecklistTemplate(clientId, siteId)`                   | `from('checklist_templates')`      | `siteId` `null` = plantilla del cliente. Devuelve `null` si todavía no existe (no es un error).                                                                                                                                                                                                                                              |
| `createClientTemplate(clientId, createdBy)`                  | `insert` en `checklist_templates`  | Nombre fijo `"Plantilla de tareas"`, sin pedirlo en un formulario (decisión propia, mismo criterio que `clone_checklist_template` en el servidor, que tampoco pide uno nuevo).                                                                                                                                                               |
| `cloneChecklistTemplate(clientId, siteId)`                   | RPC `clone_checklist_template`     | Errores en voseo: `CLIENT_NOT_ACTIVE`, `SITE_NOT_ACTIVE`, `SITE_TEMPLATE_EXISTS`, `CLIENT_TEMPLATE_NOT_FOUND`.                                                                                                                                                                                                                               |
| `fetchTemplateItems(templateId)`                             | `from('checklist_template_items')` | Vigentes (`deleted_at is null`), ordenados por `position`.                                                                                                                                                                                                                                                                                   |
| `createTemplateItem(templateId, position, input, createdBy)` | `insert`                           | `position` la calcula quien llama (siguiente libre de la lista ya cargada, mismo criterio que `nextPosition` de `RatingCriteriaPage`).                                                                                                                                                                                                       |
| `updateTemplateItem(id, input, updatedBy)`                   | `update`                           | Título, descripción, `isRequired`. No toca `position`.                                                                                                                                                                                                                                                                                       |
| `deactivateTemplateItem(id, updatedBy)`                      | `update` (`deleted_at`)            | Baja lógica, con confirmación en pantalla (sin motivo obligatorio: no está en la lista de `07` sección 2.4 que sí lo exige).                                                                                                                                                                                                                 |
| `reorderTemplateItems(items, updatedBy)`                     | `upsert` (una sola llamada)        | **Importante**: un solo `upsert` con todas las filas, no varios `update` sueltos -- la unicidad `(template_id, position)` es `deferrable initially deferred` (`0008_checklists_tasks.sql`), pero PostgREST abre una transacción por request, así que un intercambio de posiciones hecho con dos `update` separados chocaría contra sí mismo. |

### `tasks` (`src/api/tasks.ts`, P12.2 — TASK-003)

La tarea ya copiada a un turno (`shift_tasks`), a diferencia de
`checklists.ts` (plantillas). `reloadShiftTasks` ya existía en
`src/api/shifts.ts` desde SHIFT-007 (F10); se reexporta acá para que ADM-06
tenga un solo punto de importación, sin duplicar la RPC.

| Función                                     | Canal                    | Notas                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateTaskStatus(taskId, status, reason?)` | RPC `update_task_status` | `reason` obligatorio si `status` es `not_done` (si no, `REASON_REQUIRED`). Dueño y administrador pueden en cualquier momento del turno (P-063); errores `TASK_NOT_FOUND`, `TASK_LOCKED`, `FORBIDDEN`. |
| `reloadShiftTasks(shiftId)`                 | RPC `reload_shift_tasks` | Reexportada desde `src/api/shifts.ts`. Ahora sí tiene pantalla que la usa: el botón "Recargar tareas" de ADM-06 (TASK-006).                                                                           |

### `supervisions` (`src/api/supervisions.ts`, P15.3 — SUP-008 a SUP-011)

Vía de administración de supervisiones (ADM-13, ADM-14, ADM-15), sobre
`0029_rpc_supervisions.sql`. `supervision_check_in`/`supervision_check_out`/
`complete_supervision` son "S (propia)": las usa la app del supervisor
(`src/api/mySupervisions.ts`, de front-movil), no este módulo.

| Función                                         | Canal                                            | Notas                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchSupervisionsAdmin(filters?)`              | `from('v_supervisions_admin')`                   | ADM-13, pestaña "Supervisiones". Filtros empleado (resuelto antes vía `ratings`), supervisor, cliente, sede, rango de fechas, estado. O, A.                                                                                                        |
| `fetchSupervisionDetail(id)`                    | `v_supervisions_admin` + `assignments`/`ratings` | ADM-15: cabecera con franja, criterios y contadores, más una fila por cada asignación vigente del turno (calificación si existe, con quién y cuándo la editó por última vez).                                                                      |
| `fetchSupervisorCandidates()`                   | `from('v_employees')`                            | ADM-14: personas con rol `supervisor`, activas (perfil y `employees.status`), mismos tres chequeos que hace `assign_supervision` del lado del servidor.                                                                                            |
| `assignSupervision(shiftId, supervisorId)`      | RPC `assign_supervision`                         | ADM-14. O; A + `manage_supervisions`. `SHIFT_NOT_FOUND`, `SHIFT_NOT_SUPERVISABLE` (turno cancelado o completado), `SUPERVISOR_ROLE_REQUIRED`, `ALREADY_ASSIGNED`. Devuelve `{ supervision, warnings }`: `SUPERVISES_OWN_SHIFT` no bloquea (P15.0). |
| `cancelSupervision(supervisionId, reason)`      | RPC `cancel_supervision`                         | ADM-15. O; A + `manage_supervisions`. Motivo obligatorio → `CANCEL_REASON_REQUIRED`. Solo `assigned`/`in_progress` → `SUPERVISION_NOT_EDITABLE`.                                                                                                   |
| `markSupervisionNotDone(supervisionId, reason)` | RPC `mark_supervision_not_done`                  | ADM-15. S (propia, `NOT_YOUR_SUPERVISION` si es de otro supervisor); O, A sin capacidad adicional. Motivo obligatorio → `REASON_REQUIRED`.                                                                                                         |

### `ratings` (`src/api/ratings.ts`, P15.3 — SUP-008, SUP-011)

Calificaciones ya cargadas (pestaña "Calificaciones" de ADM-13 y
"Calificaciones recibidas" de ADM-17) y la edición administrativa de ADM-15.
Los criterios de calificación (`fetchRatingCriteria`, ADM-30) viven en
`src/api/settings.ts` desde USERS-015, no se duplican acá.

| Función                                                          | Canal               | Notas                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetchRatings(filters?)`                                         | `from('ratings')`   | Filtros por empleado, supervisor, sede y rango de fechas, resueltos en el cliente (decisión propia, ver el reporte del encargo). O, A -- el empleado no ve esta tabla por ninguna vía (P-084, RLS de `0012`).                                                                                                                  |
| `rateEmployee({ supervisionId, assignmentId, score, comment? })` | RPC `rate_employee` | Upsert (una fila por asignación). S (propia, dentro del plazo de P-083: hasta el fin del turno o de la supervisión, lo que ocurra último); O, A + `edit_ratings` (siempre, sin ventana). `SUPERVISION_NOT_ACTIVE`, `ASSIGNMENT_NOT_IN_SHIFT`, `SELF_RATING_NOT_ALLOWED` (CB-13), `SCORE_OUT_OF_RANGE`, `RATING_WINDOW_CLOSED`. |

### Ajustes de la reunión del 6 oct 2026 (P19.5b — AJ-01 a AJ-10)

Detalle y decisiones en `docs/features/ajustes-reunion-6-oct.md`.

| Función                                                      | Canal                          | Notas                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users.updatePersonName({ profileId, firstName, lastName })` | RPC `update_person_name`       | Dueño a cualquiera (incluido él); cualquier persona activa a sí misma. `FORBIDDEN`, `PROFILE_NOT_FOUND`, `NAME_REQUIRED`, `NAME_TOO_LONG` (100). |
| `ratings.fetchEmployeeRatingsSummary()`                      | `from('v_employee_ratings')`   | Una sola consulta para todos los empleados: mapa `employee_id` -> `{ average, count }`. Sin fila = sin calificaciones. Solo O, A.                |
| `clients.fetchClientServiceSummary(clientId, from, to)`      | RPC `client_service_summary`   | Totales y turnos realizados con sus empleados. O, A. `INVALID_DATE_RANGE`, `CLIENT_NOT_FOUND`, `FORBIDDEN`.                                      |
| `clients.fetchClientsWorkedMinutes(from, to)`                | RPC `clients_worked_minutes`   | Mapa `client_id` -> minutos (0 si no hubo trabajo), una llamada para todo el listado. O, A. `INVALID_DATE_RANGE`.                                |
| `attendance` (columnas nuevas)                               | `from('v_assignments_board')`  | `AttendanceBoardRow` suma `lastNoticeEstimatedArrivalAt`, `plannedMinutes` y `workedMinutes`; `displayStatus` puede valer `on_the_way` y `late`. |
| `supervisions` (columnas nuevas)                             | `from('v_supervisions_admin')` | `SupervisionListRow` suma `plannedMinutes` y `workedMinutes`.                                                                                    |

### Asignar al crear y empleados fijos (P19.6 paquete F — AJ2-17)

Detalle y decisiones en `docs/features/ajustes-reunion-9-oct-paquete-f.md`. Base: migración `0041`.

| Función                                             | Canal                                 | Notas                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifts.createShift({ ..., employeeIds? })`         | RPC `create_shift` (`p_employee_ids`) | Además de `shiftId` y `warnings`, devuelve `assigned: [{ employeeId, assignmentId, warnings }]` y `rejected: [{ employeeId, employeeName, code, message }]`. El turno se crea siempre; los rechazados (`ASSIGNMENT_OVERLAP`, `EMPLOYEE_NOT_ACTIVE`, `SHIFT_FULL`, `SHIFT_STARTED`) no frenan el alta. Las advertencias de `assigned` (`NOT_ENABLED_FOR_CLIENT`, `OUTSIDE_AVAILABILITY`, `ON_LEAVE`) no bloquean. |
| `shifts.generateShifts(year, month)`                | RPC `generate_shifts`                 | Suma `assigned` (asignaciones de fijos hechas), `unassigned: [{ shiftId, shiftDate, serviceId, employeeId, employeeName, code, message }]` (`ON_LEAVE`, `OUTSIDE_AVAILABILITY`, `ASSIGNMENT_OVERLAP`, `EMPLOYEE_NOT_ACTIVE`, `SHIFT_FULL`) y `pastWithoutFixed` (turnos de días que ya empezaron, sin fijos).                                                                                                    |
| `services.fetchServiceFixedEmployees(serviceId)`    | `from('service_fixed_employees')`     | Ids de los fijos del servicio. Solo O, A.                                                                                                                                                                                                                                                                                                                                                                        |
| `services.setServiceFixedEmployees(serviceId, ids)` | RPC `set_service_fixed_employees`     | Reemplaza la lista (vacía = sin fijos). `SERVICE_NOT_FOUND`, `FIXED_EXCEEDS_STAFF`, `EMPLOYEE_NOT_ACTIVE`. No toca turnos ya generados.                                                                                                                                                                                                                                                                          |
| `services.updateService` (error nuevo)              | `from('services')`                    | Bajar `required_staff` por debajo de la cantidad de fijos devuelve `FIXED_EXCEEDS_STAFF` (P0001, pasa tal cual por `fromPostgrestError`).                                                                                                                                                                                                                                                                        |
| `services.fetchServiceLabels(ids)`                  | `from('services')`                    | Servicio, cliente y sede por id, para rotular los «sin asignar» de ADM-09.                                                                                                                                                                                                                                                                                                                                       |
| `employees.fetchActiveEmployeeOptions()`            | `from('v_employees')`                 | Empleados con estado guardado `active`, por legajo: `{ profileId, name, employeeNumber }`. Alimenta el selector múltiple.                                                                                                                                                                                                                                                                                        |

### Avisos y anuncios de administración (AJ2-03, paquete E)

`src/api/announcements.ts`. Nada que ver con `notices.ts` (avisos de demora y
ausencia). Lo que ve y cierra la persona en el celular está en
`myAnnouncements.ts` (paquete móvil). Los errores de las RPC llegan como
`ApiError` con el `message` del servidor y el `hint` en mayúsculas.

| Función                             | Canal                               | Notas                                                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchAnnouncements(status?)`       | `from('v_announcements_admin')`     | Por fecha de alta descendente. `status`: `active`, `expired`, `archived`; sin él trae todos. Incluye `recipientCount` y `readCount`. Solo O, A (para el resto la vista sale vacía).                                                                     |
| `fetchAnnouncement(id)`             | `from('v_announcements_admin')`     | Una fila o `null`.                                                                                                                                                                                                                                      |
| `fetchAnnouncementRecipients(id)`   | `from('v_announcement_recipients')` | Destinatarios actuales con `readAt` (`null` = todavía no). El orden lo arma `sortRecipients` (primero quienes no lo leyeron).                                                                                                                           |
| `fetchAnnouncementRecipientIds(id)` | `from('announcement_recipients')`   | Personas guardadas de un anuncio `custom`, para precargar la edición.                                                                                                                                                                                   |
| `createAnnouncement(input)`         | RPC `create_announcement`           | Devuelve el id. Fuera de `custom` no se mandan destinatarios. `TITLE_REQUIRED`, `TITLE_TOO_LONG` (120), `BODY_REQUIRED`, `BODY_TOO_LONG` (2000), `AUDIENCE_REQUIRED`, `VISIBLE_UNTIL_IN_PAST`, `RECIPIENTS_REQUIRED`, `RECIPIENT_INVALID`, `FORBIDDEN`. |
| `updateAnnouncement(id, input)`     | RPC `update_announcement`           | Reemplaza todos los campos (`visibleUntil: null` quita el vencimiento). Suma `ANNOUNCEMENT_NOT_FOUND` y `ANNOUNCEMENT_ARCHIVED`. Cambiar título o texto hace que quienes ya lo leyeron lo vuelvan a ver.                                                |
| `archiveAnnouncement(id)`           | RPC `archive_announcement`          | Idempotente. `ANNOUNCEMENT_NOT_FOUND`, `FORBIDDEN`.                                                                                                                                                                                                     |

Hooks en `src/features/announcements/queries.ts` (claves `['announcements', ...]`;
polling de 60 s en listado, detalle y lecturas).

## Próximos dominios

Cada paquete de F10 en adelante agrega su sección acá (`myDay`) siguiendo
el mismo formato: función, canal, particularidades que no se deducen de
leer el nombre.
