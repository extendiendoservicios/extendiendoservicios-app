import { toDateTimeLocal } from '@/features/attendance/dateTimeLocal'

/**
 * Rango válido de las horas que corrige la administración en una jornada
 * (CJ-15 y CJ-32): dentro del día de la jornada (Argentina, ADR-019) y no
 * futuras, igual que `AT_OUT_OF_RANGE` en el servidor. Valores de
 * `input type="datetime-local"` (`yyyy-MM-ddTHH:mm`), que comparan bien
 * como texto.
 */
export function workdayTimeBounds(
  workDate: string,
  now: Date = new Date(),
): { min: string; max: string } {
  const dayStart = `${workDate}T00:00`
  const dayEnd = `${workDate}T23:59`
  const nowLocal = toDateTimeLocal(now)
  return { min: dayStart, max: nowLocal < dayEnd ? nowLocal : dayEnd }
}

/** `true` si la hora (`datetime-local`) cae dentro de los límites de `workdayTimeBounds`. */
export function isWithinWorkdayBounds(
  value: string,
  bounds: { min: string; max: string },
): boolean {
  return value >= bounds.min && value <= bounds.max
}
