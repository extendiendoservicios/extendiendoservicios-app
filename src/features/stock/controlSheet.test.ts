import { describe, expect, it } from 'vitest'
import { controlSheetItems } from './controlSheet'
import { filterStockItems, DEFAULT_STOCK_FILTERS } from './filters'
import { testItem } from './testSupport'

const ITEMS = [
  testItem({
    id: 'b',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 1,
  }),
  testItem({ id: 'a', code: 'QUI-001', name: 'Lavandina' }),
  testItem({
    id: 'c',
    code: 'QUI-002',
    name: 'Desengrasante',
    presentation: '5 L',
  }),
  testItem({ id: 'x', code: 'QUI-099', name: 'Discontinuado', active: false }),
]

describe('controlSheetItems: artículos de la planilla (IS-15)', () => {
  it('solo los activos, con el mismo orden que la tabla de Stock', () => {
    const sheet = controlSheetItems(ITEMS, 'all')
    expect(sheet.map((item) => item.id)).toEqual(['c', 'a', 'b'])
    expect(sheet.map((item) => item.id)).toEqual(
      filterStockItems(ITEMS, DEFAULT_STOCK_FILTERS).map((item) => item.id),
    )
  })

  it('con una categoría, solo los artículos de esa categoría', () => {
    expect(controlSheetItems(ITEMS, 'c2').map((item) => item.id)).toEqual(['b'])
    expect(controlSheetItems(ITEMS, 'c1').map((item) => item.id)).toEqual([
      'c',
      'a',
    ])
  })

  it('una categoría sin artículos activos da una planilla vacía', () => {
    expect(controlSheetItems(ITEMS, 'otra')).toEqual([])
  })
})
