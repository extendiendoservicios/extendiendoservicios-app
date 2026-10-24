import type {
  SupervisorStatusKind,
  SupervisorStatusRow,
} from '@/api/supervisorStatus'
import {
  coordinatorName,
  SUPERVISOR_STATUS_ORDER,
} from '@/features/geo/coordinators'
import type { AdminWorkday } from '@/api/workdaysAdmin'

/**
 * Fila de la sección «Coordinadores» de «Asistencia de hoy» (ADM-10, P24.4):
 * el estado de la jornada de cada coordinador. Hoy sale de
 * `v_supervisor_status` (incluye a quien todavía no inició); en otras fechas,
 * de `v_supervisor_workdays_admin` (solo quien tuvo jornada).
 */
export interface CoordinatorDayRow {
  supervisorId: string
  name: string
  status: SupervisorStatusKind
  startedAt: string | null
  endedAt: string | null
  /** Horas netas de la jornada (CJ-13); las supervisiones no suman. */
  workedMinutes: number
  /** Cerrada sola a las 23:55 y sin corregir: lleva advertencia (CJ-31). */
  autoCloseWarning: boolean
  autoClosed: boolean
  corrected: boolean
  onLeave: boolean
  /** Motivo de la pausa abierta, si lo cargó. */
  pauseReason: string | null
}

export function rowFromStatus(row: SupervisorStatusRow): CoordinatorDayRow {
  return {
    supervisorId: row.supervisorId,
    name: coordinatorName(row),
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    workedMinutes: row.workedMinutes,
    autoCloseWarning: row.autoClosed && !row.corrected,
    autoClosed: row.autoClosed,
    corrected: row.corrected,
    onLeave: row.onLeave,
    pauseReason: row.pauseReason,
  }
}

export function rowFromWorkday(workday: AdminWorkday): CoordinatorDayRow {
  const openPause = workday.pauses.find(
    (pause) => pause.type === 'pause' && pause.endsAt == null,
  )
  return {
    supervisorId: workday.supervisorId,
    name: workday.supervisorName || 'Sin nombre',
    status:
      workday.state === 'ended'
        ? 'finished'
        : workday.state === 'paused'
          ? 'paused'
          : 'in_activity',
    startedAt: workday.startedAt,
    endedAt: workday.endedAt,
    workedMinutes: workday.workedMinutes,
    autoCloseWarning: workday.autoCloseWarning,
    autoClosed: workday.autoClosed,
    corrected: workday.corrected,
    onLeave: false,
    pauseReason: openPause?.reason ?? null,
  }
}

/** Por estado (supervisando, en actividad, en pausa, finalizada, sin iniciar) y por nombre. */
export function sortCoordinatorRows(
  rows: CoordinatorDayRow[],
): CoordinatorDayRow[] {
  return [...rows].sort(
    (a, b) =>
      SUPERVISOR_STATUS_ORDER.indexOf(a.status) -
        SUPERVISOR_STATUS_ORDER.indexOf(b.status) ||
      a.name.localeCompare(b.name, 'es'),
  )
}
