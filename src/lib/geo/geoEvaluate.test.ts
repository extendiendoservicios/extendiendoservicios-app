import { describe, expect, it } from 'vitest'
import { geoEvaluate, haversineDistanceM } from './geoEvaluate'
import { formatGeoStatusText } from './geoStatusText'

/**
 * Mismos casos que los tests pgTAP de `geo_evaluate` (P22.1): bordes de
 * radio + precisión, precisión 150 contra 151 y sede sin coordenadas.
 */

const SITE = { lat: -34.6037, lng: -58.3816 }

/** Un punto `meters` metros al norte de la sede (1° de latitud = R·π/180 m). */
function northOfSite(meters: number) {
  const degPerMeter = 180 / (Math.PI * 6_371_008.8)
  return { lat: SITE.lat + meters * degPerMeter, lng: SITE.lng }
}

describe('haversineDistanceM', () => {
  it('da 0 para el mismo punto', () => {
    expect(haversineDistanceM(SITE, SITE)).toBe(0)
  })

  it('da la distancia esperada para 1000 m al norte', () => {
    expect(haversineDistanceM(northOfSite(1000), SITE)).toBeCloseTo(1000, 3)
  })
})

describe('geoEvaluate', () => {
  it('sin ubicación: sin validar por no_location', () => {
    expect(geoEvaluate({ position: null, site: SITE, radiusM: 150 })).toEqual({
      status: 'unvalidated',
      reason: 'no_location',
      distanceM: null,
    })
  })

  it('sede sin coordenadas: sin validar por site_without_coords', () => {
    const result = geoEvaluate({
      position: { ...SITE, accuracyM: 10 },
      site: null,
      radiusM: 150,
    })
    expect(result).toEqual({
      status: 'unvalidated',
      reason: 'site_without_coords',
      distanceM: null,
    })
  })

  it('sin ubicación gana sobre sede sin coordenadas', () => {
    expect(
      geoEvaluate({ position: null, site: null, radiusM: 150 }).reason,
    ).toBe('no_location')
  })

  it('en la sede misma: validado, distancia 0', () => {
    expect(
      geoEvaluate({
        position: { ...SITE, accuracyM: 5 },
        site: SITE,
        radiusM: 150,
      }),
    ).toEqual({ status: 'valid', distanceM: 0 })
  })

  it('justo en el borde (d = r + a): validado', () => {
    const position = { ...northOfSite(200), accuracyM: 50 }
    const d = haversineDistanceM(position, SITE)
    const result = geoEvaluate({ position, site: SITE, radiusM: d - 50 })
    expect(result.status).toBe('valid')
  })

  it('apenas pasado el borde (d > r + a): fuera de zona', () => {
    const position = { ...northOfSite(200), accuracyM: 50 }
    const d = haversineDistanceM(position, SITE)
    const result = geoEvaluate({ position, site: SITE, radiusM: d - 50 - 0.01 })
    expect(result.status).toBe('outside')
  })

  it('el círculo de precisión alcanza a tocar la sede: validado aunque el centro esté afuera', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(180), accuracyM: 40 },
      site: SITE,
      radiusM: 150,
    })
    expect(result).toEqual({ status: 'valid', distanceM: 180 })
  })

  it('lejos de la sede: fuera de zona con la distancia en metros enteros', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(350), accuracyM: 10 },
      site: SITE,
      radiusM: 150,
    })
    expect(result).toEqual({ status: 'outside', distanceM: 350 })
  })

  it('redondea la distancia a metro entero', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(100.6), accuracyM: 5 },
      site: SITE,
      radiusM: 150,
    })
    expect(result.distanceM).toBe(101)
  })

  it('precisión 150 (el tope): cuenta, validado', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(250), accuracyM: 150 },
      site: SITE,
      radiusM: 150,
    })
    expect(result.status).toBe('valid')
  })

  it('precisión 151 con círculos que se tocan: sin validar por low_accuracy', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(250), accuracyM: 151 },
      site: SITE,
      radiusM: 150,
    })
    expect(result).toEqual({
      status: 'unvalidated',
      reason: 'low_accuracy',
      distanceM: 250,
    })
  })

  it('precisión 151 con círculos que no se tocan: fuera de zona', () => {
    const result = geoEvaluate({
      position: { ...northOfSite(400), accuracyM: 151 },
      site: SITE,
      radiusM: 150,
    })
    expect(result.status).toBe('outside')
  })

  it('respeta un tope de precisión distinto', () => {
    const position = { ...northOfSite(100), accuracyM: 80 }
    expect(
      geoEvaluate({ position, site: SITE, radiusM: 150, maxAccuracyM: 100 })
        .status,
    ).toBe('valid')
    expect(
      geoEvaluate({ position, site: SITE, radiusM: 150, maxAccuracyM: 50 })
        .reason,
    ).toBe('low_accuracy')
  })
})

describe('formatGeoStatusText', () => {
  it('arma los textos de los imprimibles', () => {
    expect(formatGeoStatusText({ status: 'valid' })).toBe('Validado')
    expect(formatGeoStatusText({ status: 'outside', distanceM: 350 })).toBe(
      'Fuera de zona (350 m)',
    )
    expect(formatGeoStatusText({ status: 'outside', distanceM: 1250 })).toBe(
      'Fuera de zona (1,3 km)',
    )
    expect(
      formatGeoStatusText({ status: 'unvalidated', reason: 'no_location' }),
    ).toBe('Sin validar')
    expect(
      formatGeoStatusText({
        status: 'outside',
        distanceM: 350,
        corrected: true,
      }),
    ).toBe('Validado (corregido)')
  })

  it('puede incluir el motivo de «Sin validar»', () => {
    expect(
      formatGeoStatusText(
        { status: 'unvalidated', reason: 'low_accuracy' },
        { includeReason: true },
      ),
    ).toBe('Sin validar (precisión insuficiente)')
  })
})
