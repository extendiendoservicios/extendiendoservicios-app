import { describe, expect, it } from 'vitest'
import { describeCategoryRemoval, moveCategory } from './categories'
import { describeActiveClients, groupClientsByCategory } from './grouping'

const CATEGORIES = [
  { id: 'edificio', name: 'Edificio' },
  { id: 'empresa', name: 'Empresa' },
  { id: 'casa', name: 'Casa' },
]

describe('groupClientsByCategory', () => {
  it('agrupa en el orden de las categorías y deja «Sin categoría» al final', () => {
    const rows = [
      { id: 'a', categoryId: null },
      { id: 'b', categoryId: 'casa' },
      { id: 'c', categoryId: 'edificio' },
      { id: 'd', categoryId: 'casa' },
    ]
    const groups = groupClientsByCategory(rows, CATEGORIES)
    expect(groups.map((group) => group.label)).toEqual([
      'Edificio',
      'Casa',
      'Sin categoría',
    ])
    expect(groups[1]?.rows.map((row) => row.id)).toEqual(['b', 'd'])
    expect(groups[2]?.categoryId).toBeNull()
  })

  it('omite los grupos vacíos', () => {
    const groups = groupClientsByCategory(
      [{ id: 'a', categoryId: 'empresa' }],
      CATEGORIES,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe('Empresa')
  })

  it('una categoría que ya no existe cae en «Sin categoría»', () => {
    const groups = groupClientsByCategory(
      [{ id: 'a', categoryId: 'borrada' }],
      CATEGORIES,
    )
    expect(groups.map((group) => group.label)).toEqual(['Sin categoría'])
  })

  it('sin clientes no hay grupos', () => {
    expect(groupClientsByCategory([], CATEGORIES)).toEqual([])
  })
})

describe('describeActiveClients', () => {
  it('singular y plural', () => {
    expect(describeActiveClients(1)).toBe('1 cliente activo')
    expect(describeActiveClients(0)).toBe('0 clientes activos')
    expect(describeActiveClients(12)).toBe('12 clientes activos')
  })
})

describe('moveCategory', () => {
  it('sube y baja una posición', () => {
    expect(moveCategory(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveCategory(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
  })

  it('en los extremos no cambia nada', () => {
    expect(moveCategory(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveCategory(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
})

describe('describeCategoryRemoval', () => {
  it('avisa cuántos clientes quedan sin categoría', () => {
    expect(describeCategoryRemoval('Casa', 1)).toContain(
      '1 cliente va a quedar sin categoría',
    )
    expect(describeCategoryRemoval('Casa', 4)).toContain(
      '4 clientes van a quedar sin categoría',
    )
  })

  it('si nadie la usa, lo dice', () => {
    expect(describeCategoryRemoval('Casa', 0)).toContain('Ningún cliente')
  })
})
