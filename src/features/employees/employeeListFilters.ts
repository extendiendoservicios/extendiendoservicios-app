import type { EmployeeEffectiveStatus, EmployeeListRow } from '@/api/employees'

/**
 * EMP-002: filtro "cliente habilitado" de ADM-16, sin React -- así se
 * testea sin `fetchEmployees` ni `DataTable`. Regla de P-034 (`04_Modelo_de
 * _Datos.md` sección 2.1): "Lista vacía = habilitado para todos" -- un
 * empleado sin filas en `employee_client_permissions` (no aparece como
 * clave del mapa que arma `fetchEmployeeClientPermissions`) está habilitado
 * para cualquier cliente, así que pasa el filtro sin importar cuál se elija.
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
 * Decisión de Mike del 24 sep 2026: por defecto ADM-16 solo muestra activos
 * y de licencia -- mismo criterio que ADM-27 ("Mostrar desactivados"), pero
 * acá el filtro de estado ya existe como `Select` (no un interruptor): el
 * valor `'all'` ("Todos los estados") deja de traer literalmente todos los
 * estados y pasa a significar "activos y de licencia"; para ver las bajas
 * hay que elegir el filtro "Baja" a propósito (`EMPLOYEE_STATUS_FILTER_
 * OPTIONS`, `EmployeesPage.tsx`). Elegir "Baja" explícitamente sigue
 * andando porque esta función no toca nada cuando `statusFilter !== 'all'`
 * -- ese caso ya lo filtró `fetchEmployees` en el servidor.
 */
export function filterEmployeesByDefaultStatus<
  T extends { effectiveStatus: EmployeeEffectiveStatus },
>(rows: T[], statusFilter: EmployeeEffectiveStatus | 'all'): T[] {
  if (statusFilter !== 'all') {
    return rows
  }
  return rows.filter((row) => row.effectiveStatus !== 'terminated')
}

/** Etiquetas de `06_API.md` sección 3 / `05` línea 65 para el selector de rol de ADM-16. */
export const EMPLOYEE_ROLE_FILTER_OPTIONS: {
  value: 'all' | 'employee' | 'supervisor'
  label: string
}[] = [
  { value: 'all', label: 'Todos los roles' },
  { value: 'employee', label: 'Empleado' },
  { value: 'supervisor', label: 'Supervisor' },
]

export type { EmployeeListRow }
