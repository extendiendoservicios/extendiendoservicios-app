import { describe, expect, it } from 'vitest'
import { absenceReasonSchema, delayMinutesSchema } from './notifySchemas'

describe('delayMinutesSchema', () => {
  it('acepta un entero entre 1 y 600', () => {
    expect(delayMinutesSchema.safeParse('15').success).toBe(true)
    expect(delayMinutesSchema.safeParse('600').success).toBe(true)
  })

  it('rechaza vacío, cero, negativos, decimales y más de 600', () => {
    expect(delayMinutesSchema.safeParse('').success).toBe(false)
    expect(delayMinutesSchema.safeParse('0').success).toBe(false)
    expect(delayMinutesSchema.safeParse('-5').success).toBe(false)
    expect(delayMinutesSchema.safeParse('12.5').success).toBe(false)
    expect(delayMinutesSchema.safeParse('601').success).toBe(false)
  })
})

describe('absenceReasonSchema', () => {
  it('acepta un motivo de la lista sin texto', () => {
    const result = absenceReasonSchema.safeParse({ reasonCode: 'illness' })
    expect(result.success).toBe(true)
  })

  it('exige texto cuando el motivo es "otro"', () => {
    const withoutText = absenceReasonSchema.safeParse({ reasonCode: 'other' })
    expect(withoutText.success).toBe(false)

    const withText = absenceReasonSchema.safeParse({
      reasonCode: 'other',
      reasonText: 'Mudanza',
    })
    expect(withText.success).toBe(true)
  })

  it('rechaza un motivo fuera de la lista', () => {
    expect(
      absenceReasonSchema.safeParse({ reasonCode: 'vacaciones' }).success,
    ).toBe(false)
  })
})
