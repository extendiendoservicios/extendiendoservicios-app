import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as geoApi from '@/api/geo'
import type { GeoRecordType } from '@/api/geo'
import { fetchSupervisorStatus } from '@/api/supervisorStatus'
import { attendanceKeys } from '@/features/attendance/queries'
import { planningKeys } from '@/features/planning/queries'
import { shiftsKeys } from '@/features/shifts/queries'
import { supervisionsKeys } from '@/features/supervisions/queries'
import { sitesKeys } from '@/features/sites/queries'

/**
 * Hooks de TanStack Query del módulo B1 en administración (P22.4).
 *
 * - Mapa de presencia (ADM-02): consulta periódica cada 45 s y al volver a la
 *   pestaña, sin Realtime (B-39).
 * - Posición de un fichaje y correcciones del detalle: lecturas a demanda, sin
 *   polling.
 * - Radio general: lectura puntual (`company_settings`).
 */

/** B-39: el mapa de presencia se actualiza solo cada 45 s. */
export const PRESENCE_POLLING_MS = 45_000

/** ADR-012: el estado de los coordinadores se refresca cada 60 s. */
export const SUPERVISOR_STATUS_POLLING_MS = 60_000

export const geoKeys = {
  all: ['geo'] as const,
  supervisorStatus: () => [...geoKeys.all, 'supervisorStatus'] as const,
  presence: () => [...geoKeys.all, 'presence'] as const,
  location: (recordType: GeoRecordType, recordId: string) =>
    [...geoKeys.all, 'location', recordType, recordId] as const,
  corrections: (recordIds: string[]) =>
    [...geoKeys.all, 'corrections', recordIds] as const,
  company: () => [...geoKeys.all, 'company'] as const,
}

export function usePresenceTodayQuery() {
  return useQuery({
    queryKey: geoKeys.presence(),
    queryFn: geoApi.fetchPresenceToday,
    staleTime: PRESENCE_POLLING_MS,
    refetchInterval: PRESENCE_POLLING_MS,
    refetchOnWindowFocus: true,
  })
}

/**
 * Estado de hoy de los coordinadores (CJ-33): el mapa del Resumen, el bloque
 * de jornadas y «Asistencia de hoy» comparten esta consulta (misma clave).
 * Solo dueño y administradores: `enabled` evita pedirla a otros roles.
 */
export function useSupervisorStatusQuery(enabled = true) {
  return useQuery({
    queryKey: geoKeys.supervisorStatus(),
    queryFn: fetchSupervisorStatus,
    enabled,
    staleTime: SUPERVISOR_STATUS_POLLING_MS,
    refetchInterval: SUPERVISOR_STATUS_POLLING_MS,
    refetchOnWindowFocus: true,
  })
}

/** Posición del fichaje para el mini mapa. `enabled` evita la consulta si no hay posición guardada. */
export function useAttendanceLocationQuery(
  recordType: GeoRecordType,
  recordId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: geoKeys.location(recordType, recordId ?? ''),
    queryFn: () =>
      geoApi.fetchAttendanceLocation(recordType, recordId as string),
    enabled: enabled && recordId != null,
    // La posición de un fichaje no cambia; solo la validación, si la corrigen.
    staleTime: 5 * 60_000,
  })
}

export function useAttendanceCorrectionsQuery(
  recordIds: string[],
  enabled = true,
) {
  return useQuery({
    queryKey: geoKeys.corrections(recordIds),
    queryFn: () => geoApi.fetchAttendanceCorrections(recordIds),
    enabled: enabled && recordIds.length > 0,
  })
}

/** Radio general y fecha del consentimiento (B-02, B-22). */
export function useCompanyGeofenceQuery() {
  return useQuery({
    queryKey: geoKeys.company(),
    queryFn: geoApi.fetchCompanyGeofence,
    staleTime: 60_000,
  })
}

/** Una corrección cambia hora, validación y minutos de varias vistas: se invalida todo lo que las lee. */
function invalidateAfterCorrection(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: geoKeys.all })
  void queryClient.invalidateQueries({ queryKey: attendanceKeys.all })
  void queryClient.invalidateQueries({ queryKey: planningKeys.all })
  void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
  void queryClient.invalidateQueries({ queryKey: supervisionsKeys.all })
}

/** `correct_attendance_time` (B-28). */
export function useCorrectAttendanceTimeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordId,
      newTime,
      reason,
    }: {
      recordId: string
      newTime: string
      reason: string
    }) => geoApi.correctAttendanceTime(recordId, newTime, reason),
    onSuccess: () => invalidateAfterCorrection(queryClient),
  })
}

/** `override_geo_validation` (B-09). */
export function useOverrideGeoValidationMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      recordType,
      recordId,
      reason,
    }: {
      recordType: GeoRecordType
      recordId: string
      reason: string
    }) => geoApi.overrideGeoValidation(recordType, recordId, reason),
    onSuccess: () => invalidateAfterCorrection(queryClient),
  })
}

/** `set_geofence_radius` (B-02): el radio general cambia el círculo de todas las sedes sin radio propio. */
export function useSetGeofenceRadiusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (radiusM: number) => geoApi.setGeofenceRadius(radiusM),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: geoKeys.all })
      void queryClient.invalidateQueries({ queryKey: sitesKeys.all })
    },
  })
}
