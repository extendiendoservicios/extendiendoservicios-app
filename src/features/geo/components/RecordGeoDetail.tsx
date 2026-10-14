import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { GeoStatusBadge } from '@/components/status'
import { formatDistanceM } from '@/lib/geo'
import { formatTime } from '@/lib/format'
import type { AttendanceGeo } from '@/api/attendance'
import type { GeoRecordType } from '@/api/geo'
import { canMarkGeoAsValid } from '../permissions'
import { CorrectTimeDialog } from './CorrectTimeDialog'
import { LocationMiniMap } from './LocationMiniMap'
import { OverrideGeoDialog } from './OverrideGeoDialog'

interface RecordGeoDetailProps {
  recordType: GeoRecordType
  /** «Inicio» o «Fin». */
  kind: 'check_in' | 'check_out'
  /** Hora registrada (instante). */
  recordedAt: string
  /** Fecha del turno, para acotar «Corregir hora». */
  shiftDate: string
  geo: AttendanceGeo
  /** Dueño o administrador con `manage_attendance`: ve «Corregir hora» y «Marcar como válido». */
  canManage: boolean
}

/**
 * Validación por ubicación de UN fichaje en el detalle del turno (B-20, ADM-06)
 * o de la supervisión (ADM-15): la hora con la marca «Corregido» (B-28), el
 * resultado, la distancia, la precisión, el motivo que escribió la persona, las
 * dos acciones de corrección con motivo obligatorio y el mini mapa de solo
 * lectura si el fichaje tiene posición.
 */
function RecordGeoDetail({
  recordType,
  kind,
  recordedAt,
  shiftDate,
  geo,
  canManage,
}: RecordGeoDetailProps) {
  const [isCorrectOpen, setCorrectOpen] = useState(false)
  const [isOverrideOpen, setOverrideOpen] = useState(false)
  const [isMapOpen, setMapOpen] = useState(false)

  const label = kind === 'check_in' ? 'Inicio' : 'Fin'
  const hasPosition = geo.accuracyM != null
  // `correct_attendance_time` es solo de `attendance_records`: las supervisiones no se corrigen en hora.
  const canCorrectTime = canManage && recordType === 'attendance'
  const canOverride = canManage && canMarkGeoAsValid(geo)

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-[12.5px] font-semibold text-text">
          {label} {formatTime(recordedAt)}
          {geo.timeCorrected && (
            <span className="ml-2 rounded-full bg-warning-bg px-2 py-px text-[11px] font-semibold text-warning-800">
              Corregido
            </span>
          )}
        </p>
        <GeoStatusBadge
          status={geo.status}
          reason={geo.reason}
          corrected={geo.overridden}
        />
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[11.5px] text-text-3 sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold text-text-2">
            Distancia a la sede:{' '}
          </dt>
          <dd className="inline">
            {geo.distanceM != null ? formatDistanceM(geo.distanceM) : '—'}
            {geo.radiusM != null && ` (radio ${formatDistanceM(geo.radiusM)})`}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold text-text-2">
            Precisión del GPS:{' '}
          </dt>
          <dd className="inline">
            {geo.accuracyM != null ? formatDistanceM(geo.accuracyM) : '—'}
          </dd>
        </div>
      </dl>

      {geo.outsideReason && (
        <p className="text-[12px] text-text-2">
          <span className="font-semibold">Motivo del empleado: </span>
          {geo.outsideReason}
        </p>
      )}

      {(canCorrectTime || canOverride || hasPosition) && (
        <div className="flex flex-wrap gap-2">
          {canCorrectTime && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCorrectOpen(true)}
            >
              Corregir hora
            </Button>
          )}
          {canOverride && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOverrideOpen(true)}
            >
              Marcar como válido
            </Button>
          )}
          {hasPosition && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={isMapOpen}
              onClick={() => setMapOpen((value) => !value)}
            >
              {isMapOpen ? 'Ocultar mapa' : 'Ver en el mapa'}
            </Button>
          )}
        </div>
      )}

      {isMapOpen && hasPosition && (
        <LocationMiniMap recordType={recordType} recordId={geo.recordId} />
      )}

      {canCorrectTime && (
        <CorrectTimeDialog
          recordId={geo.recordId}
          kind={kind}
          currentTime={recordedAt}
          shiftDate={shiftDate}
          open={isCorrectOpen}
          onOpenChange={setCorrectOpen}
        />
      )}
      {canOverride && (
        <OverrideGeoDialog
          recordType={recordType}
          recordId={geo.recordId}
          open={isOverrideOpen}
          onOpenChange={setOverrideOpen}
        />
      )}
    </div>
  )
}

export { RecordGeoDetail }
