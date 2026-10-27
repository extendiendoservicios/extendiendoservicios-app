import { describe, expect, it } from 'vitest'
import { lowStockCard, shortagesCard } from './stockCards'

const SUMMARY = {
  openReports: 0,
  openShortages: 0,
  outOfStock: 0,
  belowMin: 0,
}

describe('tarjeta «Faltantes avisados» (IS-30)', () => {
  it('cuenta por artículo y dice cuántos avisos hay', () => {
    const card = shortagesCard({ ...SUMMARY, openReports: 5, openShortages: 3 })
    expect(card).toEqual({
      label: 'Faltantes avisados',
      value: 3,
      variant: 'warn',
      detail: '5 avisos abiertos',
      to: '/admin/insumos?pestana=faltantes',
    })
  })

  it('con un solo aviso habla en singular', () => {
    expect(
      shortagesCard({ ...SUMMARY, openReports: 1, openShortages: 1 }).detail,
    ).toBe('1 aviso abierto')
  })

  it('en cero es una tarjeta neutra: un cero no es una alarma', () => {
    const card = shortagesCard(SUMMARY)
    expect(card.value).toBe(0)
    expect(card.variant).toBe('default')
    expect(card.detail).toBe('sin avisos abiertos')
  })
})

describe('tarjeta «Stock bajo» (IS-30)', () => {
  it('dice «N sin stock · M bajo mínimo» y lleva a Stock con «Solo con aviso»', () => {
    const card = lowStockCard({ ...SUMMARY, outOfStock: 2, belowMin: 4 })
    expect(card).toEqual({
      label: 'Stock bajo',
      value: 6,
      variant: 'crit',
      detail: '2 sin stock · 4 bajo mínimo',
      to: '/admin/insumos?filtro=aviso',
    })
  })

  it('en rojo si hay artículos sin stock; en amarillo si solo hay bajo mínimo', () => {
    expect(lowStockCard({ ...SUMMARY, outOfStock: 1 }).variant).toBe('crit')
    expect(lowStockCard({ ...SUMMARY, belowMin: 3 }).variant).toBe('warn')
  })

  it('sin alertas, neutra y en ceros', () => {
    const card = lowStockCard(SUMMARY)
    expect(card.variant).toBe('default')
    expect(card.value).toBe(0)
    expect(card.detail).toBe('0 sin stock · 0 bajo mínimo')
  })
})
