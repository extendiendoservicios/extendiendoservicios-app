import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as myDayApi from '@/api/myDay'
import * as attendanceApi from '@/api/attendance'
import {
  fetchShiftTasksReadOnly,
  updateTaskStatus,
  type TaskStatus,
} from '@/api/tasks'
import type { GeolocationCoords } from '@/lib/geolocation'

/**
 * Hooks de TanStack Query de EMP-03 y EMP-04 (ATT-005, MOB-EMP-002 a
 * MOB-EMP-004). Patrón de `src/api/README.md`, igual que
 * `src/features/shifts/queries.ts`.
 *
 * Polling 30 s en `useMyDayQuery` (P-005: "Asistencia de hoy" — acá es el
 * equivalente para el propio empleado, cambia sola cuando fichan
 * compañeros del mismo turno o cuando la administración toca algo del
 * servicio).
 */

const MY_DAY_POLLING_MS = 30_000

export const employeeKeys = {
  all: ['employee'] as const,
  myDay: () => [...employeeKeys.all, 'myDay'] as const,
  shiftPeers: (shiftId: string) =>
    [...employeeKeys.all, 'shiftPeers', shiftId] as const,
  shiftTasks: (shiftId: string) =>
    [...employeeKeys.all, 'shiftTasks', shiftId] as const,
}

/** EMP-03: la jornada de hoy y los próximos 7 días. */
export function useMyDayQuery() {
  return useQuery({
    queryKey: employeeKeys.myDay(),
    queryFn: myDayApi.fetchMyDay,
    refetchInterval: MY_DAY_POLLING_MS,
  })
}

/**
 * Marca como vistos los cambios de hoy (P-092). Sin invalidación en
 * `onSuccess`: si se invalidara `myDay` de inmediato, la próxima lectura
 * llegaría con `changedSinceLastSeen` ya apagado y el bloque "Cambios
 * desde tu última visita" desaparecería de golpe apenas la persona abre la
 * pantalla, antes de que llegue a leerlo. El apagado se ve recién la
 * próxima vez que la query se vuelva a pedir por su cuenta (el próximo
 * polling, o al volver a entrar a Hoy).
 */
export function useMarkChangesSeenMutation() {
  return useMutation({ mutationFn: myDayApi.markChangesSeen })
}

/** EMP-04: compañeros del turno (nombre y foto, P-103). */
export function useShiftPeersQuery(shiftId: string, selfProfileId: string) {
  return useQuery({
    queryKey: employeeKeys.shiftPeers(shiftId),
    queryFn: () => myDayApi.fetchShiftPeers(shiftId, selfProfileId),
    enabled: Boolean(shiftId) && Boolean(selfProfileId),
  })
}

/** EMP-04: tareas previstas del turno, en lectura (antes de empezar el servicio). */
export function useShiftTasksReadOnlyQuery(shiftId: string) {
  return useQuery({
    queryKey: employeeKeys.shiftTasks(shiftId),
    queryFn: () => fetchShiftTasksReadOnly(shiftId),
    enabled: Boolean(shiftId),
  })
}

/**
 * EMP-08: las mismas tareas del turno, pero como fuente para la pantalla
 * que las deja marcar (`fetchShiftTasksReadOnly` alcanza para las dos
 * lecturas -- la única RPC de escritura es `update_task_status`, más abajo).
 */
export function useShiftTasksQuery(shiftId: string) {
  return useQuery({
    queryKey: employeeKeys.shiftTasks(shiftId),
    queryFn: () => fetchShiftTasksReadOnly(shiftId),
    enabled: Boolean(shiftId),
  })
}

/**
 * EMP-08: cambia el estado de una tarea (`06` sección 9,
 * `update_task_status`). Invalida las tareas del turno y `myDay` (el
 * progreso `tasksDone`/`tasksTotal` de EMP-03/EMP-07 sale de ahí).
 */
export function useUpdateTaskStatusMutation(shiftId: string) {
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
    }) => updateTaskStatus(taskId, status, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: employeeKeys.shiftTasks(shiftId),
      })
      void queryClient.invalidateQueries({ queryKey: employeeKeys.myDay() })
    },
  })
}

/**
 * Registrar el inicio (`06` sección 10). Sin pantalla propia en este
 * paquete (EMP-05 es P13.3): el hook queda listo, con la invalidación de
 * `myDay` en `onSuccess` (el estado de la asignación cambió).
 */
export function useRecordCheckInMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      coords,
    }: {
      assignmentId: string
      coords: GeolocationCoords | null
    }) => attendanceApi.recordCheckIn(assignmentId, coords),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.myDay() })
    },
  })
}

/** Registrar el fin (`06` sección 10). Mismo criterio que `useRecordCheckInMutation`; sin pantalla propia acá (EMP-10 es P13.3). */
export function useRecordCheckOutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      coords,
    }: {
      assignmentId: string
      coords: GeolocationCoords | null
    }) => attendanceApi.recordCheckOut(assignmentId, coords),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.myDay() })
    },
  })
}

/** Guardar la observación del servicio (P-062). Sin pantalla propia acá (EMP-09 es P13.3). */
export function useSetAssignmentNotesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      assignmentId,
      notes,
    }: {
      assignmentId: string
      notes: string
    }) => attendanceApi.setAssignmentNotes(assignmentId, notes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: employeeKeys.myDay() })
    },
  })
}
