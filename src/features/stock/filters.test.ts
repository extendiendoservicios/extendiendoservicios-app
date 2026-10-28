import { describe, expect, it } from 'vitest'
import type { StockItem, SupplyCategory } from '@/api/stock'
import {
  DEFAULT_STOCK_FILTERS,
  effectiveStatus,
  filterStockItems,
  moveCategory,
  normalizeText,
  sortStockItems,
  stockAlertLabel,
  stockRowVariant,
  supplyLabel,
  totalStockValue,
} from './filters'

function item(overrides: Partial<StockItem> = {}): StockItem {
  return {
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    categoryId: 'c1',
    categoryName: 'Químicos',
    categorySortOrder: 0,
    imagePath: null,
    minQty: 5,
    costPrice: 100,
    salePrice: 150,
    stockQty: 10,
    stockValue: 1000,
    status: 'ok',
    active: true,
    notes: null,
    updatedAt: null,
    ...overrides,
  }
}

describe('colores de fila (IS-05, IS-25)', () => {
  it('amarillo si el stock es igual o menor al mínimo', () => {
    const low = item({ status: 'low', stockQty: 5, minQty: 5 })
    expect(stockRowVariant(low)).toBe('warn')
    expect(stockAlertLabel(low)).toBe('Bajo mínimo')
  })

  it('rojo si el stock es cero, aunque no tenga mínimo', () => {
    const empty = item({ status: 'empty', stockQty: 0, minQty: null })
    expect(stockRowVariant(empty)).toBe('crit')
    expect(stockAlertLabel(empty)).toBe('Sin stock')
  })

  it('sin aviso: ni color ni etiqueta', () => {
    const ok = item({ status: 'ok' })
    expect(stockRowVariant(ok)).toBeUndefined()
    expect(stockAlertLabel(ok)).toBeNull()
  })

  it('un artículo inactivo no marca aviso, aunque su stock sea cero', () => {
    const inactive = item({ status: 'empty', stockQty: 0, active: false })
    expect(effectiveStatus(inactive)).toBe('ok')
    expect(stockRowVariant(inactive)).toBeUndefined()
    expect(stockAlertLabel(inactive)).toBeNull()
  })
})

describe('filterStockItems (IS-25)', () => {
  const items = [
    item({ id: 'a', code: 'QUI-001', name: 'Lavandina', status: 'low' }),
    item({
      id: 'b',
      code: 'DES-010',
      name: 'Bolsa de residuos',
      presentation: 'x 10',
      categoryId: 'c2',
      categoryName: 'Descartables',
      categorySortOrder: 1,
      status: 'empty',
      stockQty: 0,
    }),
    item({
      id: 'c',
      code: 'UTE-005',
      name: 'Escurridor',
      presentation: null,
      categoryId: 'c3',
      categoryName: 'Utensilios',
      categorySortOrder: 2,
    }),
    item({
      id: 'd',
      code: 'QUI-099',
      name: 'Desengrasante viejo',
      status: 'empty',
      stockQty: 0,
      active: false,
    }),
  ]

  it('por defecto oculta los inactivos', () => {
    expect(
      filterStockItems(items, DEFAULT_STOCK_FILTERS).map((row) => row.id),
    ).toEqual(['a', 'b', 'c'])
  })

  it('«Incluir inactivos» los suma', () => {
    const ids = filterStockItems(items, {
      ...DEFAULT_STOCK_FILTERS,
      includeInactive: true,
    }).map((row) => row.id)
    expect(ids).toContain('d')
  })

  it('busca por código sin distinguir mayúsculas', () => {
    expect(
      filterStockItems(items, {
        ...DEFAULT_STOCK_FILTERS,
        text: 'des-010',
      }).map((row) => row.id),
    ).toEqual(['b'])
  })

  it('busca por nombre sin distinguir tildes', () => {
    expect(
      filterStockItems(items, {
        ...DEFAULT_STOCK_FILTERS,
        text: 'LAVANDÍNA',
      }).map((row) => row.id),
    ).toEqual(['a'])
  })

  it('filtra por categoría', () => {
    expect(
      filterStockItems(items, {
        ...DEFAULT_STOCK_FILTERS,
        categoryId: 'c3',
      }).map((row) => row.id),
    ).toEqual(['c'])
  })

  it('«Solo con aviso» deja los amarillos y los rojos', () => {
    expect(
      filterStockItems(items, {
        ...DEFAULT_STOCK_FILTERS,
        onlyAlerts: true,
      }).map((row) => row.id),
    ).toEqual(['a', 'b'])
  })

  it('«Solo con aviso» no cuenta un inactivo en cero', () => {
    expect(
      filterStockItems(items, {
        ...DEFAULT_STOCK_FILTERS,
        onlyAlerts: true,
        includeInactive: true,
      }).map((row) => row.id),
    ).toEqual(['a', 'b'])
  })

  it('los filtros se combinan', () => {
    expect(
      filterStockItems(items, {
        text: 'qui',
        categoryId: 'c1',
        onlyAlerts: true,
        includeInactive: false,
      }).map((row) => row.id),
    ).toEqual(['a'])
  })
})

describe('orden por defecto', () => {
  it('categoría (en su orden) y nombre', () => {
    const sorted = sortStockItems([
      item({ id: '1', categorySortOrder: 1, categoryName: 'B', name: 'Z' }),
      item({ id: '2', categorySortOrder: 0, categoryName: 'A', name: 'M' }),
      item({ id: '3', categorySortOrder: 0, categoryName: 'A', name: 'C' }),
    ])
    expect(sorted.map((row) => row.id)).toEqual(['3', '2', '1'])
  })

  it('en la misma categoría y nombre, ordena las presentaciones con números', () => {
    const sorted = sortStockItems([
      item({ id: '1', presentation: '5 L' }),
      item({ id: '2', presentation: '1 L' }),
      item({ id: '3', presentation: '10 L' }),
    ])
    expect(sorted.map((row) => row.id)).toEqual(['2', '1', '3'])
  })
})

describe('totalStockValue (IS-24)', () => {
  it('suma el valor a costo sin arrastrar decimales binarios', () => {
    expect(
      totalStockValue([
        item({ stockValue: 0.1 }),
        item({ stockValue: 0.2 }),
        item({ stockValue: 1250.35 }),
      ]),
    ).toBe(1250.65)
  })

  it('sin artículos es cero', () => {
    expect(totalStockValue([])).toBe(0)
  })
})

describe('textos', () => {
  it('normalizeText saca tildes y mayúsculas', () => {
    expect(normalizeText('  Ácido Cítrico ')).toBe('acido citrico')
  })

  it('supplyLabel junta nombre y presentación', () => {
    expect(supplyLabel({ name: 'Lavandina', presentation: '1 L' })).toBe(
      'Lavandina · 1 L',
    )
    expect(supplyLabel({ name: 'Escurridor', presentation: null })).toBe(
      'Escurridor',
    )
  })
})

describe('moveCategory (orden de categorías)', () => {
  const categories: SupplyCategory[] = [
    { id: 'a', name: 'A', sortOrder: 0, active: true },
    { id: 'b', name: 'B', sortOrder: 1, active: true },
    { id: 'c', name: 'C', sortOrder: 2, active: false },
  ]

  it('sube una categoría: intercambia con la anterior', () => {
    expect(moveCategory(categories, 'b', 'up')).toEqual([
      { id: 'b', name: 'B', active: true, sortOrder: 0 },
      { id: 'a', name: 'A', active: true, sortOrder: 1 },
    ])
  })

  it('baja una categoría y conserva su estado', () => {
    expect(moveCategory(categories, 'b', 'down')).toEqual([
      { id: 'c', name: 'C', active: false, sortOrder: 1 },
      { id: 'b', name: 'B', active: true, sortOrder: 2 },
    ])
  })

  it('no mueve la primera hacia arriba ni la última hacia abajo', () => {
    expect(moveCategory(categories, 'a', 'up')).toEqual([])
    expect(moveCategory(categories, 'c', 'down')).toEqual([])
  })

  it('renumera 0, 1, 2… aunque todas vengan con el mismo orden', () => {
    const same = categories.map((category) => ({ ...category, sortOrder: 0 }))
    const changes = moveCategory(same, 'c', 'up')
    expect(changes.map((change) => [change.id, change.sortOrder])).toEqual([
      ['c', 1],
      ['b', 2],
    ])
  })
})
