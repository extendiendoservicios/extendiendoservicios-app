import { describe, expect, it } from 'vitest'
import { canEditChecklists } from './permissions'

describe('canEditChecklists', () => {
  it('permite al dueño', () => {
    expect(canEditChecklists({ roles: ['owner'], capabilities: [] })).toBe(true)
  })

  it('exige la capacidad edit_checklists a un administrador', () => {
    expect(canEditChecklists({ roles: ['admin'], capabilities: [] })).toBe(
      false,
    )
    expect(
      canEditChecklists({
        roles: ['admin'],
        capabilities: ['edit_checklists'],
      }),
    ).toBe(true)
  })

  it('no permite a un supervisor ni a un empleado', () => {
    expect(canEditChecklists({ roles: ['supervisor'], capabilities: [] })).toBe(
      false,
    )
    expect(canEditChecklists({ roles: ['employee'], capabilities: [] })).toBe(
      false,
    )
  })
})
