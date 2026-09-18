import { Badge } from '@/components/ui/badge'
import { getStatusMeta, type StatusBadgeInput } from './statusMap'

/**
 * StatusBadge (DS-007): único componente para mostrar el estado de un turno,
 * asignación, tarea, supervisión, empleado, cliente, sede o usuario, sobre
 * el mapa de `statusMap.ts` (`07_Design_System.md` sección 3).
 */
export type StatusBadgeProps = StatusBadgeInput & { className?: string }

function StatusBadge({ className, ...input }: StatusBadgeProps) {
  const meta = getStatusMeta(input)

  return (
    <Badge variant={meta.variant} dot className={className}>
      {meta.label}
    </Badge>
  )
}

export { StatusBadge }
