/**
 * Enlace universal a la app de mapas del dispositivo (SITE-010, EMP-04 y
 * SUP-03 los usan desde `front-movil`: "dirección, enlace a mapas del
 * teléfono"). Un link `https://www.google.com/maps/...` en vez de un URI
 * `geo:` (mencionado en `05_Pantallas_y_Navegacion.md`) porque `geo:` no lo
 * entienden los navegadores de escritorio ni Safari/iOS sin la app de Google
 * Maps instalada; el link web lo abren todos los navegadores y, en el
 * celular, deja elegir la app de mapas instalada (Google Maps, Apple Maps
 * vía redirección, etc.) igual que pide la pantalla.
 */
export function buildMapsUrl(input: {
  latitude: number | null
  longitude: number | null
  address: string
  city: string | null
}): string {
  if (input.latitude != null && input.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`
  }
  const query = input.city ? `${input.address}, ${input.city}` : input.address
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
