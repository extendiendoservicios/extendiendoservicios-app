import type { StockSummary } from '@/api/stock'

/**
 * Tarjetas de Insumos del Resumen (IS-30): «Faltantes avisados» y «Stock
 * bajo». Lógica pura, sin React, para poder probar los textos y los colores.
 */

export type StockCardVariant = 'default' | 'warn' | 'crit'

export interface StockCardData {
  label: string
  value: number
  variant: StockCardVariant
  detail: string
  /** Ruta de Insumos con el filtro puesto. */
  to: string
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * «Faltantes avisados»: el valor cuenta por artículo (un artículo con varios
 * avisos cuenta uno, IS-29); el detalle dice cuántos avisos hay. Lleva a la
 * pestaña Faltantes. En cero es una tarjeta neutra: un cero no es una alarma.
 */
export function shortagesCard(summary: StockSummary): StockCardData {
  return {
    label: 'Faltantes avisados',
    value: summary.openShortages,
    variant: summary.openShortages > 0 ? 'warn' : 'default',
    detail:
      summary.openReports === 0
        ? 'sin avisos abiertos'
        : `${plural(summary.openReports, 'aviso abierto', 'avisos abiertos')}`,
    to: '/admin/insumos?pestana=faltantes',
  }
}

/**
 * «Stock bajo»: «N sin stock · M bajo mínimo». El valor suma los dos. Rojo si
 * hay artículos sin stock, amarillo si solo hay bajo mínimo. Lleva a Stock
 * con «Solo con aviso».
 */
export function lowStockCard(summary: StockSummary): StockCardData {
  return {
    label: 'Stock bajo',
    value: summary.outOfStock + summary.belowMin,
    variant:
      summary.outOfStock > 0
        ? 'crit'
        : summary.belowMin > 0
          ? 'warn'
          : 'default',
    detail: `${summary.outOfStock} sin stock · ${summary.belowMin} bajo mínimo`,
    to: '/admin/insumos?filtro=aviso',
  }
}
