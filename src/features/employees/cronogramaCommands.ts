import * as assignmentsApi from '@/api/assignments'
import type { AssignEmployeeWarning } from '@/api/assignments'
import * as shiftsApi from '@/api/shifts'
import {
  undoForAssign,
  undoForAssignmentTime,
  undoForMove,
  undoForShiftTime,
  type UndoAction,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'

/**
 * OF-10: cada cambio del cronograma es un comando que llama al RPC que
 * corresponde y devuelve las advertencias del servidor y la acción para
 * «Deshacer». Las validaciones (licencia, superposición, dotación) las hace
 * el servidor; acá solo se traduce.
 */
export type CronogramaCommand =
  | UndoAction
  | { kind: 'assign'; shiftId: string; employeeId: string }
  | { kind: 'unassign'; assignmentId: string; reason?: string }

export interface CommandResult {
  warnings: AssignEmployeeWarning[]
  /** `null` si el cambio no se puede deshacer (quitar). */
  undo: UndoAction | null
}

export const UNDO_REASON = 'Deshecho desde el cronograma'
export const REMOVE_DEFAULT_REASON = 'Quitado desde el cronograma'

/**
 * Ejecuta el comando. `block` es el bloque tal como estaba antes del cambio
 * (hace falta para armar el deshacer de los cambios de horario).
 */
export async function runCronogramaCommand(
  command: CronogramaCommand,
  block?: WeekBlock,
): Promise<CommandResult> {
  switch (command.kind) {
    case 'shift_time':
      await shiftsApi.updateShiftTime(
        command.shiftId,
        command.start,
        command.openEnded ? null : command.end,
        command.openEnded,
        command.date,
      )
      return {
        warnings: [],
        undo: block ? undoForShiftTime(block) : null,
      }
    case 'assignment_time':
      await assignmentsApi.updateAssignmentTime(
        command.assignmentId,
        command.start,
        command.end,
      )
      return {
        warnings: [],
        undo: block ? undoForAssignmentTime(block) : null,
      }
    case 'move': {
      const result = await assignmentsApi.moveAssignment({
        assignmentId: command.assignmentId,
        targetShiftId: command.targetShiftId,
        start: command.start,
        end: command.end,
      })
      return {
        warnings: result.warnings,
        undo: undoForMove(result.assignment.id, result.previous),
      }
    }
    case 'assign': {
      const result = await assignmentsApi.assignEmployee({
        shiftId: command.shiftId,
        employeeId: command.employeeId,
      })
      return {
        warnings: result.warnings,
        undo: undoForAssign(result.assignment.id),
      }
    }
    case 'unassign':
      await assignmentsApi.removeAssignment(
        command.assignmentId,
        command.reason ?? UNDO_REASON,
      )
      return { warnings: [], undo: null }
  }
}
