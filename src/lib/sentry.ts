import * as Sentry from '@sentry/react'
import { APP_VERSION } from '@/lib/appVersion'

/**
 * Inicializa Sentry (INFRA-021, `03_Plan_Maestro_Tecnico.md` secciones 3.3 y 3.8) solo si hay
 * `VITE_SENTRY_DSN` configurado. En local, sin esa variable, no se inicializa nada: cero
 * llamadas de red y cero overhead en desarrollo (ver test).
 *
 * Sin Session Replay ni tracing de rendimiento: no se agregan las integraciones
 * `browserTracingIntegration` ni `replayIntegration`, y no se declara `tracesSampleRate` (queda
 * deshabilitado por omisión). El plan (03 sección 3.8) pide solo captura de errores del
 * frontend; la captura automática de errores no manejados y promesas rechazadas ya viene
 * incluida en las integraciones por omisión del SDK, sin nada adicional que agregar acá.
 *
 * `sendDefaultPii: false` explícito: nunca se manda información personal identificable (cookies,
 * IP, headers) además de los datos propios del error (03 sección 15, datos personales).
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) {
    return
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_APP_ENV,
    release: APP_VERSION,
    sendDefaultPii: false,
  })
}
