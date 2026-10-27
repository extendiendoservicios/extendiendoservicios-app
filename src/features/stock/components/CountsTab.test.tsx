import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockCountRecord } from '@/api/stock'
import { CountsTab } from './CountsTab'

const { authState, countsState } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  countsState: { data: [] as StockCountRecord[] },
}))

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/stock/queries', () => ({
  useStockCountsQuery: () => ({
    data: countsState.data,
    isLoading: false,
    dataUpdatedAt: 0,
  }),
}))

function count(overrides: Partial<StockCountRecord> = {}): StockCountRecord {
  return {
    countId: 'k1',
    countedAt: '2026-10-24T13:00:00Z',
    reviewerId: 'u1',
    reviewerName: 'Marta Ruiz',
    notes: 'Depósito del fondo',
    createdAt: '2026-10-24T18:00:00Z',
    createdByName: 'Ana Gómez',
    movementId: 'm1',
    linesCount: 3,
    differencesCount: 2,
    lines: [
      {
        supplyId: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        systemQty: 10,
        countedQty: 8,
        difference: -2,
      },
      {
        supplyId: 's2',
        code: 'DES-001',
        name: 'Bolsas',
        presentation: null,
        systemQty: 4,
        countedQty: 6,
        difference: 2,
      },
      {
        supplyId: 's3',
        code: 'UTE-001',
        name: 'Balde',
        presentation: null,
        systemQty: 5,
        countedQty: 5,
        difference: 0,
      },
    ],
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <CountsTab />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  authState.roles = ['owner']
  authState.capabilities = []
  countsState.data = []
})

describe('CountsTab: historial de controles (IS-16, IS-31)', () => {
  it('muestra fecha y hora, revisor, quién lo cargó, observaciones y las diferencias', () => {
    countsState.data = [count()]
    renderTab()
    const card = within(screen.getByTestId('count-card'))
    expect(card.getByText('Control del sáb 24 oct, 10:00')).toBeInTheDocument()
    expect(
      card.getByText(
        /Revisó Marta Ruiz · Lo cargó Ana Gómez el sáb 24 oct, 15:00/,
      ),
    ).toBeInTheDocument()
    expect(card.getByText('Depósito del fondo')).toBeInTheDocument()
    expect(card.getByText('2 diferencias')).toBeInTheDocument()
    expect(card.getByText('3 artículos contados:')).toBeInTheDocument()
    // Solo las filas con diferencia, con signo.
    expect(card.getByText('Lavandina · 1 L')).toBeInTheDocument()
    expect(card.getByText('−2')).toBeInTheDocument()
    expect(card.getByText('+2')).toBeInTheDocument()
    expect(card.queryByText('Balde')).toBeNull()
  })

  it('un control sin diferencias lo dice', () => {
    countsState.data = [
      count({ differencesCount: 0, movementId: null, lines: [] }),
    ]
    renderTab()
    expect(screen.getByText('Sin diferencias')).toBeInTheDocument()
  })

  it('con «Gestionar stock» ofrece «Cargar control»; sin la capacidad, no', () => {
    const { unmount } = renderTab()
    expect(
      screen.getByRole('link', { name: 'Cargar control' }),
    ).toHaveAttribute('href', '/admin/insumos/control')
    unmount()

    authState.roles = ['admin']
    authState.capabilities = []
    countsState.data = [count()]
    renderTab()
    expect(screen.queryByRole('link', { name: 'Cargar control' })).toBeNull()
    // Igual ve el historial.
    expect(screen.getByTestId('count-card')).toBeInTheDocument()
  })

  it('sin controles muestra un mensaje en español', () => {
    renderTab()
    expect(
      screen.getByText('Todavía no se cargó ningún control'),
    ).toBeInTheDocument()
  })
})
