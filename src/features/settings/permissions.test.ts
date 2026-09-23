import { describe, expect, it } from 'vitest'
import {
  canEditCompanyDetails,
  canEditCompanyLogo,
  canViewCompanySettings,
  canViewOwnerOnlyConfig,
  isOwner,
} from './permissions'

/**
 * Permisos de las cuatro pantallas de Configuración (USERS-012, USERS-014 a
 * USERS-016): funciones puras, sin renderizar nada -- ver el comentario de
 * cabecera de `permissions.ts` para la matriz completa.
 */
describe('isOwner', () => {
  it('true solo con el rol owner', () => {
    expect(isOwner({ roles: ['owner'] })).toBe(true)
    expect(isOwner({ roles: ['admin'] })).toBe(false)
  })
})

describe('canViewCompanySettings (ADM-28)', () => {
  it('dueño y administrador pueden ver la pantalla', () => {
    expect(canViewCompanySettings({ roles: ['owner'] })).toBe(true)
    expect(canViewCompanySettings({ roles: ['admin'] })).toBe(true)
  })

  it('supervisor y empleado no', () => {
    expect(canViewCompanySettings({ roles: ['supervisor'] })).toBe(false)
    expect(canViewCompanySettings({ roles: ['employee'] })).toBe(false)
  })
})

describe('canEditCompanyDetails (ADM-28: nombre, teléfono, consentimiento)', () => {
  it('solo el dueño', () => {
    expect(canEditCompanyDetails({ roles: ['owner'] })).toBe(true)
    expect(canEditCompanyDetails({ roles: ['admin'] })).toBe(false)
  })
})

describe('canEditCompanyLogo (ADM-28: logo, P-117)', () => {
  it('dueño y administrador', () => {
    expect(canEditCompanyLogo({ roles: ['owner'] })).toBe(true)
    expect(canEditCompanyLogo({ roles: ['admin'] })).toBe(true)
  })

  it('supervisor no', () => {
    expect(canEditCompanyLogo({ roles: ['supervisor'] })).toBe(false)
  })
})

describe('canViewOwnerOnlyConfig (ADM-29, ADM-30, ADM-31)', () => {
  it('solo el dueño, ni siquiera un administrador', () => {
    expect(canViewOwnerOnlyConfig({ roles: ['owner'] })).toBe(true)
    expect(canViewOwnerOnlyConfig({ roles: ['admin'] })).toBe(false)
    expect(canViewOwnerOnlyConfig({ roles: ['supervisor'] })).toBe(false)
  })
})
