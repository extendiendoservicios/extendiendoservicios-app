import { describe, expect, it } from 'vitest'
import {
  ADMIN_MORE_ITEMS,
  ADMIN_NAV_ITEMS,
  ADMIN_NAV_OPERATION,
  isAdminNavItemActive,
} from './adminNav'

describe('adminNav: sección «Insumos» (IS-33)', () => {
  it('va después de «Tareas» en la barra lateral de escritorio', () => {
    const labels = ADMIN_NAV_OPERATION.map((item) => item.label)
    expect(labels.indexOf('Insumos')).toBe(labels.indexOf('Tareas') + 1)
  })

  it('va después de «Tareas» en el menú «Más» del celular', () => {
    const labels = ADMIN_MORE_ITEMS.map((item) => item.label)
    expect(labels.indexOf('Insumos')).toBe(labels.indexOf('Tareas') + 1)
  })

  it('apunta a /admin/insumos en las dos listas', () => {
    for (const list of [ADMIN_NAV_ITEMS, ADMIN_MORE_ITEMS]) {
      expect(list.find((item) => item.label === 'Insumos')?.path).toBe(
        '/admin/insumos',
      )
    }
  })

  it('queda activa también en la ficha, el alta y el ingreso', () => {
    const item = ADMIN_NAV_ITEMS.find((entry) => entry.label === 'Insumos')
    expect(item).toBeDefined()
    for (const path of [
      '/admin/insumos',
      '/admin/insumos/nuevo',
      '/admin/insumos/ingreso',
      '/admin/insumos/abc/editar',
    ]) {
      expect(isAdminNavItemActive(path, item!), path).toBe(true)
    }
    expect(isAdminNavItemActive('/admin/tareas', item!)).toBe(false)
  })
})
