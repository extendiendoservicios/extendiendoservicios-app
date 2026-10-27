import { z } from 'zod'
import type {
  StockAdjustmentReason,
  StockEntryInput,
  StockItem,
  SupplyInput,
} from '@/api/stock'
import { parseMoney, parseWholeNumber } from './money'

/**
 * Esquemas zod de Insumos (P25.2). Repiten las restricciones del servidor
 * (`upsert_supply`, `set_supply_prices`, `register_stock_entry`,
 * `adjust_stock`, `upsert_supply_category`); no las reemplazan: el servidor
 * vuelve a validar todo. Los campos numéricos viajan como texto (como en el
 * resto de los formularios) y se pasan a número con los `*ToInput`.
 */

// -------------------------------------------------------------------------
// Piezas comunes
// -------------------------------------------------------------------------

const optionalText = z.string().trim()

/** Precio: obligatorio, mayor o igual a cero, hasta dos decimales (IS-34). */
const priceField = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Indicá el precio de ${what}.`)
    .refine(
      (value) => value === '' || parseMoney(value) !== null,
      'Escribí un monto válido, con hasta dos decimales (por ejemplo 1.250,50).',
    )

/** Cantidad entera mayor a cero, como texto. */
const positiveQtyField = z
  .string()
  .trim()
  .min(1, 'Indicá la cantidad.')
  .refine(
    (value) => value === '' || parseWholeNumber(value) !== null,
    'La cantidad tiene que ser un número entero.',
  )
  .refine(
    (value) => parseWholeNumber(value) === null || Number(value) > 0,
    'La cantidad tiene que ser mayor a cero.',
  )

// -------------------------------------------------------------------------
// Artículo (alta y edición)
// -------------------------------------------------------------------------

export const SUPPLY_CODE_MAX = 40
export const SUPPLY_NAME_MAX = 120
export const SUPPLY_PRESENTATION_MAX = 80
export const SUPPLY_NOTES_MAX = 500

const supplyBaseShape = {
  code: z
    .string()
    .trim()
    .min(1, 'Indicá el código interno.')
    .max(SUPPLY_CODE_MAX, `Hasta ${SUPPLY_CODE_MAX} caracteres.`),
  name: z
    .string()
    .trim()
    .min(1, 'Indicá el nombre del artículo.')
    .max(SUPPLY_NAME_MAX, `Hasta ${SUPPLY_NAME_MAX} caracteres.`),
  presentation: optionalText.max(
    SUPPLY_PRESENTATION_MAX,
    `Hasta ${SUPPLY_PRESENTATION_MAX} caracteres.`,
  ),
  categoryId: z.string().min(1, 'Elegí una categoría.'),
  /** Vacío = sin aviso de mínimo (IS-05). */
  minQty: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || parseWholeNumber(value) !== null,
      'El mínimo tiene que ser un número entero, cero o mayor.',
    ),
  notes: optionalText.max(
    SUPPLY_NOTES_MAX,
    `Hasta ${SUPPLY_NOTES_MAX} caracteres.`,
  ),
}

/** Alta: lleva los precios (en la edición se cambian con su propio diálogo). */
export const supplyCreateSchema = z.object({
  ...supplyBaseShape,
  costPrice: priceField('costo'),
  salePrice: priceField('venta'),
})

export const supplyEditSchema = z.object(supplyBaseShape)

export type SupplyCreateFormValues = z.infer<typeof supplyCreateSchema>
export type SupplyEditFormValues = z.infer<typeof supplyEditSchema>
export type SupplyFormValues = SupplyCreateFormValues | SupplyEditFormValues

/** Pasa los valores del formulario al `SupplyInput` del API (`id` solo en la edición). */
export function supplyValuesToInput(
  values: SupplyFormValues,
  id?: string,
): SupplyInput {
  const costPrice =
    'costPrice' in values ? (parseMoney(values.costPrice) ?? 0) : undefined
  const salePrice =
    'salePrice' in values ? (parseMoney(values.salePrice) ?? 0) : undefined
  return {
    id,
    code: values.code.trim(),
    name: values.name.trim(),
    presentation: values.presentation.trim() || null,
    categoryId: values.categoryId,
    minQty: values.minQty.trim() === '' ? null : Number(values.minQty),
    costPrice,
    salePrice,
    notes: values.notes.trim() || null,
  }
}

export function supplyToFormValues(item: StockItem): SupplyEditFormValues {
  return {
    code: item.code,
    name: item.name,
    presentation: item.presentation ?? '',
    categoryId: item.categoryId,
    minQty: item.minQty == null ? '' : String(item.minQty),
    notes: item.notes ?? '',
  }
}

// -------------------------------------------------------------------------
// Cambiar precios (`set_supply_prices`)
// -------------------------------------------------------------------------

export const supplyPricesSchema = z.object({
  costPrice: priceField('costo'),
  salePrice: priceField('venta'),
})

export type SupplyPricesFormValues = z.infer<typeof supplyPricesSchema>

export function pricesValuesToInput(values: SupplyPricesFormValues): {
  costPrice: number
  salePrice: number
} {
  return {
    costPrice: parseMoney(values.costPrice) ?? 0,
    salePrice: parseMoney(values.salePrice) ?? 0,
  }
}

// -------------------------------------------------------------------------
// Ajustar (`adjust_stock`, IS-10)
// -------------------------------------------------------------------------

export const ADJUSTMENT_REASONS: ReadonlyArray<{
  value: StockAdjustmentReason
  label: string
}> = [
  { value: 'count', label: 'Control de stock' },
  { value: 'breakage', label: 'Rotura' },
  { value: 'expired', label: 'Vencimiento' },
  { value: 'data_error', label: 'Error de carga' },
  { value: 'other', label: 'Otro' },
]

export function adjustmentReasonLabel(
  reason: StockAdjustmentReason | null,
): string {
  return ADJUSTMENT_REASONS.find((item) => item.value === reason)?.label ?? ''
}

/**
 * Esquema del ajuste. `currentStock` evita pedir de antemano un `−` mayor al
 * stock (el servidor lo corta igual con `INSUFFICIENT_STOCK`).
 */
export function buildAdjustSchema(currentStock: number) {
  return z
    .object({
      sign: z.enum(['+', '-']),
      qty: positiveQtyField,
      reason: z.enum(['count', 'breakage', 'expired', 'data_error', 'other'], {
        message: 'Elegí el motivo del ajuste.',
      }),
      note: optionalText.max(500, 'Hasta 500 caracteres.'),
    })
    .superRefine((values, ctx) => {
      if (values.reason === 'other' && values.note === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['note'],
          message: 'Con el motivo «Otro» tenés que escribir una observación.',
        })
      }
      const qty = parseWholeNumber(values.qty)
      if (values.sign === '-' && qty !== null && qty > currentStock) {
        ctx.addIssue({
          code: 'custom',
          path: ['qty'],
          message: `No podés restar más de lo que hay (${currentStock}).`,
        })
      }
    })
}

export type AdjustFormValues = z.infer<ReturnType<typeof buildAdjustSchema>>

/** Delta con signo para `adjust_stock`. */
export function adjustValuesToDelta(values: AdjustFormValues): number {
  const qty = parseWholeNumber(values.qty) ?? 0
  return values.sign === '-' ? -qty : qty
}

// -------------------------------------------------------------------------
// Ingreso o devolución (`register_stock_entry`, IS-09, IS-23)
// -------------------------------------------------------------------------

export const ENTRY_KINDS = [
  { value: 'entry', label: 'Ingreso' },
  { value: 'return', label: 'Devolución' },
] as const

export const entryLineSchema = z.object({
  supplyId: z.string().min(1),
  qty: positiveQtyField,
  /** Vacío = sin costo cargado. */
  unitCost: z
    .string()
    .trim()
    .refine(
      (value) => value === '' || parseMoney(value) !== null,
      'Escribí un monto válido, con hasta dos decimales.',
    ),
})

export const entrySchema = z
  .object({
    kind: z.enum(['entry', 'return']),
    lines: z.array(entryLineSchema).min(1, 'Agregá al menos un artículo.'),
    supplier: optionalText.max(120, 'Hasta 120 caracteres.'),
    documentNumber: optionalText.max(60, 'Hasta 60 caracteres.'),
    note: optionalText.max(500, 'Hasta 500 caracteres.'),
  })
  .superRefine((values, ctx) => {
    const seen = new Set<string>()
    values.lines.forEach((line, index) => {
      if (seen.has(line.supplyId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'supplyId'],
          message: 'Un artículo no puede repetirse en el mismo movimiento.',
        })
      }
      seen.add(line.supplyId)
    })
  })

export type EntryFormValues = z.infer<typeof entrySchema>
export type EntryLineValues = z.infer<typeof entryLineSchema>

/** Una línea cuyo costo cargado difiere del costo vigente (pregunta de IS-23). */
export interface CostDifference {
  supplyId: string
  code: string
  name: string
  presentation: string | null
  currentCost: number
  enteredCost: number
}

/**
 * Regla de IS-23: de las líneas con costo cargado, las que difieren del
 * costo vigente del artículo. Cada una genera la pregunta «¿Actualizar el
 * precio de costo de X a $ N?». Sin costo cargado, o igual al vigente, no
 * se pregunta nada.
 */
export function findCostDifferences(
  lines: readonly EntryLineValues[],
  itemsById: ReadonlyMap<string, StockItem>,
): CostDifference[] {
  const differences: CostDifference[] = []
  for (const line of lines) {
    const entered = parseMoney(line.unitCost)
    const item = itemsById.get(line.supplyId)
    if (entered === null || !item) continue
    if (Math.round(entered * 100) !== Math.round(item.costPrice * 100)) {
      differences.push({
        supplyId: item.id,
        code: item.code,
        name: item.name,
        presentation: item.presentation,
        currentCost: item.costPrice,
        enteredCost: entered,
      })
    }
  }
  return differences
}

/**
 * Arma el `StockEntryInput`. `updateCostFor` son los artículos para los que
 * la persona contestó «Sí» a actualizar el costo (`update_cost`).
 */
export function entryValuesToInput(
  values: EntryFormValues,
  updateCostFor: ReadonlySet<string>,
): StockEntryInput {
  return {
    kind: values.kind,
    lines: values.lines.map((line) => {
      const unitCost = parseMoney(line.unitCost)
      return {
        supplyId: line.supplyId,
        qty: Number(line.qty),
        unitCost,
        updateCost: unitCost !== null && updateCostFor.has(line.supplyId),
      }
    }),
    supplier: values.supplier.trim() || null,
    documentNumber: values.documentNumber.trim() || null,
    note: values.note.trim() || null,
  }
}

// -------------------------------------------------------------------------
// Categorías (`upsert_supply_category`)
// -------------------------------------------------------------------------

export const CATEGORY_NAME_MAX = 60

export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Indicá el nombre de la categoría.')
    .max(CATEGORY_NAME_MAX, `Hasta ${CATEGORY_NAME_MAX} caracteres.`),
})

export type CategoryFormValues = z.infer<typeof categorySchema>
