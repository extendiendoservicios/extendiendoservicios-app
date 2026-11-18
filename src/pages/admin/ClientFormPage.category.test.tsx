import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientDetail } from '@/api/clients'
import type { ClientCategory } from '@/api/clientCategories'

/**
 * OH-13: en la edición del cliente la casilla «Categoría» tiene que mostrar la
 * categoría guardada, llegue primero el cliente o primero las categorías.
 */

const { fetchDetailMock, fetchCategoriesMock, fetchBankMock } = vi.hoisted(
  () => ({
    fetchDetailMock: vi.fn(),
    fetchCategoriesMock: vi.fn(),
    fetchBankMock: vi.fn(),
  }),
)

vi.mock('@/api/clients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/clients')>()),
  fetchClientDetail: fetchDetailMock,
  findClientsByCuit: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/api/clientCategories', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/clientCategories')>()),
  fetchClientCategories: fetchCategoriesMock,
}))

vi.mock('@/api/bankDetails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bankDetails')>()),
  fetchClientBankDetails: fetchBankMock,
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ userId: 'admin-1', roles: ['owner'], capabilities: [] }),
}))

vi.mock('@/components/map', () => ({
  MapPicker: () => <div />,
}))

const { default: ClientFormPage } = await import('./ClientFormPage')

const CLIENT: ClientDetail = {
  id: 'cli-1',
  legalName: 'Limpiolux SA',
  tradeName: null,
  cuit: null,
  adminAddress: null,
  latitude: null,
  longitude: null,
  status: 'active',
  notes: null,
  photoPath: null,
  calendarColor: 0,
  categoryId: 'cat-2',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
}

const CATEGORIES: ClientCategory[] = [
  { id: 'cat-1', name: 'Oficinas', sortOrder: 1 },
  { id: 'cat-2', name: 'Consorcios', sortOrder: 2 },
]

function delayed<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/clientes/cli-1/editar']}>
        <Routes>
          <Route
            path="/admin/clientes/:id/editar"
            element={<ClientFormPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Vuelve a buscar la casilla en cada intento: el formulario se arma cuando llegan los datos. */
async function expectCategory(text: string) {
  await vi.waitFor(
    () =>
      expect(
        screen.getByRole('combobox', { name: /Categoría/ }),
      ).toHaveTextContent(text),
    { timeout: 2000 },
  )
}

beforeEach(() => {
  fetchDetailMock.mockReset()
  fetchCategoriesMock.mockReset()
  fetchBankMock.mockReset().mockResolvedValue(null)
})

describe('ClientFormPage, categoría en la edición (OH-13)', () => {
  it('muestra la categoría guardada cuando las categorías llegan después del cliente', async () => {
    fetchDetailMock.mockResolvedValue(CLIENT)
    fetchCategoriesMock.mockImplementation(() => delayed(CATEGORIES, 150))
    renderPage()

    await expectCategory('Consorcios')
  })

  it('muestra la categoría guardada cuando las categorías llegan antes que el cliente', async () => {
    fetchDetailMock.mockImplementation(() => delayed(CLIENT, 150))
    fetchCategoriesMock.mockResolvedValue(CATEGORIES)
    renderPage()

    await expectCategory('Consorcios')
  })

  it('un cliente sin categoría muestra «Sin categoría»', async () => {
    fetchDetailMock.mockResolvedValue({ ...CLIENT, categoryId: null })
    fetchCategoriesMock.mockResolvedValue(CATEGORIES)
    renderPage()

    await expectCategory('Sin categoría')
  })
})
