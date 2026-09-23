/**
 * `ApiError` (P07.2, patrón de `src/api/` para todos los dominios, ver
 * `src/api/README.md`): único tipo de error que sale de un módulo de
 * `src/api/`, sin importar si vino de una RPC, de una tabla por PostgREST o
 * de la Edge Function `admin-users`.
 *
 * - `message`: siempre en español. Si el error vino de una RPC propia, es
 *   el texto que armó el servidor (`06_API.md`: "el cliente muestra
 *   `message`"); si vino crudo de Postgres, lo traduce `fromPostgrestError`.
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
 * de `supabase-js`) a `ApiError`.
 *
 * Nuestras RPC y triggers cortan con `raise exception using errcode =
 * 'P0001', message = '...', hint = 'CODIGO'` (`06_API.md` sección 0): el
 * `message` ya está en español y el `hint` es un código estable en
 * mayúsculas. Ese caso pasa tal cual.
 *
 * Todo lo demás (una restricción que salta en un insert o update directo por
 * PostgREST, un permiso denegado por RLS, un error de PostgREST) trae el texto
 * crudo de Postgres, en inglés. Ese texto nunca llega a la pantalla: se
 * traduce por código y, si el código no se conoce, se usa un mensaje genérico.
 * Revisión del orquestador en P07.3 (23 sep 2026).
 */
export function fromPostgrestError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.hint && DOMAIN_HINT.test(error.hint)) {
    return new ApiError(error.message, error.hint)
  }
  const known = error.code ? POSTGRES_CODES[error.code] : undefined
  if (known) {
    return new ApiError(known.message, known.hint)
  }
  return new ApiError(UNKNOWN_ERROR_MESSAGE, null)
}

/** Códigos estables propios: `FORBIDDEN`, `LAST_OWNER`, `SHIFT_OVERLAP`… */
const DOMAIN_HINT = /^[A-Z][A-Z0-9_]*$/

/** Errores de Postgres y PostgREST que pueden llegar sin pasar por una RPC. */
const POSTGRES_CODES: Record<string, { message: string; hint: string }> = {
  '23505': {
    message: 'Ya existe un registro con esos datos.',
    hint: 'DUPLICATE',
  },
  '23514': {
    message:
      'Algún dato no tiene el formato esperado. Revisalo y probá de nuevo.',
    hint: 'VALIDATION_ERROR',
  },
  '23502': {
    message: 'Falta completar un dato obligatorio.',
    hint: 'VALIDATION_ERROR',
  },
  '23503': {
    message:
      'El dato hace referencia a algo que no existe o ya no está disponible.',
    hint: 'VALIDATION_ERROR',
  },
  '42501': {
    message: 'No tenés permiso para hacer esto.',
    hint: 'FORBIDDEN',
  },
  PGRST301: {
    message: 'Tu sesión venció. Volvé a iniciar sesión.',
    hint: 'UNAUTHENTICATED',
  },
}

/** Mensaje genérico para un error que no pudo identificarse (red caída, etc.). */
export const UNKNOWN_ERROR_MESSAGE =
  'Ocurrió un error inesperado. Probá de nuevo en un momento.'
