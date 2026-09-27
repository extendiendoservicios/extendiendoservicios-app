import { describe, expect, it } from 'vitest'
import {
  dateTimeLocalToIso,
  shiftDayStartAsDateTimeLocal,
  toDateTimeLocal,
} from './dateTimeLocal'

describe('toDateTimeLocal', () => {
  it('formatea un instante en hora de Argentina, sin zona', () => {
    // 2026-09-26T14:30:00Z es las 11:30 en Argentina (UTC-3, sin horario de verano).
    expect(toDateTimeLocal(new Date('2026-09-26T14:30:00Z'))).toBe(
      '2026-09-26T11:30',
    )
  })
})

describe('shiftDayStartAsDateTimeLocal', () => {
  it('arma las 0:00 del día del turno', () => {
    expect(shiftDayStartAsDateTimeLocal('2026-09-26')).toBe('2026-09-26T00:00')
  })
})

describe('dateTimeLocalToIso', () => {
  it('agrega el offset fijo de Argentina', () => {
    expect(dateTimeLocalToIso('2026-09-26T11:30')).toBe(
      '2026-09-26T11:30:00-03:00',
    )
  })
})
