import type { BadgeVariant } from '@/components/status'
import type { MapViewMarker } from '@/components/map'
import type { PresenceRow } from '@/api/geo'

/**
 * Armado de los marcadores del mapa de presencia (ADM-02, B-11 a B-15): lógica
 * pura sobre las filas de `v_presence_today`, sin React ni Supabase.
 *
 * - Empleados (`kind = employee`) y supervisores (`kind = supervisor`) en curso:
 *   un punto en la posición del fichaje de inicio, coloreado por la validación
 *   (B-03): verde válido o marcado como válido por la administración, rojo
 *   fuera de zona, gris sin validar. Los supervisores llevan forma de rombo.
 * - Con «Mostrar finalizados de hoy», se suman los que ya fichó el fin.
 * - Sedes (`kind = site`): su pin y su círculo con el radio vigente, sin color
 *   de alarma (B-14). Se dibujan las que tienen un turno en la franja de la
 *   hora actual (`siteIdsInWindow`), hayan fichado o no: sin ningún punto al
 *   lado, todavía nadie registró el inicio. Además, las de alguien que sigue
 *   en curso pasada su franja (o finalizado, con «Mostrar finalizados»), para
 *   que ningún punto quede sin su sede.
 * - Quienes trabajan sin posición no tienen punto: van a la lista de «Trabajando
 *   sin ubicación» (B-13). Solo cuenta a los que están en curso.
 */

export interface PresenceMapModel {
  /** Sedes primero y personas después, para que los puntos queden arriba de los círculos. */
  markers: MapViewMarker[]
  /** En curso y sin ubicación (B-13). */
  withoutLocation: PresenceRow[]
  /** Cuántos puntos de personas se dibujan (empleados + supervisores). */
  peopleOnMap: number
  /** Cuántas sedes se dibujan. */
  sitesOnMap: number
}

export interface PresenceOptions {
  /** Interruptor «Mostrar finalizados de hoy». */
  showFinished: boolean
  /** Sedes con un turno cuya franja incluye la hora actual. */
  siteIdsInWindow?: ReadonlySet<string>
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

  // Sedes en su franja horaria, más las de alguien que se dibuja o se lista
  // ahora (P22.6b), aunque ya haya pasado su franja.
  const activeSiteIds = new Set<string>(options.siteIdsInWindow)
  for (const row of rows) {
    if (row.kind === 'site' || !row.siteId) continue
    if (row.inProgress || options.showFinished) {
      activeSiteIds.add(row.siteId)
    }
  }

  for (const row of rows) {
    if (row.kind === 'site') {
      if (
        row.siteLatitude != null &&
        row.siteLongitude != null &&
        activeSiteIds.has(row.recordId)
      ) {
        siteMarkers.push({
          id: `site-${row.recordId}`,
          position: { lat: row.siteLatitude, lng: row.siteLongitude },
          variant: 'primary',
          shape: 'site',
          radiusM: row.siteRadiusM,
          circleVariant: 'primary',
          label: `Sede ${row.siteName ?? ''}`.trim(),
          data: row,
        })
      }
      continue
    }

    if (!row.inProgress && !options.showFinished) {
      continue
    }

    if (!hasPosition(row)) {
      if (row.inProgress) {
        withoutLocation.push(row)
      }
      continue
    }

    const isSupervisor = row.kind === 'supervisor'
    personMarkers.push({
      id: `${row.kind}-${row.recordId}`,
      position: { lat: row.latitude as number, lng: row.longitude as number },
      variant: presenceVariant(row),
      shape: isSupervisor ? 'supervisor' : 'dot',
      label: `${isSupervisor ? 'Coordinador' : 'Empleado'} ${presencePersonName(row)}${row.inProgress ? '' : ' (finalizó)'}`,
      data: row,
    })
  }

  return {
    markers: [...siteMarkers, ...personMarkers],
    withoutLocation,
    peopleOnMap: personMarkers.length,
    sitesOnMap: siteMarkers.length,
  }
}
