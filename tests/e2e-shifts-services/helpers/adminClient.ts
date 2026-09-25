// tests/e2e-shifts-services/helpers/adminClient.ts — SERVICE-007/SHIFT-012/TEST-007 (P10.4)
//
// Cliente `supabase-js` con la clave de servicio: precondiciones (cliente, sede, servicio,
// feriado del mes lejano reservado — ver `farDate.ts`) y limpieza. A diferencia de
// `tests/e2e-clients-sites/helpers/adminClient.ts` (que borra físicamente lo que crea), acá NO
// se borra nada de forma física (encargo P10.4: "Nada se borra físicamente (P-014, P-105): la
// limpieza es baja lógica o pausar y finalizar los servicios del fixture") — la limpieza deja
// `deleted_at` puesto y el estado en la baja correspondiente (`closed`/`inactive`/`ended`).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readE2eShiftsServicesEnv } from './env.ts'
import { FAR_HOLIDAY_DATE } from './farDate.ts'

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (cached) return cached
  const env = readE2eShiftsServicesEnv()
  if (!env) {
    throw new Error('getAdminClient() llamado sin .env.local completo.')
  }
  cached = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return cached
}

/**
 * Prefijo reconocible (regla común 7, "Independencia"): todo lo que esta suite crea en
 * `App_dev` lo lleva en la razón social del cliente, el nombre de la sede o el nombre del
 * servicio. Distinto del de las demás suites de backend real, para identificar de un vistazo
 * qué suite dejó cada fila si algo quedara a medio limpiar.
 */
export const E2E_NAME_PREFIX = 'E2E-P104'

export function disposableName(slug: string): string {
  return `${E2E_NAME_PREFIX} ${slug} ${Date.now()}`
}

export function disposableCuit(): string {
  const timestampDigits = Date.now().toString().slice(-8)
  const randomDigit = Math.floor(Math.random() * 10).toString()
  return `20${timestampDigits}${randomDigit}`
}

/** Cliente activo de precondición (mismo criterio que `e2e-clients-sites`, `created_by: null`). */
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

/** Sede activa de precondición para un cliente ya existente. */
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

export interface DisposableServiceOverrides {
  weekdays: number[]
  worksOnHolidays?: boolean
  status?: 'active' | 'paused' | 'ended'
  requiredStaff?: number
  startTime?: string
  endTime?: string
}

/**
 * Servicio de precondición con vigencia SOLO en el mes lejano reservado (`farDate.ts`), creado
 * directo por API (no por la interfaz: eso es justamente lo que prueban los specs de alta —
 * esta función arma el escenario de la generación, un paso previo distinto).
 */
export async function createDisposableService(
  admin: SupabaseClient,
  clientId: string,
  siteId: string,
  nameSlug: string,
  overrides: DisposableServiceOverrides,
): Promise<{ id: string; name: string }> {
  const name = disposableName(nameSlug)
  const { data, error } = await admin
    .from('services')
    .insert({
      client_id: clientId,
      site_id: siteId,
      name,
      weekdays: overrides.weekdays,
      start_time: overrides.startTime ?? '08:00',
      end_time: overrides.endTime ?? '12:00',
      required_staff: overrides.requiredStaff ?? 1,
      valid_from: '2190-06-01',
      valid_to: '2190-06-30',
      works_on_holidays: overrides.worksOnHolidays ?? true,
      status: overrides.status ?? 'active',
    })
    .select('id, name')
    .single()
  if (error) {
    throw new Error(
      `No se pudo crear el servicio de precondición: ${error.message}`,
    )
  }
  return { id: data.id as string, name: data.name as string }
}

/**
 * Turno puntual de fixture, insertado directo (sin pasar por `create_shift`): sirve para los
 * specs que solo necesitan UN turno ya existente para mirarlo (por ejemplo, los casos de
 * permisos por capacidad) y no están probando la generación en sí. `service_id: null` (turno
 * puntual, `04_Modelo_de_Datos.md` sección 2.3, P-045).
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

/**
 * Feriado del mes lejano reservado, reutilizado entre corridas (`holidays.holiday_date` es
 * única en toda la tabla, también para las bajas lógicas — encargo P10.4): si ya existe (activo
 * o dado de baja), lo reactiva en vez de intentar un segundo insert que chocaría con la
 * restricción `unique`.
 */
export async function ensureFarHoliday(admin: SupabaseClient): Promise<string> {
  const { data: existing, error: selectError } = await admin
    .from('holidays')
    .select('id, deleted_at')
    .eq('holiday_date', FAR_HOLIDAY_DATE)
    .maybeSingle()
  if (selectError) {
    throw new Error(
      `No se pudo leer el feriado de fixture: ${selectError.message}`,
    )
  }
  if (existing) {
    if (existing.deleted_at) {
      const { error: reactivateError } = await admin
        .from('holidays')
        .update({ deleted_at: null, name: 'E2E-P104 feriado de fixture' })
        .eq('id', existing.id)
      if (reactivateError) {
        throw new Error(
          `No se pudo reactivar el feriado de fixture: ${reactivateError.message}`,
        )
      }
    }
    return existing.id as string
  }
  const { data, error } = await admin
    .from('holidays')
    .insert({
      holiday_date: FAR_HOLIDAY_DATE,
      name: 'E2E-P104 feriado de fixture',
    })
    .select('id')
    .single()
  if (error) {
    throw new Error(`No se pudo crear el feriado de fixture: ${error.message}`)
  }
  return data.id as string
}

/**
 * Limpieza sin borrado físico (encargo P10.4): pausa y finaliza los servicios, marca la sede
 * inactiva y el cliente cerrado, todos con `deleted_at`. Los turnos generados (todos fechados en
 * 2190) quedan tal cual: no hay ninguna acción del dominio que los borre, y no molestan a nada
 * real por estar tan lejos en el tiempo.
 */
export async function cleanupDisposableClient(
  admin: SupabaseClient,
  clientId: string,
  serviceIds: string[],
): Promise<void> {
  const now = new Date().toISOString()
  for (const serviceId of serviceIds) {
    const { error } = await admin
      .from('services')
      .update({ status: 'ended', deleted_at: now })
      .eq('id', serviceId)
    if (error) {
      throw new Error(
        `No se pudo finalizar el servicio de fixture ${serviceId} en la limpieza: ${error.message}`,
      )
    }
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
