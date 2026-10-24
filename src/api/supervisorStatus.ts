import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/supervisorStatus.ts` (P24.4): estado de hoy de cada coordinador
 * para el mapa del Resumen y «Asistencia de hoy» (CJ-22, CJ-33).
 *
 * Se lee `v_supervisor_status` (solo dueño y administradores): una fila por
 * coordinador activo con el estado de su jornada y la posición de su último
 * evento. Las coordenadas llegan por la vista (criterio de `0054`): no se
 * piden a `supervisor_workday_events`.
 */

/** Estados de CJ-33. */
export type SupervisorStatusKind =
  'in_activity' | 'supervising' | 'paused' | 'finished' | 'not_started'

export interface SupervisorStatusRow {
  supervisorId: string
  firstName: string
  lastName: string
  status: SupervisorStatusKind
  workdayId: string | null
  workDate: string | null
  startedAt: string | null
  endedAt: string | null
  /** Hora del último evento de la jornada (inicio, pausa, supervisión…). */
  lastEventAt: string | null
  /** Posición del último evento; nula = «Sin ubicación». */
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  /** Minutos netos de hoy (inicio a fin menos pausas, CJ-13). */
  workedMinutes: number
  pauseReason: string | null
  supervisionId: string | null
  clientId: string | null
  /** Razón social del cliente que está supervisando. */
  clientName: string | null
  siteId: string | null
  siteName: string | null
  /** Cerrada sola a las 23:55 (CJ-31). */
  autoClosed: boolean
  /** Corregida por la administración (CJ-32). */
  corrected: boolean
  onLeave: boolean
}

const STATUS_SELECT =
  'supervisor_id, first_name, last_name, status, workday_id, work_date, started_at, ended_at, last_event_at, latitude, longitude, accuracy_m, worked_minutes, pause_reason, supervision_id, client_id, client_legal_name, site_id, site_name, auto_closed, corrected, on_leave'

const STATUS_KINDS: readonly string[] = [
  'in_activity',
  'supervising',
  'paused',
  'finished',
  'not_started',
]

interface SupervisorStatusRawRow {
  supervisor_id: string | null
  first_name: string | null
  last_name: string | null
  status: string | null
  workday_id: string | null
  work_date: string | null
  started_at: string | null
  ended_at: string | null
  last_event_at: string | null
  latitude: number | string | null
  longitude: number | string | null
  accuracy_m: number | string | null
  worked_minutes: number | string | null
  pause_reason: string | null
  supervision_id: string | null
  client_id: string | null
  client_legal_name: string | null
  site_id: string | null
  site_name: string | null
  auto_closed: boolean | null
  corrected: boolean | null
  on_leave: boolean | null
}

/** `numeric` llega como número o como texto según el driver. */
function toNumberOrNull(value: number | string | null): number | null {
  if (value == null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function mapSupervisorStatusRow(
  row: SupervisorStatusRawRow,
): SupervisorStatusRow | null {
  if (!row.supervisor_id || !row.status || !STATUS_KINDS.includes(row.status)) {
    return null
  }
  return {
    supervisorId: row.supervisor_id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    status: row.status as SupervisorStatusKind,
    workdayId: row.workday_id,
    workDate: row.work_date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastEventAt: row.last_event_at,
    latitude: toNumberOrNull(row.latitude),
    longitude: toNumberOrNull(row.longitude),
    accuracyM: toNumberOrNull(row.accuracy_m),
    workedMinutes: toNumberOrNull(row.worked_minutes) ?? 0,
    pauseReason: row.pause_reason,
    supervisionId: row.supervision_id,
    clientId: row.client_id,
    clientName: row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    autoClosed: row.auto_closed ?? false,
    corrected: row.corrected ?? false,
    onLeave: row.on_leave ?? false,
  }
}

/** Estado de hoy de todos los coordinadores activos (`v_supervisor_status`). */
export async function fetchSupervisorStatus(): Promise<SupervisorStatusRow[]> {
  const { data, error } = await supabase
    .from('v_supervisor_status')
    .select(STATUS_SELECT)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? [])
    .map((row) =>
      mapSupervisorStatusRow(row as unknown as SupervisorStatusRawRow),
    )
    .filter((row): row is SupervisorStatusRow => row !== null)
}
