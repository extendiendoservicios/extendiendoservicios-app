import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, UNKNOWN_ERROR_MESSAGE, fromPostgrestError } from './errors'

/**
 * `src/api/users.ts` (USERS-007, primer módulo de `src/api/` — el patrón
 * que siguen las próximas pantallas ADM está documentado en
 * `src/api/README.md`): usuarios, roles y capacidades de ADM-27.
 *
 * Cubre `06_API.md` sección 2: la Edge Function `admin-users` (2.1) y las
 * RPC/PostgREST de 2.2. Nada de estado de React acá (eso vive en
 * `src/features/users/queries.ts`).
 */

export type Role = Database['public']['Enums']['app_role']
export type AdminCapability = Database['public']['Enums']['admin_capability']

/** Las siete capacidades activables por administrador (04 sección 2.1). */
export const ALL_ADMIN_CAPABILITIES: AdminCapability[] = [
  'manage_users',
  'cancel_shifts',
  'edit_ratings',
  'edit_checklists',
  'manage_attendance',
  'generate_shifts',
  'manage_supervisions',
]

// -------------------------------------------------------------------------
// Lecturas (PostgREST)
// -------------------------------------------------------------------------

/** Una fila de la lista de ADM-27 (`profiles` + `user_roles` embebido). */
export interface AdminUserRow {
  profileId: string
  firstName: string
  lastName: string
  isActive: boolean
  deletedAt: string | null
  roles: Role[]
}

/**
 * Lista de usuarios con sus roles (`06_API.md` sección 2.2: "Listar
 * usuarios con roles y estado | from('profiles') + user_roles embebido").
 * No existe la vista `v_users` que el mismo renglón deja como alternativa
 * (no está en `database.types.ts`), así que se arma con el embed directo.
 *
 * Trae también los perfiles desactivados (`deleted_at` no nulo): la
 * política `profiles_select_admin` no filtra por eso para O/A (necesitan
 * el historial completo), y ADM-27 tiene que poder reactivarlos.
 *
 * No incluye el email de login: no está en `profiles` (vive en
 * `auth.users`, fuera del alcance de PostgREST) y `05_Pantallas_y_
 * Navegacion.md` no lo pide en la lista de ADM-27 (solo "roles, estado,
 * último inicio de sesión"). Ver la nota grande en el reporte del encargo.
 */
export async function fetchUsers(): Promise<AdminUserRow[]> {
  // `user_roles!user_roles_profile_id_fkey`: `user_roles` tiene DOS FK hacia
  // `profiles` (`profile_id` y `granted_by`, `database.types.ts`) -- sin el
  // hint del nombre de la restricción, PostgREST no puede elegir sola cuál
  // de las dos usar para el embed y devuelve un error de ambigüedad.
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, first_name, last_name, is_active, deleted_at, user_roles!user_roles_profile_id_fkey(role)',
    )
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => ({
    profileId: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    deletedAt: row.deleted_at,
    roles: (row.user_roles ?? []).map((userRole) => userRole.role),
  }))
}

/**
 * Último `sign_in` de cada persona (`security_events`, `04` sección 2.6,
 * AUTH-009), para la columna "último inicio de sesión" de ADM-27.
 *
 * `security_events` solo lo puede leer el owner (`security_events_select_
 * owner`, `04` sección 7.2: "O. | Solo funciones."): para un administrador
 * sin ese rol, la consulta no falla, simplemente vuelve sin filas por RLS
 * -- el mapa devuelto queda vacío y la pantalla muestra "—" en esa columna
 * en vez de romperse (decisión menor: se prefirió no exponer un error de
 * permisos por una columna que ADM-27 puede mostrar en blanco). Solo la
 * llama el hook cuando `useAuth().roles` incluye `owner`, para no gastar
 * una consulta que RLS va a vaciar igual.
 *
 * `limit(2000)` es un techo de seguridad, no un supuesto de volumen: hoy
 * (decenas de personas, P-040) nunca se acerca; si algún día se acercara,
 * lo peor que pasa es que alguna cuenta con logins muy viejos y ninguno
 * reciente quede sin fecha en vez de romper la pantalla.
 */
export async function fetchLastSignIns(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('security_events')
    .select('actor_id, created_at')
    .eq('event_type', 'sign_in')
    .order('created_at', { ascending: false })
    .limit(2000)

  if (error) {
    throw fromPostgrestError(error)
  }

  const lastSignInByProfileId = new Map<string, string>()
  for (const event of data ?? []) {
    if (!event.actor_id || lastSignInByProfileId.has(event.actor_id)) {
      continue
    }
    lastSignInByProfileId.set(event.actor_id, event.created_at)
  }
  return lastSignInByProfileId
}

/**
 * Capacidades de un administrador puntual (`admin_capabilities`), para el
 * editor de ADM-27 que "solo el dueño ve y edita" (`05` sección 2, nota de
 * permisos). La política `admin_capabilities_select_owner` ya lo exige del
 * lado del servidor; acá se completan en `false` las capacidades que no
 * tengan fila todavía (no debería pasar -- `create_user` inserta las siete
 * al crear un administrador -- pero una fila faltante no tiene por qué
 * romper el editor).
 */
export async function fetchAdminCapabilities(
  profileId: string,
): Promise<Record<AdminCapability, boolean>> {
  const { data, error } = await supabase
    .from('admin_capabilities')
    .select('capability, enabled')
    .eq('profile_id', profileId)

  if (error) {
    throw fromPostgrestError(error)
  }

  const capabilities = Object.fromEntries(
    ALL_ADMIN_CAPABILITIES.map((capability) => [capability, false]),
  ) as Record<AdminCapability, boolean>
  for (const row of data ?? []) {
    capabilities[row.capability] = row.enabled
  }
  return capabilities
}

// -------------------------------------------------------------------------
// RPC (`set_user_roles`, `set_admin_capability`)
// -------------------------------------------------------------------------

/**
 * Reemplaza el conjunto de roles de una persona (`06_API.md` sección 2.2).
 * Errores posibles: `FORBIDDEN`, `PROFILE_NOT_FOUND`, `ROLE_REQUIRES_
 * EMPLOYEE`, `LAST_OWNER`. Si el conjunto resultante le quita un rol a la
 * persona, quien llama tiene que invocar después `signOutUser` (P-015):
 * esta RPC no cierra sesiones por sí sola.
 */
export async function setUserRoles(
  profileId: string,
  roles: Role[],
): Promise<Role[]> {
  const { data, error } = await supabase.rpc('set_user_roles', {
    p_profile_id: profileId,
    p_roles: roles,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return data ?? []
}

/**
 * Activa o desactiva una capacidad de un administrador (`06_API.md`
 * sección 2.2). Solo el dueño puede llamarla (RPC y política); errores
 * posibles: `FORBIDDEN`, `ADMIN_ROLE_REQUIRED`.
 */
export async function setAdminCapability(
  profileId: string,
  capability: AdminCapability,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_admin_capability', {
    p_profile_id: profileId,
    p_capability: capability,
    p_enabled: enabled,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

// -------------------------------------------------------------------------
// Edge Function `admin-users` (06_API.md sección 2.1)
// -------------------------------------------------------------------------

interface AdminUsersErrorPayload {
  error: { message: string; hint: string }
}

/**
 * Invoca la Edge Function `admin-users` y traduce su contrato propio
 * (`{ data }` o `{ error: { message, hint } }`, ver `supabase/functions/
 * admin-users/index.ts`) a `ApiError`/valor de retorno, igual que
 * `fromPostgrestError` hace para las RPC. Único punto del módulo que
 * conoce el detalle de `supabase.functions.invoke` (`FunctionsHttpError`
 * trae el cuerpo en `error.context`, una `Response` todavía sin leer -- ver
 * el comentario de `FunctionsClient.invoke` en `@supabase/functions-js`).
 */
async function invokeAdminUsers<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  // Casteo explícito de la respuesta: `invoke<T>` devuelve `error: any`
  // (`FunctionsResponseFailure`, `@supabase/functions-js`) -- `unknown` en
  // vez de dejarlo pasar como `any` evita que el resto de la función pierda
  // el chequeo de tipos por una sola propiedad.
  const { data, error } = (await supabase.functions.invoke<
    { data: T } | AdminUsersErrorPayload
  >('admin-users', { body: { action, ...body } })) as {
    data: ({ data: T } | AdminUsersErrorPayload) | null
    error: unknown
  }

  if (error) {
    if (error instanceof FunctionsHttpError) {
      // `context` está tipado `any` en `@supabase/functions-js` (ver el
      // comentario de la función): acá SIEMPRE es la `Response` sin leer
      // que devolvió el `fetch` a la Edge Function (`FunctionsClient.
      // invoke`, "throw new FunctionsHttpError(response)").
      const response = error.context as Response
      const payload = (await response
        .json()
        .catch(() => null)) as AdminUsersErrorPayload | null
      if (payload?.error) {
        throw new ApiError(payload.error.message, payload.error.hint)
      }
    }
    throw new ApiError(UNKNOWN_ERROR_MESSAGE)
  }

  if (data && 'error' in data) {
    throw new ApiError(data.error.message, data.error.hint)
  }

  return (data as { data: T }).data
}

/**
 * Datos de `employees` que exige `create_user` cuando `roles` incluye
 * `employee` o `supervisor` (`06_API.md` sección 2.1: "employee (datos de
 * employees, obligatorio si roles incluye employee o supervisor)"). Usado
 * tanto por ADM-27 (nunca lo manda: siempre `roles: ['admin']`) como por
 * ADM-18 (EMP-003, `src/api/employees.ts`).
 */
export interface CreateUserEmployeeInput {
  dni: string
  cuil?: string | null
  address?: string | null
  birthDate?: string | null
  hireDate?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  emergencyContactRelationship?: string | null
  notes?: string | null
}

export interface CreateAdminUserInput {
  email: string
  password: string
  firstName: string
  lastName: string
  /**
   * Alta de ADM-27: siempre `['admin']` (el dueño se crea por el seed,
   * P-019). Alta de ADM-18 (EMP-003): `['employee']`, `['supervisor']` o
   * ambos.
   */
  roles: Role[]
  /** Obligatorio cuando `roles` incluye `employee` o `supervisor` (`06` sección 2.1). */
  employee?: CreateUserEmployeeInput
}

/**
 * Alta de un usuario, con o sin datos de empleado (USERS-009/EMP-003, `06`
 * acción `create_user`). Si `roles` incluye `admin`, la propia Edge Function
 * inserta las siete capacidades en `true` (confirmado por Mike el 23 sep
 * 2026, ver el comentario de cabecera de `admin-users/index.ts`) -- esta
 * función no repite esa lógica. Si `roles` incluye `employee`/`supervisor`,
 * la misma Edge Function crea la fila de `employees` en la misma llamada
 * (una sola invocación, sin un segundo paso desde el cliente que pudiera
 * dejar un usuario de Auth huérfano -- ver el comentario de cabecera de
 * `actionCreateUser` en `admin-users/index.ts` y el reporte de EMP-003).
 */
export async function createAdminUser(
  input: CreateAdminUserInput,
): Promise<{ profileId: string }> {
  const result = await invokeAdminUsers<{ profile_id: string }>('create_user', {
    email: input.email,
    password: input.password,
    first_name: input.firstName,
    last_name: input.lastName,
    roles: input.roles,
    ...(input.employee
      ? {
          employee: {
            dni: input.employee.dni,
            cuil: input.employee.cuil ?? null,
            address: input.employee.address ?? null,
            birth_date: input.employee.birthDate ?? null,
            hire_date: input.employee.hireDate ?? null,
            emergency_contact_name: input.employee.emergencyContactName ?? null,
            emergency_contact_phone:
              input.employee.emergencyContactPhone ?? null,
            emergency_contact_relationship:
              input.employee.emergencyContactRelationship ?? null,
            notes: input.employee.notes ?? null,
          },
        }
      : {}),
  })
  return { profileId: result.profile_id }
}

/** USERS-011: resetear contraseña (revoca las sesiones de la persona). */
export async function resetPassword(
  profileId: string,
  newPassword: string,
): Promise<void> {
  await invokeAdminUsers('reset_password', {
    profile_id: profileId,
    new_password: newPassword,
  })
}

/** USERS-011: cambiar el email de login. */
export async function updateEmail(
  profileId: string,
  email: string,
): Promise<void> {
  await invokeAdminUsers('update_email', { profile_id: profileId, email })
}

/** USERS-011: cerrar todas las sesiones de la persona (P-015). */
export async function signOutUser(profileId: string): Promise<void> {
  await invokeAdminUsers('sign_out_user', { profile_id: profileId })
}

/** USERS-011: dar de baja lógica, con motivo obligatorio. */
export async function deactivateUser(
  profileId: string,
  reason: string,
): Promise<void> {
  await invokeAdminUsers('deactivate_user', { profile_id: profileId, reason })
}

/** USERS-011: reactivar (solo el dueño). */
export async function reactivateUser(profileId: string): Promise<void> {
  await invokeAdminUsers('reactivate_user', { profile_id: profileId })
}
