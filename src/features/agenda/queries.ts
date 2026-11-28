import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as agendaApi from '@/api/agenda'
import type {
  SaveAgendaItemInput,
  SaveAgendaStaffLineInput,
} from '@/api/agenda'

/**
 * Hooks de TanStack Query de la Agenda (P37.2), patrón de `src/api/README.md`.
 *
 * Claves: `['agenda', 'items', 'YYYY-MM-01']` (cada mes queda en caché por
 * separado) y `['agenda', 'employeeColors']`. Es una pizarra compartida entre
 * dueños y administradores: las listas se refrescan cada 60 s. Las mutaciones
 * invalidan todos los meses porque mover un evento de día o duplicarlo cambia
 * otro mes.
 */

const LIST_STALE_TIME_MS = 60_000

export const agendaKeys = {
  all: ['agenda'] as const,
  items: (month: string) => [...agendaKeys.all, 'items', month] as const,
  employeeColors: () => [...agendaKeys.all, 'employeeColors'] as const,
  staff: () => [...agendaKeys.all, 'staff'] as const,
  staffLines: (day: string) => [...agendaKeys.all, 'staffLines', day] as const,
  leaves: (day: string) => [...agendaKeys.all, 'leaves', day] as const,
  shiftObservations: (shiftIds: string[]) =>
    [...agendaKeys.all, 'shiftObservations', shiftIds] as const,
}

export function useAgendaItemsQuery(month: string) {
  return useQuery({
    queryKey: agendaKeys.items(month),
    queryFn: () => agendaApi.fetchAgendaItems(month),
    staleTime: LIST_STALE_TIME_MS,
    refetchInterval: LIST_STALE_TIME_MS,
  })
}

export function useAgendaEmployeeColorsQuery() {
  return useQuery({
    queryKey: agendaKeys.employeeColors(),
    queryFn: agendaApi.fetchAgendaEmployeeColors,
    staleTime: LIST_STALE_TIME_MS,
    refetchInterval: LIST_STALE_TIME_MS,
  })
}

function useInvalidateAgendaItems() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({
      queryKey: [...agendaKeys.all, 'items'],
    })
  }
}

export function useSaveAgendaItemMutation() {
  const invalidate = useInvalidateAgendaItems()
  return useMutation({
    mutationFn: (input: SaveAgendaItemInput) => agendaApi.saveAgendaItem(input),
    onSuccess: invalidate,
  })
}

export function useDeleteAgendaItemMutation() {
  const invalidate = useInvalidateAgendaItems()
  return useMutation({
    mutationFn: (id: string) => agendaApi.deleteAgendaItem(id),
    onSuccess: invalidate,
  })
}

export function useSetAgendaItemResolvedMutation() {
  const invalidate = useInvalidateAgendaItems()
  return useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      agendaApi.setAgendaItemResolved(id, resolved),
    onSuccess: invalidate,
  })
}

export function useDuplicateAgendaItemMutation() {
  const invalidate = useInvalidateAgendaItems()
  return useMutation({
    mutationFn: (id: string) => agendaApi.duplicateAgendaItemToNextMonth(id),
    onSuccess: invalidate,
  })
}

export function useMarkAgendaItemClientMutation() {
  const invalidate = useInvalidateAgendaItems()
  return useMutation({
    mutationFn: ({ id, clientId }: { id: string; clientId: string }) =>
      agendaApi.markAgendaItemClient(id, clientId),
    onSuccess: invalidate,
  })
}

export function useSetAgendaEmployeeColorMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      employeeId,
      border,
      fill,
    }: {
      employeeId: string
      border: number | null
      fill: number | null
    }) => agendaApi.setAgendaEmployeeColor(employeeId, border, fill),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.employeeColors(),
      }),
  })
}

// -------------------------------------------------------------------------
// Lista diaria (AG-21 a AG-25)
// -------------------------------------------------------------------------

export function useAgendaStaffQuery() {
  return useQuery({
    queryKey: agendaKeys.staff(),
    queryFn: agendaApi.fetchAgendaStaff,
    staleTime: LIST_STALE_TIME_MS,
  })
}

export function useAgendaStaffLinesQuery(day: string) {
  return useQuery({
    queryKey: agendaKeys.staffLines(day),
    queryFn: () => agendaApi.fetchAgendaStaffLines(day),
    staleTime: LIST_STALE_TIME_MS,
    refetchInterval: LIST_STALE_TIME_MS,
  })
}

export function useAgendaLeavesQuery(day: string) {
  return useQuery({
    queryKey: agendaKeys.leaves(day),
    queryFn: () => agendaApi.fetchAgendaLeavesOnDay(day),
    staleTime: LIST_STALE_TIME_MS,
  })
}

export function useAgendaShiftObservationsQuery(shiftIds: string[]) {
  const sorted = [...new Set(shiftIds)].sort()
  return useQuery({
    queryKey: agendaKeys.shiftObservations(sorted),
    queryFn: () => agendaApi.fetchShiftObservations(sorted),
    enabled: sorted.length > 0,
    staleTime: LIST_STALE_TIME_MS,
  })
}

export function useSaveAgendaStaffLineMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveAgendaStaffLineInput) =>
      agendaApi.saveAgendaStaffLine(input),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: [...agendaKeys.all, 'staffLines'],
      }),
  })
}

export function useDeleteAgendaStaffLineMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => agendaApi.deleteAgendaStaffLine(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: [...agendaKeys.all, 'staffLines'],
      }),
  })
}

export function useSetAgendaEmployeeFixedLineMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      employeeId,
      text,
    }: {
      employeeId: string
      text: string | null
    }) => agendaApi.setAgendaEmployeeFixedLine(employeeId, text),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: agendaKeys.employeeColors(),
      }),
  })
}
