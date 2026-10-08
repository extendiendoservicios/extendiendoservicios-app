import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapContainer, Marker, Popup, useMap, ZoomControl } from 'react-leaflet'
import { MapPin } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/EmptyState'
import type { BadgeVariant } from '@/components/status'
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  type Coordinates,
} from './coordinates'
import { createMarkerIcon } from './markerIcon'
import { BaseLayerToggle, BaseTileLayer, useBaseLayer } from './baseLayers'

/** Un punto del mapa: una sede, en el uso principal de `MapView` (SITE-005, ADM-24). */
export interface MapViewMarker {
  id: string
  position: Coordinates
  /** Variante visual del punto (mismas variantes que `StatusBadge`, `07` sección 3). */
  variant?: BadgeVariant
  /** Texto accesible del marcador (lo anuncia el lector de pantalla al enfocarlo). */
  label: string
  /** Contenido del popup al hacer clic o Enter sobre el marcador; lo arma quien usa `MapView`. */
  popup?: React.ReactNode
}

export interface MapViewProps {
  markers: MapViewMarker[]
  /** Alto del mapa (CSS), 320 px por omisión. */
  height?: number | string
  className?: string
  /** Centro cuando no hay marcadores para encuadrar (por omisión, Pergamino, Buenos Aires). */
  defaultCenter?: Coordinates
  defaultZoom?: number
  emptyTitle?: string
  emptyDescription?: string
  /**
   * Zoom con la rueda del mouse (SITE-005/P08.4). `true` por omisión: desde
   * el 8 oct 2026 (pedido de Mike) la rueda sobre el mapa acerca y aleja
   * también en los mapas embebidos (ADM-22, `MapPicker`); fuera del mapa
   * sigue desplazando la página.
   */
  scrollWheelZoom?: boolean
}

const SINGLE_MARKER_ZOOM = 15
const FIT_BOUNDS_PADDING: [number, number] = [32, 32]

/**
 * Ajusta el encuadre del mapa a los marcadores actuales: centra y hace zoom
 * sobre el único punto si hay uno solo, o calcula los límites que contienen
 * a todos si hay más de uno. Componente sin salida visual, solo efecto
 * sobre el mapa (`useMap`, patrón de react-leaflet).
 */
function FitToMarkers({ markers }: { markers: MapViewMarker[] }) {
  const map = useMap()

  React.useEffect(() => {
    const [first] = markers
    if (!first) return

    if (markers.length === 1) {
      map.setView([first.position.lat, first.position.lng], SINGLE_MARKER_ZOOM)
      return
    }

    const bounds = L.latLngBounds(
      markers.map((marker) => [marker.position.lat, marker.position.lng]),
    )
    map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING })
  }, [markers, map])

  return null
}

/**
 * MapView (SITE-005): mapa de solo lectura con tiles de OpenStreetMap y un
 * marcador por punto (`07` sección 2.4). Implementación real de Leaflet —
 * se carga diferida desde `MapView.tsx`, que es lo que importa el resto de
 * la app.
 */
function MapView({
  markers,
  height = 320,
  className,
  defaultCenter = DEFAULT_MAP_CENTER,
  defaultZoom = DEFAULT_MAP_ZOOM,
  emptyTitle = 'Sin ubicaciones para mostrar',
  emptyDescription = 'Todavía no hay coordenadas cargadas.',
  scrollWheelZoom = true,
}: MapViewProps) {
  const [baseLayer, setBaseLayer] = useBaseLayer()
  if (markers.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-border bg-surface',
          className,
        )}
        style={{ height }}
      >
        <EmptyState
          icon={MapPin}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-lg border border-border',
        className,
      )}
      style={{ height }}
    >
      <MapContainer
        center={[defaultCenter.lat, defaultCenter.lng]}
        zoom={defaultZoom}
        zoomControl={false}
        scrollWheelZoom={scrollWheelZoom}
        className="size-full"
      >
        <BaseTileLayer kind={baseLayer} />
        <ZoomControl zoomInTitle="Acercar" zoomOutTitle="Alejar" />
        <FitToMarkers markers={markers} />
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.position.lat, marker.position.lng]}
            icon={createMarkerIcon(marker.variant)}
            alt={marker.label}
            title={marker.label}
          >
            {marker.popup && (
              <Popup>
                {/* Leaflet les pone 17px de margen a los <p> del popup. */}
                <div className="[&_p]:!m-0">{marker.popup}</div>
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
      <BaseLayerToggle value={baseLayer} onChange={setBaseLayer} />
    </div>
  )
}

export { MapView }
