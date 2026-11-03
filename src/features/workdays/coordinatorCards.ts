import type {
  SupervisorStatusKind,
  SupervisorStatusRow,
} from '@/api/supervisorStatus'
import {
  WORKDAY_EVENT_LABELS,
  type AdminWorkday,
  type WorkdayPause,
} from '@/api/workdaysAdmin'
import {
  coordinatorName,
  SUPERVISOR_STATUS_ORDER,
} from '@/features/geo/coordinators'
import { formatShortDate, formatTime } from '@/lib/format'

/**
 * Datos de la tarjeta de cada coordinador en el Resumen y en «Asistencia de
 * hoy» (OD-04): estado (CJ-33), inicio de la jornada, cada pausa con su
 * motivo, la supervisión en curso y las horas netas. Lógica pura.
 *
 * Hoy el estado sale de `v_supervisor_status` (incluye a quien todavía no
 * inició) y el detalle de la jornada, de `v_supervisor_workdays_admin`; en
 * otras fechas, todo sale de la jornada.
 */
export interface CoordinatorCardData {
  supervisorId: string
  name: string
  status: SupervisorStatusKind
  onLeave: boolean
  startedAt: string | null
  endedAt: string | null
  /** Horas netas (CJ-13): las supervisiones no suman. */
  workedMinutes: number
  autoClosed: boolean
  corrected: boolean
  /** Cerrada sola y sin corregir: lleva advertencia (CJ-31). */
  autoCloseWarning: boolean
  pauses: WorkdayPause[]
  /** Supervisión abierta ahora, con cliente y sede. */
  supervision: { clientName: string; siteName: string } | null
  /** Jornada completa; nula si todavía no inició. */
  workday: AdminWorkday | null
}

function openSupervisionOf(
  workday: AdminWorkday | null,
  statusRow: SupervisorStatusRow | null,
): CoordinatorCardData['supervision'] {
  const open = workday?.openSupervisionId
    ? workday.supervisions.find(
        (supervision) =>
          supervision.supervisionId === workday.openSupervisionId,
      )
    : undefined
  if (open) {
    return { clientName: open.clientName, siteName: open.siteName }
  }
  if (statusRow?.status === 'supervising' && statusRow.clientName) {
    return {
      clientName: statusRow.clientName,
      siteName: statusRow.siteName ?? '',
    }
  }
  return null
}

function statusFromWorkday(workday: AdminWorkday): SupervisorStatusKind {
  if (workday.state === 'ended') return 'finished'
  if (workday.state === 'paused') return 'paused'
  return workday.openSupervisionId ? 'supervising' : 'in_activity'
}

export function cardFromStatus(
  row: SupervisorStatusRow,
  workday: AdminWorkday | null,
): CoordinatorCardData {
  return {
    supervisorId: row.supervisorId,
    name: coordinatorName(row),
    status: row.status,
    onLeave: row.onLeave,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    workedMinutes: workday?.workedMinutes ?? row.workedMinutes,
    autoClosed: row.autoClosed,
    corrected: row.corrected,
    autoCloseWarning: row.autoClosed && !row.corrected,
    pauses: workday?.pauses ?? [],
    supervision: openSupervisionOf(workday, row),
    workday,
  }
}

export function cardFromWorkday(workday: AdminWorkday): CoordinatorCardData {
  return {
    supervisorId: workday.supervisorId,
    name: workday.supervisorName || 'Sin nombre',
    status: statusFromWorkday(workday),
    onLeave: false,
    startedAt: workday.startedAt,
    endedAt: workday.endedAt,
    workedMinutes: workday.workedMinutes,
    autoClosed: workday.autoClosed,
    corrected: workday.corrected,
    autoCloseWarning: workday.autoCloseWarning,
    pauses: workday.pauses,
    supervision: openSupervisionOf(workday, null),
    workday,
  }
}

/** Por estado (supervisando, en actividad, en pausa, finalizada, sin iniciar) y por nombre. */
export function sortCards(cards: CoordinatorCardData[]): CoordinatorCardData[] {
  return [...cards].sort(
    (a, b) =>
      SUPERVISOR_STATUS_ORDER.indexOf(a.status) -
        SUPERVISOR_STATUS_ORDER.indexOf(b.status) ||
      a.name.localeCompare(b.name, 'es'),
  )
}

/** Tarjetas de hoy: una por coordinador activo, con su jornada del día si la tiene. */
export function buildTodayCards(
  statusRows: SupervisorStatusRow[],
  workdays: AdminWorkday[],
): CoordinatorCardData[] {
  return sortCards(
    statusRows.map((row) => {
      const workday =
        workdays.find((candidate) => candidate.id === row.workdayId) ??
        workdays.find(
          (candidate) => candidate.supervisorId === row.supervisorId,
        ) ??
        null
      return cardFromStatus(row, workday)
    }),
  )
}

/** Tarjetas de otra fecha: solo quien tuvo jornada ese día. */
export function buildDayCards(workdays: AdminWorkday[]): CoordinatorCardData[] {
  return sortCards(workdays.map(cardFromWorkday))
}

/** «10:00 a 10:20 · Almuerzo» / «desde las 10:00 · sin cerrar». */
export function describePause(pause: WorkdayPause): string {
  const range = pause.endsAt
    ? `${formatTime(pause.startsAt)} a ${formatTime(pause.endsAt)}`
    : `desde las ${formatTime(pause.startsAt)} · sin cerrar`
  return pause.reason ? `${range} · ${pause.reason}` : range
}

export interface ActivityItem {
  id: string
  title: string
  description?: string
  variant: 'on' | 'ok' | 'crit' | 'pending'
}

function supervisionLabel(workday: AdminWorkday, supervisionId: string | null) {
  const supervision = workday.supervisions.find(
    (candidate) => candidate.supervisionId === supervisionId,
  )
  return supervision
    ? ` · ${supervision.clientName} · ${supervision.siteName}`
    : ''
}

/**
 * Línea de tiempo del día para el panel «Ver actividad» (OD-04): los eventos
 * de la jornada y de las supervisiones por hora, con las correcciones (hora
 * anterior y motivo) y las bajas. Lo más viejo primero.
 */
export function buildActivityTimeline(workday: AdminWorkday): ActivityItem[] {
  return [...workday.events]
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
    .map((event) => {
      const label = WORKDAY_EVENT_LABELS[event.kind]
      const where = supervisionLabel(workday, event.supervisionId)
      const pauseReason =
        event.kind === 'pause' && event.reason ? ` (${event.reason})` : ''
      const notes: string[] = []
      if (event.removed) {
        notes.push('Dada de baja')
      } else if (event.corrected) {
        notes.push(
          event.correctedFrom
            ? `Corregido: antes ${formatShortDate(event.correctedFrom)} ${formatTime(event.correctedFrom)}`
            : 'Corregido',
        )
      }
      if (event.correctionReason) {
        notes.push(`Motivo: ${event.correctionReason}`)
      }
      return {
        id: event.id,
        title: `${formatTime(event.recordedAt)} · ${label}${where}${pauseReason}`,
        description: notes.length > 0 ? notes.join(' · ') : undefined,
        variant: event.removed
          ? 'crit'
          : event.kind === 'end'
            ? 'ok'
            : event.corrected
              ? 'crit'
              : 'on',
      } satisfies ActivityItem
    })
}
