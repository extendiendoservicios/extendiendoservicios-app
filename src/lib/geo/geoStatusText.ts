import type { GeoStatus, GeoUnvalidatedReason } from './geoEvaluate'

/** Motivos de «Sin validar» en español (B-03). */
export const GEO_REASON_LABEL: Record<GeoUnvalidatedReason, string> = {
  no_location: 'sin ubicación',
  site_without_coords: 'sede sin coordenadas',
  admin_record: 'registrado por la administración',
  low_accuracy: 'precisión insuficiente',
}

export interface GeoStatusTextInput {
  status: GeoStatus
  reason?: GeoUnvalidatedReason | null
  distanceM?: number | null
  /** Un dueño o administrador lo marcó como válido (B-09). */
  corrected?: boolean
}

/** «350 m» o «1,2 km» (es-AR). */
export function formatDistanceM(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`
}

/**
 * Texto plano para imprimibles (B-20): «Validado», «Fuera de zona (350 m)»,
 * «Sin validar». Nunca incluye coordenadas. `includeReason` agrega el motivo
 * de «Sin validar» entre paréntesis.
 */
export function formatGeoStatusText(
  input: GeoStatusTextInput,
  options: { includeReason?: boolean } = {},
): string {
  if (input.corrected) return 'Validado (corregido)'
  switch (input.status) {
    case 'valid':
      return 'Validado'
    case 'outside':
      return typeof input.distanceM === 'number'
        ? `Fuera de zona (${formatDistanceM(input.distanceM)})`
        : 'Fuera de zona'
    default:
      return options.includeReason && input.reason
        ? `Sin validar (${GEO_REASON_LABEL[input.reason]})`
        : 'Sin validar'
  }
}
