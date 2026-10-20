import type { LeaveInRange } from '@/api/employees'

/**
 * P19.11d: la licencia bloquea la asignación (`ON_LEAVE` es un error). Lógica
 * sin React para marcar, al elegir empleados de un turno nuevo, a quienes
 * tienen licencia el día del turno (no se pueden elegir) o durante parte de la
 * repetición (se pueden elegir, pero en esas fechas el servidor no los asigna).
 */

function overlaps(leave: LeaveInRange, from: string, to: string): boolean {
  return leave.startsOn <= to && (leave.endsOn == null || leave.endsOn >= from)
}

/** Empleados con licencia en el rango `[from, to]`. Con `from === to` es "ese día". */
export function employeesOnLeaveIn(
  leaves: readonly LeaveInRange[],
  from: string,
  to: string,
): Set<string> {
  const result = new Set<string>()
  for (const leave of leaves) {
    if (overlaps(leave, from, to)) {
      result.add(leave.employeeId)
    }
  }
  return result
}
