import type { BadgeVariant } from '@/components/status'
import type { MapViewMarker, MarkerShape } from '@/components/map'
import type { PresenceRow, SiteDayState, SiteDayStatusRow } from '@/api/geo'
import type { SupervisorStatusRow } from '@/api/supervisorStatus'
import { buildCoordinatorMarkers } from './coordinators'

/**
 * Armado de los marcadores del mapa de presencia (ADM-02, B-11 a B-15): lógica
 * pura sobre las filas de `v_presence_today`, sin React ni Supabase.
 *
 * - Empleados (`kind = employee`) en curso: un punto en la posición del fichaje
 *   de inicio, coloreado por la validación (B-03): verde válido o marcado como
 *   válido por la administración, rojo fuera de zona, gris sin validar.
 * - Con «Mostrar finalizados de hoy», se suman los que ya fichó el fin.
 * - Coordinadores (P24.4, CJ-33): salen de `v_supervisor_status` (ver
 *   `coordinators.ts`), con un rombo por estado. Las filas `kind = supervisor`
 *   de `v_presence_today` (la supervisión en curso) se ignoran acá para no
 *   dibujar dos puntos de la misma persona.
 * - Sedes (OF-13): salen de `v_sites_day_status` con su pin y su círculo con el
 *   radio vigente, por estado del día: amarillo y reloj las que tienen turnos
 *   por comenzar, el color de siempre y el isotipo las que están en curso, gris
 *   y tilde las que ya terminaron. Cada estado tiene su conmutador.
 * - Quienes trabajan sin posición no tienen punto: van a la lista de «Trabajando
 *   sin ubicación» (B-13). Solo cuenta a los que están en curso.
 */

export interface PresenceMapModel {
  /** Sedes primero y personas después, para que los puntos queden arriba de los círculos. */
  markers: MapViewMarker[]
  /** Empleados en curso y sin ubicación (B-13). */
  withoutLocation: PresenceRow[]
  /** Coordinadores sin posición en su último evento (CJ-33), con su estado. */
  coordinatorsWithoutLocation: SupervisorStatusRow[]
  /** Cuántos puntos de empleados se dibujan. */
  peopleOnMap: number
  /** Cuántos puntos de coordinadores se dibujan. */
  coordinatorsOnMap: number
  /** Cuántas sedes se dibujan. */
  sitesOnMap: number
}

export interface PresenceOptions {
  /** Conmutador «Finalizados»: sedes terminadas y empleados que ya ficharon el fin. */
  showFinished: boolean
  /** Conmutador «En curso» (por omisión, encendido). */
  showInProgress?: boolean
  /** Conmutador «Por comenzar» (por omisión, encendido). */
  showUpcoming?: boolean
  /** Estado de hoy de las sedes (`v_sites_day_status`). */
  sites?: SiteDayStatusRow[]
  /** Estado de hoy de los coordinadores (`v_supervisor_status`). */
  coordinators?: SupervisorStatusRow[]
  /** Filtro «Coordinadores» (por omisión, encendido). */
  showCoordinators?: boolean
}

/** Color del punto (B-03, B-09): con corrección de la administración va en verde. */
export function presenceVariant(
  row: Pick<PresenceRow, 'geoStatus' | 'geoOverridden'>,
): BadgeVariant {
  if (row.geoOverridden || row.geoStatus === 'valid') {
    return 'success'
  }
  if (row.geoStatus === 'outside') {
    return 'danger'
  }
  return 'neutral'
}

export function presencePersonName(row: PresenceRow): string {
  return (
    [row.personFirstName, row.personLastName].filter(Boolean).join(' ') ||
    'Sin nombre'
  )
}

export function presenceClientName(row: PresenceRow): string {
  return row.clientTradeName ?? row.clientLegalName ?? ''
}

/** Color y forma de la sede según su estado del día (OF-13): el color no es lo único que cambia. */
export const SITE_STATE_STYLE: Record<
  SiteDayState,
  { variant: BadgeVariant; shape: MarkerShape }
> = {
  upcoming: { variant: 'warning', shape: 'site-upcoming' },
  in_progress: { variant: 'primary', shape: 'site' },
  finished: { variant: 'neutral', shape: 'site-finished' },
}

export const SITE_STATE_LABEL: Record<SiteDayState, string> = {
  upcoming: 'por comenzar',
  in_progress: 'en curso',
  finished: 'finalizada',
}

function hasPosition(row: PresenceRow): boolean {
  return row.latitude != null && row.longitude != null
}

export function buildPresenceMarkers(
  rows: PresenceRow[],
  options: PresenceOptions,
): PresenceMapModel {
  const siteMarkers: MapViewMarker[] = []
  const personMarkers: MapViewMarker[] = []
  const withoutLocation: PresenceRow[] = []

  const showInProgress = options.showInProgress ?? true
  const showUpcoming = options.showUpcoming ?? true

  for (const site of options.sites ?? []) {
    if (site.latitude == null || site.longitude == null) continue
    if (
      (site.dayState === 'upcoming' && !showUpcoming) ||
      (site.dayState === 'in_progress' && !showInProgress) ||
      (site.dayState === 'finished' && !options.showFinished)
    ) {
      continue
    }
    const style = SITE_STATE_STYLE[site.dayState]
    siteMarkers.push({
      id: `site-${site.siteId}`,
      position: { lat: site.latitude, lng: site.longitude },
      variant: style.variant,
      shape: style.shape,
      radiusM: site.radiusM,
      circleVariant: style.variant,
      label:
        `Sede ${site.siteName ?? ''} (${SITE_STATE_LABEL[site.dayState]})`.trim(),
      data: site,
    })
  }

  for (const row of rows) {
    // Las sedes salen de `v_sites_day_status`; los coordinadores, de `v_supervisor_status`.
    if (row.kind !== 'employee') {
      continue
    }

    if (row.inProgress ? !showInProgress : !options.showFinished) {
      continue
    }

    if (!hasPosition(row)) {
      if (row.inProgress) {
        withoutLocation.push(row)
      }
      continue
    }

    personMarkers.push({
      id: `${row.kind}-${row.recordId}`,
      position: { lat: row.latitude as number, lng: row.longitude as number },
      variant: presenceVariant(row),
      shape: 'dot',
      label: `Empleado ${presencePersonName(row)}${row.inProgress ? '' : ' (finalizó)'}`,
      data: row,
    })
  }

  const coordinators = buildCoordinatorMarkers(
    options.coordinators ?? [],
    options.showCoordinators ?? true,
  )

  return {
    markers: [...siteMarkers, ...personMarkers, ...coordinators.markers],
    withoutLocation,
    coordinatorsWithoutLocation: coordinators.withoutLocation,
    peopleOnMap: personMarkers.length,
    coordinatorsOnMap: coordinators.markers.length,
    sitesOnMap: siteMarkers.length,
  }
}
