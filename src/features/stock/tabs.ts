import type { ComponentType } from 'react'
import { CategoriesTab } from '@/features/stock/components/CategoriesTab'
import { ConsumptionTab } from '@/features/stock/components/ConsumptionTab'
import { CountsTab } from '@/features/stock/components/CountsTab'
import { MovementsTab } from '@/features/stock/components/MovementsTab'
import { ShortagesTab } from '@/features/stock/components/ShortagesTab'
import { StockTab } from '@/features/stock/components/StockTab'

/**
 * Pestañas de la sección «Insumos» (IS-33), en el orden de la especificación:
 * Stock, Movimientos, Faltantes, Consumo por cliente, Controles y Categorías.
 *
 * Una pestaña sin `component` no se muestra. P25.2 trajo Stock y
 * Categorías; P25.3 completa Movimientos, Faltantes, Consumo por cliente y
 * Controles. `StockScreen` arma las pestañas, la URL `?pestana=` y el orden a
 * partir de esta lista.
 */
export interface StockTabDefinition {
  /** Valor de `?pestana=` en la URL. */
  value: string
  label: string
  component?: ComponentType
}

export const STOCK_TABS: StockTabDefinition[] = [
  { value: 'stock', label: 'Stock', component: StockTab },
  { value: 'movimientos', label: 'Movimientos', component: MovementsTab },
  { value: 'faltantes', label: 'Faltantes', component: ShortagesTab },
  {
    value: 'consumo',
    label: 'Consumo por cliente',
    component: ConsumptionTab,
  },
  { value: 'controles', label: 'Controles', component: CountsTab },
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
