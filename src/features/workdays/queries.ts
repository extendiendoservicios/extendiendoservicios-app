import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as workdaysApi from '@/api/workdaysAdmin'
import type { WorkdayFilters } from '@/api/workdaysAdmin'

/**
 * Hooks de TanStack Query de las jornadas de los coordinadores (P24.3):
 * patrón de `src/api/README.md`. Sin polling: es una pestaña dentro de una
 * ficha, mismo criterio que `useEmployeeAttendanceHistoryQuery` (ADM-12).
 */

export const workdaysKeys = {
  all: ['workdaysAdmin'] as const,
  list: (filters: WorkdayFilters) =>
    [...workdaysKeys.all, 'list', filters] as const,
}

/** Pestaña «Jornadas» de ADM-16: jornadas de un coordinador en un período. */
export function useSupervisorWorkdaysQuery(filters: WorkdayFilters) {
  return useQuery({
    queryKey: workdaysKeys.list(filters),
    queryFn: () => workdaysApi.fetchSupervisorWorkdays(filters),
    staleTime: 30_000,
  })
}

function useInvalidateWorkdays() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: workdaysKeys.all })
    // El Resumen y la Asistencia de hoy muestran las jornadas abiertas.
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['supervisions'] })
  }
}

/** `admin_correct_workday_event`. */
export function useCorrectWorkdayEventMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.correctWorkdayEvent,
    onSuccess: invalidate,
  })
}

/** `admin_add_workday_pause`. */
export function useAddWorkdayPauseMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.addWorkdayPause,
    onSuccess: invalidate,
  })
}

/** `admin_record_workday`. */
export function useRecordWorkdayMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.recordWorkday,
    onSuccess: invalidate,
  })
}
