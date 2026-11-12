import * as assignmentsApi from '@/api/assignments'
import type { AssignEmployeeWarning } from '@/api/assignments'
import * as shiftsApi from '@/api/shifts'
import { ownerDelete } from '@/api/ownerDelete'
import {
  undoForAssign,
  undoForAssignmentTime,
  undoForMove,
  undoForMoveToNewShift,
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
  | {
      /** OF-23: pasa a la persona a un turno nuevo que se crea en el mismo paso. */
      kind: 'move_new_shift'
      assignmentId: string
      date: string
      start: string
      end: string
      /** Solo la dirección borra turnos (P27): sin esto no hay «Deshacer». */
      canUndo: boolean
    }
  | { kind: 'assign'; shiftId: string; employeeId: string }
  | { kind: 'unassign'; assignmentId: string; reason?: string }

export interface CommandResult {
  warnings: AssignEmployeeWarning[]
  /** OF-23: advertencias de la creación del turno nuevo (por ejemplo `HOLIDAY`). */
  shiftWarnings?: string[]
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
      // La franja propia de la persona acompaña al turno (DEF-P28-02); va
      // después para que ya quede dentro del horario nuevo del turno.
      if (command.ownTime) {
        await assignmentsApi.updateAssignmentTime(
          command.ownTime.assignmentId,
          command.ownTime.start,
          command.ownTime.end,
        )
      }
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
    case 'move_new_shift': {
      const result = await assignmentsApi.moveAssignmentToNewShift({
        assignmentId: command.assignmentId,
        date: command.date,
        start: command.start,
        end: command.end,
      })
      return {
        warnings: result.warnings,
        shiftWarnings: result.shiftWarnings,
        undo: command.canUndo
          ? undoForMoveToNewShift(
              result.assignmentId,
              result.shiftId,
              result.previous,
            )
          : null,
      }
    }
    case 'move_back_delete_shift': {
      // Primero se devuelve a la persona (el turno nuevo queda vacío) y después se borra.
      await assignmentsApi.moveAssignment({
        assignmentId: command.assignmentId,
        targetShiftId: command.targetShiftId,
        start: command.start,
        end: command.end,
      })
      await ownerDelete({
        kind: 'shift',
        id: command.deleteShiftId,
        confirmName: '',
      })
      return { warnings: [], undo: null }
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
