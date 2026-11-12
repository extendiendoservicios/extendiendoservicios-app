import { Badge } from '@/components/ui/badge'

/**
 * Píldora «Cierre automático» (OF-11): el fin de la asignación lo registró el
 * proceso de cierre automático porque el empleado no fichó el fin. Es el
 * mismo `Badge` con punto que usan las demás píldoras de estado.
 */
function AutoClosedBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" dot className={className}>
      Cierre automático
    </Badge>
  )
}

export { AutoClosedBadge }
