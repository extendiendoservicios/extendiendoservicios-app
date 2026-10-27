import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockItem } from '@/api/stock'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { SupplyDetailScreen } from './SupplyDetailScreen'

const { authState, itemState, setActiveMock, toastMock } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  itemState: { data: undefined as StockItem | undefined },
  setActiveMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/stock/queries', () => ({
  useStockItemQuery: () => ({ data: itemState.data, isLoading: false }),
  useSupplyImageUrls: () => new Map<string, string>(),
  useSetSupplyActiveMutation: () => ({
    mutateAsync: setActiveMock,
    isPending: false,
  }),
  useSetSupplyPricesMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAdjustStockMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('./PriceHistorySection', () => ({
  PriceHistorySection: () => <section>Historial de precios</section>,
}))
vi.mock('./SupplyMovementsSection', () => ({
  SupplyMovementsSection: () => <section>Movimientos</section>,
}))

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/admin/insumos/s1']}>
      <Routes>
        <Route path="/admin/insumos/:id" element={<SupplyDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockViewport(true)
  authState.roles = ['owner']
  authState.capabilities = []
  itemState.data = testItem({ stockQty: 10 })
  setActiveMock.mockReset()
  setActiveMock.mockResolvedValue(undefined)
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('SupplyDetailScreen: ficha', () => {
  it('muestra datos, precios, stock y las secciones de historial y movimientos', () => {
    renderScreen()
    expect(
      screen.getByRole('heading', { name: 'Lavandina · 1 L' }),
    ).toBeInTheDocument()
    expect(screen.getByText('QUI-001')).toBeInTheDocument()
    expect(screen.getByText('$ 100,00')).toBeInTheDocument()
    expect(screen.getByText('$ 150,00')).toBeInTheDocument()
    expect(screen.getByText('Historial de precios')).toBeInTheDocument()
    expect(screen.getByText('Movimientos')).toBeInTheDocument()
  })

  it('el dueño ve Editar, Cambiar precios, Ajustar y Desactivar', () => {
    renderScreen()
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute(
      'href',
      '/admin/insumos/s1/editar',
    )
    expect(
      screen.getByRole('button', { name: 'Cambiar precios' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajustar' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Desactivar' }),
    ).toBeInTheDocument()
  })

  it('un administrador sin «Gestionar stock» ve la ficha pero ningún botón que cambie algo', () => {
    authState.roles = ['admin']
    renderScreen()
    expect(
      screen.getByRole('heading', { name: 'Lavandina · 1 L' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Editar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cambiar precios' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ajustar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Desactivar' })).toBeNull()
  })

  it('un artículo inactivo ofrece «Activar» y no «Ajustar»', async () => {
    itemState.data = testItem({ active: false, stockQty: 0, status: 'empty' })
    renderScreen()
    expect(screen.queryByRole('button', { name: 'Ajustar' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }))
    await waitFor(() =>
      expect(setActiveMock).toHaveBeenCalledWith({
        supplyId: 's1',
        active: true,
      }),
    )
  })

  it('artículo inexistente: mensaje en español', () => {
    itemState.data = undefined
    renderScreen()
    expect(screen.getByText('No encontramos este artículo')).toBeInTheDocument()
  })
})

describe('SupplyDetailScreen: desactivar (IS-26)', () => {
  it('con stock distinto de cero explica que primero hay que ajustarlo y no desactiva', () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(
      screen.getByText('Primero ajustá el stock a cero'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/tiene 10 en stock\. Para desactivarlo, primero ajustá/),
    ).toBeInTheDocument()
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.queryByRole('button', { name: 'Desactivar' })).toBeNull()
    expect(
      dialog.getByRole('button', { name: 'Ajustar stock' }),
    ).toBeInTheDocument()
    expect(setActiveMock).not.toHaveBeenCalled()
  })

  it('con stock en cero pide confirmación y desactiva', async () => {
    itemState.data = testItem({ stockQty: 0, status: 'empty', stockValue: 0 })
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    expect(screen.getByText('Desactivar el artículo')).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Desactivar',
      }),
    )
    await waitFor(() =>
      expect(setActiveMock).toHaveBeenCalledWith({
        supplyId: 's1',
        active: false,
      }),
    )
  })

  it('si el servidor responde STOCK_NOT_ZERO, muestra su mensaje tal cual', async () => {
    const { ApiError } = await import('@/api/errors')
    itemState.data = testItem({ stockQty: 0, status: 'empty', stockValue: 0 })
    setActiveMock.mockRejectedValue(
      new ApiError(
        'Para desactivar el artículo, primero ajustá el stock a cero.',
        'STOCK_NOT_ZERO',
      ),
    )
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar' }))
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Desactivar',
      }),
    )
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Para desactivar el artículo, primero ajustá el stock a cero.',
      ),
    )
  })
})
