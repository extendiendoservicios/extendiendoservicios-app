import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as attentionApi from '@/api/attention'
import { fetchPeopleNamesByIds } from '@/api/attendance'

/**
 * Hooks de los avisos cerrados de «Requiere atención» (P29.3, OG-02). La
 * lectura va con el mismo polling de 30 s que el resto del Resumen, así un
 * cierre de otra persona de la administración se ve sin recargar.
 */

const DISMISSALS_POLLING_MS = 30_000

export const attentionKeys = {
  all: ['attention'] as const,
  dismissals: () => [...attentionKeys.all, 'dismissals'] as const,
  people: (ids: string[]) => [...attentionKeys.all, 'people', ids] as const,
}

export function useAttentionDismissalsQuery() {
  return useQuery({
    queryKey: attentionKeys.dismissals(),
    queryFn: attentionApi.fetchAttentionDismissals,
    staleTime: DISMISSALS_POLLING_MS,
    refetchInterval: DISMISSALS_POLLING_MS,
  })
}

/** Nombres de quienes cerraron avisos (para «cerrado por …»). */
export function useDismissersQuery(profileIds: string[]) {
  const ids = Array.from(new Set(profileIds)).sort()
  return useQuery({
    queryKey: attentionKeys.people(ids),
    queryFn: () => fetchPeopleNamesByIds(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  })
}

export function useDismissAttentionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: attentionApi.dismissAttention,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: attentionKeys.dismissals() }),
  })
}

export function useReopenAttentionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: attentionApi.reopenAttention,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: attentionKeys.dismissals() }),
  })
}
