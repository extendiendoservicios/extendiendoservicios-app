import { Link } from 'react-router'
import { MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { MyDayAssignment } from '@/api/myDay'
import { getNoticeMessage } from '@/features/employee/notice'
import { useNow } from '@/features/employee/useNow'
import { formatAssignmentRange } from '@/features/employee/shiftRange'
import { AssignmentStatusBadge } from './AssignmentStatusBadge'

/**
 * Tarjeta de un servicio de hoy (EMP-03): cliente, sede, dirección, franja,
 * estado y el aviso vigente; abre el detalle (EMP-04). La usan Hoy del
 * empleado y, para quien también es supervisor, Hoy del supervisor (P19.9).
 */
export function ServiceCard({
  assignment,
  featured = false,
}: {
  assignment: MyDayAssignment
  featured?: boolean
}) {
  const cancelled = assignment.shiftStatus === 'cancelled'
  // Reloj solo para la UI: la tarjeta se actualiza sola al vencer el aviso.
  const now = useNow(30_000)
  const notice = cancelled ? null : getNoticeMessage(assignment, now)
  return (
    <Link to={`/app/servicio/${assignment.assignmentId}`} className="block">
      <Card variant={featured ? 'hero' : 'default'}>
        <CardContent className="flex flex-col gap-[6px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-text">
                {assignment.clientName}
              </p>
              <p className="truncate text-[12px] text-text-3">
                {assignment.siteName}
              </p>
            </div>
            <AssignmentStatusBadge assignment={assignment} />
          </div>
          {assignment.siteAddress && (
            <p className="flex items-center gap-[6px] text-[11.5px] text-text-3">
              <MapPin aria-hidden="true" className="size-[13px] shrink-0" />
              <span className="truncate">{assignment.siteAddress}</span>
            </p>
          )}
          <p className="text-[13px] font-semibold text-text-2">
            {formatAssignmentRange(assignment)}
          </p>
          {notice && (
            <p className="text-[11.5px] font-semibold text-warning-800">
              {notice.text}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
