import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status'
import { NO_CHECKOUT_LABEL } from '@/features/shifts/openEnded'
import type { MyDayAssignment } from '@/api/myDay'

/**
 * Estado de una asignación del empleado: un turno cancelado se muestra como
 * «Cancelado» (CB-03) y una asignación sin salida (AJ2-09/AJ2-10) como «Sin
 * salida»; el resto, con el estado propio.
 */
export function AssignmentStatusBadge({
  assignment,
}: {
  assignment: Pick<MyDayAssignment, 'shiftStatus' | 'status' | 'noCheckout'>
}) {
  if (assignment.shiftStatus === 'cancelled') {
    return <StatusBadge domain="shift" status="cancelled" />
  }
  if (assignment.noCheckout) {
    return <Badge variant="warning">{NO_CHECKOUT_LABEL}</Badge>
  }
  return <StatusBadge domain="assignment" status={assignment.status} />
}
