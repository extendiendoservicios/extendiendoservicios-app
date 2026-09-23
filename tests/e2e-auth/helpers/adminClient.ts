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
 * DEFECTO encontrado en P06.4 (reportado en el encargo, no corregido acá: es de
 * `backend-supabase`, migraciones fuera de mi alcance): `auth.admin.deleteUser()` de la Admin
 * API falla SIEMPRE con "Database error deleting user" (500) para cualquier cuenta que tenga
 * fila en `public.profiles` — es decir, para cualquier cuenta real, porque el trigger
 * `app.handle_new_user()` (`0003_profiles_roles_capabilities.sql`) le crea una a TODAS. La causa:
 * `profiles.id references auth.users (id)` (misma migración, sin `on delete cascade`) — Postgres
 * rechaza el `delete` de `auth.users` con la restricción por omisión (`NO ACTION`). Si la cuenta
 * además inició sesión alguna vez, `security_events.actor_id`/`target_id` (sin `on delete
 * cascade` tampoco, `0004_company_holidays_security_events.sql`) agrega el mismo bloqueo sobre
 * `profiles`, así que ni siquiera alcanza con borrar el perfil primero.
 *
 * Acá abajo, `getAdminClient()` SÍ puede borrar filas de `profiles`/`security_events`
 * directamente (a diferencia de `update`, que el pendiente de `12_Registro_de_Progreso.md`
 * documenta como bloqueado para `service_role` por el mismo motivo de siempre — un trigger que
 * vive en el esquema `app`, cerrado; `delete` no dispara ese trigger): se borran esas dos filas
 * ANTES de pedirle a la Admin API que borre la cuenta de Auth, así esta suite deja `App_dev`
 * limpia de verdad. No es una corrección del defecto (eso es de `backend-supabase`, agregando
 * `on delete cascade` en las dos referencias) — es un rodeo, documentado como tal.
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
      `No se pudo borrar la cuenta descartable ${userId} ni con el rodeo del defecto ` +
        `documentado (profiles/security_events sin "on delete cascade"): ${error.message}`,
    )
  }
}
