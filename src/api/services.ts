import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/services.ts` (SERVICE-001, mismo patrón que `src/api/clients.ts`
 * y `src/api/sites.ts` — ver `src/api/README.md`): servicios recurrentes de
 * ADM-25 y las listas de servicios de ADM-21 y ADM-22 (`06_API.md` sección
 * 6).
 *
 * Igual que `clients.ts`/`sites.ts`: sin RPC propia (`06` sección 6 dice
 * "insert/update" y "update `status`", todo directo por PostgREST,
 * protegido por `services_write_admin`, `0012_rls_policies.sql`). Dos
 * consecuencias, mismo criterio:
 *
 * 1. `mapWriteError` traduce a mano los checks que documenta
 *    `04_Modelo_de_Datos.md` sección 2.3 (`services_weekdays_check`,
 *    `services_time_range_check`, `services_required_staff_check`,
 *    `0007_services_shifts_assignments.sql`) a los códigos de `06` sección 6
 *    ("Errores: INVALID_WEEKDAYS, INVALID_TIME_RANGE...") y sección 15
 *    (`INVALID_TIME_RANGE` sí está en esa tabla; `INVALID_WEEKDAYS` no,
 *    aunque `06` sección 6 lo nombra — contradicción menor entre ambas
 *    secciones, reportada al orquestador; se eligió un mensaje en español
 *    acorde al check). El resto de los `23514`/`23505` caen en los
 *    genéricos de `fromPostgrestError`.
 * 2. `created_by`/`updated_by` no los completa un trigger
 *    (`0007_services_shifts_assignments.sql` solo dispara
 *    `app.set_updated_at`): cada función que escribe acá recibe el
 *    `profileId` de quien está logueado como parámetro.
 *
 * A diferencia de `clients.ts`/`sites.ts`, no hay una validación de
 * servidor que rechace un cliente o una sede no activos al crear o editar
 * un servicio (`CLIENT_NOT_ACTIVE`/`SITE_NOT_ACTIVE` solo los devuelven
 * `generate_shifts` y `create_shift`, ver el comentario de
 * `0005_clients_sites.sql` — ambas RPC son de P10.1/P10.3, fuera de este
 * paquete): un administrador puede cargar un servicio para un cliente
 * suspendido o una sede inactiva, aunque no se le vayan a generar turnos
 * mientras siga así.
 */

export type ServiceStatus = Database['public']['Enums']['service_status']

/** Las tres etiquetas de `04_Modelo_de_Datos.md` sección 3. */
export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  active: 'Activo',
  paused: 'Pausado',
  ended: 'Finalizado',
}

// -------------------------------------------------------------------------
// Errores de escritura directa a tabla (sin RPC, ver comentario de arriba)
// -------------------------------------------------------------------------

function mapWriteError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.code === '23514') {
    if (error.message.includes('services_weekdays_check')) {
      return new ApiError(
        'Elegí al menos un día de la semana.',
        'INVALID_WEEKDAYS',
      )
    }
    if (error.message.includes('services_time_range_check')) {
      return new ApiError(
        'La hora de fin tiene que ser posterior a la de inicio.',
        'INVALID_TIME_RANGE',
      )
    }
    if (error.message.includes('services_required_staff_check')) {
      return new ApiError(
        'La dotación tiene que ser de 1 a 10 personas.',
        'VALIDATION_ERROR',
      )
    }
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Listas de ADM-21 (pestaña Servicios) y ADM-22 (sección Servicios)
// -------------------------------------------------------------------------

/** Una fila de la lista de servicios de un cliente o de una sede. */
export interface ServiceSummary {
  id: string
  clientId: string
  siteId: string
  siteName: string
  name: string
  weekdays: number[]
  startTime: string
  endTime: string
  requiredStaff: number
  validFrom: string
  validTo: string | null
  status: ServiceStatus
}

interface ServiceSummaryRow {
  id: string
  client_id: string
  site_id: string
  name: string
  weekdays: number[]
  start_time: string
  end_time: string
  required_staff: number
  valid_from: string
  valid_to: string | null
  status: ServiceStatus
  sites: { name: string } | null
}

function mapServiceSummaryRow(row: ServiceSummaryRow): ServiceSummary {
  return {
    id: row.id,
    clientId: row.client_id,
    siteId: row.site_id,
    siteName: row.sites?.name ?? '',
    name: row.name,
    weekdays: row.weekdays,
    startTime: row.start_time,
    endTime: row.end_time,
    requiredStaff: row.required_staff,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    status: row.status,
  }
}

const SERVICE_SUMMARY_SELECT =
  'id, client_id, site_id, name, weekdays, start_time, end_time, required_staff, valid_from, valid_to, status, sites(name)'

/** Pestaña "Servicios" de ADM-21 (`06` sección 6: "Listar por cliente o sede"). */
export async function fetchServicesByClient(
  clientId: string,
): Promise<ServiceSummary[]> {
  const { data, error } = await supabase
    .from('services')
    .select(SERVICE_SUMMARY_SELECT)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapServiceSummaryRow)
}

/** Sección "Servicios" de ADM-22 (`06` sección 6: "Listar por cliente o sede"). */
export async function fetchServicesBySite(
  siteId: string,
): Promise<ServiceSummary[]> {
  const { data, error } = await supabase
    .from('services')
    .select(SERVICE_SUMMARY_SELECT)
    .eq('site_id', siteId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapServiceSummaryRow)
}

// -------------------------------------------------------------------------
// 2. Detalle y formulario (ADM-25)
// -------------------------------------------------------------------------

export interface ServiceDetail {
  id: string
  clientId: string
  /** Nombre del cliente dueño del servicio, para la cabecera de ADM-25 (no viene de `services`). */
  clientName: string
  siteId: string
  /** Nombre de la sede del servicio, para la cabecera de ADM-25 (no viene de `services`). */
  siteName: string
  name: string
  weekdays: number[]
  startTime: string
  endTime: string
  requiredStaff: number
  validFrom: string
  validTo: string | null
  worksOnHolidays: boolean
  minHoursMonth: number | null
  maxHoursMonth: number | null
  status: ServiceStatus
  notes: string | null
  createdAt: string
  updatedAt: string | null
}

interface ServiceRowWithNames {
  id: string
  client_id: string
  site_id: string
  name: string
  weekdays: number[]
  start_time: string
  end_time: string
  required_staff: number
  valid_from: string
  valid_to: string | null
  works_on_holidays: boolean
  min_hours_month: number | null
  max_hours_month: number | null
  status: ServiceStatus
  notes: string | null
  created_at: string
  updated_at: string | null
  clients: { legal_name: string; trade_name: string | null } | null
  sites: { name: string } | null
}

function mapServiceDetailRow(row: ServiceRowWithNames): ServiceDetail {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.clients?.trade_name ?? row.clients?.legal_name ?? '',
    siteId: row.site_id,
    siteName: row.sites?.name ?? '',
    name: row.name,
    weekdays: row.weekdays,
    startTime: row.start_time,
    endTime: row.end_time,
    requiredStaff: row.required_staff,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    worksOnHolidays: row.works_on_holidays,
    minHoursMonth: row.min_hours_month,
    maxHoursMonth: row.max_hours_month,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const SERVICE_DETAIL_SELECT = '*, clients(legal_name, trade_name), sites(name)'

/** Formulario de edición de ADM-25. */
export async function fetchServiceDetail(id: string): Promise<ServiceDetail> {
  const { data, error } = await supabase
    .from('services')
    .select(SERVICE_DETAIL_SELECT)
    .eq('id', id)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapServiceDetailRow(data)
}

export interface ServiceFormInput {
  clientId: string
  siteId: string
  name: string
  weekdays: number[]
  startTime: string
  endTime: string
  requiredStaff: number
  validFrom: string
  validTo: string | null
  worksOnHolidays: boolean
  minHoursMonth: number | null
  maxHoursMonth: number | null
  status: ServiceStatus
  notes: string | null
}

/** Alta de ADM-25 (`06` sección 6: "Crear, editar | insert/update"). */
export async function createService(
  input: ServiceFormInput,
  createdBy: string,
): Promise<ServiceDetail> {
  const { data, error } = await supabase
    .from('services')
    .insert({
      client_id: input.clientId,
      site_id: input.siteId,
      name: input.name,
      weekdays: input.weekdays,
      start_time: input.startTime,
      end_time: input.endTime,
      required_staff: input.requiredStaff,
      valid_from: input.validFrom,
      valid_to: input.validTo,
      works_on_holidays: input.worksOnHolidays,
      min_hours_month: input.minHoursMonth,
      max_hours_month: input.maxHoursMonth,
      status: input.status,
      notes: input.notes,
      created_by: createdBy,
    })
    .select(SERVICE_DETAIL_SELECT)
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapServiceDetailRow(data)
}

/**
 * Edición de ADM-25. `06` sección 6: "Editar un servicio no modifica turnos
 * ya generados; el administrador vuelve a generar el mes si corresponde
 * (solo crea faltantes)" — la generación en sí es de `generate_shifts`
 * (P10.1/P10.3), esta función solo actualiza `services`.
 */
export async function updateService(
  id: string,
  input: ServiceFormInput,
  updatedBy: string,
): Promise<ServiceDetail> {
  const { data, error } = await supabase
    .from('services')
    .update({
      client_id: input.clientId,
      site_id: input.siteId,
      name: input.name,
      weekdays: input.weekdays,
      start_time: input.startTime,
      end_time: input.endTime,
      required_staff: input.requiredStaff,
      valid_from: input.validFrom,
      valid_to: input.validTo,
      works_on_holidays: input.worksOnHolidays,
      min_hours_month: input.minHoursMonth,
      max_hours_month: input.maxHoursMonth,
      status: input.status,
      notes: input.notes,
      updated_by: updatedBy,
    })
    .eq('id', id)
    .select(SERVICE_DETAIL_SELECT)
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapServiceDetailRow(data)
}

/**
 * SERVICE-004: pausar, reactivar o finalizar desde la lista de servicios de
 * ADM-21/ADM-22 (`06` sección 6: "Pausar, finalizar | update `status`").
 * Aparte de `updateService` porque esta acción no pasa por el formulario
 * completo: solo toca `status`.
 */
export async function setServiceStatus(
  id: string,
  status: ServiceStatus,
  updatedBy: string,
): Promise<ServiceDetail> {
  const { data, error } = await supabase
    .from('services')
    .update({ status, updated_by: updatedBy })
    .eq('id', id)
    .select(SERVICE_DETAIL_SELECT)
    .single()

  if (error) {
    throw mapWriteError(error)
  }
  return mapServiceDetailRow(data)
}
