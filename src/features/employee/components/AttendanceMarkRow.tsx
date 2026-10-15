import { Badge } from '@/components/ui/badge'
import { GeoStatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import type { AttendanceGeo } from '@/api/attendanceGeo'

/**
 * `AttendanceMarkRow` (módulo B1, B-19, B-28): una fila de historial con un
 * fichaje -- la hora, el resultado de la validación por ubicación («Validado»,
 * «Fuera de zona», «Sin validar») y la marca «Corregido» si la administración
 * cambió la hora. El motivo de la corrección no llega nunca al celular (B-28)
 * y las coordenadas tampoco (B-40).
 */
export interface AttendanceMarkRowProps {
  /** «Inicio» / «Fin». */
  label: string
  /** Instante del fichaje; `null` si todavía no hay (la fila no se muestra). */
  at: string | null | undefined
  geo?: AttendanceGeo | null
  timeCorrected?: boolean
  /** Muestra solo las marcas (resumen del turno, donde la hora ya está en su propia fila). */
  hideTime?: boolean
}

export function AttendanceMarkRow({
  label,
  at,
  geo,
  timeCorrected = false,
  hideTime = false,
}: AttendanceMarkRowProps) {
  if (!at) return null
  return (
    <div
      className={
        hideTime
          ? 'flex flex-wrap items-center justify-between gap-x-2 gap-y-1'
          : 'flex flex-wrap items-center gap-x-2 gap-y-1'
      }
      data-testid="attendance-mark"
    >
      <span className="text-[12px] text-text-3">
        {hideTime ? label : `${label} ${formatTime(at)}`}
      </span>
      {timeCorrected && <Badge variant="info">Corregido</Badge>}
      {geo && (
        <GeoStatusBadge
          status={geo.status}
          reason={geo.reason}
          corrected={geo.overridden}
          distanceM={geo.distanceM}
          showDistance={geo.status === 'outside' && !geo.overridden}
          distanceFormat="parens"
        />
      )}
    </div>
  )
}
