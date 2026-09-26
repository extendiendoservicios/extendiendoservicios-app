import type { MyDayAssignment } from '@/api/myDay'

/**
 * `src/features/employee/attendanceWindow.ts` (MOB-EMP-009, EMP-08 tareas,
 * `06_API.md` sección 9: "Empleado fuera de su ventana (sin asignación
 * vigente `present` en el turno de la tarea) → `TASK_LOCKED`"). La ventana
 * del empleado es exactamente el estado `present` de su propia asignación:
 * `record_check_in` la pone en `present` y `record_check_out` la saca de
 * ahí (a `finished`), así que no hace falta comparar horas a mano — el
 * mismo estado que ya trae `v_my_day` alcanza (P-063: "el empleado marca
 * tareas solo entre su inicio y su fin registrados").
 */
export function canEditTasks(assignment: Pick<MyDayAssignment, 'status'>) {
  return assignment.status === 'present'
}

/**
 * Aviso claro de por qué las tareas están en solo lectura (`08` "bloqueo
 * fuera de la ventana... con un aviso claro"), según si todavía no arrancó,
 * ya terminó, o quedó en otro estado (por ejemplo, una ausencia avisada).
 */
export function taskWindowNotice(
  assignment: Pick<MyDayAssignment, 'checkInAt' | 'checkOutAt'>,
): string {
  if (assignment.checkInAt == null) {
    return 'Todavía no registraste el inicio de este servicio: vas a poder marcar las tareas después de fichar.'
  }
  if (assignment.checkOutAt != null) {
    return 'Ya registraste el fin de este servicio: las tareas quedaron como estaban en ese momento.'
  }
  return 'No podés marcar tareas en este momento.'
}
