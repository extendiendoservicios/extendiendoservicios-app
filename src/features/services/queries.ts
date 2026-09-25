import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as servicesApi from '@/api/services'
import type { ServiceFormInput, ServiceStatus } from '@/api/services'
import { clientsKeys } from '@/features/clients/queries'

/**
 * Hooks de TanStack Query de ADM-21, ADM-22 y ADM-25 (SERVICE-001). Patrón
 * de `src/api/README.md`, igual que `src/features/sites/queries.ts`.
 *
 * Sin polling: la lista de servicios de un cliente o de una sede es una
 * lectura de una pestaña/sección que se abre a demanda (mismo criterio que
 * `sitesKeys.detail`), no el tablero ni "Asistencia de hoy"
 * (`02_Decisiones.md` P-005). El detalle y el formulario (ADM-25) tampoco
 * llevan polling.
 */

export const servicesKeys = {
  all: ['services'] as const,
  byClient: (clientId: string) =>
    [...servicesKeys.all, 'byClient', clientId] as const,
  bySite: (siteId: string) => [...servicesKeys.all, 'bySite', siteId] as const,
  detail: (id: string) => [...servicesKeys.all, 'detail', id] as const,
}

// -------------------------------------------------------------------------
// Listas de ADM-21 y ADM-22
// -------------------------------------------------------------------------

export function useServicesByClientQuery(clientId: string | undefined) {
  return useQuery({
    queryKey: servicesKeys.byClient(clientId ?? ''),
    queryFn: () => servicesApi.fetchServicesByClient(clientId as string),
    enabled: clientId != null,
  })
}

export function useServicesBySiteQuery(siteId: string | undefined) {
  return useQuery({
    queryKey: servicesKeys.bySite(siteId ?? ''),
    queryFn: () => servicesApi.fetchServicesBySite(siteId as string),
    enabled: siteId != null,
  })
}

// -------------------------------------------------------------------------
// Detalle y formulario (ADM-25)
// -------------------------------------------------------------------------

export function useServiceDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: servicesKeys.detail(id ?? ''),
    queryFn: () => servicesApi.fetchServiceDetail(id as string),
    enabled: id != null,
  })
}

/**
 * Al crear, editar o cambiar el estado de un servicio hay que invalidar el
 * detalle propio, el conteo de servicios activos de `v_clients` (ADM-19) y
 * las dos listas donde se ve un servicio (pestaña Servicios de ADM-21,
 * `servicesKeys.byClient`; sección Servicios de ADM-22,
 * `servicesKeys.bySite`). `clientIds`/`siteIds` recibe uno o dos valores:
 * en la edición, el cliente o la sede pueden haber cambiado, así que se
 * invalida tanto el valor anterior como el nuevo, no solo el que quedó.
 */
function invalidateServiceQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  clientIds: readonly string[],
  siteIds: readonly string[],
) {
  void queryClient.invalidateQueries({ queryKey: servicesKeys.all })
  void queryClient.invalidateQueries({ queryKey: clientsKeys.all })
  for (const clientId of new Set(clientIds)) {
    void queryClient.invalidateQueries({
      queryKey: servicesKeys.byClient(clientId),
    })
  }
  for (const siteId of new Set(siteIds)) {
    void queryClient.invalidateQueries({
      queryKey: servicesKeys.bySite(siteId),
    })
  }
}

export function useCreateServiceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: ServiceFormInput
      createdBy: string
    }) => servicesApi.createService(input, createdBy),
    onSuccess: (service) => {
      invalidateServiceQueries(
        queryClient,
        [service.clientId],
        [service.siteId],
      )
    },
  })
}

/**
 * `previousClientId`/`previousSiteId`: el cliente y la sede del servicio
 * antes de esta edición (los que ya tenía cargados el formulario) — hace
 * falta para invalidar también esas listas si el servicio cambió de sede.
 */
export function useUpdateServiceMutation(
  previousClientId: string,
  previousSiteId: string,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
      updatedBy,
    }: {
      id: string
      input: ServiceFormInput
      updatedBy: string
    }) => servicesApi.updateService(id, input, updatedBy),
    onSuccess: (service) => {
      invalidateServiceQueries(
        queryClient,
        [previousClientId, service.clientId],
        [previousSiteId, service.siteId],
      )
      queryClient.setQueryData(servicesKeys.detail(service.id), service)
    },
  })
}

/**
 * SERVICE-004: pausar, reactivar o finalizar desde ADM-21/ADM-22.
 * `setServiceStatus` devuelve el servicio completo (con `clientId`/
 * `siteId`), así que no hace falta pasarle el contexto a este hook: alcanza
 * con lo que devuelve la propia mutación.
 */
export function useSetServiceStatusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      updatedBy,
    }: {
      id: string
      status: ServiceStatus
      updatedBy: string
    }) => servicesApi.setServiceStatus(id, status, updatedBy),
    onSuccess: (service) => {
      invalidateServiceQueries(
        queryClient,
        [service.clientId],
        [service.siteId],
      )
      queryClient.setQueryData(servicesKeys.detail(service.id), service)
    },
  })
}
