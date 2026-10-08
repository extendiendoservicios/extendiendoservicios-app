import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as ratingsApi from '@/api/ratings'
import type { RatingListFilters, RateEmployeeInput } from '@/api/ratings'
import * as supervisionsApi from '@/api/supervisions'
import type { SupervisionListFilters } from '@/api/supervisions'

/**
 * Hooks de TanStack Query de supervisiones y calificaciones (SUP-008):
 * patrón de `src/api/README.md`, igual que `src/features/planning/queries.ts`.
 *
 * Polling 60 s en el listado administrativo de ADM-13 (`02_Decisiones.md`
 * P-005, "resto de las listas"), tanto en la pestaña "Supervisiones" como
 * en "Calificaciones" -- mismo criterio que `clients.ts`/`employees.ts`.
 * Sin polling en el detalle (ADM-15), en la sección de ADM-06 ni en la
 * pestaña "Calificaciones recibidas" de ADM-17: mismo criterio que
 * `useEmployeeAttendanceHistoryQuery` (ADM-12, historial dentro de una
 * ficha, sin polling).
 */

const LIST_POLLING_MS = 60_000

export const supervisionsKeys = {
  all: ['supervisions'] as const,
  list: (filters: SupervisionListFilters) =>
    [...supervisionsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...supervisionsKeys.all, 'detail', id] as const,
  supervisorCandidates: () =>
    [...supervisionsKeys.all, 'supervisorCandidates'] as const,
}

export const ratingsKeys = {
  all: ['ratings'] as const,
  list: (filters: RatingListFilters) =>
    [...ratingsKeys.all, 'list', filters] as const,
}

/** ADM-13, pestaña "Supervisiones" (SUP-010). */
export function useSupervisionsAdminQuery(
  filters: SupervisionListFilters,
  poll = true,
  enabled = true,
) {
  return useQuery({
    queryKey: supervisionsKeys.list(filters),
    queryFn: () => supervisionsApi.fetchSupervisionsAdmin(filters),
    staleTime: poll ? LIST_POLLING_MS : undefined,
    refetchInterval: poll ? LIST_POLLING_MS : false,
    enabled,
  })
}

/**
 * ADM-13 pestaña "Calificaciones" (SUP-010) y ADM-17 pestaña "Calificaciones
 * recibidas" (SUP-012): `poll` distingue las dos -- el listado administrativo
 * pollea, la pestaña de la ficha no (mismo criterio que ATT-013).
 */
export function useRatingsQuery(filters: RatingListFilters, poll: boolean) {
  return useQuery({
    queryKey: ratingsKeys.list(filters),
    queryFn: () => ratingsApi.fetchRatings(filters),
    staleTime: poll ? LIST_POLLING_MS : undefined,
    refetchInterval: poll ? LIST_POLLING_MS : false,
  })
}

/** ADM-15 (SUP-011) y sección "Supervisiones" de ADM-06 (SUP-012). */
export function useSupervisionDetailQuery(id: string | undefined) {
  return useQuery({
    queryKey: supervisionsKeys.detail(id ?? ''),
    queryFn: () => supervisionsApi.fetchSupervisionDetail(id as string),
    enabled: id != null,
  })
}

/** ADM-14 (SUP-009): supervisores activos para el selector. */
export function useSupervisorCandidatesQuery() {
  return useQuery({
    queryKey: supervisionsKeys.supervisorCandidates(),
    queryFn: () => supervisionsApi.fetchSupervisorCandidates(),
  })
}

/** Invalida el listado y el detalle: toda mutación de supervisiones toca `v_supervisions_admin` y/o `ratings`. */
function invalidateSupervisionsAndRatings(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: supervisionsKeys.all })
  void queryClient.invalidateQueries({ queryKey: ratingsKeys.all })
}

/** `assign_supervision` (ADM-14, SUP-009). */
export function useAssignSupervisionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      shiftId,
      supervisorId,
    }: {
      shiftId: string
      supervisorId: string
    }) => supervisionsApi.assignSupervision(shiftId, supervisorId),
    onSuccess: () => invalidateSupervisionsAndRatings(queryClient),
  })
}

/** `cancel_supervision` (ADM-15, SUP-011). */
export function useCancelSupervisionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      reason,
    }: {
      supervisionId: string
      reason: string
    }) => supervisionsApi.cancelSupervision(supervisionId, reason),
    onSuccess: () => invalidateSupervisionsAndRatings(queryClient),
  })
}

/** `mark_supervision_not_done` (ADM-15, SUP-011). */
export function useMarkSupervisionNotDoneMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      reason,
    }: {
      supervisionId: string
      reason: string
    }) => supervisionsApi.markSupervisionNotDone(supervisionId, reason),
    onSuccess: () => invalidateSupervisionsAndRatings(queryClient),
  })
}

/** `rate_employee` (ADM-15, edición administrativa, SUP-011). */
export function useRateEmployeeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RateEmployeeInput) => ratingsApi.rateEmployee(input),
    onSuccess: () => invalidateSupervisionsAndRatings(queryClient),
  })
}
