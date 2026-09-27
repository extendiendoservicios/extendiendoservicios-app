import { describe, expect, it } from 'vitest'
import {
  notifyAbsenceSchema,
  notifyDelayFormValuesToMinutes,
  notifyDelaySchema,
  recordAttendanceSchema,
} from './schemas'

describe('recordAttendanceSchema', () => {
  it('acepta hora y motivo completos', () => {
    const result = recordAttendanceSchema.safeParse({
      at: '2026-09-26T11:00',
      reason: 'Se olvidó de fichar',
    })
    expect(result.success).toBe(true)
  })

  it('exige el motivo', () => {
    const result = recordAttendanceSchema.safeParse({
      at: '2026-09-26T11:00',
      reason: '   ',
    })
    expect(result.success).toBe(false)
  })
})

describe('notifyDelaySchema', () => {
  it('acepta minutos entre 1 y 600', () => {
    expect(notifyDelaySchema.safeParse({ minutes: '15' }).success).toBe(true)
    expect(notifyDelaySchema.safeParse({ minutes: '600' }).success).toBe(true)
  })

  it('rechaza 0, negativos y más de 600', () => {
    expect(notifyDelaySchema.safeParse({ minutes: '0' }).success).toBe(false)
    expect(notifyDelaySchema.safeParse({ minutes: '-5' }).success).toBe(false)
    expect(notifyDelaySchema.safeParse({ minutes: '601' }).success).toBe(false)
  })

  it('rechaza si falta el número', () => {
    expect(notifyDelaySchema.safeParse({ minutes: '' }).success).toBe(false)
  })

  it('convierte el texto validado a número', () => {
    expect(
      notifyDelayFormValuesToMinutes({ minutes: '15', reasonText: '' }),
    ).toBe(15)
  })
})

describe('notifyAbsenceSchema', () => {
  it('acepta un motivo sin texto (si no es "otro")', () => {
    const result = notifyAbsenceSchema.safeParse({ reasonCode: 'illness' })
    expect(result.success).toBe(true)
  })

  it('exige el texto cuando el motivo es "otro"', () => {
    const result = notifyAbsenceSchema.safeParse({ reasonCode: 'other' })
    expect(result.success).toBe(false)
  })

  it('acepta "otro" con texto', () => {
    const result = notifyAbsenceSchema.safeParse({
      reasonCode: 'other',
      reasonText: 'Turno médico de urgencia',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza si falta el motivo', () => {
    expect(notifyAbsenceSchema.safeParse({}).success).toBe(false)
  })
})
