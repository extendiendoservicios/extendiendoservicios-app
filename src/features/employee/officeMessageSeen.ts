import type { MyDayAssignment } from '@/api/myDay'

/**
 * P29 OG-05 · Detección local del «Nuevo mensaje de la oficina».
 *
 * `v_my_day.changed_since_last_seen` se enciende por cualquier cambio del
 * turno o de la asignación y no dice qué cambió. Para distinguir que lo que
 * cambió fue el mensaje, el celular guarda por asignación el último
 * `shiftNotes` visto en Hoy. Todo el acceso al almacenamiento va con
 * try/catch (modo privado, cuota llena): si falla, no se distingue y el
 * turno aparece en el bloque de cambios como siempre.
 */
const KEY_PREFIX = 'es.officeMessage.'

function readSeen(assignmentId: string): string | null {
  try {
    return window.localStorage.getItem(KEY_PREFIX + assignmentId)
  } catch {
    return null
  }
}

/**
 * `true` si el turno tiene mensaje, está en los cambios relevantes y el
 * mensaje difiere del último visto. Si nunca se guardó nada para esa
 * asignación (primera visita en este dispositivo) no se puede saber: `false`.
 */
export function isNewOfficeMessage(assignment: MyDayAssignment): boolean {
  if (assignment.shiftNotes == null) return false
  const seen = readSeen(assignment.assignmentId)
  if (seen == null) return false
  return seen !== assignment.shiftNotes
}

/** Guarda el mensaje actual de cada asignación como «ya visto» (cadena vacía si no hay). */
export function rememberOfficeMessages(assignments: MyDayAssignment[]): void {
  try {
    for (const assignment of assignments) {
      window.localStorage.setItem(
        KEY_PREFIX + assignment.assignmentId,
        assignment.shiftNotes ?? '',
      )
    }
  } catch {
    // Sin almacenamiento: el aviso queda genérico.
  }
}
