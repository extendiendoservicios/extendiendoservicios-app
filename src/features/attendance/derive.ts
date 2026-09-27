import type { AssignmentStatus } from '@/api/assignments'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { AssignmentStatus as BadgeAssignmentStatus } from '@/components/status'

/**
 * Reglas de negocio sin React (ATT-011, ATT-012, ATT-014): qué acciones
 * ofrece "Registrar en nombre del empleado" (ADM-11) según el estado de la
 * asignación, y cómo se traduce una `AttendanceBoardRow` al estado que
 * pinta `StatusBadge` (incluidos los derivados `no_record`/`early_leave` de
 * `07_Design_System.md` sección 3). El servidor vuelve a validar cada
 * acción (`0027_rpc_notices_admin_attendance.sql`): esto solo decide qué
 * botones tiene sentido mostrar.
 */

export type AttendanceAction =
  'check_in' | 'check_out' | 'close' | 'delay' | 'absence'

export interface AttendanceActionContext {
  shiftStatus:
    'scheduled' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  status: AssignmentStatus
  checkInAt: string | null
  checkOutAt: string | null
  /** Instante de inicio de la franja efectiva (`effective_starts_at`): decide si todavía "no empezó" para la demora. */
  startsAt: string | null
  /** Inyectable para tests; por defecto `new Date()`. */
  now?: Date
}

/**
 * Acciones que tiene sentido ofrecer en ADM-11 para esta asignación (`06`
 * sección 10 y 11, P14.0):
 * - `check_in`: si todavía no hay inicio registrado y el turno no terminó.
 * - `check_out`/`close`: si hay inicio y no hay fin (las dos son la misma
 *   regla del servidor -- `close_assignment` es un atajo semántico de
 *   `admin_record_attendance(check_out)`, ver `0027`).
 * - `delay`: solo antes del inicio efectivo, sin inicio registrado ni
 *   ausencia ya avisada (ratificado el 26 sep 2026: sin excepción para el
 *   aviso en nombre).
 * - `absence`: sin inicio registrado ni ausencia ya avisada, antes O
 *   después del inicio (P-073, P14.0).
 */
export function getAvailableAttendanceActions(
  ctx: AttendanceActionContext,
): AttendanceAction[] {
  if (ctx.shiftStatus === 'cancelled') {
    return []
  }
  const now = ctx.now ?? new Date()
  const hasCheckIn = ctx.checkInAt != null
  const hasCheckOut = ctx.checkOutAt != null
  const alreadyNotifiedAbsence = ctx.status === 'absence_notified'
  const actions: AttendanceAction[] = []

  if (!hasCheckIn && ctx.shiftStatus !== 'completed') {
    actions.push('check_in')
  }
  if (hasCheckIn && !hasCheckOut) {
    actions.push('check_out')
    actions.push('close')
  }
  if (
    !hasCheckIn &&
    !alreadyNotifiedAbsence &&
    ctx.shiftStatus !== 'completed' &&
    ctx.startsAt != null &&
    now < new Date(ctx.startsAt)
  ) {
    actions.push('delay')
  }
  if (
    !hasCheckIn &&
    !alreadyNotifiedAbsence &&
    ctx.shiftStatus !== 'completed'
  ) {
    actions.push('absence')
  }
  return actions
}

/** Entrada de `StatusBadge` (`domain: 'assignment'`) para una fila de asistencia. */
export interface AttendanceStatusBadgeInput {
  status: BadgeAssignmentStatus
  minutes?: number
}

/**
 * Traduce una `AttendanceBoardRow` al estado que pinta `StatusBadge` (`04`
 * sección 4 y 5, `07` sección 3): `no_record` si `display_status` lo marca;
 * `early_leave` (derivado, sin estado propio en el servidor) si terminó con
 * salida anticipada; `delay_notified` con los minutos del último aviso (el
 * check-in real todavía no pasó); cualquier otro caso, el `status` tal cual.
 */
export function getAttendanceStatusBadgeInput(
  row: Pick<
    AttendanceBoardRow,
    'status' | 'displayStatus' | 'minutesEarlyLeave' | 'lastNoticeMinutesLate'
  >,
): AttendanceStatusBadgeInput {
  if (row.displayStatus === 'no_record') {
    return { status: 'no_record' }
  }
  if (
    row.status === 'finished' &&
    row.minutesEarlyLeave != null &&
    row.minutesEarlyLeave > 0
  ) {
    return { status: 'early_leave', minutes: row.minutesEarlyLeave }
  }
  if (row.status === 'delay_notified') {
    return {
      status: 'delay_notified',
      minutes: row.lastNoticeMinutesLate ?? undefined,
    }
  }
  return { status: row.status }
}
