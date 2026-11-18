import { format } from 'date-fns'
import { tz } from '@date-fns/tz'
import { canManageAttendance } from '@/features/attendance/permissions'
import type { AttendanceScreenActor } from '@/features/attendance/permissions'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'

/**
 * OH-09: «Registrar como realizado». Un turno cuya fecha y hora de fin ya
 * pasaron (hora de Argentina) no se crea «programado»: se registra con la
 * asistencia del turno completo (`register_past_shift`). Sin React: se prueba
 * aparte.
 */

/** Texto del aviso del alta cuando el turno ya pasó. */
export const PAST_SHIFT_TITLE = 'Este turno ya pasó'

export const PAST_SHIFT_NOTICE =
  'Se registra como realizado: se crea el turno, se asigna a las personas que elijas y se les carga la asistencia con el inicio y el fin del turno (motivo «Carga posterior»), así las horas cuentan.'

export const PAST_SHIFT_NO_PERMISSION =
  'Este turno ya pasó y no se puede crear como programado. Para cargarlo como realizado hace falta ser de la dirección o de la administración con el permiso «Gestionar asistencia».'

export const PAST_SHIFT_NO_REPEAT =
  'Un turno ya realizado no se puede repetir: se carga de a uno.'

export const PAST_SHIFT_NO_OPEN_ENDED =
  'Un turno ya realizado necesita la hora de fin: no se puede marcar «A terminar».'

/**
 * ¿El turno de esa fecha con esa hora de fin ya terminó? Compara la hora de
 * pared de Buenos Aires (como el servidor: `app.local_ts(fecha, fin) <= now()`).
 * Sin fecha u hora de fin válidas devuelve `false`.
 */
export function isShiftPast(
  date: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}/.test(endTime)) {
    return false
  }
  const nowBuenosAires = format(now, "yyyy-MM-dd'T'HH:mm", {
    in: tz(BUENOS_AIRES_TIME_ZONE),
  })
  return `${date}T${endTime.slice(0, 5)}` <= nowBuenosAires
}

/** Quién puede registrar un turno como realizado: dueño y administración con «Gestionar asistencia». */
export function canRegisterPastShift(actor: AttendanceScreenActor): boolean {
  return canManageAttendance(actor)
}
