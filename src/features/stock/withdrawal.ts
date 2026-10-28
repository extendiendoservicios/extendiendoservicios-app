import type { StockItem } from '@/api/stock'
import { parseWholeNumber } from './money'

/**
 * Chequeo previo del retiro en nombre de otra persona (IS-13): las líneas
 * cuya cantidad supera el stock que hay. Es un aviso para ahorrar el viaje;
 * el servidor igual corta con `INSUFFICIENT_STOCK` y bloquea las filas para
 * que dos retiros simultáneos no dejen stock negativo.
 */
export function findInsufficientLines(
  lines: ReadonlyArray<{ supplyId: string; qty: string }>,
  itemsById: ReadonlyMap<string, Pick<StockItem, 'stockQty'>>,
): Array<{ index: number; supplyId: string; available: number }> {
  const problems: Array<{
    index: number
    supplyId: string
    available: number
  }> = []
  lines.forEach((line, index) => {
    const qty = parseWholeNumber(line.qty)
    const item = itemsById.get(line.supplyId)
    if (qty !== null && item && qty > item.stockQty) {
      problems.push({
        index,
        supplyId: line.supplyId,
        available: item.stockQty,
      })
    }
  })
  return problems
}

/** Lo que hace falta de un turno para ordenarlo y rotularlo en el selector. */
export interface ShiftChoice {
  shiftId: string
  shiftDate: string
  startTime: string
  shiftStatus: string
  assignedEmployeeIds: readonly string[]
  supervisorIds: readonly string[]
}

/** ¿La persona trabaja en el turno? Empleado: asignado; coordinador: coordina el turno. */
export function isPersonOnShift(
  shift: Pick<ShiftChoice, 'assignedEmployeeIds' | 'supervisorIds'>,
  personId: string,
  isSupervisor: boolean,
): boolean {
  if (personId === '') return false
  const ids = isSupervisor ? shift.supervisorIds : shift.assignedEmployeeIds
  return ids.includes(personId)
}

/**
 * Turnos para el selector del retiro en nombre de otra persona (IS-35): sin
 * ocultar ninguno, primero los de la persona elegida (marcados) y después el
 * resto. En cada grupo se respeta el orden de entrada (más recientes primero).
 * Sin persona elegida, queda el orden original y nada marcado.
 */
export function orderShiftsForPerson<T extends ShiftChoice>(
  shifts: readonly T[],
  personId: string,
  isSupervisor: boolean,
): Array<{ shift: T; ofPerson: boolean }> {
  const marked = shifts.map((shift) => ({
    shift,
    ofPerson: isPersonOnShift(shift, personId, isSupervisor),
  }))
  return [
    ...marked.filter((entry) => entry.ofPerson),
    ...marked.filter((entry) => !entry.ofPerson),
  ]
}
