import { describe, expect, it } from 'vitest'
import { groupSearchResults, searchResultPath } from './useGlobalSearch'

/**
 * `useGlobalSearch.ts` (EMP-012): agrupado de las filas de `v_search` y
 * ruta de cada resultado, sin red (la consulta en sí la cubre
 * `GlobalSearch.test.tsx`, con `supabase` simulado).
 */

describe('groupSearchResults', () => {
  it('agrupa por tipo en el orden fijo: empleados, clientes y sedes', () => {
    const groups = groupSearchResults([
      {
        kind: 'site',
        id: 'sede-1',
        title: 'San Isidro',
        subtitle: 'Grupo Norte',
      },
      {
        kind: 'employee',
        id: 'emp-1',
        title: 'María Gómez',
        subtitle: 'Legajo 42',
      },
      {
        kind: 'client',
        id: 'cli-1',
        title: 'Grupo Norte',
        subtitle: 'Grupo Norte SA',
      },
    ])

    expect(groups.map((group) => group.kind)).toEqual([
      'employee',
      'client',
      'site',
    ])
    expect(groups[0]!.label).toBe('Empleados')
    expect(groups[0]!.items).toEqual([
      {
        kind: 'employee',
        id: 'emp-1',
        title: 'María Gómez',
        subtitle: 'Legajo 42',
      },
    ])
    expect(groups[1]!.label).toBe('Clientes')
    expect(groups[2]!.label).toBe('Sedes')
  })

  it('siempre devuelve los tres grupos, vacíos si no hay resultados de ese tipo', () => {
    const groups = groupSearchResults([
      {
        kind: 'employee',
        id: 'emp-1',
        title: 'María Gómez',
        subtitle: 'Legajo 42',
      },
    ])

    expect(groups.find((group) => group.kind === 'client')!.items).toEqual([])
    expect(groups.find((group) => group.kind === 'site')!.items).toEqual([])
  })

  it('descarta filas sin id (nunca deberían llegar, pero no tienen a dónde navegar)', () => {
    const groups = groupSearchResults([
      { kind: 'employee', id: null, title: 'Sin id', subtitle: null },
    ])
    expect(groups.find((group) => group.kind === 'employee')!.items).toEqual([])
  })
})

describe('searchResultPath', () => {
  it('arma la ruta de la ficha según el tipo de resultado', () => {
    expect(
      searchResultPath({
        kind: 'employee',
        id: 'emp-1',
        title: '',
        subtitle: null,
      }),
    ).toBe('/admin/empleados/emp-1')
    expect(
      searchResultPath({
        kind: 'client',
        id: 'cli-1',
        title: '',
        subtitle: null,
      }),
    ).toBe('/admin/clientes/cli-1')
    expect(
      searchResultPath({
        kind: 'site',
        id: 'sede-1',
        title: '',
        subtitle: null,
      }),
    ).toBe('/admin/sedes/sede-1')
  })
})
