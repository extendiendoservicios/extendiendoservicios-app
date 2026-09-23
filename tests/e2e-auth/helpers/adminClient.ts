// tests/e2e-auth/helpers/adminClient.ts — AUTH-012/TEST-003 (P06.4)
//
// Cliente `supabase-js` con la clave de servicio, para preparar y limpiar cuentas descartables
// (nunca para probar qué puede hacer un rol: eso es `tests/permissions/`). Un solo cliente por
// corrida de la suite, creado a demanda con `getAdminClient()` para no fallar al importarse el
// módulo si `.env.local` no está completo (los specs deciden solos si se saltean, con
// `readE2eAuthEnv()`).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readE2eAuthEnv } from './env.ts'

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (cached) return cached
  const env = readE2eAuthEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

/**
 * Prefijo reconocible (regla común 7 y regla del encargo "Independencia"): todo lo que esta
 * suite crea en `App_dev` lleva este prefijo en el email, y se borra al final de cada test (aun
 * si falla — ver el `try/finally` de cada spec), nunca en el seed compartido.
 */
export const E2E_EMAIL_PREFIX = 'e2e-auth-'

/** Email descartable único por corrida, en un dominio que no es el de la empresa real. */
export function disposableEmail(slug: string): string {
  return `${E2E_EMAIL_PREFIX}${slug}-${Date.now()}@example.com`
}

/**
 * Crea una cuenta descartable en Auth (sin rol: alcanza para probar credenciales, recuperación
 * y desactivación — el hook de claims le entrega `roles: []`, y `RequireRole` la manda a
 * `/sin-acceso`, que es justamente lo que hace falta para no depender de datos de negocio).
 * Email ya confirmado, así `signInWithPassword` no lo rechaza por eso.
 */
export async function createDisposableUser(
  admin: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: 'E2E', last_name: 'Autenticación' },
  })
  if (error || !data.user) {
    throw new Error(
      `No se pudo crear la cuenta descartable ${email}: ${error?.message ?? 'sin usuario'}`,
    )
  }
  return data.user.id
}

/**
 * Borra la cuenta descartable, aun si el test que la creó falló.
 *
 * `auth.admin.deleteUser()` sola falla con "Database error deleting user" (500) para cualquier
 * cuenta con fila en `public.profiles` (el trigger `app.handle_new_user()` le crea una a todas):
 * `profiles.id references auth.users (id)` (0003) y `security_events.actor_id`/`target_id
 * references profiles (id)` (0004) no tienen `on delete cascade`. **Es a propósito, no un
 * defecto**: el plan dice que nada se borra físicamente (`03` sección 1, `04` sección 1, P-014 y
 * P-105). Dar de baja a alguien es `deactivate_user` (`06`): baneo, `is_active = false` y
 * `deleted_at`. Esas claves foráneas son las que protegen el historial de auditoría: agregarles
 * cascada borraría los `security_events` de la persona. No las toques.
 *
 * Las cuentas de esta suite sí son descartables y no deben dejar rastro en `App_dev`, así que
 * acá se borran a mano, en orden: primero `security_events` y `profiles` con la clave de
 * servicio (el `delete` no dispara el trigger de `app` que le bloquea el `update` a
 * `service_role`), después la cuenta de Auth. Solo para cuentas `e2e-auth-*` creadas por la
 * propia suite; nunca para usuarios reales.
 */
export async function deleteDisposableUser(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  await admin
    .from('security_events')
    .delete()
    .or(`actor_id.eq.${userId},target_id.eq.${userId}`)
  await admin.from('profiles').delete().eq('id', userId)
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    throw new Error(
      `No se pudo borrar la cuenta descartable ${userId}, aun después de borrar sus filas de ` +
        `security_events y profiles: ${error.message}`,
    )
  }
}
