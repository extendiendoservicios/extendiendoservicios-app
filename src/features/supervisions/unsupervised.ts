import type { AttendanceBoardRow } from '@/api/attendance'
import { getAttendanceRowBadge } from '@/features/attendance/derive'
import { getSupervisionLine } from '@/features/attendance/supervisionLine'
import { addDaysToIsoDate } from '@/features/settings/dateOnly'

/** P35.2 (D-08): período máximo que se consulta, en días. */
export const MAX_UNSUPERVISED_DAYS = 62

/** Un turno sin supervisar: una fila de la pestaña (D-06). */
export interface UnsupervisedShift {
  shiftId: string
  shiftDate: string
  clientName: string
  siteName: string
  startTime: string
  endTime: string
  openEnded: boolean
  employees: { id: string; name: string }[]
  /** Fila de la persona más relevante: de ahí sale el estado de asistencia del turno. */
  statusRow: AttendanceBoardRow
}

/**
 * Orden de relevancia del estado de asistencia de una persona, de más a menos
 * urgente: lo que hay que mirar primero. Lo desconocido va al final.
 */
const RELEVANCE = [
  'no_record',
  'no_checkout',
  'late',
  'present',
  'finished',
] as const

function relevance(row: AttendanceBoardRow): number {
  const index = RELEVANCE.indexOf(
    row.displayStatus as (typeof RELEVANCE)[number],
  )
  return index === -1 ? RELEVANCE.length : index
}

/**
 * P35.2 (D-06, D-07, D-10): agrupa por turno las asignaciones de
 * `v_assignments_board`. Entra el turno con `supervision_state = 'none'` en el
 * que al menos una persona cumple la regla de `getSupervisionLine` (ya
 * empezó, no cancelado, sin ausencia avisada). Más reciente primero.
 *
 * El estado de asistencia del turno es el de la persona más relevante (la
 * más urgente según `RELEVANCE`) entre las que cumplen la regla.
 */
export function groupUnsupervisedShifts(
  rows: AttendanceBoardRow[],
): UnsupervisedShift[] {
  const byShift = new Map<string, AttendanceBoardRow[]>()
  for (const row of rows) {
    if (row.removedAt != null || row.supervisionState !== 'none') {
      continue
    }
    const list = byShift.get(row.shiftId)
    if (list) {
      list.push(row)
    } else {
      byShift.set(row.shiftId, [row])
    }
  }

  const result: UnsupervisedShift[] = []
  for (const list of byShift.values()) {
    const counting = list.filter(
      (row) => getSupervisionLine(row)?.state === 'none',
    )
    if (counting.length === 0) {
      continue
    }
    const statusRow = [...counting].sort(
      (a, b) => relevance(a) - relevance(b),
    )[0]!
    const first = list[0]!
    const seen = new Set<string>()
    const employees: UnsupervisedShift['employees'] = []
    for (const row of list) {
      if (!seen.has(row.employeeId)) {
        seen.add(row.employeeId)
        employees.push({
          id: row.employeeId,
          name: `${row.employeeFirstName} ${row.employeeLastName}`,
        })
      }
    }
    result.push({
      shiftId: first.shiftId,
      shiftDate: first.shiftDate,
      clientName: first.clientName,
      siteName: first.siteName,
      startTime: first.startTime,
      endTime: first.endTime,
      openEnded: first.openEnded,
      employees,
      statusRow,
    })
  }
  return result.sort(
    (a, b) =>
      b.shiftDate.localeCompare(a.shiftDate) ||
      b.startTime.localeCompare(a.startTime),
  )
}

/** Entrada de `StatusBadge` del estado de asistencia del turno. */
export function unsupervisedStatusBadge(shift: UnsupervisedShift) {
  return getAttendanceRowBadge(shift.statusRow)
}

export interface UnsupervisedRange {
  from: string
  to: string
  /** Sin ninguna fecha elegida: se muestran los últimos 7 días (D-08). */
  isDefault: boolean
  /** El período supera `MAX_UNSUPERVISED_DAYS`: no se consulta. */
  tooLong: boolean
}

/** Días de calendario entre dos fechas `yyyy-MM-dd`, ambas incluidas. */
function inclusiveDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const ms = Date.UTC(ty!, tm! - 1, td) - Date.UTC(fy!, fm! - 1, fd)
  return Math.round(ms / 86_400_000) + 1
}

/**
 * Período de la pestaña (D-08). Sin fechas: últimos 7 días hasta `today`. Solo
 * «desde»: hasta hoy. Solo «hasta»: los 7 días que terminan ese día.
 */
export function resolveUnsupervisedRange(
  dateFrom: string,
  dateTo: string,
  today: string,
): UnsupervisedRange {
  const isDefault = !dateFrom && !dateTo
  const to = dateTo || today
  const from = dateFrom || addDaysToIsoDate(to, -6)
  return {
    from,
    to,
    isDefault,
    tooLong: from <= to && inclusiveDays(from, to) > MAX_UNSUPERVISED_DAYS,
  }
}
