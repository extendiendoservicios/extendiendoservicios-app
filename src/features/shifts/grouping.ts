import type { ShiftListRow } from '@/api/shifts'

/**
 * Agrupado por franja de ADM-05 (ASSIGN-010, `05` línea 39: "agrupados por
 * franja"), sin React. Vive en `features/shifts` (no en `features/planning`)
 * porque la lista del día ya vivía acá desde F10 (`ShiftsDayList`) -- ver la
 * fila de la tabla de ambigüedades de `11_Desglose_de_Tareas.md`, que solo
 * asigna el Calendar mensual y el WeekGrid a `features/planning`.
 * `features/planning/grouping.ts` reusa `shiftFranjaKey` para el chip del
 * calendario mensual (cliente · sede · franja).
 */

/** Franja (`"08:00–16:00"`) de un turno, sin segundos. */
export function shiftFranjaKey(
  shift: Pick<ShiftListRow, 'startTime' | 'endTime'>,
): string {
  return `${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`
}

/** Turnos de un día, agrupados por franja y ordenados por hora de inicio. */
export function groupShiftsByFranja(
  shifts: ShiftListRow[],
): { franja: string; shifts: ShiftListRow[] }[] {
  const sorted = [...shifts].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  )
  const groups: { franja: string; shifts: ShiftListRow[] }[] = []
  for (const shift of sorted) {
    const franja = shiftFranjaKey(shift)
    const last = groups[groups.length - 1]
    if (last && last.franja === franja) {
      last.shifts.push(shift)
    } else {
      groups.push({ franja, shifts: [shift] })
    }
  }
  return groups
}
