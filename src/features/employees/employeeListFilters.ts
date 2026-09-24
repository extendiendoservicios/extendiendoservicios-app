import type { EmployeeListRow } from '@/api/employees'

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
