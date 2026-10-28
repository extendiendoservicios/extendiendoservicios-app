import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  StockCountInput,
  StockCountResult,
  StockItem,
  StockMovementLine,
} from '@/api/stock'
import { testMovementLine } from '@/features/stock/movementFixtures'
import { mockViewport, testItem } from '@/features/stock/testSupport'
import { StockCountScreen } from './StockCountScreen'

const {
  authState,
  itemsState,
  movementsState,
  movementsArgs,
  mutateMock,
  resultState,
  toastMock,
} = vi.hoisted(() => ({
  authState: { roles: ['owner'] as string[], capabilities: [] as string[] },
  itemsState: { data: [] as StockItem[] },
  movementsState: { data: [] as StockMovementLine[] },
  movementsArgs: { calls: [] as Array<{ filters: unknown; options: unknown }> },
  mutateMock: vi.fn(),
  resultState: { value: null as StockCountResult | null },
  toastMock: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/features/stock/queries', () => ({
  useStockItemsQuery: () => ({ data: itemsState.data, isLoading: false }),
  useSupplyCategoriesQuery: () => ({
    data: [{ id: 'c1', name: 'Químicos', sortOrder: 0, active: true }],
  }),
  useStockReviewersQuery: () => ({
    data: [
      { profileId: 'u1', firstName: 'Ana', lastName: 'Gómez' },
      { profileId: 'u2', firstName: 'Marta', lastName: 'Ruiz' },
    ],
  }),
  useStockMovementsQuery: (filters: unknown, options: unknown) => {
    movementsArgs.calls.push({ filters, options })
    return { data: movementsState.data, isLoading: false }
  },
  useRegisterStockCountMutation: () => ({
    mutate: (
      input: StockCountInput,
      callbacks?: { onSuccess?: (result: StockCountResult) => void },
    ) => {
      mutateMock(input)
      callbacks?.onSuccess?.(resultState.value as StockCountResult)
    },
    isPending: false,
  }),
}))

const ITEMS = [
  testItem({ id: 's1', code: 'QUI-001', name: 'Lavandina', stockQty: 10 }),
  testItem({
    id: 's2',
    code: 'QUI-002',
    name: 'Desengrasante',
    presentation: '5 L',
    stockQty: 4,
  }),
  testItem({
    id: 's3',
    code: 'QUI-003',
    name: 'Cloro',
    presentation: null,
    stockQty: 7,
  }),
  testItem({
    id: 's4',
    code: 'QUI-099',
    name: 'Producto discontinuado',
    active: false,
  }),
]

function renderScreen() {
  return render(
    <MemoryRouter>
      <StockCountScreen />
    </MemoryRouter>,
  )
}

function counted(name: string, value: string) {
  fireEvent.change(screen.getByLabelText(`Contado de ${name}`), {
    target: { value },
  })
}

beforeEach(() => {
  mockViewport(true)
  Element.prototype.scrollIntoView = vi.fn()
  // 26 oct 2026, 14:30 en Argentina.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T17:30:00Z'))
  authState.roles = ['owner']
  authState.capabilities = []
  itemsState.data = ITEMS
  movementsState.data = []
  movementsArgs.calls = []
  mutateMock.mockReset()
  toastMock.error.mockReset()
  resultState.value = {
    countId: 'k1',
    countedAt: '2026-10-26T14:30:00-03:00',
    movementId: 'm1',
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
    ],
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('StockCountScreen: «Cargar control» (IS-16, IS-31)', () => {
  it('sin «Gestionar stock» no se puede cargar un control', () => {
    authState.roles = ['admin']
    renderScreen()
    expect(
      screen.getByText('No tenés permiso para cargar controles'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Confirmar control' }),
    ).toBeNull()
  })

  it('una fila por artículo activo, con su stock actual de referencia', () => {
    renderScreen()
    expect(
      screen.getByLabelText('Contado de Lavandina · 1 L'),
    ).toBeInTheDocument()
    expect(
      screen.getByLabelText('Contado de Desengrasante · 5 L'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Contado de Cloro')).toBeInTheDocument()
    expect(screen.queryByText('Producto discontinuado')).toBeNull()
    expect(screen.getAllByText(/Stock actual/)).toHaveLength(3)
  })

  it('explica que la diferencia se calcula contra el stock a la hora del control', () => {
    renderScreen()
    expect(
      screen.getByText(/a la hora del control/, { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Las filas en blanco no se tocan/),
    ).toBeInTheDocument()
  })

  it('por defecto el control es de ahora, en hora de Argentina', () => {
    renderScreen()
    expect(screen.getByLabelText('Hora del control')).toHaveValue('14:30')
  })

  it('manda solo las filas contadas: las en blanco no se tocan, y el cero cuenta', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Un nombre escrito' }))
    fireEvent.change(screen.getByLabelText('Nombre de quien revisó'), {
      target: { value: 'Marta (proveedor)' },
    })
    counted('Lavandina · 1 L', '8')
    counted('Cloro', '0')
    // «Desengrasante» queda en blanco.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1))
    const input = mutateMock.mock.calls[0]?.[0] as StockCountInput
    expect(input.lines).toEqual([
      { supplyId: 's1', countedQty: 8 },
      { supplyId: 's3', countedQty: 0 },
    ])
    expect(input.countedAt).toBe('2026-10-26T14:30:00-03:00')
    expect(input.reviewerName).toBe('Marta (proveedor)')
    expect(input.reviewerId).toBeNull()
  })

  it('con una persona de la app como revisor manda su id y no el nombre', async () => {
    renderScreen()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Persona que revisó' }),
    )
    fireEvent.click(await screen.findByRole('option', { name: 'Marta Ruiz' }))
    counted('Lavandina · 1 L', '9')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1))
    const input = mutateMock.mock.calls[0]?.[0] as StockCountInput
    expect(input.reviewerId).toBe('u2')
    expect(input.reviewerName).toBeNull()
  })

  it('pide el revisor y no manda nada si falta', async () => {
    renderScreen()
    counted('Lavandina · 1 L', '9')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))
    expect(
      await screen.findByText('Elegí la persona que revisó.'),
    ).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('pide al menos una fila contada', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Un nombre escrito' }))
    fireEvent.change(screen.getByLabelText('Nombre de quien revisó'), {
      target: { value: 'Marta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))
    expect(
      await screen.findByText(
        'Cargá la cantidad contada de al menos un artículo.',
      ),
    ).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('marca la fila con una cantidad que no es un entero y no manda nada', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Un nombre escrito' }))
    fireEvent.change(screen.getByLabelText('Nombre de quien revisó'), {
      target: { value: 'Marta' },
    })
    counted('Cloro', '3,5')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))
    expect(
      await screen.findByText('Tiene que ser un número entero, cero o mayor.'),
    ).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('no deja confirmar un control con fecha y hora futuras', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Un nombre escrito' }))
    fireEvent.change(screen.getByLabelText('Nombre de quien revisó'), {
      target: { value: 'Marta' },
    })
    fireEvent.change(screen.getByLabelText('Hora del control'), {
      target: { value: '23:59' },
    })
    counted('Cloro', '3')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))
    expect(
      await screen.findByText(
        'La fecha y la hora del control no pueden ser futuras.',
      ),
    ).toBeInTheDocument()
    expect(mutateMock).not.toHaveBeenCalled()
  })

  it('con un control de ahora no consulta los movimientos posteriores', () => {
    renderScreen()
    expect(movementsArgs.calls.at(-1)?.options).toEqual({ enabled: false })
  })

  it('con un control de hace horas avisa cuántos movimientos tuvo cada artículo después', () => {
    // Lavandina: un retiro (14:00 UTC = 11:00) y un ingreso (16:00 UTC = 13:00)
    // posteriores a las 08:00; Cloro: uno solo; Desengrasante: ninguno.
    movementsState.data = [
      testMovementLine({
        movementId: 'a',
        lineId: 'a1',
        supplyId: 's1',
        recordedAt: '2026-10-26T14:00:00Z',
        kind: 'withdrawal',
        qtyDelta: -3,
      }),
      testMovementLine({
        movementId: 'b',
        lineId: 'b1',
        supplyId: 's1',
        recordedAt: '2026-10-26T16:00:00Z',
        qtyDelta: 5,
      }),
      testMovementLine({
        movementId: 'c',
        lineId: 'c1',
        supplyId: 's3',
        recordedAt: '2026-10-26T15:00:00Z',
        kind: 'withdrawal',
        qtyDelta: -2,
      }),
      // Anterior al control: no cuenta.
      testMovementLine({
        movementId: 'd',
        lineId: 'd1',
        supplyId: 's2',
        recordedAt: '2026-10-26T10:00:00Z',
        qtyDelta: 9,
      }),
    ]
    renderScreen()
    fireEvent.change(screen.getByLabelText('Hora del control'), {
      target: { value: '08:00' },
    })

    expect(movementsArgs.calls.at(-1)).toEqual({
      filters: { dateFrom: '2026-10-26' },
      options: { enabled: true },
    })
    expect(
      screen.getByText(
        /Tuvo 2 movimientos después de esa hora; se tienen en cuenta\./,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Tuvo 1 movimiento después de esa hora; se tiene en cuenta\./,
      ),
    ).toBeInTheDocument()
    // Stock del sistema a esa hora: actual menos lo movido después (10 - (-3 + 5) = 8).
    expect(
      screen.getByText(/Stock del sistema a esa hora: 8\./),
    ).toBeInTheDocument()
    // Cloro: 7 - (-2) = 9.
    expect(
      screen.getByText(/Stock del sistema a esa hora: 9\./),
    ).toBeInTheDocument()
  })

  it('al confirmar muestra el resumen con stock del sistema, contado y diferencia', async () => {
    renderScreen()
    fireEvent.click(screen.getByRole('radio', { name: 'Un nombre escrito' }))
    fireEvent.change(screen.getByLabelText('Nombre de quien revisó'), {
      target: { value: 'Marta' },
    })
    counted('Lavandina · 1 L', '8')
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar control' }))

    const summary = within(await screen.findByTestId('count-summary'))
    expect(summary.getByText('Control cargado')).toBeInTheDocument()
    expect(summary.getByText('Lavandina · 1 L')).toBeInTheDocument()
    expect(summary.getByText('10')).toBeInTheDocument()
    expect(summary.getByText('8')).toBeInTheDocument()
    expect(summary.getByText('−2')).toBeInTheDocument()
    expect(
      summary.getByText(/Hay 1 diferencia: quedó registrada como un ajuste/),
    ).toBeInTheDocument()
  })
})
