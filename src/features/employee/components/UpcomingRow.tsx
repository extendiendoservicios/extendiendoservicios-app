import { Link } from 'react-router'
import type { MyDayAssignment } from '@/api/myDay'
import { formatCalendarDate } from '@/lib/format'
import { formatAssignmentRange } from '../shiftRange'
import { AssignmentStatusBadge } from './AssignmentStatusBadge'

/**
 * Fila de un servicio de los próximos días (EMP-03 «Próximos días» y SUP-10
 * para el coordinador que también es empleado): fecha, sede, horario y estado.
 * Abre el detalle del servicio (EMP-04).
 */
export function UpcomingRow({ assignment }: { assignment: MyDayAssignment }) {
  return (
    <Link
      to={`/app/servicio/${assignment.assignmentId}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-[9px]"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-text">
          {formatCalendarDate(assignment.shiftDate)} · {assignment.siteName}
        </p>
        <p className="truncate text-[11px] text-text-3">
          {formatAssignmentRange(assignment)}
        </p>
      </div>
      <AssignmentStatusBadge assignment={assignment} />
    </Link>
  )
}
