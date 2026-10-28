import type {
  SupplyCatalogItem,
  WithdrawalShiftOption,
  WithdrawalSiteOption,
} from '@/api/myStock'
import { MAX_WITHDRAWAL_QTY } from './schemas'

/**
 * Lógica pura de las pantallas de Insumos del celular (P25.4): filtros del
 * catálogo, armado del retiro y de las listas de turnos y sedes.
 */

/** Minúsculas y sin tildes, para que «lavandina» encuentre «Lavandína». */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Valor del filtro de categoría para «Todas». */
export const ALL_CATEGORIES = 'all'

/** Artículos que coinciden con el texto (código, nombre o presentación) y la categoría. */
export function filterCatalog(
  items: readonly SupplyCatalogItem[],
  search: string,
  categoryId: string = ALL_CATEGORIES,
): SupplyCatalogItem[] {
  const needle = normalizeText(search)
  return items.filter((item) => {
    if (categoryId !== ALL_CATEGORIES && item.categoryId !== categoryId) {
      return false
    }
    if (needle === '') return true
    return normalizeText(
      `${item.code} ${item.name} ${item.presentation ?? ''}`,
    ).includes(needle)
  })
}

export interface CategoryOption {
  id: string
  name: string
}

/** Categorías presentes en el catálogo, en el orden de la administración. */
export function catalogCategories(
  items: readonly SupplyCatalogItem[],
): CategoryOption[] {
  const seen = new Map<string, { name: string; order: number }>()
  for (const item of items) {
    if (item.categoryId && !seen.has(item.categoryId)) {
      seen.set(item.categoryId, {
        name: item.categoryName ?? 'Sin nombre',
        order: item.categorySortOrder,
      })
    }
  }
  return Array.from(seen.entries())
    .sort(
      ([, a], [, b]) => a.order - b.order || a.name.localeCompare(b.name, 'es'),
    )
    .map(([id, value]) => ({ id, name: value.name }))
}

/** Nombre del artículo con su presentación: «Lavandina · 5 L». */
export function supplyLabel(item: {
  name: string
  presentation: string | null
}): string {
  return item.presentation ? `${item.name} · ${item.presentation}` : item.name
}

// -------------------------------------------------------------------------
// Armado del retiro
// -------------------------------------------------------------------------

/** Cantidades elegidas, por id de artículo. El orden de inserción es el de la lista. */
export type Cart = ReadonlyMap<string, number>

export function cartAdd(cart: Cart, supplyId: string): Cart {
  if (cart.has(supplyId)) return cart
  return new Map(cart).set(supplyId, 1)
}

/** Fija la cantidad (entera, de 1 al tope); para quitar un artículo está `cartRemove`. */
export function cartSetQty(cart: Cart, supplyId: string, qty: number): Cart {
  if (!cart.has(supplyId)) return cart
  const safe = Math.min(MAX_WITHDRAWAL_QTY, Math.max(1, Math.trunc(qty)))
  return new Map(cart).set(supplyId, safe)
}

export function cartRemove(cart: Cart, supplyId: string): Cart {
  if (!cart.has(supplyId)) return cart
  const next = new Map(cart)
  next.delete(supplyId)
  return next
}

/** Total de unidades del retiro. */
export function cartTotal(cart: Cart): number {
  let total = 0
  for (const qty of cart.values()) total += qty
  return total
}

export function cartLines(cart: Cart): { supplyId: string; qty: number }[] {
  return Array.from(cart.entries()).map(([supplyId, qty]) => ({
    supplyId,
    qty,
  }))
}

/** Un artículo sin stock no se puede elegir para un retiro (IS-28). */
export function isSelectableForWithdrawal(item: SupplyCatalogItem): boolean {
  return !item.outOfStock
}

// -------------------------------------------------------------------------
// Turnos y sedes
// -------------------------------------------------------------------------

/** Turnos que coinciden con el texto, por cliente o sede. */
export function filterShiftOptions(
  options: readonly WithdrawalShiftOption[],
  search: string,
): WithdrawalShiftOption[] {
  const needle = normalizeText(search)
  if (needle === '') return [...options]
  return options.filter((option) =>
    normalizeText(`${option.clientName} ${option.siteName}`).includes(needle),
  )
}

export function filterSiteOptions(
  options: readonly WithdrawalSiteOption[],
  search: string,
): WithdrawalSiteOption[] {
  const needle = normalizeText(search)
  if (needle === '') return [...options]
  return options.filter((option) =>
    normalizeText(`${option.clientName} ${option.siteName}`).includes(needle),
  )
}

/**
 * «Mis sedes» primero y después el resto (IS-28, CJ-25). Conserva el orden
 * recibido (fecha y hora) dentro de cada bloque.
 */
export function splitByPriority<T extends { isPriority: boolean }>(
  options: readonly T[],
): { mine: T[]; others: T[] } {
  return {
    mine: options.filter((option) => option.isPriority),
    others: options.filter((option) => !option.isPriority),
  }
}

/** A partir de cuántas opciones se ofrece el buscador por cliente o sede. */
export const SEARCH_THRESHOLD = 6

/** Ruta base de la vía según la URL: `/sup` (coordinador) o `/app` (empleado). */
export function stockBasePath(pathname: string): '/app' | '/sup' {
  return pathname === '/sup' || pathname.startsWith('/sup/') ? '/sup' : '/app'
}
