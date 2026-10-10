import { describe, expect, it } from 'vitest'
import { userDetailPath } from './userNavigation'

describe('userDetailPath (AJ2-12)', () => {
  it('empleado y supervisor abren su ficha', () => {
    expect(userDetailPath({ profileId: 'p1', roles: ['employee'] })).toBe(
      '/admin/empleados/p1',
    )
    expect(userDetailPath({ profileId: 'p2', roles: ['supervisor'] })).toBe(
      '/admin/empleados/p2',
    )
  })

  it('quien tiene además rol de administración y es empleado también abre la ficha', () => {
    expect(
      userDetailPath({ profileId: 'p3', roles: ['admin', 'employee'] }),
    ).toBe('/admin/empleados/p3')
  })

  it('dueños y administradores sin ficha no navegan', () => {
    expect(userDetailPath({ profileId: 'p4', roles: ['owner'] })).toBeNull()
    expect(userDetailPath({ profileId: 'p5', roles: ['admin'] })).toBeNull()
    expect(userDetailPath({ profileId: 'p6', roles: [] })).toBeNull()
  })
})
