import type { StockMovementKind, StockMovementLine } from '@/api/stock'
import { formatShortDate, formatTime } from '@/lib/format'
import { adjustmentReasonLabel } from '@/features/stock/schemas'

/**
 * Etiquetas en español de las enumeraciones de Insumos (`04_Modelo_de_Datos`
 * sección 3) y textos de una línea de movimiento.
 */

export const MOVEMENT_KIND_LABELS: Record<StockMovementKind, string> = {
  entry: 'Ingreso',
  return: 'Devolución',
  withdrawal: 'Retiro',
  adjustment: 'Ajuste',
  count: 'Control de stock',
  reversal: 'Anulación',
}

export const PRICE_SOURCE_LABELS: Record<string, string> = {
  create: 'Alta del artículo',
  manual: 'Cambio de precios',
  entry: 'Costo de un ingreso',
}

export function priceSourceLabel(source: string): string {
  return PRICE_SOURCE_LABELS[source] ?? source
}

/** Cantidad con signo explícito: `+12`, `−3` (con el signo menos tipográfico). */
export function formatSignedQty(value: number): string {
  const absolute = Math.abs(value).toLocaleString('es-AR', {
    maximumFractionDigits: 0,
  })
  if (value > 0) return `+${absolute}`
  if (value < 0) return `−${absolute}`
  return absolute
}

/** «jue 13 ago, 14:05» en hora de Argentina (ADR-019). */
export function formatDateTime(timestamp: string): string {
  return `${formatShortDate(timestamp)}, ${formatTime(timestamp)}`
}

/** Día de turno (`YYYY-MM-DD`) como «jue 13 ago», sin correr el día por la zona horaria. */
export function formatShiftDay(day: string): string {
  return formatShortDate(`${day}T12:00:00-03:00`)
}

/** «08:00 a 12:00». */
function formatShiftRange(line: StockMovementLine): string {
  const start = line.startTime?.slice(0, 5)
  const end = line.endTime?.slice(0, 5)
  if (start && end) return `${start} a ${end}`
  return start ?? ''
}

/** Turno o sede de un movimiento: «Cliente · Sede · jue 13 ago 08:00 a 12:00»; `null` si no tiene. */
export function describeMovementPlace(line: StockMovementLine): string | null {
  if (line.shiftId) {
    const parts = [
      line.clientName,
      line.siteName,
      [
        line.shiftDate ? formatShiftDay(line.shiftDate) : '',
        formatShiftRange(line),
      ]
        .filter(Boolean)
        .join(' '),
    ].filter((part): part is string => Boolean(part))
    return parts.join(' · ')
  }
  if (line.siteName) {
    return [line.clientName, line.siteName].filter(Boolean).join(' · ')
  }
  return null
}

/** Observación de un movimiento: motivo del ajuste, proveedor, comprobante y nota. */
export function describeMovementNote(line: StockMovementLine): string | null {
  const parts: string[] = []
  if (line.kind === 'adjustment' && line.reason) {
    parts.push(adjustmentReasonLabel(line.reason))
  }
  if (line.supplier) parts.push(`Proveedor: ${line.supplier}`)
  if (line.documentNumber) parts.push(`Comprobante: ${line.documentNumber}`)
  if (line.note) parts.push(line.note)
  return parts.length === 0 ? null : parts.join(' · ')
}

/** Quién: en un retiro, quien retira (y quien lo cargó si es otra persona). */
export function describeMovementPerson(line: StockMovementLine): string | null {
  if (line.kind === 'withdrawal' && line.personName) {
    return line.recordedByName && line.recordedByName !== line.personName
      ? `${line.personName} (lo cargó ${line.recordedByName})`
      : line.personName
  }
  return line.recordedByName
}
