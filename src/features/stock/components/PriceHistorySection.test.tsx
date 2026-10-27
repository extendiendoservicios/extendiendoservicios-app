import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupplyPriceChange } from '@/api/stock'
import { describePriceChange } from '@/features/stock/labels'
import { mockViewport } from '@/features/stock/testSupport'
import { PriceHistorySection } from './PriceHistorySection'

const { changesState } = vi.hoisted(() => ({
  changesState: { data: [] as SupplyPriceChange[] },
}))

vi.mock('@/features/stock/queries', () => ({
  useSupplyPriceChangesQuery: () => ({
    data: changesState.data,
    isLoading: false,
  }),
}))

function change(overrides: Partial<SupplyPriceChange> = {}): SupplyPriceChange {
  return {
    id: 'c1',
    supplyId: 's1',
    changedAt: '2026-10-20T15:05:00Z',
    changedByName: 'Ana Gómez',
    oldCostPrice: 800,
    newCostPrice: 950,
    oldSalePrice: 850,
    newSalePrice: 850,
    source: 'manual',
    ...overrides,
  }
}

beforeEach(() => {
  mockViewport(true)
  changesState.data = []
})

describe('describePriceChange: un valor del historial de precios (IS-22)', () => {
  it('si cambió, «de $ X a $ Y»', () => {
    expect(describePriceChange(800, 950)).toBe('de $ 800,00 a $ 950,00')
  })

  it('si no cambió, solo el valor y «sin cambio»', () => {
    expect(describePriceChange(850, 850)).toBe('$ 850,00 · sin cambio')
  })

  it('compara en centavos, sin errores de redondeo', () => {
    expect(describePriceChange(0.1 + 0.2, 0.3)).toBe('$ 0,30 · sin cambio')
  })

  it('en el alta (sin valor anterior), solo el valor inicial', () => {
    expect(describePriceChange(null, 1250.5)).toBe('$ 1.250,50')
  })
})

describe('PriceHistorySection: historial de precios de la ficha', () => {
  it('cuando solo cambió el costo, la venta muestra su valor «sin cambio»', () => {
    changesState.data = [change()]
    render(<PriceHistorySection supplyId="s1" />)
    const row = within(screen.getByText('mar 20 oct, 12:05').closest('tr')!)
    expect(row.getByText('de $ 800,00 a $ 950,00')).toBeInTheDocument()
    expect(row.getByText('$ 850,00 · sin cambio')).toBeInTheDocument()
    expect(row.queryByText(/de \$ 850,00 a \$ 850,00/)).toBeNull()
  })

  it('cuando cambiaron los dos, muestra los dos recorridos', () => {
    changesState.data = [
      change({ oldSalePrice: 850, newSalePrice: 900, changedByName: null }),
    ]
    render(<PriceHistorySection supplyId="s1" />)
    expect(screen.getByText('de $ 850,00 a $ 900,00')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
  })

  it('el alta del artículo muestra los valores iniciales', () => {
    changesState.data = [
      change({
        oldCostPrice: null,
        oldSalePrice: null,
        newCostPrice: 100,
        newSalePrice: 150,
        source: 'create',
      }),
    ]
    render(<PriceHistorySection supplyId="s1" />)
    expect(screen.getByText('$ 100,00')).toBeInTheDocument()
    expect(screen.getByText('$ 150,00')).toBeInTheDocument()
    expect(screen.getByText('Alta del artículo')).toBeInTheDocument()
  })

  it('sin cambios muestra un mensaje en español', () => {
    render(<PriceHistorySection supplyId="s1" />)
    expect(
      screen.getByText('Todavía no hay cambios de precio'),
    ).toBeInTheDocument()
  })
})
