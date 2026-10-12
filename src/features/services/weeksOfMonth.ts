/**
 * Repetición mensual de un servicio (AJ3-05). Replica en el cliente la regla
 * de `app.date_matches_weeks_of_month` (migración 0044) para las
 * estimaciones de ADM-09; la fuente de verdad sigue siendo el servidor.
 *
 * `weeksOfMonth` en `null` = todas las semanas. 1 a 4 = la 1.ª a 4.ª
 * ocurrencia de ese día de la semana en el mes (día del mes 1-7, 8-14, 15-21,
 * 22-28); 5 = la última ocurrencia (siete días después ya cae en otro mes).
 */

export const WEEKS_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1.ª' },
  { value: 2, label: '2.ª' },
  { value: 3, label: '3.ª' },
  { value: 4, label: '4.ª' },
  { value: 5, label: 'Última' },
]

/** Cantidad de días del mes (`month` 1-12). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** ¿La fecha (año, mes 1-12, día) cae en alguna de las semanas elegidas? */
export function dateMatchesWeeksOfMonth(
  year: number,
  month: number,
  day: number,
  weeksOfMonth: readonly number[] | null,
): boolean {
  if (weeksOfMonth == null) {
    return true
  }
  const nthOccurrence = Math.floor((day - 1) / 7) + 1
  if (weeksOfMonth.includes(nthOccurrence)) {
    return true
  }
  return weeksOfMonth.includes(5) && day + 7 > daysInMonth(year, month)
}

/**
 * ¿El servicio tiene al menos una fecha en el mes (`month` 1-12) que cumpla
 * vigencia, día de la semana y semanas del mes? (Sin mirar feriados, cliente
 * ni sede: es una orientación previa, como el conteo de ADM-09.)
 */
export function serviceHasDateInMonth(
  service: {
    weekdays: readonly number[]
    weeksOfMonth: readonly number[] | null
    validFrom: string
    validTo: string | null
  },
  year: number,
  month: number,
): boolean {
  const total = daysInMonth(year, month)
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`
  for (let day = 1; day <= total; day += 1) {
    const iso = `${monthPrefix}${String(day).padStart(2, '0')}`
    if (iso < service.validFrom) {
      continue
    }
    if (service.validTo != null && iso > service.validTo) {
      break
    }
    const weekday = new Date(year, month - 1, day).getDay()
    if (
      service.weekdays.includes(weekday) &&
      dateMatchesWeeksOfMonth(year, month, day, service.weeksOfMonth)
    ) {
      return true
    }
  }
  return false
}
