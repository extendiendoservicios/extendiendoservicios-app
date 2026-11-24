import { describe, expect, it } from 'vitest'
import { sortRowsBy } from './dataTableSort'

interface Row {
  id: string
  name?: string
  n?: number
}

const ACCESSORS = {
  name: (row: Row) => row.name,
  n: (row: Row) => row.n,
}

const ROWS: Row[] = [
  { id: 'a', name: 'bravo', n: 10 },
  { id: 'b', n: 2 },
  { id: 'c', name: 'Álvaro', n: 2 },
  { id: 'd', name: 'alfa' },
]

function ids(rows: Row[]) {
  return rows.map((row) => row.id)
}

describe('sortRowsBy', () => {
  it('sin criterio o con un criterio desconocido devuelve la lista tal cual', () => {
    expect(sortRowsBy(ROWS, [], ACCESSORS)).toBe(ROWS)
    expect(sortRowsBy(ROWS, [{ id: 'x', desc: false }], ACCESSORS)).toBe(ROWS)
  })

  it('ordena texto sin distinguir mayúsculas ni tildes, con los vacíos al final', () => {
    expect(
      ids(sortRowsBy(ROWS, [{ id: 'name', desc: false }], ACCESSORS)),
    ).toEqual(['d', 'c', 'a', 'b'])
    expect(
      ids(sortRowsBy(ROWS, [{ id: 'name', desc: true }], ACCESSORS)),
    ).toEqual(['a', 'c', 'd', 'b'])
  })

  it('ordena números y los empates conservan el orden de entrada', () => {
    expect(
      ids(sortRowsBy(ROWS, [{ id: 'n', desc: false }], ACCESSORS)),
    ).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(sortRowsBy(ROWS, [{ id: 'n', desc: true }], ACCESSORS))).toEqual(
      ['a', 'b', 'c', 'd'],
    )
  })
})
