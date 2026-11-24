import {
  DEFAULT_GEOFENCE_RADIUS_M,
  DEFAULT_MAX_ACCURACY_M,
  geoEvaluate,
  type GeoEvaluation,
  type GeoFix,
  type GeoPoint,
  type GeoTechnicalReason,
  type GeoStatus,
  type LivePositionState,
  type SignalWaitState,
} from '@/lib/geo'
import type { GeolocationCoords } from '@/lib/geolocation'

/**
 * Armado de lo que muestra el fichaje con ubicación en vivo (módulo B1,
 * B-04, B-06, B-18, B-37): puro y sin React, para probarlo con posiciones
 * simuladas. Lo usan EMP-05 (inicio), EMP-10 (fin) y SUP-04.
 *
 * Ojo: lo que se calcula acá solo sirve para pintar el mini mapa y decidir
 * qué se ofrece en pantalla. Lo que queda guardado (y lo que se muestra
 * después de fichar) es lo que calcula la base (B-37).
 */

/** Largo máximo del motivo de «fuera de zona» (B-04): más da `OUTSIDE_REASON_TOO_LONG`. */
export const OUTSIDE_REASON_MAX_LENGTH = 300

export interface LiveGeoInput {
  /** `false` = sin consentimiento: no se pide la ubicación y el fichaje queda gris. */
  enabled: boolean
  state: LivePositionState
  /** Mejor lectura del `useLivePosition` (la que se manda al fichar). */
  position: GeoFix | null
  /** Coordenadas de la sede; `null` = sede sin coordenadas. */
  site: GeoPoint | null
  /** Radio vigente de la sede; `null` usa el general por omisión. */
  radiusM: number | null | undefined
  /** Tope de precisión (B-23); `null` usa 150 m. */
  maxAccuracyM: number | null | undefined
  wait: SignalWaitState
  /** Celular de la persona, para la ayuda de ubicación (D-14). Por omisión, `other`. */
  device?: GeoDevice
}

/** Tipo de celular según el user agent (D-14). */
export type GeoDevice = 'android' | 'ios' | 'other'

/** Ayuda corta debajo del aviso de ubicación (D-14). */
export interface GeoHelp {
  intro: string
  steps: string[]
}

export type LiveGeoTone = 'info' | 'warn'

export interface LiveGeoView {
  /** Con consentimiento: se está pidiendo la ubicación. */
  enabled: boolean
  /** Radio efectivo usado en el cálculo. */
  radiusM: number
  /** Hay sede con coordenadas: se puede dibujar el mapa. */
  hasSite: boolean
  /** Resultado en vivo; `null` si todavía no hay posición. */
  evaluation: GeoEvaluation | null
  /** Color del círculo de la sede: verde, rojo o gris (`null` = gris, todavía sin posición). */
  mapStatus: GeoStatus | null
  /** «Precisión: 35 m», o `null` si todavía no hay lectura. */
  accuracyLabel: string | null
  /** Línea de estado para quien no ve el mapa (lectores de pantalla incluidos). */
  message: { tone: LiveGeoTone; text: string } | null
  /** Se ofrece «Esperar mejor señal» (precisión peor que el radio y todavía no se usó la espera). */
  canOfferWait: boolean
  /** La espera de «Esperar mejor señal» está corriendo. */
  waiting: boolean
  /** La espera venció y la precisión sigue siendo peor que el radio: se avisa que se puede fichar igual. */
  waitExpired: boolean
  /** Se pide el motivo opcional: el resultado en vivo es «Fuera de zona». */
  showOutsideReason: boolean
  /** Hay lectura pero es más imprecisa que el radio: el botón principal dice «Fichar igual». */
  poorSignal: boolean
  /** Se ofrece «Reintentar»: la búsqueda falló (sin señal o sin permiso). */
  showRetry: boolean
  /** Ayuda según el celular; `null` si no hay falla que explicar. */
  help: GeoHelp | null
  /** Lo que se manda a la RPC como posición (`null` = fichar sin coordenadas). */
  coords: GeolocationCoords | null
}

export function buildLiveGeoView(input: LiveGeoInput): LiveGeoView {
  const radiusM = input.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  const maxAccuracyM = input.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M
  const position = input.enabled ? input.position : null
  const hasSite = input.site != null

  const evaluation = position
    ? geoEvaluate({ position, site: input.site, radiusM, maxAccuracyM })
    : null

  const accuracyM = position?.accuracyM ?? null
  const accuracyLabel =
    accuracyM != null ? `Precisión: ${Math.round(accuracyM)} m` : null

  const tooImprecise = accuracyM != null && accuracyM > radiusM
  const canOfferWait = input.enabled && tooImprecise && input.wait === 'idle'
  const waiting = input.enabled && tooImprecise && input.wait === 'running'

  // Sin sede con coordenadas no hay nada que afinar ni que esperar.
  const poorSignal = input.enabled && hasSite && tooImprecise

  // Solo cuando el aviso es «No tenemos permiso…» o «No pudimos obtener…».
  const failed =
    input.enabled &&
    !position &&
    (input.state === 'denied' || (input.state === 'unavailable' && hasSite))

  return {
    enabled: input.enabled,
    radiusM,
    hasSite,
    evaluation,
    mapStatus: evaluation ? evaluation.status : null,
    accuracyLabel,
    message: buildMessage(input, evaluation, tooImprecise),
    canOfferWait,
    waiting,
    waitExpired: input.enabled && tooImprecise && input.wait === 'expired',
    showOutsideReason: evaluation?.status === 'outside',
    poorSignal,
    showRetry: failed,
    help: failed ? buildGeoHelp(input.state, input.device) : null,
    coords: position
      ? { lat: position.lat, lng: position.lng, accuracyM: position.accuracyM }
      : null,
  }
}

function buildMessage(
  input: LiveGeoInput,
  evaluation: GeoEvaluation | null,
  tooImprecise: boolean,
): LiveGeoView['message'] {
  if (!input.enabled) {
    return {
      tone: 'info',
      text: 'No vamos a usar tu ubicación. El registro se hace igual y queda sin validar.',
    }
  }
  if (input.state === 'denied') {
    return {
      tone: 'warn',
      text: 'No tenemos permiso para ver tu ubicación. Podés registrar igual: queda sin validar.',
    }
  }
  if (!input.site) {
    return {
      tone: 'info',
      text: 'Esta sede todavía no tiene ubicación cargada. El registro se hace igual y queda sin validar.',
    }
  }
  if (!evaluation) {
    if (input.state === 'unavailable') {
      return {
        tone: 'warn',
        text: 'No pudimos obtener tu ubicación. Podés registrar igual: queda sin validar.',
      }
    }
    return { tone: 'info', text: 'Buscando tu ubicación…' }
  }
  if (evaluation.status === 'valid') {
    return { tone: 'info', text: 'Estás dentro de la zona del servicio.' }
  }
  if (evaluation.status === 'outside') {
    return { tone: 'warn', text: 'Estás fuera de la zona del servicio.' }
  }
  return {
    tone: 'warn',
    text: tooImprecise
      ? 'La señal de ubicación es poco precisa para validar el registro.'
      : 'No pudimos validar tu ubicación.',
  }
}

/** Segundos que faltan de la espera, redondeados hacia arriba (cuenta regresiva). */
export function secondsLeft(waitRemainingMs: number): number {
  return Math.max(0, Math.ceil(waitRemainingMs / 1000))
}

/**
 * Motivo para mandar a la RPC: solo con el resultado en vivo «Fuera de zona»
 * y con texto. La base lo guarda únicamente si el resultado calculado por
 * ella también es «Fuera de zona» (si no, lo descarta).
 */
export function outsideReasonToSend(
  view: Pick<LiveGeoView, 'showOutsideReason'>,
  text: string,
): string | null {
  if (!view.showOutsideReason) return null
  const trimmed = text.trim()
  return trimmed ? trimmed.slice(0, OUTSIDE_REASON_MAX_LENGTH) : null
}

/** Detecta Android o iPhone por user agent (D-14). */
export function detectGeoDevice(userAgent: string): GeoDevice {
  if (/android/i.test(userAgent)) return 'android'
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  return 'other'
}

/** Ayuda para encender la ubicación (sin señal) o darle permiso (negada), según el celular (D-14). */
export function buildGeoHelp(
  state: LivePositionState,
  device: GeoDevice = 'other',
): GeoHelp | null {
  if (state === 'unavailable') {
    const intro = 'Revisá que la ubicación del teléfono esté encendida.'
    if (device === 'android') {
      return {
        intro,
        steps: ['Bajá la barra de accesos rápidos y tocá Ubicación.'],
      }
    }
    if (device === 'ios') {
      return {
        intro,
        steps: [
          'Ajustes › Privacidad › Localización: que esté activada.',
          'En Sitios web de Safari, elegí Al usar la app y dejá encendida Ubicación exacta.',
        ],
      }
    }
    return { intro, steps: [] }
  }
  if (state === 'denied') {
    const intro = 'Para validar el registro, permití la ubicación a este sitio.'
    if (device === 'android') {
      return {
        intro,
        steps: [
          'Tocá el candado junto a la dirección, entrá a Permisos y permití Ubicación.',
        ],
      }
    }
    if (device === 'ios') {
      return {
        intro,
        steps: [
          'Ajustes › Privacidad › Localización › Sitios web de Safari › Al usar la app.',
          'Dejá encendida Ubicación exacta.',
        ],
      }
    }
    return {
      intro,
      steps: [
        'Habilitá la ubicación para este sitio en la configuración del navegador.',
      ],
    }
  }
  return null
}

/** Motivo técnico de la falta de ubicación para `p_geo_reason` (D-14). */
export type GeoReasonToSend = GeoTechnicalReason

/**
 * Qué motivo mandar a la RPC cuando se ficha sin coordenadas (D-14): según el
 * último error de la API (1 sin permiso, 2 sin señal, 3 tiempo agotado); sin
 * error todavía, `timeout` (se fichó mientras se buscaba). Con coordenadas o
 * sin consentimiento (la persona eligió no compartir) no se manda nada: la
 * base deja `no_location`.
 */
export function geoReasonToSend(input: {
  enabled: boolean
  coords: GeolocationCoords | null
  lastErrorCode: 1 | 2 | 3 | null
}): GeoReasonToSend | null {
  if (!input.enabled || input.coords) return null
  switch (input.lastErrorCode) {
    case 1:
      return 'permission_denied'
    case 2:
      return 'position_unavailable'
    default:
      return 'timeout'
  }
}
