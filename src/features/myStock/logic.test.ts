import { describe, expect, it } from 'vitest'
import type { SupplyCatalogItem, WithdrawalShiftOption } from '@/api/myStock'
import {
  ALL_CATEGORIES,
  cartAdd,
  cartLines,
  cartRemove,
  cartSetQty,
  cartTotal,
  catalogCategories,
  filterCatalog,
  filterShiftOptions,
  isSelectableForWithdrawal,
  normalizeText,
  splitByPriority,
  stockBasePath,
  supplyLabel,
  type Cart,
} from './logic'

function item(overrides: Partial<SupplyCatalogItem>): SupplyCatalogItem {
  return {
    id: 's1',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    categoryId: 'c1',
    categoryName: 'Químicos',
    categorySortOrder: 1,
    imagePath: null,
    outOfStock: false,
    ...overrides,
  }
}

const CATALOG = [
  item({}),
  item({ id: 's2', code: 'QUI-002', name: 'Lavandina', presentation: '5 L' }),
  item({
    id: 's3',
    code: 'DES-001',
    name: 'Bolsas de residuos',
    presentation: null,
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 2,
    outOfStock: true,
  }),
]

describe('catálogo', () => {
  it('normaliza tildes y mayúsculas', () => {
    expect(normalizeText('  Lavandína ')).toBe('lavandina')
  })

  it('busca por código, nombre y presentación', () => {
    expect(filterCatalog(CATALOG, 'des-001').map((i) => i.id)).toEqual(['s3'])
    expect(filterCatalog(CATALOG, 'lavandina').map((i) => i.id)).toEqual([
      's1',
      's2',
    ])
    expect(filterCatalog(CATALOG, '5 l').map((i) => i.id)).toEqual(['s2'])
  })

  it('filtra por categoría', () => {
    expect(filterCatalog(CATALOG, '', 'c2').map((i) => i.id)).toEqual(['s3'])
    expect(filterCatalog(CATALOG, '', ALL_CATEGORIES)).toHaveLength(3)
  })

  it('lista las categorías en el orden de la administración', () => {
    expect(catalogCategories(CATALOG)).toEqual([
      { id: 'c1', name: 'Químicos' },
      { id: 'c2', name: 'Descartables' },
    ])
  })

  it('arma el nombre con la presentación', () => {
    expect(supplyLabel({ name: 'Lavandina', presentation: '5 L' })).toBe(
      'Lavandina · 5 L',
    )
    expect(supplyLabel({ name: 'Guantes', presentation: null })).toBe('Guantes')
  })

  it('un artículo «Sin stock» no se puede elegir para un retiro', () => {
    expect(isSelectableForWithdrawal(CATALOG[0] as SupplyCatalogItem)).toBe(
      true,
    )
    expect(isSelectableForWithdrawal(CATALOG[2] as SupplyCatalogItem)).toBe(
      false,
    )
  })
})

describe('armado del retiro', () => {
  it('agrega con cantidad 1 y no duplica', () => {
    let cart: Cart = new Map()
    cart = cartAdd(cart, 's1')
    cart = cartAdd(cart, 's1')
    expect(cartLines(cart)).toEqual([{ supplyId: 's1', qty: 1 }])
  })

  it('cambia la cantidad, siempre entera y de 1 en adelante', () => {
    let cart = cartAdd(new Map(), 's1')
    cart = cartSetQty(cart, 's1', 4)
    expect(cart.get('s1')).toBe(4)
    expect(cartSetQty(cart, 's1', 0).get('s1')).toBe(1)
    expect(cartSetQty(cart, 's1', 2.9).get('s1')).toBe(2)
    expect(cartSetQty(cart, 'otro', 5).has('otro')).toBe(false)
  })

  it('quita artículos y suma el total', () => {
    let cart = cartAdd(cartAdd(new Map(), 's1'), 's2')
    cart = cartSetQty(cart, 's2', 3)
    expect(cartTotal(cart)).toBe(4)
    cart = cartRemove(cart, 's1')
    expect(cartLines(cart)).toEqual([{ supplyId: 's2', qty: 3 }])
  })

  it('no muta el mapa anterior', () => {
    const before: Cart = new Map([['s1', 1]])
    cartAdd(before, 's2')
    cartSetQty(before, 's1', 5)
    expect(before.get('s1')).toBe(1)
    expect(before.size).toBe(1)
  })
})

describe('turnos', () => {
  function shift(
    overrides: Partial<WithdrawalShiftOption>,
  ): WithdrawalShiftOption {
    return {
      shiftId: 'sh1',
      shiftDate: '2026-10-26',
      startTime: '08:00:00',
      endTime: '12:00:00',
      startsAt: null,
      openEnded: false,
      clientName: 'Limpiadora SRL',
      siteId: 'si1',
      siteName: 'Sede Centro',
      isAssigned: false,
      isPriority: false,
      ...overrides,
    }
  }

  it('«Mis sedes» primero y el resto después, en el orden recibido', () => {
    const options = [
      shift({ shiftId: 'a' }),
      shift({ shiftId: 'b', isPriority: true }),
      shift({ shiftId: 'c' }),
    ]
    const { mine, others } = splitByPriority(options)
    expect(mine.map((o) => o.shiftId)).toEqual(['b'])
    expect(others.map((o) => o.shiftId)).toEqual(['a', 'c'])
  })

  it('busca por cliente o sede', () => {
    const options = [
      shift({ shiftId: 'a' }),
      shift({
        shiftId: 'b',
        clientName: 'Banco Sur',
        siteName: 'Casa Central',
      }),
    ]
    expect(filterShiftOptions(options, 'banco').map((o) => o.shiftId)).toEqual([
      'b',
    ])
    expect(filterShiftOptions(options, 'centro').map((o) => o.shiftId)).toEqual(
      ['a'],
    )
    expect(filterShiftOptions(options, '')).toHaveLength(2)
  })
})

describe('stockBasePath', () => {
  it('distingue la vía del coordinador de la del empleado', () => {
    expect(stockBasePath('/sup/insumos')).toBe('/sup')
    expect(stockBasePath('/sup')).toBe('/sup')
    expect(stockBasePath('/app/insumos/retirar')).toBe('/app')
  })
})
