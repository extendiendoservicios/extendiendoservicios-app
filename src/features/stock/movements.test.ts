import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOVEMENT_FILTERS,
  canVoidMovement,
  groupMovements,
  hasMovementFilters,
  toMovementFilters,
} from './movements'
import { testMovementLine } from './movementFixtures'

describe('groupMovements (IS-18)', () => {
  it('junta las líneas de un mismo movimiento y suma costo y venta con signo', () => {
    const groups = groupMovements([
      testMovementLine({
        movementId: 'm1',
        lineId: 'a',
        kind: 'withdrawal',
        qtyDelta: -2,
        lineCost: -200,
        lineSale: -300,
        personId: 'p1',
        personName: 'Lucía Pérez',
        shiftId: 't1',
        shiftDate: '2026-10-20',
        startTime: '08:00:00',
        endTime: '12:00:00',
        clientName: 'Banco Sur',
        siteName: 'Casa Central',
      }),
      testMovementLine({
        movementId: 'm1',
        lineId: 'b',
        kind: 'withdrawal',
        qtyDelta: -1,
        lineCost: -50.5,
        lineSale: -75.25,
      }),
      testMovementLine({ movementId: 'm2', lineId: 'c', kind: 'entry' }),
    ])
    expect(groups.map((group) => group.movementId)).toEqual(['m1', 'm2'])
    expect(groups[0]?.lines).toHaveLength(2)
    expect(groups[0]?.totalCost).toBe(-250.5)
    expect(groups[0]?.totalSale).toBe(-375.25)
    expect(groups[0]?.personName).toBe('Lucía Pérez')
    expect(groups[0]?.place).toBe(
      'Banco Sur · Casa Central · mar 20 oct 08:00 a 12:00',
    )
  })

  it('conserva la marca de anulación con quién y por qué', () => {
    const [group] = groupMovements([
      testMovementLine({
        voidedAt: '2026-10-21T10:00:00Z',
        voidedByName: 'Ana Gómez',
        voidReason: 'Se cargó dos veces',
      }),
    ])
    expect(group?.voidedAt).not.toBeNull()
    expect(group?.voidedByName).toBe('Ana Gómez')
    expect(group?.voidReason).toBe('Se cargó dos veces')
  })
})

describe('canVoidMovement: cuándo se ofrece «Anular» (IS-21, IS-27)', () => {
  const kinds = [
    'entry',
    'return',
    'withdrawal',
    'adjustment',
    'count',
    'reversal',
  ] as const

  it('con manage_stock, solo en ingresos, devoluciones y retiros no anulados', () => {
    const offered = kinds.filter((kind) =>
      canVoidMovement({ kind, voidedAt: null }, true),
    )
    expect(offered).toEqual(['entry', 'return', 'withdrawal'])
  })

  it('no se ofrece en un movimiento ya anulado', () => {
    expect(
      canVoidMovement(
        { kind: 'withdrawal', voidedAt: '2026-10-21T10:00:00Z' },
        true,
      ),
    ).toBe(false)
  })

  it('sin manage_stock no se ofrece en ningún tipo', () => {
    for (const kind of kinds) {
      expect(canVoidMovement({ kind, voidedAt: null }, false)).toBe(false)
    }
  })
})

describe('filtros de Movimientos (IS-18)', () => {
  it('por defecto no filtra nada', () => {
    expect(hasMovementFilters(DEFAULT_MOVEMENT_FILTERS)).toBe(false)
    expect(toMovementFilters(DEFAULT_MOVEMENT_FILTERS)).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
      kind: undefined,
      personId: undefined,
      supplyId: undefined,
      clientId: undefined,
      siteId: undefined,
    })
  })

  it('pasa cada filtro elegido al API y omite lo que vale «todos»', () => {
    const state = {
      dateFrom: '2026-10-01',
      dateTo: '2026-10-20',
      kind: 'withdrawal' as const,
      personId: 'p1',
      supplyId: 's1',
      clientId: 'c1',
      siteId: 'si1',
    }
    expect(hasMovementFilters(state)).toBe(true)
    expect(toMovementFilters(state)).toEqual(state)
    expect(
      toMovementFilters({ ...state, personId: 'all', siteId: 'all' }),
    ).toMatchObject({
      personId: undefined,
      siteId: undefined,
      clientId: 'c1',
    })
  })

  it('un solo filtro alcanza para que se muestre «Limpiar filtros»', () => {
    expect(
      hasMovementFilters({ ...DEFAULT_MOVEMENT_FILTERS, kind: 'entry' }),
    ).toBe(true)
    expect(
      hasMovementFilters({
        ...DEFAULT_MOVEMENT_FILTERS,
        dateFrom: '2026-10-01',
      }),
    ).toBe(true)
  })
})
