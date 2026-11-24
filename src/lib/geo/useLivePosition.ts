import * as React from 'react'
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  DEFAULT_WAIT_FOR_SIGNAL_MS,
} from './constants'
import type { GeoFix } from './geoEvaluate'

/**
 * `useLivePosition` (módulo B1, B-06, B-38): posición en vivo con
 * `watchPosition` para fichar. Reemplaza la lectura única de
 * `getCurrentPositionSafe` en las pantallas de fichaje (P22.3). Nunca lanza:
 * sin API, sin permiso o sin señal el estado lo dice y el fichaje sigue
 * pudiendo hacerse sin ubicación (B-05).
 *
 * Estados:
 * - `idle`: `enabled` es falso (sin consentimiento): no se pide nada;
 * - `waiting`: se pidió la ubicación y todavía no llegó ninguna lectura;
 * - `improving`: hay lectura, pero la precisión es peor que `targetAccuracyM`;
 * - `ready`: la mejor precisión ya es `<= targetAccuracyM`;
 * - `denied`: la persona negó el permiso;
 * - `unavailable`: sin API, sin señal o el sensor falló y no hay ninguna lectura.
 */
export type LivePositionState =
  'idle' | 'waiting' | 'improving' | 'ready' | 'denied' | 'unavailable'

/** Estado de «Esperar mejor señal»: `idle` (no se pidió), `running` (corre), `expired` (venció). */
export type SignalWaitState = 'idle' | 'running' | 'expired'

export interface LivePosition extends GeoFix {
  /** Marca de tiempo de la lectura (ms desde 1970, la que informa el navegador). */
  timestamp: number
}

export interface LivePositionOptions {
  /** `false` = no pide nada (por ejemplo, sin consentimiento). Por omisión, `true`. */
  enabled?: boolean
  /** Precisión que se considera «lista», en metros. Por omisión, el radio general (150 m). */
  targetAccuracyM?: number
  /** Duración de «Esperar mejor señal» en ms. Por omisión, 30 s (B-06). */
  waitMs?: number
}

export interface LivePositionResult {
  state: LivePositionState
  /** Mejor lectura vista (menor precisión; ante empate, la más nueva). Es la que se guarda al fichar. */
  position: LivePosition | null
  /** Última lectura recibida (puede ser peor que `position`). */
  latest: LivePosition | null
  /** Mejor precisión vista, en metros (atajo de `position?.accuracyM`). */
  accuracyM: number | null
  /** Milisegundos desde que se empezó a pedir la ubicación (se actualiza cada segundo). */
  elapsedMs: number
  /** Estado de «Esperar mejor señal». */
  wait: SignalWaitState
  /** Milisegundos que faltan de la espera (0 si no corre). */
  waitRemainingMs: number
  /** Arranca la espera. Si ya está corriendo o venció no la reinicia. */
  startWait: () => void
  /**
   * Código (`GeolocationPositionError.code`: 1, 2 o 3) del último error de la
   * API mientras no haya lectura; `null` si no hubo error o ya llegó una
   * posición. Sirve para el motivo técnico de `p_geo_reason` (D-14).
   */
  lastErrorCode: 1 | 2 | 3 | null
  /** Reinicia la búsqueda desde cero (botón «Reintentar», D-14). */
  retry: () => void
}

/** Si en este tiempo no llegó ninguna lectura de alta precisión, se pide también una de baja (D-14). */
export const LOW_ACCURACY_FALLBACK_MS = 8_000

const TICK_MS = 1000

export function useLivePosition(
  options: LivePositionOptions = {},
): LivePositionResult {
  const {
    enabled = true,
    targetAccuracyM = DEFAULT_GEOFENCE_RADIUS_M,
    waitMs = DEFAULT_WAIT_FOR_SIGNAL_MS,
  } = options

  const [best, setBest] = React.useState<LivePosition | null>(null)
  const [latest, setLatest] = React.useState<LivePosition | null>(null)
  const [failure, setFailure] = React.useState<'denied' | 'unavailable' | null>(
    null,
  )
  const [errorCode, setErrorCode] = React.useState<1 | 2 | 3 | null>(null)
  const [attempt, setAttempt] = React.useState(0)
  const [elapsedMs, setElapsedMs] = React.useState(0)
  const [now, setNow] = React.useState(0)
  const [waitStartedAt, setWaitStartedAt] = React.useState<number | null>(null)
  const [waitExpired, setWaitExpired] = React.useState(false)

  const supported = typeof navigator !== 'undefined' && !!navigator.geolocation

  // Pedido de ubicación: se arma y desarma con `enabled`. Al apagarse (o
  // desmontar) se limpia todo, así un nuevo `enabled` arranca de cero.
  React.useEffect(() => {
    if (!enabled || !supported) return
    const geolocation = navigator.geolocation
    const start = Date.now()
    let watchId: number | null = null
    let gotReading = false
    let denied = false
    const onReading = (pos: GeolocationPosition) => {
      gotReading = true
      const reading: LivePosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy,
        timestamp: pos.timestamp,
      }
      setFailure(null)
      setErrorCode(null)
      setLatest(reading)
      setBest((prev) =>
        !prev || reading.accuracyM <= prev.accuracyM ? reading : prev,
      )
    }
    const onError = (error: GeolocationPositionError) => {
      // 1 = PERMISSION_DENIED; 2 = POSITION_UNAVAILABLE; 3 = TIMEOUT.
      const code: 1 | 2 | 3 =
        error.code === 1 || error.code === 3 ? error.code : 2
      if (code === 1) denied = true
      // Un «sin permiso» no lo pisa un error posterior del respaldo.
      setErrorCode(denied ? 1 : code)
      setFailure(denied ? 'denied' : 'unavailable')
    }
    try {
      watchId = geolocation.watchPosition(onReading, onError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20_000,
      })
    } catch {
      watchId = null
      queueMicrotask(() => {
        setFailure('unavailable')
        setErrorCode(2)
      })
    }
    // Respaldo de baja precisión (D-14): si en ~8 s no llegó nada, se pide
    // además una lectura con `enableHighAccuracy: false` (Wi-Fi o antenas).
    const fallback = setTimeout(() => {
      if (gotReading || denied) return
      if (typeof geolocation.getCurrentPosition !== 'function') return
      try {
        geolocation.getCurrentPosition(onReading, onError, {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 20_000,
        })
      } catch {
        // Sin respaldo: sigue la búsqueda de alta precisión.
      }
    }, LOW_ACCURACY_FALLBACK_MS)
    // Reloj de `elapsedMs` y de la cuenta regresiva de la espera.
    const tick = setInterval(() => {
      const t = Date.now()
      setNow(t)
      setElapsedMs(t - start)
    }, TICK_MS)

    return () => {
      clearInterval(tick)
      clearTimeout(fallback)
      if (watchId !== null) geolocation.clearWatch(watchId)
      setBest(null)
      setLatest(null)
      setFailure(null)
      setErrorCode(null)
      setElapsedMs(0)
      setWaitStartedAt(null)
      setWaitExpired(false)
    }
  }, [enabled, supported, attempt])

  // Vencimiento exacto de «Esperar mejor señal».
  React.useEffect(() => {
    if (waitStartedAt === null) return
    const id = setTimeout(() => {
      setWaitExpired(true)
      setNow(Date.now())
    }, waitMs)
    return () => clearTimeout(id)
  }, [waitStartedAt, waitMs])

  const startWait = React.useCallback(() => {
    const t = Date.now()
    setNow(t)
    setWaitStartedAt((prev) => prev ?? t)
  }, [])

  const retry = React.useCallback(() => setAttempt((n) => n + 1), [])

  let state: LivePositionState
  if (!enabled) state = 'idle'
  else if (failure === 'denied') state = 'denied'
  else if (best)
    state = best.accuracyM <= targetAccuracyM ? 'ready' : 'improving'
  else if (failure === 'unavailable' || !supported) state = 'unavailable'
  else state = 'waiting'

  let wait: SignalWaitState = 'idle'
  if (enabled && waitStartedAt !== null && state !== 'ready') {
    wait = waitExpired ? 'expired' : 'running'
  }
  const waitRemainingMs =
    wait === 'running' && waitStartedAt !== null
      ? Math.min(waitMs, Math.max(0, waitMs - (now - waitStartedAt)))
      : 0

  return {
    state,
    position: enabled ? best : null,
    latest: enabled ? latest : null,
    accuracyM: enabled && best ? best.accuracyM : null,
    elapsedMs: enabled ? elapsedMs : 0,
    wait,
    waitRemainingMs,
    startWait,
    lastErrorCode: enabled && !best ? errorCode : null,
    retry,
  }
}
