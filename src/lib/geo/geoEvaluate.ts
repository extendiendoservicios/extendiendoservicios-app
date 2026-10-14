import { DEFAULT_MAX_ACCURACY_M, EARTH_RADIUS_M } from './constants'

/**
 * Validación por ubicación (módulo B1, B-06, B-23, B-37): misma regla que
 * `geo_evaluate` en la base. La base es la autoridad y guarda su resultado;
 * esto solo sirve para pintar el mini mapa en vivo.
 */

export type GeoStatus = 'valid' | 'outside' | 'unvalidated'

export type GeoUnvalidatedReason =
  'no_location' | 'site_without_coords' | 'admin_record' | 'low_accuracy'

export interface GeoPoint {
  lat: number
  lng: number
}

export interface GeoFix extends GeoPoint {
  /** Precisión horizontal del dispositivo, en metros. */
  accuracyM: number
}

export interface GeoEvaluation {
  status: GeoStatus
  reason?: GeoUnvalidatedReason
  /** Distancia a la sede, en metros enteros; `null` si no se pudo calcular. */
  distanceM: number | null
}

export interface GeoEvaluateInput {
  /** Posición del dispositivo; `null` o con coordenadas vacías = sin ubicación. */
  position: GeoFix | null | undefined
  /** Coordenadas de la sede; `null` = sede sin coordenadas. */
  site: GeoPoint | null | undefined
  /** Radio vigente de la sede, en metros. */
  radiusM: number
  /** Tope de precisión (B-23). Por omisión, 150 m. */
  maxAccuracyM?: number
}

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Distancia en metros entre dos puntos (fórmula de haversine, radio medio terrestre). */
export function haversineDistanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

const isNum = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n)

const hasCoords = (p: Partial<GeoPoint> | null | undefined): p is GeoPoint =>
  !!p && isNum(p.lat) && isNum(p.lng)

/**
 * Regla (d = distancia, r = radio, a = precisión, tope = 150 por omisión):
 * - sin coordenadas propias: `unvalidated` / `no_location`;
 * - sede sin coordenadas: `unvalidated` / `site_without_coords`;
 * - `d > r + a`: `outside`;
 * - `d <= r + a` y `a <= tope`: `valid`;
 * - `d <= r + a` y `a > tope`: `unvalidated` / `low_accuracy`.
 * La comparación usa la distancia sin redondear; solo se redondea lo que se devuelve.
 * Una precisión inválida (faltante o negativa) se toma como 0.
 */
export function geoEvaluate(input: GeoEvaluateInput): GeoEvaluation {
  const { position, site, radiusM } = input
  const maxAccuracyM = input.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M

  if (!hasCoords(position)) {
    return { status: 'unvalidated', reason: 'no_location', distanceM: null }
  }
  if (!hasCoords(site)) {
    return {
      status: 'unvalidated',
      reason: 'site_without_coords',
      distanceM: null,
    }
  }

  const accuracy =
    isNum(position.accuracyM) && position.accuracyM > 0 ? position.accuracyM : 0
  const d = haversineDistanceM(position, site)
  const distanceM = Math.round(d)

  if (d > radiusM + accuracy) return { status: 'outside', distanceM }
  if (accuracy <= maxAccuracyM) return { status: 'valid', distanceM }
  return { status: 'unvalidated', reason: 'low_accuracy', distanceM }
}
