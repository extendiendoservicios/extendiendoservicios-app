import type { AdminUserRow, Role } from '@/api/users'

/**
 * Lógica pura del listado de Configuración → Usuarios (ADM-27), sin React,
 * para testearla sin renderizar `UsersPage`: búsqueda, filtros por rol y
 * estado, «Sin ficha laboral», orden y lectura/escritura de los parámetros de
 * la URL (OG-12, P29.4). Antes de P29 acá vivía solo el interruptor «Mostrar
 * desactivados» (P07.7, USERS-008): el estado «Activos / Desactivados / Todos»
 * lo reemplaza y mantiene el mismo default (solo activos, decisión de Mike
 * del 23 sep 2026).
 *
 * Todo se calcula en el cliente sobre la lista ya cargada: `fetchUsers` trae
 * todos los perfiles en una consulta liviana (decenas de filas, P-040, sin
 * paginado).
 */

/** Una fila del listado, con los datos del directorio (`admin_users_directory`). */
export type UserListRow = Pick<
  AdminUserRow,
  | 'profileId'
  | 'firstName'
  | 'lastName'
  | 'deletedAt'
  | 'roles'
  | 'hasEmployeeRecord'
> & {
  /** Legajo (`employees.employee_number`), o `null` si no tiene ficha laboral. */
  employeeNumber: number | null
  dni: string | null
  /** `null` si quien mira no puede verlo (o si la RPC falló). */
  email: string | null
  /** Último inicio de sesión (solo lo lee la dirección). */
  lastSignInAt: string | null
}

export type UserStatusFilter = 'active' | 'deactivated' | 'all'
export type UserSortKey = 'legajo' | 'name' | 'lastSignIn'
export type UserSortDirection = 'asc' | 'desc'

export interface UserListState {
  search: string
  roles: Role[]
  status: UserStatusFilter
  noEmployeeRecord: boolean
  sortKey: UserSortKey
  sortDirection: UserSortDirection
}

export const DEFAULT_USER_LIST_STATE: UserListState = {
  search: '',
  roles: [],
  status: 'active',
  noEmployeeRecord: false,
  sortKey: 'legajo',
  sortDirection: 'asc',
}

/** Roles del filtro, en el orden y con los nombres que pidió la dirección (OG-12). */
export const USER_FILTER_ROLES: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Dirección' },
  { value: 'admin', label: 'Administración' },
  { value: 'supervisor', label: 'Coordinación' },
  { value: 'employee', label: 'Empleado' },
]

export const USER_STATUS_OPTIONS: { value: UserStatusFilter; label: string }[] =
  [
    { value: 'active', label: 'Activos' },
    { value: 'deactivated', label: 'Desactivados' },
    { value: 'all', label: 'Todos' },
  ]

export const USER_SORT_LABELS: Record<UserSortKey, string> = {
  legajo: 'Legajo',
  name: 'Nombre',
  lastSignIn: 'Último ingreso',
}

/** Minúsculas y sin tildes, para comparar «Gómez» con «gomez». */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Busca por nombre, apellido, legajo, DNI o email. Cada palabra escrita tiene
 * que aparecer en alguno de esos campos (así «ana gomez» encuentra a Ana
 * Gómez). El DNI se compara también sin puntos.
 */
export function matchesUserSearch(
  row: Pick<
    UserListRow,
    'firstName' | 'lastName' | 'employeeNumber' | 'dni' | 'email'
  >,
  search: string,
): boolean {
  const words = normalizeSearchText(search).split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return true
  }
  const haystack = [
    normalizeSearchText(`${row.firstName} ${row.lastName}`),
    normalizeSearchText(`${row.lastName} ${row.firstName}`),
    row.employeeNumber != null ? String(row.employeeNumber) : '',
    (row.dni ?? '').replace(/[.\s-]/g, ''),
    normalizeSearchText(row.email ?? ''),
  ]
  return words.every((word) => {
    const bare = word.replace(/[.]/g, '')
    return haystack.some(
      (field) =>
        field.includes(word) || (bare !== word && field.includes(bare)),
    )
  })
}

/** Estado del filtro «Activos / Desactivados / Todos». */
export function filterUsersByStatus<T extends Pick<AdminUserRow, 'deletedAt'>>(
  rows: T[],
  status: UserStatusFilter,
): T[] {
  if (status === 'all') {
    return rows
  }
  return rows.filter((row) =>
    status === 'active' ? row.deletedAt == null : row.deletedAt != null,
  )
}

/** Varios roles a la vez: alcanza con tener alguno de los elegidos. Sin roles elegidos, no filtra. */
export function filterUsersByRoles<T extends Pick<AdminUserRow, 'roles'>>(
  rows: T[],
  roles: Role[],
): T[] {
  if (roles.length === 0) {
    return rows
  }
  return rows.filter((row) => row.roles.some((role) => roles.includes(role)))
}

/** «Sin ficha laboral»: quien no tiene fila en `employees`. */
export function filterUsersWithoutEmployeeRecord<
  T extends Pick<AdminUserRow, 'hasEmployeeRecord'>,
>(rows: T[], enabled: boolean): T[] {
  return enabled ? rows.filter((row) => !row.hasEmployeeRecord) : rows
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' })
}

function compareByName(a: UserListRow, b: UserListRow): number {
  return (
    compareText(a.lastName, b.lastName) ||
    compareText(a.firstName, b.firstName) ||
    a.profileId.localeCompare(b.profileId)
  )
}

/**
 * Orden del listado. Por legajo (default) y por último ingreso, quien no tiene
 * el dato va **siempre al final** (sea cual sea la dirección), ordenado por
 * apellido. Por nombre se ordena por apellido y nombre.
 */
export function sortUsers<T extends UserListRow>(
  rows: T[],
  key: UserSortKey,
  direction: UserSortDirection,
): T[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'name') {
      return sign * compareByName(a, b)
    }
    if (key === 'legajo') {
      if (a.employeeNumber == null || b.employeeNumber == null) {
        if (a.employeeNumber == null && b.employeeNumber == null) {
          return compareByName(a, b)
        }
        return a.employeeNumber == null ? 1 : -1
      }
      return sign * (a.employeeNumber - b.employeeNumber) || compareByName(a, b)
    }
    if (a.lastSignInAt == null || b.lastSignInAt == null) {
      if (a.lastSignInAt == null && b.lastSignInAt == null) {
        return compareByName(a, b)
      }
      return a.lastSignInAt == null ? 1 : -1
    }
    return (
      sign * (Date.parse(a.lastSignInAt) - Date.parse(b.lastSignInAt)) ||
      compareByName(a, b)
    )
  })
}

/** Aplica búsqueda, filtros y orden, en ese orden. */
export function applyUserList<T extends UserListRow>(
  rows: T[],
  state: UserListState,
): T[] {
  let result = filterUsersByStatus(rows, state.status)
  result = filterUsersByRoles(result, state.roles)
  result = filterUsersWithoutEmployeeRecord(result, state.noEmployeeRecord)
  result = result.filter((row) => matchesUserSearch(row, state.search))
  return sortUsers(result, state.sortKey, state.sortDirection)
}

// -------------------------------------------------------------------------
// Parámetros de la URL: `q`, `roles`, `estado`, `sinficha`, `orden`, `dir`.
// Lo que vale el default no se escribe, así la dirección queda limpia.
// -------------------------------------------------------------------------

const STATUS_PARAM: Record<UserStatusFilter, string> = {
  active: 'activos',
  deactivated: 'desactivados',
  all: 'todos',
}
const SORT_PARAM: Record<UserSortKey, string> = {
  legajo: 'legajo',
  name: 'nombre',
  lastSignIn: 'ingreso',
}

export function parseUserListParams(params: URLSearchParams): UserListState {
  const validRoles = USER_FILTER_ROLES.map((role) => role.value)
  const roles = (params.get('roles') ?? '')
    .split(',')
    .filter((value): value is Role => validRoles.includes(value as Role))
  const status =
    (Object.keys(STATUS_PARAM) as UserStatusFilter[]).find(
      (key) => STATUS_PARAM[key] === params.get('estado'),
    ) ?? DEFAULT_USER_LIST_STATE.status
  const sortKey =
    (Object.keys(SORT_PARAM) as UserSortKey[]).find(
      (key) => SORT_PARAM[key] === params.get('orden'),
    ) ?? DEFAULT_USER_LIST_STATE.sortKey
  return {
    search: params.get('q') ?? '',
    roles,
    status,
    noEmployeeRecord: params.get('sinficha') === '1',
    sortKey,
    sortDirection: params.get('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** Reescribe solo los parámetros del listado y respeta cualquier otro de la URL. */
export function buildUserListParams(
  state: UserListState,
  current: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const name of ['q', 'roles', 'estado', 'sinficha', 'orden', 'dir']) {
    next.delete(name)
  }
  if (state.search.trim()) {
    next.set('q', state.search)
  }
  if (state.roles.length > 0) {
    next.set('roles', state.roles.join(','))
  }
  if (state.status !== DEFAULT_USER_LIST_STATE.status) {
    next.set('estado', STATUS_PARAM[state.status])
  }
  if (state.noEmployeeRecord) {
    next.set('sinficha', '1')
  }
  if (state.sortKey !== DEFAULT_USER_LIST_STATE.sortKey) {
    next.set('orden', SORT_PARAM[state.sortKey])
  }
  if (state.sortDirection !== DEFAULT_USER_LIST_STATE.sortDirection) {
    next.set('dir', 'desc')
  }
  return next
}
