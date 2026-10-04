// tests/e2e-avisos-asistencia/helpers/adminClient.ts — ABS-007/ATT-015/TEST-011 (P14.4)
//
// Cliente con la clave de servicio y fixtures de cliente/sede descartables, mismo patrón que
// `tests/e2e-employee-shift/helpers/adminClient.ts` (copia deliberada, no un import cruzado:
// esta suite queda autocontenida). Prefijo propio `E2E-P144` para identificar de un vistazo qué
// suite dejó cada fila si algo quedara a medio limpiar.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eAvisosAsistenciaEnv } from './env.ts'
import { SEED_ACCOUNTS } from '../../fixtures/seed-accounts.ts'

export type AdminClient = SupabaseClient<Database>

let cached: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (cached) return cached
  const env = readE2eAvisosAsistenciaEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

export const E2E_NAME_PREFIX = 'E2E-P144'

export function disposableName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

export function disposableCuit(): string {
  const timestampDigits = Date.now().toString().slice(-8)
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `20${timestampDigits}${randomDigit}`
}

export interface DisposableClient {
  id: string
  legalName: string
}

export async function createDisposableClient(
  admin: AdminClient,
  nameSlug: string,
): Promise<DisposableClient> {
  const legalName = disposableName(nameSlug)
  const { data, error } = await admin
    .from('clients')
    .insert({ legal_name: legalName, cuit: disposableCuit(), status: 'active' })
    .select('id, legal_name')
    .single()
  if (error) {
    throw new Error(`No se pudo crear el cliente de fixture: ${error.message}`)
  }
  return { id: data.id, legalName: data.legal_name }
}

export interface DisposableSite {
  id: string
  name: string
}

export async function createDisposableSite(
  admin: AdminClient,
  clientId: string,
  nameSlug: string,
): Promise<DisposableSite> {
  const name = disposableName(nameSlug)
  const { data, error } = await admin
    .from('sites')
    .insert({
      client_id: clientId,
      name,
      address: 'Dirección de prueba, sin importancia',
      status: 'active',
    })
    .select('id, name')
    .single()
  if (error) {
    throw new Error(`No se pudo crear la sede de fixture: ${error.message}`)
  }
  return { id: data.id, name: data.name }
}

/**
 * Nombre y apellido del dueño del seed, para verificar en pantalla "lo cargó Nombre Apellido"
 * (`AssignmentAttendanceDetail`/`whoRecorded`) sin hardcodear un nombre que el seed podría
 * cambiar. Inicia sesión con la contraseña (no `admin.auth.admin.listUsers`: con años de suites
 * de backend real dejando cuentas descartables baneadas, ya sin borrado físico, el proyecto
 * acumula cientos de usuarios y una sola página de `listUsers` puede no alcanzar para encontrar
 * la cuenta del seed) -- mismo patrón que `assignEmployeeToShift`.
 */
export async function resolveOwnerName(
  admin: AdminClient,
  seedPassword: string,
): Promise<{ id: string; firstName: string; lastName: string }> {
  const env = readE2eAvisosAsistenciaEnv()
  if (!env) {
    throw new Error('resolveOwnerName() llamado sin .env.local completo.')
  }
  const owner = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: signInData, error: signInError } =
    await owner.auth.signInWithPassword({
      email: SEED_ACCOUNTS.owner,
      password: seedPassword,
    })
  if (signInError || !signInData.user) {
    throw new Error(
      `No se pudo iniciar sesión como el dueño del seed: ${signInError?.message ?? 'sin usuario'}`,
    )
  }
  const ownerId = signInData.user.id
  await owner.auth.signOut()

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', ownerId)
    .single()
  if (profileError || !profile) {
    throw new Error(
      `No se pudo leer el perfil del dueño: ${profileError?.message ?? 'sin fila'}`,
    )
  }
  return {
    id: ownerId,
    firstName: profile.first_name,
    lastName: profile.last_name,
  }
}

/**
 * Limpieza sin borrado físico (`04_Modelo_de_Datos.md` sección 0, "Baja lógica"; mismo criterio
 * que el resto de suites de backend real): sede inactiva y cliente cerrado. Los turnos,
 * `shift_tasks`, `attendance_records` y `attendance_notices` de fixture (fechados hoy) no se
 * tocan: no hay ninguna acción del dominio que los borre y, con el cliente cerrado, no aportan
 * nada a la operación real a partir de mañana.
 */
export async function cleanupDisposableClient(
  admin: AdminClient,
  clientId: string,
): Promise<void> {
  const now = new Date().toISOString()
  await admin
    .from('sites')
    .update({ status: 'inactive', deleted_at: now })
    .eq('client_id', clientId)
  await admin
    .from('clients')
    .update({ status: 'closed', deleted_at: now })
    .eq('id', clientId)
}
