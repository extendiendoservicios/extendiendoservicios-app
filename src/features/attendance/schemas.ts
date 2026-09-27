import { z } from 'zod'

/**
 * Esquemas zod de ADM-11 "Registrar en nombre del empleado" (ATT-010,
 * ABS-008): repiten las restricciones que ya exigen `admin_record_attendance`,
 * `close_assignment`, `notify_delay` y `notify_absence`
 * (`0027_rpc_notices_admin_attendance.sql`), no las reemplazan -- el
 * servidor vuelve a validar todo.
 */

/** Motivo administrativo obligatorio (inicio, fin, cierre manual): sin tope propio, el que ya impone `p_reason text`. */
const adminReasonSchema = z.string().trim().min(1, 'Indicá el motivo.')

/**
 * Inicio o fin en nombre del empleado (`admin_record_attendance`) y cierre
 * manual (`close_assignment`): misma forma para los tres -- hora (por
 * defecto ahora, editable) y motivo obligatorio (P-075, decisión de Mike
 * del 26 sep 2026, P14.0).
 */
export const recordAttendanceSchema = z.object({
  /** `"yyyy-MM-ddTHH:mm"` de un `input type="datetime-local"`, en hora de Argentina (ADR-019). */
  at: z.string().trim().min(1, 'Indicá la hora.'),
  reason: adminReasonSchema,
})

export type RecordAttendanceFormValues = z.infer<typeof recordAttendanceSchema>

/**
 * Aviso de demora en nombre del empleado (`notify_delay`, P-072): minutos 1
 * a 600, motivo opcional. `minutes` queda como texto en el formulario (no
 * `z.coerce.number`, que le da a `useForm` un tipo de entrada `unknown`
 * incompatible con la firma de `zodResolver` -- mismo criterio que
 * `shiftDetailsSchema`/`shiftDetailsFormValuesToInput` de
 * `src/features/planning/schemas.ts`): se convierte a número recién en
 * `notifyDelayFormValuesToMinutes`, después de validar.
 */
export const notifyDelaySchema = z.object({
  minutes: z
    .string()
    .trim()
    .min(1, 'Indicá los minutos de demora estimados.')
    .regex(/^[0-9]+$/, 'Los minutos tienen que ser un número entero.')
    .refine(
      (value) => Number(value) >= 1 && Number(value) <= 600,
      'Los minutos tienen que ser de 1 a 600.',
    ),
  reasonText: z.string().trim().optional(),
})

export type NotifyDelayFormValues = z.infer<typeof notifyDelaySchema>

export function notifyDelayFormValuesToMinutes(
  values: NotifyDelayFormValues,
): number {
  return Number(values.minutes)
}

const ABSENCE_REASON_CODES = [
  'illness',
  'personal',
  'procedure',
  'transport',
  'other',
] as const

/** Aviso de ausencia en nombre del empleado (`notify_absence`, P-073): motivo obligatorio, texto obligatorio si es "Otro". */
export const notifyAbsenceSchema = z
  .object({
    reasonCode: z.enum(ABSENCE_REASON_CODES, {
      message: 'Indicá el motivo de la ausencia.',
    }),
    reasonText: z.string().trim().optional(),
  })
  .refine(
    (values) =>
      values.reasonCode !== 'other' || Boolean(values.reasonText?.trim()),
    {
      message: 'Indicá el motivo de la ausencia.',
      path: ['reasonText'],
    },
  )

export type NotifyAbsenceFormValues = z.infer<typeof notifyAbsenceSchema>
