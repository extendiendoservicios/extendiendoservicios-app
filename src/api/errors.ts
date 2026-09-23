import type { PostgrestError } from '@supabase/supabase-js'

/**
 * `ApiError` (P07.2, patrón de `src/api/` para todos los dominios, ver
 * `src/api/README.md`): único tipo de error que sale de un módulo de
 * `src/api/`, sin importar si vino de una RPC, de una tabla por PostgREST o
 * de la Edge Function `admin-users`.
 *
 * - `message`: el texto en español que ya viene armado del servidor
 *   (`06_API.md`: "el cliente muestra `message`"). Nunca se reescribe acá.
 * - `hint`: el código estable (`SHIFT_OVERLAP`, `LAST_OWNER`, `RATE_LIMITED`,
 *   etc. — `06` sección 15 y el `hint` propio de cada Edge Function) que usa
 *   la pantalla para decidir lógica (por ejemplo, deshabilitar un botón en
 *   vez de solo mostrar el error). `null` cuando el error no vino con uno
 *   (una excepción de red, por ejemplo) — la pantalla igual puede mostrar
 *   `message`.
 */
export class ApiError extends Error {
  readonly hint: string | null

  constructor(message: string, hint: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.hint = hint
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * Traduce un `PostgrestError` (el que devuelven `.from(...)` y `.rpc(...)`
 * de `supabase-js` cuando la RPC corta con `raise exception using errcode =
 * 'P0001', message = '...', hint = '...'`, `06_API.md` sección 0) a
 * `ApiError`. El `message` de Postgres YA está en español rioplatense (lo
 * escribe la propia RPC): no hace falta ningún mapeo de texto acá, solo
 * envolverlo.
 */
export function fromPostgrestError(error: PostgrestError): ApiError {
  return new ApiError(error.message, error.hint || null)
}

/** Mensaje genérico para un error que no pudo identificarse (red caída, etc.). */
export const UNKNOWN_ERROR_MESSAGE =
  'Ocurrió un error inesperado. Probá de nuevo en un momento.'
