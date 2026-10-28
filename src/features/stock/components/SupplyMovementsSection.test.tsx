import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockMovementLine } from '@/api/stock'
import { mockViewport } from '@/features/stock/testSupport'
import { SupplyMovementsSection } from './SupplyMovementsSection'

const { movementsState, queryArgs } = vi.hoisted(() => ({
  movementsState: { data: new Array<StockMovementLine>() },
  queryArgs: { calls: new Array<unknown>() },
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
}))

function line(overrides: Partial<StockMovementLine> = {}): StockMovementLine {
  return {
    movementId: 'm1',
    lineId: 'l1',
    kind: 'entry',
    recordedAt: '2026-10-20T15:05:00Z',
    recordedByName: 'Ana Gómez',
    personId: null,
    personName: null,
    shiftId: null,
    shiftDate: null,
    startTime: null,
    endTime: null,
    clientId: null,
    clientName: null,
    siteId: null,
    siteName: null,
    supplier: null,
    documentNumber: null,
    reason: null,
    note: null,
    countId: null,
    reversesId: null,
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    supplyId: 's1',
    supplyCode: 'QUI-001',
    supplyName: 'Lavandina',
    supplyPresentation: null,
    categoryId: null,
    qtyDelta: 10,
    unitCost: 100,
    unitSale: 150,
    lineCost: 1000,
    lineSale: 1500,
    stockAfter: 25,
    ...overrides,
  }
}

beforeEach(() => {
  mockViewport(true)
  movementsState.data = []
})

describe('SupplyMovementsSection (ficha)', () => {
  it('pide los movimientos del artículo, sin filtro de fechas al abrir', () => {
    render(<SupplyMovementsSection supplyId="s1" />)
    expect(queryArgs.calls.at(-1)).toEqual({
      supplyId: 's1',
      dateFrom: undefined,
      dateTo: undefined,
    })
  })

  it('muestra fecha y hora argentinas, tipo, cantidad con signo y stock resultante', () => {
    movementsState.data = [
      line(),
      line({
        lineId: 'l2',
        kind: 'withdrawal',
        qtyDelta: -3,
        stockAfter: 22,
        recordedAt: '2026-10-21T13:00:00Z',
        personName: 'Luis Pérez',
        recordedByName: 'Luis Pérez',
        shiftId: 'sh1',
        clientName: 'Limpia Ya',
        siteName: 'Sede Centro',
        shiftDate: '2026-10-21',
        startTime: '08:00:00',
        endTime: '12:00:00',
        note: 'Para el piso 3',
      }),
    ]
    render(<SupplyMovementsSection supplyId="s1" />)
    const entry = screen.getByText('mar 20 oct, 12:05').closest('tr')
    expect(entry).not.toBeNull()
    expect(
      within(entry as HTMLElement).getByText('Ingreso'),
    ).toBeInTheDocument()
    expect(within(entry as HTMLElement).getByText('+10')).toBeInTheDocument()
    expect(within(entry as HTMLElement).getByText('25')).toBeInTheDocument()

    const withdrawal = screen.getByText('mié 21 oct, 10:00').closest('tr')
    const row = within(withdrawal as HTMLElement)
    expect(row.getByText('Retiro')).toBeInTheDocument()
    expect(row.getByText('−3')).toBeInTheDocument()
    expect(row.getByText('Luis Pérez')).toBeInTheDocument()
    expect(
      row.getByText('Limpia Ya · Sede Centro · mié 21 oct 08:00 a 12:00'),
    ).toBeInTheDocument()
    expect(row.getByText('Para el piso 3')).toBeInTheDocument()
  })

  it('marca «Anulado» el movimiento anulado, con quién y por qué', () => {
    movementsState.data = [
      line({
        kind: 'withdrawal',
        qtyDelta: -2,
        voidedAt: '2026-10-22T10:00:00Z',
        voidedByName: 'Ana Gómez',
        voidReason: 'Lo cargaron dos veces',
      }),
    ]
    render(<SupplyMovementsSection supplyId="s1" />)
    expect(screen.getByText('Anulado')).toBeInTheDocument()
    expect(
      screen.getByText('Anulado por Ana Gómez: Lo cargaron dos veces'),
    ).toBeInTheDocument()
  })

  it('sin movimientos muestra un mensaje en español', () => {
    render(<SupplyMovementsSection supplyId="s1" />)
    expect(
      screen.getByText('Este artículo todavía no tuvo movimientos'),
    ).toBeInTheDocument()
  })

  it('a 390 px los movimientos pasan a tarjetas', () => {
    mockViewport(false)
    movementsState.data = [line()]
    render(<SupplyMovementsSection supplyId="s1" />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(document.querySelectorAll('[data-slot="row-card"]')).toHaveLength(1)
  })
})
