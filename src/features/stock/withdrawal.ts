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
