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
| `createAdminUser(input)`                                                          | Edge `admin-users`, `create_user`                                        | Siempre `roles: ['admin']` desde ADM-27 (ver `docs/features/users.md`). Si el rol incluye `admin`, la propia Edge Function activa las siete capacidades.                                                                                                                                                                                                                               |
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

## Próximos dominios

Cada paquete de F8 en adelante agrega su sección acá (`clients`,
`employees`, `shifts`, `attendance`, `supervisions`, `tasks`) siguiendo el
mismo formato: función, canal, particularidades que no se deducen de leer
el nombre.
