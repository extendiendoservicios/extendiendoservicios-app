import { formatShortDate, formatTime } from '@/lib/format'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/**
 * Textos de fecha y de destino de Insumos en el celular (P25.4). La hora de
 * un movimiento es la del servidor: acá solo se le da formato.
 */

/** `"2026-10-26"` -> `"lun 26 oct"`, sin corrimiento de zona horaria. */
export function formatDayOnly(dateOnly: string): string {
  return formatShortDate(new Date(`${dateOnly.slice(0, 10)}T12:00:00-03:00`))
}

/** Fecha y hora de un instante del servidor: `"lun 26 oct · 14:05"`. */
export function formatStamp(instant: string): string {
  return `${formatShortDate(instant)} · ${formatTime(instant)}`
}

/** `"Hoy · 08:00"` o `"mar 27 oct · 08:00"`: el día y la hora de inicio del turno. */
export function formatShiftWhen(
  shiftDate: string,
  startTime: string,
  today: string = todayInBuenosAires(),
): string {
  const day =
    shiftDate.slice(0, 10) === today ? 'Hoy' : formatDayOnly(shiftDate)
  return `${day} · ${startTime.slice(0, 5)}`
}

/** `"Cliente · Sede"` (o solo lo que haya). */
export function formatPlace(
  clientName: string | null,
  siteName: string | null,
): string {
  return [clientName, siteName].filter(Boolean).join(' · ')
}
