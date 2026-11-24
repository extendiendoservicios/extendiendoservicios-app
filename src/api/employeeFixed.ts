import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import {
  fromPostgrestError,
  parseConflictDetail,
  type ConflictDetail,
} from './errors'

/**
 * `src/api/employeeFixed.ts` (P30.4b, OH-06 y OH-07): lo que la ficha del
 * empleado necesita de la migración 0087, solo para dueño y administradores.
 *
 * - `employee_fixed_gaps`: turnos donde la persona es fija del servicio y no
 *   quedó asignada, con el motivo (OH-06).
 * - `employee_fixed_pattern`: el patrón fijo (servicios activos y vigentes
 *   donde es fija), de donde se arma la pizarra la primera vez (OH-07).
 * - `get_employee_week_board` / `save_employee_week_board`: la pizarra semanal
 *   libre. No toca turnos ni asignaciones.
 *
 * Los `weekday` de la pizarra y del patrón siguen el criterio de la base:
 * 0 = domingo a 6 = sábado.
 */

/** Motivos por los que un fijo no quedó asignado (`employee_fixed_gaps`). */
export type FixedGapReason =
  'ON_LEAVE' | 'OVERLAP' | 'REMOVED' | 'ADDED_AFTER' | 'NOT_ASSIGNED'

export interface FixedGap {
  shiftId: string
  /** `YYYY-MM-DD`. */
  shiftDate: string
  startTime: string
  endTime: string
  openEnded: boolean
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  serviceId: string
  serviceName: string
  /** Índice 0–11 del color del cliente. */
  calendarColor: number | null
  reason: FixedGapReason
  /** Con `OVERLAP` trae el turno con el que se pisa; con `ON_LEAVE`, las licencias. */
  detail: ConflictDetail | null
  shiftStatus: string
}

const GAP_REASONS: readonly string[] = [
  'ON_LEAVE',
  'OVERLAP',
  'REMOVED',
  'ADDED_AFTER',
  'NOT_ASSIGNED',
]

/** Turnos fijos sin asignar de la persona entre dos fechas (hasta 400 días). */
export async function fetchEmployeeFixedGaps(
  employeeId: string,
  from: string,
  to: string,
): Promise<FixedGap[]> {
  const { data, error } = await supabase.rpc('employee_fixed_gaps', {
    p_employee_id: employeeId,
    p_from: from,
    p_to: to,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    openEnded: row.open_ended,
    clientId: row.client_id,
    clientName: row.client_name,
    siteId: row.site_id,
    siteName: row.site_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    calendarColor: row.calendar_color ?? null,
    reason: (GAP_REASONS.includes(row.reason)
      ? row.reason
      : 'NOT_ASSIGNED') as FixedGapReason,
    detail: parseConflictDetail(row.detail),
    shiftStatus: row.shift_status,
  }))
}

export interface FixedPatternRow {
  serviceId: string
  serviceName: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  calendarColor: number | null
  /** 0 = domingo a 6 = sábado. */
  weekdays: number[]
  /** `null` = todas las semanas del mes. */
  weeksOfMonth: number[] | null
  startTime: string
  endTime: string
  openEnded: boolean
  validFrom: string
  validTo: string | null
}

/** Servicios activos y vigentes donde la persona es fija. */
export async function fetchEmployeeFixedPattern(
  employeeId: string,
): Promise<FixedPatternRow[]> {
  const { data, error } = await supabase.rpc('employee_fixed_pattern', {
    p_employee_id: employeeId,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    serviceId: row.service_id,
    serviceName: row.service_name,
    clientId: row.client_id,
    clientName: row.client_name,
    siteId: row.site_id,
    siteName: row.site_name,
    calendarColor: row.calendar_color ?? null,
    weekdays: row.weekdays ?? [],
    weeksOfMonth:
      row.weeks_of_month && row.weeks_of_month.length > 0
        ? row.weeks_of_month
        : null,
    startTime: row.start_time,
    endTime: row.end_time,
    openEnded: row.open_ended,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }))
}

/** Un bloque de la pizarra, tal como lo guarda la base (`weekday` 0 = domingo). */
export interface WeekBoardBlock {
  id: string
  weekday: number
  /** `HH:MM`. */
  start: string
  /** `HH:MM`, o `null` si no tiene hora de fin. */
  end: string | null
  label: string
  /** Índice 0–11 del color de cliente, o `null`. */
  colorIndex: number | null
  serviceId: string | null
}

export interface WeekBoard {
  employeeId: string
  blocks: WeekBoardBlock[]
  updatedBy: string | null
  updatedByName: string | null
  /** `timestamptz` ISO. */
  updatedAt: string | null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function mapBoard(raw: unknown): WeekBoard | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const source = raw as Record<string, unknown>
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks : []
  const blocks: WeekBoardBlock[] = rawBlocks.map((item) => {
    const block = (item ?? {}) as Record<string, unknown>
    return {
      id: text(block.id),
      weekday: Number(block.weekday ?? 0),
      start: text(block.start).slice(0, 5),
      end: typeof block.end === 'string' ? block.end.slice(0, 5) : null,
      label: typeof block.label === 'string' ? block.label : '',
      colorIndex:
        typeof block.color_index === 'number' ? block.color_index : null,
      serviceId: str(block.service_id),
    }
  })
  return {
    employeeId: text(source.employee_id),
    blocks,
    updatedBy: str(source.updated_by),
    updatedByName: str(source.updated_by_name),
    updatedAt: str(source.updated_at),
  }
}

/** La pizarra guardada, o `null` si todavía no se guardó ninguna. */
export async function fetchEmployeeWeekBoard(
  employeeId: string,
): Promise<WeekBoard | null> {
  const { data, error } = await supabase.rpc('get_employee_week_board', {
    p_employee_id: employeeId,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return mapBoard(data)
}

/** Reemplaza todos los bloques de la pizarra. `INVALID_BOARD` trae el motivo en el `message`. */
export async function saveEmployeeWeekBoard(
  employeeId: string,
  blocks: WeekBoardBlock[],
): Promise<WeekBoard> {
  const payload = blocks.map((block) => ({
    id: block.id,
    weekday: block.weekday,
    start: block.start,
    end: block.end,
    label: block.label,
    color_index: block.colorIndex,
    service_id: block.serviceId,
  })) satisfies Json
  const { data, error } = await supabase.rpc('save_employee_week_board', {
    p_employee_id: employeeId,
    p_blocks: payload,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  const board = mapBoard(data)
  if (!board) {
    return {
      employeeId,
      blocks,
      updatedBy: null,
      updatedByName: null,
      updatedAt: null,
    }
  }
  return board
}
