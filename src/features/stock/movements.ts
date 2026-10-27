import {
  VOIDABLE_KINDS,
  type StockMovementKind,
  type StockMovementLine,
} from '@/api/stock'
import { describeMovementNote, describeMovementPlace } from './labels'

/**
 * Lógica pura de la pestaña Movimientos (IS-18, IS-27): agrupa las líneas de
 * `v_stock_movements_admin` (una fila por línea) en movimientos, decide
 * cuándo se ofrece «Anular» y suma los precios guardados en cada línea.
 */

export interface MovementGroup {
  movementId: string
  kind: StockMovementKind
  recordedAt: string
  recordedByName: string | null
  /** Quien retira (solo en retiros y en su anulación). */
  personId: string | null
  personName: string | null
  /** «Cliente · Sede · jue 13 ago 08:00 a 12:00», o `null` si no tiene. */
  place: string | null
  /** Proveedor, comprobante, motivo del ajuste y nota, en una línea. */
  note: string | null
  supplier: string | null
  documentNumber: string | null
  /** Con valor = «Anulado». */
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  /** Es el contramovimiento de otro. */
  reversesId: string | null
  lines: StockMovementLine[]
  /** Suma de `line_cost` con signo (lo que entra es positivo). */
  totalCost: number
  /** Suma de `line_sale` con signo. */
  totalSale: number
}

/** Suma en centavos para no arrastrar decimales binarios. */
function sumMoney(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + Math.round(value * 100), 0) / 100
}

/**
 * Agrupa las líneas por movimiento conservando el orden en que llegan (las
 * más recientes primero). Las líneas de un mismo movimiento llegan juntas
 * porque la lectura ordena por `recorded_at` y `movement_id`.
 */
export function groupMovements(
  lines: readonly StockMovementLine[],
): MovementGroup[] {
  const groups = new Map<string, MovementGroup>()
  for (const line of lines) {
    const existing = groups.get(line.movementId)
    if (existing) {
      existing.lines.push(line)
      continue
    }
    groups.set(line.movementId, {
      movementId: line.movementId,
      kind: line.kind,
      recordedAt: line.recordedAt,
      recordedByName: line.recordedByName,
      personId: line.personId,
      personName: line.personName,
      place: describeMovementPlace(line),
      note: describeMovementNote(line),
      supplier: line.supplier,
      documentNumber: line.documentNumber,
      voidedAt: line.voidedAt,
      voidedByName: line.voidedByName,
      voidReason: line.voidReason,
      reversesId: line.reversesId,
      lines: [line],
      totalCost: 0,
      totalSale: 0,
    })
  }
  const result = Array.from(groups.values())
  for (const group of result) {
    group.totalCost = sumMoney(group.lines.map((line) => line.lineCost))
    group.totalSale = sumMoney(group.lines.map((line) => line.lineSale))
  }
  return result
}

/**
 * «Anular» se ofrece solo en ingresos, devoluciones y retiros que no están
 * anulados, y solo con `manage_stock` (IS-21, IS-27). Un ajuste, un control
 * o una anulación no se anulan: se corrigen con un ajuste.
 */
export function canVoidMovement(
  movement: Pick<MovementGroup, 'kind' | 'voidedAt'>,
  canManage: boolean,
): boolean {
  return (
    canManage &&
    movement.voidedAt == null &&
    VOIDABLE_KINDS.includes(movement.kind)
  )
}

/** Filtros de la pestaña, con `all` en lugar de vacío para los selectores. */
export interface MovementFiltersState {
  dateFrom: string
  dateTo: string
  kind: StockMovementKind | 'all'
  personId: string
  supplyId: string
  clientId: string
  siteId: string
}

export const DEFAULT_MOVEMENT_FILTERS: MovementFiltersState = {
  dateFrom: '',
  dateTo: '',
  kind: 'all',
  personId: 'all',
  supplyId: 'all',
  clientId: 'all',
  siteId: 'all',
}

/** Pasa el estado de los selectores a los filtros del API (lo que vale `all` se omite). */
export function toMovementFilters(state: MovementFiltersState) {
  return {
    dateFrom: state.dateFrom || undefined,
    dateTo: state.dateTo || undefined,
    kind: state.kind === 'all' ? undefined : state.kind,
    personId: state.personId === 'all' ? undefined : state.personId,
    supplyId: state.supplyId === 'all' ? undefined : state.supplyId,
    clientId: state.clientId === 'all' ? undefined : state.clientId,
    siteId: state.siteId === 'all' ? undefined : state.siteId,
  }
}

export function hasMovementFilters(state: MovementFiltersState): boolean {
  return (
    state.dateFrom !== '' ||
    state.dateTo !== '' ||
    state.kind !== 'all' ||
    state.personId !== 'all' ||
    state.supplyId !== 'all' ||
    state.clientId !== 'all' ||
    state.siteId !== 'all'
  )
}
