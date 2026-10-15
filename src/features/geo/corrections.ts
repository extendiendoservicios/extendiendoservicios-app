import { formatTime } from '@/lib/format'
import type { AttendanceCorrection } from '@/api/geo'

/** Texto de una corrección del historial (B-09, B-28, B-41). */
export function describeCorrection(
  correction: AttendanceCorrection,
  recordKinds: Map<string, 'check_in' | 'check_out'>,
): string {
  const kindLabel =
    recordKinds.get(correction.attendanceRecordId) === 'check_out'
      ? 'fin'
      : 'inicio'
  if (correction.kind === 'geo') {
    return `Marcó como válido el ${kindLabel}`
  }
  const before = correction.oldRecordedAt
    ? formatTime(correction.oldRecordedAt)
    : '—'
  const after = correction.newRecordedAt
    ? formatTime(correction.newRecordedAt)
    : '—'
  return `Corrigió la hora de ${kindLabel}: ${before} → ${after}`
}
