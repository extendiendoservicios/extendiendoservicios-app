import { addDays, addMonths, addWeeks } from 'date-fns'
import { localDateToIsoDate } from '@/features/settings/dateOnly'

/**
 * Fechas del calendario mensual (ADM-03) y la grilla semanal (ADM-04),
 * sin React -- funciones puras, fáciles de memoizar en el componente y de
 * testear sin renderizar nada. Mismo criterio "sin pasar por UTC" que
 * `src/features/settings/dateOnly.ts` (evita el corrimiento de un día en
 * husos horarios negativos como el de Argentina).
 */

function parseIsoDateParts(isoDate: string): {
  year: number
  month: number
  day: number
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) {
    throw new Error(`Fecha con formato inesperado: "${isoDate}".`)
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
}

function isoDateToLocalDate(isoDate: string): Date {
  const { year, month, day } = parseIsoDateParts(isoDate)
  return new Date(year, month - 1, day)
}

/** Primer y último día del mes, en `"yyyy-MM-dd"` (rango de `fetchShiftsBoardByRange`, sin límite de horizonte, P-054). */
export function monthRange(
  year: number,
  month: number,
): { from: string; to: string } {
  const from = new Date(year, month - 1, 1)
  const to = new Date(year, month, 0)
  return { from: localDateToIsoDate(from), to: localDateToIsoDate(to) }
}

/** Lunes de la semana que contiene `isoDate` (semana argentina: lunes a domingo). */
export function startOfWeekIso(isoDate: string): string {
  const date = isoDateToLocalDate(isoDate)
  const weekday = date.getDay() // 0 = domingo
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday
  return localDateToIsoDate(addDays(date, diffToMonday))
}

/** Los 7 días de la semana que empieza en `startIso` (lunes a domingo). */
export function weekDaysIso(startIso: string): string[] {
  const start = isoDateToLocalDate(startIso)
  return Array.from({ length: 7 }, (_, index) =>
    localDateToIsoDate(addDays(start, index)),
  )
}

/** Semana siguiente o anterior (`weeks` negativo) a partir del lunes actual. */
export function addWeeksToIsoDate(isoDate: string, weeks: number): string {
  return localDateToIsoDate(addWeeks(isoDateToLocalDate(isoDate), weeks))
}

/**
 * Los días que se ven en la grilla del calendario mensual (ADM-03): semanas
 * completas (lunes a domingo) que cubren el 1° y el último día del mes, con
 * los días de los meses vecinos marcados `isCurrentMonth: false` (se
 * muestran atenuados, sin turnos propios del mes).
 */
export interface CalendarGridDay {
  date: string
  isCurrentMonth: boolean
}

export function buildMonthGridDays(
  year: number,
  month: number,
): CalendarGridDay[] {
  const firstOfMonth = new Date(year, month - 1, 1)
  const lastOfMonth = new Date(year, month, 0)
  const gridStart = startOfWeekIso(localDateToIsoDate(firstOfMonth))
  const gridEnd = startOfWeekIso(localDateToIsoDate(lastOfMonth))
  const lastWeekDays = weekDaysIso(gridEnd)
  const gridEndLast = lastWeekDays[lastWeekDays.length - 1] as string

  const days: CalendarGridDay[] = []
  let cursor = gridStart
  while (cursor <= gridEndLast) {
    const { month: cursorMonth } = parseIsoDateParts(cursor)
    days.push({ date: cursor, isCurrentMonth: cursorMonth === month })
    cursor = localDateToIsoDate(addDays(isoDateToLocalDate(cursor), 1))
  }
  return days
}

/** Mes siguiente o anterior (`months` negativo), normalizado al día 1. */
export function addMonthsToYearMonth(
  year: number,
  month: number,
  months: number,
): { year: number; month: number } {
  const next = addMonths(new Date(year, month - 1, 1), months)
  return { year: next.getFullYear(), month: next.getMonth() + 1 }
}
