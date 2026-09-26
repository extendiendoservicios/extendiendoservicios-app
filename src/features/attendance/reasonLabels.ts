import type { AbsenceReason, NoticeKind } from '@/api/adminNotices'
import type { AttendanceKind, AttendanceSource } from '@/api/attendance'

/**
 * Etiquetas en español de las enumeraciones de asistencia y avisos (`04`
 * sección 3: `attendance_kind`, `attendance_source`, `notice_kind`,
 * `absence_reason`), para ADM-06, ADM-10, ADM-11 y ADM-12.
 *
 * TODO(P14.2): unificar con la lista compartida. Front-movil construye en
 * paralelo su propia lista de motivos de ausencia para la pantalla del
 * empleado (`notifyAbsence`); el orquestador integra las dos en un solo
 * archivo al fusionar los paquetes (instrucción del encargo, para no crear
 * una dependencia cruzada entre ramas que se editan al mismo tiempo).
 */

export const ABSENCE_REASON_LABELS: Record<AbsenceReason, string> = {
  illness: 'Enfermedad',
  personal: 'Motivo personal',
  procedure: 'Trámite',
  transport: 'Transporte',
  other: 'Otro',
}

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
