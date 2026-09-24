/**
 * Lógica de coordenadas para `MapPicker` (SITE-004): validación de rango,
 * parseo de los campos de texto y redondeo para mostrar. Separado del
 * componente visual para poder testearlo sin montar Leaflet (`jsdom` no
 * mide el contenedor del mapa).
 */

/** Un punto de latitud/longitud, o `null` cuando la sede no tiene coordenadas. */
export interface Coordinates {
  lat: number
  lng: number
}

export const LAT_MIN = -90
export const LAT_MAX = 90
export const LNG_MIN = -180
export const LNG_MAX = 180

/** Cantidad de decimales que se muestran y se guardan en los campos de texto. */
const DISPLAY_DECIMALS = 6

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

export function isValidLat(value: number): boolean {
  return isInRange(value, LAT_MIN, LAT_MAX)
}

export function isValidLng(value: number): boolean {
  return isInRange(value, LNG_MIN, LNG_MAX)
}

export function isValidCoordinates(value: Coordinates): boolean {
  return isValidLat(value.lat) && isValidLng(value.lng)
}

/**
 * Convierte el texto de un campo (lat o lng) a número, o `undefined` si el
 * campo está vacío o no es un número válido. No valida el rango: eso lo hace
 * quien llama, porque el rango depende de si es latitud o longitud.
 */
export function parseCoordinateInput(raw: string): number | undefined {
  const trimmed = raw.trim().replace(',', '.')
  if (trimmed === '') return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** Redondea a `DISPLAY_DECIMALS` decimales para mostrar en los campos de texto. */
export function formatCoordinate(value: number): string {
  return value.toFixed(DISPLAY_DECIMALS)
}

/** Compara dos coordenadas (o `null`) por valor, no por referencia. */
export function coordinatesEqual(
  a: Coordinates | null,
  b: Coordinates | null,
): boolean {
  if (a === null || b === null) return a === b
  return a.lat === b.lat && a.lng === b.lng
}
