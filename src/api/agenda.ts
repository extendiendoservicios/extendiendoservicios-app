import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/agenda.ts` (P37.2): la pizarra mensual de la Agenda (migración
 * 0092, AG-01..AG-20). Solo dueños y administradores; los demás reciben
 * `FORBIDDEN`. La lectura es directa por PostgREST (RLS de solo lectura) y toda
 * la escritura va por RPC `security definer`.
 *
 * Códigos de error (`hint`): `FORBIDDEN`, `AGENDA_ITEM_NOT_FOUND`,
 * `INVALID_AGENDA_KIND`, `INVALID_COLOR`, `INVALID_BUDGET`, `INVALID_DATE`,
 * `INVALID_SLOT`, `EMPTY_AGENDA_ITEM`, `INVALID_AGENDA_TEXT` (más de 1000
 * caracteres), `CLIENT_NOT_FOUND` y `EMPLOYEE_NOT_FOUND`.
 */

export type AgendaKind = 'evento' | 'nuevo' | 'nota'

/** Índice 20 del relleno: el verde «resuelto» de la plataforma (AG-12). */
export const AGENDA_RESOLVED_FILL = 20

/** Tope del texto de una nota (AG-10, el servidor también lo exige). */
export const AGENDA_TEXT_MAX_LENGTH = 1000

type AgendaItemRow = Database['public']['Tables']['agenda_items']['Row']

export interface AgendaItem {
  id: string
  kind: AgendaKind
  /** Primer día del mes (`YYYY-MM-01`). */
  month: string
  /** Solo eventos: `YYYY-MM-DD`. */
  day: string | null
  /** Solo nuevos: columna 0–6. */
  slot: number | null
  position: number
  // evento
  workType: string | null
  timeText: string | null
  place: string | null
  clientPerson: string | null
  people: string | null
  // nuevo
  placeName: string | null
  clientName: string | null
  address: string | null
  daysHours: string | null
  budget: number | null
  // evento y nuevo
  observation: string | null
  // nota
  body: string | null
  resolved: boolean
  /** Borde: 0–19 o `null`. */
  borderColor: number | null
  /** Relleno: 0–19, 20 (verde resuelto) o `null`. */
  fillColor: number | null
  /** Relleno que tenía antes de marcarlo resuelto (la RPC lo guarda). */
  fillBeforeResolved: number | null
  /** Cliente creado desde el bloque (solo nuevos). */
  clientId: string | null
}

function mapAgendaItem(row: AgendaItemRow): AgendaItem {
  return {
    id: row.id,
    kind: row.kind as AgendaKind,
    month: row.month,
    day: row.day,
    slot: row.slot,
    position: row.position,
    workType: row.work_type,
    timeText: row.time_text,
    place: row.place,
    clientPerson: row.client_person,
    people: row.people,
    placeName: row.place_name,
    clientName: row.client_name,
    address: row.address,
    daysHours: row.days_hours,
    budget: row.budget == null ? null : Number(row.budget),
    observation: row.observation,
    body: row.body,
    resolved: row.resolved,
    borderColor: row.border_color,
    fillColor: row.fill_color,
    fillBeforeResolved: row.fill_before_resolved,
    clientId: row.client_id,
  }
}

/** Elementos de un mes (`YYYY-MM-01`), por día, columna y orden de carga. */
export async function fetchAgendaItems(month: string): Promise<AgendaItem[]> {
  const { data, error } = await supabase
    .from('agenda_items')
    .select('*')
    .eq('month', month)
    .order('day', { ascending: true, nullsFirst: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapAgendaItem)
}

export interface AgendaEmployeeColor {
  employeeId: string
  borderColor: number | null
  fillColor: number | null
  /** Renglón fijo de puesto o zona (AG-22), o `null`. */
  fixedLine: string | null
}

/** Color de borde y relleno de cada empleado (AG-16). */
export async function fetchAgendaEmployeeColors(): Promise<
  AgendaEmployeeColor[]
> {
  const { data, error } = await supabase
    .from('agenda_employee_colors')
    .select('employee_id, border_color, fill_color, fixed_line')
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    borderColor: row.border_color,
    fillColor: row.fill_color,
    fixedLine: row.fixed_line,
  }))
}

/** Textos de un elemento. La edición los REEMPLAZA a todos: mandá siempre el ítem completo. */
export interface AgendaFields {
  workType?: string | null
  timeText?: string | null
  place?: string | null
  clientPerson?: string | null
  people?: string | null
  observation?: string | null
  placeName?: string | null
  clientName?: string | null
  address?: string | null
  daysHours?: string | null
  /** Importe en pesos o `null`. */
  budget?: number | null
  body?: string | null
}

export interface SaveAgendaItemInput {
  /** `null` = alta; con id = edición (el tipo no cambia). */
  id: string | null
  kind: AgendaKind
  /** Primer día del mes (`YYYY-MM-01`); en eventos se deriva de `day`. */
  month: string
  /** Obligatorio en eventos. */
  day?: string | null
  /** Obligatorio en nuevos (0–6). */
  slot?: number | null
  /** `null` o ausente: al final (alta) o sin cambio (edición). */
  position?: number | null
  fields: AgendaFields
  borderColor: number | null
  fillColor: number | null
}

/** Pasa los textos al formato de `p_fields` del servidor (claves en `snake_case`). */
export function toServerFields(fields: AgendaFields): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const map: Array<[keyof AgendaFields, string]> = [
    ['workType', 'work_type'],
    ['timeText', 'time_text'],
    ['place', 'place'],
    ['clientPerson', 'client_person'],
    ['people', 'people'],
    ['observation', 'observation'],
    ['placeName', 'place_name'],
    ['clientName', 'client_name'],
    ['address', 'address'],
    ['daysHours', 'days_hours'],
    ['budget', 'budget'],
    ['body', 'body'],
  ]
  for (const [key, serverKey] of map) {
    const value = fields[key]
    if (value != null && value !== '') {
      result[serverKey] = value
    }
  }
  return result
}

// Los tipos generados piden número o texto aunque el servidor acepta `null`.
function orNull<T>(value: T | null | undefined): T {
  return (value ?? null) as T
}

/** Alta o cambio de un elemento (`save_agenda_item`). */
export async function saveAgendaItem(
  input: SaveAgendaItemInput,
): Promise<AgendaItem> {
  const { data, error } = await supabase.rpc('save_agenda_item', {
    p_id: orNull(input.id),
    p_kind: input.kind,
    p_month: input.month,
    p_day: orNull(input.day),
    p_slot: orNull(input.slot),
    p_position: orNull(input.position),
    p_fields: toServerFields(input.fields) as never,
    p_border_color: orNull(input.borderColor),
    p_fill_color: orNull(input.fillColor),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAgendaItem(data)
}

/** Borra el elemento de forma definitiva (AG-14). */
export async function deleteAgendaItem(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_agenda_item', { p_id: id })
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Tilda o destilda «Resuelto» (el servidor pone o devuelve el verde). */
export async function setAgendaItemResolved(
  id: string,
  resolved: boolean,
): Promise<AgendaItem> {
  const { data, error } = await supabase.rpc('set_agenda_item_resolved', {
    p_id: id,
    p_resolved: resolved,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAgendaItem(data)
}

/** Copia el elemento al mes siguiente, sin resolver (AG-13). */
export async function duplicateAgendaItemToNextMonth(
  id: string,
): Promise<AgendaItem> {
  const { data, error } = await supabase.rpc(
    'duplicate_agenda_item_to_next_month',
    { p_id: id },
  )
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAgendaItem(data)
}

/** Vincula un bloque de Nuevos con el cliente creado y lo marca resuelto (AG-09). */
export async function markAgendaItemClient(
  id: string,
  clientId: string,
): Promise<AgendaItem> {
  const { data, error } = await supabase.rpc('mark_agenda_item_client', {
    p_id: id,
    p_client_id: clientId,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAgendaItem(data)
}

/** Color de un empleado en la lista diaria; con los dos en `null` lo borra (AG-16). */
export async function setAgendaEmployeeColor(
  employeeId: string,
  border: number | null,
  fill: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_agenda_employee_color', {
    p_employee_id: employeeId,
    p_border: orNull(border),
    p_fill: orNull(fill),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Renglón fijo de una persona; vacío o `null` lo borra (AG-22). */
export async function setAgendaEmployeeFixedLine(
  employeeId: string,
  text: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_agenda_employee_fixed_line', {
    p_employee_id: employeeId,
    p_text: orNull(text),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

// -------------------------------------------------------------------------
// Lista diaria como el parte de WhatsApp (0093, AG-21 a AG-25)
// -------------------------------------------------------------------------

/** Renglón libre de una persona en un día (AG-23). */
export interface AgendaStaffLine {
  id: string
  employeeId: string
  /** `YYYY-MM-DD`. */
  day: string
  body: string
  position: number
}

/** Renglones libres de un día, por posición. */
export async function fetchAgendaStaffLines(
  day: string,
): Promise<AgendaStaffLine[]> {
  const { data, error } = await supabase
    .from('agenda_staff_lines')
    .select('id, employee_id, day, body, position')
    .eq('day', day)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    employeeId: row.employee_id,
    day: row.day,
    body: row.body,
    position: row.position,
  }))
}

export interface SaveAgendaStaffLineInput {
  /** `null` = alta. */
  id: string | null
  employeeId: string
  day: string
  body: string
  /** `null`: al final (alta) o sin cambio (edición). */
  position?: number | null
}

export async function saveAgendaStaffLine(
  input: SaveAgendaStaffLineInput,
): Promise<AgendaStaffLine> {
  const { data, error } = await supabase.rpc('save_agenda_staff_line', {
    p_id: orNull(input.id),
    p_employee_id: input.employeeId,
    p_day: input.day,
    p_body: input.body,
    p_position: orNull(input.position),
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return {
    id: data.id,
    employeeId: data.employee_id,
    day: data.day,
    body: data.body,
    position: data.position,
  }
}

export async function deleteAgendaStaffLine(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_agenda_staff_line', {
    p_id: id,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
}

/** Una persona del personal activo (empleados, coordinadores, administración y dirección con ficha). */
export interface AgendaStaffMember {
  profileId: string
  employeeNumber: number
  firstName: string
  lastName: string
  isCoordinator: boolean
}

/** Personal activo por legajo (AG-21): sin bajas y sin legajos vacantes. */
export async function fetchAgendaStaff(): Promise<AgendaStaffMember[]> {
  const { data, error } = await supabase
    .from('v_employees')
    .select(
      'profile_id, employee_number, first_name, last_name, roles, status, profile_is_active',
    )
    .eq('status', 'active')
    .eq('profile_is_active', true)
    .is('deleted_at', null)
    .order('employee_number', { ascending: true })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).flatMap((row) =>
    row.profile_id && row.employee_number != null
      ? [
          {
            profileId: row.profile_id,
            employeeNumber: row.employee_number,
            firstName: row.first_name ?? '',
            lastName: row.last_name ?? '',
            isCoordinator: (row.roles ?? []).includes('supervisor'),
          },
        ]
      : [],
  )
}

/** Una licencia vigente en el día. */
export interface AgendaLeave {
  employeeId: string
  startsOn: string
  endsOn: string | null
  reason: string | null
}

/** Licencias que cubren el día `day` (sin las dadas de baja). */
export async function fetchAgendaLeavesOnDay(
  day: string,
): Promise<AgendaLeave[]> {
  const { data, error } = await supabase
    .from('employee_leaves')
    .select('employee_id, starts_on, ends_on, reason')
    .is('deleted_at', null)
    .lte('starts_on', day)
    .or(`ends_on.is.null,ends_on.gte.${day}`)
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    employeeId: row.employee_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    reason: row.reason,
  }))
}

/** Observación de cada turno (por id de turno), para el renglón «… (VIDRIOS)». */
export async function fetchShiftObservations(
  shiftIds: string[],
): Promise<Record<string, string>> {
  if (shiftIds.length === 0) {
    return {}
  }
  const { data, error } = await supabase
    .from('shift_observations')
    .select('shift_id, observation')
    .in('shift_id', shiftIds)
  if (error) {
    throw fromPostgrestError(error)
  }
  const result: Record<string, string> = {}
  for (const row of data ?? []) {
    const text = row.observation?.trim()
    if (text) {
      result[row.shift_id] = text
    }
  }
  return result
}
