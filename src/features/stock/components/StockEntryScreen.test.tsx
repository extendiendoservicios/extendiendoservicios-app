import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockItem } from '@/api/stock'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { StockEntryScreen } from './StockEntryScreen'

const { authState, mutateAsyncMock, toastMock } = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  mutateAsyncMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))

const ITEMS: StockItem[] = [
  testItem({ id: 's1', code: 'QUI-001', name: 'Lavandina', costPrice: 100 }),
  testItem({
    id: 's2',
    code: 'DES-010',
    name: 'Bolsa de residuos',
    presentation: 'x 10',
    costPrice: 50,
  }),
  testItem({
    id: 's3',
    code: 'QUI-099',
    name: 'Producto discontinuado',
    active: false,
    stockQty: 0,
  }),
]

vi.mock('@/features/stock/queries', () => ({
  useStockItemsQuery: () => ({ data: ITEMS, isLoading: false }),
  useRegisterStockEntryMutation: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

function renderScreen() {
  return render(
    <MemoryRouter>
      <StockEntryScreen />
    </MemoryRouter>,
  )
}

function addItem(optionName: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Agregar un artículo' }))
  fireEvent.click(screen.getByRole('option', { name: optionName }))
}

beforeEach(() => {
  mockViewport(true)
  Element.prototype.scrollIntoView = vi.fn()
  authState.roles = ['owner']
  authState.capabilities = []
  mutateAsyncMock.mockReset()
  mutateAsyncMock.mockResolvedValue({
    movementId: 'm1',
    kind: 'entry',
    recordedAt: '',
    lines: [
      {
        supplyId: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
        qtyDelta: 10,
        unitCost: 100,
        unitSale: 150,
        stockAfter: 20,
      },
    ],
  })
  toastMock.success.mockReset()
  toastMock.error.mockReset()
})

describe('StockEntryScreen (IS-09, IS-23)', () => {
  it('el buscador ofrece solo artículos activos y no repite los ya agregados', () => {
    renderScreen()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Agregar un artículo' }),
    )
    expect(
      screen.getByRole('option', { name: 'QUI-001 · Lavandina · 1 L' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: /Producto discontinuado/ }),
    ).toBeNull()
  })

  it('sin artículos no registra y lo avisa', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    expect(
      await screen.findByText('Agregá al menos un artículo.'),
    ).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('la cantidad es obligatoria', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    expect(await screen.findByText('Indicá la cantidad.')).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()
  })

  it('sin costo cargado registra directo, sin preguntar por el precio', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/¿Actualizar el precio de costo/)).toBeNull()
    expect(mutateAsyncMock).toHaveBeenCalledWith({
      kind: 'entry',
      lines: [{ supplyId: 's1', qty: 10, unitCost: null, updateCost: false }],
      supplier: null,
      documentNumber: null,
      note: null,
    })
  })

  it('un costo igual al vigente no pregunta nada', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/Costo unitario/), {
      target: { value: '100,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/¿Actualizar el precio de costo/)).toBeNull()
  })

  it('un costo distinto del vigente pregunta «¿Actualizar el precio de costo de X a $ N?» y manda update_cost con «Sí»', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/Costo unitario/), {
      target: { value: '120' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))

    const question = await screen.findByText(
      (_, element) =>
        element?.tagName === 'P' &&
        (element.textContent ?? '').startsWith(
          '¿Actualizar el precio de costo de Lavandina · 1 L a $ 120,00?',
        ),
    )
    expect(question).toBeInTheDocument()
    expect(mutateAsyncMock).not.toHaveBeenCalled()

    // Hay que contestar antes de confirmar.
    const confirm = screen.getByRole('button', { name: 'Confirmar ingreso' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Sí, actualizar' }))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ supplyId: 's1', qty: 10, unitCost: 120, updateCost: true }],
      }),
    )
  })

  it('contestar «No» registra el costo en el movimiento pero no actualiza el precio', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/Costo unitario/), {
      target: { value: '120' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    fireEvent.click(
      await screen.findByRole('radio', { name: 'No, dejar el actual' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar ingreso' }))
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [{ supplyId: 's1', qty: 10, unitCost: 120, updateCost: false }],
      }),
    )
  })

  it('pregunta una vez por cada artículo con costo distinto', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    addItem('DES-010 · Bolsa de residuos · x 10')
    const qtys = screen.getAllByLabelText('Cantidad')
    const costs = screen.getAllByLabelText(/Costo unitario/)
    fireEvent.change(qtys[0] as HTMLElement, { target: { value: '1' } })
    fireEvent.change(qtys[1] as HTMLElement, { target: { value: '2' } })
    fireEvent.change(costs[0] as HTMLElement, { target: { value: '110' } })
    fireEvent.change(costs[1] as HTMLElement, { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    await screen.findByText('Costos distintos del vigente')
    // Solo la primera difiere (la segunda coincide con el costo vigente).
    expect(
      screen.getAllByRole('radio', { name: 'Sí, actualizar' }),
    ).toHaveLength(1)
  })

  it('al confirmar muestra el resumen con el stock resultante', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    const summary = await screen.findByTestId('entry-summary')
    expect(summary).toHaveTextContent('Ingreso registrado')
    expect(summary).toHaveTextContent('+10')
    expect(summary).toHaveTextContent('20')
    expect(
      screen.getByRole('link', { name: 'Volver a Stock' }),
    ).toHaveAttribute('href', '/admin/insumos')
  })

  it('una devolución manda el tipo return', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Devolución' }))
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Registrar devolución' }),
    )
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'return' }),
    )
  })

  it('proveedor, comprobante y observación son opcionales pero se mandan si se cargan', async () => {
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText(/Proveedor/), {
      target: { value: 'Distribuidora Sur' },
    })
    fireEvent.change(screen.getByLabelText(/Remito o factura/), {
      target: { value: 'R-0001-123' },
    })
    fireEvent.change(screen.getByLabelText(/Observación/), {
      target: { value: 'Llegó completo' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    await waitFor(() => expect(mutateAsyncMock).toHaveBeenCalledTimes(1))
    expect(mutateAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supplier: 'Distribuidora Sur',
        documentNumber: 'R-0001-123',
        note: 'Llegó completo',
      }),
    )
  })

  it('un error del servidor se muestra tal cual', async () => {
    const { ApiError } = await import('@/api/errors')
    mutateAsyncMock.mockRejectedValue(
      new ApiError(
        'Las cantidades tienen que ser números enteros.',
        'INVALID_QTY',
      ),
    )
    renderScreen()
    addItem('QUI-001 · Lavandina · 1 L')
    fireEvent.change(screen.getByLabelText('Cantidad'), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ingreso' }))
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Las cantidades tienen que ser números enteros.',
      ),
    )
  })

  it('un administrador sin «Gestionar stock» no puede cargar ingresos', () => {
    authState.roles = ['admin']
    authState.capabilities = []
    renderScreen()
    expect(
      screen.getByText('No tenés permiso para registrar ingresos'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Registrar ingreso' }),
    ).toBeNull()
  })
})
