// tests/e2e-employees/helpers/adminEmployeesClient.ts — EMP-014/TEST-006 (P09.5)
//
// Utilidades comunes a los specs de esta suite: un cliente con la clave de servicio, nombres
// descartables reconocibles y la limpieza final de cada persona que un spec crea, sin pasar por
// la interfaz (para no gastar el límite de 10 acciones por minuto del dueño ni depender de un
// botón de "dar de baja" real en la limpieza de specs que no están probando esa acción en sí).
// Mismo patrón que `tests/e2e-users/helpers/adminUsersClient.ts`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readE2eEmployeesEnv } from './env.ts'

let cachedAdmin: SupabaseClient | null = null

/** Cliente con la clave de servicio, para resolver ids y limpiar personas descartables. */
export function getAdminClient(): SupabaseClient {
  if (cachedAdmin) return cachedAdmin
  const env = readE2eEmployeesEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cachedAdmin = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cachedAdmin
}

/**
 * Prefijo reconocible (regla común 7, "Independencia"): todo lo que esta suite crea en
 * `App_dev` lo lleva en el apellido o el email, distinto del de `tests/e2e-auth/`
 * (`e2e-auth-`), `tests/e2e-users/` (`e2e-p074-`), `tests/e2e-clients-sites/` (`E2E-P085`) y
 * `tests/permissions/`, para identificar de un vistazo qué suite dejó cada fila si algo quedara
 * a medio limpiar.
 */
export const E2E_NAME_PREFIX = 'E2E P095'

/** Apellido único por corrida (evita choques de nombre entre corridas, mismo motivo que
 * `tests/e2e-users/helpers/adminUsersClient.ts`: `fetchEmployees` también lista a los dados de
 * baja, así que una corrida anterior que dejó a alguien desactivado sigue apareciendo). */
export function disposableLastName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

/** Email descartable único por corrida, en un dominio que no es el de la empresa real. */
export function disposableEmail(slug: string): string {
  return `e2e-p095-${slug}-${Date.now()}@example.com`
}

/**
 * DNI único por corrida (la base solo exige "solo números", sin largo fijo ni dígito
 * verificador, `employees_dni_format_check`): milisegundos de `Date.now()` más un dígito al azar,
 * para no chocar ni con el seed ni con otra alta de la misma corrida hecha en el mismo
 * milisegundo.
 */
export function disposableDni(): string {
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `${Date.now()}${randomDigit}`
}

/**
 * Da de baja a una persona descartable SIN pasar por la interfaz (`terminateEmployee` de
 * `src/api/employees.ts`): banea el login con la Admin API directo (igual que `deactivate_user`)
 * y marca `employees.status = terminated`, para dejar la fila consistente con lo que hace la
 * acción real, aunque el spec no la haya probado. No hay borrado físico (`04_Modelo_de_Datos.md`
 * sección 0, "Baja lógica").
 */
export async function terminateEmployeeDirectly(
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
  const { error: employeeError } = await admin
    .from('employees')
    .update({
      status: 'terminated',
      terminated_at: new Date().toISOString().slice(0, 10),
    })
    .eq('profile_id', profileId)
  if (employeeError) {
    throw new Error(
      `No se pudo marcar employees.status=terminated a ${profileId} en la limpieza: ${employeeError.message}`,
    )
  }
}

/**
 * Busca el `id` (profileId) de una cuenta recién creada por email, con la Admin API (no existe
 * `getUserByEmail` en el SDK v2). La lista de usuarios de `App_dev` es chica (seed + descartables
 * de las suites de backend real), así que filtrar acá es liviano.
 */
export async function findProfileIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  if (error) throw error
  return data.users.find((u) => u.email === email)?.id ?? null
}
