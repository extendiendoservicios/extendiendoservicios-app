import type { ShiftListRow } from '@/api/shifts'
import type { AssignmentBoardRow } from '@/api/assignments'
import { shiftFranjaKey } from '@/features/shifts/grouping'

/**
 * Agrupado y derivados de ADM-03 y ADM-04, sin React: funciones puras de un
 * solo recorrido (`O(n)`), pensadas para memoizarse en el componente con
 * `useMemo` y así cumplir el criterio de rendimiento de F11 ("un mes con
 * 600 turnos se renderiza en menos de 1 segundo tras la carga",
 * `08_Fases_y_Backlog.md` F11) sin recalcular en cada chip. El agrupado por
 * franja de ADM-05 (`groupShiftsByFranja`) vive en
 * `features/shifts/grouping.ts` -- ver el comentario de ese archivo.
 */

/** Turnos de un mes, agrupados por `shiftDate` (ADM-03: un chip por turno, contador por día). */
export function groupShiftsByDate(
  shifts: ShiftListRow[],
): Map<string, ShiftListRow[]> {
  const byDate = new Map<string, ShiftListRow[]>()
  for (const shift of shifts) {
    const list = byDate.get(shift.shiftDate)
    if (list) {
      list.push(shift)
    } else {
      byDate.set(shift.shiftDate, [shift])
    }
  }
  return byDate
}

/**
 * Filas de `v_assignments_board` agrupadas por empleado y, dentro de cada
 * empleado, por fecha (ADM-04: "Agrupado en el cliente por empleado y
 * día"). El orden de los empleados es el que trae `employees`, no el de
 * `assignments` (un empleado sin ninguna asignación en la semana igual
 * tiene que verse, con las 7 celdas "libre").
 */
export function groupAssignmentsByEmployeeAndDate(
  assignments: AssignmentBoardRow[],
): Map<string, Map<string, AssignmentBoardRow[]>> {
  const byEmployee = new Map<string, Map<string, AssignmentBoardRow[]>>()
  for (const assignment of assignments) {
    let byDate = byEmployee.get(assignment.employeeId)
    if (!byDate) {
      byDate = new Map<string, AssignmentBoardRow[]>()
      byEmployee.set(assignment.employeeId, byDate)
    }
    const list = byDate.get(assignment.shiftDate)
    if (list) {
      list.push(assignment)
    } else {
      byDate.set(assignment.shiftDate, [assignment])
    }
  }
  return byEmployee
}

/** Texto del chip de ADM-03: cliente · sede · franja. */
export function shiftChipLabel(shift: ShiftListRow): string {
  return `${shift.clientName} · ${shift.siteName} · ${shiftFranjaKey(shift)}`
}
