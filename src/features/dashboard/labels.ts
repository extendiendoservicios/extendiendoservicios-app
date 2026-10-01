import type { ShiftListRow } from '@/api/shifts'

/** Franja de un turno como `"08:00–12:00"`. */
export function shiftFranjaLabel(
  shift: Pick<ShiftListRow, 'startTime' | 'endTime'>,
): string {
  return `${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`
}
