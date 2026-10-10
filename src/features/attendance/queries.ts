import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as attendanceApi from '@/api/attendance'
import type { AttendanceBoardFilters, AttendanceKind } from '@/api/attendance'
import * as noticesApi from '@/api/notices'
import type { AbsenceReason } from '@/lib/absenceReasons'
import { planningKeys } from '@/features/planning/queries'
import { shiftsKeys } from '@/features/shifts/queries'

/**
 * Hooks de TanStack Query de asistencia administrativa (ATT-010 a ATT-014,
 * ABS-006, ABS-008): patrón de `src/api/README.md`, igual que
 * `src/features/planning/queries.ts`.
 *
 * Polling 30 s en ADM-10 (`02_Decisiones.md` P-005/`05` línea 49) cuando la
 * fecha es hoy -- lo decide quien llama al hook (mismo criterio que
 * `useShiftsByDateQuery`), acá solo se expone el parámetro. Sin polling en
 * ADM-06 (detalle) ni ADM-12 (historial): no están en la lista de pantallas
 * con polling de `05`.
 *
 * Las cuatro mutaciones (`admin_record_attendance`, `close_assignment`,
 * `notify_delay`, `notify_absence`) cambian `status`/`display_status` de
 * `v_assignments_board`, que también alimenta `src/features/planning/queries.ts`
 * (grilla semanal) y `src/features/shifts/queries.ts` (lista del día,
 * `assigned_count`): se invalidan las tres cachés.
 */

const ATTENDANCE_LIST_POLLING_MS = 30_000

export const attendanceKeys = {
  all: ['attendance'] as const,
  boardByDate: (date: string, filters: AttendanceBoardFilters) =>
    [...attendanceKeys.all, 'boardByDate', date, filters] as const,
  employeeHistory: (employeeId: string, from: string, to: string) =>
    [...attendanceKeys.all, 'employeeHistory', employeeId, from, to] as const,
  assignmentsAttendance: (assignmentIds: string[]) =>
    [...attendanceKeys.all, 'assignmentsAttendance', assignmentIds] as const,
  timeline: (assignmentIds: string[]) =>
    [...attendanceKeys.all, 'timeline', assignmentIds] as const,
  employeePhones: (employeeIds: string[]) =>
    [...attendanceKeys.all, 'employeePhones', employeeIds] as const,
  clientUnstarted: (clientId: string, from: string, to: string) =>
    [...attendanceKeys.all, 'clientUnstarted', clientId, from, to] as const,
  peopleNames: (profileIds: string[]) =>
    [...attendanceKeys.all, 'peopleNames', profileIds] as const,
}

/** ADM-10 (ATT-011): asistencia de una fecha. `poll`: solo verdadero si la fecha es hoy. */
export function useAttendanceBoardByDateQuery(
  date: string,
  filters: AttendanceBoardFilters,
  poll: boolean,
) {
  return useQuery({
    queryKey: attendanceKeys.boardByDate(date, filters),
    queryFn: () => attendanceApi.fetchAttendanceBoardByDate(date, filters),
    refetchInterval: poll ? ATTENDANCE_LIST_POLLING_MS : false,
  })
}

/**
 * AJ2-14: asignaciones sin inicio de los turnos de un cliente en un período,
 * para listar las inasistencias en el resumen imprimible. Se abre a demanda:
 * sin polling.
 */
export function useClientUnstartedAssignmentsQuery(
  clientId: string | undefined,
  from: string,
  to: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: attendanceKeys.clientUnstarted(clientId ?? '', from, to),
    queryFn: () =>
      attendanceApi.fetchClientUnstartedAssignments(
        clientId as string,
        from,
        to,
      ),
    enabled: enabled && clientId != null && from <= to,
    retry: false,
  })
}

/** ADM-12 (ATT-013): historial de un empleado por rango de fechas. */
export function useEmployeeAttendanceHistoryQuery(
  employeeId: string | undefined,
  from: string,
  to: string,
) {
  return useQuery({
    queryKey: attendanceKeys.employeeHistory(employeeId ?? '', from, to),
    queryFn: () =>
      attendanceApi.fetchEmployeeAttendanceHistory(
        employeeId as string,
        from,
        to,
      ),
    enabled: employeeId != null,
  })
}

/** ADM-06 (ATT-014/ABS-006): asistencia de las asignaciones vigentes de un turno. */
export function useAssignmentsAttendanceQuery(assignmentIds: string[]) {
  return useQuery({
    queryKey: attendanceKeys.assignmentsAttendance(assignmentIds),
    queryFn: () => attendanceApi.fetchAssignmentsAttendance(assignmentIds),
    enabled: assignmentIds.length > 0,
  })
}

/** Historial completo (registros + avisos) de las asignaciones de un turno (ADM-06, ATT-014/ABS-006). */
export function useAttendanceTimelineQuery(assignmentIds: string[]) {
  return useQuery({
    queryKey: attendanceKeys.timeline(assignmentIds),
    queryFn: () => attendanceApi.fetchAttendanceTimeline(assignmentIds),
    enabled: assignmentIds.length > 0,
  })
}

/** Teléfonos para "llamar" (`tel:`) desde ADM-10. */
export function useEmployeePhonesQuery(employeeIds: string[]) {
  return useQuery({
    queryKey: attendanceKeys.employeePhones(employeeIds),
    queryFn: () => attendanceApi.fetchEmployeePhonesByIds(employeeIds),
    enabled: employeeIds.length > 0,
  })
}

/** Nombres de quien registró o avisó en nombre de otra persona (ATT-014/ABS-006). */
export function usePeopleNamesQuery(profileIds: string[]) {
  return useQuery({
    queryKey: attendanceKeys.peopleNames(profileIds),
    queryFn: () => attendanceApi.fetchPeopleNamesByIds(profileIds),
    enabled: profileIds.length > 0,
  })
}

/** Invalida la asistencia y las otras dos cachés que dependen de `v_assignments_board`/`v_shifts_board`. */
function invalidateAttendanceAndBoards(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: attendanceKeys.all })
  void queryClient.invalidateQueries({ queryKey: planningKeys.all })
  void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
}

/** `admin_record_attendance` (ADM-11, ATT-010). */
export function useAdminRecordAttendanceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      kind,
      reason,
      at,
    }: {
      assignmentId: string
      kind: AttendanceKind
      reason: string
      at?: string
    }) => attendanceApi.adminRecordAttendance(assignmentId, kind, reason, at),
    onSuccess: () => invalidateAttendanceAndBoards(queryClient),
  })
}

/** `close_assignment` (ADM-11, ATT-010). */
export function useCloseAssignmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      reason,
      at,
    }: {
      assignmentId: string
      reason: string
      at?: string
    }) => attendanceApi.closeAssignment(assignmentId, reason, at),
    onSuccess: () => invalidateAttendanceAndBoards(queryClient),
  })
}

/** `notify_delay` en nombre del empleado (ADM-11, ATT-010). */
export function useAdminNotifyDelayMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      minutes,
      reasonText,
    }: {
      assignmentId: string
      minutes: number
      reasonText?: string
    }) => noticesApi.notifyDelay(assignmentId, minutes, reasonText),
    onSuccess: () => invalidateAttendanceAndBoards(queryClient),
  })
}

/** `notify_absence` en nombre del empleado (ADM-11, ATT-010, ABS-008). */
export function useAdminNotifyAbsenceMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      reasonCode,
      reasonText,
    }: {
      assignmentId: string
      reasonCode: AbsenceReason
      reasonText?: string
    }) => noticesApi.notifyAbsence(assignmentId, reasonCode, reasonText),
    onSuccess: () => invalidateAttendanceAndBoards(queryClient),
  })
}
