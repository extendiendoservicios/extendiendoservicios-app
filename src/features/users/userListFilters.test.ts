import { describe, expect, it } from 'vitest'
import { filterUsersByStatus } from './userListFilters'

/** P07.7 (USERS-008): lógica del interruptor "Mostrar desactivados". */

const activeUser = { deletedAt: null }
const deactivatedUser = { deletedAt: '2026-09-01T00:00:00.000Z' }

describe('filterUsersByStatus', () => {
  it('con el interruptor apagado, deja afuera a los desactivados', () => {
    const result = filterUsersByStatus([activeUser, deactivatedUser], false)
    expect(result).toEqual([activeUser])
  })

  it('con el interruptor prendido, muestra activos y desactivados', () => {
    const result = filterUsersByStatus([activeUser, deactivatedUser], true)
    expect(result).toEqual([activeUser, deactivatedUser])
  })

  it('con el interruptor apagado y todos desactivados, no queda nadie', () => {
    const result = filterUsersByStatus([deactivatedUser], false)
    expect(result).toEqual([])
  })

  it('con la lista vacía, no rompe en ningún estado del interruptor', () => {
    expect(filterUsersByStatus([], false)).toEqual([])
    expect(filterUsersByStatus([], true)).toEqual([])
  })
})
