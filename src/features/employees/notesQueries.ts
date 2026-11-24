import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as notesApi from '@/api/employeeCalendarNotes'
import type { SaveCalendarNoteInput } from '@/api/employeeCalendarNotes'

/**
 * Consultas de las observaciones del calendario del empleado (P31.3, D-08).
 * Cuelgan de `employeesKeys.all`; sin polling (se edita en el momento).
 */

const LIST_STALE_TIME_MS = 60_000

/** Raíz de `employeesKeys` (`features/employees/queries.ts`); literal acá para no importar de más. */
const EMPLOYEES_KEY_ROOT = ['employees'] as const

export const calendarNotesKeys = {
  list: (profileId: string, from: string, to: string) =>
    [...EMPLOYEES_KEY_ROOT, 'calendarNotes', profileId, from, to] as const,
  forEmployee: (profileId: string) =>
    [...EMPLOYEES_KEY_ROOT, 'calendarNotes', profileId] as const,
}

export function useCalendarNotesQuery(
  profileId: string,
  from: string,
  to: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: calendarNotesKeys.list(profileId, from, to),
    queryFn: () => notesApi.fetchEmployeeCalendarNotes(profileId, from, to),
    enabled,
    staleTime: LIST_STALE_TIME_MS,
  })
}

export function useSaveCalendarNoteMutation(profileId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SaveCalendarNoteInput) =>
      notesApi.saveEmployeeCalendarNote(input),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: calendarNotesKeys.forEmployee(profileId),
      }),
  })
}

export function useDeleteCalendarNoteMutation(profileId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => notesApi.deleteEmployeeCalendarNote(noteId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: calendarNotesKeys.forEmployee(profileId),
      }),
  })
}
