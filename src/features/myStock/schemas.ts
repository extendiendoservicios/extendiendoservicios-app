import { z } from 'zod'

/**
 * Esquemas zod de «Retirar insumos» y «Avisar faltante» (P25.4, IS-12, IS-28,
 * IS-29). Repiten las reglas que ya valida el servidor en `register_withdrawal`
 * y `report_supply_shortage`: la RPC vuelve a validar todo (defensa en
 * profundidad).
 */

/** Cantidad máxima por artículo en un retiro (tope de sentido común del formulario). */
export const MAX_WITHDRAWAL_QTY = 9999

/** Cantidad entera mayor que cero. */
export const qtySchema = z
  .number({ error: 'Indicá la cantidad.' })
  .int('La cantidad tiene que ser un número entero.')
  .min(1, 'La cantidad tiene que ser mayor que cero.')
  .max(MAX_WITHDRAWAL_QTY, `La cantidad máxima es ${MAX_WITHDRAWAL_QTY}.`)

const withdrawalLinesSchema = z
  .array(z.object({ supplyId: z.string().min(1), qty: qtySchema }))
  .min(1, 'Agregá al menos un artículo.')
  .refine(
    (lines) =>
      new Set(lines.map((line) => line.supplyId)).size === lines.length,
    'Hay un artículo repetido.',
  )

/**
 * Destino del retiro (IS-12): un turno, o una sede sin turno puntual. Con sede
 * la observación es obligatoria.
 */
export const withdrawalTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shift'),
    shiftId: z.string().min(1, 'Elegí un turno.'),
    note: z.string().trim().optional(),
  }),
  z.object({
    kind: z.literal('site'),
    siteId: z.string().min(1, 'Elegí una sede.'),
    note: z
      .string()
      .trim()
      .min(1, 'Contanos para qué es: la observación es obligatoria.'),
  }),
])

export type WithdrawalTargetValues = z.infer<typeof withdrawalTargetSchema>

export const withdrawalSchema = z.object({
  target: withdrawalTargetSchema,
  lines: withdrawalLinesSchema,
})

export type WithdrawalFormValues = z.infer<typeof withdrawalSchema>

/**
 * Aviso de faltante (IS-29): un artículo del catálogo **o** una descripción
 * libre (uno de los dos). Turno o sede y comentario son opcionales.
 */
export const shortageSchema = z
  .object({
    supplyId: z.string().trim().optional(),
    description: z.string().trim().optional(),
    shiftId: z.string().trim().optional(),
    siteId: z.string().trim().optional(),
    comment: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
    const hasSupply = Boolean(values.supplyId)
    const hasDescription = Boolean(values.description)
    if (!hasSupply && !hasDescription) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message:
          'Elegí un artículo del catálogo o escribí cuál es el que falta.',
      })
    }
    if (hasSupply && hasDescription) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message:
          'Elegí un artículo del catálogo o escribí uno, pero no los dos.',
      })
    }
  })

export type ShortageFormValues = z.infer<typeof shortageSchema>
