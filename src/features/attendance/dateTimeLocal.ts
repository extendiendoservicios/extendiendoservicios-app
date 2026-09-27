import { format } from 'date-fns'
import { tz } from '@date-fns/tz'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'

/**
 * Conversión entre el valor de un `input type="datetime-local"` (sin zona,
 * `"yyyy-MM-ddTHH:mm"`) y un instante real, siempre en hora de Argentina
 * (ADR-019, mismo criterio que `src/lib/format.ts`) -- para el campo "Hora"
 * de ADM-11 (ATT-010): "por defecto ahora; editable desde las 0:00 del día
 * del turno hasta ahora, nunca futura" (ratificado el 26 sep 2026, P14.0).
 *
 * Se usa `datetime-local` (no `TimeInput`, que es solo `HH:mm`) porque el
 * rango válido de `admin_record_attendance`/`close_assignment` puede cruzar
 * la medianoche: si se carga la asistencia recién al día siguiente, "las
 * 0:00 del día del turno hasta ahora" cubre más de 24 horas (decisión
 * propia, documentada en el reporte del encargo).
 *
 * Argentina no tiene horario de verano (ADR-019): el desfase con UTC es
 * siempre `-03:00`, así que alcanza con concatenar el offset a mano en vez
 * de calcularlo -- no hace falta ninguna librería para esta conversión en
 * particular.
 */
const buenosAiresContext = tz(BUENOS_AIRES_TIME_ZONE)

/** El instante dado (por defecto ahora), como valor de `datetime-local` en hora de Argentina. */
export function toDateTimeLocal(date: Date = new Date()): string {
  return format(date, "yyyy-MM-dd'T'HH:mm", { in: buenosAiresContext })
}

/** Las 0:00 (Argentina) del día del turno, como valor de `datetime-local`. */
export function shiftDayStartAsDateTimeLocal(shiftDate: string): string {
  return `${shiftDate}T00:00`
}

/** Valor de `datetime-local` (hora de Argentina) a un ISO 8601 con el offset fijo `-03:00`, para mandar como `p_at`. */
export function dateTimeLocalToIso(value: string): string {
  return `${value}:00-03:00`
}
