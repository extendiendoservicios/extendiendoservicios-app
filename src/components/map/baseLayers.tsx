import * as React from 'react'
import { TileLayer } from 'react-leaflet'
import { cn } from 'cn'

/**
 * Capa de fondo de los mapas: el mapa de OpenStreetMap o el satelital de
 * Esri (ArcGIS Location Platform, servicio de mosaicos estáticos; elegido
 * por Mike el 8 oct 2026 en lugar de Google: no pide tarjeta y el plan
 * gratuito alcanza). La clave de Esri es pública por diseño (va en el
 * navegador) y está restringida por sitio de origen en la cuenta de Esri.
 * Sin `VITE_ARCGIS_API_KEY` el satelital no se ofrece y el mapa queda como
 * antes.
 */
export type BaseLayerKind = 'map' | 'satellite'

const ARCGIS_API_KEY = import.meta.env.VITE_ARCGIS_API_KEY ?? ''

export const isSatelliteAvailable = ARCGIS_API_KEY !== ''

/** Estilo de Esri: imágenes satelitales con nombres de calles y localidades. */
const SATELLITE_STYLE = 'arcgis/imagery/labels'

const SATELLITE_URL = `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/${SATELLITE_STYLE}/static/tile/{z}/{y}/{x}?token=${encodeURIComponent(ARCGIS_API_KEY)}`

/** El fondo elegido. El `key` fuerza a Leaflet a cambiar de capa en vez de reusar los mosaicos. */
export function BaseTileLayer({ kind }: { kind: BaseLayerKind }) {
  if (kind === 'satellite' && isSatelliteAvailable) {
    return (
      <TileLayer
        key="satellite"
        url={SATELLITE_URL}
        // El servicio devuelve mosaicos de 512 px.
        tileSize={512}
        zoomOffset={-1}
        maxZoom={19}
        attribution='Imágenes: <a href="https://www.esri.com" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics y la comunidad de usuarios de SIG'
      />
    )
  }
  return (
    <TileLayer
      key="map"
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">colaboradores de OpenStreetMap</a>'
    />
  )
}

/** Estado del fondo elegido, compartido por el mapa y su botón. */
export function useBaseLayer() {
  return React.useState<BaseLayerKind>('map')
}

const OPTIONS: { value: BaseLayerKind; label: string }[] = [
  { value: 'map', label: 'Mapa' },
  { value: 'satellite', label: 'Satélite' },
]

/**
 * Botón "Mapa / Satélite" arriba a la derecha. Va fuera del
 * `MapContainer` (en el contenedor con `relative`), así un clic acá no
 * llega al mapa ni mueve el marcador del `MapPicker`.
 */
export function BaseLayerToggle({
  value,
  onChange,
  className,
}: {
  value: BaseLayerKind
  onChange: (value: BaseLayerKind) => void
  className?: string
}) {
  if (!isSatelliteAvailable) return null
  return (
    <div
      role="radiogroup"
      aria-label="Tipo de mapa"
      className={cn(
        'absolute top-2.5 right-2.5 z-[1000] flex rounded-md border border-border-strong bg-surface p-0.5 shadow-card',
        className,
      )}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[11.5px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring max-md:min-h-9',
            value === option.value
              ? 'bg-primary text-white'
              : 'text-text-2 hover:bg-bg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
