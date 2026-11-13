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

/** Fechas consultadas a la vez como máximo (la RPC trae un solo día por llamada). */
export const OVERLAP_PARALLEL_LIMIT = 6

export interface DateShiftOverlaps {
  date: string
  overlaps: ShiftOverlap[]
}

/**
 * OF-21: turnos de la sede que se superponen, fecha por fecha (para «Repetir
 * este turno»). `shift_overlaps_in_site` recibe un solo día, así que se hacen
 * consultas en paralelo de a `OVERLAP_PARALLEL_LIMIT`. Devuelve solo las fechas
 * con coincidencias, en orden. Si una consulta falla no bloquea: esa fecha se
 * toma como sin coincidencias (el servidor valida lo que corresponde).
 */
export async function fetchShiftOverlapsForDates(input: {
  siteId: string
  dates: string[]
  start: string
  /** `null` = turno «A terminar». */
  end: string | null
}): Promise<DateShiftOverlaps[]> {
  const results = new Array<DateShiftOverlaps>(input.dates.length)
  let next = 0
  async function worker() {
    while (next < input.dates.length) {
      const index = next++
      const date = input.dates[index] as string
      try {
        const overlaps = await fetchShiftOverlapsInSite({
          siteId: input.siteId,
          date,
          start: input.start,
          end: input.end,
        })
        results[index] = { date, overlaps }
      } catch {
        results[index] = { date, overlaps: [] }
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(OVERLAP_PARALLEL_LIMIT, input.dates.length) },
      worker,
    ),
  )
  return results.filter((item) => item.overlaps.length > 0)
}
