import type { ConsumptionRow, StockMovementLine } from '@/api/stock'
import { formatCalendarDate } from '@/lib/format'
import type { ExcelColumn } from './excel'
import {
  MOVEMENT_KIND_LABELS,
  describeMovementShift,
  formatDateTime,
} from './labels'
import { adjustmentReasonLabel } from './schemas'

/**
 * Columnas de los Excel de Insumos. Una fila por línea de movimiento (igual
 * que la vista) y por artículo en el consumo. Los pesos van como número con
 * formato de moneda, para que Excel pueda sumarlos.
 */

export const MOVEMENT_EXCEL_COLUMNS: ExcelColumn<StockMovementLine>[] = [
  {
    header: 'Fecha y hora',
    width: 20,
    value: (line) => formatDateTime(line.recordedAt),
  },
  {
    header: 'Tipo',
    width: 16,
    value: (line) => MOVEMENT_KIND_LABELS[line.kind],
  },
  {
    header: 'Estado',
    width: 10,
    value: (line) => (line.voidedAt ? 'Anulado' : ''),
  },
  {
    header: 'Motivo de la anulación',
    width: 28,
    value: (line) => line.voidReason ?? '',
  },
  {
    header: 'Anulado por',
    width: 22,
    value: (line) => (line.voidedAt ? (line.voidedByName ?? '') : ''),
  },
  { header: 'Persona', width: 22, value: (line) => line.personName ?? '' },
  {
    header: 'Registró',
    width: 22,
    value: (line) => line.recordedByName ?? '',
  },
  { header: 'Cliente', width: 24, value: (line) => line.clientName ?? '' },
  { header: 'Sede', width: 24, value: (line) => line.siteName ?? '' },
  {
    header: 'Turno',
    width: 26,
    value: (line) => describeMovementShift(line) ?? '',
  },
  { header: 'Proveedor', width: 22, value: (line) => line.supplier ?? '' },
  {
    header: 'Comprobante',
    width: 18,
    value: (line) => line.documentNumber ?? '',
  },
  {
    header: 'Motivo del ajuste',
    width: 18,
    value: (line) =>
      line.kind === 'adjustment' ? adjustmentReasonLabel(line.reason) : '',
  },
  { header: 'Observación', width: 32, value: (line) => line.note ?? '' },
  { header: 'Código', width: 12, value: (line) => line.supplyCode },
  { header: 'Artículo', width: 28, value: (line) => line.supplyName },
  {
    header: 'Presentación',
    width: 16,
    value: (line) => line.supplyPresentation ?? '',
  },
  {
    header: 'Cantidad',
    width: 10,
    format: 'integer',
    value: (line) => line.qtyDelta,
  },
  {
    header: 'Costo unitario',
    width: 14,
    format: 'money',
    value: (line) => line.unitCost,
  },
  {
    header: 'Venta unitaria',
    width: 14,
    format: 'money',
    value: (line) => line.unitSale,
  },
  {
    header: 'Costo total',
    width: 14,
    format: 'money',
    value: (line) => line.lineCost,
  },
  {
    header: 'Venta total',
    width: 14,
    format: 'money',
    value: (line) => line.lineSale,
  },
  {
    header: 'Stock resultante',
    width: 12,
    format: 'integer',
    value: (line) => line.stockAfter,
  },
]

export const CONSUMPTION_EXCEL_COLUMNS: ExcelColumn<ConsumptionRow>[] = [
  { header: 'Día', width: 14, value: (row) => formatCalendarDate(row.day) },
  { header: 'Cliente', width: 26, value: (row) => row.clientName },
  { header: 'Sede', width: 26, value: (row) => row.siteName },
  { header: 'Código', width: 12, value: (row) => row.supplyCode },
  { header: 'Artículo', width: 28, value: (row) => row.supplyName },
  {
    header: 'Presentación',
    width: 16,
    value: (row) => row.supplyPresentation ?? '',
  },
  { header: 'Cantidad', width: 10, format: 'integer', value: (row) => row.qty },
  {
    header: 'Costo',
    width: 14,
    format: 'money',
    value: (row) => row.costTotal,
  },
  {
    header: 'Venta',
    width: 14,
    format: 'money',
    value: (row) => row.saleTotal,
  },
]

/** `2026-10-26` -> parte de nombre de archivo. */
export function excelFileName(prefix: string, isoDay: string): string {
  return `${prefix}-${isoDay}`
}
