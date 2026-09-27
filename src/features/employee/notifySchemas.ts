import { z } from 'zod'
import {
  ABSENCE_REASON_OPTIONS,
  absenceReasonRequiresText,
} from '@/lib/absenceReasons'

/**
 * Esquemas zod de EMP-12 (ABS-004): repiten las reglas que ya valida el
 * servidor en `notify_delay`/`notify_absence`
 * (`0027_rpc_notices_admin_attendance.sql`), no las reemplazan — la RPC
 * vuelve a validar todo esto como defensa en profundidad (mismo criterio
 * que el resto de los `schemas.ts` de `src/features`).
 */

const ABSENCE_REASON_VALUES = ABSENCE_REASON_OPTIONS.map(
  (option) => option.value,
)

/** P-072: minutos estimados de demora, obligatorios, entero de 1 a 600. */
export const delayMinutesSchema = z
  .string()
  .trim()
  .min(1, 'Indicá los minutos de demora estimados.')
  .regex(/^[0-9]+$/, 'Los minutos tienen que ser un número entero.')
  .refine(
    (value) => Number(value) >= 1 && Number(value) <= 600,
    'Los minutos tienen que ser de 1 a 600.',
  )

/** P-073: motivo de la lista, con texto obligatorio si el motivo es "otro". */
export const absenceReasonSchema = z
  .object({
    reasonCode: z.enum(ABSENCE_REASON_VALUES as [string, ...string[]]),
    reasonText: z.string().trim().optional(),
  })
  .refine(
    (values) =>
      !absenceReasonRequiresText(
        values.reasonCode as (typeof ABSENCE_REASON_VALUES)[number],
      ) || Boolean(values.reasonText),
    { message: 'Contanos el motivo.', path: ['reasonText'] },
  )

export type AbsenceReasonFormValues = z.infer<typeof absenceReasonSchema>
