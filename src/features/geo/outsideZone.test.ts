import { describe, expect, it } from 'vitest'
import type { AttendanceGeo } from '@/api/attendance'
import {
  filterOutsideZone,
  hasOutsideZone,
  isGeoOutside,
  timeCorrectedSuffix,
} from './outsideZone'

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

describe('isGeoOutside', () => {
  it('solo el rojo sin corregir cuenta', () => {
    expect(isGeoOutside(geo({ status: 'outside' }))).toBe(true)
    expect(isGeoOutside(geo({ status: 'outside', overridden: true }))).toBe(
      false,
    )
    expect(isGeoOutside(geo({ status: 'valid' }))).toBe(false)
    expect(isGeoOutside(geo({ status: 'unvalidated' }))).toBe(false)
    expect(isGeoOutside(null)).toBe(false)
    expect(isGeoOutside(undefined)).toBe(false)
  })
})

describe('filtro «Solo fuera de zona» (B-20)', () => {
  const rows = [
    { id: 'ok', checkInGeo: geo(), checkOutGeo: geo() },
    {
      id: 'inicio-rojo',
      checkInGeo: geo({ status: 'outside' }),
      checkOutGeo: null,
    },
    {
      id: 'fin-rojo',
      checkInGeo: geo(),
      checkOutGeo: geo({ status: 'outside' }),
    },
    {
      id: 'corregido',
      checkInGeo: geo({ status: 'outside', overridden: true }),
      checkOutGeo: null,
    },
    {
      id: 'gris',
      checkInGeo: geo({ status: 'unvalidated' }),
      checkOutGeo: null,
    },
    { id: 'sin-fichaje', checkInGeo: null, checkOutGeo: null },
    { id: 'sin-datos' },
  ]

  it('apagado deja todo', () => {
    expect(filterOutsideZone(rows, false)).toHaveLength(rows.length)
  })

  it('encendido deja solo los que tienen inicio o fin fuera de zona sin corregir', () => {
    expect(filterOutsideZone(rows, true).map((row) => row.id)).toEqual([
      'inicio-rojo',
      'fin-rojo',
    ])
  })

  it('hasOutsideZone mira inicio y fin', () => {
    expect(hasOutsideZone(rows[1]!)).toBe(true)
    expect(hasOutsideZone(rows[0]!)).toBe(false)
  })
})

describe('timeCorrectedSuffix (B-28)', () => {
  it('agrega la marca solo si la hora fue corregida', () => {
    expect(timeCorrectedSuffix(geo({ timeCorrected: true }))).toBe(
      ' · Corregido',
    )
    expect(timeCorrectedSuffix(geo())).toBe('')
    expect(timeCorrectedSuffix(null)).toBe('')
  })
})
