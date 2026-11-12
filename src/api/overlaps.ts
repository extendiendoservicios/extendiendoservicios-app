import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * Avisos de duplicados (OF-02, migración 0082). Funciones de solo lectura que
 * no bloquean nada: la pantalla avisa y deja guardar igual. Solo dueño y
 * administrador. Error posible: `INVALID_TIME_RANGE`.
 */

export interface ServiceOverlap {
  serviceId: string
  serviceName: string
  /** Días de la semana (0 = domingo) que coinciden con el servicio que se carga. */
  commonWeekdays: number[]
  startTime: string
  endTime: string
  openEnded: boolean
}

export interface ShiftOverlap {
  shiftId: string
  /** `null` = turno cargado a mano, sin servicio. */
  serviceName: string | null
  shiftDate: string
  startTime: string
  endTime: string
  openEnded: boolean
}

/** Servicios activos de la sede que coinciden en algún día y se superponen en horario. */
export async function fetchServiceOverlaps(input: {
  siteId: string
  weekdays: number[]
  start: string
  /** `null` = servicio «A terminar». */
  end: string | null
  exceptServiceId?: string | null
}): Promise<ServiceOverlap[]> {
  const { data, error } = await supabase.rpc('service_overlaps', {
    p_site_id: input.siteId,
    p_weekdays: input.weekdays,
    p_start: input.start,
    p_end: input.end as unknown as string, // null = «A terminar» (23:59)
    p_except_id: input.exceptServiceId ?? undefined,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    serviceId: row.service_id,
    serviceName: row.service_name,
    commonWeekdays: row.common_weekdays,
    startTime: row.start_time,
    endTime: row.end_time,
    openEnded: row.open_ended,
  }))
}

/** Turnos no cancelados de la sede, ese día, que se superponen en horario. */
export async function fetchShiftOverlapsInSite(input: {
  siteId: string
  date: string
  start: string
  /** `null` = turno «A terminar». */
  end: string | null
  exceptShiftId?: string | null
}): Promise<ShiftOverlap[]> {
  const { data, error } = await supabase.rpc('shift_overlaps_in_site', {
    p_site_id: input.siteId,
    p_date: input.date,
    p_start: input.start,
    p_end: input.end as unknown as string, // null = «A terminar» (23:59)
    p_except_id: input.exceptShiftId ?? undefined,
  })
  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    shiftId: row.shift_id,
    serviceName: row.service_name,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    openEnded: row.open_ended,
  }))
}
