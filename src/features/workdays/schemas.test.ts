import { describe, expect, it } from 'vitest'
import {
  addWorkdayPauseSchema,
  correctSupervisionTimeSchema,
  correctWorkdayEventSchema,
  INVALID_RANGE_MESSAGE,
  recordWorkdaySchema,
  SAME_DAY_MESSAGE,
  workdayActionSchema,
} from './schemas'

function firstMessage(result: {
  success: boolean
  error?: { issues: { message: string }[] }
}) {
  return result.success ? null : (result.error?.issues[0]?.message ?? null)
}

describe('correctWorkdayEventSchema', () => {
  it('exige el motivo y la hora nueva', () => {
    expect(
      correctWorkdayEventSchema.safeParse({
        at: '2026-10-22T18:00',
        reason: ' ',
      }).success,
    ).toBe(false)
    expect(
      correctWorkdayEventSchema.safeParse({ at: '', reason: 'Se olvidó' })
        .success,
    ).toBe(false)
    expect(
      correctWorkdayEventSchema.safeParse({
        at: '2026-10-22T18:00',
        reason: 'Se olvidó',
      }).success,
    ).toBe(true)
  })
})

describe('addWorkdayPauseSchema', () => {
  const base = {
    startsAt: '2026-10-22T12:00',
    endsAt: '2026-10-22T12:30',
    reason: 'No lo registró',
  }

  it('acepta una pausa sin motivo de pausa (es opcional, CJ-16)', () => {
    expect(addWorkdayPauseSchema.safeParse(base).success).toBe(true)
  })

  it('exige que el inicio sea anterior al fin', () => {
    const result = addWorkdayPauseSchema.safeParse({
      ...base,
      endsAt: '2026-10-22T11:00',
    })
    expect(firstMessage(result)).toBe(INVALID_RANGE_MESSAGE)
  })

  it('exige el motivo de la corrección', () => {
    const result = addWorkdayPauseSchema.safeParse({ ...base, reason: '' })
    expect(firstMessage(result)).toBe('Escribí el motivo.')
  })
})

describe('recordWorkdaySchema', () => {
  const base = {
    startedAt: '2026-10-22T08:00',
    endedAt: '2026-10-22T17:00',
    reason: 'Se olvidó de iniciarla',
  }

  it('acepta una jornada completa y una abierta (sin fin)', () => {
    expect(recordWorkdaySchema.safeParse(base).success).toBe(true)
    expect(
      recordWorkdaySchema.safeParse({ ...base, endedAt: '' }).success,
    ).toBe(true)
  })

  it('no deja que pase la medianoche (CJ-15)', () => {
    const result = recordWorkdaySchema.safeParse({
      ...base,
      endedAt: '2026-10-23T01:00',
    })
    expect(firstMessage(result)).toBe(SAME_DAY_MESSAGE)
  })

  it('exige inicio anterior al fin y motivo', () => {
    expect(
      firstMessage(
        recordWorkdaySchema.safeParse({ ...base, endedAt: '2026-10-22T07:00' }),
      ),
    ).toBe(INVALID_RANGE_MESSAGE)
    expect(recordWorkdaySchema.safeParse({ ...base, reason: '' }).success).toBe(
      false,
    )
  })
})

describe('workdayActionSchema (OD-06, OD-07)', () => {
  it('pide la hora y el motivo', () => {
    expect(
      workdayActionSchema.safeParse({ at: '2026-10-21T10:00', reason: '  ' })
        .success,
    ).toBe(false)
    expect(
      workdayActionSchema.safeParse({ at: '', reason: 'Se trabó' }).success,
    ).toBe(false)
    expect(
      workdayActionSchema.safeParse({
        at: '2026-10-21T10:00',
        reason: 'Se trabó la app',
      }).success,
    ).toBe(true)
  })
})

describe('correctSupervisionTimeSchema (OD-07)', () => {
  it('el fin tiene que ser posterior al inicio y el motivo es obligatorio', () => {
    const bad = correctSupervisionTimeSchema.safeParse({
      startAt: '2026-10-21T10:00',
      endAt: '2026-10-21T09:00',
      reason: 'Corrección',
    })
    expect(bad.success).toBe(false)
    expect(
      correctSupervisionTimeSchema.safeParse({
        startAt: '2026-10-21T10:00',
        endAt: '2026-10-21T11:00',
        reason: '',
      }).success,
    ).toBe(false)
    expect(
      correctSupervisionTimeSchema.safeParse({
        startAt: '2026-10-21T10:00',
        endAt: '2026-10-21T11:00',
        reason: 'Corrección',
      }).success,
    ).toBe(true)
  })
})

describe('correctWorkdayEventSchema con motivo de pausa (OD-07)', () => {
  it('admite hasta 300 caracteres en el motivo de la pausa', () => {
    const base = { at: '2026-10-21T10:00', reason: 'Corrección' }
    expect(
      correctWorkdayEventSchema.safeParse({
        ...base,
        pauseReason: 'a'.repeat(300),
      }).success,
    ).toBe(true)
    expect(
      correctWorkdayEventSchema.safeParse({
        ...base,
        pauseReason: 'a'.repeat(301),
      }).success,
    ).toBe(false)
  })
})
