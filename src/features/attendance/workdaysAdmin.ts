import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from '@/api/errors'

/**
 * Lectura de `v_supervisor_workdays_admin` para la ficha imprimible de
 * jornadas y «Asistencia de hoy» (P24.4, CJ-13, CJ-19, CJ-34).
 *
 * Es una consulta propia de `features/attendance`: el módulo de jornadas del
 * resto de la plataforma (`src/api/workdays.ts`, P24.2/P24.3) se arma en
 * paralelo. Las pausas, las supervisiones y los eventos llegan como `jsonb`
 * ya armado por la vista; acá solo se tipan y se normalizan.
 */

export type WorkdayState = 'running' | 'paused' | 'ended'

/** Pausa de la jornada (`app.workday_pauses`). */
export interface WorkdayPause {
  /** `pause` = pausa del coordinador; `reopened` = hueco entre un fin y su reapertura (CJ-30). */
  type: 'pause' | 'reopened'
  startsAt: string
  /** Nulo si la pausa sigue abierta. */
  endsAt: string | null
  minutes: number
  reason: string | null
  corrected: boolean
}

/** Supervisión de la jornada (`app.workday_supervisions`); la duración es informativa (CJ-14). */
export interface WorkdaySupervision {
  supervisionId: string
  shiftId: string
  clientName: string
  siteName: string
  status: string
  checkInAt: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  /** «Sin cerrar» (CJ-31). */
  unclosed: boolean
}

export interface SupervisorWorkday {
  id: string
  supervisorId: string
  supervisorFirstName: string
  supervisorLastName: string
  /** `YYYY-MM-DD` en Argentina. */
  workDate: string
  startedAt: string
  endedAt: string | null
  state: WorkdayState
  /** Horas netas: inicio a fin menos pausas (CJ-13). */
  workedMinutes: number
  pauseMinutes: number
  autoClosed: boolean
  corrected: boolean
  /** Cerrada sola y sin corregir (CJ-31): lleva la advertencia. */
  autoCloseWarning: boolean
  pauses: WorkdayPause[]
  supervisions: WorkdaySupervision[]
}

const WORKDAY_SELECT =
  'id, supervisor_id, supervisor_first_name, supervisor_last_name, work_date, started_at, ended_at, state, worked_minutes, pause_minutes, auto_closed, corrected, auto_close_warning, pauses, supervisions'

interface PauseJson {
  type?: string
  starts_at?: string
  ends_at?: string | null
  minutes?: number | null
  reason?: string | null
  corrected?: boolean | null
}

interface SupervisionJson {
  supervision_id?: string
  shift_id?: string
  client_legal_name?: string | null
  site_name?: string | null
  status?: string
  check_in_at?: string | null
  check_out_at?: string | null
  duration_minutes?: number | null
  unclosed?: boolean | null
}

interface WorkdayRawRow {
  id: string | null
  supervisor_id: string | null
  supervisor_first_name: string | null
  supervisor_last_name: string | null
  work_date: string | null
  started_at: string | null
  ended_at: string | null
  state: string | null
  worked_minutes: number | null
  pause_minutes: number | null
  auto_closed: boolean | null
  corrected: boolean | null
  auto_close_warning: boolean | null
  pauses: unknown
  supervisions: unknown
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function mapWorkdayPause(json: PauseJson): WorkdayPause | null {
  if (!json.starts_at) return null
  return {
    type: json.type === 'reopened' ? 'reopened' : 'pause',
    startsAt: json.starts_at,
    endsAt: json.ends_at ?? null,
    minutes: json.minutes ?? 0,
    reason: json.reason ?? null,
    corrected: json.corrected ?? false,
  }
}

export function mapWorkdaySupervision(
  json: SupervisionJson,
): WorkdaySupervision | null {
  if (!json.supervision_id) return null
  return {
    supervisionId: json.supervision_id,
    shiftId: json.shift_id ?? '',
    clientName: json.client_legal_name ?? '',
    siteName: json.site_name ?? '',
    status: json.status ?? '',
    checkInAt: json.check_in_at ?? null,
    checkOutAt: json.check_out_at ?? null,
    durationMinutes: json.duration_minutes ?? null,
    unclosed: json.unclosed ?? false,
  }
}

export function mapWorkdayRow(row: WorkdayRawRow): SupervisorWorkday | null {
  if (!row.id || !row.supervisor_id || !row.work_date || !row.started_at) {
    return null
  }
  const state: WorkdayState =
    row.state === 'paused' || row.state === 'ended' ? row.state : 'running'
  return {
    id: row.id,
    supervisorId: row.supervisor_id,
    supervisorFirstName: row.supervisor_first_name ?? '',
    supervisorLastName: row.supervisor_last_name ?? '',
    workDate: row.work_date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    state,
    workedMinutes: row.worked_minutes ?? 0,
    pauseMinutes: row.pause_minutes ?? 0,
    autoClosed: row.auto_closed ?? false,
    corrected: row.corrected ?? false,
    autoCloseWarning: row.auto_close_warning ?? false,
    pauses: asArray<PauseJson>(row.pauses)
      .map(mapWorkdayPause)
      .filter((pause): pause is WorkdayPause => pause !== null),
    supervisions: asArray<SupervisionJson>(row.supervisions)
      .map(mapWorkdaySupervision)
      .filter((item): item is WorkdaySupervision => item !== null),
  }
}

/** Jornadas de un coordinador entre dos fechas (inclusive), de la más vieja a la más nueva. */
export async function fetchSupervisorWorkdays(
  supervisorId: string,
  from: string,
  to: string,
): Promise<SupervisorWorkday[]> {
  const { data, error } = await supabase
    .from('v_supervisor_workdays_admin')
    .select(WORKDAY_SELECT)
    .eq('supervisor_id', supervisorId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? [])
    .map((row) => mapWorkdayRow(row as unknown as WorkdayRawRow))
    .filter((row): row is SupervisorWorkday => row !== null)
}

/** Jornadas de todos los coordinadores en una fecha (para «Asistencia de hoy» en días pasados). */
export async function fetchWorkdaysByDate(
  date: string,
): Promise<SupervisorWorkday[]> {
  const { data, error } = await supabase
    .from('v_supervisor_workdays_admin')
    .select(WORKDAY_SELECT)
    .eq('work_date', date)
    .order('started_at', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? [])
    .map((row) => mapWorkdayRow(row as unknown as WorkdayRawRow))
    .filter((row): row is SupervisorWorkday => row !== null)
}
