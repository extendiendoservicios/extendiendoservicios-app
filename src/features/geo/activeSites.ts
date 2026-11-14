import type { MapViewMarker } from '@/components/map'
import type { ActiveSiteRow } from '@/api/geo'
import { getClientColor } from '@/features/planning/clientColors'
import { formatServiceDays } from '@/features/services/weekdays'

/**
 * Modo «Todos los clientes» del mapa del Resumen (P29.3, OG-01): lógica pura
 * sobre las filas de `map_active_sites()`. Un pin por sede, con el color de
 * su cliente (el del calendario, P24.8), y el contador «N clientes · M sedes».
 */

export interface ActiveSitesModel {
  markers: MapViewMarker[]
  clientCount: number
  siteCount: number
}

export function activeSiteClientName(site: ActiveSiteRow): string {
  return site.clientTradeName || site.clientLegalName
}

export function buildActiveSiteMarkers(
  sites: ActiveSiteRow[],
): ActiveSitesModel {
  const markers: MapViewMarker[] = sites.map((site) => ({
    id: `active-site-${site.siteId}`,
    position: { lat: site.latitude, lng: site.longitude },
    variant: 'primary',
    shape: 'site',
    color: getClientColor(site.clientCalendarColor)?.hex,
    label: `${activeSiteClientName(site)} · ${site.siteName}`,
    data: site,
  }))
  return {
    markers,
    clientCount: new Set(sites.map((site) => site.clientId)).size,
    siteCount: sites.length,
  }
}

/** «1 cliente · 1 sede», «3 clientes · 5 sedes». */
export function activeSitesCounterLabel(model: {
  clientCount: number
  siteCount: number
}): string {
  const clients = `${model.clientCount} ${model.clientCount === 1 ? 'cliente' : 'clientes'}`
  const sites = `${model.siteCount} ${model.siteCount === 1 ? 'sede' : 'sedes'}`
  return `${clients} · ${sites}`
}

/** «Limpieza general · lun a vie · 08:00–12:00». */
export function activeSiteServiceLabel(
  service: ActiveSiteRow['services'][number],
): string {
  const days =
    service.weekdays.length > 0
      ? formatServiceDays(service.weekdays, service.weeksOfMonth)
      : ''
  const time = service.startTime
    ? service.openEnded || !service.endTime
      ? `${service.startTime.slice(0, 5)} a terminar`
      : `${service.startTime.slice(0, 5)}–${service.endTime.slice(0, 5)}`
    : ''
  return [service.name, days, time].filter(Boolean).join(' · ')
}
