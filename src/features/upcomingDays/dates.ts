import { addDaysToIsoDate } from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/**
 * Fechas del minicalendario de «Próximos días» (P32, D-05): todo con texto
 * `"YYYY-MM-DD"` / `"YYYY-MM"`, sin pasar por la zona horaria del dispositivo.
 */

/** Cuántos días hacia adelante se puede mirar (hoy + 60), igual que el servidor. */
export const UPCOMING_MAX_DAYS_AHEAD = 60

/** Primer y último día elegibles: mañana y hoy + 60 (Buenos Aires). */
export function upcomingBounds(now: Date = new Date()): {
  min: string
  max: string
} {
  const today = todayInBuenosAires(now)
  return {
    min: addDaysToIsoDate(today, 1),
    max: addDaysToIsoDate(today, UPCOMING_MAX_DAYS_AHEAD),
  }
}

/** `"2026-11-25"` -> `"2026-11"`. */
export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

function parts(month: string): { year: number; monthIndex: number } {
  const [year = 0, mm = 1] = month.split('-').map(Number)
  return { year, monthIndex: mm - 1 }
}

/** Suma (o resta) meses a un `"YYYY-MM"`. */
export function addMonths(month: string, delta: number): string {
  const { year, monthIndex } = parts(month)
  const total = year * 12 + monthIndex + delta
  const y = Math.floor(total / 12)
  const m = (total % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

/** Primer y último día de un mes, como `"YYYY-MM-DD"`. */
export function monthRange(month: string): { from: string; to: string } {
  const { year, monthIndex } = parts(month)
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  }
}

/** Una fecha `"YYYY-MM-DD"` dentro de [min, max]. */
export function isSelectable(
  isoDate: string,
  min: string,
  max: string,
): boolean {
  return isoDate >= min && isoDate <= max
}

export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]
const WEEKDAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]

/** «martes 25 de noviembre de 2026». */
export function fullDateLabel(isoDate: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return `${WEEKDAY_NAMES[weekday]} ${day} de ${MONTH_NAMES[month - 1]} de ${year}`
}

/** «martes 25 de noviembre»: para «No hay turnos el …». */
export function dayLabel(isoDate: string): string {
  return fullDateLabel(isoDate).replace(/ de \d{4}$/, '')
}
