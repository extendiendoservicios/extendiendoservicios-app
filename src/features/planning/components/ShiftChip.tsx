import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { getStatusMeta } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import type { ColorBy } from '@/features/planning/colorBy'
import { clientChipColors } from '@/features/planning/clientColors'

/** Color del puntito de estado (modo «Cliente»), con los mismos tokens del mapa de estados. */
export const STATUS_DOT_CLASS: Record<string, string> = {
  scheduled: 'bg-text-3',
  upcoming: 'bg-text-3',
  cancelled: 'bg-text-3',
  assigned: 'bg-primary',
  in_progress: 'bg-primary',
  completed: 'bg-success',
  uncovered: 'bg-danger',
}

/** Puntito de estado: borde blanco y sombra fina para que se vea sobre cualquier fondo. */
function StatusDot({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <span
      data-testid="status-dot"
      aria-hidden="true"
      className={cn(
        'inline-block size-[9px] shrink-0 rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]',
        STATUS_DOT_CLASS[status] ?? 'bg-text-3',
        className,
      )}
    />
  )
}

interface ShiftChipProps {
  /** Texto del chip (cliente · sede · franja). */
  label: string
  displayStatus: string
  clientCalendarColor?: number | null
  colorBy: ColorBy
}

/**
 * Contenido del chip del calendario mensual. Modo «Estado»: la insignia de
 * siempre. Modo «Cliente»: fondo y texto del color del cliente, el estado en
 * un puntito a la izquierda (tachado si está cancelado) y el nombre del
 * estado en `sr-only`. Sin color válido cae a la insignia de estado.
 */
function ShiftChip({
  label,
  displayStatus,
  clientCalendarColor,
  colorBy,
}: ShiftChipProps) {
  const meta = getStatusMeta({
    domain: 'shift',
    status: displayStatus as BadgeShiftStatus,
  })
  const colors =
    colorBy === 'client' ? clientChipColors(clientCalendarColor) : null

  if (!colors) {
    return (
      <Badge
        variant={meta.variant}
        className="block w-full min-w-0 truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium"
      >
        <span className="sr-only">{meta.label}: </span>
        {label}
      </Badge>
    )
  }
  return (
    <span
      data-testid="client-chip"
      style={{ background: colors.background, color: colors.color }}
      className={cn(
        'flex w-full min-w-0 items-center gap-[5px] rounded px-1.5 py-0.5 text-[10.5px] font-medium',
        displayStatus === 'cancelled' && 'line-through opacity-70',
      )}
    >
      <StatusDot status={displayStatus} />
      <span className="sr-only">{meta.label}: </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}

export { ShiftChip, StatusDot }
