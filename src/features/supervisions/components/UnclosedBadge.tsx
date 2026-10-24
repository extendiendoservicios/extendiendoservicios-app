import { TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/status'
import type { SupervisionStatus } from '@/api/supervisions'

interface SupervisionStateBadgesProps {
  status: SupervisionStatus
  /** CJ-31: la jornada se cerró sola con la supervisión abierta («Sin cerrar»). */
  unclosed?: boolean
}

/**
 * Estado de una supervisión más la marca «Sin cerrar» (CJ-31): el cierre
 * automático de las 23:55 registró su fin pero nadie la cerró. La
 * administración la resuelve con «Cancelar».
 */
function SupervisionStateBadges({
  status,
  unclosed,
}: SupervisionStateBadgesProps) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge domain="supervision" status={status} />
      {unclosed === true && (
        <Badge variant="warning">
          <TriangleAlert aria-hidden="true" className="size-3" />
          Sin cerrar
        </Badge>
      )}
    </span>
  )
}

export { SupervisionStateBadges }
