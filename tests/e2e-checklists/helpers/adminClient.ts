// tests/e2e-checklists/helpers/adminClient.ts — TASK-008 (P12.3)
//
// Cliente `supabase-js` con la clave de servicio: precondiciones (cliente, dos sedes) y
// verificación/limpieza SIN borrado físico (`04_Modelo_de_Datos.md` sección 0, "Baja lógica";
// mismo criterio que el resto de suites de backend real): pausa/cierra cliente y sedes, y da de
// baja lógica las plantillas de tareas que haya creado. Los turnos y `shift_tasks` de fixture NO
// se borran (mismo criterio que el mes lejano de `tests/e2e-shifts-services`/`tests/e2e-assignments`:
// al estar fechados en 2199, no molestan a nada real).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eChecklistsEnv } from './env.ts'

let cached: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (cached) return cached
  const env = readE2eChecklistsEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

/**
 * Prefijo reconocible (regla común 7, "Independencia"): todo lo que esta suite crea en `App_dev`
 * lo lleva en la razón social del cliente o el nombre de la sede. Paquete P12.3, distinto del de
 * las demás suites de backend real.
 */
export const E2E_NAME_PREFIX = 'E2E-P123'

export function disposableName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

export function disposableCuit(): string {
  const timestampDigits = Date.now().toString().slice(-8)
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `20${timestampDigits}${randomDigit}`
}

export async function createDisposableClient(
  admin: SupabaseClient<Database>,
  nameSlug: string,
): Promise<{ id: string; legalName: string }> {
  const legalName = disposableName(nameSlug)
  const { data, error } = await admin
    .from('clients')
    .insert({ legal_name: legalName, cuit: disposableCuit(), status: 'active' })
    .select('id, legal_name')
    .single()
  if (error) {
    throw new Error(
      `No se pudo crear el cliente de precondición: ${error.message}`,
    )
  }
  return { id: data.id, legalName: data.legal_name }
}

export async function createDisposableSite(
  admin: SupabaseClient<Database>,
  clientId: string,
  nameSlug: string,
): Promise<{ id: string; name: string }> {
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
    throw new Error(
      `No se pudo crear la sede de precondición: ${error.message}`,
    )
  }
  return { id: data.id, name: data.name }
}

export interface ShiftTaskRow {
  id: string
  position: number
  title: string
  isRequired: boolean
  status: string
  notDoneReason: string | null
}

/** Tareas de un turno, en orden, para comparar contra los ítems de una plantilla. */
export async function fetchShiftTasks(
  admin: SupabaseClient<Database>,
  shiftId: string,
): Promise<ShiftTaskRow[]> {
  const { data, error } = await admin
    .from('shift_tasks')
    .select('id, position, title, is_required, status, not_done_reason')
    .eq('shift_id', shiftId)
    .order('position', { ascending: true })
  if (error) {
    throw new Error(
      `No se pudieron leer las tareas del turno: ${error.message}`,
    )
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    position: row.position,
    title: row.title,
    isRequired: row.is_required,
    status: row.status,
    notDoneReason: row.not_done_reason,
  }))
}

/** Id del turno puntual creado por `create_shift` desde la interfaz, resuelto por sede+fecha. */
export async function findShiftId(
  admin: SupabaseClient<Database>,
  siteId: string,
  shiftDate: string,
): Promise<string> {
  const { data, error } = await admin
    .from('shifts')
    .select('id')
    .eq('site_id', siteId)
    .eq('shift_date', shiftDate)
    .single()
  if (error || !data) {
    throw new Error(
      `No se encontró el turno de fixture (sede ${siteId}, fecha ${shiftDate}): ${error?.message}`,
    )
  }
  return data.id
}

/**
 * Limpieza sin borrado físico: las plantillas de tareas del cliente (y de sus sedes) quedan de
 * baja lógica (`deleted_at`), igual que sus ítems; las sedes quedan inactivas y el cliente
 * cerrado. Los turnos y `shift_tasks` de fixture (año 2199) no se tocan: no hay ninguna acción del
 * dominio que los borre y, al estar tan lejos en el tiempo, no aportan nada a la operación real.
 */
export async function cleanupDisposableClient(
  admin: SupabaseClient<Database>,
  clientId: string,
): Promise<void> {
  const now = new Date().toISOString()

  const { data: templates } = await admin
    .from('checklist_templates')
    .select('id')
    .eq('client_id', clientId)
    .is('deleted_at', null)
  const templateIds = (templates ?? []).map((t) => t.id)

  if (templateIds.length > 0) {
    await admin
      .from('checklist_template_items')
      .update({ deleted_at: now })
      .in('template_id', templateIds)
      .is('deleted_at', null)
    await admin
      .from('checklist_templates')
      .update({ deleted_at: now, is_active: false })
      .in('id', templateIds)
  }

  const { error: sitesError } = await admin
    .from('sites')
    .update({ status: 'inactive', deleted_at: now })
    .eq('client_id', clientId)
  if (sitesError) {
    throw new Error(
      `No se pudieron dar de baja las sedes del cliente ${clientId} en la limpieza: ${sitesError.message}`,
    )
  }
  const { error: clientError } = await admin
    .from('clients')
    .update({ status: 'closed', deleted_at: now })
    .eq('id', clientId)
  if (clientError) {
    throw new Error(
      `No se pudo dar de baja el cliente ${clientId} en la limpieza: ${clientError.message}`,
    )
  }
}
