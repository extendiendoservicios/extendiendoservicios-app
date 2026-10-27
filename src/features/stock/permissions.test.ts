import { describe, expect, it } from 'vitest'
import { canManageStock } from './permissions'

describe('canManageStock (IS-19, IS-21)', () => {
  it('el dueño la tiene implícita, sin cargarla', () => {
    expect(canManageStock({ roles: ['owner'], capabilities: [] })).toBe(true)
  })

  it('el administrador la necesita cargada', () => {
    expect(
      canManageStock({ roles: ['admin'], capabilities: ['manage_stock'] }),
    ).toBe(true)
    expect(canManageStock({ roles: ['admin'], capabilities: [] })).toBe(false)
  })

  it('otra capacidad no alcanza', () => {
    expect(
      canManageStock({
        roles: ['admin'],
        capabilities: ['manage_attendance', 'manage_users'],
      }),
    ).toBe(false)
  })

  it('un empleado o coordinador nunca, ni con la capacidad cargada', () => {
    expect(
      canManageStock({ roles: ['employee'], capabilities: ['manage_stock'] }),
    ).toBe(false)
    expect(
      canManageStock({ roles: ['supervisor'], capabilities: ['manage_stock'] }),
    ).toBe(false)
  })
})
