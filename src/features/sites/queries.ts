import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as sitesApi from '@/api/sites'
import type { SiteFormInput, SiteMapFilters, SiteStatus } from '@/api/sites'
import { clientsKeys } from '@/features/clients/queries'

/**
 * Hooks de TanStack Query de ADM-22, ADM-23 y ADM-24 (SITE-001). Patrón de
 * `src/api/README.md`, igual que `src/features/clients/queries.ts`.
 *
 * Polling: el mapa de sedes (ADM-24) es una lista más, no el tablero ni
 * "Asistencia de hoy" (`02_Decisiones.md` P-005: 30 s ahí, 60 s "en el
 * resto de las listas") — 60 s acá. El detalle (ADM-22) y el formulario
 * (ADM-23) son lecturas puntuales de una pantalla que se abre a demanda:
 * sin polling. Las opciones del filtro "Cliente" tampoco llevan polling:
 * son una lista de referencia, no un tablero.
 */

const MAP_POLLING_MS = 60_000

export const sitesKeys = {
  all: ['sites'] as const,
  detail: (id: string) => [...sitesKeys.all, 'detail', id] as const,
  map: (filters: SiteMapFilters) => [...sitesKeys.all, 'map', filters] as const,
  clientOptions: () => [...sitesKeys.all, 'clientOptions'] as const,
}

// -------------------------------------------------------------------------
// Detalle y formulario (ADM-22, ADM-23)
// -------------------------------------------------------------------------

export function useSiteDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: sitesKeys.detail(id ?? ''),
    queryFn: () => sitesApi.fetchSiteDetail(id as string),
    enabled: id != null,
  })
}

/**
 * Al crear, editar o cambiar el estado de una sede hay que invalidar tanto
 * el detalle propio como el listado de sedes del cliente (pestaña Sedes de
 * ADM-21, `clientsKeys.sites`) y el mapa (ADM-24): todos muestran los
 * mismos datos desde consultas distintas.
 */
function useInvalidateSite(clientId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: sitesKeys.all })
    void queryClient.invalidateQueries({
      queryKey: clientsKeys.sites(clientId),
    })
  }
}

export function useCreateSiteMutation(clientId: string) {
  const invalidate = useInvalidateSite(clientId)
  return useMutation({
    mutationFn: ({
      input,
      createdBy,
    }: {
      input: SiteFormInput
      createdBy: string
    }) => sitesApi.createSite(clientId, input, createdBy),
    onSuccess: invalidate,
  })
}

export function useUpdateSiteMutation(clientId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateSite(clientId)
  return useMutation({
    mutationFn: ({
      id,
      input,
      updatedBy,
    }: {
      id: string
      input: SiteFormInput
      updatedBy: string
    }) => sitesApi.updateSite(id, input, updatedBy),
    onSuccess: (site) => {
      invalidate()
      queryClient.setQueryData(sitesKeys.detail(site.id), site)
    },
  })
}

/** SITE-006: cambio de estado desde ADM-22. */
export function useSetSiteStatusMutation(clientId: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateSite(clientId)
  return useMutation({
    mutationFn: ({
      id,
      status,
      updatedBy,
    }: {
      id: string
      status: SiteStatus
      updatedBy: string
    }) => sitesApi.setSiteStatus(id, status, updatedBy),
    onSuccess: (site) => {
      invalidate()
      queryClient.setQueryData(sitesKeys.detail(site.id), site)
    },
  })
}

// -------------------------------------------------------------------------
// Mapa de sedes (ADM-24)
// -------------------------------------------------------------------------

export function useSitesMapQuery(filters: SiteMapFilters) {
  return useQuery({
    queryKey: sitesKeys.map(filters),
    queryFn: () => sitesApi.fetchSitesForMap(filters),
    staleTime: MAP_POLLING_MS,
    refetchInterval: MAP_POLLING_MS,
  })
}

export function useClientFilterOptionsQuery() {
  return useQuery({
    queryKey: sitesKeys.clientOptions(),
    queryFn: sitesApi.fetchClientFilterOptions,
    staleTime: 5 * 60_000,
  })
}
