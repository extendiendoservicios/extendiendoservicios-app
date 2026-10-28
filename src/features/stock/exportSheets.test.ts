import { describe, expect, it } from 'vitest'
import { buildSheetMatrix, safeSheetName } from './excel'
import {
  CONSUMPTION_EXCEL_COLUMNS,
  MOVEMENT_EXCEL_COLUMNS,
  excelFileName,
} from './exportSheets'
import { testMovementLine } from './movementFixtures'

describe('Excel de Movimientos (IS-18)', () => {
  const header = MOVEMENT_EXCEL_COLUMNS.map((column) => column.header)

  it('trae las columnas pedidas, con precios y anulación', () => {
    for (const expected of [
      'Fecha y hora',
      'Tipo',
      'Estado',
      'Motivo de la anulación',
      'Persona',
      'Registró',
      'Cliente',
      'Sede',
      'Turno',
      'Proveedor',
      'Comprobante',
      'Observación',
      'Código',
      'Artículo',
      'Cantidad',
      'Costo unitario',
      'Venta unitaria',
      'Costo total',
      'Venta total',
      'Stock resultante',
    ]) {
      expect(header).toContain(expected)
    }
  })

  it('arma una fila por línea, con la fecha argentina, números reales y la marca «Anulado»', () => {
    const matrix = buildSheetMatrix({
      sheetName: 'Movimientos',
      columns: MOVEMENT_EXCEL_COLUMNS,
      rows: [
        testMovementLine({
          kind: 'withdrawal',
          qtyDelta: -2,
          lineCost: -200,
          lineSale: -300,
          personName: 'Lucía Pérez',
          shiftId: 't1',
          shiftDate: '2026-10-20',
          startTime: '08:00:00',
          endTime: '12:00:00',
          clientName: 'Banco Sur',
          siteName: 'Casa Central',
          voidedAt: '2026-10-21T10:00:00Z',
          voidedByName: 'Ana Gómez',
          voidReason: 'Se cargó dos veces',
        }),
      ],
    })
    expect(matrix).toHaveLength(2)
    const [headers, row] = matrix as [string[], Array<string | number | null>]
    const cell = (name: string) => row[headers.indexOf(name)]
    expect(cell('Fecha y hora')).toBe('mar 20 oct, 12:05')
    expect(cell('Tipo')).toBe('Retiro')
    expect(cell('Estado')).toBe('Anulado')
    expect(cell('Motivo de la anulación')).toBe('Se cargó dos veces')
    expect(cell('Persona')).toBe('Lucía Pérez')
    expect(cell('Turno')).toBe('mar 20 oct 08:00 a 12:00')
    expect(cell('Cantidad')).toBe(-2)
    expect(cell('Costo total')).toBe(-200)
    expect(cell('Venta total')).toBe(-300)
    expect(typeof cell('Costo unitario')).toBe('number')
  })

  it('un movimiento sin anular deja el estado y el motivo en blanco', () => {
    const [headers, row] = buildSheetMatrix({
      sheetName: 'Movimientos',
      columns: MOVEMENT_EXCEL_COLUMNS,
      rows: [testMovementLine()],
    }) as [string[], Array<string | number | null>]
    expect(row[headers.indexOf('Estado')]).toBe('')
    expect(row[headers.indexOf('Motivo de la anulación')]).toBe('')
  })
})

describe('Excel de Consumo por cliente (IS-24)', () => {
  it('una fila por día, sede y artículo, con costo y venta como número', () => {
    const [headers, row] = buildSheetMatrix({
      sheetName: 'Consumo',
      columns: CONSUMPTION_EXCEL_COLUMNS,
      rows: [
        {
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
        },
      ],
    }) as [string[], Array<string | number | null>]
    expect(headers).toEqual([
      'Día',
      'Cliente',
      'Sede',
      'Código',
      'Artículo',
      'Presentación',
      'Cantidad',
      'Costo',
      'Venta',
    ])
    expect(row).toEqual([
      '5 oct 2026',
      'Banco Sur',
      'Casa Central',
      'QUI-001',
      'Lavandina',
      '1 L',
      2,
      200,
      300,
    ])
  })
})

describe('utilidades del Excel', () => {
  it('el nombre de la hoja no lleva caracteres prohibidos ni pasa de 31', () => {
    expect(safeSheetName('Consumo [por] cliente/sede?')).toBe(
      'Consumo  por  cliente sede ',
    )
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31)
    expect(safeSheetName('')).toBe('Hoja')
  })

  it('el nombre del archivo lleva el prefijo y el día', () => {
    expect(excelFileName('movimientos-insumos', '2026-10-26')).toBe(
      'movimientos-insumos-2026-10-26',
    )
  })
})
