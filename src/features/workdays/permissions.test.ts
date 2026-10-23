import { describe, expect, it } from 'vitest'
import { canCorrectWorkdays } from './permissions'

describe('canCorrectWorkdays', () => {
  it('el dueño siempre; el administrador solo con manage_attendance', () => {
    expect(canCorrectWorkdays({ roles: ['owner'], capabilities: [] })).toBe(
      true,
    )
    expect(canCorrectWorkdays({ roles: ['admin'], capabilities: [] })).toBe(
      false,
    )
    expect(
      canCorrectWorkdays({
        roles: ['admin'],
        capabilities: ['manage_attendance'],
      }),
    ).toBe(true)
    expect(
      canCorrectWorkdays({
        roles: ['admin'],
        capabilities: ['manage_supervisions'],
      }),
    ).toBe(false)
  })
})
