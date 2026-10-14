import * as React from 'react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/SegmentedControl'
import { GeofenceMiniMap, MapView, type MapViewMarker } from '@/components/map'
import { GeoStatusBadge } from '@/components/status'
import {
  formatGeoStatusText,
  geoEvaluate,
  useLivePosition,
  type GeoFix,
  type GeoStatus,
  type GeoUnvalidatedReason,
} from '@/lib/geo'

/**
 * Vidriera del módulo B1 (P22.2) para `/dev/design`: `GeofenceMiniMap`,
 * `GeoStatusBadge`, `useLivePosition` y el `MapView` ampliado.
 */

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11.5px] font-semibold text-text-3">{label}</span>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  )
}

/** Sede de ejemplo del mini mapa de fichaje (B-18): radio general de 150 m. */
const GEO_SITE = {
  lat: -34.4708,
  lng: -58.5273,
  radiusM: 150,
  name: 'Grupo Norte — San Isidro',
}

/** Escenarios simulados; 0,0009° de latitud son unos 100 m. */
interface GeoScenario {
  id: string
  label: string
  detail: string
  position: GeoFix | null
}

const SCENARIO_OUTSIDE: GeoScenario = {
  id: 'outside',
  label: 'Fuera',
  detail: 'A 450 m de la sede, precisión de 20 m',
  position: { lat: GEO_SITE.lat + 0.004, lng: GEO_SITE.lng, accuracyM: 20 },
}

const SCENARIO_INSIDE: GeoScenario = {
  id: 'inside',
  label: 'Dentro',
  detail: 'A 30 m de la sede, precisión de 15 m',
  position: { lat: GEO_SITE.lat + 0.00027, lng: GEO_SITE.lng, accuracyM: 15 },
}

const GEO_SCENARIOS: GeoScenario[] = [
  SCENARIO_INSIDE,
  {
    id: 'touching',
    label: 'En el borde',
    detail: 'A 210 m de la sede, precisión de 90 m: los círculos se tocan',
    position: { lat: GEO_SITE.lat + 0.0019, lng: GEO_SITE.lng, accuracyM: 90 },
  },
  SCENARIO_OUTSIDE,
  {
    id: 'low',
    label: 'Precisión mala',
    detail: 'A 120 m de la sede, precisión de 300 m: queda sin validar',
    position: {
      lat: GEO_SITE.lat + 0.00108,
      lng: GEO_SITE.lng,
      accuracyM: 300,
    },
  },
  {
    id: 'none',
    label: 'Sin ubicación',
    detail: 'No se pudo obtener la ubicación',
    position: null,
  },
]

const SCENARIO_OPTIONS = GEO_SCENARIOS.map((item) => ({
  value: item.id,
  label: item.label,
}))

const PRESENCE_MARKERS: MapViewMarker[] = [
  {
    id: 'e1',
    position: { lat: -34.4708, lng: -58.5273 },
    variant: 'success',
    label: 'Ana Pérez (validado)',
    data: { who: 'Ana Pérez', since: '08:02', status: 'Validado' },
  },
  {
    id: 'e2',
    position: { lat: -34.4894, lng: -58.5069 },
    variant: 'danger',
    label: 'Luis Gómez (fuera de zona)',
    data: {
      who: 'Luis Gómez',
      since: '07:58',
      status: 'Fuera de zona (350 m)',
    },
  },
  {
    id: 'e3',
    position: { lat: -34.5308, lng: -58.5225 },
    variant: 'neutral',
    label: 'Marta Ríos (sin validar)',
    data: { who: 'Marta Ríos', since: '08:10', status: 'Sin validar' },
  },
  {
    id: 's1',
    position: { lat: -34.5, lng: -58.54 },
    variant: 'success',
    shape: 'supervisor',
    label: 'Diego Sosa, supervisor (validado)',
    data: {
      who: 'Diego Sosa (supervisor)',
      since: '09:15',
      status: 'Validado',
    },
  },
  {
    id: 'site1',
    position: { lat: -34.51, lng: -58.5 },
    variant: 'primary',
    radiusM: 150,
    label: 'Sede con radio de 150 m',
    popup: 'Sede con radio de 150 m',
  },
]

const REASONS: GeoUnvalidatedReason[] = [
  'no_location',
  'site_without_coords',
  'admin_record',
  'low_accuracy',
]
const STATUSES: GeoStatus[] = ['valid', 'outside', 'unvalidated']

function LivePositionDemo() {
  const [enabled, setEnabled] = React.useState(false)
  const live = useLivePosition({ enabled })
  const evaluation = geoEvaluate({
    position: live.position,
    site: GEO_SITE,
    radiusM: GEO_SITE.radiusM,
  })
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEnabled((value) => !value)}
        >
          {enabled ? 'Dejar de pedir ubicación' : 'Pedir ubicación real'}
        </Button>
        {live.state === 'improving' && live.wait === 'idle' && (
          <Button size="sm" variant="ghost" onClick={live.startWait}>
            Esperar mejor señal
          </Button>
        )}
      </div>
      <p className="text-[12px] text-text-2 tabular-nums">
        Estado: <strong>{live.state}</strong> · precisión:{' '}
        {live.accuracyM === null ? '—' : `${Math.round(live.accuracyM)} m`} ·
        transcurrido: {Math.round(live.elapsedMs / 1000)} s · espera:{' '}
        {live.wait}
        {live.wait === 'running'
          ? ` (${Math.ceil(live.waitRemainingMs / 1000)} s)`
          : ''}
      </p>
      {enabled && (
        <GeofenceMiniMap
          site={GEO_SITE}
          position={live.position}
          status={live.position ? evaluation.status : null}
          height={200}
        />
      )}
    </div>
  )
}

export function GeoDemo() {
  const [scenarioId, setScenarioId] = React.useState('inside')
  const scenario =
    GEO_SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIO_INSIDE
  const evaluation = geoEvaluate({
    position: scenario.position,
    site: GEO_SITE,
    radiusM: GEO_SITE.radiusM,
  })

  return (
    <>
      <p className="text-[11.5px] text-text-3">
        Módulo B1 (P22.2). Los colores salen de los tokens (<code>success</code>
        , <code>danger</code>, gris). El estado nunca va solo por color: siempre
        lo acompaña el texto de <code>GeoStatusBadge</code>.
      </p>
      <Row label="GeoStatusBadge — estados">
        {STATUSES.map((status) => (
          <GeoStatusBadge key={status} status={status} />
        ))}
        <GeoStatusBadge status="outside" corrected />
      </Row>
      <Row label="GeoStatusBadge — motivos de «Sin validar»">
        {REASONS.map((reason) => (
          <GeoStatusBadge key={reason} status="unvalidated" reason={reason} />
        ))}
      </Row>
      <Row label="GeoStatusBadge — con distancia, y sin motivo">
        <GeoStatusBadge status="outside" distanceM={350} showDistance />
        <GeoStatusBadge status="valid" distanceM={42} showDistance />
        <GeoStatusBadge
          status="unvalidated"
          reason="no_location"
          showReason={false}
        />
      </Row>
      <Row label="formatGeoStatusText — texto plano para imprimibles">
        <span className="text-[12px] text-text-2">
          {formatGeoStatusText({ status: 'valid' })} ·{' '}
          {formatGeoStatusText({ status: 'outside', distanceM: 350 })} ·{' '}
          {formatGeoStatusText({
            status: 'unvalidated',
            reason: 'low_accuracy',
          })}{' '}
          ·{' '}
          {formatGeoStatusText({
            status: 'outside',
            distanceM: 350,
            corrected: true,
          })}
        </span>
      </Row>
      <Row label="GeofenceMiniMap — escenarios simulados (el círculo de la sede cambia de color según geoEvaluate)">
        <div className="flex w-full max-w-md flex-col gap-3">
          <SegmentedControl
            aria-label="Escenario"
            options={SCENARIO_OPTIONS}
            value={scenarioId}
            onValueChange={setScenarioId}
          />
          <p className="text-[12px] text-text-2">{scenario.detail}</p>
          <div>
            <GeoStatusBadge
              status={evaluation.status}
              reason={evaluation.reason}
              distanceM={evaluation.distanceM}
              showDistance
            />
          </div>
          <GeofenceMiniMap
            site={GEO_SITE}
            position={scenario.position}
            status={scenario.position ? evaluation.status : null}
          />
        </div>
      </Row>
      <Row label="GeofenceMiniMap — solo lectura (detalle del turno, administración)">
        <div className="w-full max-w-md">
          <GeofenceMiniMap
            readOnly
            site={GEO_SITE}
            position={SCENARIO_OUTSIDE.position}
            status="outside"
            height={220}
          />
        </div>
      </Row>
      <Row label="useLivePosition — con la ubicación real del dispositivo">
        <LivePositionDemo />
      </Row>
      <Row label="MapView — presencia: marcadores verde, rojo y gris, supervisor con rombo, círculo de la sede y popup propio (renderPopup)">
        <div className="w-full max-w-2xl">
          <MapView
            markers={PRESENCE_MARKERS}
            height={300}
            renderPopup={(marker) => {
              const data = marker.data as
                { who: string; since: string; status: string } | undefined
              if (!data) return null
              return (
                <div className="flex flex-col gap-1 text-[12px]">
                  <strong>{data.who}</strong>
                  <span>Inicio {data.since}</span>
                  <span>{data.status}</span>
                  <Button size="sm" variant="ghost">
                    Ver turno
                  </Button>
                </div>
              )
            }}
          />
        </div>
      </Row>
    </>
  )
}
