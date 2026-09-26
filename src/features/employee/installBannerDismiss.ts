/**
 * `src/features/employee/installBannerDismiss.ts` (COM-06, MOB-EMP-014,
 * `05` fila COM-06: "Banner discreto... la primera vez"). Recuerda en este
 * dispositivo que la persona cerró el banner de instalación, para que no
 * vuelva a aparecer en cada visita -- pero tampoco desaparezca para
 * siempre, por si cambia de opinión más adelante.
 *
 * Plazo de siete días antes de volver a ofrecerlo (decisión menor, el plan
 * no fija un número: bastante para no resultar insistente entre una visita
 * y la siguiente del mismo día o de la misma semana, corto para no
 * "perder" la oferta de instalar por meses si la persona solo la cerró
 * una vez sin pensarlo).
 */
const DISMISS_KEY = 'banner-instalacion-descartado-en'
const DISMISS_DAYS = 7

export function isInstallBannerDismissed(now: Date): boolean {
  try {
    const stored = window.localStorage.getItem(DISMISS_KEY)
    if (!stored) return false
    const dismissedAt = Number(stored)
    if (Number.isNaN(dismissedAt)) return false
    const elapsedMs = now.getTime() - dismissedAt
    return elapsedMs < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    // Sin almacenamiento (modo privado): se ofrece siempre, nunca se rompe.
    return false
  }
}

export function dismissInstallBanner(now: Date): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(now.getTime()))
  } catch {
    // Sin almacenamiento: se va a volver a mostrar la próxima vez, no pasa nada.
  }
}
