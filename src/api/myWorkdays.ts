import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { GeolocationCoords } from '@/lib/geolocation'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { fromPostgrestError } from './errors'
import type { SupervisionStatus } from './mySupervisions'
import { supervisorTodayKeys } from './supervisorToday'

/**
 * `src/api/myWorkdays.ts` (P24.2, CJ-12 a CJ-17, CJ-29, CJ-30): la jornada del
 * coordinador desde el celular. Lee `v_my_workdays` (solo las propias, sin
 * coordenadas) y llama a `start_workday`, `pause_workday`, `resume_workday`,
 * `end_workday` y `reopen_workday` (`app/docs/database.md`, «Coordinación libre
 * y jornada del coordinador»).
 *
 * La hora oficial es la del servidor: los minutos netos y las horas de cada
 * evento salen de la base. El contador de la barra solo los extrapola entre
 * una lectura y la siguiente (ver `nextCounterAnchor`).
 */

export type WorkdayState = 'running' | 'paused' | 'ended'

/** Una pausa de la jornada (`type: 'reopened'` = hueco entre un fin y su reapertura, CJ-30). */
export interface WorkdayPause {
  type: 'pause' | 'reopened'
  startsAt: string
  /** `null` si la pausa sigue abierta. */
  endsAt: string | null
  minutes: number
  reason: string | null
}

/** Una supervisión de la jornada. La duración es informativa: no suma horas (CJ-14). */
export interface WorkdaySupervision {
  supervisionId: string
  shiftId: string
  clientName: string
  siteName: string
  status: SupervisionStatus
  checkInAt: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  /** «Sin cerrar»: la jornada se cerró sola con la supervisión abierta (CJ-31). */
  unclosed: boolean
}

export interface WorkdayEvent {
  id: string
  kind: string
  recordedAt: string
  reason: string | null
  supervisionId: string | null
  removed: boolean
}

export interface MyWorkday {
  id: string
  workDate: string
  state: WorkdayState
  startedAt: string
  endedAt: string | null
  /** Minutos netos al momento de la lectura (inicio a fin menos pausas, CJ-13). */
  workedMinutes: number
  pauseMinutes: number
  /** Se cerró sola a las 23:55 (CJ-31). */
  autoClosed: boolean
  /** Cerrada sola y todavía sin corregir por la administración. */
  autoCloseWarning: boolean
  corrected: boolean
  pauses: WorkdayPause[]
  supervisions: WorkdaySupervision[]
  supervisionsCount: number
  events: WorkdayEvent[]
}

/** Lo que devuelve cada RPC de jornada: el estado nuevo. */
export interface WorkdayStateResult {
  workdayId: string
  state: WorkdayState
  startedAt: string
  endedAt: string | null
  minutes: number
  pausedSince: string | null
  pauseReason: string | null
  autoClosed: boolean
  corrected: boolean
}

interface RawPause {
  type: 'pause' | 'reopened'
  starts_at: string
  ends_at: string | null
  minutes: number
  reason: string | null
}

interface RawSupervision {
  supervision_id: string
  shift_id: string
  client_legal_name: string
  site_name: string
  status: SupervisionStatus
  check_in_at: string | null
  check_out_at: string | null
  duration_minutes: number | null
  unclosed: boolean
}

interface RawEvent {
  id: string
  kind: string
  recorded_at: string
  reason: string | null
  supervision_id: string | null
  removed: boolean
}

interface MyWorkdayRawRow {
  id: string | null
  work_date: string | null
  state: string | null
  started_at: string | null
  ended_at: string | null
  worked_minutes: number | null
  pause_minutes: number | null
  auto_closed: boolean | null
  auto_close_warning: boolean | null
  corrected: boolean | null
  pauses: unknown
  supervisions: unknown
  supervisions_count: number | null
  events: unknown
}

function asArray<T>(json: unknown): T[] {
  return Array.isArray(json) ? (json as T[]) : []
}

export function mapMyWorkdayRow(row: MyWorkdayRawRow): MyWorkday {
  return {
    id: row.id as string,
    workDate: row.work_date as string,
    state: (row.state ?? 'running') as WorkdayState,
    startedAt: row.started_at as string,
    endedAt: row.ended_at,
    workedMinutes: row.worked_minutes ?? 0,
    pauseMinutes: row.pause_minutes ?? 0,
    autoClosed: Boolean(row.auto_closed),
    autoCloseWarning: Boolean(row.auto_close_warning),
    corrected: Boolean(row.corrected),
    pauses: asArray<RawPause>(row.pauses).map((pause) => ({
      type: pause.type,
      startsAt: pause.starts_at,
      endsAt: pause.ends_at,
      minutes: pause.minutes ?? 0,
      reason: pause.reason,
    })),
    supervisions: asArray<RawSupervision>(row.supervisions).map((s) => ({
      supervisionId: s.supervision_id,
      shiftId: s.shift_id,
      clientName: s.client_legal_name,
      siteName: s.site_name,
      status: s.status,
      checkInAt: s.check_in_at,
      checkOutAt: s.check_out_at,
      durationMinutes: s.duration_minutes,
      unclosed: Boolean(s.unclosed),
    })),
    supervisionsCount: row.supervisions_count ?? 0,
    events: asArray<RawEvent>(row.events).map((event) => ({
      id: event.id,
      kind: event.kind,
      recordedAt: event.recorded_at,
      reason: event.reason,
      supervisionId: event.supervision_id,
      removed: Boolean(event.removed),
    })),
  }
}

/** La jornada de hoy del coordinador (`null` si todavía no la inició, CJ-30: una por día). */
export async function fetchTodayWorkday(): Promise<MyWorkday | null> {
  const { data, error } = await supabase
    .from('v_my_workdays')
    .select('*')
    .eq('work_date', todayInBuenosAires())
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapMyWorkdayRow(data) : null
}

/** Tope de jornadas del historial de SUP-08 (alcanza para varios meses de trabajo diario). */
export const WORKDAY_HISTORY_LIMIT = 90

/** Jornadas propias, la más reciente primero (SUP-08). */
export async function fetchMyWorkdaysHistory(): Promise<MyWorkday[]> {
  const { data, error } = await supabase
    .from('v_my_workdays')
    .select('*')
    .order('work_date', { ascending: false })
    .limit(WORKDAY_HISTORY_LIMIT)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapMyWorkdayRow)
}

interface RawWorkdayState {
  workday_id: string
  state: WorkdayState
  started_at: string
  ended_at: string | null
  minutes: number
  paused_since: string | null
  pause_reason: string | null
  auto_closed: boolean
  corrected: boolean
}

function mapWorkdayState(data: unknown): WorkdayStateResult {
  const raw = data as RawWorkdayState
  return {
    workdayId: raw.workday_id,
    state: raw.state,
    startedAt: raw.started_at,
    endedAt: raw.ended_at,
    minutes: raw.minutes,
    pausedSince: raw.paused_since,
    pauseReason: raw.pause_reason,
    autoClosed: raw.auto_closed,
    corrected: raw.corrected,
  }
}

function positionArgs(coords: GeolocationCoords | null) {
  return {
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  }
}

/** Inicia la jornada de hoy (CJ-12). Sin `coords` se registra igual (ADR-009, CJ-21). */
export async function startWorkday(
  coords: GeolocationCoords | null,
): Promise<WorkdayStateResult> {
  const { data, error } = await supabase.rpc(
    'start_workday',
    positionArgs(coords),
  )
  if (error) throw fromPostgrestError(error)
  return mapWorkdayState(data)
}

/** Pausa la jornada; el motivo es opcional (CJ-16). */
export async function pauseWorkday(
  reason: string | null,
  coords: GeolocationCoords | null,
): Promise<WorkdayStateResult> {
  const { data, error } = await supabase.rpc('pause_workday', {
    p_reason: reason?.trim() || undefined,
    ...positionArgs(coords),
  })
  if (error) throw fromPostgrestError(error)
  return mapWorkdayState(data)
}

export async function resumeWorkday(
  coords: GeolocationCoords | null,
): Promise<WorkdayStateResult> {
  const { data, error } = await supabase.rpc(
    'resume_workday',
    positionArgs(coords),
  )
  if (error) throw fromPostgrestError(error)
  return mapWorkdayState(data)
}

export async function endWorkday(
  coords: GeolocationCoords | null,
): Promise<WorkdayStateResult> {
  const { data, error } = await supabase.rpc(
    'end_workday',
    positionArgs(coords),
  )
  if (error) throw fromPostgrestError(error)
  return mapWorkdayState(data)
}

/** Reabre la jornada finalizada de hoy (CJ-30). */
export async function reopenWorkday(
  coords: GeolocationCoords | null,
): Promise<WorkdayStateResult> {
  const { data, error } = await supabase.rpc(
    'reopen_workday',
    positionArgs(coords),
  )
  if (error) throw fromPostgrestError(error)
  return mapWorkdayState(data)
}

// -------------------------------------------------------------------------
// Hooks de TanStack Query
// -------------------------------------------------------------------------

/** La barra de jornada se relee cada 30 s (alcanza para el contador, ver `nextCounterAnchor`). */
const WORKDAY_POLLING_MS = 30_000

export const workdayKeys = {
  all: ['myWorkdays'] as const,
  today: () => [...workdayKeys.all, 'today'] as const,
  history: () => [...workdayKeys.all, 'history'] as const,
}

/** SUP-02: la jornada de hoy. */
export function useTodayWorkdayQuery() {
  return useQuery({
    queryKey: workdayKeys.today(),
    queryFn: fetchTodayWorkday,
    refetchInterval: WORKDAY_POLLING_MS,
  })
}

/** SUP-08: jornadas por día. Sin polling (se abre a demanda). */
export function useMyWorkdaysHistoryQuery() {
  return useQuery({
    queryKey: workdayKeys.history(),
    queryFn: fetchMyWorkdaysHistory,
  })
}

export type WorkdayAction = 'start' | 'pause' | 'resume' | 'end' | 'reopen'

export interface WorkdayActionInput {
  action: WorkdayAction
  coords: GeolocationCoords | null
  /** Motivo de la pausa (opcional, solo para `pause`). */
  reason?: string | null
}

/**
 * Una sola mutación para los cinco botones de la barra. Devuelve la promesa
 * de la recarga para que el botón siga ocupado hasta tener el estado nuevo
 * (mismo criterio que `invalidateSupervisionCaches` en `mySupervisions.ts`).
 */
export function useWorkdayActionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ action, coords, reason }: WorkdayActionInput) => {
      switch (action) {
        case 'start':
          return startWorkday(coords)
        case 'pause':
          return pauseWorkday(reason ?? null, coords)
        case 'resume':
          return resumeWorkday(coords)
        case 'end':
          return endWorkday(coords)
        case 'reopen':
          return reopenWorkday(coords)
      }
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: workdayKeys.all }),
        queryClient.invalidateQueries({ queryKey: supervisorTodayKeys.all }),
      ]),
  })
}
