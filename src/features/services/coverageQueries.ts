import { useQuery } from '@tanstack/react-query'
import { fetchServicesCoverage } from '@/api/serviceCoverage'
import { servicesKeys } from '@/features/services/queries'

/**
 * Cobertura de los servicios de una lista (OF-04): una sola consulta por
 * lista. La clave cuelga de `servicesKeys.all`, así que cualquier cambio de
 * servicio la invalida; además se refresca cada 60 s como el resto de las
 * listas.
 */
export function useServicesCoverageQuery(serviceIds: string[]) {
  const key = [...serviceIds].sort()
  return useQuery({
    queryKey: [...servicesKeys.all, 'coverage', key] as const,
    queryFn: () => fetchServicesCoverage(key),
    enabled: key.length > 0,
    refetchInterval: 60_000,
  })
}
