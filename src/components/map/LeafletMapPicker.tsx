import * as React from 'react'
import type L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import { Search, X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { Coordinates } from './coordinates'
import { useAddressSearch } from './useAddressSearch'
import { useCoordinateFields } from './useCoordinateFields'
import { createMarkerIcon } from './markerIcon'

export interface MapPickerProps {
  /** Coordenadas actuales, o `null` cuando la sede todavía no tiene ubicación. */
  value: Coordinates | null
  onChange: (value: Coordinates | null) => void
  className?: string
  /** Alto del mapa (CSS), 320 px por omisión. */
  height?: number | string
  /** Centro cuando `value` es `null` (por omisión, Obelisco, CABA). */
  defaultCenter?: Coordinates
  defaultZoom?: number
  disabled?: boolean
}

const DEFAULT_CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 }
const DEFAULT_ZOOM = 12
const PICKED_ZOOM = 16

/** Un clic en el mapa (fuera del marcador) ubica ahí las coordenadas. */
function ClickToPlace({
  onPick,
  disabled,
}: {
  onPick: (coords: Coordinates) => void
  disabled: boolean
}) {
  useMapEvents({
    click(event) {
      if (disabled) return
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

/** Recentra el mapa cuando las coordenadas cambian desde afuera del propio mapa (campos de texto, búsqueda). */
function RecenterOnChange({ position }: { position: Coordinates | null }) {
  const map = useMap()

  React.useEffect(() => {
    if (!position) return
    map.setView(
      [position.lat, position.lng],
      Math.max(map.getZoom(), PICKED_ZOOM),
    )
  }, [position, map])

  return null
}

/**
 * MapPicker (SITE-004): marcador arrastrable, clic en el mapa para
 * ubicarlo, campos de latitud y longitud sincronizados
 * (`useCoordinateFields`) y búsqueda de dirección contra Nominatim
 * (`useAddressSearch`, decisión de la política de uso en
 * `nominatimClient.ts`). Implementación real de Leaflet — se carga diferida
 * desde `MapPicker.tsx`, que es lo que importa el resto de la app.
 *
 * Pensado para usarse con `react-hook-form`: `value`/`onChange` son el
 * `field.value`/`field.onChange` de un `Controller` (ver `docs/design-
 * system.md`), con `Coordinates | null` como valor — nunca lat/lng
 * sueltos, así el formulario tiene un único campo que puede quedar vacío.
 */
function MapPicker({
  value,
  onChange,
  className,
  height = 320,
  defaultCenter = DEFAULT_CENTER,
  defaultZoom = DEFAULT_ZOOM,
  disabled = false,
}: MapPickerProps) {
  const {
    latText,
    lngText,
    latError,
    lngError,
    handleLatChange,
    handleLngChange,
    setCoordinates,
    clear,
  } = useCoordinateFields(value, onChange)
  const { query, setQuery, status, results, errorMessage, search, reset } =
    useAddressSearch()

  const initialCenter = value ?? defaultCenter

  function handlePickResult(result: { lat: number; lng: number }) {
    setCoordinates({ lat: result.lat, lng: result.lng })
    reset()
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <Field data-invalid={Boolean(errorMessage)}>
        <FieldLabel htmlFor="map-picker-address">Buscar dirección</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="map-picker-address"
            icon={Search}
            placeholder="Calle, número, localidad…"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // Único disparador además del botón: sigue siendo "una
              // búsqueda por acción del usuario", no autocompletar por
              // cada tecla (ADR-017).
              if (event.key === 'Enter') {
                event.preventDefault()
                void search()
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || status === 'loading'}
            onClick={() => void search()}
          >
            {status === 'loading' ? 'Buscando…' : 'Buscar dirección'}
          </Button>
        </div>
        {errorMessage && (
          <p role="alert" className="text-[11px] font-normal text-destructive">
            {errorMessage}
          </p>
        )}
      </Field>

      {results.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-1">
          {results.map((result) => (
            <li key={`${result.lat}-${result.lng}`}>
              <button
                type="button"
                className="w-full rounded-md px-2 py-[6px] text-left text-[12px] text-text-2 hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                onClick={() => handlePickResult(result)}
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={cn(
          'isolate overflow-hidden rounded-lg border border-border',
          disabled && 'opacity-60',
        )}
        style={{ height }}
      >
        <MapContainer
          center={[initialCenter.lat, initialCenter.lng]}
          zoom={value ? PICKED_ZOOM : defaultZoom}
          scrollWheelZoom={false}
          zoomControl={false}
          className="size-full"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">colaboradores de OpenStreetMap</a>'
          />
          <ZoomControl zoomInTitle="Acercar" zoomOutTitle="Alejar" />
          <ClickToPlace onPick={setCoordinates} disabled={disabled} />
          <RecenterOnChange position={value} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              icon={createMarkerIcon('primary')}
              draggable={!disabled}
              alt="Ubicación elegida"
              title="Ubicación elegida"
              eventHandlers={{
                dragend: (event) => {
                  const marker = event.target as L.Marker
                  const position = marker.getLatLng()
                  setCoordinates({ lat: position.lat, lng: position.lng })
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field data-invalid={Boolean(latError)}>
          <FieldLabel htmlFor="map-picker-lat">Latitud</FieldLabel>
          <Input
            id="map-picker-lat"
            inputMode="decimal"
            value={latText}
            disabled={disabled}
            placeholder="-34.6037"
            error={latError}
            onChange={(event) => handleLatChange(event.target.value)}
          />
        </Field>
        <Field data-invalid={Boolean(lngError)}>
          <FieldLabel htmlFor="map-picker-lng">Longitud</FieldLabel>
          <Input
            id="map-picker-lng"
            inputMode="decimal"
            value={lngText}
            disabled={disabled}
            placeholder="-58.3816"
            error={lngError}
            onChange={(event) => handleLngChange(event.target.value)}
          />
        </Field>
      </div>

      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={X}
          disabled={disabled}
          onClick={clear}
          className="self-start"
        >
          Borrar coordenadas
        </Button>
      )}
    </div>
  )
}

export { MapPicker }
