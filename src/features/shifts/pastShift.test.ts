import { describe, expect, it } from 'vitest'
import { canRegisterPastShift, isShiftPast } from './pastShift'

describe('isShiftPast (OH-09)', () => {
  // 13 oct 2026, 15:30 en Buenos Aires (UTC-3) = 18:30 UTC.
  const now = new Date('2026-10-13T18:30:00Z')

  it('una fecha anterior ya pasó', () => {
    expect(isShiftPast('2026-10-12', '23:00', now)).toBe(true)
  })

  it('hoy cuenta por la hora de fin, en hora de Argentina', () => {
    expect(isShiftPast('2026-10-13', '15:00', now)).toBe(true)
    expect(isShiftPast('2026-10-13', '15:30', now)).toBe(true)
    expect(isShiftPast('2026-10-13', '15:31', now)).toBe(false)
    expect(isShiftPast('2026-10-13', '18:30', now)).toBe(false)
  })

  it('una fecha futura no pasó', () => {
    expect(isShiftPast('2026-10-14', '08:00', now)).toBe(false)
  })

  it('sin fecha u hora de fin completas no cuenta como pasado', () => {
    expect(isShiftPast('', '08:00', now)).toBe(false)
    expect(isShiftPast('2026-10-01', '', now)).toBe(false)
  })

  it('acepta la hora con segundos', () => {
    expect(isShiftPast('2026-10-13', '12:00:00', now)).toBe(true)
  })
})

describe('canRegisterPastShift', () => {
  it('el dueño siempre; el administrador solo con «Gestionar asistencia»', () => {
    expect(canRegisterPastShift({ roles: ['owner'], capabilities: [] })).toBe(
      true,
    )
    expect(canRegisterPastShift({ roles: ['admin'], capabilities: [] })).toBe(
      false,
    )
    expect(
      canRegisterPastShift({
        roles: ['admin'],
        capabilities: ['manage_attendance'],
      }),
    ).toBe(true)
    expect(
      canRegisterPastShift({
        roles: ['employee'],
        capabilities: ['manage_attendance'],
      }),
    ).toBe(false)
  })
})
