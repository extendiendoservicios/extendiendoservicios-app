import type { AttendanceBoardRow } from '@/api/attendance'
import type { ShiftListRow } from '@/api/shifts'
import { shiftStartInstant } from './kpis'

/**
 * Bloque "Requiere atención" (DASH-002, `05` línea 36): las cuatro categorías
 * como funciones puras sobre `v_shifts_board` y `v_assignments_board`.
 *
 * - `absence`: asignación con ausencia avisada (turno vivo, sin terminar).
 * - `uncovered`: turno sin cubrir (`display_status = uncovered`). Si el hueco
 *   lo dejó una ausencia avisada, el turno ya aparece por la categoría
 *   `absence` (que ofrece "Asignar reemplazo" sobre ese mismo turno), así que
 *   no se duplica.
 * - `noRecord`: sin registro pasada la hora de inicio.
 * - `overdue`: en curso pasada la hora de fin sin fin registrado.
 */
export type AttentionKind = 'absence' | 'uncovered' | 'noRecord' | 'overdue'

export const ATTENTION_ORDER: AttentionKind[] = [
  'noRecord',
  'overdue',
  'absence',
  'uncovered',
]

export interface AttentionItem {
  kind: AttentionKind
  /** Clave estable para React. */
  key: string
  shiftId: string
  /** Presente en `absence`, `noRecord` y `overdue`. */
  assignment?: AttendanceBoardRow
  /** Turno de `v_shifts_board`, si está cargado (para "Asignar reemplazo"). */
  shift?: ShiftListRow
  /** Minutos desde la hora de referencia (inicio o fin); `null` si no aplica. */
  minutesSince: number | null
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000))
}

export function computeAttention(
  shifts: ShiftListRow[],
  assignments: AttendanceBoardRow[],
  now: Date,
): AttentionItem[] {
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]))
  const live = assignments.filter(
    (row) => row.shiftStatus !== 'cancelled' && row.shiftStatus !== 'completed',
  )
  const items: AttentionItem[] = []

  for (const row of live) {
    if (row.status === 'absence_notified') {
      items.push({
        kind: 'absence',
        key: `absence-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: null,
      })
    } else if (row.displayStatus === 'no_record') {
      items.push({
        kind: 'noRecord',
        key: `noRecord-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: row.startsAt
          ? minutesBetween(new Date(row.startsAt), now)
          : null,
      })
    } else if (
      row.status === 'present' &&
      row.checkOutAt == null &&
      row.endsAt != null &&
      new Date(row.endsAt) < now
    ) {
      items.push({
        kind: 'overdue',
        key: `overdue-${row.id}`,
        shiftId: row.shiftId,
        assignment: row,
        shift: shiftById.get(row.shiftId),
        minutesSince: minutesBetween(new Date(row.endsAt), now),
      })
    }
  }

  const shiftsWithAbsence = new Set(
    items.filter((item) => item.kind === 'absence').map((i) => i.shiftId),
  )
  for (const shift of shifts) {
    if (
      shift.displayStatus === 'uncovered' &&
      !shiftsWithAbsence.has(shift.id)
    ) {
      items.push({
        kind: 'uncovered',
        key: `uncovered-${shift.id}`,
        shiftId: shift.id,
        shift,
        minutesSince: minutesBetween(
          shiftStartInstant(shift.shiftDate, shift.startTime),
          now,
        ),
      })
    }
  }

  return items.sort((a, b) => {
    const byKind =
      ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind)
    if (byKind !== 0) {
      return byKind
    }
    return (b.minutesSince ?? 0) - (a.minutesSince ?? 0)
  })
}
