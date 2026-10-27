import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockSummary } from '@/api/stock'
import { StockCards } from './StockCards'

const { summaryState } = vi.hoisted(() => ({
  summaryState: {
    data: undefined as StockSummary | undefined,
    isError: false,
  },
}))

vi.mock('@/features/stock/queries', () => ({
  useStockSummaryQuery: () => summaryState,
}))

function renderCards() {
  return render(
    <MemoryRouter>
      <StockCards />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  summaryState.data = undefined
  summaryState.isError = false
})

describe('StockCards: tarjetas de Insumos del Resumen (IS-30)', () => {
  it('«Faltantes avisados» muestra los avisos abiertos y lleva a la pestaña Faltantes', () => {
    summaryState.data = {
      openReports: 5,
      openShortages: 3,
      outOfStock: 0,
      belowMin: 0,
    }
    renderCards()
    const link = screen.getByRole('link', { name: /Faltantes avisados/ })
    expect(link).toHaveAttribute('href', '/admin/insumos?pestana=faltantes')
    expect(link).toHaveTextContent('3')
    expect(link).toHaveTextContent('5 avisos abiertos')
  })

  it('«Stock bajo» muestra «N sin stock · M bajo mínimo» y lleva a Stock con el filtro', () => {
    summaryState.data = {
      openReports: 0,
      openShortages: 0,
      outOfStock: 3,
      belowMin: 4,
    }
    renderCards()
    const link = screen.getByRole('link', { name: /Stock bajo/ })
    expect(link).toHaveAttribute('href', '/admin/insumos?filtro=aviso')
    expect(link).toHaveTextContent('3 sin stock · 4 bajo mínimo')
  })

  it('mientras carga muestra un guion en lugar del número', () => {
    renderCards()
    expect(
      screen.getByRole('link', { name: /Faltantes avisados/ }),
    ).toHaveTextContent('—')
    expect(screen.getByRole('link', { name: /Stock bajo/ })).toHaveTextContent(
      '—',
    )
  })

  it('si el contador falla no muestra las tarjetas ni rompe el Resumen', () => {
    summaryState.isError = true
    const { container } = renderCards()
    expect(container).toBeEmptyDOMElement()
  })
})
