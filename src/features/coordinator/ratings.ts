import type {
  MySupervision,
  SupervisionAssignment,
  SupervisionRating,
} from '@/api/mySupervisions'

/**
 * A quién le falta calificación para poder cerrar la supervisión (P24.2,
 * CJ-10, CJ-28): a todos los empleados asignados con inicio registrado. Los
 * ausentes (sin inicio) no se califican, y el propio coordinador, si también
 * está asignado como empleado del turno, queda fuera (no se califica a sí
 * mismo, P15.0). La base vuelve a exigirlo en `complete_supervision`
 * (`RATINGS_PENDING`).
 */
export interface PendingRating {
  employeeId: string
  assignmentId: string | undefined
  name: string
}

export function employeesToRate(
  supervision: Pick<MySupervision, 'assignedEmployees'>,
  selfId: string | null,
): MySupervision['assignedEmployees'] {
  return supervision.assignedEmployees.filter(
    (employee) => employee.employeeId !== selfId && employee.checkInAt != null,
  )
}

export function pendingRatings(
  supervision: Pick<MySupervision, 'assignedEmployees'>,
  assignments: SupervisionAssignment[],
  ratings: SupervisionRating[],
  selfId: string | null,
): PendingRating[] {
  const ratedAssignmentIds = new Set(ratings.map((r) => r.assignmentId))
  return employeesToRate(supervision, selfId).flatMap((employee) => {
    const assignmentId = assignments.find(
      (a) => a.employeeId === employee.employeeId,
    )?.assignmentId
    if (assignmentId && ratedAssignmentIds.has(assignmentId)) return []
    return [
      {
        employeeId: employee.employeeId,
        assignmentId,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
      },
    ]
  })
}
