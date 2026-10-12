import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as shiftsApi from '@/api/shifts'
import * as attendanceApi from '@/api/attendance'
import * as supervisionsApi from '@/api/supervisions'
import { groupShiftPeople } from '@/features/shifts/shiftPeople'
import type {
  CreateShiftInput,
  CreateShiftSeriesInput,
  ShiftSeriesRule,
} from '@/api/shifts'

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

/** Raíz de `planningKeys` (`features/planning/queries.ts`); literal acá para no importar en círculo. */
const PLANNING_KEY_ROOT = ['planning'] as const

/** Raíz de `attendanceKeys` (`features/attendance/queries.ts`); literal acá por la misma razón. */
const ATTENDANCE_KEY_ROOT = ['attendance'] as const

export const shiftsKeys = {
  all: ['shifts'] as const,
  byDate: (date: string) => [...shiftsKeys.all, 'byDate', date] as const,
  peopleByDate: (date: string) =>
    [...shiftsKeys.all, 'peopleByDate', date] as const,
  edit: (id: string) => [...shiftsKeys.all, 'edit', id] as const,
  seriesPreview: (rule: ShiftSeriesRule) =>
    [...shiftsKeys.all, 'seriesPreview', rule] as const,
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

/**
 * AJ2-18: empleados asignados y supervisor designado de todos los turnos de
 * un día, en dos consultas por día (no una por turno): asignaciones vigentes
 * (`v_assignments_board`) y supervisiones (`v_supervisions_admin`). Cuelga de
 * `shiftsKeys.all`, así que las mutaciones de turnos lo invalidan.
 */
export function useShiftPeopleByDateQuery(date: string, poll: boolean) {
  return useQuery({
    queryKey: shiftsKeys.peopleByDate(date),
    queryFn: async () => {
      const [assignments, supervisions] = await Promise.all([
        attendanceApi.fetchAttendanceBoardByDate(date),
        supervisionsApi.fetchSupervisionsAdmin({
          dateFrom: date,
          dateTo: date,
        }),
      ])
      return groupShiftPeople(assignments, supervisions)
    },
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
      // AJ2-17: el turno puede traer asignaciones (planificación y personas del día).
      void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
      void queryClient.invalidateQueries({ queryKey: PLANNING_KEY_ROOT })
    },
  })
}

/**
 * Vista previa de «Repetir este turno» (AJ3-08). Solo corre con la regla
 * completa y válida (`rule` en `null` = sin consulta); el debounce lo aplica
 * quien arma la regla. Sin polling: es un formulario.
 */
export function useShiftSeriesPreviewQuery(rule: ShiftSeriesRule | null) {
  return useQuery({
    queryKey: shiftsKeys.seriesPreview(
      rule ?? {
        from: '',
        to: '',
        weekdays: [],
        weeksOfMonth: null,
        worksOnHolidays: false,
      },
    ),
    queryFn: () => shiftsApi.previewShiftSeries(rule as ShiftSeriesRule),
    enabled: rule != null,
    staleTime: 0,
    retry: false,
  })
}

/** Alta repetida de ADM-07 (AJ3-08): invalida turnos, planificación (incluye el tablero) y asistencia. */
export function useCreateShiftSeriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateShiftSeriesInput) =>
      shiftsApi.createShiftSeries(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftsKeys.all })
      void queryClient.invalidateQueries({ queryKey: PLANNING_KEY_ROOT })
      void queryClient.invalidateQueries({ queryKey: ATTENDANCE_KEY_ROOT })
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
      // AJ2-17: la generación asigna los empleados fijos.
      void queryClient.invalidateQueries({ queryKey: PLANNING_KEY_ROOT })
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
      openEnded,
    }: {
      shiftId: string
      start: string
      end: string | null
      openEnded?: boolean
    }) => shiftsApi.updateShiftTime(shiftId, start, end, openEnded),
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
