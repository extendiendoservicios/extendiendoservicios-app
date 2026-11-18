import { useQuery } from '@tanstack/react-query'
import * as fixedApi from '@/api/employeeFixed'
import { planningKeys } from '@/features/planning/queries'
import { employeesKeys } from '@/features/employees/queries'

/**
 * Consultas de OH-06 y OH-07 (P30.4b). Los fijos sin asignar cuelgan de
 * `planningKeys.all`: cualquier cambio de asignaciones o turnos de Planificación
 * los invalida solo.
 */

const LIST_STALE_TIME_MS = 60_000

export const employeeFixedKeys = {
  gaps: (profileId: string, from: string, to: string) =>
    [...planningKeys.all, 'fixedGaps', profileId, from, to] as const,
  board: (profileId: string) =>
    [...employeesKeys.all, 'weekBoard', profileId] as const,
  pattern: (profileId: string) =>
    [...employeesKeys.all, 'fixedPattern', profileId] as const,
}

/** Fijos sin asignar del mes (OH-06). Solo con `enabled` (quien puede editar). */
export function useEmployeeFixedGapsQuery(
  profileId: string,
  from: string,
  to: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: employeeFixedKeys.gaps(profileId, from, to),
    queryFn: () => fixedApi.fetchEmployeeFixedGaps(profileId, from, to),
    enabled,
    staleTime: LIST_STALE_TIME_MS,
  })
}

/** Pizarra semanal guardada; `null` si todavía no hay (OH-07). */
export function useEmployeeWeekBoardQuery(profileId: string, enabled: boolean) {
  return useQuery({
    queryKey: employeeFixedKeys.board(profileId),
    queryFn: () => fixedApi.fetchEmployeeWeekBoard(profileId),
    enabled,
    staleTime: LIST_STALE_TIME_MS,
  })
}

/** Patrón fijo: de acá se arma la pizarra la primera vez (OH-07). */
export function useEmployeeFixedPatternQuery(
  profileId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: employeeFixedKeys.pattern(profileId),
    queryFn: () => fixedApi.fetchEmployeeFixedPattern(profileId),
    enabled,
    staleTime: LIST_STALE_TIME_MS,
  })
}
