import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadExcel, type ExcelColumn } from './excel'

interface Row {
  name: string
  qty: number
  cost: number
}

const COLUMNS: ExcelColumn<Row>[] = [
  { header: 'Artículo', width: 20, value: (row) => row.name },
  { header: 'Cantidad', width: 10, format: 'integer', value: (row) => row.qty },
  { header: 'Costo', width: 12, format: 'money', value: (row) => row.cost },
]

describe('downloadExcel: «Exportar a Excel» (IS-18, IS-24)', () => {
  let createdBlob: Blob | null = null
  let clickedDownloadName: string | null = null

  beforeEach(() => {
    createdBlob = null
    clickedDownloadName = null
    URL.createObjectURL = vi.fn((blob: Blob) => {
      createdBlob = blob
      return 'blob:prueba'
    })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clickedDownloadName = this.download
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('baja un .xlsx con el encabezado, las filas como número y el formato de pesos', async () => {
    await downloadExcel('movimientos-insumos-2026-10-26', {
      sheetName: 'Movimientos',
      columns: COLUMNS,
      rows: [
        { name: 'Lavandina · 1 L', qty: -2, cost: 1250.5 },
        { name: 'Bolsas', qty: 10, cost: 80 },
      ],
    })

    expect(clickedDownloadName).toBe('movimientos-insumos-2026-10-26.xlsx')
    expect(createdBlob).not.toBeNull()
    expect(createdBlob?.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )

    // Se abre de nuevo con ExcelJS para ver lo que realmente quedó en el archivo.
    const exceljs = await import('exceljs')
    const workbook = new (exceljs.default ?? exceljs).Workbook()
    await workbook.xlsx.load(await (createdBlob as Blob).arrayBuffer())
    const sheet = workbook.getWorksheet('Movimientos')
    expect(sheet).toBeDefined()
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      'Artículo',
      'Cantidad',
      'Costo',
    ])
    expect(sheet?.getRow(2).getCell(1).value).toBe('Lavandina · 1 L')
    expect(sheet?.getRow(2).getCell(2).value).toBe(-2)
    expect(sheet?.getRow(2).getCell(3).value).toBe(1250.5)
    expect(sheet?.getRow(2).getCell(3).numFmt).toBe('"$" #,##0.00')
    expect(sheet?.rowCount).toBe(3)
  })
})
