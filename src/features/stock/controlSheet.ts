import type { StockItem } from '@/api/stock'
import { DEFAULT_STOCK_FILTERS, filterStockItems } from './filters'

/**
 * Artículos de la planilla imprimible de control (IS-15): solo los activos,
 * con el mismo orden que la tabla de Stock (categoría, nombre y
 * presentación), y opcionalmente de una sola categoría.
 */
export function controlSheetItems(
  items: readonly StockItem[],
  categoryId: string,
): StockItem[] {
  return filterStockItems(items, {
    ...DEFAULT_STOCK_FILTERS,
    categoryId,
    includeInactive: false,
  })
}
