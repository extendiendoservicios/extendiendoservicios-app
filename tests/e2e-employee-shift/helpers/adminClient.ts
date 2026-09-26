// tests/e2e-employee-shift/helpers/adminClient.ts — MOB-EMP-017/TEST-010 (P13.4)
//
// Cliente con la clave de servicio y fixtures de cliente/sede descartables, mismo patrón que
// `tests/e2e-checklists/helpers/adminClient.ts` y `tests/permissions/helpers/assignment-fixtures.ts`
// (copia deliberada, no un import cruzado: esta suite queda autocontenida). Prefijo propio
// `E2E-P134` para identificar de un vistazo qué suite dejó cada fila si algo quedara a medio
// limpiar (regla común 7, "Independencia").

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eEmployeeShiftEnv } from './env.ts'

export type AdminClient = SupabaseClient<Database>

let cached: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (cached) return cached
  const env = readE2eEmployeeShiftEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

export const E2E_NAME_PREFIX = 'E2E-P134'

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
 * Limpieza sin borrado físico (`04_Modelo_de_Datos.md` sección 0, "Baja lógica"; mismo criterio
 * que el resto de suites de backend real): sede inactiva y cliente cerrado. Los turnos,
 * `shift_tasks` y `attendance_records` de fixture (fechados hoy) no se tocan: no hay ninguna
 * acción del dominio que los borre y, con el cliente cerrado, no aportan nada a la operación real
 * a partir de mañana.
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
