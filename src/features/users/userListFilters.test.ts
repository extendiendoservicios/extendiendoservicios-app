import { describe, expect, it } from 'vitest'
import {
  applyUserList,
  buildUserListParams,
  DEFAULT_USER_LIST_STATE,
  filterUsersByRoles,
  filterUsersByStatus,
  filterUsersWithoutEmployeeRecord,
  matchesUserSearch,
  parseUserListParams,
  sortUsers,
  type UserListRow,
} from './userListFilters'

/** OG-12 (P29.4): búsqueda, filtros, orden y parámetros de la URL del listado de usuarios. */

function user(
  overrides: Partial<UserListRow> & { profileId: string },
): UserListRow {
  return {
    firstName: 'Nombre',
    lastName: 'Apellido',
    deletedAt: null,
    roles: ['employee'],
    hasEmployeeRecord: true,
    employeeNumber: null,
    dni: null,
    email: null,
    lastSignInAt: null,
    ...overrides,
  }
}

const ana = user({
  profileId: 'a',
  firstName: 'Ana',
  lastName: 'Gómez',
  employeeNumber: 12,
  dni: '30123456',
  email: 'ana@ejemplo.com',
})
const beto = user({
  profileId: 'b',
  firstName: 'Beto',
  lastName: 'Ruiz',
  employeeNumber: 3,
  roles: ['admin'],
  lastSignInAt: '2026-11-10T10:00:00Z',
})
const tecnica = user({
  profileId: 't',
  firstName: 'Cuenta',
  lastName: 'Técnica',
  roles: ['owner'],
  hasEmployeeRecord: false,
})
const cami = user({
  profileId: 'c',
  firstName: 'Cami',
  lastName: 'Alvarez',
  deletedAt: '2026-09-01T00:00:00Z',
  employeeNumber: 7,
  roles: ['supervisor', 'employee'],
  lastSignInAt: '2026-11-12T10:00:00Z',
})

const ids = (rows: UserListRow[]) => rows.map((row) => row.profileId)

describe('filterUsersByStatus', () => {
  const rows = [ana, cami]
  it('activos deja afuera a los desactivados', () => {
    expect(filterUsersByStatus(rows, 'active')).toEqual([ana])
  })
  it('desactivados deja solo a los desactivados', () => {
    expect(filterUsersByStatus(rows, 'deactivated')).toEqual([cami])
  })
  it('todos muestra todo y la lista vacía no rompe', () => {
    expect(filterUsersByStatus(rows, 'all')).toEqual(rows)
    expect(filterUsersByStatus([], 'active')).toEqual([])
  })
})

describe('matchesUserSearch', () => {
  it('sin texto, coincide con todos', () => {
    expect(matchesUserSearch(ana, '  ')).toBe(true)
  })
  it('busca por nombre y apellido, sin tildes ni mayúsculas', () => {
    expect(matchesUserSearch(ana, 'GOMEZ')).toBe(true)
    expect(matchesUserSearch(ana, 'ana gómez')).toBe(true)
    expect(matchesUserSearch(ana, 'gomez ana')).toBe(true)
    expect(matchesUserSearch(ana, 'ruiz')).toBe(false)
  })
  it('busca por legajo, DNI (con o sin puntos) y email', () => {
    expect(matchesUserSearch(ana, '12')).toBe(true)
    expect(matchesUserSearch(ana, '30.123.456')).toBe(true)
    expect(matchesUserSearch(ana, '3012')).toBe(true)
    expect(matchesUserSearch(ana, 'ana@ejemplo')).toBe(true)
    expect(matchesUserSearch(beto, 'ana@ejemplo')).toBe(false)
  })
})

describe('filtros de rol y de ficha laboral', () => {
  it('varios roles a la vez: alcanza con tener alguno', () => {
    const rows = [ana, beto, tecnica, cami]
    expect(ids(filterUsersByRoles(rows, ['admin', 'owner']))).toEqual([
      'b',
      't',
    ])
    expect(filterUsersByRoles(rows, ['supervisor'])).toEqual([cami])
  })
  it('sin roles elegidos no filtra', () => {
    expect(filterUsersByRoles([ana, beto], [])).toHaveLength(2)
  })
  it('«Sin ficha laboral» deja a quien no tiene ficha', () => {
    expect(filterUsersWithoutEmployeeRecord([ana, tecnica], true)).toEqual([
      tecnica,
    ])
    expect(
      filterUsersWithoutEmployeeRecord([ana, tecnica], false),
    ).toHaveLength(2)
  })
})

describe('sortUsers', () => {
  const rows = [tecnica, ana, cami, beto]
  it('por legajo ascendente, y sin legajo al final', () => {
    expect(ids(sortUsers(rows, 'legajo', 'asc'))).toEqual(['b', 'c', 'a', 't'])
  })
  it('por legajo descendente, los sin legajo siguen al final', () => {
    expect(ids(sortUsers(rows, 'legajo', 'desc'))).toEqual(['a', 'c', 'b', 't'])
  })
  it('los sin legajo van por apellido', () => {
    const x = user({ profileId: 'x', lastName: 'Zeta' })
    const y = user({ profileId: 'y', lastName: 'Alfa' })
    expect(ids(sortUsers([x, y, ana], 'legajo', 'asc'))).toEqual([
      'a',
      'y',
      'x',
    ])
  })
  it('por nombre ordena por apellido y nombre, ignorando tildes', () => {
    expect(sortUsers(rows, 'name', 'asc').map((r) => r.lastName)).toEqual([
      'Alvarez',
      'Gómez',
      'Ruiz',
      'Técnica',
    ])
    expect(sortUsers(rows, 'name', 'desc')[0]?.lastName).toBe('Técnica')
  })
  it('por último ingreso, los que nunca entraron al final', () => {
    expect(ids(sortUsers(rows, 'lastSignIn', 'desc'))).toEqual([
      'c',
      'b',
      'a',
      't',
    ])
    expect(ids(sortUsers(rows, 'lastSignIn', 'asc'))).toEqual([
      'b',
      'c',
      'a',
      't',
    ])
  })
  it('no modifica el arreglo original', () => {
    const copy = [...rows]
    sortUsers(rows, 'name', 'asc')
    expect(rows).toEqual(copy)
  })
})

describe('applyUserList', () => {
  const rows = [tecnica, ana, cami, beto]
  it('por defecto: solo activos, por legajo', () => {
    expect(ids(applyUserList(rows, DEFAULT_USER_LIST_STATE))).toEqual([
      'b',
      'a',
      't',
    ])
  })
  it('combina búsqueda, estado y rol', () => {
    expect(
      ids(
        applyUserList(rows, {
          ...DEFAULT_USER_LIST_STATE,
          status: 'all',
          roles: ['employee'],
          search: 'alvarez',
        }),
      ),
    ).toEqual(['c'])
  })
})

describe('parámetros de la URL', () => {
  it('sin parámetros devuelve el estado por defecto', () => {
    expect(parseUserListParams(new URLSearchParams())).toEqual(
      DEFAULT_USER_LIST_STATE,
    )
  })
  it('lo que vale el default no se escribe', () => {
    expect(buildUserListParams(DEFAULT_USER_LIST_STATE).toString()).toBe('')
  })
  it('ida y vuelta de un estado completo', () => {
    const state = {
      search: 'gómez',
      roles: ['admin', 'supervisor'] as ('admin' | 'supervisor')[],
      status: 'all' as const,
      noEmployeeRecord: true,
      sortKey: 'lastSignIn' as const,
      sortDirection: 'desc' as const,
    }
    expect(parseUserListParams(buildUserListParams(state))).toEqual(state)
  })
  it('ignora valores inválidos y respeta otros parámetros de la URL', () => {
    const parsed = parseUserListParams(
      new URLSearchParams('roles=admin,cualquiera&estado=raro&orden=x'),
    )
    expect(parsed.roles).toEqual(['admin'])
    expect(parsed.status).toBe('active')
    expect(parsed.sortKey).toBe('legajo')
    const next = buildUserListParams(
      DEFAULT_USER_LIST_STATE,
      new URLSearchParams('otro=1&q=viejo'),
    )
    expect(next.toString()).toBe('otro=1')
  })
})
