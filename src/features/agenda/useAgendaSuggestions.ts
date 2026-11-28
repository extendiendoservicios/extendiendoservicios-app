import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as sitesApi from '@/api/sites'
import { useClientsQuery } from '@/features/clients/queries'
import { sitesKeys } from '@/features/sites/queries'
import { useActiveEmployeeOptionsQuery } from '@/features/employees/queries'

/**
 * Sugerencias de los campos libres de la Agenda (AG-07): sedes para «Lugar»,
 * clientes para «Cliente/Persona» y empleados para «Personas». Reusa las listas
 * que ya cargan Clientes y Empleados; no guarda ningún vínculo.
 */
export interface AgendaSuggestions {
  places: string[]
  clients: string[]
  employees: string[]
}

export function useAgendaSuggestions(): AgendaSuggestions {
  const clientsQuery = useClientsQuery({ status: 'all' })
  const employeesQuery = useActiveEmployeeOptionsQuery()
  const sitesQuery = useQuery({
    queryKey: sitesKeys.map({}),
    queryFn: () => sitesApi.fetchSitesForMap({}),
    staleTime: 60_000,
  })

  const clientRows = clientsQuery.data
  const employeeRows = employeesQuery.data
  const siteRows = sitesQuery.data

  return useMemo(
    () => ({
      places: [...new Set((siteRows ?? []).map((site) => site.name))],
      clients: [
        ...new Set(
          (clientRows ?? []).map(
            (client) => client.tradeName ?? client.legalName,
          ),
        ),
      ],
      employees: (employeeRows ?? []).map((employee) => employee.name),
    }),
    [clientRows, employeeRows, siteRows],
  )
}
