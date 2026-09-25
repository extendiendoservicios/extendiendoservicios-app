// tests/e2e-assignments/helpers/adminClient.ts — ASSIGN-015/ASSIGN-016 (P11.4)
//
// Cliente `supabase-js` con la clave de servicio: precondiciones (cliente, sede, turnos
// puntuales) y limpieza SIN borrado físico (`04_Modelo_de_Datos.md` sección 0, "Baja lógica";
// mismo criterio que `tests/e2e-shifts-services/helpers/adminClient.ts`): pausa/cierra cliente y
// sede al terminar, nunca borra ninguna fila.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../../src/lib/database.types.ts'
import { readE2eAssignmentsEnv } from './env.ts'
import { SEED_ACCOUNTS } from '../../permissions/fixtures/seed-accounts.ts'

// Tipado con `Database` (no genérico a secas): permite pasar este cliente directo a
// `resolveUserId` (`tests/permissions/helpers/admin-lookups.ts`), que algunos specs de esta
// suite reutilizan para resolver ids de empleados del seed por email.
let cached: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (cached) return cached
  const env = readE2eAssignmentsEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient<Database>(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

/**
 * Prefijo reconocible (regla común 7, "Independencia"): todo lo que esta suite crea en
 * `App_dev` lo lleva en la razón social del cliente o el nombre de la sede. Distinto del de las
 * demás suites de backend real, para identificar de un vistazo qué suite dejó cada fila si algo
 * quedara a medio limpiar.
 */
export const E2E_NAME_PREFIX = 'E2E-P114'

export function disposableName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

export function disposableCuit(): string {
  const timestampDigits = Date.now().toString().slice(-8)
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `20${timestampDigits}${randomDigit}`
}

export async function createDisposableClient(
  admin: SupabaseClient,
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
  return { id: data.id as string, legalName: data.legal_name as string }
}

export async function createDisposableSite(
  admin: SupabaseClient,
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
  return { id: data.id as string, name: data.name as string }
}

/**
 * Turno puntual insertado directo (sin `create_shift`, más rápido para armar precondiciones que
 * no están probando el alta en sí): `service_id: null` (turno puntual,
 * `04_Modelo_de_Datos.md` sección 2.3, P-045).
 */
export async function createDisposableShift(
  admin: SupabaseClient,
  clientId: string,
  siteId: string,
  shiftDate: string,
  overrides: Partial<{
    startTime: string
    endTime: string
    requiredStaff: number
    notes: string
  }> = {},
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from('shifts')
    .insert({
      client_id: clientId,
      site_id: siteId,
      shift_date: shiftDate,
      start_time: overrides.startTime ?? '08:00',
      end_time: overrides.endTime ?? '12:00',
      required_staff: overrides.requiredStaff ?? 1,
      notes: overrides.notes ?? null,
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(
      `No se pudo crear el turno de precondición: ${error.message}`,
    )
  }
  return { id: data.id as string }
}

let cachedOwnerClient: SupabaseClient<Database> | null = null

/**
 * Cliente logueado como el dueño (anon key + `SEED_DEV_PASSWORD`), cacheado: hace falta para
 * liberar las asignaciones de fixture en la limpieza (`releaseShiftAssignments`).
 * `service_role` NO puede insertar ni tocar `assignments` directo -- el trigger
 * `app.sync_assignment_window` no es `security definer` y ese rol no tiene `grant usage on
 * schema app` (`0003_profiles_roles_capabilities.sql`, solo `authenticated` y
 * `supabase_auth_admin`); mismo hallazgo documentado en `tests/permissions/helpers/assignment-fixtures.ts`.
 */
export async function getOwnerActorClient(): Promise<SupabaseClient<Database>> {
  if (cachedOwnerClient) return cachedOwnerClient
  const env = readE2eAssignmentsEnv()
  if (!env) {
    throw new Error('getOwnerActorClient() llamado sin .env.local completo.')
  }
  const client = createClient<Database>(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({
    email: SEED_ACCOUNTS.owner,
    password: env.seedPassword,
  })
  if (error) {
    throw new Error(
      `No se pudo iniciar sesión como el dueño para la limpieza: ${error.message}`,
    )
  }
  cachedOwnerClient = client
  return client
}

/**
 * Libera (con motivo) todas las asignaciones vigentes de un turno, ANTES de dar de baja el
 * cliente/sede en la limpieza: sin esto, la exclusión de superposición
 * (`assignments_no_overlap`, P-053) sigue activa entre corridas de la suite en la misma fecha y
 * franja -- la corrida siguiente choca con `ASSIGNMENT_OVERLAP` contra la asignación que dejó la
 * corrida anterior (mismo hallazgo que `tests/permissions/helpers/assignment-fixtures.ts`
 * documenta para su propio caso). Usa `getOwnerActorClient()` porque `service_role` no puede.
 */
export async function releaseShiftAssignments(
  admin: SupabaseClient<Database>,
  shiftId: string,
): Promise<void> {
  const { data: assignments } = await admin
    .from('assignments')
    .select('id')
    .eq('shift_id', shiftId)
    .is('removed_at', null)
  if (!assignments || assignments.length === 0) return

  const owner = await getOwnerActorClient()
  for (const assignment of assignments) {
    await owner.rpc('remove_assignment', {
      p_assignment_id: assignment.id,
      p_reason: 'E2E-P114: limpieza de la asignación de fixture',
    })
  }
}

/**
 * Limpieza sin borrado físico: sede inactiva y cliente cerrado, ambos con `deleted_at`. Los
 * turnos NO se tocan salvo que se pida explícitamente (ver `markShiftCancelledDirectly`): al
 * quedar el cliente/sede de baja lógica, sirven igual para historial y no aportan nada a la
 * operación real (mismo criterio que `tests/e2e-shifts-services`).
 */
export async function cleanupDisposableClient(
  admin: SupabaseClient,
  clientId: string,
): Promise<void> {
  const now = new Date().toISOString()
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

/**
 * Marca un turno como cancelado directo con la clave de servicio (bypassa la RPC `cancel_shift`,
 * que exige motivo por interfaz/RLS): se usa SOLO en la limpieza de los turnos fixture fechados
 * "hoy" (el caso de permisos "turno ya empezado", que por definición no puede vivir en el mes
 * lejano) para que, aunque el cliente/sede queden de baja lógica y `v_shifts_board` no filtre por
 * eso (`0011_views.sql`, solo `shifts.deleted_at`), el turno de prueba no seguya viéndose como
 * "Programado" o "Asignado" en el tablero real de hoy -- reportado al orquestador como límite de
 * esta suite (ver el reporte del encargo).
 */
export async function markShiftCancelledDirectly(
  admin: SupabaseClient,
  shiftId: string,
): Promise<void> {
  const { error } = await admin
    .from('shifts')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancel_reason:
        'E2E-P114: limpieza del test de permisos (turno ya empezado)',
    })
    .eq('id', shiftId)
  if (error) {
    throw new Error(
      `No se pudo cancelar el turno de fixture en la limpieza: ${error.message}`,
    )
  }
}
