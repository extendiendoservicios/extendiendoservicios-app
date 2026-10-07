import type { MyDayAssignment } from '@/api/myDay'
import { isApiError } from '@/api/errors'

/**
 * P19.5c · «Estoy en camino» (`notify_on_the_way`, migración 0033): reglas
 * que la pantalla necesita para decidir qué mostrar. El servidor vuelve a
 * validar todo (ventana, estado, minutos) con su propio reloj: acá solo se
 * decide si vale la pena ofrecer el botón, y la hora del dispositivo nunca
 * guarda nada (mismo criterio que `attendanceWindow.ts`).
 */

/** Horas antes del inicio efectivo desde las que se puede avisar (igual que la RPC). */
export const ON_THE_WAY_WINDOW_HOURS = 3

/** Rango de la estimación, en minutos (`INVALID_ETA` fuera de 1 a 240). */
export const ETA_MIN_MINUTES = 1
export const ETA_MAX_MINUTES = 240

/** Opciones rápidas de «¿En cuánto llegás?». */
export const ETA_QUICK_OPTIONS = [10, 15, 20, 30, 45, 60] as const

const ARGENTINA_OFFSET = '-03:00'

/** Instante de una hora de pared `HH:MM[:SS]` del día del turno (Argentina, ADR-019). */
function wallClockToDate(shiftDate: string, time: string): Date {
  const hhmmss = time.length === 5 ? `${time}:00` : time
  return new Date(`${shiftDate}T${hhmmss}${ARGENTINA_OFFSET}`)
}

/**
 * Franja efectiva de la asignación como instantes. Usa `startsAt`/`endsAt`
 * de la vista y, si faltaran, arma el instante con fecha y hora de pared
 * del turno en la zona fija de Argentina.
 */
function effectiveRange(assignment: MyDayAssignment): {
  start: Date
  end: Date
} {
  return {
    start: assignment.startsAt
      ? new Date(assignment.startsAt)
      : wallClockToDate(assignment.shiftDate, assignment.startTime),
    end: assignment.endsAt
      ? new Date(assignment.endsAt)
      : wallClockToDate(assignment.shiftDate, assignment.endTime),
  }
}

/** `true` si `now` cae entre 3 h antes del inicio efectivo y el fin efectivo (el fin no entra). */
export function isInOnTheWayWindow(
  assignment: MyDayAssignment,
  now: Date,
): boolean {
  const { start, end } = effectiveRange(assignment)
  const opensAt = start.getTime() - ON_THE_WAY_WINDOW_HOURS * 3_600_000
  return now.getTime() >= opensAt && now.getTime() < end.getTime()
}

/**
 * ¿Se puede avisar «en camino» ahora? Dentro de la ventana y mientras no
 * haya inicio registrado, ausencia avisada ni turno cancelado o terminado.
 */
export function canNotifyOnTheWay(
  assignment: MyDayAssignment,
  now: Date,
): boolean {
  return (
    assignment.shiftStatus !== 'cancelled' &&
    assignment.shiftStatus !== 'completed' &&
    assignment.checkInAt == null &&
    assignment.status !== 'absence_notified' &&
    assignment.status !== 'present' &&
    assignment.status !== 'finished' &&
    isInOnTheWayWindow(assignment, now)
  )
}

/**
 * El último aviso de la asignación es un «en camino» vigente: sin inicio
 * registrado ni ausencia avisada (el último manda: si después avisó una
 * demora o una ausencia, `lastNoticeKind` ya no es `on_the_way`).
 */
export function hasActiveOnTheWay(assignment: MyDayAssignment): boolean {
  return (
    assignment.lastNoticeKind === 'on_the_way' &&
    assignment.checkInAt == null &&
    assignment.status !== 'absence_notified'
  )
}

/**
 * Estado del botón de la tarjeta: `notify` («Estoy en camino»), `change`
 * («Cambiar hora estimada», ya avisó y sigue en ventana) o `none`.
 */
export type OnTheWayAction = 'notify' | 'change' | 'none'

export function onTheWayAction(
  assignment: MyDayAssignment,
  now: Date,
): OnTheWayAction {
  if (!canNotifyOnTheWay(assignment, now)) return 'none'
  return hasActiveOnTheWay(assignment) ? 'change' : 'notify'
}

/** Valida la estimación: `null` (sin estimar) o entero de 1 a 240. Devuelve el mensaje o `null` si está bien. */
export function validateEtaMinutes(minutes: number | null): string | null {
  if (minutes === null) return null
  if (
    !Number.isInteger(minutes) ||
    minutes < ETA_MIN_MINUTES ||
    minutes > ETA_MAX_MINUTES
  ) {
    return `La estimación tiene que ser de ${ETA_MIN_MINUTES} a ${ETA_MAX_MINUTES} minutos.`
  }
  return null
}

const ERROR_MESSAGES: Record<string, string> = {
  ASSIGNMENT_NOT_FOUND:
    'No encontramos ese servicio. Volvé a Hoy e intentá de nuevo.',
  NOT_YOUR_ASSIGNMENT: 'Ese servicio no es tuyo.',
  SHIFT_CANCELLED: 'Este servicio fue cancelado: no hace falta que avises.',
  SHIFT_COMPLETED: 'Este servicio ya terminó.',
  ASSIGNMENT_STARTED: 'Ya registraste el inicio de este servicio.',
  ABSENCE_ALREADY_NOTIFIED: 'Ya avisaste que no vas a ir a este servicio.',
  INVALID_ETA: 'La estimación tiene que ser de 1 a 240 minutos.',
  ON_THE_WAY_TOO_EARLY:
    'Todavía es muy temprano para avisar que vas en camino: podés hacerlo desde 3 horas antes del inicio.',
  ON_THE_WAY_TOO_LATE:
    'El servicio ya terminó: no podés avisar que vas en camino.',
}

/** Texto claro para un error de `notify_on_the_way`: por código si se conoce, si no el mensaje del servidor. */
export function onTheWayErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.hint && ERROR_MESSAGES[error.hint]) {
      return ERROR_MESSAGES[error.hint]!
    }
    return error.message
  }
  return 'No pudimos guardar el aviso. Probá de nuevo.'
}
