import { DEFAULT_GEOFENCE_RADIUS_M } from '@/lib/geo'

/**
 * Radio vigente de una sede (B-02): el propio si lo tiene y, si no, el
 * general. Si el general todavía no cargó, se usa el valor por defecto (150 m)
 * solo para dibujar, nunca para guardar.
 */
export function effectiveSiteRadiusM(
  siteRadiusM: number | null | undefined,
  generalRadiusM: number | null | undefined,
): number {
  return siteRadiusM ?? generalRadiusM ?? DEFAULT_GEOFENCE_RADIUS_M
}

/** «150 m (propio)» / «150 m (general)»: para el popup y la ficha de la sede. */
export function describeSiteRadius(
  siteRadiusM: number | null | undefined,
  generalRadiusM: number | null | undefined,
): string {
  const radius = effectiveSiteRadiusM(siteRadiusM, generalRadiusM)
  return `${radius} m (${siteRadiusM != null ? 'propio' : 'general'})`
}
