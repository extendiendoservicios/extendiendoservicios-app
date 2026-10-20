import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { MapPinOff } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { MapView, type MapViewMarker } from '@/components/map'
import { GeoStatusBadge } from '@/components/status'
import { formatDistanceM } from '@/lib/geo'
import { formatTime } from '@/lib/format'
import type { PresenceRow } from '@/api/geo'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { usePresenceTodayQuery } from '../queries'
import {
  buildPresenceMarkers,
  presenceClientName,
  presencePersonName,
} from '../presence'

/** Franja `08:00 a 12:00` de la fila (sin segundos); vacía si el turno no la trae. */
function scheduleLabel(row: PresenceRow): string {
  if (!row.startTime) return ''
  const start = row.startTime.slice(0, 5)
  const end = row.endTime ? row.endTime.slice(0, 5) : null
  return end ? `${start} a ${end}` : start
}

/** Popup del punto (B-15): quién, dónde, horario, inicio, distancia, precisión, estado y «Ver turno». */
function PresencePopup({ row }: { row: PresenceRow }) {
  if (row.kind === 'site') {
    return (
      <div className="flex min-w-44 flex-col gap-1 text-[12px]">
        <p className="font-semibold text-text">{presenceClientName(row)}</p>
        <p className="text-text-2">{row.siteName}</p>
        {row.siteRadiusM != null && (
          <p className="text-text-3">
            Radio de validación: {formatDistanceM(row.siteRadiusM)}
          </p>
        )}
      </div>
    )
  }

  const role = row.kind === 'supervisor' ? 'Coordinador' : 'Empleado'
  return (
    <div className="flex min-w-52 flex-col gap-1 text-[12px]">
      <p className="font-semibold text-text">
        {presencePersonName(row)}{' '}
        <span className="font-normal text-text-3">· {role}</span>
      </p>
      <p className="text-text-2">
        {presenceClientName(row)} · {row.siteName}
      </p>
      {scheduleLabel(row) && (
        <p className="text-text-3">Horario: {scheduleLabel(row)}</p>
      )}
      {row.checkInAt && (
        <p className="text-text-3">Inicio: {formatTime(row.checkInAt)}</p>
      )}
      {row.checkOutAt && (
        <p className="text-text-3">Fin: {formatTime(row.checkOutAt)}</p>
      )}
      {row.distanceM != null && (
        <p className="text-text-3">
          Distancia a la sede: {formatDistanceM(row.distanceM)}
        </p>
      )}
      {row.accuracyM != null && (
        <p className="text-text-3">
          Precisión del GPS: {formatDistanceM(row.accuracyM)}
        </p>
      )}
      {row.geoStatus && (
        <div>
          <GeoStatusBadge
            status={row.geoStatus}
            reason={row.geoReason}
            corrected={row.geoOverridden}
          />
        </div>
      )}
      {row.shiftId && (
        <Link
          to={`/admin/turnos/${row.shiftId}`}
          className="font-semibold text-primary-800 hover:underline"
        >
          Ver turno
        </Link>
      )}
    </div>
  )
}

/**
 * Mapa de presencia de ADM-02 (B-11 a B-15): empleados y supervisores que
 * están trabajando, en la posición de su fichaje de inicio, coloreados por la
 * validación (B-03); las sedes con un turno en la franja actual con su círculo; el interruptor
 * «Mostrar finalizados de hoy»; y debajo, «Trabajando sin ubicación». Se
 * actualiza solo cada 45 s y al volver a la pestaña (B-39), sin Realtime.
 */
function PresenceMap({
  siteIdsInWindow,
}: {
  /** Sedes con un turno en la franja de la hora actual: se marcan aunque nadie haya fichado. */
  siteIdsInWindow: ReadonlySet<string>
}) {
  const query = usePresenceTodayQuery()
  const [showFinished, setShowFinished] = useState(false)

  const model = useMemo(
    () =>
      buildPresenceMarkers(query.data ?? [], {
        showFinished,
        siteIdsInWindow,
      }),
    [query.data, showFinished, siteIdsInWindow],
  )

  function renderPopup(marker: MapViewMarker) {
    const row = marker.data as PresenceRow | undefined
    return row ? <PresencePopup row={row} /> : null
  }

  return (
    <section
      aria-label="Mapa de presencia"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-text">
            Dónde está el equipo
          </h2>
          {query.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={query.dataUpdatedAt} />
          )}
        </div>
        <label
          htmlFor="presence-show-finished"
          className="flex items-center gap-3 text-[13px] font-medium text-text"
        >
          Mostrar finalizados de hoy
          <Switch
            id="presence-show-finished"
            checked={showFinished}
            onCheckedChange={setShowFinished}
          />
        </label>
      </div>

      {query.error && (
        <p role="alert" className="text-[13px] text-danger-800">
          {query.error.message}
        </p>
      )}

      <MapView
        markers={model.markers}
        height={380}
        className="w-full"
        renderPopup={renderPopup}
        emptyTitle={
          query.isLoading
            ? 'Cargando el mapa…'
            : 'Nadie con ubicación por ahora'
        }
        emptyDescription="Cuando alguien fiche el inicio con ubicación, aparece acá."
      />

      <ul
        aria-label="Referencias del mapa"
        className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-text-3"
      >
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-success" />
          Validado
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-danger" />
          Fuera de zona
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-text-3" />
          Sin validar
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rotate-45 rounded-[2px] bg-text-3"
          />
          Coordinador
        </li>
        <li className="flex items-center gap-1.5">
          <img
            src="/icons/isotipo_blanco_34px@2x.png"
            srcSet="/icons/isotipo_blanco_34px@2x.png 2x, /icons/isotipo_blanco_34px@3x.png 3x"
            alt=""
            aria-hidden="true"
            className="box-content h-2.5 w-auto rounded-full bg-primary p-1"
          />
          Sede con su radio
        </li>
      </ul>

      <div aria-live="polite" className="flex flex-col gap-1">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <MapPinOff aria-hidden="true" className="size-4 text-text-3" />
          Trabajando sin ubicación: {model.withoutLocation.length}
        </p>
        {model.withoutLocation.length > 0 && (
          <ul className="flex flex-col gap-1 pl-6 text-[12.5px] text-text-2">
            {model.withoutLocation.map((row) => (
              <li key={`${row.kind}-${row.recordId}`}>
                <span className="font-medium text-text">
                  {presencePersonName(row)}
                </span>
                {row.kind === 'supervisor' ? ' (coordinador)' : ''} ·{' '}
                {presenceClientName(row)} · {row.siteName}
                {row.checkInAt ? ` · inicio ${formatTime(row.checkInAt)}` : ''}
                {row.shiftId && (
                  <>
                    {' · '}
                    <Link
                      to={`/admin/turnos/${row.shiftId}`}
                      className="font-semibold text-primary-800 hover:underline"
                    >
                      Ver turno
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

export { PresenceMap }
