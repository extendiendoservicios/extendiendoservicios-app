import type { MyDayAssignment } from '@/api/myDay'
import type { NoticeKind } from '@/api/notices'

/**
 * EMP-12 (MOB-EMP-020, `05` fila EMP-12): qué asignaciones se pueden avisar
 * y qué tipo de aviso corresponde ofrecer para cada una.
 */

/**
 * Una asignación se puede avisar mientras no tenga el inicio registrado y
 * no tenga ya una ausencia avisada (`absence_notified` bloquea cualquier
 * otro aviso: `06` sección 11, "repetir un aviso del mismo tipo, o avisar
 * demora estando ya en `absence_notified`" → `TOO_LATE_TO_NOTIFY`). El resto
 * de la validación de tiempo ("¿ya pasó la hora de inicio?") la hace la RPC
 * en el momento de confirmar, no acá: mostrar el error del servidor es más
 * confiable que repetir esa cuenta con la hora del dispositivo.
 */
export function isNotifiable(assignment: MyDayAssignment): boolean {
  return (
    assignment.shiftStatus !== 'cancelled' &&
    assignment.checkInAt == null &&
    assignment.status !== 'absence_notified'
  )
}

/**
 * Tipos de aviso disponibles para una asignación ya elegida (P-072, P-073:
 * "se puede pasar de demora a ausencia, pero no repetir el mismo aviso").
 * Si ya avisó una demora (`delay_notified`), no se ofrece avisar demora de
 * nuevo — solo pasar a ausencia.
 */
export function availableNoticeKinds(
  assignment: MyDayAssignment,
): NoticeKind[] {
  if (assignment.status === 'delay_notified') {
    return ['absence']
  }
  return ['delay', 'absence']
}
