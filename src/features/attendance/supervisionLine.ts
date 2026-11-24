import type { AttendanceBoardRow } from '@/api/attendance'

/**
 * D-10 (P31): segunda línea de la columna Estado con la supervisión del turno
 * («Supervisado», «Supervisando» o «Sin supervisión»), a partir de
 * `supervision_state` y `supervisor_name` de `v_assignments_board`.
 */
export interface SupervisionLine {
  state: 'none' | 'in_progress' | 'done'
  /** Texto visible. */
  label: string
  /** Nombre del coordinador, si lo hay (va en el `title` y en el texto accesible). */
  supervisorName: string | null
}

const LABELS: Record<SupervisionLine['state'], string> = {
  none: 'Sin supervisión',
  in_progress: 'Supervisando',
  done: 'Supervisado',
}

/**
 * La línea no se muestra si el dato no llegó (quien no es administración),
 * si el turno está cancelado, si la persona avisó ausencia, o si el servicio
 * todavía no empezó (sin inicio real y sin estar «Sin registro»).
 */
export function getSupervisionLine(
  row: Pick<
    AttendanceBoardRow,
    | 'supervisionState'
    | 'supervisorName'
    | 'shiftStatus'
    | 'status'
    | 'displayStatus'
    | 'checkInAt'
    | 'checkOutAt'
  >,
): SupervisionLine | null {
  const state = row.supervisionState
  if (!state) {
    return null
  }
  if (row.shiftStatus === 'cancelled' || row.status === 'absence_notified') {
    return null
  }
  const started =
    row.checkInAt != null ||
    row.checkOutAt != null ||
    row.displayStatus === 'no_record' ||
    row.displayStatus === 'no_checkout'
  if (!started) {
    return null
  }
  return {
    state,
    label: LABELS[state],
    supervisorName: state === 'none' ? null : (row.supervisorName ?? null),
  }
}
