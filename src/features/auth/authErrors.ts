import type { AuthError } from '@supabase/supabase-js'

/**
 * Traducción al español rioplatense de los errores de `supabase.auth.*`
 * que puede ver una persona real en COM-01/COM-02/COM-03/COM-04
 * (AUTH-003/005/007). Un único lugar para esto, no una copia por pantalla.
 *
 * El caso importante (encargo P06.3, punto 1 de "tres cosas que quiero
 * remarcar"): un login fallido no puede delatar si el email existe.
 * Comprobado en vivo contra `App_dev` (no supuesto): `signInWithPassword`
 * devuelve exactamente el mismo `error.code` ('invalid_credentials',
 * mensaje "Invalid login credentials", 400) tanto para una contraseña
 * incorrecta de una cuenta real como para un email que no existe en
 * absoluto — Supabase Auth ya los unifica del lado del servidor, antes de
 * que este archivo entre en juego. Por eso `loginErrorMessage` tiene UN
 * solo texto para `invalid_credentials`, sin un caso aparte para "no
 * existe": agregar esa distinción acá inventaría una fuga que el propio
 * servidor no comete.
 */
export function loginErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'El email o la contraseña no son correctos.'
    case 'user_banned':
      // Todavía no existe la desactivación (F7, `06_API.md` sección 2.1):
      // este caso no puede pasar hoy contra el seed, pero el código ya
      // existe en `@supabase/auth-js` (`error-codes.ts`) y `banned_until`
      // es el mecanismo que va a usar `deactivate_user` — se traduce desde
      // ahora para no dejar un `default` genérico el día que exista.
      return 'Esta cuenta está desactivada. Comunicate con Administración.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Hiciste demasiados intentos. Esperá un momento y probá de nuevo.'
    case 'email_address_invalid':
      return 'Ese email no es válido.'
    default:
      return 'No pudimos iniciar sesión. Probá de nuevo en un momento.'
  }
}

/** COM-02: siempre el mismo texto, haya o no una cuenta con ese email (ver `ForgotPasswordPage`). */
export const FORGOT_PASSWORD_CONFIRMATION =
  'Si ese email tiene una cuenta, te mandamos un correo con instrucciones para restablecer la contraseña.'

/** COM-03/COM-04: `auth.updateUser({ password })`. */
export function updatePasswordErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'same_password':
      return 'La contraseña nueva tiene que ser distinta de la actual.'
    case 'weak_password':
      return 'Esa contraseña es demasiado simple. Probá con otra.'
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return 'El enlace venció o ya se usó. Pedí uno nuevo desde "Olvidé mi contraseña".'
    default:
      return 'No pudimos guardar la contraseña. Probá de nuevo en un momento.'
  }
}
