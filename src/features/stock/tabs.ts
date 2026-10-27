import type { ComponentType } from 'react'
import { CategoriesTab } from '@/features/stock/components/CategoriesTab'
import { StockTab } from '@/features/stock/components/StockTab'

/**
 * Pestañas de la sección «Insumos» (IS-33), en el orden de la especificación:
 * Stock, Movimientos, Faltantes, Consumo por cliente, Controles y Categorías.
 *
 * Una pestaña sin `component` todavía no se muestra. P25.2 trae Stock y
 * Categorías; P25.3 completa `component` en las otras cuatro (y nada más:
 * `StockScreen` ya arma las pestañas, la URL `?pestana=` y el orden a partir
 * de esta lista).
 */
export interface StockTabDefinition {
  /** Valor de `?pestana=` en la URL. */
  value: string
  label: string
  component?: ComponentType
}

export const STOCK_TABS: StockTabDefinition[] = [
  { value: 'stock', label: 'Stock', component: StockTab },
  { value: 'movimientos', label: 'Movimientos' },
  { value: 'faltantes', label: 'Faltantes' },
  { value: 'consumo', label: 'Consumo por cliente' },
  { value: 'controles', label: 'Controles' },
  { value: 'categorias', label: 'Categorías', component: CategoriesTab },
]

/** Solo las que ya tienen pantalla. */
export function visibleStockTabs(
  tabs: readonly StockTabDefinition[] = STOCK_TABS,
): StockTabDefinition[] {
  return tabs.filter((tab) => tab.component != null)
}

/** `?pestana=` -> pestaña a mostrar; la primera si no existe o todavía no se muestra. */
export function resolveStockTab(
  value: string | null,
  tabs: readonly StockTabDefinition[] = STOCK_TABS,
): string {
  const visible = visibleStockTabs(tabs)
  return visible.find((tab) => tab.value === value)?.value ?? 'stock'
}
