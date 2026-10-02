import type { AttendanceBoardRow } from '@/api/attendance'

/**
 * Filtro "hoy / por franja" de la tabla "Servicios de hoy" (DASH-003): la
 * franja es el par inicio-fin efectivo de la asignación, como `"08:00–12:00"`.
 */
export const ALL_DAY_FILTER = 'all'

export function franjaOf(
  row: Pick<AttendanceBoardRow, 'startTime' | 'endTime'>,
): string {
  return `${row.startTime.slice(0, 5)}–${row.endTime.slice(0, 5)}`
}

/** Franjas distintas del día, ordenadas por hora de inicio. */
export function listFranjas(rows: AttendanceBoardRow[]): string[] {
  return Array.from(new Set(rows.map(franjaOf))).sort()
}

export function filterByFranja(
  rows: AttendanceBoardRow[],
  franja: string,
): AttendanceBoardRow[] {
  return franja === ALL_DAY_FILTER
    ? rows
    : rows.filter((row) => franjaOf(row) === franja)
}
