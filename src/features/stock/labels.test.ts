import { describe, expect, it } from 'vitest'
import type { StockMovementLine } from '@/api/stock'
import {
  describeMovementNote,
  describeMovementPerson,
  describeMovementPlace,
  formatDateTime,
  formatShiftDay,
  formatSignedQty,
  MOVEMENT_KIND_LABELS,
  priceSourceLabel,
} from './labels'

function line(overrides: Partial<StockMovementLine> = {}): StockMovementLine {
  return {
    movementId: 'm1',
    lineId: 'l1',
    kind: 'withdrawal',
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
    qtyDelta: -1,
    unitCost: 0,
    unitSale: 0,
    lineCost: 0,
    lineSale: 0,
    stockAfter: 0,
    ...overrides,
  }
}

describe('etiquetas', () => {
  it('cada tipo de movimiento tiene su etiqueta en español', () => {
    expect(MOVEMENT_KIND_LABELS).toEqual({
      entry: 'Ingreso',
      return: 'Devolución',
      withdrawal: 'Retiro',
      adjustment: 'Ajuste',
      count: 'Control de stock',
      reversal: 'Anulación',
    })
  })

  it('el origen de un cambio de precio', () => {
    expect(priceSourceLabel('create')).toBe('Alta del artículo')
    expect(priceSourceLabel('manual')).toBe('Cambio de precios')
    expect(priceSourceLabel('entry')).toBe('Costo de un ingreso')
    expect(priceSourceLabel('otro')).toBe('otro')
  })
})

describe('formatSignedQty', () => {
  it('lleva el signo explícito', () => {
    expect(formatSignedQty(12)).toBe('+12')
    expect(formatSignedQty(-3)).toBe('−3')
    expect(formatSignedQty(0)).toBe('0')
    expect(formatSignedQty(1500)).toBe('+1.500')
  })
})

describe('fechas en hora de Argentina (ADR-019)', () => {
  it('formatDateTime pasa el instante UTC a hora argentina', () => {
    // 15:05 UTC = 12:05 en Buenos Aires.
    expect(formatDateTime('2026-10-20T15:05:00Z')).toBe('mar 20 oct, 12:05')
  })

  it('un movimiento de madrugada UTC cae el día anterior en Argentina', () => {
    expect(formatDateTime('2026-10-21T01:30:00Z')).toBe('mar 20 oct, 22:30')
  })

  it('formatShiftDay no corre el día', () => {
    expect(formatShiftDay('2026-10-13')).toBe('mar 13 oct')
  })
})

describe('describeMovement*', () => {
  it('turno: cliente, sede, día y horario', () => {
    expect(
      describeMovementPlace(
        line({
          shiftId: 'sh1',
          clientName: 'Limpia Ya',
          siteName: 'Sede Centro',
          shiftDate: '2026-10-13',
          startTime: '08:00:00',
          endTime: '12:00:00',
        }),
      ),
    ).toBe('Limpia Ya · Sede Centro · mar 13 oct 08:00 a 12:00')
  })

  it('sin turno, solo la sede; sin nada, null', () => {
    expect(
      describeMovementPlace(
        line({ clientName: 'Limpia Ya', siteName: 'Sede' }),
      ),
    ).toBe('Limpia Ya · Sede')
    expect(describeMovementPlace(line())).toBeNull()
  })

  it('observación de un ajuste: motivo y nota; de un ingreso: proveedor y comprobante', () => {
    expect(
      describeMovementNote(
        line({ kind: 'adjustment', reason: 'breakage', note: 'Se cayó' }),
      ),
    ).toBe('Rotura · Se cayó')
    expect(
      describeMovementNote(
        line({
          kind: 'entry',
          supplier: 'Distribuidora Sur',
          documentNumber: 'R-0001',
        }),
      ),
    ).toBe('Proveedor: Distribuidora Sur · Comprobante: R-0001')
    expect(describeMovementNote(line())).toBeNull()
  })

  it('persona de un retiro cargado por otra persona', () => {
    expect(
      describeMovementPerson(
        line({ personName: 'Luis Pérez', recordedByName: 'Ana Gómez' }),
      ),
    ).toBe('Luis Pérez (lo cargó Ana Gómez)')
    expect(
      describeMovementPerson(
        line({ personName: 'Luis Pérez', recordedByName: 'Luis Pérez' }),
      ),
    ).toBe('Luis Pérez')
    expect(
      describeMovementPerson(line({ kind: 'entry', personName: null })),
    ).toBe('Ana Gómez')
  })
})
