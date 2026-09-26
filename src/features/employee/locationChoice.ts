/**
 * Recuerda en este dispositivo que la persona eligió "Continuar sin
 * ubicación" en el consentimiento (EMP-06). La base solo guarda el
 * consentimiento dado (`profiles.location_consent_at`); sin esta marca,
 * Fichar volvería a pedir el consentimiento en cada registro y quien no
 * acepta no podría registrar nunca, cuando P-091 dice que el registro
 * funciona igual si se niega. Puede dar el consentimiento más tarde desde
 * su perfil. Si el almacenamiento no está disponible (modo privado), se
 * vuelve a preguntar la próxima vez: nunca bloquea.
 */
const KEY_PREFIX = 'ubicacion-rechazada:'

export function hasDeclinedLocation(userId: string | null | undefined) {
  if (!userId) return false
  try {
    return window.localStorage.getItem(KEY_PREFIX + userId) === '1'
  } catch {
    return false
  }
}

export function rememberLocationDeclined(userId: string | null | undefined) {
  if (!userId) return
  try {
    window.localStorage.setItem(KEY_PREFIX + userId, '1')
  } catch {
    // Sin almacenamiento: se vuelve a preguntar la próxima vez.
  }
}
