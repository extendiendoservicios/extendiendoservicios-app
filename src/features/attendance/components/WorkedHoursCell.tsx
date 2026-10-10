import { AlertTriangle, Check } from 'lucide-react'
import type { AttendanceBoardRow } from '@/api/attendance'
import { getWorkedHoursIndicator } from '@/features/attendance/derive'

type WorkedHoursCellProps = Pick<
  AttendanceBoardRow,
  | 'workedMinutes'
  | 'plannedMinutes'
  | 'minutesEarlyLeave'
  | 'checkInAt'
  | 'checkOutAt'
> &
  Partial<Pick<AttendanceBoardRow, 'displayStatus'>>

/**
 * Celda «Horas» (AJ-03): horas trabajadas con tilde verde si cumplió lo
 * previsto (sin margen) o ícono de advertencia con el motivo («Faltan X min»
 * o «Salida anticipada») como `title` y como texto accesible. Sin fin
 * registrado muestra «en curso» o un guion. Sin horas previstas («A terminar»)
 * muestra solo las trabajadas, sin tilde (AJ2-10).
 */
function WorkedHoursCell(props: WorkedHoursCellProps) {
  const indicator = getWorkedHoursIndicator(props)
  if (indicator.kind === 'none') {
    return <span>—</span>
  }
  if (indicator.kind === 'in_progress') {
    return <span className="text-text-3">en curso</span>
  }
  if (indicator.kind === 'plain') {
    // AJ2-10: «A terminar» no tiene horas previstas: solo lo trabajado.
    return <span className="tabular-nums">{indicator.text}</span>
  }
  if (indicator.kind === 'no_checkout') {
    return (
      <span
        className="inline-flex items-center gap-1.5 tabular-nums"
        title={indicator.reason}
      >
        {indicator.text}
        <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
        <span className="sr-only">{indicator.reason}</span>
      </span>
    )
  }
  if (indicator.kind === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {indicator.text}
        <Check aria-hidden="true" className="size-4 text-success" />
        <span className="sr-only">Cumplió las horas previstas</span>
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 tabular-nums"
      title={indicator.reason}
    >
      {indicator.text}
      <AlertTriangle aria-hidden="true" className="size-4 text-warning" />
      <span className="sr-only">{indicator.reason}</span>
    </span>
  )
}

export { WorkedHoursCell }
