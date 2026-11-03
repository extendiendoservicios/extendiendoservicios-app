import { StatusBadge } from '@/components/status'
import { formatTime } from '@/lib/format'
import type { AttendanceBoardRow } from '@/api/attendance'
import { isLateArrival } from '@/features/attendance/derive'
import { timeCorrectedSuffix } from '@/features/geo/outsideZone'

/**
 * Celda «Inicio real» de Servicios de hoy (ADM-02) y de Asistencia de hoy
 * (ADM-10). OD-17: si el fichaje de inicio es posterior al inicio programado
 * va con fondo amarillo y la píldora «Llegada tarde» (la misma `StatusBadge`
 * del estado `late`). Sin fichaje, un guion.
 */
function CheckInCell({ row }: { row: AttendanceBoardRow }) {
  if (!row.checkInAt) {
    return <>—</>
  }
  const text = `${formatTime(row.checkInAt)}${timeCorrectedSuffix(row.checkInGeo)}`
  if (!isLateArrival(row)) {
    return <>{text}</>
  }
  return (
    <span
      data-testid="late-arrival-cell"
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-warning-bg px-2 py-1 text-warning-800"
    >
      <span className="font-semibold">{text}</span>
      <StatusBadge domain="assignment" status="late" />
    </span>
  )
}

export { CheckInCell }
