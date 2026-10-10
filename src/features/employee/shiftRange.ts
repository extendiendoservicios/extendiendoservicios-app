import {
  formatShiftRange,
  NO_CHECKOUT_LABEL,
} from '@/features/shifts/openEnded'

/**
 * AJ2-10: franja «inicio–fin» de una asignación para el celular del empleado.
 * En un turno «A terminar» (`openEnded`) nunca se muestra 23:59: sale «A terminar».
 */
export function formatAssignmentRange(assignment: {
  startTime: string
  endTime: string
  openEnded?: boolean
}): string {
  return formatShiftRange(
    assignment.startTime,
    assignment.endTime,
    assignment.openEnded,
  )
}

/** AJ2-09: aviso de «Sin salida» (el día del turno terminó sin fichar la salida). */
export const NO_CHECKOUT_MESSAGE = `${NO_CHECKOUT_LABEL}: el día de este turno ya terminó. Avisale a tu supervisor o a la oficina para que carguen la salida.`

/** Mensaje de `OPEN_SHIFT_DAY_ENDED` al intentar fichar la salida pasadas las 23:59. */
export const OPEN_SHIFT_DAY_ENDED_MESSAGE =
  'El día de este turno ya terminó. Avisale a tu supervisor o a la oficina para que carguen la salida.'

/** AJ2-10: franja «inicio–fin» de una supervisión (el turno puede ser «A terminar»). */
export function formatSupervisionRange(supervision: {
  startTime: string
  endTime: string
  shiftOpenEnded?: boolean
}): string {
  return formatShiftRange(
    supervision.startTime,
    supervision.endTime,
    supervision.shiftOpenEnded,
  )
}
