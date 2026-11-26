import type { AttendanceBoardRow } from '@/api/attendance'
import { Badge } from '@/components/ui/badge'
import { getSupervisionLine, type SupervisionLine } from '../supervisionLine'

/**
 * Variante de píldora por estado (P35 D-02), los mismos tonos de `StatusBadge`:
 * «Supervisado» verde como «Finalizado», «Sin supervisar» rojo como «Sin
 * registro» y «Supervisando» azul como «En curso».
 */
const VARIANT: Record<
  SupervisionLine['state'],
  'success' | 'danger' | 'primary'
> = {
  done: 'success',
  none: 'danger',
  in_progress: 'primary',
}

/**
 * P35 (D-01 a D-03): píldora de la columna «Supervisión» de Asistencia y del
 * Resumen. Se muestra con la regla de `getSupervisionLine`; si no aplica, «—».
 * El nombre del coordinador va en el `title` y en el texto accesible.
 */
function SupervisionBadge({ row }: { row: AttendanceBoardRow }) {
  const line = getSupervisionLine(row)
  if (!line) {
    return <span>—</span>
  }
  return <SupervisionPill line={line} />
}

/** Píldora de una línea ya calculada (la usa también la pestaña «Sin supervisar»). */
function SupervisionPill({ line }: { line: SupervisionLine }) {
  return (
    <Badge
      variant={VARIANT[line.state]}
      dot
      title={line.supervisorName ?? undefined}
    >
      {line.label}
      {line.supervisorName && (
        <span className="sr-only"> por {line.supervisorName}</span>
      )}
    </Badge>
  )
}

/** Clave de orden de la columna: sin píldora al final. */
function supervisionSortKey(row: AttendanceBoardRow): string | undefined {
  return getSupervisionLine(row)?.label
}

export { SupervisionBadge, SupervisionPill, supervisionSortKey }
