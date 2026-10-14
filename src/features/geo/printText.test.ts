import { describe, expect, it } from 'vitest'
import type { AttendanceGeo } from '@/api/attendance'
import { geoPrintText } from './printText'
import { describeSiteRadius, effectiveSiteRadiusM } from './radius'
import { canEditGeofenceRadius, canMarkGeoAsValid } from './permissions'

function geo(overrides: Partial<AttendanceGeo> = {}): AttendanceGeo {
  return {
    recordId: 'r1',
    status: 'valid',
    reason: null,
    distanceM: 10,
    radiusM: 150,
    accuracyM: 12,
    outsideReason: null,
    overridden: false,
    timeCorrected: false,
    ...overrides,
  }
}

describe('geoPrintText (B-20, sin coordenadas)', () => {
  it('sin fichajes, un guion', () => {
    expect(geoPrintText(null, null)).toBe('—')
    expect(geoPrintText(undefined, undefined)).toBe('—')
  })

  it('«Validado», «Fuera de zona (350 m)» y «Sin validar»', () => {
    expect(geoPrintText(geo(), null)).toBe('Validado')
    expect(geoPrintText(geo({ status: 'outside', distanceM: 350 }), null)).toBe(
      'Fuera de zona (350 m)',
    )
    expect(
      geoPrintText(geo({ status: 'unvalidated', reason: 'no_location' }), null),
    ).toBe('Sin validar')
  })

  it('un fichaje corregido por la administración se imprime «Validado (corregido)»', () => {
    expect(
      geoPrintText(geo({ status: 'outside', overridden: true }), null),
    ).toBe('Validado (corregido)')
  })

  it('si inicio y fin dan lo mismo se escribe una sola vez; si no, se separan', () => {
    expect(geoPrintText(geo(), geo())).toBe('Validado')
    expect(
      geoPrintText(geo(), geo({ status: 'outside', distanceM: 350 })),
    ).toBe('Inicio: Validado · Fin: Fuera de zona (350 m)')
    expect(geoPrintText(null, geo({ status: 'outside', distanceM: 80 }))).toBe(
      'Fin: Fuera de zona (80 m)',
    )
  })

  it('nunca incluye coordenadas', () => {
    const text = geoPrintText(
      geo({ status: 'outside', distanceM: 1500 }),
      geo({ status: 'unvalidated', reason: 'low_accuracy' }),
    )
    expect(text).not.toMatch(/-?\d+\.\d{3,}/)
    expect(text).toBe('Inicio: Fuera de zona (1,5 km) · Fin: Sin validar')
  })
})

describe('radio vigente de una sede (B-02)', () => {
  it('el propio gana al general; sin ninguno, 150 m', () => {
    expect(effectiveSiteRadiusM(300, 100)).toBe(300)
    expect(effectiveSiteRadiusM(null, 100)).toBe(100)
    expect(effectiveSiteRadiusM(null, undefined)).toBe(150)
  })

  it('describe si es propio o general', () => {
    expect(describeSiteRadius(300, 100)).toBe('300 m (propio)')
    expect(describeSiteRadius(null, 100)).toBe('100 m (general)')
  })
})

describe('permisos del módulo B1', () => {
  it('«Marcar como válido» solo con rojo o gris y sin corrección previa (B-09)', () => {
    expect(canMarkGeoAsValid(geo({ status: 'outside' }))).toBe(true)
    expect(canMarkGeoAsValid(geo({ status: 'unvalidated' }))).toBe(true)
    expect(canMarkGeoAsValid(geo({ status: 'valid' }))).toBe(false)
    expect(
      canMarkGeoAsValid(geo({ status: 'outside', overridden: true })),
    ).toBe(false)
    expect(canMarkGeoAsValid(null)).toBe(false)
  })

  it('el radio general lo editan dueño y administradores, no el resto', () => {
    expect(canEditGeofenceRadius({ roles: ['owner'] })).toBe(true)
    expect(canEditGeofenceRadius({ roles: ['admin'] })).toBe(true)
    expect(canEditGeofenceRadius({ roles: ['supervisor'] })).toBe(false)
    expect(canEditGeofenceRadius({ roles: ['employee'] })).toBe(false)
  })
})
