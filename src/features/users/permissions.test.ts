import { describe, expect, it } from 'vitest'
import {
  canActOnUser,
  canCreateAdminUser,
  canEditRolesAndCapabilities,
  canManageUsers,
  canReactivateUser,
  getVisibleUserActions,
  isOwner,
  type UsersScreenActor,
} from './permissions'
import type { Role } from '@/api/users'

/** USERS-008 a USERS-011: la lógica de permisos de ADM-27, sin red ni React. */

const owner: UsersScreenActor = { roles: ['owner'], capabilities: [] }
const adminWithManageUsers: UsersScreenActor = {
  roles: ['admin'],
  capabilities: ['manage_users'],
}
const adminWithoutManageUsers: UsersScreenActor = {
  roles: ['admin'],
  capabilities: [],
}

describe('isOwner', () => {
  it('es true solo para quien tiene el rol owner', () => {
    expect(isOwner(owner)).toBe(true)
    expect(isOwner(adminWithManageUsers)).toBe(false)
  })
})

describe('canManageUsers', () => {
  it('el dueño siempre puede', () => {
    expect(canManageUsers(owner)).toBe(true)
  })

  it('un administrador con manage_users puede', () => {
    expect(canManageUsers(adminWithManageUsers)).toBe(true)
  })

  it('un administrador sin manage_users no puede', () => {
    expect(canManageUsers(adminWithoutManageUsers)).toBe(false)
  })
})

describe('canActOnUser', () => {
  it('el dueño puede actuar sobre cualquiera, incluido otro dueño o un administrador', () => {
    expect(canActOnUser(owner, ['owner'])).toBe(true)
    expect(canActOnUser(owner, ['admin'])).toBe(true)
    expect(canActOnUser(owner, ['employee'])).toBe(true)
  })

  it('un administrador con manage_users puede actuar sobre supervisor/empleado', () => {
    expect(canActOnUser(adminWithManageUsers, ['employee'])).toBe(true)
    expect(canActOnUser(adminWithManageUsers, ['supervisor'])).toBe(true)
  })

  it('un administrador con manage_users NO puede actuar sobre owner ni admin', () => {
    expect(canActOnUser(adminWithManageUsers, ['owner'])).toBe(false)
    expect(canActOnUser(adminWithManageUsers, ['admin'])).toBe(false)
    // Ni sobre alguien que además de empleado también es admin.
    expect(canActOnUser(adminWithManageUsers, ['employee', 'admin'])).toBe(
      false,
    )
  })

  it('un administrador sin manage_users no puede actuar sobre nadie', () => {
    expect(canActOnUser(adminWithoutManageUsers, ['employee'])).toBe(false)
  })
})

describe('canReactivateUser', () => {
  it('solo el dueño reactiva', () => {
    expect(canReactivateUser(owner)).toBe(true)
    expect(canReactivateUser(adminWithManageUsers)).toBe(false)
  })
})

describe('canCreateAdminUser', () => {
  it('solo el dueño da de alta un usuario administrativo', () => {
    expect(canCreateAdminUser(owner)).toBe(true)
    expect(canCreateAdminUser(adminWithManageUsers)).toBe(false)
  })
})

describe('canEditRolesAndCapabilities', () => {
  it('solo el dueño edita roles y capacidades (USERS-010)', () => {
    expect(canEditRolesAndCapabilities(owner)).toBe(true)
    expect(canEditRolesAndCapabilities(adminWithManageUsers)).toBe(false)
  })
})

describe('getVisibleUserActions', () => {
  const activeEmployee: { roles: Role[]; deletedAt: string | null } = {
    roles: ['employee'],
    deletedAt: null,
  }
  const activeAdmin: { roles: Role[]; deletedAt: string | null } = {
    roles: ['admin'],
    deletedAt: null,
  }
  const deactivatedEmployee: { roles: Role[]; deletedAt: string | null } = {
    roles: ['employee'],
    deletedAt: '2026-09-01T00:00:00Z',
  }

  it('el dueño ve las cinco acciones de una cuenta activa', () => {
    expect(getVisibleUserActions(owner, activeEmployee)).toEqual([
      'edit-roles',
      'reset-password',
      'update-email',
      'sign-out',
      'deactivate',
    ])
  })

  it('un administrador con manage_users ve las cuatro acciones de cuenta, sin "edit-roles" (USERS-010)', () => {
    expect(getVisibleUserActions(adminWithManageUsers, activeEmployee)).toEqual(
      ['reset-password', 'update-email', 'sign-out', 'deactivate'],
    )
  })

  it('un administrador con manage_users no ve ninguna acción sobre otro administrador', () => {
    expect(getVisibleUserActions(adminWithManageUsers, activeAdmin)).toEqual([])
  })

  it('sobre una cuenta desactivada, el dueño solo ve "reactivate"', () => {
    expect(getVisibleUserActions(owner, deactivatedEmployee)).toEqual([
      'edit-roles',
      'reactivate',
    ])
  })

  it('sobre una cuenta desactivada, un administrador con manage_users no ve nada (reactivar es solo del dueño)', () => {
    expect(
      getVisibleUserActions(adminWithManageUsers, deactivatedEmployee),
    ).toEqual([])
  })

  it('un administrador sin manage_users no ve nada, esté activa o no la cuenta', () => {
    expect(
      getVisibleUserActions(adminWithoutManageUsers, activeEmployee),
    ).toEqual([])
    expect(
      getVisibleUserActions(adminWithoutManageUsers, deactivatedEmployee),
    ).toEqual([])
  })
})
