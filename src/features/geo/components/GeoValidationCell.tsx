import { GeoStatusBadge } from '@/components/status'
import type { BoardAttendanceGeo } from '@/api/attendance'

interface GeoValidationCellProps {
  checkIn: BoardAttendanceGeo | null | undefined
  checkOut: BoardAttendanceGeo | null | undefined
}

/**
 * Celda «Validación» de las tablas de asistencia (B-20): el resultado de la
 * validación por ubicación del inicio y, si ya fichó, del fin. Sin fichaje,
 * un guion. Con un solo fichaje no se repite el rótulo «Inicio».
 */
function GeoValidationCell({ checkIn, checkOut }: GeoValidationCellProps) {
  if (!checkIn && !checkOut) {
    return <span aria-label="Sin fichaje">—</span>
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {checkIn && (
        <div className="flex flex-wrap items-center gap-1.5">
          {checkOut && <span className="text-[11px] text-text-3">Inicio</span>}
          <GeoStatusBadge
            status={checkIn.status}
            reason={checkIn.reason}
            distanceM={checkIn.distanceM}
            corrected={checkIn.overridden}
            showDistance={checkIn.status === 'outside' && !checkIn.overridden}
            showReason={false}
          />
        </div>
      )}
      {checkOut && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-3">Fin</span>
          <GeoStatusBadge
            status={checkOut.status}
            reason={checkOut.reason}
            distanceM={checkOut.distanceM}
            corrected={checkOut.overridden}
            showDistance={checkOut.status === 'outside' && !checkOut.overridden}
            showReason={false}
          />
        </div>
      )}
    </div>
  )
}

export { GeoValidationCell }
