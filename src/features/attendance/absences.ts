import type { AttendanceBoardRow } from '@/api/attendance'
import { ABSENCE_REASON_LABELS } from '@/lib/absenceReasons'

/**
 * Inasistencias en los imprimibles de asistencia (AJ2-14): lógica sin React.
 *
 * Una asignación cuenta como inasistencia si el turno no está cancelado, la
 * asignación no fue quitada, no tiene fichaje de inicio y además
 * - tiene un aviso de ausencia (`absence_notified`), o
 * - su franja ya terminó (nadie fichó).
 * Mientras la franja siga en curso y no haya aviso de ausencia, no es todavía
 * una inasistencia (puede estar llegando).
 */

type AbsenceCandidate = Pick<
  AttendanceBoardRow,
  | 'status'
  | 'shiftStatus'
  | 'checkInAt'
  | 'endsAt'
  | 'shiftDate'
  | 'startTime'
  | 'endTime'
> &
  Partial<Pick<AttendanceBoardRow, 'removedAt'>>

/** Instante de fin de la franja: el del servidor si viene, si no se arma con fecha y hora (ADR-019, UTC-3). */
function franjaEndsAt(row: AbsenceCandidate): Date {
  if (row.endsAt) {
    return new Date(row.endsAt)
  }
  const end = new Date(`${row.shiftDate}T${row.endTime.slice(0, 8)}-03:00`)
  // Franja que cruza la medianoche: el fin cae al día siguiente.
  if (row.endTime <= row.startTime) {
    end.setDate(end.getDate() + 1)
  }
  return end
}

export function isAbsence(row: AbsenceCandidate, now: Date): boolean {
  if (
    row.shiftStatus === 'cancelled' ||
    row.removedAt != null ||
    row.checkInAt != null
  ) {
    return false
  }
  return row.status === 'absence_notified' || franjaEndsAt(row) <= now
}

/** Texto de la novedad: «Ausencia avisada: Enfermedad» o «Inasistencia: sin fichaje de inicio». */
export function absenceDetail(
  row: Pick<
    AttendanceBoardRow,
    | 'status'
    | 'lastNoticeKind'
    | 'lastNoticeReasonCode'
    | 'lastNoticeReasonText'
  >,
): string {
  if (row.status !== 'absence_notified') {
    return 'Inasistencia: sin fichaje de inicio'
  }
  const text = row.lastNoticeReasonText?.trim()
  if (row.lastNoticeKind === 'absence' && row.lastNoticeReasonCode) {
    if (row.lastNoticeReasonCode === 'other' && text) {
      return `Ausencia avisada: ${text}`
    }
    return `Ausencia avisada: ${ABSENCE_REASON_LABELS[row.lastNoticeReasonCode]}`
  }
  return 'Ausencia avisada'
}
