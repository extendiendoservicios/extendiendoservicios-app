import type { NoticeKind } from '@/api/notices'
import type { AttendanceKind, AttendanceSource } from '@/api/attendance'

/**
 * Etiquetas en español de las enumeraciones de asistencia y avisos (`04`
 * sección 3: `attendance_kind`, `attendance_source`, `notice_kind`), para
 * ADM-06, ADM-10, ADM-11 y ADM-12. Los motivos de ausencia viven en
 * `src/lib/absenceReasons.ts`, compartida con la app del empleado.
 */

export { ABSENCE_REASON_LABELS } from '@/lib/absenceReasons'

export const NOTICE_KIND_LABELS: Record<NoticeKind, string> = {
  delay: 'Demora',
  absence: 'Ausencia',
}

export const ATTENDANCE_SOURCE_LABELS: Record<AttendanceSource, string> = {
  employee_app: 'Desde la app',
  admin: 'Cargado por administración',
}

export const ATTENDANCE_KIND_LABELS: Record<AttendanceKind, string> = {
  check_in: 'Inicio',
  check_out: 'Fin',
}
