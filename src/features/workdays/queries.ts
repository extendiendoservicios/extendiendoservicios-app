import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as workdaysApi from '@/api/workdaysAdmin'
import type { AllWorkdaysFilters, WorkdayFilters } from '@/api/workdaysAdmin'

/**
 * Hooks de TanStack Query de las jornadas de los coordinadores (P24.3):
 * patrón de `src/api/README.md`. Sin polling: es una pestaña dentro de una
 * ficha, mismo criterio que `useEmployeeAttendanceHistoryQuery` (ADM-12).
 */

export const workdaysKeys = {
  all: ['workdaysAdmin'] as const,
  list: (filters: WorkdayFilters) =>
    [...workdaysKeys.all, 'list', filters] as const,
  byDate: (date: string) => [...workdaysKeys.all, 'byDate', date] as const,
  everyone: (filters: AllWorkdaysFilters) =>
    [...workdaysKeys.all, 'everyone', filters] as const,
}

/** Polling de las listas de jornadas (regla común: 60 s). */
export const WORKDAYS_POLLING_MS = 60_000

/** Pestaña «Jornadas» de ADM-16: jornadas de un coordinador en un período. */
export function useSupervisorWorkdaysQuery(
  filters: WorkdayFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: workdaysKeys.list(filters),
    queryFn: () => workdaysApi.fetchSupervisorWorkdays(filters),
    enabled,
    staleTime: 30_000,
  })
}

/** Jornadas de todos los coordinadores en una fecha (Asistencia «Coordinadores» en días pasados). */
export function useWorkdaysByDateQuery(
  date: string,
  enabled = true,
  /** Con `true` la lista se refresca cada 60 s (jornadas de hoy). */
  poll = false,
) {
  return useQuery({
    queryKey: workdaysKeys.byDate(date),
    queryFn: () => workdaysApi.fetchWorkdaysByDate(date),
    enabled,
    staleTime: 60_000,
    refetchInterval: poll ? WORKDAYS_POLLING_MS : false,
  })
}

/** Pantalla «Jornadas» de Supervisiones (OD-05): todos los coordinadores, con polling de 60 s. */
export function useAllWorkdaysQuery(filters: AllWorkdaysFilters) {
  return useQuery({
    queryKey: workdaysKeys.everyone(filters),
    queryFn: () => workdaysApi.fetchAllWorkdays(filters),
    staleTime: WORKDAYS_POLLING_MS,
    refetchInterval: WORKDAYS_POLLING_MS,
  })
}

function useInvalidateWorkdays() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: workdaysKeys.all })
    // El Resumen y la Asistencia de hoy muestran las jornadas abiertas.
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    // El estado de los coordinadores (CJ-33) sale de `v_supervisor_status`.
    void queryClient.invalidateQueries({
      queryKey: ['geo', 'supervisorStatus'],
    })
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

/** `admin_end_workday` (OD-06). */
export function useEndWorkdayMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.endWorkday,
    onSuccess: invalidate,
  })
}

/** `admin_close_workday_pause` (OD-07). */
export function useCloseWorkdayPauseMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.closeWorkdayPause,
    onSuccess: invalidate,
  })
}

/** `admin_correct_supervision_time` (OD-07). */
export function useCorrectSupervisionTimeMutation() {
  const invalidate = useInvalidateWorkdays()
  return useMutation({
    mutationFn: workdaysApi.correctSupervisionTime,
    onSuccess: invalidate,
  })
}
