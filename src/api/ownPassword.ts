import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { ApiError, UNKNOWN_ERROR_MESSAGE } from './errors'

/**
 * `src/api/ownPassword.ts` (P26.3, CR-04/CR-13): cambio de la PROPIA
 * contraseña a través de la Edge Function `admin-users`, acción
 * `change_own_password`. La función cambia Auth y la copia cifrada a la
 * vez; si falla, no cambia nada. Por eso nunca se llama a
 * `supabase.auth.updateUser({ password })`: dejaría Auth y la copia
 * distintas.
 *
 * `supabase.functions.invoke` manda solo el `Authorization` de la sesión
 * vigente. Sirve tanto para la sesión normal (`origin: 'profile'`) como
 * para la que abre el enlace del correo de recuperación (`'recovery'`, un
 * JWT común). El patrón de errores es el de `invokeAdminUsers`
 * (`users.ts`), que no se modifica.
 */
export type OwnPasswordOrigin = 'profile' | 'recovery'

interface ErrorPayload {
  error?: { message?: string; hint?: string }
}

const SERVICE_UNAVAILABLE_MESSAGE =
  'Por el momento no se puede cambiar la contraseña. Avisale a la administración.'

/** Traduce el `hint` de la función a un mensaje para la persona. */
function messageFor(hint: string | null, serverMessage: string | null): string {
  switch (hint) {
    case 'VALIDATION_ERROR':
      // La función ya devuelve el motivo en español (largo, origen, débil,
      // igual a la actual): se muestra tal cual.
      return (
        serverMessage ?? 'La contraseña nueva no es válida. Probá con otra.'
      )
    case 'CREDENTIALS_NOT_CONFIGURED':
      return SERVICE_UNAVAILABLE_MESSAGE
    case 'UNAUTHENTICATED':
      return 'Tu sesión venció. Volvé a iniciar sesión o pedí un enlace nuevo.'
    case 'FORBIDDEN':
      return 'No tenés permiso para cambiar esta contraseña.'
    default:
      return 'No pudimos guardar la contraseña. Probá de nuevo en un momento.'
  }
}

/**
 * Cambia la contraseña de la persona con sesión. Lanza `ApiError` (con
 * mensaje listo para mostrar) si la función rechaza el pedido o no
 * responde; en ese caso la contraseña NO cambió (CR-13).
 */
export async function changeOwnPassword(
  newPassword: string,
  origin: OwnPasswordOrigin,
): Promise<void> {
  const { data, error } = (await supabase.functions.invoke<
    { data: { profile_id: string } } | ErrorPayload
  >('admin-users', {
    body: {
      action: 'change_own_password',
      new_password: newPassword,
      origin,
    },
  })) as { data: ({ data: unknown } | ErrorPayload) | null; error: unknown }

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      const payload = (await response
        .json()
        .catch(() => null)) as ErrorPayload | null
      if (payload?.error) {
        const hint = payload.error.hint ?? null
        throw new ApiError(
          messageFor(hint, payload.error.message ?? null),
          hint,
        )
      }
    }
    throw new ApiError(UNKNOWN_ERROR_MESSAGE)
  }

  if (data && 'error' in data && data.error) {
    const hint = data.error.hint ?? null
    throw new ApiError(messageFor(hint, data.error.message ?? null), hint)
  }
}
