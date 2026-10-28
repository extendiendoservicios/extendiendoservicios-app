import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { StockTab } from './StockTab'

const { authState } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
}))

vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/stock/queries', () => ({
  useStockItemsQuery: () => ({
    data: [testItem()],
    isLoading: false,
    dataUpdatedAt: 0,
  }),
  useSupplyCategoriesQuery: () => ({
    data: [{ id: 'c1', name: 'Químicos', sortOrder: 0, active: true }],
  }),
  useSupplyImageUrls: () => new Map<string, string>(),
  useAdjustStockMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <StockTab />
    </MemoryRouter>,
  )
}

const MANAGE_ONLY = [
  { role: 'link', name: 'Ingreso' },
  { role: 'link', name: 'Retiro en nombre de' },
  { role: 'button', name: 'Imprimir planilla' },
  { role: 'link', name: 'Cargar control' },
  { role: 'link', name: 'Nuevo artículo' },
] as const

beforeEach(() => {
  mockViewport(true)
  authState.roles = ['owner']
  authState.capabilities = []
})

describe('StockTab: botones de P25.3 y permisos (IS-17, IS-21)', () => {
  it('el dueño ve «Retiro en nombre de», «Imprimir planilla» y «Cargar control»', () => {
    renderTab()
    for (const { role, name } of MANAGE_ONLY) {
      expect(screen.getByRole(role, { name })).toBeInTheDocument()
    }
    expect(
      screen.getByRole('link', { name: 'Retiro en nombre de' }),
    ).toHaveAttribute('href', '/admin/insumos/retiro')
    expect(
      screen.getByRole('link', { name: 'Cargar control' }),
    ).toHaveAttribute('href', '/admin/insumos/control')
  })

  it('un administrador con «Gestionar stock» los ve también', () => {
    authState.roles = ['admin']
    authState.capabilities = ['manage_stock']
    renderTab()
    for (const { role, name } of MANAGE_ONLY) {
      expect(screen.getByRole(role, { name })).toBeInTheDocument()
    }
  })

  it('un administrador sin «Gestionar stock» ve el stock pero ninguno de esos botones', () => {
    authState.roles = ['admin']
    authState.capabilities = []
    renderTab()
    expect(screen.getByText('Lavandina')).toBeInTheDocument()
    for (const { role, name } of MANAGE_ONLY) {
      expect(screen.queryByRole(role, { name })).toBeNull()
    }
    expect(screen.queryByRole('button', { name: /^Ajustar/ })).toBeNull()
  })
})
