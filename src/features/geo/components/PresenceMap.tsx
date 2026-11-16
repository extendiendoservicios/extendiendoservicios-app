import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Check, Clock, MapPinOff } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/SegmentedControl'
import { MapView, type MapViewMarker } from '@/components/map'
import { GeoStatusBadge } from '@/components/status'
import { formatDistanceM } from '@/lib/geo'
import { formatMinutes, formatTime } from '@/lib/format'
import type { ActiveSiteRow, PresenceRow, SiteDayStatusRow } from '@/api/geo'
import { useAuth } from '@/features/auth/AuthProvider'
import type { SupervisorStatusRow } from '@/api/supervisorStatus'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import {
  useActiveSitesQuery,
  usePresenceTodayQuery,
  useSitesDayStatusQuery,
  useSupervisorStatusQuery,
} from '../queries'
import {
  readMapMode,
  readPresenceFilters,
  writeMapMode,
  writePresenceFilters,
  type MapMode,
  type PresenceFilters,
} from '../presencePreference'
import {
  activeSiteClientName,
  activeSiteServiceLabel,
  activeSitesCounterLabel,
  buildActiveSiteMarkers,
} from '../activeSites'
import {
  buildPresenceMarkers,
  presenceClientName,
  presencePersonName,
  SITE_STATE_LABEL,
} from '../presence'
import {
  coordinatorName,
  coordinatorStatusDetail,
  coordinatorWorkdayPath,
  SUPERVISOR_STATUS_LABELS,
  SUPERVISOR_STATUS_ORDER,
  SUPERVISOR_STATUS_VARIANTS,
} from '../coordinators'

/** Franja `08:00 a 12:00` de la fila (sin segundos); vacía si el turno no la trae. */
function scheduleLabel(row: PresenceRow): string {
  if (!row.startTime) return ''
  const start = row.startTime.slice(0, 5)
  const end = row.endTime ? row.endTime.slice(0, 5) : null
  return end ? `${start} a ${end}` : start
}

/** Popup de la sede (OF-13): cuántos turnos por comenzar, en curso y finalizados, y la hora del próximo. */
function SitePopup({ site }: { site: SiteDayStatusRow }) {
  const client = site.clientTradeName ?? site.clientLegalName ?? ''
  return (
    <div className="flex min-w-48 flex-col gap-1 text-[12px]">
      <p className="font-semibold text-text">{client}</p>
      <p className="text-text-2">{site.siteName}</p>
      <p className="font-medium text-text">
        Hoy: {SITE_STATE_LABEL[site.dayState]}
      </p>
      <ul className="text-text-3">
        <li>Por comenzar: {site.upcomingCount}</li>
        <li>En curso: {site.inProgressCount}</li>
        <li>Finalizados: {site.finishedCount}</li>
      </ul>
      {site.nextStartsAt && (
        <p className="text-text-3">
          Próximo turno: {formatTime(site.nextStartsAt)}
        </p>
      )}
      {site.radiusM != null && (
        <p className="text-text-3">
          Radio de validación: {formatDistanceM(site.radiusM)}
        </p>
      )}
    </div>
  )
}

/** Popup de la sede en «Todos los clientes» (OG-01): cliente, sede, servicios activos y «Ver sede». */
function ActiveSitePopup({ site }: { site: ActiveSiteRow }) {
  return (
    <div className="flex min-w-52 flex-col gap-1 text-[12px]">
      <p className="font-semibold text-text">{activeSiteClientName(site)}</p>
      <p className="text-text-2">
        {site.siteName}
        {site.siteCity ? ` · ${site.siteCity}` : ''}
      </p>
      {site.services.length > 0 && (
        <ul className="text-text-3">
          {site.services.map((service, index) => (
            <li key={`${service.name}-${index}`}>
              {activeSiteServiceLabel(service)}
            </li>
          ))}
        </ul>
      )}
      <Link
        to={`/admin/sedes/${site.siteId}`}
        className="font-semibold text-primary-800 hover:underline"
      >
        Ver sede
      </Link>
    </div>
  )
}

const MAP_MODE_OPTIONS: { value: MapMode; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'all', label: 'Todos los clientes' },
]

/** Popup del punto (B-15): quién, dónde, horario, inicio, distancia, precisión, estado y «Ver turno». */
function PresencePopup({ row }: { row: PresenceRow }) {
  return (
    <div className="flex min-w-52 flex-col gap-1 text-[12px]">
      <p className="font-semibold text-text">
        {presencePersonName(row)}{' '}
        <span className="font-normal text-text-3">· Empleado</span>
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
 * Popup del coordinador (CJ-22, CJ-33): estado (con cliente y sede si está
 * supervisando, o el motivo de la pausa), hora del último registro, horas de
 * hoy y «Ver jornada».
 */
function CoordinatorPopup({ row }: { row: SupervisorStatusRow }) {
  return (
    <div className="flex min-w-52 flex-col gap-1 text-[12px]">
      <p className="font-semibold text-text">
        {coordinatorName(row)}{' '}
        <span className="font-normal text-text-3">· Coordinador</span>
      </p>
      <p className="text-text-2">{coordinatorStatusDetail(row)}</p>
      {row.lastEventAt && (
        <p className="text-text-3">
          Último registro: {formatTime(row.lastEventAt)}
        </p>
      )}
      <p className="text-text-3">
        Horas de hoy: {formatMinutes(row.workedMinutes)}
      </p>
      {row.autoClosed && !row.corrected && (
        <p className="font-medium text-warning-800">Cerrada automáticamente</p>
      )}
      <Link
        to={coordinatorWorkdayPath(row.supervisorId)}
        className="font-semibold text-primary-800 hover:underline"
      >
        Ver jornada
      </Link>
    </div>
  )
}

/** Fondo de la muestra de la leyenda (mismos tokens que los marcadores del mapa). */
const LEGEND_BG: Record<string, string> = {
  info: 'bg-info',
  primary: 'bg-primary',
  warning: 'bg-warning',
  dark: 'bg-dark',
  neutral: 'bg-text-3',
}

/**
 * Mapa de presencia de ADM-02 (B-11 a B-15, CJ-22, CJ-33): empleados que
 * están trabajando, en la posición de su fichaje de inicio, coloreados por la
 * validación (B-03); los coordinadores en la posición de su último evento,
 * con un color por estado y el filtro «Coordinadores»; las sedes con un turno
 * en la franja actual con su círculo; los conmutadores
 * «Por comenzar», «En curso» y «Finalizados» (OF-13); y debajo, «Trabajando sin ubicación» y «Coordinadores sin ubicación».
 * Los empleados se actualizan cada 45 s (B-39) y los coordinadores cada 60 s
 * (ADR-012), también al volver a la pestaña, sin Realtime.
 */
function PresenceMap() {
  const { userId } = useAuth()
  const query = usePresenceTodayQuery()
  const sitesQuery = useSitesDayStatusQuery()
  const coordinatorsQuery = useSupervisorStatusQuery()
  const [mode, setMode] = useState<MapMode>(() => readMapMode(userId))
  const activeSitesQuery = useActiveSitesQuery(mode === 'all')
  const [filters, setFilters] = useState<PresenceFilters>(() =>
    readPresenceFilters(userId),
  )
  const { showUpcoming, showInProgress, showFinished, showCoordinators } =
    filters

  // La elección se recuerda por persona en este navegador (OF-13): el mapa
  // vive dentro de la sesión, así que `userId` ya está al montar.
  function setFilter(key: keyof PresenceFilters, value: boolean) {
    setFilters((current) => {
      const next = { ...current, [key]: value }
      writePresenceFilters(userId, next)
      return next
    })
  }

  // La elección se recuerda por persona en este navegador (OG-01).
  function changeMode(next: MapMode) {
    setMode(next)
    writeMapMode(userId, next)
  }

  const activeModel = useMemo(
    () => buildActiveSiteMarkers(activeSitesQuery.data ?? []),
    [activeSitesQuery.data],
  )

  const model = useMemo(
    () =>
      buildPresenceMarkers(query.data ?? [], {
        showFinished,
        showInProgress,
        showUpcoming,
        sites: sitesQuery.data ?? [],
        coordinators: coordinatorsQuery.data ?? [],
        showCoordinators,
      }),
    [
      query.data,
      showFinished,
      showInProgress,
      showUpcoming,
      sitesQuery.data,
      coordinatorsQuery.data,
      showCoordinators,
    ],
  )

  function renderPopup(marker: MapViewMarker) {
    if (marker.id.startsWith('active-site-')) {
      const site = marker.data as ActiveSiteRow | undefined
      return site ? <ActiveSitePopup site={site} /> : null
    }
    if (marker.id.startsWith('coordinator-')) {
      const coordinator = marker.data as SupervisorStatusRow | undefined
      return coordinator ? <CoordinatorPopup row={coordinator} /> : null
    }
    if (marker.id.startsWith('site-')) {
      const site = marker.data as SiteDayStatusRow | undefined
      return site ? <SitePopup site={site} /> : null
    }
    const row = marker.data as PresenceRow | undefined
    return row ? <PresencePopup row={row} /> : null
  }

  const loadError =
    mode === 'all'
      ? activeSitesQuery.error
      : (query.error ?? sitesQuery.error ?? coordinatorsQuery.error)

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
          {mode === 'today' && query.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={query.dataUpdatedAt} />
          )}
          <SegmentedControl
            aria-label="Qué mostrar en el mapa"
            options={MAP_MODE_OPTIONS}
            value={mode}
            onValueChange={changeMode}
          />
        </div>
        {mode === 'today' ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label
              htmlFor="presence-show-upcoming"
              className="flex items-center gap-3 text-[13px] font-medium text-text"
            >
              Por comenzar
              <Switch
                id="presence-show-upcoming"
                checked={showUpcoming}
                onCheckedChange={(value) => setFilter('showUpcoming', value)}
              />
            </label>
            <label
              htmlFor="presence-show-in-progress"
              className="flex items-center gap-3 text-[13px] font-medium text-text"
            >
              En curso
              <Switch
                id="presence-show-in-progress"
                checked={showInProgress}
                onCheckedChange={(value) => setFilter('showInProgress', value)}
              />
            </label>
            <label
              htmlFor="presence-show-finished"
              className="flex items-center gap-3 text-[13px] font-medium text-text"
            >
              Finalizados
              <Switch
                id="presence-show-finished"
                checked={showFinished}
                onCheckedChange={(value) => setFilter('showFinished', value)}
              />
            </label>
            <label
              htmlFor="presence-show-coordinators"
              className="flex items-center gap-3 text-[13px] font-medium text-text"
            >
              Coordinadores
              <Switch
                id="presence-show-coordinators"
                checked={showCoordinators}
                onCheckedChange={(value) =>
                  setFilter('showCoordinators', value)
                }
              />
            </label>
          </div>
        ) : (
          <p className="text-[13px] font-semibold text-text">
            {activeSitesCounterLabel(activeModel)}
          </p>
        )}
      </div>

      {loadError && (
        <p role="alert" className="text-[13px] text-danger-800">
          {loadError.message}
        </p>
      )}

      <MapView
        markers={mode === 'all' ? activeModel.markers : model.markers}
        height={380}
        className="w-full"
        renderPopup={renderPopup}
        emptyTitle={
          mode === 'all'
            ? activeSitesQuery.isLoading
              ? 'Cargando el mapa…'
              : 'No hay sedes con ubicación para mostrar'
            : query.isLoading || sitesQuery.isLoading
              ? 'Cargando el mapa…'
              : 'Nada para mostrar con estos filtros'
        }
        emptyDescription={
          mode === 'all'
            ? 'Solo se ven las sedes con ubicación de clientes activos con algún servicio activo.'
            : 'Prendé «Por comenzar», «En curso» o «Finalizados», o esperá a que alguien fiche el inicio con ubicación.'
        }
      />

      {mode === 'all' ? (
        <ul
          aria-label="Referencias del mapa"
          className="text-[11.5px] text-text-3"
        >
          <li>El color de cada pin es el del cliente en el calendario.</li>
        </ul>
      ) : (
        <>
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
            {showCoordinators &&
              SUPERVISOR_STATUS_ORDER.map((status) => (
                <li key={status} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`size-2.5 rotate-45 rounded-[2px] ${LEGEND_BG[SUPERVISOR_STATUS_VARIANTS[status]] ?? 'bg-text-3'}`}
                  />
                  Coordinador: {SUPERVISOR_STATUS_LABELS[status].toLowerCase()}
                </li>
              ))}
            <li className="flex items-center gap-1.5">
              <img
                src="/icons/isotipo_blanco_34px@2x.png"
                srcSet="/icons/isotipo_blanco_34px@2x.png 2x, /icons/isotipo_blanco_34px@3x.png 3x"
                alt=""
                aria-hidden="true"
                className="box-content h-2.5 w-auto rounded-full bg-primary p-1"
              />
              Sede en curso
            </li>
            <li className="flex items-center gap-1.5">
              <Clock
                aria-hidden="true"
                className="box-content size-2.5 rounded-full bg-warning p-1 text-white"
              />
              Sede con turnos por comenzar
            </li>
            <li className="flex items-center gap-1.5">
              <Check
                aria-hidden="true"
                className="box-content size-2.5 rounded-full bg-text-3 p-1 text-white"
              />
              Sede finalizada
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
                    {' · '}
                    {presenceClientName(row)} · {row.siteName}
                    {row.checkInAt
                      ? ` · inicio ${formatTime(row.checkInAt)}`
                      : ''}
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

          {showCoordinators && (
            <div aria-live="polite" className="flex flex-col gap-1">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-text">
                <MapPinOff aria-hidden="true" className="size-4 text-text-3" />
                Coordinadores sin ubicación:{' '}
                {model.coordinatorsWithoutLocation.length}
              </p>
              {model.coordinatorsWithoutLocation.length > 0 && (
                <ul className="flex flex-col gap-1 pl-6 text-[12.5px] text-text-2">
                  {model.coordinatorsWithoutLocation.map((row) => (
                    <li key={row.supervisorId}>
                      <span className="font-medium text-text">
                        {coordinatorName(row)}
                      </span>
                      {' · '}
                      {coordinatorStatusDetail(row)}
                      {row.onLeave ? ' · de licencia' : ''}
                      {row.lastEventAt
                        ? ` · último registro ${formatTime(row.lastEventAt)}`
                        : ''}
                      {row.workdayId && (
                        <>
                          {' · '}
                          <Link
                            to={coordinatorWorkdayPath(row.supervisorId)}
                            className="font-semibold text-primary-800 hover:underline"
                          >
                            Ver jornada
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export { PresenceMap }
