import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as settingsApi from '@/api/settings'
import type { SecurityEventFilters } from '@/api/settings'

/**
 * Hooks de TanStack Query de las pantallas de Configuración (USERS-012,
 * USERS-014 a USERS-016). Patrón de `src/api/README.md`, igual que
 * `src/features/users/queries.ts`.
 *
 * Polling: ninguna de estas cuatro pantallas es un tablero ni "Asistencia de
 * hoy" (P-005: 30 s ahí; 60 s "en el resto de las listas"). De las cuatro,
 * solo feriados y criterios son listas de mantenimiento con datos que casi
 * no cambian entre sesiones -- igual llevan el piso común de 60 s por
 * consistencia con el resto de `front-admin`. La ficha de empresa y el panel
 * de filtros de eventos de seguridad son lecturas puntuales, sin polling.
 */
const LIST_POLLING_MS = 60_000

export const settingsKeys = {
  all: ['settings'] as const,
  company: () => [...settingsKeys.all, 'company'] as const,
  holidays: (year: number) => [...settingsKeys.all, 'holidays', year] as const,
  ratingCriteria: () => [...settingsKeys.all, 'ratingCriteria'] as const,
  securityEvents: (filters: SecurityEventFilters) =>
    [...settingsKeys.all, 'securityEvents', filters] as const,
}

// -------------------------------------------------------------------------
// Empresa (ADM-28)
// -------------------------------------------------------------------------

export function useCompanySettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.company(),
    queryFn: settingsApi.fetchCompanySettings,
  })
}

function useInvalidateCompanySettings() {
  const queryClient = useQueryClient()
  return () =>
    void queryClient.invalidateQueries({ queryKey: settingsKeys.company() })
}

export function useUpdateCompanySettingsMutation() {
  const invalidate = useInvalidateCompanySettings()
  return useMutation({
    mutationFn: settingsApi.updateCompanySettings,
    onSuccess: invalidate,
  })
}

export function useUploadCompanyLogoMutation() {
  const invalidate = useInvalidateCompanySettings()
  return useMutation({
    mutationFn: ({
      file,
      updatedBy,
      previousLogoPath,
    }: {
      file: File
      updatedBy: string
      previousLogoPath: string | null
    }) => settingsApi.uploadCompanyLogo(file, updatedBy, previousLogoPath),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Feriados (ADM-29)
// -------------------------------------------------------------------------

export function useHolidaysQuery(year: number) {
  return useQuery({
    queryKey: settingsKeys.holidays(year),
    queryFn: () => settingsApi.fetchHolidays(year),
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

function useInvalidateHolidays(year: number) {
  const queryClient = useQueryClient()
  return () =>
    void queryClient.invalidateQueries({
      queryKey: settingsKeys.holidays(year),
    })
}

export function useCreateHolidayMutation(year: number) {
  const invalidate = useInvalidateHolidays(year)
  return useMutation({
    mutationFn: settingsApi.createHoliday,
    onSuccess: invalidate,
  })
}

export function useDeactivateHolidayMutation(year: number) {
  const invalidate = useInvalidateHolidays(year)
  return useMutation({
    mutationFn: ({ id, updatedBy }: { id: string; updatedBy: string }) =>
      settingsApi.deactivateHoliday(id, updatedBy),
    onSuccess: invalidate,
  })
}

export function useLoadNationalHolidaysMutation(year: number) {
  const invalidate = useInvalidateHolidays(year)
  return useMutation({
    mutationFn: ({ createdBy }: { createdBy: string }) =>
      settingsApi.loadNationalHolidays(year, createdBy),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Criterios de calificación (ADM-30)
// -------------------------------------------------------------------------

export function useRatingCriteriaQuery() {
  return useQuery({
    queryKey: settingsKeys.ratingCriteria(),
    queryFn: settingsApi.fetchRatingCriteria,
    staleTime: LIST_POLLING_MS,
    refetchInterval: LIST_POLLING_MS,
  })
}

function useInvalidateRatingCriteria() {
  const queryClient = useQueryClient()
  return () =>
    void queryClient.invalidateQueries({
      queryKey: settingsKeys.ratingCriteria(),
    })
}

export function useCreateRatingCriterionMutation() {
  const invalidate = useInvalidateRatingCriteria()
  return useMutation({
    mutationFn: settingsApi.createRatingCriterion,
    onSuccess: invalidate,
  })
}

export function useUpdateRatingCriterionMutation() {
  const invalidate = useInvalidateRatingCriteria()
  return useMutation({
    mutationFn: settingsApi.updateRatingCriterion,
    onSuccess: invalidate,
  })
}

export function useCloseRatingCriterionMutation() {
  const invalidate = useInvalidateRatingCriteria()
  return useMutation({
    mutationFn: ({ id, updatedBy }: { id: string; updatedBy: string }) =>
      settingsApi.closeRatingCriterion(id, updatedBy),
    onSuccess: invalidate,
  })
}

export function useReorderRatingCriteriaMutation() {
  const invalidate = useInvalidateRatingCriteria()
  return useMutation({
    mutationFn: ({
      orderedIds,
      updatedBy,
    }: {
      orderedIds: string[]
      updatedBy: string
    }) => settingsApi.reorderRatingCriteria(orderedIds, updatedBy),
    onSuccess: invalidate,
  })
}

// -------------------------------------------------------------------------
// Eventos de seguridad (ADM-31)
// -------------------------------------------------------------------------

export function useSecurityEventsQuery(filters: SecurityEventFilters) {
  return useQuery({
    queryKey: settingsKeys.securityEvents(filters),
    queryFn: () => settingsApi.fetchSecurityEvents(filters),
  })
}
