import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConsumptionRow } from '@/api/stock'
import { mockViewport } from '@/features/stock/testSupport'
import { ConsumptionTab } from './ConsumptionTab'

const { consumptionState, queryArgs, downloadMock } = vi.hoisted(() => ({
  consumptionState: { data: [] as ConsumptionRow[] },
  queryArgs: { calls: [] as unknown[] },
  downloadMock: vi.fn(),
}))

vi.mock('@/features/stock/queries', () => ({
  useSupplyConsumptionQuery: (filters: unknown) => {
    queryArgs.calls.push(filters)
    return {
      data: consumptionState.data,
      isLoading: false,
      dataUpdatedAt: 0,
    }
  },
  useStockClientOptionsQuery: () => ({
    data: [
      { id: 'c1', name: 'Banco Sur' },
      { id: 'c2', name: 'Colegio Mayor' },
    ],
  }),
  useWithdrawalSiteOptionsQuery: () => ({
    data: [
      {
        siteId: 'si1',
        siteName: 'Casa Central',
        clientId: 'c1',
        clientName: 'Banco Sur',
      },
      {
        siteId: 'si3',
        siteName: 'Sede única',
        clientId: 'c2',
        clientName: 'Colegio Mayor',
      },
    ],
  }),
}))

vi.mock('@/features/stock/excel', () => ({ downloadExcel: downloadMock }))

function row(overrides: Partial<ConsumptionRow> = {}): ConsumptionRow {
  return {
    day: '2026-10-05',
    clientId: 'c1',
    clientName: 'Banco Sur',
    siteId: 'si1',
    siteName: 'Casa Central',
    supplyId: 's1',
    supplyCode: 'QUI-001',
    supplyName: 'Lavandina',
    supplyPresentation: '1 L',
    qty: 2,
    costTotal: 200,
    saleTotal: 300,
    ...overrides,
  }
}

beforeEach(() => {
  mockViewport(true)
  // 26 oct 2026, 11:00 en Argentina.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T14:00:00Z'))
  consumptionState.data = []
  queryArgs.calls = []
  downloadMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ConsumptionTab: consumo por cliente (IS-24)', () => {
  it('por defecto pide el mes en curso, sin cliente ni sede', () => {
    render(<ConsumptionTab />)
    expect(queryArgs.calls.at(-1)).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-26',
      clientId: undefined,
      siteId: undefined,
    })
  })

  it('«Mes anterior» cambia el período al mes completo', () => {
    render(<ConsumptionTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(queryArgs.calls.at(-1)).toMatchObject({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })
  })

  it('muestra el total del período y los totales a costo y a venta por cliente y por sede', () => {
    consumptionState.data = [
      row(),
      row({ day: '2026-10-06', qty: 1, costTotal: 100, saleTotal: 150 }),
      row({
        clientId: 'c2',
        clientName: 'Colegio Mayor',
        siteId: 'si3',
        siteName: 'Sede única',
        supplyId: 's2',
        supplyCode: 'DES-001',
        supplyName: 'Bolsas',
        supplyPresentation: null,
        qty: 10,
        costTotal: 500,
        saleTotal: 800,
      }),
    ]
    render(<ConsumptionTab />)

    const total = within(screen.getByTestId('consumption-total'))
    expect(total.getByText('$ 800,00')).toBeInTheDocument()
    expect(total.getByText('$ 1.250,00')).toBeInTheDocument()
    expect(total.getByText(/13 unidades/)).toBeInTheDocument()

    const [banco, colegio] = screen.getAllByTestId('consumption-client')
    expect(
      within(banco as HTMLElement).getByText('Banco Sur'),
    ).toBeInTheDocument()
    // Con una sola sede y un solo artículo, el cliente, la sede y el artículo suman lo mismo.
    expect(within(banco as HTMLElement).getAllByText('$ 300,00')).toHaveLength(
      3,
    )
    expect(within(banco as HTMLElement).getAllByText('$ 450,00')).toHaveLength(
      3,
    )
    expect(
      within(colegio as HTMLElement).getAllByText('$ 500,00'),
    ).toHaveLength(3)
    // Detalle por artículo.
    expect(
      within(banco as HTMLElement).getByText(/Lavandina · 1 L/),
    ).toBeInTheDocument()
  })

  it('sin retiros en el período muestra un mensaje en español', () => {
    render(<ConsumptionTab />)
    expect(
      screen.getByText('No hubo retiros en ese período'),
    ).toBeInTheDocument()
  })

  it('«Exportar a Excel» baja las filas del período filtrado', async () => {
    consumptionState.data = [row(), row({ day: '2026-10-06' })]
    render(<ConsumptionTab />)
    fireEvent.click(screen.getByRole('button', { name: 'Exportar a Excel' }))
    await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1))
    const [fileName, spec] = downloadMock.mock.calls[0] as [
      string,
      { rows: unknown[]; sheetName: string },
    ]
    expect(fileName).toBe('consumo-por-cliente-2026-10-01_a_2026-10-26')
    expect(spec.rows).toBe(consumptionState.data)
  })
})
