import { describe, expect, it } from 'vitest'
import {
  resolveStockTab,
  STOCK_TABS,
  visibleStockTabs,
  type StockTabDefinition,
} from './tabs'

describe('pestañas de Insumos (IS-33)', () => {
  it('la lista completa está en el orden de la especificación', () => {
    expect(STOCK_TABS.map((tab) => tab.value)).toEqual([
      'stock',
      'movimientos',
      'faltantes',
      'consumo',
      'controles',
      'categorias',
    ])
  })

  it('con P25.3 se muestran las seis pestañas, en ese orden', () => {
    expect(visibleStockTabs().map((tab) => tab.label)).toEqual([
      'Stock',
      'Movimientos',
      'Faltantes',
      'Consumo por cliente',
      'Controles',
      'Categorías',
    ])
  })

  it('cada pestaña se abre con su ?pestana= y una desconocida vuelve a Stock', () => {
    expect(resolveStockTab('movimientos')).toBe('movimientos')
    expect(resolveStockTab('faltantes')).toBe('faltantes')
    expect(resolveStockTab('consumo')).toBe('consumo')
    expect(resolveStockTab('controles')).toBe('controles')
    expect(resolveStockTab('categorias')).toBe('categorias')
    expect(resolveStockTab('cualquiera')).toBe('stock')
    expect(resolveStockTab(null)).toBe('stock')
  })

  it('una pestaña sin component no se muestra ni se abre por la URL', () => {
    const tabs: StockTabDefinition[] = STOCK_TABS.map((tab) =>
      tab.value === 'controles' ? { ...tab, component: undefined } : tab,
    )
    expect(visibleStockTabs(tabs).map((tab) => tab.value)).not.toContain(
      'controles',
    )
    expect(resolveStockTab('controles', tabs)).toBe('stock')
  })
})
