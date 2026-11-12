/**
 * Detección de iPhone/iPad y de qué navegador usa (OF-09, P28.2).
 *
 * En iOS la app solo se puede agregar a la pantalla de inicio desde Safari
 * (Compartir → Agregar a pantalla de inicio). Chrome, Firefox, Edge y los
 * navegadores embebidos de WhatsApp, Instagram o Facebook no lo permiten.
 */
export type IosInstallMode =
  /** No es un dispositivo iOS. */
  | 'not-ios'
  /** iOS con Safari: se pueden mostrar los pasos para instalar. */
  | 'safari'
  /** iOS con otro navegador o navegador embebido: hay que abrir en Safari. */
  | 'other-browser'

const OTHER_BROWSER_TOKENS =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Twitter|Snapchat|MicroMessenger|LinkedInApp|Pinterest|TikTok|musical_ly/i

export function detectIosInstallMode(
  userAgent: string,
  platform = '',
  maxTouchPoints = 0,
): IosInstallMode {
  const isIphoneOrIpod = /iPhone|iPod/i.test(userAgent)
  const isIpad = /iPad/i.test(userAgent)
  // iPadOS 13+ se presenta como Mac de escritorio, pero con pantalla táctil.
  const isIpadAsMac =
    /MacIntel|Macintosh/i.test(platform || userAgent) && maxTouchPoints > 1
  if (!isIphoneOrIpod && !isIpad && !isIpadAsMac) return 'not-ios'

  if (OTHER_BROWSER_TOKENS.test(userAgent)) return 'other-browser'
  // Safari real trae "Version/x" y "Safari/x"; los navegadores embebidos
  // (WhatsApp, etc.) suelen omitir el token "Safari".
  if (/Version\/[\d.]+/.test(userAgent) && /Safari\//.test(userAgent)) {
    return 'safari'
  }
  return 'other-browser'
}

export function currentIosInstallMode(): IosInstallMode {
  return detectIosInstallMode(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  )
}
