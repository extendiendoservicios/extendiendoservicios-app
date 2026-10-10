import { describe, expect, it } from 'vitest'
import {
  formatAssignmentRange,
  formatSupervisionRange,
  OPEN_SHIFT_DAY_ENDED_MESSAGE,
} from './shiftRange'

describe('formatAssignmentRange', () => {
  it('muestra inicio–fin en un turno común', () => {
    expect(
      formatAssignmentRange({ startTime: '08:00:00', endTime: '12:00:00' }),
    ).toBe('08:00–12:00')
  })

  it('nunca muestra 23:59 en un turno «A terminar»', () => {
    const text = formatAssignmentRange({
      startTime: '08:00:00',
      endTime: '23:59:00',
      openEnded: true,
    })
    expect(text).toBe('08:00–A terminar')
    expect(text).not.toContain('23:59')
  })
})

describe('formatSupervisionRange', () => {
  it('usa «A terminar» si el turno es abierto', () => {
    expect(
      formatSupervisionRange({
        startTime: '07:30:00',
        endTime: '23:59:00',
        shiftOpenEnded: true,
      }),
    ).toBe('07:30–A terminar')
  })
})

describe('OPEN_SHIFT_DAY_ENDED_MESSAGE', () => {
  it('indica avisar al supervisor o a la oficina', () => {
    expect(OPEN_SHIFT_DAY_ENDED_MESSAGE).toContain('supervisor o a la oficina')
  })
})
