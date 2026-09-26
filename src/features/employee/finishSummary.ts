import type { MyDayAssignment } from '@/api/myDay'
import type { ShiftTask } from '@/api/tasks'

/**
 * `src/features/employee/finishSummary.ts` (MOB-EMP-011, EMP-10 finalizar,
 * `05` fila EMP-10, P-076): los dos avisos informativos que se muestran
 * antes de confirmar el fin, ninguno bloquea el botón "Registrar fin".
 */

/** Cuántas tareas obligatorias todavía no se resolvieron (ni completadas ni marcadas "no realizada"). */
export function countPendingRequiredTasks(tasks: ShiftTask[]): number {
  return tasks.filter(
    (task) =>
      task.isRequired &&
      (task.status === 'pending' || task.status === 'in_progress'),
  ).length
}

/**
 * El instante previsto de fin del turno: la franja propia de la asignación
 * si la tiene (`endsAt`), si no la hora de fin efectiva combinada con la
 * fecha del turno. Se arma con el offset fijo de Argentina (`-03:00`,
 * ADR-019: sin horario de verano) en vez de con la zona del dispositivo, así
 * el cálculo no cambia según dónde esté configurado el navegador.
 */
export function scheduledEndInstant(
  assignment: Pick<MyDayAssignment, 'shiftDate' | 'endTime' | 'endsAt'>,
): Date {
  if (assignment.endsAt) {
    return new Date(assignment.endsAt)
  }
  return new Date(`${assignment.shiftDate}T${assignment.endTime}-03:00`)
}

/** `true` si `now` todavía no llegó a la hora de fin prevista (P-076: solo informativo, nunca bloquea). */
export function isEarlyLeave(
  now: Date,
  assignment: Pick<MyDayAssignment, 'shiftDate' | 'endTime' | 'endsAt'>,
): boolean {
  return now.getTime() < scheduledEndInstant(assignment).getTime()
}
