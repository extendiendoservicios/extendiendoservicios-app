import { describe, expect, it } from 'vitest'
import {
  correctTimeSchema,
  generalRadiusSchema,
  isValidRadiusText,
  overrideGeoSchema,
  radiusTextToValue,
  RADIUS_RANGE_MESSAGE,
  siteRadiusFieldSchema,
} from './schemas'
import { siteFormSchema, siteFormValuesToInput } from '@/features/sites/schemas'

describe('isValidRadiusText', () => {
  it.each(['50', '150', '1000', ' 300 '])('acepta %s', (text) => {
    expect(isValidRadiusText(text)).toBe(true)
  })

  it.each(['49', '1001', '0', '', 'abc', '12.5', '-100', '1e3'])(
    'rechaza %s',
    (text) => {
      expect(isValidRadiusText(text)).toBe(false)
    },
  )
})

describe('generalRadiusSchema (B-02)', () => {
  it('acepta un radio entero entre 50 y 1000', () => {
    expect(generalRadiusSchema.safeParse({ radius: '150' }).success).toBe(true)
    expect(generalRadiusSchema.safeParse({ radius: '50' }).success).toBe(true)
    expect(generalRadiusSchema.safeParse({ radius: '1000' }).success).toBe(true)
  })

  it('rechaza fuera de rango con el mensaje en español', () => {
    for (const radius of ['49', '1001', '', 'mil']) {
      const result = generalRadiusSchema.safeParse({ radius })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(RADIUS_RANGE_MESSAGE)
      }
    }
  })
})

describe('siteRadiusFieldSchema (radio propio opcional)', () => {
  it('el vacío es válido (usa el general)', () => {
    expect(siteRadiusFieldSchema.safeParse('').success).toBe(true)
    expect(siteRadiusFieldSchema.safeParse(undefined).success).toBe(true)
    expect(siteRadiusFieldSchema.safeParse('   ').success).toBe(true)
  })

  it('valida el rango cuando hay valor', () => {
    expect(siteRadiusFieldSchema.safeParse('200').success).toBe(true)
    expect(siteRadiusFieldSchema.safeParse('20').success).toBe(false)
    expect(siteRadiusFieldSchema.safeParse('5000').success).toBe(false)
  })
})

describe('radiusTextToValue', () => {
  it('vacío es null y un número se convierte', () => {
    expect(radiusTextToValue('')).toBeNull()
    expect(radiusTextToValue(undefined)).toBeNull()
    expect(radiusTextToValue(' 250 ')).toBe(250)
  })
})

describe('correctTimeSchema (B-28)', () => {
  it('pide hora nueva y motivo', () => {
    const empty = correctTimeSchema.safeParse({ at: '', reason: '' })
    expect(empty.success).toBe(false)
    if (!empty.success) {
      const messages = empty.error.issues.map((issue) => issue.message)
      expect(messages).toContain('Indicá la hora nueva.')
      expect(messages).toContain('Escribí el motivo.')
    }
  })

  it('un motivo de solo espacios no vale', () => {
    expect(
      correctTimeSchema.safeParse({ at: '2026-10-14T08:00', reason: '   ' })
        .success,
    ).toBe(false)
  })

  it('acepta hora y motivo', () => {
    expect(
      correctTimeSchema.safeParse({
        at: '2026-10-14T08:00',
        reason: 'Fichó tarde por falta de señal',
      }).success,
    ).toBe(true)
  })
})

describe('overrideGeoSchema (B-09)', () => {
  it('el motivo es obligatorio', () => {
    expect(overrideGeoSchema.safeParse({ reason: '' }).success).toBe(false)
    expect(overrideGeoSchema.safeParse({ reason: '  ' }).success).toBe(false)
    expect(
      overrideGeoSchema.safeParse({ reason: 'Subsuelo sin GPS' }).success,
    ).toBe(true)
  })
})

describe('formulario de sede con radio propio (ADM-23)', () => {
  const base = {
    name: 'Planta baja',
    address: 'Calle 1',
    coordinates: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    status: 'active' as const,
  }

  it('sin radio propio manda null (usa el general)', () => {
    const parsed = siteFormSchema.parse({ ...base, geofenceRadius: '' })
    expect(siteFormValuesToInput(parsed).geofenceRadiusM).toBeNull()
  })

  it('con radio propio válido lo manda como número', () => {
    const parsed = siteFormSchema.parse({ ...base, geofenceRadius: '300' })
    expect(siteFormValuesToInput(parsed).geofenceRadiusM).toBe(300)
  })

  it('rechaza un radio propio fuera de rango', () => {
    const result = siteFormSchema.safeParse({ ...base, geofenceRadius: '30' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['geofenceRadius'])
    }
  })
})
