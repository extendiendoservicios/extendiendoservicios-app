import { isApiError } from '@/api/errors'
import type { ShiftDateWarnings, ShiftStatus } from '@/api/shifts'

/**
 * Cambio de fecha de un turno (P19.11d, `update_shift_time` con `p_date`):
 * reglas de la interfaz sin React.
 */

/** Texto fijo que explica qué pasa con los avisos al mover el turno de día (0060). */
export const DATE_CHANGE_NOTICE =
  'Al mover el turno de día se limpian los avisos de demora y de ausencia que ya tenía.'

/**
 * La fecha se ofrece editable solo si el turno no empezó (programado o con
 * personal asignado). El servidor además exige que nadie haya fichado
 * (`SHIFT_STARTED`).
 */
export function canEditShiftDate(status: ShiftStatus): boolean {
  return status === 'scheduled' || status === 'assigned'
}

/** Líneas de advertencia previas al cambio de fecha; vacío = no hay nada que avisar. */
export function dateWarningLines(warnings: ShiftDateWarnings): string[] {
  const lines: string[] = []
  if (warnings.holiday) {
    lines.push('La fecha nueva es feriado.')
  }
  if (warnings.outsideAvailability.length > 0) {
    const names = warnings.outsideAvailability
      .map((item) => item.employeeName)
      .join(', ')
    lines.push(
      warnings.outsideAvailability.length === 1
        ? `${names} está fuera de su disponibilidad declarada en esa fecha y franja.`
        : `${names} están fuera de su disponibilidad declarada en esa fecha y franja.`,
    )
  }
  return lines
}

/**
 * Mensaje de un error al guardar el turno con fecha nueva. `ON_LEAVE` y
 * `ASSIGNMENT_OVERLAP` traen del servidor el nombre de la persona afectada, se
 * muestran tal cual; los demás llevan una explicación pensada para la pantalla.
 */
export function shiftDateErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!isApiError(error)) {
    return fallback
  }
  switch (error.hint) {
    case 'SHIFT_STARTED':
      return 'El turno ya empezó o alguien ya fichó: no se puede cambiar la fecha.'
    case 'SHIFT_DATE_IN_PAST':
      return 'La fecha nueva no puede ser anterior a hoy.'
    case 'SHIFT_DATE_TAKEN':
      return 'Este servicio ya tiene otro turno ese día. Elegí otra fecha.'
    default:
      return error.message
  }
}
