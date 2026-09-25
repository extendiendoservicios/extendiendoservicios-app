import { describe, expect, it } from 'vitest'
import {
  canCancelShift,
  canGenerateShifts,
  canManageShiftTime,
} from './permissions'

describe('canManageShiftTime', () => {
  it('permite al dueño', () => {
    expect(canManageShiftTime({ roles: ['owner'], capabilities: [] })).toBe(
      true,
    )
  })

  it('permite a cualquier administrador, sin capacidad extra', () => {
    expect(canManageShiftTime({ roles: ['admin'], capabilities: [] })).toBe(
      true,
    )
  })

  it('no permite a un supervisor', () => {
    expect(
      canManageShiftTime({ roles: ['supervisor'], capabilities: [] }),
    ).toBe(false)
  })
})

describe('canGenerateShifts', () => {
  it('permite al dueño', () => {
    expect(canGenerateShifts({ roles: ['owner'], capabilities: [] })).toBe(true)
  })

  it('exige la capacidad generate_shifts a un administrador', () => {
    expect(canGenerateShifts({ roles: ['admin'], capabilities: [] })).toBe(
      false,
    )
    expect(
      canGenerateShifts({
        roles: ['admin'],
        capabilities: ['generate_shifts'],
      }),
    ).toBe(true)
  })
})

describe('canCancelShift', () => {
  it('permite al dueño', () => {
    expect(canCancelShift({ roles: ['owner'], capabilities: [] })).toBe(true)
  })

  it('exige la capacidad cancel_shifts a un administrador', () => {
    expect(canCancelShift({ roles: ['admin'], capabilities: [] })).toBe(false)
    expect(
      canCancelShift({ roles: ['admin'], capabilities: ['cancel_shifts'] }),
    ).toBe(true)
  })
})
