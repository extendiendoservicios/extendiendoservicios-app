import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockItem } from '@/api/stock'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { StockTab } from './StockTab'

const { authState, itemsState } = vi.hoisted(() => ({
  authState: {
    roles: ['owner'] as string[],
    capabilities: [] as string[],
  },
  itemsState: { data: [] as StockItem[] },
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))

vi.mock('@/features/stock/queries', () => ({
  useStockItemsQuery: () => ({
    data: itemsState.data,
    isLoading: false,
    dataUpdatedAt: 0,
  }),
  useSupplyCategoriesQuery: () => ({
    data: [
      { id: 'c1', name: 'Químicos', sortOrder: 0, active: true },
      { id: 'c2', name: 'Descartables', sortOrder: 1, active: true },
    ],
  }),
  useSupplyImageUrls: () => new Map<string, string>(),
  useAdjustStockMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const ITEMS = [
  testItem({
    id: 'ok',
    code: 'QUI-001',
    name: 'Lavandina',
    presentation: '1 L',
    stockQty: 10,
    stockValue: 1000,
    status: 'ok',
  }),
  testItem({
    id: 'low',
    code: 'QUI-002',
    name: 'Desengrasante',
    presentation: '5 L',
    stockQty: 5,
    minQty: 5,
    stockValue: 500.5,
    status: 'low',
  }),
  testItem({
    id: 'empty',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    presentation: 'x 10',
    categoryId: 'c2',
    categoryName: 'Descartables',
    categorySortOrder: 1,
    minQty: null,
    stockQty: 0,
    stockValue: 0,
    status: 'empty',
  }),
  testItem({
    id: 'inactive',
    code: 'QUI-099',
    name: 'Producto discontinuado',
    stockQty: 0,
    stockValue: 0,
    status: 'empty',
    active: false,
  }),
]

function renderTab(initialEntry = '/admin/insumos') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <StockTab />
    </MemoryRouter>,
  )
}

/** La fila (tr) del artículo con ese nombre. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest('tr')
  if (!row) throw new Error(`No encontré la fila de ${name}`)
  return row
}

beforeEach(() => {
  mockViewport(true)
  authState.roles = ['owner']
  authState.capabilities = []
  itemsState.data = ITEMS
})

describe('StockTab: tabla (IS-05, IS-24)', () => {
  it('muestra las columnas pedidas', () => {
    renderTab()
    for (const header of [
      'Imagen',
      'Código',
      'Artículo',
      'Categoría',
      'Stock',
      'Mínimo',
      'Costo',
      'Venta',
      'Valor a costo',
    ]) {
      expect(
        screen.getByRole('columnheader', {
          name: new RegExp(`^${header}$`, 'i'),
        }),
      ).toBeInTheDocument()
    }
  })

  it('amarillo con etiqueta «Bajo mínimo» si el stock es igual o menor al mínimo', () => {
    renderTab()
    const row = rowOf('Desengrasante')
    expect(row.className).toContain('bg-warning-bg')
    expect(within(row).getByText('Bajo mínimo')).toBeInTheDocument()
  })

  it('rojo con etiqueta «Sin stock» si el stock es cero, aunque no tenga mínimo', () => {
    renderTab()
    const row = rowOf('Bolsa de residuos')
    expect(row.className).toContain('bg-danger-bg')
    expect(within(row).getByText('Sin stock')).toBeInTheDocument()
  })

  it('una fila sin aviso no lleva color ni etiqueta', () => {
    renderTab()
    const row = rowOf('Lavandina')
    expect(row.className).not.toContain('bg-warning-bg')
    expect(row.className).not.toContain('bg-danger-bg')
    expect(within(row).queryByText('Bajo mínimo')).toBeNull()
    expect(within(row).queryByText('Sin stock')).toBeNull()
  })

  it('por defecto oculta los inactivos; «Incluir inactivos» los muestra sin pintarlos de rojo', () => {
    renderTab()
    expect(screen.queryByText('Producto discontinuado')).toBeNull()
    fireEvent.click(screen.getByRole('switch', { name: 'Incluir inactivos' }))
    const row = rowOf('Producto discontinuado')
    expect(row.className).not.toContain('bg-danger-bg')
    expect(within(row).getByText('Inactivo')).toBeInTheDocument()
  })

  it('muestra el total del valor del stock a costo de lo que se ve', () => {
    renderTab()
    expect(screen.getByTestId('stock-total')).toHaveTextContent('$ 1.500,50')
  })

  it('«Solo con aviso» deja los amarillos y los rojos y recalcula el total', () => {
    renderTab()
    fireEvent.click(screen.getByRole('switch', { name: 'Solo con aviso' }))
    expect(screen.queryByText('Lavandina')).toBeNull()
    expect(screen.getByText('Desengrasante')).toBeInTheDocument()
    expect(screen.getByText('Bolsa de residuos')).toBeInTheDocument()
    expect(screen.getByTestId('stock-total')).toHaveTextContent('$ 500,50')
  })

  it('con ?filtro=aviso (tarjetas del Resumen) entra con «Solo con aviso» puesto', () => {
    renderTab('/admin/insumos?filtro=aviso')
    expect(screen.queryByText('Lavandina')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Solo con aviso' })).toBeChecked()
  })

  it('filtra por código o nombre', async () => {
    renderTab()
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Buscar por código o nombre' }),
      { target: { value: 'des-010' } },
    )
    expect(await screen.findByText('Bolsa de residuos')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.queryByText('Lavandina')).toBeNull())
  })

  it('sin resultados muestra un mensaje en español', async () => {
    renderTab()
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Buscar por código o nombre' }),
      { target: { value: 'zzzz' } },
    )
    expect(
      await screen.findByText('No encontramos artículos con esos filtros'),
    ).toBeInTheDocument()
  })

  it('por fila: «Ajustar» y la ficha', () => {
    renderTab()
    const row = rowOf('Lavandina')
    expect(
      within(row).getByRole('button', {
        name: /Ajustar el stock de Lavandina/,
      }),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('link', { name: /Abrir la ficha de Lavandina/ }),
    ).toHaveAttribute('href', '/admin/insumos/ok')
  })
})

describe('StockTab: permisos (IS-21)', () => {
  it('el dueño ve «Ingreso», «Nuevo artículo» y «Ajustar»', () => {
    renderTab()
    expect(screen.getByRole('link', { name: 'Ingreso' })).toHaveAttribute(
      'href',
      '/admin/insumos/ingreso',
    )
    expect(
      screen.getByRole('link', { name: 'Nuevo artículo' }),
    ).toHaveAttribute('href', '/admin/insumos/nuevo')
    expect(
      screen.getAllByRole('button', { name: /^Ajustar el stock/ }).length,
    ).toBeGreaterThan(0)
  })

  it('un administrador con «Gestionar stock» ve los botones', () => {
    authState.roles = ['admin']
    authState.capabilities = ['manage_stock']
    renderTab()
    expect(screen.getByRole('link', { name: 'Ingreso' })).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Nuevo artículo' }),
    ).toBeInTheDocument()
  })

  it('un administrador sin la capacidad ve todo, pero sin los botones que mueven stock ni editan el catálogo', () => {
    authState.roles = ['admin']
    authState.capabilities = ['manage_attendance']
    renderTab()
    expect(screen.getByText('Lavandina')).toBeInTheDocument()
    expect(screen.getByTestId('stock-total')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ingreso' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Nuevo artículo' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Ajustar el stock/ }),
    ).toBeNull()
    // La ficha sí se puede abrir.
    expect(
      screen.getAllByRole('link', { name: /Abrir la ficha de/ }).length,
    ).toBeGreaterThan(0)
  })
})

describe('StockTab: celular', () => {
  it('a 390 px la tabla pasa a tarjetas con el color de la fila, la etiqueta y sus datos', () => {
    mockViewport(false)
    renderTab()
    expect(screen.queryByRole('table')).toBeNull()
    const cards = document.querySelectorAll('[data-slot="row-card"]')
    expect(cards).toHaveLength(3)
    const warnCard = Array.from(cards).find((card) =>
      card.textContent?.includes('Desengrasante'),
    ) as HTMLElement
    expect(warnCard.className).toContain('bg-warning-bg')
    expect(within(warnCard).getByText('Bajo mínimo')).toBeInTheDocument()
    expect(within(warnCard).getByText('Valor a costo')).toBeInTheDocument()
    const critCard = Array.from(cards).find((card) =>
      card.textContent?.includes('Bolsa de residuos'),
    ) as HTMLElement
    expect(critCard.className).toContain('bg-danger-bg')
    expect(within(critCard).getByText('Sin stock')).toBeInTheDocument()
  })
})
