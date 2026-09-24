// tests/e2e-users/helpers/adminUsersClient.ts — USERS-018/TEST-004 (P07.4)
//
// Utilidades comunes a los specs de esta suite: crear/borrar cuentas descartables con la clave
// de servicio, iniciar sesión como una cuenta descartable sin pasar por el navegador (para
// obtener su `access_token` y probar la ventana de revocación por API directa, "por interfaz y
// por API directa con supabase-js" — regla común de la suite de permisos, aplicada acá al caso
// de USERS-018 que lo necesita) y llamar a la Edge Function `admin-users` sin la UI, para los
// casos de permisos negativos (un administrador que intenta `create_user`/`reactivate_user`
// fuera de su alcance, o el intento de desactivar al último dueño).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readE2eUsersEnv } from './env.ts'

let cachedAdmin: SupabaseClient | null = null

/** Cliente con la clave de servicio, para preparar y limpiar cuentas descartables. */
export function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin
  const env = readE2eUsersEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cachedAdmin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdmin
}

/**
 * Prefijo reconocible (regla común 7 del encargo, "Independencia"): todo lo que esta suite crea
 * en `App_dev` lleva este prefijo en el email. Distinto del de `tests/e2e-auth/`
 * (`e2e-auth-`) y del de `tests/permissions/` para poder identificar de un vistazo qué suite
 * dejó cada cuenta, si algo quedara a medio limpiar.
 */
export const E2E_EMAIL_PREFIX = 'e2e-p074-'

/** Email descartable único por corrida, en un dominio que no es el de la empresa real. */
export function disposableEmail(slug: string): string {
  return `${E2E_EMAIL_PREFIX}${slug}-${Date.now()}@example.com`
}

/**
 * Da de baja una cuenta descartable SIN pasar por la Edge Function `admin-users` (a diferencia
 * de `deactivateUserViaFunction` más abajo): usa la Admin API directo, igual que
 * `tests/e2e-auth/helpers/adminClient.ts`. Se usa en la limpieza de los specs que no necesitan
 * probar la acción `deactivate_user` en sí (para no gastar cupo del límite de 10 acciones por
 * minuto del dueño, que si se probara de verdad en cada limpieza podría chocar con el propio
 * límite que la suite tiene que respetar — regla del encargo, "Tené en cuenta el límite de 10
 * acciones por minuto").
 */
export async function banDirectly(
  admin: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { error: banError } = await admin.auth.admin.updateUserById(profileId, {
    ban_duration: '876000h',
  })
  if (banError) {
    throw new Error(
      `No se pudo banear ${profileId} en la limpieza: ${banError.message}`,
    )
  }
  const { error: profileError } = await admin
    .from('profiles')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', profileId)
  if (profileError) {
    throw new Error(
      `No se pudo marcar is_active=false a ${profileId} en la limpieza: ${profileError.message}`,
    )
  }
}

/**
 * Inicia sesión como `email`/`password` sin usar el navegador (cliente `supabase-js` anónimo
 * propio, descartado al terminar). Devuelve el `access_token` crudo para armar pedidos REST
 * directos con ese Bearer — así se puede comprobar qué ve ese token DESPUÉS de que el dueño
 * desactive o reactive a la persona, sin que el propio cliente intente renovarlo solo
 * (`autoRefreshToken: false`, igual que el resto de los clientes de esta suite).
 */
export async function signInForToken(
  email: string,
  password: string,
): Promise<{ accessToken: string; userId: string }> {
  const env = readE2eUsersEnv()
  if (!env) {
    throw new Error('signInForToken() llamado sin .env.local completo.')
  }
  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password,
  })
  if (error || !data.session) {
    throw new Error(
      `No se pudo iniciar sesión como ${email}: ${error?.message ?? 'sin sesión'}`,
    )
  }
  return { accessToken: data.session.access_token, userId: data.user.id }
}

/**
 * Lee `profiles` por PostgREST con un `access_token` fijo, sin pasar por `supabase-js` (que
 * intentaría validar/renovar la sesión) — un `fetch` directo a `/rest/v1/profiles`, igual que
 * haría cualquier cliente HTTP con ese Bearer. Devuelve la cantidad de filas visibles: 0 si la
 * política RLS de "fila propia" no matchea (perfil desactivado, `04_Modelo_de_Datos.md` sección
 * 7.1 y la migración `0022_own_row_policies_active_check.sql`).
 */
export async function countOwnProfileRowsWithToken(
  accessToken: string,
  profileId: string,
): Promise<number> {
  const env = readE2eUsersEnv()
  if (!env) {
    throw new Error(
      'countOwnProfileRowsWithToken() llamado sin .env.local completo.',
    )
  }
  const response = await fetch(
    `${env.supabaseUrl}/rest/v1/profiles?id=eq.${profileId}&select=id`,
    {
      headers: {
        apikey: env.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )
  if (!response.ok) {
    throw new Error(
      `La lectura directa de profiles devolvió ${response.status}: ${await response.text()}`,
    )
  }
  const rows = (await response.json()) as unknown[]
  return rows.length
}

export interface AdminUsersFunctionResult {
  status: number
  body:
    | { data?: Record<string, unknown> }
    | { error: { message: string; hint: string } }
}

/**
 * Llama a la Edge Function `admin-users` por API directa (fetch, sin pasar por
 * `supabase.functions.invoke` de la app ni por ninguna pantalla) con el `access_token` de
 * `actorAccessToken` como Bearer. Se usa para los casos de permisos negativos de USERS-018 que
 * no tienen botón en la interfaz (un administrador no ve "Nuevo administrador" para admins ni
 * "Reactivar" — `getVisibleUserActions`/`canCreateAdminUser`, `src/features/users/
 * permissions.ts` — así que la única forma de comprobar que el SERVIDOR también lo rechaza, no
 * solo la interfaz, es llamar a la acción directo) y para el intento de desactivar al último
 * dueño (mismo motivo: `UserActionsMenu` no ofrece desactivar a alguien sin las acciones
 * habilitadas, pero acá interesa el rechazo del servidor en sí, no el de la pantalla).
 */
export async function callAdminUsersFunction(
  actorAccessToken: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<AdminUsersFunctionResult> {
  const env = readE2eUsersEnv()
  if (!env) {
    throw new Error('callAdminUsersFunction() llamado sin .env.local completo.')
  }
  const response = await fetch(`${env.supabaseUrl}/functions/v1/admin-users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anonKey,
      Authorization: `Bearer ${actorAccessToken}`,
    },
    body: JSON.stringify({ action, ...body }),
  })
  const responseBody =
    (await response.json()) as AdminUsersFunctionResult['body']
  return { status: response.status, body: responseBody }
}
