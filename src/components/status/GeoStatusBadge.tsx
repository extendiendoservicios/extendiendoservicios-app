import { Badge } from '@/components/ui/badge'
import {
  formatDistanceM,
  GEO_REASON_LABEL,
  type GeoStatus,
  type GeoUnvalidatedReason,
} from '@/lib/geo'
import type { BadgeVariant } from './types'

/**
 * GeoStatusBadge (módulo B1, B-03, B-09): resultado de la validación por
 * ubicación de un fichaje. Verde «Validado», rojo «Fuera de zona», gris
 * «Sin validar» (con el motivo) y verde «Validado (corregido)» cuando un
 * dueño o administrador lo marcó como válido. Para imprimibles usar
 * `formatGeoStatusText` (`@/lib/geo`).
 */
export interface GeoStatusBadgeProps {
  status: GeoStatus
  /** Motivo de «Sin validar»; se muestra entre paréntesis. */
  reason?: GeoUnvalidatedReason | null
  /** Distancia a la sede, en metros. Solo se muestra con `showDistance`. */
  distanceM?: number | null
  /** Marcado como válido por la administración (B-09): «Validado (corregido)». */
  corrected?: boolean
  /** Agrega la distancia: «Fuera de zona · 350 m». */
  showDistance?: boolean
  /** Muestra el motivo de «Sin validar» en el texto. Por omisión, sí. */
  showReason?: boolean
  className?: string
}

export function getGeoStatusMeta({
  status,
  reason,
  corrected = false,
  showReason = true,
}: Pick<
  GeoStatusBadgeProps,
  'status' | 'reason' | 'corrected' | 'showReason'
>): {
  variant: BadgeVariant
  label: string
} {
  if (corrected) return { variant: 'success', label: 'Validado (corregido)' }
  switch (status) {
    case 'valid':
      return { variant: 'success', label: 'Validado' }
    case 'outside':
      return { variant: 'danger', label: 'Fuera de zona' }
    default:
      return {
        variant: 'neutral',
        label:
          showReason && reason
            ? `Sin validar (${GEO_REASON_LABEL[reason]})`
            : 'Sin validar',
      }
  }
}

function GeoStatusBadge({
  status,
  reason,
  distanceM,
  corrected,
  showDistance = false,
  showReason = true,
  className,
}: GeoStatusBadgeProps) {
  const meta = getGeoStatusMeta({ status, reason, corrected, showReason })
  const withDistance =
    showDistance && typeof distanceM === 'number'
      ? ` · ${formatDistanceM(distanceM)}`
      : ''

  return (
    <Badge variant={meta.variant} dot className={className}>
      {meta.label}
      {withDistance}
    </Badge>
  )
}

export { GeoStatusBadge }
