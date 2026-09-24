import * as React from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  ZoomControl,
} from 'react-leaflet'
import { MapPin } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/EmptyState'
import type { BadgeVariant } from '@/components/status'
import type { Coordinates } from './coordinates'
import { createMarkerIcon } from './markerIcon'

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
  /** Centro cuando no hay marcadores para encuadrar (por omisión, Obelisco, CABA). */
  defaultCenter?: Coordinates
  defaultZoom?: number
  emptyTitle?: string
  emptyDescription?: string
}

/** Centro por omisión cuando no hay marcadores para calcular el encuadre: Obelisco, CABA. */
const DEFAULT_CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 12
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
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
  emptyTitle = 'Sin ubicaciones para mostrar',
  emptyDescription = 'Todavía no hay coordenadas cargadas.',
}: MapViewProps) {
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
        'overflow-hidden rounded-lg border border-border',
        className,
      )}
      style={{ height }}
    >
      <MapContainer
        center={[defaultCenter.lat, defaultCenter.lng]}
        zoom={defaultZoom}
        zoomControl={false}
        className="size-full"
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">colaboradores de OpenStreetMap</a>'
        />
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
            {marker.popup && <Popup>{marker.popup}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

export { MapView }
