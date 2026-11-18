import type { AttendanceBoardRow } from '@/api/attendance'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { getAttendanceRowBadge } from '@/features/attendance/derive'

/**
 * Filtro "hoy / por franja" de la tabla "Servicios de hoy" (DASH-003): la
 * franja es el par inicio-fin efectivo de la asignación, como `"08:00–12:00"`.
 */
export const ALL_DAY_FILTER = 'all'

export function franjaOf(
  row: Pick<AttendanceBoardRow, 'startTime' | 'endTime' | 'openEnded'>,
): string {
  return formatShiftRange(row.startTime, row.endTime, row.openEnded)
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

/**
 * OH-02: claves de orden de las columnas de «Servicios de hoy».
 *
 * - Horario: texto `HH:MM` de inicio más fin (las horas con cero a la
 *   izquierda se ordenan bien como texto, no hace falta `sortingFn` propio).
 * - Estado: por urgencia (lo que pide atención primero), no alfabético.
 * - Inicio real, horas y salida anticipada: sin dato van siempre al final
 *   (`undefined` + `sortUndefined: 'last'` de la tabla).
 */
export function scheduleSortKey(
  row: Pick<AttendanceBoardRow, 'startTime' | 'endTime'>,
): string {
  return `${row.startTime.slice(0, 5)}-${row.endTime.slice(0, 5)}`
}

const STATUS_URGENCY: string[] = [
  'no_record',
  'absence_notified',
  'late',
  'no_checkout',
  'delay_notified',
  'on_the_way',
  'early_leave',
  'present',
  'finished',
  'assigned',
  'confirmed',
  'cancelled',
]

export function statusSortKey(
  row: Pick<
    AttendanceBoardRow,
    | 'status'
    | 'displayStatus'
    | 'shiftStatus'
    | 'minutesEarlyLeave'
    | 'lastNoticeMinutesLate'
  >,
): number {
  const badge = getAttendanceRowBadge(row)
  const index = STATUS_URGENCY.indexOf(badge.status)
  return index === -1 ? STATUS_URGENCY.length : index
}
