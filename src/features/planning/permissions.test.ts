import { describe, expect, it } from 'vitest'
import {
  canManageAssignments,
  canManageAssignmentsAfterStart,
  canManageTasks,
} from './permissions'

describe('canManageAssignments', () => {
  it('permite al dueño y a cualquier administrador', () => {
    expect(canManageAssignments({ roles: ['owner'], capabilities: [] })).toBe(
      true,
    )
    expect(canManageAssignments({ roles: ['admin'], capabilities: [] })).toBe(
      true,
    )
  })

  it('no permite a un supervisor', () => {
    expect(
      canManageAssignments({ roles: ['supervisor'], capabilities: [] }),
    ).toBe(false)
  })
})

describe('canManageAssignmentsAfterStart', () => {
  it('exige manage_attendance a un administrador', () => {
    expect(
      canManageAssignmentsAfterStart({ roles: ['admin'], capabilities: [] }),
    ).toBe(false)
    expect(
      canManageAssignmentsAfterStart({
        roles: ['admin'],
        capabilities: ['manage_attendance'],
      }),
    ).toBe(true)
  })

  it('el dueño no necesita la capacidad', () => {
    expect(
      canManageAssignmentsAfterStart({ roles: ['owner'], capabilities: [] }),
    ).toBe(true)
  })
})

describe('canManageTasks', () => {
  it('permite al dueño y a cualquier administrador, sin capacidad extra', () => {
    expect(canManageTasks({ roles: ['owner'], capabilities: [] })).toBe(true)
    expect(canManageTasks({ roles: ['admin'], capabilities: [] })).toBe(true)
  })

  it('no permite a un supervisor', () => {
    expect(canManageTasks({ roles: ['supervisor'], capabilities: [] })).toBe(
      false,
    )
  })
})
