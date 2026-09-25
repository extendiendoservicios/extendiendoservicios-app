import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as shiftsApi from '@/api/shifts'
import type { CreateShiftInput } from '@/api/shifts'

/**
 * Hooks de TanStack Query de ADM-05, ADM-07 y ADM-09 (SHIFT-007). Patrón de
 * `src/api/README.md`, igual que `src/features/services/queries.ts`.
 *
 * Polling 30 s solo en la lista del día cuando la fecha es hoy
 * (`02_Decisiones.md` P-005, regla común de esta capa) -- lo decide quien
 * llama al hook (`ShiftsDayList`, `src/features/shifts/components/`), no
 * `queries.ts`: acá solo se expone el parámetro.
 */

const LIST_POLLING_MS = 30_000

export const shiftsKeys = {
  all: ['shifts'] as const,
  byDate: (date: string) => [...shiftsKeys.all, 'byDate', date] as const,
  edit: (id: string) => [...shiftsKeys.all, 'edit', id] as const,
  activeServicesForMonth: (year: number, month: number) =>
    [...shiftsKeys.all, 'activeServicesForMonth', year, month] as const,
}

/** ADM-05 mínima (SHIFT-010): turnos de una fecha. `poll`: solo verdadero si la fecha es hoy. */
export function useShiftsByDateQuery(date: string, poll: boolean) {
  return useQuery({
    queryKey: shiftsKeys.byDate(date),
    queryFn: () => shiftsApi.fetchShiftsByDate(date),
    refetchInterval: poll ? LIST_POLLING_MS : false,
  })
}

/** ADM-07 en modo edición (SHIFT-008): franja, estado y nombres de solo lectura. */
export function useShiftForEditQuery(id: string | undefined) {
  return useQuery({
    queryKey: shiftsKeys.edit(id ?? ''),
    queryFn: () => shiftsApi.fetchShiftForEdit(id as string),
    enabled: id != null,
  })
}

/** Resumen previo de ADM-09 (SHIFT-009): cantidad de servicios activos y vigentes en el mes. */
export function useActiveServicesCountForMonthQuery(
  year: number,
  month: number,
) {
  return useQuery({
    queryKey: shiftsKeys.activeServicesForMonth(year, month),
    queryFn: () => shiftsApi.fetchActiveServicesCountForMonth(year, month),
  })
}

/** Alta puntual de ADM-07 (SHIFT-008): invalida la lista del día recién creado. */
export function useCreateShiftMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateShiftInput) => shiftsApi.createShift(input),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: shiftsKeys.byDate(variables.date),
      })
    },
  })
}

/** Generación mensual de ADM-09 (SHIFT-009): invalida toda la caché de turnos (puede tocar cualquier día del mes). */
export function useGenerateShiftsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ year, month }: { year: number; month: number }) =>
      shiftsApi.generateShifts(year, month),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
    },
  })
}

/** Cambio de franja de ADM-07 en edición (SHIFT-008). `date`: la del turno editado, para invalidar su lista del día. */
export function useUpdateShiftTimeMutation(date: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      shiftId,
      start,
      end,
    }: {
      shiftId: string
      start: string
      end: string
    }) => shiftsApi.updateShiftTime(shiftId, start, end),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: shiftsKeys.byDate(date),
      })
      void queryClient.invalidateQueries({
        queryKey: shiftsKeys.edit(variables.shiftId),
      })
    },
  })
}

/** Cancelación con motivo (SHIFT-011). `date`: la del turno cancelado, para invalidar su lista del día. */
export function useCancelShiftMutation(date: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ shiftId, reason }: { shiftId: string; reason: string }) =>
      shiftsApi.cancelShift(shiftId, reason),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: shiftsKeys.byDate(date),
      })
      void queryClient.invalidateQueries({
        queryKey: shiftsKeys.edit(variables.shiftId),
      })
    },
  })
}
