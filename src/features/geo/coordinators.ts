import { formatTime } from '@/lib/format'
import type { BadgeVariant } from '@/components/status'
import type { MapViewMarker } from '@/components/map'
import type {
  SupervisorStatusKind,
  SupervisorStatusRow,
} from '@/api/supervisorStatus'

/**
 * Coordinadores en el mapa del Resumen y en «Asistencia de hoy» (P24.4,
 * CJ-22, CJ-33): lógica pura sobre las filas de `v_supervisor_status`.
 *
 * Hay cinco estados, cada uno con su color. El punto va en la última posición
 * conocida del día: la del evento más reciente que trajo posición, sea de la
 * jornada o de una supervisión (D-11, P31). Si el último evento no la trajo,
 * se usa la anterior y el popup avisa la hora («Ubicación de las 10:42»).
 * Solo quien no tuvo ninguna posición en el día no tiene punto y va a la
 * lista «Sin ubicación» con su estado, siempre que tenga la jornada abierta
 * (los «Sin iniciar» y «Finalizada» no se listan). La forma es siempre el rombo de los coordinadores (B-12), así
 * el estado no depende solo del color.
 */

export const SUPERVISOR_STATUS_LABELS: Record<SupervisorStatusKind, string> = {
  in_activity: 'En actividad',
  supervising: 'Supervisando',
  paused: 'En pausa',
  finished: 'Finalizada',
  not_started: 'Sin iniciar',
}

/** Un color por estado (CJ-33): variantes del mapa de estados de `07`. */
export const SUPERVISOR_STATUS_VARIANTS: Record<
  SupervisorStatusKind,
  BadgeVariant
> = {
  in_activity: 'info',
  supervising: 'primary',
  paused: 'warning',
  finished: 'dark',
  not_started: 'neutral',
}

/** Orden de la leyenda y de las listas. */
export const SUPERVISOR_STATUS_ORDER: SupervisorStatusKind[] = [
  'supervising',
  'in_activity',
  'paused',
  'finished',
  'not_started',
]

export function coordinatorName(row: {
  firstName: string
  lastName: string
}): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Sin nombre'
}

/** Ruta de la ficha del coordinador en la pestaña de jornadas (P24.3). */
export function coordinatorWorkdayPath(supervisorId: string): string {
  return `/admin/empleados/${supervisorId}?pestana=jornadas`
}

export function hasCoordinatorPosition(row: SupervisorStatusRow): boolean {
  return row.latitude != null && row.longitude != null
}

/**
 * D-11: «Ubicación de las 10:42» cuando la posición es anterior al último
 * evento (el último no trajo posición); `null` si es la del último evento o
 * no hay posición.
 */
export function coordinatorPositionNote(
  row: Pick<
    SupervisorStatusRow,
    'positionAt' | 'lastEventAt' | 'latitude' | 'longitude'
  >,
): string | null {
  if (row.latitude == null || row.longitude == null || !row.positionAt) {
    return null
  }
  if (
    row.lastEventAt &&
    new Date(row.positionAt).getTime() >= new Date(row.lastEventAt).getTime()
  ) {
    return null
  }
  return `Ubicación de las ${formatTime(row.positionAt)}`
}

/** Texto del estado: «Supervisando · Cliente · Sede», «En pausa · motivo»… */
export function coordinatorStatusDetail(row: SupervisorStatusRow): string {
  const label = SUPERVISOR_STATUS_LABELS[row.status]
  if (row.status === 'supervising' && (row.clientName || row.siteName)) {
    return `${label}: ${[row.clientName, row.siteName].filter(Boolean).join(' · ')}`
  }
  if (row.status === 'paused' && row.pauseReason) {
    return `${label}: ${row.pauseReason}`
  }
  return label
}

export interface CoordinatorsModel {
  markers: MapViewMarker[]
  /** Sin ninguna posición en el día (o sin evento): van a la lista «Sin ubicación». */
  withoutLocation: SupervisorStatusRow[]
}

/** Jornada abierta: en actividad, en pausa o supervisando. */
export function hasOpenWorkday(row: SupervisorStatusRow): boolean {
  return (
    row.status === 'in_activity' ||
    row.status === 'paused' ||
    row.status === 'supervising'
  )
}

/**
 * Marcadores y lista «Sin ubicación» de los coordinadores. Con `enabled`
 * en falso (filtro «Coordinadores» apagado) no se dibuja ni se lista nada.
 */
export function buildCoordinatorMarkers(
  rows: SupervisorStatusRow[],
  enabled: boolean,
): CoordinatorsModel {
  const markers: MapViewMarker[] = []
  const withoutLocation: SupervisorStatusRow[] = []
  if (!enabled) {
    return { markers, withoutLocation }
  }
  for (const row of rows) {
    if (hasCoordinatorPosition(row)) {
      markers.push({
        id: `coordinator-${row.supervisorId}`,
        position: { lat: row.latitude as number, lng: row.longitude as number },
        variant: SUPERVISOR_STATUS_VARIANTS[row.status],
        shape: 'supervisor',
        label: [
          `Coordinador ${coordinatorName(row)}: ${SUPERVISOR_STATUS_LABELS[row.status]}`,
          coordinatorPositionNote(row),
        ]
          .filter(Boolean)
          .join('. '),
        data: row,
      })
    } else if (hasOpenWorkday(row)) {
      // Solo quien tiene la jornada abierta: «Sin iniciar» y «Finalizada» no van.
      withoutLocation.push(row)
    }
  }
  const byOrder = (a: SupervisorStatusRow, b: SupervisorStatusRow) =>
    SUPERVISOR_STATUS_ORDER.indexOf(a.status) -
      SUPERVISOR_STATUS_ORDER.indexOf(b.status) ||
    coordinatorName(a).localeCompare(coordinatorName(b), 'es')
  withoutLocation.sort(byOrder)
  return { markers, withoutLocation }
}

/** Cuántos coordinadores hay en cada estado (para la leyenda). */
export function countByStatus(
  rows: SupervisorStatusRow[],
): Record<SupervisorStatusKind, number> {
  const counts: Record<SupervisorStatusKind, number> = {
    in_activity: 0,
    supervising: 0,
    paused: 0,
    finished: 0,
    not_started: 0,
  }
  for (const row of rows) {
    counts[row.status] += 1
  }
  return counts
}
