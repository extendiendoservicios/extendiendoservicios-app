import { describe, expect, it } from 'vitest'
import {
  buildLiveGeoView,
  outsideReasonToSend,
  secondsLeft,
  OUTSIDE_REASON_MAX_LENGTH,
  type LiveGeoInput,
} from './liveGeo'

/**
 * Armado del fichaje en vivo (módulo B1, B-04, B-06, B-18): estado del mini
 * mapa, precisión, «Esperar mejor señal» y campo del motivo. La sede de los
 * casos es la de los tests de `geoEvaluate` (-34.6037, -58.3816).
 */
const SITE = { lat: -34.6037, lng: -58.3816 }

function input(overrides: Partial<LiveGeoInput> = {}): LiveGeoInput {
  return {
    enabled: true,
    state: 'ready',
    position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 10 },
    site: SITE,
    radiusM: 150,
    maxAccuracyM: 150,
    wait: 'idle',
    ...overrides,
  }
}

describe('buildLiveGeoView', () => {
  it('dentro de la sede: círculo verde, sin motivo y sin espera', () => {
    const view = buildLiveGeoView(input())
    expect(view.mapStatus).toBe('valid')
    expect(view.evaluation?.distanceM).toBe(0)
    expect(view.showOutsideReason).toBe(false)
    expect(view.canOfferWait).toBe(false)
    expect(view.poorSignal).toBe(false)
    expect(view.accuracyLabel).toBe('Precisión: 10 m')
    expect(view.message?.text).toBe('Estás dentro de la zona del servicio.')
    expect(view.coords).toEqual({ lat: SITE.lat, lng: SITE.lng, accuracyM: 10 })
  })

  it('fuera de la zona: círculo rojo y se pide el motivo opcional', () => {
    const view = buildLiveGeoView(
      input({
        position: { lat: -34.5937, lng: SITE.lng, accuracyM: 20 },
      }),
    )
    expect(view.mapStatus).toBe('outside')
    expect(view.evaluation?.distanceM).toBe(1112)
    expect(view.showOutsideReason).toBe(true)
    expect(view.message?.tone).toBe('warn')
  })

  it('el círculo de precisión que toca la sede cuenta como dentro (B-06)', () => {
    // 111 m de distancia, radio 100 y precisión 11,2: se tocan.
    const view = buildLiveGeoView(
      input({
        radiusM: 100,
        position: { lat: -34.6027, lng: SITE.lng, accuracyM: 11.2 },
      }),
    )
    expect(view.mapStatus).toBe('valid')
    expect(view.showOutsideReason).toBe(false)
  })

  it('precisión peor que el radio: ofrece «Esperar mejor señal» y el botón pasa a «Fichar igual»', () => {
    const view = buildLiveGeoView(
      input({
        state: 'improving',
        radiusM: 100,
        position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 180 },
      }),
    )
    expect(view.canOfferWait).toBe(true)
    expect(view.waiting).toBe(false)
    expect(view.poorSignal).toBe(true)
    // Con 180 m (> tope de 150) y los círculos tocándose queda gris.
    expect(view.mapStatus).toBe('unvalidated')
    expect(view.evaluation?.reason).toBe('low_accuracy')
  })

  it('mientras corre la espera ya no la ofrece y avisa que está esperando', () => {
    const view = buildLiveGeoView(
      input({
        state: 'improving',
        radiusM: 100,
        wait: 'running',
        position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 180 },
      }),
    )
    expect(view.canOfferWait).toBe(false)
    expect(view.waiting).toBe(true)
  })

  it('vencida la espera con la precisión todavía mala: avisa y no la ofrece de nuevo', () => {
    const view = buildLiveGeoView(
      input({
        state: 'improving',
        radiusM: 100,
        wait: 'expired',
        position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 180 },
      }),
    )
    expect(view.canOfferWait).toBe(false)
    expect(view.waiting).toBe(false)
    expect(view.waitExpired).toBe(true)
  })

  it('si la precisión mejora hasta el radio ya no hay nada que esperar', () => {
    const view = buildLiveGeoView(
      input({
        radiusM: 100,
        wait: 'running',
        position: { lat: SITE.lat, lng: SITE.lng, accuracyM: 60 },
      }),
    )
    expect(view.canOfferWait).toBe(false)
    expect(view.waiting).toBe(false)
    expect(view.waitExpired).toBe(false)
  })

  it('sin posición todavía: círculo gris, mensaje de búsqueda y sin coordenadas', () => {
    const view = buildLiveGeoView(input({ state: 'waiting', position: null }))
    expect(view.evaluation).toBeNull()
    expect(view.mapStatus).toBeNull()
    expect(view.accuracyLabel).toBeNull()
    expect(view.message?.text).toBe('Buscando tu ubicación…')
    // Todavía no hay lectura: el botón conserva su texto normal.
    expect(view.poorSignal).toBe(false)
    expect(view.coords).toBeNull()
  })

  it('sin consentimiento no usa la posición aunque haya una lectura', () => {
    const view = buildLiveGeoView(input({ enabled: false, state: 'idle' }))
    expect(view.enabled).toBe(false)
    expect(view.coords).toBeNull()
    expect(view.mapStatus).toBeNull()
    expect(view.canOfferWait).toBe(false)
    expect(view.poorSignal).toBe(false)
    expect(view.message?.text).toMatch(/queda sin validar/)
  })

  it('permiso denegado: avisa y deja fichar sin coordenadas', () => {
    const view = buildLiveGeoView(input({ state: 'denied', position: null }))
    expect(view.coords).toBeNull()
    expect(view.poorSignal).toBe(false)
    expect(view.message?.tone).toBe('warn')
    expect(view.message?.text).toMatch(/permiso/)
  })

  it('sin señal (sin lectura): avisa y deja fichar sin coordenadas', () => {
    const view = buildLiveGeoView(
      input({ state: 'unavailable', position: null }),
    )
    expect(view.coords).toBeNull()
    expect(view.message?.text).toMatch(/No pudimos obtener tu ubicación/)
  })

  it('sede sin coordenadas: sin mapa, aviso y resultado gris «site_without_coords»', () => {
    const view = buildLiveGeoView(input({ site: null }))
    expect(view.hasSite).toBe(false)
    expect(view.evaluation?.status).toBe('unvalidated')
    expect(view.evaluation?.reason).toBe('site_without_coords')
    expect(view.poorSignal).toBe(false)
    expect(view.message?.text).toMatch(/no tiene ubicación cargada/)
    // La posición igual se manda: la base guarda lo que recibe.
    expect(view.coords).not.toBeNull()
  })

  it('usa el radio general y el tope por omisión si la vista no los trae', () => {
    const view = buildLiveGeoView(input({ radiusM: null, maxAccuracyM: null }))
    expect(view.radiusM).toBe(150)
    expect(view.mapStatus).toBe('valid')
  })
})

describe('outsideReasonToSend', () => {
  it('manda el motivo recortado solo si el resultado en vivo es «Fuera de zona»', () => {
    expect(
      outsideReasonToSend({ showOutsideReason: true }, '  sin GPS  '),
    ).toBe('sin GPS')
    expect(
      outsideReasonToSend({ showOutsideReason: false }, 'sin GPS'),
    ).toBeNull()
  })

  it('un motivo vacío o en blanco no se manda', () => {
    expect(outsideReasonToSend({ showOutsideReason: true }, '   ')).toBeNull()
  })

  it('no pasa de 300 caracteres', () => {
    const long = 'a'.repeat(OUTSIDE_REASON_MAX_LENGTH + 20)
    expect(outsideReasonToSend({ showOutsideReason: true }, long)).toHaveLength(
      OUTSIDE_REASON_MAX_LENGTH,
    )
  })
})

describe('secondsLeft', () => {
  it('redondea hacia arriba y no baja de cero', () => {
    expect(secondsLeft(30_000)).toBe(30)
    expect(secondsLeft(29_100)).toBe(30)
    expect(secondsLeft(900)).toBe(1)
    expect(secondsLeft(0)).toBe(0)
    expect(secondsLeft(-5)).toBe(0)
  })
})
