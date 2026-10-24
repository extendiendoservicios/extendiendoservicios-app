import type { SupervisorStatusRow } from '@/api/supervisorStatus'
import { coordinatorName } from '@/features/geo/coordinators'

/**
 * Jornadas de los coordinadores del día para el bloque del Resumen (P24.4,
 * CJ-14, CJ-31): las abiertas (en actividad, supervisando o en pausa) y las
 * cerradas automáticamente. No hay «asignadas» ni «no realizadas»: la
 * asignación manual ya no existe.
 */

const OPEN_STATUSES = new Set(['in_activity', 'supervising', 'paused'])

export interface CoordinatorWorkdaysSummary {
  /** Jornadas abiertas ahora, de la más antigua a la más nueva. */
  open: SupervisorStatusRow[]
  /** Cerradas solas a las 23:55 (con o sin corrección posterior). */
  autoClosed: SupervisorStatusRow[]
}

export function summarizeCoordinatorWorkdays(
  rows: SupervisorStatusRow[],
): CoordinatorWorkdaysSummary {
  const byStart = (a: SupervisorStatusRow, b: SupervisorStatusRow) =>
    (a.startedAt ?? '').localeCompare(b.startedAt ?? '') ||
    coordinatorName(a).localeCompare(coordinatorName(b), 'es')
  return {
    open: rows.filter((row) => OPEN_STATUSES.has(row.status)).sort(byStart),
    autoClosed: rows
      .filter((row) => row.status === 'finished' && row.autoClosed)
      .sort(byStart),
  }
}
