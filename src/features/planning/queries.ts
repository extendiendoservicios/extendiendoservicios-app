import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as assignmentsApi from '@/api/assignments'
import * as tasksApi from '@/api/tasks'
import type {
  AssignCandidatesParams,
  AssignEmployeeInput,
  AssignmentsBoardRangeFilters,
  ShiftsBoardRangeFilters,
} from '@/api/assignments'
import type { TaskStatus } from '@/api/tasks'
import { shiftsKeys } from '@/features/shifts/queries'

/**
 * Hooks de TanStack Query de ADM-03, ADM-04 y ADM-05 completa (ASSIGN-007).
 * Patrón de `src/api/README.md`, igual que `src/features/shifts/queries.ts`.
 *
 * Claves por rango de fechas (regla del encargo): `['planning', 'shiftsBoard',
 * from, to, filters]` y `['planning', 'assignmentsBoard', from, to, filters]`
 * -- así cada mes o semana consultada queda en caché por separado y cambiar
 * de mes/semana no pisa lo ya traído.
 *
 * Sin polling (`02_Decisiones.md` P-005): ni el calendario mensual ni la
 * grilla semanal están en la lista de pantallas con polling de `05` (solo
 * ADM-02, ADM-05 si es hoy y ADM-10). ADM-05 completa sigue viviendo en
 * `src/features/shifts/queries.ts` (`useShiftsByDateQuery`, ya con su
 * polling de 30 s) -- acá no se repite.
 *
 * Las cuatro mutaciones invalidan tanto la caché de este módulo
 * (`planningKeys.all`) como la de `src/features/shifts/queries.ts`
 * (`shiftsKeys.all`): una asignación cambia `assigned_count`/`display_status`
 * de `v_shifts_board`, que también lee ADM-05 mínima a través de
 * `useShiftsByDateQuery`. Ninguna pantalla de este paquete llama a estas
 * mutaciones todavía (quedan listas para ADM-06/ADM-08, P11.3).
 */

const LIST_STALE_TIME_MS = 60_000

export const planningKeys = {
  all: ['planning'] as const,
  shiftsBoard: (from: string, to: string, filters: ShiftsBoardRangeFilters) =>
    [...planningKeys.all, 'shiftsBoard', from, to, filters] as const,
  assignmentsBoard: (
    from: string,
    to: string,
    filters: AssignmentsBoardRangeFilters,
  ) => [...planningKeys.all, 'assignmentsBoard', from, to, filters] as const,
  shiftDetail: (shiftId: string) =>
    [...planningKeys.all, 'shiftDetail', shiftId] as const,
  assignCandidates: (params: AssignCandidatesParams) =>
    [...planningKeys.all, 'assignCandidates', params] as const,
}

/** Calendario mensual (ADM-03): `v_shifts_board` entre `from` y `to`. */
export function useShiftsBoardRangeQuery(
  from: string,
  to: string,
  filters: ShiftsBoardRangeFilters = {},
) {
  return useQuery({
    queryKey: planningKeys.shiftsBoard(from, to, filters),
    queryFn: () => assignmentsApi.fetchShiftsBoardByRange(from, to, filters),
    staleTime: LIST_STALE_TIME_MS,
  })
}

/** Grilla semanal por empleado (ADM-04): `v_assignments_board` entre `from` y `to`. */
export function useAssignmentsBoardRangeQuery(
  from: string,
  to: string,
  filters: AssignmentsBoardRangeFilters = {},
) {
  return useQuery({
    queryKey: planningKeys.assignmentsBoard(from, to, filters),
    queryFn: () =>
      assignmentsApi.fetchAssignmentsBoardByRange(from, to, filters),
    staleTime: LIST_STALE_TIME_MS,
  })
}

/** Invalida el tablero de planificación y la lista del día de ADM-05 (mismos datos, otra vista). */
function invalidatePlanningAndShifts(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: planningKeys.all })
  void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
}

/** `assign_employee` (ADM-08, P11.3). */
export function useAssignEmployeeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AssignEmployeeInput) =>
      assignmentsApi.assignEmployee(input),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** `remove_assignment` con motivo obligatorio (ADM-06, P11.3). */
export function useRemoveAssignmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      reason,
    }: {
      assignmentId: string
      reason: string
    }) => assignmentsApi.removeAssignment(assignmentId, reason),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** `update_assignment_time`: franja propia de una asignación (ADM-06, P11.3). */
export function useUpdateAssignmentTimeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      start,
      end,
    }: {
      assignmentId: string
      start?: string
      end?: string
    }) => assignmentsApi.updateAssignmentTime(assignmentId, start, end),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** `update_shift_details`: dotación y notas administrativas (ADM-06/ADM-07, P11.3). */
export function useUpdateShiftDetailsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      shiftId,
      requiredStaff,
      notes,
    }: {
      shiftId: string
      requiredStaff: number
      notes?: string | null
    }) => assignmentsApi.updateShiftDetails(shiftId, requiredStaff, notes),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** Detalle del turno (ADM-06, ASSIGN-011). Sin polling: ADM-06 no está en la lista de `05` sección 0/2 que lo pide. */
export function useShiftDetailQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: planningKeys.shiftDetail(shiftId ?? ''),
    queryFn: () => assignmentsApi.fetchShiftDetail(shiftId as string),
    enabled: shiftId != null,
    staleTime: LIST_STALE_TIME_MS,
  })
}

/** `update_task_status` desde ADM-06 (TASK-006): invalida el detalle del turno igual que las otras mutaciones de este archivo. */
export function useUpdateTaskStatusMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      status,
      reason,
    }: {
      taskId: string
      status: TaskStatus
      reason?: string
    }) => tasksApi.updateTaskStatus(taskId, status, reason),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** `reload_shift_tasks` desde ADM-06 (TASK-006): reemplaza las tareas del turno por las de la plantilla vigente. */
export function useReloadShiftTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (shiftId: string) => tasksApi.reloadShiftTasks(shiftId),
    onSuccess: () => invalidatePlanningAndShifts(queryClient),
  })
}

/** Candidatos de ADM-08 (ASSIGN-012): solo mientras el drawer de asignar está abierto (`enabled`). */
export function useAssignCandidatesQuery(
  params: AssignCandidatesParams | undefined,
) {
  return useQuery({
    queryKey: planningKeys.assignCandidates(
      params ?? {
        shiftId: '',
        clientId: '',
        shiftDate: '',
        startTime: '',
        endTime: '',
        excludeEmployeeIds: [],
      },
    ),
    queryFn: () =>
      assignmentsApi.fetchAssignCandidates(params as AssignCandidatesParams),
    enabled: params != null,
    staleTime: LIST_STALE_TIME_MS,
  })
}
