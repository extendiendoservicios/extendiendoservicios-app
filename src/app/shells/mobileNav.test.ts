import { describe, expect, it } from 'vitest'
import {
  EMPLOYEE_TABBAR_ITEMS,
  isMobileNavItemActive,
  SUPERVISOR_TABBAR_ITEMS,
} from './mobileNav'

/** Barras de abajo del celular (IS-33). */
describe('mobileNav', () => {
  it('empleado: Hoy, Insumos, Más (el Fichar es el botón central)', () => {
    expect(EMPLOYEE_TABBAR_ITEMS.map((item) => item.label)).toEqual([
      'Hoy',
      'Insumos',
      'Más',
    ])
    expect(EMPLOYEE_TABBAR_ITEMS.map((item) => item.path)).toEqual([
      '/app',
      '/app/insumos',
      '/app/mas',
    ])
  })

  it('coordinador: Hoy, Supervisiones, Insumos, Historial, Más (cinco, el máximo)', () => {
    expect(SUPERVISOR_TABBAR_ITEMS.map((item) => item.label)).toEqual([
      'Hoy',
      'Supervisiones',
      'Insumos',
      'Historial',
      'Más',
    ])
    expect(SUPERVISOR_TABBAR_ITEMS.map((item) => item.path)).toEqual([
      '/sup',
      '/sup/supervisiones',
      '/sup/insumos',
      '/sup/historial',
      '/sup/mas',
    ])
    expect(SUPERVISOR_TABBAR_ITEMS).toHaveLength(5)
  })

  it('Insumos queda activo también en sus subpantallas, y Hoy solo en la raíz', () => {
    const [today, supplies] = EMPLOYEE_TABBAR_ITEMS
    expect(
      isMobileNavItemActive('/app/insumos/retirar', supplies!, '/app'),
    ).toBe(true)
    expect(isMobileNavItemActive('/app/insumos', today!, '/app')).toBe(false)
    const supSupplies = SUPERVISOR_TABBAR_ITEMS[2]
    expect(
      isMobileNavItemActive('/sup/insumos/faltante', supSupplies!, '/sup'),
    ).toBe(true)
  })
})
