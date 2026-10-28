/**
 * Exportar a Excel de Insumos (IS-18, IS-24): arma un libro con una hoja y lo
 * baja como archivo. ExcelJS es pesado (~950 kB): se carga recién al tocar
 * «Exportar a Excel» (`import()` dinámico, chunk `vendor-excel`, fuera del
 * precache de la PWA) y nunca viaja con la pantalla.
 */

export type ExcelFormat = 'text' | 'integer' | 'money'

export interface ExcelColumn<Row> {
  header: string
  /** Ancho en caracteres. */
  width: number
  format?: ExcelFormat
  value: (row: Row) => string | number | null
}

export interface ExcelSheetSpec<Row> {
  /** Nombre de la hoja (hasta 31 caracteres, sin `\ / ? * [ ]`). */
  sheetName: string
  columns: ExcelColumn<Row>[]
  rows: readonly Row[]
}

const NUMBER_FORMATS: Record<ExcelFormat, string | undefined> = {
  text: undefined,
  integer: '#,##0',
  money: '"$" #,##0.00',
}

/** Nombre de hoja válido para Excel: sin caracteres prohibidos y hasta 31. */
export function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja'
}

/** Matriz de celdas (encabezado y filas) que se escribe en la hoja; separada para poder probarla. */
export function buildSheetMatrix<Row>(
  spec: ExcelSheetSpec<Row>,
): Array<Array<string | number | null>> {
  return [
    spec.columns.map((column) => column.header),
    ...spec.rows.map((row) => spec.columns.map((column) => column.value(row))),
  ]
}

/** Arma el archivo `.xlsx` y lo descarga. `fileName` sin extensión. */
export async function downloadExcel<Row>(
  fileName: string,
  spec: ExcelSheetSpec<Row>,
): Promise<void> {
  const exceljs = await import('exceljs')
  const Workbook = (exceljs.default ?? exceljs).Workbook
  const workbook = new Workbook()
  const sheet = workbook.addWorksheet(safeSheetName(spec.sheetName))
  sheet.columns = spec.columns.map((column) => ({
    header: column.header,
    width: column.width,
    style: {
      numFmt: NUMBER_FORMATS[column.format ?? 'text'],
    },
  }))
  const matrix = buildSheetMatrix(spec)
  for (const row of matrix.slice(1)) sheet.addRow(row)
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.alignment = { vertical: 'middle', wrapText: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  if (spec.columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: spec.columns.length },
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileName}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
