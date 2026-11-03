import type { FixedApplyResult, FixedApplySkipped } from '@/api/services'
import { formatDateOnly } from '@/features/settings/dateOnly'

/**
 * Textos del resultado de «Aplicar a los turnos desde el [fecha]» (OD-11).
 * Sin React: se prueba aparte.
 */

/** «3 turnos» / «1 turno». */
export function countShifts(count: number): string {
  return `${count} ${count === 1 ? 'turno' : 'turnos'}`
}

/** Resumen de una línea: cuántos turnos se actualizaron y cuántos se saltearon. */
export function summarizeFixedApply(result: FixedApplyResult): string {
  const skippedShifts = result.skippedCount
  const partial = new Set(
    result.skipped
      .filter((item) => item.scope === 'employee')
      .map((item) => item.shiftId),
  ).size
  const parts = [
    result.updatedCount === 0
      ? 'No actualizamos ningún turno'
      : `Actualizamos ${countShifts(result.updatedCount)}`,
  ]
  if (skippedShifts > 0) {
    parts.push(
      `${skippedShifts === 1 ? 'se salteó' : 'se saltearon'} ${countShifts(skippedShifts)}`,
    )
  }
  if (partial > 0) {
    parts.push(
      `en ${countShifts(partial)} no se pudo asignar a algún empleado fijo`,
    )
  }
  return `${parts.join('; ')}.`
}

/**
 * Una línea por cada cosa que no se pudo tocar, con su motivo: el turno entero
 * («mar 3 nov: El turno ya empezó.») o un empleado en un turno («mar 3 nov ·
 * Ana Gómez: Tiene una licencia ese día.»). El `message` es el del servidor.
 */
export function describeSkipped(item: FixedApplySkipped): string {
  const date = formatDateOnly(item.shiftDate)
  if (item.scope === 'employee' && item.employeeName) {
    return `${date} · ${item.employeeName}: ${item.message}`
  }
  return `${date}: ${item.message}`
}
