import type { ShiftListRow } from '@/api/shifts'
import { formatShiftRange } from '@/features/shifts/openEnded'

/** Franja de un turno como `"08:00–12:00"`. */
export function shiftFranjaLabel(
  shift: Pick<ShiftListRow, 'startTime' | 'endTime' | 'openEnded'>,
): string {
  return formatShiftRange(shift.startTime, shift.endTime, shift.openEnded)
}
