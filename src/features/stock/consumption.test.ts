import { describe, expect, it } from 'vitest'
import type { ConsumptionRow } from '@/api/stock'
import { buildConsumptionReport, monthPeriod } from './consumption'

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

describe('buildConsumptionReport (IS-24)', () => {
  it('suma a costo y a venta por cliente, por sede y por artículo', () => {
    const report = buildConsumptionReport([
      row(),
      row({ day: '2026-10-06', qty: 1, costTotal: 100.1, saleTotal: 150.2 }),
      row({
        supplyId: 's2',
        supplyCode: 'DES-001',
        supplyName: 'Bolsas',
        supplyPresentation: null,
        qty: 10,
        costTotal: 500,
        saleTotal: 800,
      }),
      row({
        siteId: 'si2',
        siteName: 'Sucursal Norte',
        qty: 3,
        costTotal: 30,
        saleTotal: 45,
      }),
      row({
        clientId: 'c2',
        clientName: 'Colegio Mayor',
        siteId: 'si3',
        siteName: 'Sede única',
        qty: 4,
        costTotal: 40,
        saleTotal: 60,
      }),
    ])

    expect(report.total).toEqual({ qty: 20, cost: 870.1, sale: 1355.2 })
    expect(report.clients.map((client) => client.clientName)).toEqual([
      'Banco Sur',
      'Colegio Mayor',
    ])

    const banco = report.clients[0]
    expect(banco).toMatchObject({ qty: 16, cost: 830.1, sale: 1295.2 })
    expect(banco?.sites.map((site) => site.siteName)).toEqual([
      'Casa Central',
      'Sucursal Norte',
    ])
    const central = banco?.sites[0]
    expect(central).toMatchObject({ qty: 13, cost: 800.1, sale: 1250.2 })
    // El mismo artículo en dos días se junta en una fila de detalle.
    expect(central?.supplies.map((supply) => supply.name)).toEqual([
      'Bolsas',
      'Lavandina',
    ])
    expect(central?.supplies[1]).toMatchObject({
      qty: 3,
      cost: 300.1,
      sale: 450.2,
    })
  })

  it('no arrastra decimales binarios al sumar centavos', () => {
    const report = buildConsumptionReport([
      row({ costTotal: 0.1, saleTotal: 0.1 }),
      row({ costTotal: 0.2, saleTotal: 0.2 }),
    ])
    expect(report.total.cost).toBe(0.3)
    expect(report.total.sale).toBe(0.3)
  })

  it('sin filas, el informe está vacío', () => {
    expect(buildConsumptionReport([])).toEqual({
      total: { qty: 0, cost: 0, sale: 0 },
      clients: [],
    })
  })
})

describe('monthPeriod: el período por defecto (IS-24)', () => {
  it('el mes en curso va del 1 hasta hoy', () => {
    expect(monthPeriod('2026-10-26', 0)).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-26',
    })
  })

  it('el mes anterior va completo', () => {
    expect(monthPeriod('2026-10-26', -1)).toEqual({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    })
    expect(monthPeriod('2026-03-05', -1)).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
    })
  })

  it('en enero, el mes anterior es diciembre del año anterior', () => {
    expect(monthPeriod('2027-01-10', -1)).toEqual({
      dateFrom: '2026-12-01',
      dateTo: '2026-12-31',
    })
  })
})
