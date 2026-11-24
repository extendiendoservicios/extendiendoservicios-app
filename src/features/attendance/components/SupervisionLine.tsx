import { cn } from 'cn'
import type { AttendanceBoardRow } from '@/api/attendance'
import { getSupervisionLine } from '../supervisionLine'

/**
 * D-10: línea chica debajo del estado con la supervisión del turno. «Sin
 * supervisión» en gris; «Supervisando» y «Supervisado» con un tono suave.
 * El nombre del coordinador va en el `title` y en el texto accesible.
 */
function SupervisionLine({ row }: { row: AttendanceBoardRow }) {
  const line = getSupervisionLine(row)
  if (!line) {
    return null
  }
  return (
    <span
      title={line.supervisorName ?? undefined}
      className={cn(
        'block w-full text-[11.5px] leading-tight',
        line.state === 'none' && 'text-text-3',
        line.state === 'in_progress' && 'text-primary-800',
        line.state === 'done' && 'text-success-800',
      )}
    >
      {line.label}
      {line.supervisorName && (
        <span className="sr-only"> por {line.supervisorName}</span>
      )}
    </span>
  )
}

export { SupervisionLine }
