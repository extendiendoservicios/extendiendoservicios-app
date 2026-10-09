import type { EmployeeEffectiveStatus, EmployeeListRow } from '@/api/employees'

/**
 * EMP-002: filtro "cliente habilitado" de ADM-16, sin React -- as铆 se
 * testea sin `fetchEmployees` ni `DataTable`. Regla de P-034 (`04_Modelo_de
 * _Datos.md` secci贸n 2.1): "Lista vac铆a = habilitado para todos" -- un
 * empleado sin filas en `employee_client_permissions` (no aparece como
 * clave del mapa que arma `fetchEmployeeClientPermissions`) est谩 habilitado
 * para cualquier cliente, as铆 que pasa el filtro sin importar cu谩l se elija.
 */
export function filterEmployeesByClient<T extends { profileId: string }>(
  rows: T[],
  clientId: string,
  clientIdsByEmployeeId: Map<string, string[]>,
): T[] {
  if (clientId === 'all') {
    return rows
  }
  return rows.filter((row) => {
    const enabledClientIds = clientIdsByEmployeeId.get(row.profileId)
    return !enabledClientIds || enabledClientIds.includes(clientId)
  })
}

/**
 * Decisi贸n de Mike del 24 sep 2026: por defecto ADM-16 solo muestra activos
 * y de licencia -- mismo criterio que ADM-27 ("Mostrar desactivados"), pero
 * ac谩 el filtro de estado ya existe como `Select` (no un interruptor): el
 * valor `'all'` ("Todos los estados") deja de traer literalmente todos los
 * estados y pasa a significar "activos y de licencia"; para ver las bajas
 * hay que elegir el filtro "Baja" a prop贸sito (`EMPLOYEE_STATUS_FILTER_
 * OPTIONS`, `EmployeesPage.tsx`). Elegir "Baja" expl铆citamente sigue
 * andando porque esta funci贸n no toca nada cuando `statusFilter !== 'all'`
 * -- ese caso ya lo filtr贸 `fetchEmployees` en el servidor.
 */
export function filterEmployeesByDefaultStatus<
  T extends { effectiveStatus: EmployeeEffectiveStatus },
>(rows: T[], statusFilter: EmployeeEffectiveStatus | 'all'): T[] {
  if (statusFilter !== 'all') {
    return rows
  }
  return rows.filter((row) => row.effectiveStatus !== 'terminated')
}

/** Etiquetas de `06_API.md` secci贸n 3 / `05` l铆nea 65 para el selector de rol de ADM-16. */
export const EMPLOYEE_ROLE_FILTER_OPTIONS: {
  value: 'all' | 'employee' | 'supervisor'
  label: string
}[] = [
  { value: 'all', label: 'Todos los roles' },
  { value: 'employee', label: 'Empleado' },
  { value: 'supervisor', label: 'Supervisor' },
]

export type { EmployeeListRow }

/**
 * AJ2-01: el listado de empleados va siempre por n鷐ero de legajo
 * ascendente (sin mutar la lista de entrada). Es el orden por defecto, el de
 * las tarjetas del celular y el que queda despu閟 de buscar o filtrar.
 */
export function sortByEmployeeNumber<T extends { employeeNumber: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => a.employeeNumber - b.employeeNumber)
}
