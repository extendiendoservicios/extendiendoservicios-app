import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Circle,
  MapContainer,
  Marker,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import { cn } from 'cn'
import type { BadgeVariant } from '@/components/status'
import type { GeoFix, GeoPoint, GeoStatus } from '@/lib/geo'
import { DEFAULT_GEOFENCE_RADIUS_M } from '@/lib/geo'
import { BaseLayerToggle, BaseTileLayer, useBaseLayer } from './baseLayers'
import { circlePathOptions } from './circleStyles'
import { createMarkerIcon } from './markerIcon'

export interface GeofenceMiniMapSite extends GeoPoint {
  /** Radio vigente de la sede, en metros. Por omisión, 150 m. */
  radiusM?: number
  /** Nombre de la sede (para el texto accesible). */
  name?: string
}

export interface LeafletGeofenceMiniMapProps {
  site: GeofenceMiniMapSite
  /**
   * Punto propio (en vivo, o el guardado en el fichaje). Con `null` se ve
   * solo la sede. La precisión dibuja su círculo y se achica al mejorar.
   */
  position?: GeoFix | null
  /**
   * Resultado de la validación para pintar el círculo de la sede: `valid`
   * verde, `outside` rojo, `unvalidated` o `null` gris.
   */
  status?: GeoStatus | null
  /**
   * Solo lectura (detalle del turno en administración): sede + punto del
   * fichaje guardado. El círculo de precisión va neutro, sin zoom con la
   * rueda y con el texto accesible de «fichaje guardado».
   */
  readOnly?: boolean
  /** Alto (CSS), 240 px por omisión. */
  height?: number | string
  className?: string
  /** Zoom con la rueda; por omisión, apagado (no pelea con el scroll de la pantalla). */
  scrollWheelZoom?: boolean
}

const STATUS_VARIANT: Record<GeoStatus, BadgeVariant> = {
  valid: 'success',
  outside: 'danger',
  unvalidated: 'neutral',
}

const STATUS_TEXT: Record<GeoStatus, string> = {
  valid: 'dentro de la zona',
  outside: 'fuera de la zona',
  unvalidated: 'sin validar',
}

const FIT_PADDING: [number, number] = [24, 24]
const MAX_ZOOM_ON_FIT = 18

/**
 * Encuadre automático de la sede (círculo completo) y del punto propio
 * (con su círculo de precisión). Se deja de reencuadrar cuando la persona
 * mueve o hace zoom a mano.
 */
function AutoFit({
  site,
  position,
}: {
  site: GeofenceMiniMapSite
  position: GeoFix | null | undefined
}) {
  const map = useMap()
  const userMoved = React.useRef(false)
  const fitting = React.useRef(false)

  React.useEffect(() => {
    const stop = () => {
      if (!fitting.current) userMoved.current = true
    }
    map.on('dragstart', stop)
    map.on('zoomstart', stop)
    return () => {
      map.off('dragstart', stop)
      map.off('zoomstart', stop)
    }
  }, [map])

  const radiusM = site.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  const lat = position?.lat
  const lng = position?.lng
  const accuracyM = position?.accuracyM

  React.useEffect(() => {
    if (userMoved.current) return
    // `toBounds` recibe el lado del cuadrado en metros (el diámetro del círculo).
    const bounds = L.latLng(site.lat, site.lng).toBounds(radiusM * 2)
    if (lat !== undefined && lng !== undefined) {
      bounds.extend(
        L.latLng(lat, lng).toBounds(Math.max(accuracyM ?? 0, 5) * 2),
      )
    }
    fitting.current = true
    map.fitBounds(bounds, {
      padding: FIT_PADDING,
      maxZoom: MAX_ZOOM_ON_FIT,
      animate: false,
    })
    fitting.current = false
  }, [map, site.lat, site.lng, radiusM, lat, lng, accuracyM])

  return null
}

const SITE_ICON = createMarkerIcon('primary')
const OWN_ICON = createMarkerIcon('info')

/**
 * Implementación real del mini mapa (Leaflet); se carga diferida desde
 * `GeofenceMiniMap.tsx`.
 */
function GeofenceMiniMap({
  site,
  position,
  status,
  readOnly = false,
  height = 240,
  className,
  scrollWheelZoom = false,
}: LeafletGeofenceMiniMapProps) {
  const [baseLayer, setBaseLayer] = useBaseLayer()
  const radiusM = site.radiusM ?? DEFAULT_GEOFENCE_RADIUS_M
  const siteVariant: BadgeVariant = status ? STATUS_VARIANT[status] : 'neutral'

  const siteName = site.name ? ` de ${site.name}` : ''
  const ariaLabel = readOnly
    ? `Mapa con la sede${site.name ? ` ${site.name}` : ''} y el punto del fichaje guardado${status ? `: ${STATUS_TEXT[status]}` : ''}.`
    : `Mapa con la zona${siteName} y tu ubicación${status ? `: ${STATUS_TEXT[status]}` : ''}.`

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'relative isolate overflow-hidden rounded-lg border border-border',
        className,
      )}
      style={{ height }}
    >
      <MapContainer
        center={[site.lat, site.lng]}
        zoom={16}
        zoomControl={false}
        scrollWheelZoom={scrollWheelZoom && !readOnly}
        className="size-full"
      >
        <BaseTileLayer kind={baseLayer} />
        <ZoomControl zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <AutoFit site={site} position={position} />
        <Circle
          center={[site.lat, site.lng]}
          radius={radiusM}
          pathOptions={circlePathOptions(siteVariant, { fillOpacity: 0.2 })}
          interactive={false}
        />
        <Marker
          position={[site.lat, site.lng]}
          icon={SITE_ICON}
          alt={site.name ?? 'Sede'}
          title={site.name ?? 'Sede'}
          keyboard={false}
        />
        {position && (
          <>
            <Circle
              center={[position.lat, position.lng]}
              radius={Math.max(position.accuracyM, 1)}
              pathOptions={circlePathOptions(readOnly ? 'neutral' : 'info', {
                fillOpacity: 0.12,
                weight: 1.5,
                dashArray: '4 4',
              })}
              interactive={false}
            />
            <Marker
              position={[position.lat, position.lng]}
              icon={OWN_ICON}
              alt={readOnly ? 'Punto del fichaje' : 'Tu ubicación'}
              title={readOnly ? 'Punto del fichaje' : 'Tu ubicación'}
              keyboard={false}
            />
          </>
        )}
      </MapContainer>
      <BaseLayerToggle value={baseLayer} onChange={setBaseLayer} />
    </div>
  )
}

export { GeofenceMiniMap }
