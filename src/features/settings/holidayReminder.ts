/**
 * AJ2-13: aviso de feriados del año siguiente. Lógica sin React.
 *
 * A partir del 1 de octubre, si el año que viene no tiene ningún feriado
 * cargado (activo), Configuración → Feriados avisa y ofrece cargar los
 * nacionales. Los feriados puente o turísticos por decreto no están en la
 * lista nacional: se agregan a mano.
 */

/** Mes (1 a 12) desde el que se muestra el aviso. */
export const HOLIDAY_REMINDER_FROM_MONTH = 10

/** Año siguiente al de `today` (`"YYYY-MM-DD"`). */
export function nextYearOf(today: string): number {
  return Number(today.slice(0, 4)) + 1
}

/**
 * `true` si hay que mostrar el aviso: ya es octubre o más y el año siguiente
 * no tiene feriados activos. Mientras la consulta no respondió
 * (`activeHolidaysCount` indefinido) no se muestra, para no parpadear.
 */
export function shouldRemindNextYearHolidays(
  today: string,
  activeHolidaysCount: number | undefined,
): boolean {
  const month = Number(today.slice(5, 7))
  return month >= HOLIDAY_REMINDER_FROM_MONTH && activeHolidaysCount === 0
}

/** Texto del aviso de resultado al cargar los feriados nacionales de un año. */
export function describeNationalHolidaysLoad(
  year: number,
  result: { created: number; reactivated: number; skipped: number },
): string {
  const parts: string[] = []
  if (result.created > 0) parts.push(`${result.created} nuevos`)
  if (result.reactivated > 0) parts.push(`${result.reactivated} reactivados`)
  if (result.skipped > 0) parts.push(`${result.skipped} ya existían`)
  return parts.length > 0
    ? `Feriados nacionales de ${year}: ${parts.join(', ')}.`
    : `No agregamos feriados nuevos de ${year}.`
}
