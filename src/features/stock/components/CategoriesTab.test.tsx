import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupplyCategory } from '@/api/stock'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { CategoriesTab } from './CategoriesTab'

const { authState, upsertMock, reorderMock, toastMock } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  upsertMock: vi.fn(),
  reorderMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))

const CATEGORIES: SupplyCategory[] = [
  { id: 'c1', name: 'Químicos', sortOrder: 0, active: true },
  { id: 'c2', name: 'Descartables', sortOrder: 1, active: true },
  { id: 'c3', name: 'Viejos', sortOrder: 2, active: false },
]

vi.mock('@/features/stock/queries', () => ({
  useSupplyCategoriesQuery: () => ({ data: CATEGORIES, isLoading: false }),
  useStockItemsQuery: () => ({
    data: [
      testItem({ id: 'a', categoryId: 'c1' }),
      testItem({ id: 'b', categoryId: 'c1' }),
      testItem({ id: 'c', categoryId: 'c2' }),
    ],
  }),
  useUpsertSupplyCategoryMutation: () => ({
    mutateAsync: upsertMock,
    isPending: false,
  }),
  useReorderSupplyCategoriesMutation: () => ({
    mutateAsync: reorderMock,
    isPending: false,
  }),
}))

beforeEach(() => {
  mockViewport(true)
  authState.roles = ['owner']
  authState.capabilities = []
  upsertMock.mockReset()
  upsertMock.mockResolvedValue({})
  reorderMock.mockReset()
  reorderMock.mockResolvedValue(undefined)
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('CategoriesTab (IS-03)', () => {
  it('lista las categorías con la cantidad de artículos activos y su estado', () => {
    render(<CategoriesTab />)
    expect(screen.getByText('Químicos')).toBeInTheDocument()
    const row = screen.getByText('Químicos').closest('tr') as HTMLElement
    expect(row).toHaveTextContent('2')
    expect(row).toHaveTextContent('Activa')
    expect(screen.getByText('Viejos').closest('tr')).toHaveTextContent(
      'Desactivada',
    )
  })

  it('«Nueva categoría» abre el alta y el nombre es obligatorio', async () => {
    render(<CategoriesTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Nueva categoría' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(
      await screen.findByText('Indicá el nombre de la categoría.'),
    ).toBeInTheDocument()
    expect(upsertMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Protección' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        id: undefined,
        name: 'Protección',
        sortOrder: 3,
        active: true,
      }),
    )
  })

  it('editar conserva el orden y el estado', async () => {
    render(<CategoriesTab />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Editar la categoría Viejos' }),
    )
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Archivo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        id: 'c3',
        name: 'Archivo',
        sortOrder: 2,
        active: false,
      }),
    )
  })

  it('subir y bajar reordenan renumerando', async () => {
    render(<CategoriesTab />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Subir la categoría Descartables' }),
    )
    await waitFor(() => expect(reorderMock).toHaveBeenCalledTimes(1))
    expect(reorderMock).toHaveBeenCalledWith([
      { id: 'c2', name: 'Descartables', active: true, sortOrder: 0 },
      { id: 'c1', name: 'Químicos', active: true, sortOrder: 1 },
    ])
  })

  it('la primera no se puede subir ni la última bajar', () => {
    render(<CategoriesTab />)
    expect(
      screen.getByRole('button', { name: 'Subir la categoría Químicos' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Bajar la categoría Viejos' }),
    ).toBeDisabled()
  })

  it('desactivar una categoría con artículos activos muestra el mensaje de CATEGORY_IN_USE', async () => {
    const { ApiError } = await import('@/api/errors')
    upsertMock.mockRejectedValue(
      new ApiError(
        'La categoría tiene artículos activos. Pasalos a otra categoría o desactivalos antes.',
        'CATEGORY_IN_USE',
      ),
    )
    render(<CategoriesTab />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Desactivar la categoría Químicos' }),
    )
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'La categoría tiene artículos activos. Pasalos a otra categoría o desactivalos antes.',
      ),
    )
  })

  it('activar una desactivada manda active true', async () => {
    render(<CategoriesTab />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Activar la categoría Viejos' }),
    )
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith({
        id: 'c3',
        name: 'Viejos',
        sortOrder: 2,
        active: true,
      }),
    )
  })

  it('un administrador sin «Gestionar stock» ve la lista, sin botones de cambio', () => {
    authState.roles = ['admin']
    render(<CategoriesTab />)
    expect(screen.getByText('Químicos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva categoría' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Editar la categoría/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Subir la categoría/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Desactivar la categoría/ }),
    ).toBeNull()
  })
})
