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

  it('en P25.2 solo se muestran Stock y Categorías', () => {
    expect(visibleStockTabs().map((tab) => tab.label)).toEqual([
      'Stock',
      'Categorías',
    ])
  })

  it('una pestaña que todavía no tiene pantalla no se puede abrir por la URL', () => {
    expect(resolveStockTab('movimientos')).toBe('stock')
    expect(resolveStockTab('cualquiera')).toBe('stock')
    expect(resolveStockTab(null)).toBe('stock')
  })

  it('la pestaña de Categorías se abre con ?pestana=categorias', () => {
    expect(resolveStockTab('categorias')).toBe('categorias')
  })

  it('al completar el component de una pestaña, se muestra en su lugar', () => {
    const Dummy = () => null
    const tabs: StockTabDefinition[] = STOCK_TABS.map((tab) =>
      tab.value === 'movimientos' ? { ...tab, component: Dummy } : tab,
    )
    expect(visibleStockTabs(tabs).map((tab) => tab.value)).toEqual([
      'stock',
      'movimientos',
      'categorias',
    ])
    expect(resolveStockTab('movimientos', tabs)).toBe('movimientos')
  })
})
