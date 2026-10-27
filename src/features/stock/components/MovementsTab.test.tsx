import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockMovementLine } from '@/api/stock'
import { testMovementLine } from '@/features/stock/movementFixtures'
import { mockViewport } from '@/features/stock/testSupport'
import { MovementsTab } from './MovementsTab'

const {
  authState,
  movementsState,
  queryArgs,
  voidMutate,
  fetchAllMock,
  downloadMock,
} = vi.hoisted(() => ({
  authState: {
    roles: ['owner'] as string[],
    capabilities: [] as string[],
  },
  movementsState: { data: [] as StockMovementLine[] },
  queryArgs: { calls: [] as unknown[] },
  voidMutate: vi.fn(),
  fetchAllMock: vi.fn(),
  downloadMock: vi.fn(),
}))

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => authState,
}))

vi.mock('@/features/stock/queries', () => ({
  useStockMovementsQuery: (filters: unknown) => {
    queryArgs.calls.push(filters)
    return {
      data: movementsState.data,
      isLoading: false,
      dataUpdatedAt: 0,
    }
  },
  useStockItemsQuery: () => ({
    data: [
      {
        id: 's1',
        code: 'QUI-001',
        name: 'Lavandina',
        presentation: '1 L',
      },
    ],
  }),
  useStockPeopleQuery: () => ({
    data: [
      { profileId: 'p1', firstName: 'Lucía', lastName: 'Pérez' },
      { profileId: 'p2', firstName: 'Marta', lastName: 'Ruiz' },
    ],
  }),
  useStockClientOptionsQuery: () => ({
    data: [{ id: 'c1', name: 'Banco Sur' }],
  }),
  useWithdrawalSiteOptionsQuery: () => ({
    data: [
      {
        siteId: 'si1',
        siteName: 'Casa Central',
        clientId: 'c1',
        clientName: 'Banco Sur',
      },
    ],
  }),
  useVoidStockMovementMutation: () => ({
    mutate: voidMutate,
    isPending: false,
  }),
}))

vi.mock('@/api/stock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/stock')>()),
  fetchAllStockMovements: fetchAllMock,
}))

vi.mock('@/features/stock/excel', () => ({
  downloadExcel: downloadMock,
}))

function renderTab() {
  return render(
    <MemoryRouter>
      <MovementsTab />
    </MemoryRouter>,
  )
}

/** La tarjeta del movimiento que contiene ese texto. */
function cardWith(text: string): HTMLElement {
  const card = screen.getByText(text).closest('[data-testid="movement-card"]')
  if (!card) throw new Error(`No encontré la tarjeta con ${text}`)
  return card as HTMLElement
}

beforeEach(() => {
  mockViewport(true)
  // cmdk (el buscador de los filtros) llama a `scrollIntoView`, que jsdom no trae.
  Element.prototype.scrollIntoView = vi.fn()
  authState.roles = ['owner']
  authState.capabilities = []
  movementsState.data = []
  queryArgs.calls = []
  voidMutate.mockReset()
  fetchAllMock.mockReset()
  downloadMock.mockReset()
})

describe('MovementsTab: contenido de cada movimiento (IS-18)', () => {
  it('muestra las líneas, quién registró, persona, turno, proveedor, comprobante, nota y precios', () => {
    movementsState.data = [
      testMovementLine({
        movementId: 'w1',
        lineId: 'w1a',
        kind: 'withdrawal',
        qtyDelta: -2,
        lineCost: -200,
        lineSale: -300,
        stockAfter: 8,
        personId: 'p1',
        personName: 'Lucía Pérez',
        recordedByName: 'Ana Gómez',
        shiftId: 't1',
        shiftDate: '2026-10-20',
        startTime: '08:00:00',
        endTime: '12:00:00',
        clientName: 'Banco Sur',
        siteName: 'Casa Central',
        note: 'Para el piso 3',
      }),
      testMovementLine({
        movementId: 'w1',
        lineId: 'w1b',
        kind: 'withdrawal',
        supplyId: 's2',
        supplyCode: 'DES-002',
        supplyName: 'Bolsas',
        supplyPresentation: null,
        qtyDelta: -10,
        lineCost: -500,
        lineSale: -800,
      }),
      testMovementLine({
        movementId: 'e1',
        lineId: 'e1a',
        recordedAt: '2026-10-19T15:00:00Z',
        supplier: 'Droguería Sur',
        documentNumber: 'R-0001-123',
      }),
    ]
    renderTab()

    const withdrawal = within(cardWith('Para el piso 3'))
    expect(withdrawal.getByText('Retiro')).toBeInTheDocument()
    expect(withdrawal.getByText(/Registró Ana Gómez/)).toBeInTheDocument()
    expect(
      withdrawal.getByText(
        'Banco Sur · Casa Central · mar 20 oct 08:00 a 12:00',
      ),
    ).toBeInTheDocument()
    expect(withdrawal.getByText('Lavandina · 1 L')).toBeInTheDocument()
    expect(withdrawal.getByText('Bolsas')).toBeInTheDocument()
    expect(withdrawal.getByText('−2')).toBeInTheDocument()
    expect(withdrawal.getByText('−10')).toBeInTheDocument()
    // Totales del movimiento: 200 + 500 a costo, 300 + 800 a venta.
    expect(withdrawal.getByText('$ 700,00')).toBeInTheDocument()
    expect(withdrawal.getByText('$ 1.100,00')).toBeInTheDocument()

    const entry = within(cardWith('Droguería Sur'))
    expect(entry.getByText('Ingreso')).toBeInTheDocument()
    expect(entry.getByText('R-0001-123')).toBeInTheDocument()
  })

  it('tocar un artículo abre su ficha y tocar una persona, su pestaña «Retiros»', () => {
    movementsState.data = [
      testMovementLine({
        kind: 'withdrawal',
        qtyDelta: -2,
        personId: 'p1',
        personName: 'Lucía Pérez',
      }),
    ]
    renderTab()
    expect(
      screen.getByRole('link', { name: /Lavandina · 1 L/ }),
    ).toHaveAttribute('href', '/admin/insumos/s1')
    expect(screen.getByRole('link', { name: 'Lucía Pérez' })).toHaveAttribute(
      'href',
      '/admin/empleados/p1?pestana=retiros',
    )
  })

  it('marca «Anulado» con quién y el motivo', () => {
    movementsState.data = [
      testMovementLine({
        kind: 'withdrawal',
        qtyDelta: -2,
        voidedAt: '2026-10-21T10:00:00Z',
        voidedByName: 'Ana Gómez',
        voidReason: 'Lo cargaron dos veces',
      }),
    ]
    renderTab()
    expect(screen.getByText('Anulado')).toBeInTheDocument()
    expect(
      screen.getByText('Anulado por Ana Gómez: Lo cargaron dos veces'),
    ).toBeInTheDocument()
  })

  it('sin movimientos muestra un mensaje en español', () => {
    renderTab()
    expect(screen.getByText('Todavía no hay movimientos')).toBeInTheDocument()
  })
})

describe('MovementsTab: «Anular» (IS-21, IS-27)', () => {
  function seedOneOfEachKind() {
    movementsState.data = (
      [
        'entry',
        'return',
        'withdrawal',
        'adjustment',
        'count',
        'reversal',
      ] as const
    ).map((kind, index) =>
      testMovementLine({
        movementId: `m-${kind}`,
        lineId: `l-${kind}`,
        kind,
        recordedAt: `2026-10-2${index}T15:00:00Z`,
      }),
    )
    movementsState.data.push(
      testMovementLine({
        movementId: 'm-voided',
        lineId: 'l-voided',
        kind: 'withdrawal',
        recordedAt: '2026-10-10T15:00:00Z',
        voidedAt: '2026-10-11T10:00:00Z',
      }),
    )
  }

  it('el dueño lo ve solo en ingresos, devoluciones y retiros no anulados', () => {
    seedOneOfEachKind()
    renderTab()
    const offered = screen
      .getAllByTestId('movement-card')
      .filter((card) => within(card).queryByRole('button', { name: /^Anular/ }))
      .map((card) => card.getAttribute('data-kind'))
    expect(offered).toEqual(['entry', 'return', 'withdrawal'])
  })

  it('un administrador con «Gestionar stock» también lo ve', () => {
    seedOneOfEachKind()
    authState.roles = ['admin']
    authState.capabilities = ['manage_stock']
    renderTab()
    expect(screen.getAllByRole('button', { name: /^Anular/ })).toHaveLength(3)
  })

  it('un administrador sin «Gestionar stock» ve los movimientos pero no «Anular»', () => {
    seedOneOfEachKind()
    authState.roles = ['admin']
    authState.capabilities = []
    renderTab()
    expect(screen.getAllByTestId('movement-card')).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /^Anular/ })).toBeNull()
  })

  it('pide un motivo obligatorio y anula con ese motivo', async () => {
    movementsState.data = [
      testMovementLine({ movementId: 'm-1', kind: 'withdrawal', qtyDelta: -2 }),
    ]
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Anular/ }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/Las cantidades vuelven al stock/),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Anular' })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Motivo de la anulación'), {
      target: { value: '  Lo cargaron dos veces  ' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(voidMutate).toHaveBeenCalledTimes(1)
    expect(voidMutate.mock.calls[0]?.[0]).toEqual({
      movementId: 'm-1',
      reason: 'Lo cargaron dos veces',
    })
  })

  it('anular un ingreso avisa que se descuenta del stock', async () => {
    movementsState.data = [
      testMovementLine({ movementId: 'm-1', kind: 'entry' }),
    ]
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: /^Anular/ }))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(/se descuentan del stock/),
    ).toBeInTheDocument()
  })
})

describe('MovementsTab: filtros y Excel (IS-18)', () => {
  it('al abrir no filtra nada', () => {
    renderTab()
    expect(queryArgs.calls.at(-1)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
      kind: undefined,
      personId: undefined,
      supplyId: undefined,
      clientId: undefined,
      siteId: undefined,
    })
  })

  it('al elegir una persona vuelve a pedir los movimientos de esa persona', async () => {
    renderTab()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Filtrar por persona' }),
    )
    fireEvent.click(await screen.findByRole('option', { name: 'Lucía Pérez' }))
    expect(queryArgs.calls.at(-1)).toMatchObject({ personId: 'p1' })
    expect(
      screen.getByRole('button', { name: 'Limpiar filtros' }),
    ).toBeInTheDocument()
  })

  it('«Exportar a Excel» baja todo lo filtrado, no solo lo que se ve', async () => {
    const all = [testMovementLine(), testMovementLine({ lineId: 'l2' })]
    fetchAllMock.mockResolvedValue(all)
    renderTab()
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Filtrar por persona' }),
    )
    fireEvent.click(await screen.findByRole('option', { name: 'Marta Ruiz' }))
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))

    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1))
    expect(fetchAllMock).toHaveBeenCalledWith(
      expect.objectContaining({ personId: 'p2' }),
    )
    const [fileName, spec] = downloadMock.mock.calls[0] as [
      string,
      { rows: unknown[]; sheetName: string },
    ]
    expect(fileName).toMatch(/^movimientos-insumos-\d{4}-\d{2}-\d{2}$/)
    expect(spec.sheetName).toBe('Movimientos')
    expect(spec.rows).toBe(all)
  })
})
