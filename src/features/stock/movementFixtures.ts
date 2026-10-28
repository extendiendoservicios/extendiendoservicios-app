import type { ShortageReport, StockMovementLine } from '@/api/stock'

/** Apoyo de los tests de Movimientos, Faltantes y fichas: una línea y un aviso de prueba. */
export function testMovementLine(
  overrides: Partial<StockMovementLine> = {},
): StockMovementLine {
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
    supplyPresentation: '1 L',
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

export function testShortage(
  overrides: Partial<ShortageReport> = {},
): ShortageReport {
  return {
    id: 'r1',
    status: 'open',
    createdAt: '2026-10-25T13:00:00Z',
    reportedByName: 'Lucía Pérez',
    supplyId: 's1',
    supplyCode: 'QUI-001',
    supplyName: 'Lavandina',
    supplyPresentation: '1 L',
    description: null,
    shiftId: null,
    shiftDate: null,
    startTime: null,
    endTime: null,
    clientName: null,
    siteName: null,
    comment: null,
    resolvedAt: null,
    resolvedByName: null,
    resolutionNote: null,
    ...overrides,
  }
}
