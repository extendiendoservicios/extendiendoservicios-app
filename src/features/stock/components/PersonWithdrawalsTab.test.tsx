import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StockMovementLine } from '@/api/stock'
import { testMovementLine } from '@/features/stock/movementFixtures'
import { mockViewport } from '@/features/stock/testSupport'
import { PersonWithdrawalsTab } from './PersonWithdrawalsTab'

const { withdrawalsState, queryArgs } = vi.hoisted(() => ({
  withdrawalsState: { data: [] as StockMovementLine[] },
  queryArgs: { calls: [] as unknown[][] },
}))

vi.mock('@/features/stock/queries', () => ({
  usePersonWithdrawalsQuery: (...args: unknown[]) => {
    queryArgs.calls.push(args)
    return {
      data: withdrawalsState.data,
      isLoading: false,
      dataUpdatedAt: 0,
    }
  },
}))

function withdrawal(overrides: Partial<StockMovementLine> = {}) {
  return testMovementLine({
    kind: 'withdrawal',
    personId: 'p1',
    personName: 'Lucía Pérez',
    recordedByName: 'Lucía Pérez',
    qtyDelta: -2,
    lineCost: -200,
    lineSale: -300,
    ...overrides,
  })
}

beforeEach(() => {
  mockViewport(true)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-26T14:00:00Z'))
  withdrawalsState.data = []
  queryArgs.calls = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PersonWithdrawalsTab: pestaña «Retiros» de la ficha (IS-18)', () => {
  it('pide los retiros de la persona del mes en curso', () => {
    render(<PersonWithdrawalsTab profileId="p1" name="Lucía Pérez" />)
    expect(queryArgs.calls.at(-1)).toEqual(['p1', '2026-10-01', '2026-10-26'])
  })

  it('muestra fecha, turno o sede, artículos y cantidades, y el total a venta del período', () => {
    withdrawalsState.data = [
      withdrawal({
        movementId: 'm1',
        lineId: 'l1',
        shiftId: 't1',
        shiftDate: '2026-10-20',
        startTime: '08:00:00',
        endTime: '12:00:00',
        clientName: 'Banco Sur',
        siteName: 'Casa Central',
      }),
      withdrawal({
        movementId: 'm1',
        lineId: 'l2',
        supplyId: 's2',
        supplyName: 'Bolsas',
        supplyPresentation: null,
        qtyDelta: -10,
        lineSale: -800,
      }),
      withdrawal({
        movementId: 'm2',
        lineId: 'l3',
        recordedAt: '2026-10-22T15:00:00Z',
        siteId: 'si1',
        siteName: 'Casa Central',
        clientName: 'Banco Sur',
        note: 'Reposición de la semana',
        lineSale: -150,
        qtyDelta: -1,
      }),
    ]
    render(<PersonWithdrawalsTab profileId="p1" name="Lucía Pérez" />)

    const [first, second] = screen.getAllByTestId('person-withdrawal')
    expect(
      within(first as HTMLElement).getByText(
        'Banco Sur · Casa Central · mar 20 oct 08:00 a 12:00',
      ),
    ).toBeInTheDocument()
    expect(
      within(first as HTMLElement).getByText('Lavandina · 1 L'),
    ).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText('Bolsas')).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText('10')).toBeInTheDocument()
    expect(
      within(first as HTMLElement).getByText('$ 1.100,00'),
    ).toBeInTheDocument()
    expect(
      within(second as HTMLElement).getByText('Reposición de la semana'),
    ).toBeInTheDocument()

    // Total a venta del período: 300 + 800 + 150.
    expect(
      within(screen.getByTestId('person-withdrawals-total')).getByText(
        '$ 1.250,00',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('2 retiros en el período')).toBeInTheDocument()
  })

  it('un retiro anulado se marca y no suma al total', () => {
    withdrawalsState.data = [
      withdrawal({ movementId: 'm1', lineId: 'l1', lineSale: -300 }),
      withdrawal({
        movementId: 'm2',
        lineId: 'l2',
        recordedAt: '2026-10-22T15:00:00Z',
        lineSale: -500,
        voidedAt: '2026-10-23T10:00:00Z',
        voidedByName: 'Ana Gómez',
        voidReason: 'Lo cargaron dos veces',
      }),
    ]
    render(<PersonWithdrawalsTab profileId="p1" name="Lucía Pérez" />)

    expect(screen.getByText('Anulado')).toBeInTheDocument()
    expect(
      screen.getByText('Anulado por Ana Gómez: Lo cargaron dos veces'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('person-withdrawals-total')).getByText(
        '$ 300,00',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 retiro en el período (sin contar los anulados)'),
    ).toBeInTheDocument()
  })

  it('avisa quién cargó el retiro cuando fue la oficina en nombre de la persona', () => {
    withdrawalsState.data = [withdrawal({ recordedByName: 'Ana Gómez' })]
    render(<PersonWithdrawalsTab profileId="p1" name="Lucía Pérez" />)
    expect(screen.getByText('Lo cargó Ana Gómez')).toBeInTheDocument()
  })

  it('sin retiros en el período muestra un mensaje en español', () => {
    render(<PersonWithdrawalsTab profileId="p1" name="Lucía Pérez" />)
    expect(
      screen.getByText('Lucía Pérez no retiró insumos en ese período'),
    ).toBeInTheDocument()
  })
})
