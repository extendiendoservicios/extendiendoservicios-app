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

| Función                                                                                        | Canal                                   | Notas                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchClients(filters)`                                                                        | `from('v_clients')`                     | Filtros de texto (`ilike` sobre razón social, fantasía y CUIT) y estado, siempre `deleted_at is null`. `sites_count` cuenta sedes vigentes sin filtrar por estado (la pantalla lo etiqueta "Sedes", no "Sedes activas" — ver `docs/features/clientes.md`). |
| `fetchPrimaryContactNames()`                                                                   | `from('client_contacts')`               | Mapa `clientId → nombre` del contacto con `is_primary = true`, para la columna de ADM-19 (`v_clients` no lo trae).                                                                                                                                         |
| `fetchClientDetail(id)`, `createClient`, `updateClient`                                        | `from('clients')`                       | `createClient`/`updateClient` mapean `ClientFormInput` ↔ columnas `snake_case`; CUIT repetido → `ApiError('Ese CUIT ya está registrado.', 'CUIT_IN_USE')`.                                                                                                 |
| `setClientStatus(id, status, updatedBy)`                                                       | `from('clients')`                       | Solo toca `status` (CLIENT-006), aparte del formulario completo.                                                                                                                                                                                           |
| `fetchClientContacts`, `createClientContact`, `updateClientContact`, `deactivateClientContact` | `from('client_contacts')`               | Baja lógica con `deleted_at`.                                                                                                                                                                                                                              |
| `setPrimaryClientContact(clientId, contactId, updatedBy)`                                      | `from('client_contacts')`, dos `update` | Sin RPC que lo haga en una transacción: primero le saca `is_primary` al contacto anterior, después se lo pone al nuevo (el índice único parcial `client_contacts_one_primary_per_client_idx` rechaza tener dos filas en `true` a la vez).                  |
| `fetchClientSites(clientId)`                                                                   | `from('sites')`                         | Listado simple para la pestaña Sedes de ADM-21; el alta y el detalle de sede son de P08.4.                                                                                                                                                                 |

## Próximos dominios

Cada paquete de F8 en adelante agrega su sección acá (`sites`,
`employees`, `shifts`, `attendance`, `supervisions`, `tasks`) siguiendo el
mismo formato: función, canal, particularidades que no se deducen de leer
el nombre.
