// tests/e2e-supervisiones/helpers/adminClient.ts — SUP-013/MOB-SUP-013/TEST-013 (P15.6)
//
// Cliente con la clave de servicio y fixtures de cliente/sede descartables, mismo patrón que
// `tests/e2e-employee-shift/helpers/adminClient.ts` y `tests/e2e-avisos-asistencia/helpers/adminClient.ts`
// (copia deliberada, no un import cruzado: esta suite queda autocontenida). Prefijo propio
// `E2E-P156` para identificar de un vistazo qué suite dejó cada fila si algo quedara a medio
// limpiar (regla común 7, "Independencia").

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eSupervisionesEnv } from './env.ts'

export type AdminClient = SupabaseClient<Database>

let cached: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (cached) return cached
  const env = readE2eSupervisionesEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

export const E2E_NAME_PREFIX = 'E2E-P156'

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
 * `shift_tasks`, `supervisions` y `ratings` de fixture no se tocan acá (cada spec los deja en un
 * estado terminal -- completada, no realizada o cancelada -- antes de llegar a esta limpieza): no
 * hay ninguna acción del dominio que los borre y, con el cliente cerrado, no aportan nada a la
 * operación real a partir de mañana.
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
