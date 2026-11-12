import type {
  AssignEmployeeInput,
  AssignEmployeeResult,
} from '@/api/assignments'
import { isApiError, type ConflictDetail } from '@/api/errors'

/**
 * P27.5 (OD-16): asignar empleados desde «Editar turno». Lógica sin React:
 * llama a `assign_employee` de a uno (en orden, así la dotación se controla
 * bien en el servidor) y junta lo que salió bien con sus advertencias y lo
 * que el servidor rechazó, con su `message` tal cual. El turno ya está
 * guardado cuando esto corre: un rechazo no deshace nada.
 */

export interface AssignedOnEdit {
  employeeId: string
  warnings: string[]
}

export interface RejectedOnEdit {
  employeeId: string
  message: string
  /** OF-08: con qué choca (`conflictShiftId` para «Ver turno»). */
  detail: ConflictDetail | null
}

export interface AssignOnEditResult {
  assigned: AssignedOnEdit[]
  rejected: RejectedOnEdit[]
}

export async function assignEmployeesOnEdit(
  shiftId: string,
  employeeIds: string[],
  assign: (input: AssignEmployeeInput) => Promise<AssignEmployeeResult>,
): Promise<AssignOnEditResult> {
  const result: AssignOnEditResult = { assigned: [], rejected: [] }
  for (const employeeId of employeeIds) {
    try {
      const { warnings } = await assign({ shiftId, employeeId })
      result.assigned.push({ employeeId, warnings })
    } catch (error) {
      result.rejected.push({
        employeeId,
        message: isApiError(error)
          ? error.message
          : 'No pudimos asignar a esta persona.',
        detail: isApiError(error) ? error.detail : null,
      })
    }
  }
  return result
}

/** Lugares libres del turno: dotación pedida menos asignados vigentes (nunca negativo). */
export function remainingSlots(
  requiredStaff: number,
  assignedCount: number,
): number {
  return Math.max(requiredStaff - assignedCount, 0)
}
