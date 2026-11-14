import type { MyDayAssignment } from '@/api/myDay'

/** Qué botón de la huella corresponde en «Mi turno» (OG-07). */
export type MyShiftAction = 'start' | 'end' | 'none'

/**
 * Mismo criterio que `ClockTabPage` de la app del empleado: se puede
 * registrar el inicio si todavía no hay inicio y no avisó que no va; el fin,
 * si ya hay inicio, falta el fin y la asignación no quedó «Sin salida»
 * (AJ2-09: esa se corrige desde la oficina).
 */
export function myShiftAction(
  assignment: Pick<
    MyDayAssignment,
    'checkInAt' | 'checkOutAt' | 'status' | 'noCheckout'
  >,
): MyShiftAction {
  if (assignment.checkInAt == null) {
    return assignment.status === 'absence_notified' ? 'none' : 'start'
  }
  if (assignment.checkOutAt == null && !assignment.noCheckout) {
    return 'end'
  }
  return 'none'
}
