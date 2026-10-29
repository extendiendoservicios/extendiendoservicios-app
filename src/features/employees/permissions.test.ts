import { describe, expect, it } from 'vitest'
import {
  canEditEmployee,
  canEditPersonalProfile,
  canManageEmployeeAccounts,
  type EmployeesScreenActor,
} from './permissions'

/** EMP-003, EMP-005: la lógica de permisos de ADM-16/17/18, sin red ni React. */

const owner: EmployeesScreenActor = { roles: ['owner'], capabilities: [] }
const adminWithManageUsers: EmployeesScreenActor = {
  roles: ['admin'],
  capabilities: ['manage_users'],
}
const adminWithoutManageUsers: EmployeesScreenActor = {
  roles: ['admin'],
  capabilities: [],
}

describe('canManageEmployeeAccounts', () => {
  it('el dueño siempre puede', () => {
    expect(canManageEmployeeAccounts(owner)).toBe(true)
  })

  it('un administrador con manage_users puede', () => {
    expect(canManageEmployeeAccounts(adminWithManageUsers)).toBe(true)
  })

  it('un administrador sin manage_users no puede', () => {
    expect(canManageEmployeeAccounts(adminWithoutManageUsers)).toBe(false)
  })
})

describe('canEditEmployee', () => {
  it('el dueño puede editar', () => {
    expect(canEditEmployee(owner)).toBe(true)
  })

  it('cualquier administrador puede editar, tenga o no manage_users', () => {
    expect(canEditEmployee(adminWithManageUsers)).toBe(true)
    expect(canEditEmployee(adminWithoutManageUsers)).toBe(true)
  })

  it('un supervisor no puede editar', () => {
    expect(canEditEmployee({ roles: ['supervisor'], capabilities: [] })).toBe(
      false,
    )
  })
})

describe('canEditPersonalProfile (CR-19)', () => {
  const adminSinManage: EmployeesScreenActor = {
    roles: ['admin'],
    capabilities: [],
  }

  it('el dueño edita el perfil de cualquiera', () => {
    expect(canEditPersonalProfile(owner, ['owner', 'employee'])).toBe(true)
    expect(canEditPersonalProfile(owner, ['admin', 'employee'])).toBe(true)
  })

  it('un administrador no edita el perfil de un dueño ni de otro administrador', () => {
    expect(canEditPersonalProfile(adminWithManageUsers, ['owner'])).toBe(false)
    expect(canEditPersonalProfile(adminSinManage, ['admin', 'employee'])).toBe(
      false,
    )
  })

  it('un administrador edita el perfil de un empleado o coordinador', () => {
    expect(canEditPersonalProfile(adminSinManage, ['employee'])).toBe(true)
    expect(canEditPersonalProfile(adminSinManage, ['supervisor'])).toBe(true)
  })
})
