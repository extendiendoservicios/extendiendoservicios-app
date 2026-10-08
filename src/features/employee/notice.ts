import type { MyDayAssignment } from '@/api/myDay'
import { absenceReasonLabel } from '@/lib/absenceReasons'
import { formatTime } from '@/lib/format'
import {
  hasActiveOnTheWay,
  hasExpiredOnTheWay,
} from '@/features/employee/onTheWay'

/**
 * ABS-005 (`05_Pantallas_y_Navegacion.md` fila EMP-03/EMP-04): el aviso
 * vigente de una asignación, para mostrar "Avisaste una demora de 15 min" o
 * "Avisaste que no vas: enfermedad" en Hoy y en el detalle del servicio.
 *
 * Solo se considera "vigente" mientras el estado de la asignación siga
 * siendo `delay_notified` o `absence_notified` (el aviso todavía tiene
 * efecto): una vez que la persona registró el inicio, el último aviso que
 * quedó guardado en `attendance_notices` ya es historia, no algo para
 * anunciar de nuevo en la pantalla principal.
 */
export interface NoticeMessage {
  /** El texto a mostrar, ya armado en voseo. */
  text: string
  /** `true` si lo cargó la administración en nombre del empleado (`last_notice_source = 'admin'`). */
  byAdmin: boolean
}

/** Motivo de la ausencia para la frase: el texto propio si eligió "Otro", si no la etiqueta. */
function absenceReasonForSentence(assignment: MyDayAssignment): string {
  const text = assignment.lastNoticeReasonText?.trim()
  if (assignment.lastNoticeReasonCode === 'other' && text) {
    return `"${text}"`
  }
  return absenceReasonLabel(assignment.lastNoticeReasonCode!).toLowerCase()
}

export function getNoticeMessage(
  assignment: MyDayAssignment,
  now: Date = new Date(),
): NoticeMessage | null {
  const byAdmin = assignment.lastNoticeSource === 'admin'

  // P19.5c: «en camino» es un aviso más y el último manda; no cambia el
  // estado de la asignación, así que se reconoce por `lastNoticeKind`.
  if (hasActiveOnTheWay(assignment, now)) {
    return {
      text: assignment.lastNoticeEstimatedArrivalAt
        ? `Avisaste que estás en camino · llegás ~${formatTime(assignment.lastNoticeEstimatedArrivalAt)}`
        : 'Avisaste que estás en camino.',
      byAdmin: false,
    }
  }

  // P19.5g: vencido (hora estimada + 15 min), no se muestra una hora pasada
  // como vigente; el botón pasa a «Avisar de nuevo».
  if (hasExpiredOnTheWay(assignment, now)) {
    return {
      text: 'Tu aviso de llegada venció. Si seguís en camino, avisá de nuevo.',
      byAdmin: false,
    }
  }

  if (
    assignment.status === 'delay_notified' &&
    assignment.lastNoticeKind === 'delay' &&
    assignment.lastNoticeMinutesLate != null
  ) {
    return {
      text: byAdmin
        ? `La administración registró que llegás ${assignment.lastNoticeMinutesLate} min tarde.`
        : `Avisaste una demora de ${assignment.lastNoticeMinutesLate} min.`,
      byAdmin,
    }
  }

  if (
    assignment.status === 'absence_notified' &&
    assignment.lastNoticeKind === 'absence' &&
    assignment.lastNoticeReasonCode != null
  ) {
    return {
      text: byAdmin
        ? `La administración registró que no vas: ${absenceReasonForSentence(assignment)}.`
        : `Avisaste que no vas: ${absenceReasonForSentence(assignment)}.`,
      byAdmin,
    }
  }

  return null
}
