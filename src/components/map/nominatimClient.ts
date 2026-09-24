/**
 * Cliente de búsqueda de direcciones contra Nominatim (SITE-004, ADR-017)
 * para el botón "Buscar dirección" de `MapPicker`.
 *
 * ## Decisión sobre la política de uso de Nominatim, desde el navegador
 *
 * La política de uso de Nominatim (https://operations.osmfoundation.org/policies/nominatim/)
 * pide un `User-Agent` identificable y, si se puede, una forma de contacto.
 * Un `fetch` del navegador no puede fijar el header `User-Agent`: es uno de
 * los "forbidden request headers" de la spec de Fetch (lo pisa el propio
 * navegador con el suyo, cualquier valor que se le pase se ignora en
 * silencio). No hay forma de cumplir ese punto literal desde el cliente.
 *
 * En su lugar, esta app cumple el resto de la política de la forma que sí
 * está al alcance de un `fetch` de navegador:
 * - `Referer`: el navegador ya lo manda solo con el origen de la app
 *   (`Referrer-Policy: strict-origin-when-cross-origin` en `public/_headers`,
 *   INFRA-018), que es la señal identificable que Nominatim puede leer sin
 *   el `User-Agent`.
 * - `email`: se manda como parámetro de la URL (`NOMINATIM_CONTACT_EMAIL`
 *   más abajo) — es la alternativa que la propia política sugiere cuando no
 *   se puede mandar `User-Agent` con datos de contacto.
 * - Un pedido por acción del usuario: nada de autocompletar por tecla, solo
 *   el botón "Buscar dirección" (`MapPicker`, más abajo el límite de una
 *   consulta a la vez con `searchAddress`).
 * - Límite de 1 pedido por segundo: `RateLimiter` de este archivo, que
 *   además evita pedidos superpuestos.
 * - `countrycodes=ar`, `limit` bajo y `accept-language=es`: fijos en
 *   `buildSearchUrl`.
 *
 * Si en algún momento se necesita más volumen o cumplir el `User-Agent` al
 * pie de la letra, la alternativa es mover la búsqueda a un backend propio
 * (la Edge Function, por ejemplo) que sí pueda fijar ese header — fuera de
 * alcance de esta tarea, que es sobre el cliente.
 */

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

/** Dirección de contacto que manda la app como parámetro `email` (ver arriba). */
const NOMINATIM_CONTACT_EMAIL = 'extserviciosapp@gmail.com'

/** Mínimo de milisegundos entre dos pedidos a Nominatim desde esta app. */
const MIN_INTERVAL_MS = 1000

export interface NominatimResult {
  lat: number
  lng: number
  /** Nombre completo de la dirección tal como lo devuelve Nominatim. */
  displayName: string
}

export class NominatimRateLimitError extends Error {
  constructor() {
    super(
      'Esperá un momento antes de volver a buscar (máximo un pedido por segundo).',
    )
    this.name = 'NominatimRateLimitError'
  }
}

/**
 * Limitador simple: memoriza el momento del último pedido permitido y
 * rechaza cualquier intento posterior antes de que pase `minIntervalMs`.
 * Recibe el reloj como parámetro para poder testearlo sin `setTimeout` real.
 */
export class RateLimiter {
  private lastCallAt = -Infinity
  private readonly minIntervalMs: number

  constructor(minIntervalMs: number = MIN_INTERVAL_MS) {
    this.minIntervalMs = minIntervalMs
  }

  /** Tira `NominatimRateLimitError` si todavía no pasó `minIntervalMs` desde el último pedido permitido. */
  check(now: () => number = Date.now): void {
    const current = now()
    if (current - this.lastCallAt < this.minIntervalMs) {
      throw new NominatimRateLimitError()
    }
    this.lastCallAt = current
  }
}

function buildSearchUrl(query: string, limit: number): string {
  const url = new URL(NOMINATIM_SEARCH_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('countrycodes', 'ar')
  url.searchParams.set('accept-language', 'es')
  url.searchParams.set('email', NOMINATIM_CONTACT_EMAIL)
  return url.toString()
}

interface NominatimApiResult {
  lat: string
  lon: string
  display_name: string
}

/**
 * Busca una dirección en Nominatim. Tira `NominatimRateLimitError` si se
 * llama antes de que pase un segundo desde el pedido anterior (el
 * `RateLimiter` se pasa desde afuera para compartir un único límite entre
 * varias instancias de `MapPicker` si hiciera falta, y para poder testearlo
 * con un reloj simulado).
 */
export async function searchAddress(
  query: string,
  {
    limiter,
    limit = 5,
    fetchImpl = fetch,
  }: { limiter: RateLimiter; limit?: number; fetchImpl?: typeof fetch },
): Promise<NominatimResult[]> {
  const trimmed = query.trim()
  if (trimmed === '') return []

  limiter.check()

  const response = await fetchImpl(buildSearchUrl(trimmed, limit), {
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error('No se pudo consultar Nominatim. Probá de nuevo.')
  }

  const data = (await response.json()) as NominatimApiResult[]

  return data
    .map((item) => ({
      lat: Number(item.lat),
      lng: Number(item.lon),
      displayName: item.display_name,
    }))
    .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng))
}
