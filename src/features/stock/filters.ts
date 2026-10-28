import type { StockItem, StockStatus, SupplyCategory } from '@/api/stock'
import type { TableRowVariant } from '@/components/status'

/**
 * Lógica pura de la tabla de Stock (IS-05, IS-24, IS-25): filtros, orden por
 * defecto, colores de fila y total del valor. Sin React ni Supabase.
 */

export interface StockFilters {
  /** Código o nombre (sin distinguir mayúsculas ni tildes). */
  text: string
  /** `all` o el id de una categoría. */
  categoryId: string
  /** Solo los que están en amarillo o en rojo. */
  onlyAlerts: boolean
  includeInactive: boolean
}

export const DEFAULT_STOCK_FILTERS: StockFilters = {
  text: '',
  categoryId: 'all',
  onlyAlerts: false,
  includeInactive: false,
}

/** Minúsculas y sin tildes, para comparar texto escrito a mano. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Estado que se pinta. Un artículo desactivado no marca aviso: solo se
 * desactiva con stock cero y su «cero» no es un faltante (el Resumen tampoco
 * lo cuenta).
 */
export function effectiveStatus(item: StockItem): StockStatus {
  return item.active ? item.status : 'ok'
}

/** Color de fila: amarillo con mínimo y stock igual o menor; rojo con stock cero (IS-05, IS-25). */
export function stockRowVariant(item: StockItem): TableRowVariant | undefined {
  const status = effectiveStatus(item)
  if (status === 'empty') return 'crit'
  if (status === 'low') return 'warn'
  return undefined
}

/** Etiqueta de texto de la fila, para no depender solo del color. */
export function stockAlertLabel(item: StockItem): string | null {
  const status = effectiveStatus(item)
  if (status === 'empty') return 'Sin stock'
  if (status === 'low') return 'Bajo mínimo'
  return null
}

/** Orden por defecto (IS-25): categoría (en su orden), nombre y presentación. */
export function sortStockItems(items: readonly StockItem[]): StockItem[] {
  return [...items].sort(
    (a, b) =>
      a.categorySortOrder - b.categorySortOrder ||
      a.categoryName.localeCompare(b.categoryName, 'es') ||
      a.name.localeCompare(b.name, 'es') ||
      (a.presentation ?? '').localeCompare(b.presentation ?? '', 'es', {
        numeric: true,
      }) ||
      a.code.localeCompare(b.code, 'es'),
  )
}

export function filterStockItems(
  items: readonly StockItem[],
  filters: StockFilters,
): StockItem[] {
  const text = normalizeText(filters.text)
  return sortStockItems(
    items.filter((item) => {
      if (!filters.includeInactive && !item.active) return false
      if (
        filters.categoryId !== 'all' &&
        item.categoryId !== filters.categoryId
      )
        return false
      if (filters.onlyAlerts && effectiveStatus(item) === 'ok') return false
      if (text === '') return true
      return (
        normalizeText(item.code).includes(text) ||
        normalizeText(item.name).includes(text) ||
        normalizeText(item.presentation ?? '').includes(text)
      )
    }),
  )
}

/** Valor del stock a costo (IS-24), sumado en centavos para no arrastrar decimales binarios. */
export function totalStockValue(items: readonly StockItem[]): number {
  const cents = items.reduce(
    (sum, item) => sum + Math.round(item.stockValue * 100),
    0,
  )
  return cents / 100
}

/** «Lavandina · 1 L»: nombre y presentación juntos, como se lee en una fila. */
export function supplyLabel(item: {
  name: string
  presentation: string | null
}): string {
  return item.presentation ? `${item.name} · ${item.presentation}` : item.name
}

// -------------------------------------------------------------------------
// Categorías: orden
// -------------------------------------------------------------------------

export interface CategoryOrderChange {
  id: string
  name: string
  active: boolean
  sortOrder: number
}

/**
 * Mueve una categoría una posición arriba o abajo. Devuelve solo las que
 * cambian de `sort_order` (hay que guardarlas una por una): las posiciones se
 * renumeran 0, 1, 2… para que el orden sea siempre explícito, aunque todas
 * vinieran con el mismo número.
 */
export function moveCategory(
  categories: readonly SupplyCategory[],
  id: string,
  direction: 'up' | 'down',
): CategoryOrderChange[] {
  const ordered = [...categories]
  const from = ordered.findIndex((category) => category.id === id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= ordered.length) return []
  const [moved] = ordered.splice(from, 1)
  if (!moved) return []
  ordered.splice(to, 0, moved)
  return ordered.flatMap((category, index) =>
    category.sortOrder === index
      ? []
      : [
          {
            id: category.id,
            name: category.name,
            active: category.active,
            sortOrder: index,
          },
        ],
  )
}
