import type { Json } from '@/lib/database.types'
import { supabase } from '@/lib/supabase'
import { fromPostgrestError, isApiError } from './errors'

/**
 * `src/api/workdaysAdmin.ts` (P24.3, CJ-13, CJ-17, CJ-32): jornadas de los
 * coordinadores vistas y corregidas por la administración. No se llama
 * `workdays.ts` a propósito: ese nombre es de la app del coordinador
 * (P24.2). Es la única lectura de `v_supervisor_workdays_admin`: la usan la
 * pestaña «Jornadas», Asistencia «Coordinadores» y la ficha imprimible (P24.4).
 *
 * Lectura: `v_supervisor_workdays_admin` (solo dueño y administradores;
 * trae los eventos sin coordenadas). Escritura, con motivo obligatorio, O o
 * A + `manage_attendance`: `admin_correct_workday_event`,
 * `admin_add_workday_pause`, `admin_record_workday` y, desde P27.6 (0079,
 * OD-06 y OD-07), `admin_end_workday`, `admin_close_workday_pause` y
 * `admin_correct_supervision_time`. Los errores traen
 * `message` en voseo y `hint` estable (`REASON_REQUIRED`,
 * `AT_OUT_OF_RANGE`, `INVALID_EVENT_ORDER`, ...): pasan tal cual.
 */

export type WorkdayState = 'running' | 'paused' | 'ended'

export type WorkdayEventKind =
  | 'start'
  | 'pause'
  | 'resume'
  | 'end'
  | 'reopen'
  | 'supervision_start'
  | 'supervision_end'

export const WORKDAY_EVENT_LABELS: Record<WorkdayEventKind, string> = {
  start: 'Inicio de la jornada',
  pause: 'Pausa',
  resume: 'Reanudación',
  end: 'Fin de la jornada',
  reopen: 'Jornada reabierta',
  supervision_start: 'Inicio de una supervisión',
  supervision_end: 'Fin de una supervisión',
}

/** Una pausa de la jornada (`app.workday_pauses`). `endsAt` es `null` si sigue abierta. */
export interface WorkdayPause {
  type: 'pause' | 'reopened'
  pauseEventId: string
  /** `null` si la pausa terminó con el fin de la jornada o sigue abierta. */
  resumeEventId: string | null
  startsAt: string
  endsAt: string | null
  minutes: number
  reason: string | null
  corrected: boolean
}

/** Una supervisión de la jornada (`app.workday_supervisions`); la duración es informativa (CJ-14). */
export interface WorkdaySupervision {
  supervisionId: string
  shiftId: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  status: string
  checkInAt: string | null
  checkOutAt: string | null
  durationMinutes: number | null
  unclosed: boolean
}

/** Un evento de la jornada (`app.workday_events_json`), sin coordenadas. */
export interface WorkdayEvent {
  id: string
  kind: WorkdayEventKind
  recordedAt: string
  reason: string | null
  supervisionId: string | null
  hasPosition: boolean
  corrected: boolean
  correctedFrom: string | null
  correctionReason: string | null
  removed: boolean
}

export interface AdminWorkday {
  id: string
  supervisorId: string
  supervisorName: string
  /** `YYYY-MM-DD` (día de Argentina). */
  workDate: string
  startedAt: string
  endedAt: string | null
  state: WorkdayState
  /** Horas netas: de inicio a fin menos las pausas (CJ-13). */
  workedMinutes: number
  pauseMinutes: number
  autoClosed: boolean
  /** CJ-31: «Cerrada automáticamente» y todavía sin corregir. */
  autoCloseWarning: boolean
  corrected: boolean
  pauses: WorkdayPause[]
  supervisions: WorkdaySupervision[]
  supervisionsCount: number
  events: WorkdayEvent[]
  /** OD-05: `open` (sin fin), `auto_closed` (cerrada sola) o `closed`. */
  listStatus: WorkdayListStatus
  /** Sin fin: se puede finalizar desde la administración (OD-06). */
  isOpen: boolean
  /** Evento `pause` de la pausa abierta, si la jornada está en pausa (OD-07). */
  openPauseEventId: string | null
  /** Supervisión abierta, si la hay. */
  openSupervisionId: string | null
}

export type WorkdayListStatus = 'open' | 'closed' | 'auto_closed'

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
  auto_close_warning: boolean | null
  corrected: boolean | null
  pauses: Json | null
  supervisions: Json | null
  supervisions_count: number | null
  events: Json | null
  list_status: string | null
  is_open: boolean | null
  open_pause_event_id: string | null
  open_supervision_id: string | null
}

interface PauseJson {
  type: 'pause' | 'reopened'
  pause_event_id: string
  resume_event_id: string | null
  starts_at: string
  ends_at: string | null
  minutes: number
  reason: string | null
  corrected: boolean
}

interface SupervisionJson {
  supervision_id: string
  shift_id: string
  client_id: string
  client_legal_name: string
  site_id: string
  site_name: string
  status: string
  check_in_at: string | null
  check_out_at: string | null
  duration_minutes: number | null
  unclosed: boolean
}

interface EventJson {
  id: string
  kind: WorkdayEventKind
  recorded_at: string
  reason: string | null
  supervision_id: string | null
  has_position: boolean
  corrected: boolean
  corrected_from: string | null
  correction_reason: string | null
  removed: boolean
}

const WORKDAY_SELECT =
  'id, supervisor_id, supervisor_first_name, supervisor_last_name, work_date, started_at, ended_at, state, worked_minutes, pause_minutes, auto_closed, auto_close_warning, corrected, pauses, supervisions, supervisions_count, events, list_status, is_open, open_pause_event_id, open_supervision_id'

export function mapWorkdayRow(row: WorkdayRawRow): AdminWorkday {
  const pauses = (row.pauses as unknown as PauseJson[] | null) ?? []
  const supervisions =
    (row.supervisions as unknown as SupervisionJson[] | null) ?? []
  const events = (row.events as unknown as EventJson[] | null) ?? []
  return {
    id: row.id ?? '',
    supervisorId: row.supervisor_id ?? '',
    supervisorName:
      `${row.supervisor_first_name ?? ''} ${row.supervisor_last_name ?? ''}`.trim(),
    workDate: row.work_date ?? '',
    startedAt: row.started_at ?? '',
    endedAt: row.ended_at,
    state: (row.state as WorkdayState | null) ?? 'ended',
    workedMinutes: row.worked_minutes ?? 0,
    pauseMinutes: row.pause_minutes ?? 0,
    autoClosed: row.auto_closed ?? false,
    autoCloseWarning: row.auto_close_warning ?? false,
    corrected: row.corrected ?? false,
    pauses: pauses.map((pause) => ({
      type: pause.type,
      pauseEventId: pause.pause_event_id,
      resumeEventId: pause.resume_event_id,
      startsAt: pause.starts_at,
      endsAt: pause.ends_at,
      minutes: pause.minutes,
      reason: pause.reason,
      corrected: pause.corrected,
    })),
    supervisions: supervisions.map((supervision) => ({
      supervisionId: supervision.supervision_id,
      shiftId: supervision.shift_id,
      clientId: supervision.client_id,
      clientName: supervision.client_legal_name,
      siteId: supervision.site_id,
      siteName: supervision.site_name,
      status: supervision.status,
      checkInAt: supervision.check_in_at,
      checkOutAt: supervision.check_out_at,
      durationMinutes: supervision.duration_minutes,
      unclosed: supervision.unclosed,
    })),
    supervisionsCount: row.supervisions_count ?? supervisions.length,
    events: events.map((event) => ({
      id: event.id,
      kind: event.kind,
      recordedAt: event.recorded_at,
      reason: event.reason,
      supervisionId: event.supervision_id,
      hasPosition: event.has_position,
      corrected: event.corrected,
      correctedFrom: event.corrected_from,
      correctionReason: event.correction_reason,
      removed: event.removed,
    })),
    listStatus: toListStatus(row.list_status, row.ended_at, row.auto_closed),
    isOpen: row.is_open ?? row.ended_at == null,
    openPauseEventId: row.open_pause_event_id,
    openSupervisionId: row.open_supervision_id,
  }
}

function toListStatus(
  value: string | null,
  endedAt: string | null,
  autoClosed: boolean | null,
): WorkdayListStatus {
  if (value === 'open' || value === 'closed' || value === 'auto_closed') {
    return value
  }
  if (endedAt == null) return 'open'
  return autoClosed ? 'auto_closed' : 'closed'
}

export interface WorkdayFilters {
  supervisorId: string
  /** `YYYY-MM-DD`, inclusive. */
  dateFrom?: string
  /** `YYYY-MM-DD`, inclusive. */
  dateTo?: string
}

/** Jornadas de un coordinador, de la más reciente a la más antigua. */
export async function fetchSupervisorWorkdays(
  filters: WorkdayFilters,
): Promise<AdminWorkday[]> {
  let query = supabase
    .from('v_supervisor_workdays_admin')
    .select(WORKDAY_SELECT)
    .eq('supervisor_id', filters.supervisorId)

  if (filters.dateFrom) {
    query = query.gte('work_date', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('work_date', filters.dateTo)
  }

  const { data, error } = await query.order('work_date', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => mapWorkdayRow(row))
}

/** Estado de la pantalla «Jornadas» de Supervisiones (OD-05); `corrected` filtra por `corrected = true`. */
export type WorkdayListFilterStatus = 'all' | WorkdayListStatus | 'corrected'

export interface AllWorkdaysFilters {
  supervisorId?: string
  /** `YYYY-MM-DD`, inclusive. */
  dateFrom?: string
  /** `YYYY-MM-DD`, inclusive. */
  dateTo?: string
  status?: WorkdayListFilterStatus
}

/**
 * Pantalla «Jornadas» de Supervisiones (OD-05): jornadas de todos los
 * coordinadores con los filtros de período (`work_date`), coordinador
 * (`supervisor_id`) y estado (`list_status` / `corrected`). Las más recientes
 * primero.
 */
export async function fetchAllWorkdays(
  filters: AllWorkdaysFilters,
): Promise<AdminWorkday[]> {
  let query = supabase
    .from('v_supervisor_workdays_admin')
    .select(WORKDAY_SELECT)

  if (filters.supervisorId) {
    query = query.eq('supervisor_id', filters.supervisorId)
  }
  if (filters.dateFrom) {
    query = query.gte('work_date', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('work_date', filters.dateTo)
  }
  if (filters.status === 'corrected') {
    query = query.eq('corrected', true)
  } else if (filters.status && filters.status !== 'all') {
    query = query.eq('list_status', filters.status)
  }

  const { data, error } = await query
    .order('work_date', { ascending: false })
    .order('started_at', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => mapWorkdayRow(row))
}

/** Jornadas de todos los coordinadores en una fecha (`YYYY-MM-DD`), por hora de inicio. */
export async function fetchWorkdaysByDate(
  date: string,
): Promise<AdminWorkday[]> {
  const { data, error } = await supabase
    .from('v_supervisor_workdays_admin')
    .select(WORKDAY_SELECT)
    .eq('work_date', date)
    .order('started_at', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => mapWorkdayRow(row))
}

/** Mensajes fijos de los códigos (`hint`) de `admin_correct_workday_event` que conviene explicar. */
export const WORKDAY_ADMIN_ERROR_MESSAGES: Record<string, string> = {
  END_BEFORE_SUPERVISION_START:
    'La hora de fin queda antes del inicio de una supervisión que se cerró sola. Elegí una hora posterior o cancelá esa supervisión antes.',
}

/** Texto para mostrar de un error de la corrección de jornadas: el fijo del código o el del servidor. */
export function workdayAdminErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (isApiError(error)) {
    return (
      (error.hint && WORKDAY_ADMIN_ERROR_MESSAGES[error.hint]) || error.message
    )
  }
  return fallback
}

/**
 * `admin_correct_workday_event` (CJ-32): cambia la hora de un evento de la
 * jornada o, con `remove`, da de baja una pausa junto con su reanudación.
 * Motivo obligatorio. Los eventos de supervisión no se corrigen desde acá
 * (`EVENT_NOT_CORRECTABLE`).
 */
export async function correctWorkdayEvent(input: {
  eventId: string
  reason: string
  newTime?: string
  remove?: boolean
  /** OD-07: motivo nuevo de una pausa; cadena vacía lo borra; sin valor no se toca. */
  pauseReason?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_correct_workday_event', {
    p_event_id: input.eventId,
    p_reason: input.reason,
    p_new_time: input.newTime,
    p_remove: input.remove ?? false,
    p_pause_reason: input.pauseReason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/** `admin_add_workday_pause` (CJ-32): agrega una pausa que faltó, con motivo obligatorio. */
export async function addWorkdayPause(input: {
  workdayId: string
  startsAt: string
  endsAt: string
  reason: string
  pauseReason?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_add_workday_pause', {
    p_workday_id: input.workdayId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_reason: input.reason,
    p_pause_reason: input.pauseReason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/**
 * `admin_record_workday` (CJ-32): registra una jornada en nombre del
 * coordinador que se olvidó de iniciarla. Una jornada pasada necesita
 * `endedAt` (`ENDED_AT_REQUIRED`); la de hoy puede quedar abierta.
 */
export async function recordWorkday(input: {
  supervisorId: string
  workDate: string
  startedAt: string
  endedAt?: string
  reason: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_record_workday', {
    p_supervisor_id: input.supervisorId,
    p_work_date: input.workDate,
    p_started_at: input.startedAt,
    p_ended_at: input.endedAt,
    p_reason: input.reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/**
 * `admin_end_workday` (OD-06): finaliza la jornada de un coordinador desde la
 * administración. `at` es la hora de fin; sin valor, el servidor usa ahora (no
 * se admite futura). Cierra la pausa abierta a esa hora y deja la supervisión
 * abierta como «Sin cerrar». Motivo obligatorio.
 */
export async function endWorkday(input: {
  workdayId: string
  reason: string
  at?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_end_workday', {
    p_workday_id: input.workdayId,
    p_reason: input.reason,
    p_at: input.at,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/**
 * `admin_close_workday_pause` (OD-07): cierra una pausa abierta con la hora
 * que se indique (sin valor, ahora). `eventId` es el evento `pause`.
 */
export async function closeWorkdayPause(input: {
  eventId: string
  reason: string
  at?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_close_workday_pause', {
    p_event_id: input.eventId,
    p_reason: input.reason,
    p_at: input.at,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}

/**
 * `admin_correct_supervision_time` (OD-07): corrige la hora de inicio y/o de
 * fin de una supervisión. Hay que mandar al menos una; el fin solo se corrige
 * si la supervisión ya tiene fin (`SUPERVISION_NOT_CLOSED`).
 */
export async function correctSupervisionTime(input: {
  supervisionId: string
  reason: string
  startAt?: string
  endAt?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_correct_supervision_time', {
    p_supervision_id: input.supervisionId,
    p_reason: input.reason,
    p_start_at: input.startAt,
    p_end_at: input.endAt,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
}
