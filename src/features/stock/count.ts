import { z } from 'zod'
import { tz } from '@date-fns/tz'
import { format } from 'date-fns'
import type { StockCountInput, StockItem, StockMovementLine } from '@/api/stock'
import { BUENOS_AIRES_TIME_ZONE } from '@/lib/format'
import { parseWholeNumber } from './money'

/**
 * Lógica pura de «Cargar control» (IS-16, IS-31): fecha y hora del conteo en
 * hora de Argentina, revisor (persona de la app **o** nombre escrito), filas
 * en blanco que no se tocan y el aviso de los movimientos posteriores a la
 * hora del control. El servidor vuelve a validar todo (`register_stock_count`).
 */

/** Fecha (`YYYY-MM-DD`) y hora (`HH:mm`) de un instante, en hora de Argentina (ADR-019). */
export function nowInArgentina(now: Date): { date: string; time: string } {
  const context = { in: tz(BUENOS_AIRES_TIME_ZONE) }
  return {
    date: format(now, 'yyyy-MM-dd', context),
    time: format(now, 'HH:mm', context),
  }
}

/** Fecha y hora escritas (siempre de Argentina, UTC-3 fijo) como instante ISO. */
export function argentinaDateTimeToIso(date: string, time: string): string {
  return `${date}T${time}:00-03:00`
}

export type ReviewerKind = 'person' | 'name'

export const REVIEWER_NAME_MAX = 120
export const COUNT_NOTES_MAX = 500

/**
 * Encabezado del control. `now` se inyecta para poder probar «no futura».
 * El revisor es uno solo: una persona de la app o un nombre escrito.
 */
export function buildCountHeaderSchema(now: Date) {
  return z
    .object({
      date: z.string().min(1, 'Indicá el día del control.'),
      time: z.string().min(1, 'Indicá la hora del control.'),
      reviewerKind: z.enum(['person', 'name']),
      reviewerId: z.string(),
      reviewerName: z
        .string()
        .trim()
        .max(REVIEWER_NAME_MAX, `Hasta ${REVIEWER_NAME_MAX} caracteres.`),
      notes: z
        .string()
        .trim()
        .max(COUNT_NOTES_MAX, `Hasta ${COUNT_NOTES_MAX} caracteres.`),
    })
    .superRefine((values, ctx) => {
      if (values.date !== '' && values.time !== '') {
        const at = new Date(argentinaDateTimeToIso(values.date, values.time))
        if (Number.isNaN(at.getTime())) {
          ctx.addIssue({
            code: 'custom',
            path: ['date'],
            message: 'La fecha o la hora no son válidas.',
          })
        } else if (at.getTime() > now.getTime()) {
          ctx.addIssue({
            code: 'custom',
            path: ['date'],
            message: 'La fecha y la hora del control no pueden ser futuras.',
          })
        }
      }
      if (values.reviewerKind === 'person' && values.reviewerId === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['reviewerId'],
          message: 'Elegí la persona que revisó.',
        })
      }
      if (values.reviewerKind === 'name' && values.reviewerName === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['reviewerName'],
          message: 'Escribí el nombre de quien revisó.',
        })
      }
    })
}

export type CountHeaderValues = z.infer<
  ReturnType<typeof buildCountHeaderSchema>
>

export interface CountLinesResult {
  /** Filas contadas (las en blanco no están). */
  lines: Array<{ supplyId: string; countedQty: number }>
  /** Mensaje por artículo con un valor que no es un entero de cero en adelante. */
  errors: Map<string, string>
}

/**
 * De lo escrito en cada fila («Contado»), solo se mandan las que tienen un
 * valor: en blanco significa «no tocar». Cero es un conteo válido (no hay
 * nada). Lo que no es un entero de cero en adelante queda como error de esa
 * fila y no se manda.
 */
export function buildCountLines(
  counted: Readonly<Record<string, string>>,
): CountLinesResult {
  const lines: CountLinesResult['lines'] = []
  const errors = new Map<string, string>()
  for (const [supplyId, text] of Object.entries(counted)) {
    const trimmed = text.trim()
    if (trimmed === '') continue
    const value = parseWholeNumber(trimmed)
    if (value === null) {
      errors.set(supplyId, 'Tiene que ser un número entero, cero o mayor.')
      continue
    }
    lines.push({ supplyId, countedQty: value })
  }
  return { lines, errors }
}

/** Arma el `StockCountInput`: el revisor va como persona **o** como nombre, nunca los dos. */
export function buildCountInput(
  header: CountHeaderValues,
  lines: CountLinesResult['lines'],
): StockCountInput {
  return {
    countedAt: argentinaDateTimeToIso(header.date, header.time),
    reviewerId: header.reviewerKind === 'person' ? header.reviewerId : null,
    reviewerName:
      header.reviewerKind === 'name' ? header.reviewerName.trim() : null,
    notes: header.notes.trim() || null,
    lines,
  }
}

export interface LaterMovements {
  /** Cantidad de movimientos del artículo después de la hora del control. */
  count: number
  /** Suma con signo de lo que movieron: el stock a esa hora es el actual menos esto. */
  netDelta: number
}

/**
 * Movimientos de cada artículo posteriores a la hora del control (IS-31): el
 * servidor calcula la diferencia contra el stock a esa hora, es decir, el
 * actual menos estos. Cuenta movimientos (no líneas) y toma todos los tipos,
 * también las anulaciones, igual que el servidor.
 */
export function laterMovementsBySupply(
  lines: readonly StockMovementLine[],
  countedAtIso: string,
): Map<string, LaterMovements> {
  const limit = new Date(countedAtIso).getTime()
  const seen = new Map<string, Set<string>>()
  const result = new Map<string, LaterMovements>()
  for (const line of lines) {
    if (new Date(line.recordedAt).getTime() <= limit) continue
    const movements = seen.get(line.supplyId) ?? new Set<string>()
    movements.add(line.movementId)
    seen.set(line.supplyId, movements)
    result.set(line.supplyId, {
      count: movements.size,
      netDelta: (result.get(line.supplyId)?.netDelta ?? 0) + line.qtyDelta,
    })
  }
  return result
}

/** «Tuvo 2 movimientos después de esa hora; se tienen en cuenta.» */
export function describeLaterMovements(count: number): string {
  return count === 1
    ? 'Tuvo 1 movimiento después de esa hora; se tiene en cuenta.'
    : `Tuvo ${count} movimientos después de esa hora; se tienen en cuenta.`
}

/** Stock del sistema a la hora del control: el actual menos lo movido después. */
export function systemQtyAt(
  item: Pick<StockItem, 'stockQty'>,
  later: LaterMovements | undefined,
): number {
  return item.stockQty - (later?.netDelta ?? 0)
}

/**
 * Si el control es de un momento anterior, hay que mirar los movimientos
 * desde esa hora. Un margen de un minuto evita consultar por el «ahora» que
 * ya viene por defecto en el formulario.
 */
export function isRetroactive(countedAtIso: string, now: Date): boolean {
  return now.getTime() - new Date(countedAtIso).getTime() > 60_000
}
