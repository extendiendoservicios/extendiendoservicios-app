import { describe, expect, it } from 'vitest'
import {
  filterEmployeesByClient,
  filterEmployeesByDefaultStatus,
} from './employeeListFilters'

/**
 * EMP-002: filtro "cliente habilitado" de ADM-16 (P-034, "lista vacía =
 * habilitado para todos"), sin red ni `DataTable`.
 */
const rows = [
  { profileId: 'e1' }, // sin filas en employee_client_permissions -> habilitado para todos
  { profileId: 'e2' }, // habilitado solo para el cliente c1
  { profileId: 'e3' }, // habilitado solo para el cliente c2
]

const permissions = new Map<string, string[]>([
  ['e2', ['c1']],
  ['e3', ['c2']],
])

describe('filterEmployeesByClient', () => {
  it('con "all" devuelve todas las filas sin tocar', () => {
    expect(filterEmployeesByClient(rows, 'all', permissions)).toEqual(rows)
  })

  it('un empleado sin filas de permisos pasa el filtro para cualquier cliente', () => {
    const result = filterEmployeesByClient(rows, 'c2', permissions)
    expect(result.map((r) => r.profileId)).toContain('e1')
  })

  it('un empleado con permisos solo pasa para los clientes que tiene habilitados', () => {
    const forC1 = filterEmployeesByClient(rows, 'c1', permissions)
    expect(forC1.map((r) => r.profileId).sort()).toEqual(['e1', 'e2'])

    const forC2 = filterEmployeesByClient(rows, 'c2', permissions)
    expect(forC2.map((r) => r.profileId).sort()).toEqual(['e1', 'e3'])
  })
})

/**
 * Decisión de Mike del 24 sep 2026: por defecto ADM-16 solo muestra activos
 * y de licencia; las bajas se ven eligiendo el filtro "Baja" a propósito.
 */
describe('filterEmployeesByDefaultStatus', () => {
  const statusRows = [
    { profileId: 'e1', effectiveStatus: 'active' as const },
    { profileId: 'e2', effectiveStatus: 'on_leave' as const },
    { profileId: 'e3', effectiveStatus: 'terminated' as const },
  ]

  it('con "all" (por omisión) saca las bajas', () => {
    const result = filterEmployeesByDefaultStatus(statusRows, 'all')
    expect(result.map((r) => r.profileId).sort()).toEqual(['e1', 'e2'])
  })

  it('elegir "terminated" a propósito sigue mostrando solo las bajas (no toca la fila ya filtrada por el servidor)', () => {
    const result = filterEmployeesByDefaultStatus(statusRows, 'terminated')
    expect(result).toEqual(statusRows)
  })

  it('elegir "active" o "on_leave" no filtra nada más (ya vino filtrado del servidor)', () => {
    expect(filterEmployeesByDefaultStatus(statusRows, 'active')).toEqual(
      statusRows,
    )
  })
})
