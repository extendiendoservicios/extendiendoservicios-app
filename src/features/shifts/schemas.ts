import { z } from 'zod'

/**
 * Esquemas zod de ADM-07 (SHIFT-008): repiten las restricciones que ya
 * exige `create_shift`/`update_shift_time` (`0023_rpc_shifts.sql`:
 * `p_end > p_start`, `04_Modelo_de_Datos.md` sección 2 dice dotación 1..10
 * para `shifts.required_staff`, mismo rango que `services.required_staff`),
 * no las reemplazan.
 */

/** Mismo criterio que `requiredStaffSchema` de `services/schemas.ts`: texto, no `z.coerce.number()`. */
const requiredStaffSchema = z
  .string()
  .trim()
  .min(1, 'Indicá la dotación.')
  .regex(/^[0-9]+$/, 'La dotación tiene que ser un número entero.')
  .refine(
    (value) => Number(value) >= 1 && Number(value) <= 10,
    'La dotación tiene que ser de 1 a 10 personas.',
  )

/**
 * AJ2-10: con «A terminar» la hora de fin no se pide ni se compara con el inicio (la base la
 * guarda en 23:59). Sin «A terminar» rige lo de siempre: fin obligatorio y posterior al inicio.
 */
const OPEN_ENDED_LAST_START = '23:59'

function checkEndTime(
  values: { startTime: string; endTime: string; openEnded?: boolean },
  ctx: z.RefinementCtx,
) {
  if (values.openEnded) {
    // La base guarda el fin en 23:59: un inicio igual o posterior no entra.
    if (values.startTime >= OPEN_ENDED_LAST_START) {
      ctx.addIssue({
        code: 'custom',
        message: 'Con «A terminar» el inicio tiene que ser antes de las 23:59.',
        path: ['startTime'],
      })
    }
    return
  }
  if (!values.endTime) {
    ctx.addIssue({
      code: 'custom',
      message: 'Falta la hora de fin.',
      path: ['endTime'],
    })
    return
  }
  if (values.endTime <= values.startTime) {
    ctx.addIssue({
      code: 'custom',
      message: 'La hora de fin tiene que ser posterior a la de inicio.',
      path: ['endTime'],
    })
  }
}

/** Alta puntual o edición de franja (ADM-07). `clientId`/`siteId`/`date` solo hacen falta al crear: en edición son de solo lectura. */
export const shiftFormSchema = z
  .object({
    clientId: z.string().trim().min(1, 'Elegí un cliente.'),
    siteId: z.string().trim().min(1, 'Elegí una sede.'),
    date: z.string().trim().min(1, 'Falta la fecha.'),
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim(),
    openEnded: z.boolean().optional(),
    requiredStaff: requiredStaffSchema,
    notes: z.string().trim().optional(),
    showInPrint: z.boolean().optional(),
  })
  .superRefine(checkEndTime)

export type ShiftFormValues = z.infer<typeof shiftFormSchema>

/** Normaliza el formulario de alta puntual antes de mandarlo a `src/api/shifts.ts`. */
export function shiftFormValuesToCreateInput(values: ShiftFormValues) {
  return {
    clientId: values.clientId,
    siteId: values.siteId,
    date: values.date,
    start: values.startTime,
    end: values.openEnded ? null : values.endTime,
    openEnded: Boolean(values.openEnded),
    requiredStaff: Number(values.requiredStaff),
    notes: values.notes?.trim() ? values.notes.trim() : null,
    showInPrint: values.showInPrint ?? true,
  }
}

/**
 * Edición de ADM-07 (SHIFT-008, franja) más dotación y notas (ASSIGN-013,
 * `12_Registro_de_Progreso.md` sección "Pendiente": la RPC `update_shift_details`
 * que faltaba llegó en P11.1 -- ver `src/api/assignments.ts`). Franja va a
 * `update_shift_time`, dotación y notas a `update_shift_details`: dos RPC
 * separadas, un solo formulario.
 */
export const shiftTimeFormSchema = z
  .object({
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim(),
    openEnded: z.boolean().optional(),
  })
  .superRefine(checkEndTime)

export type ShiftTimeFormValues = z.infer<typeof shiftTimeFormSchema>

/** Igual que `shiftTimeFormSchema`, con dotación y notas agregadas (ASSIGN-013). */
export const shiftEditFormSchema = z
  .object({
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim(),
    openEnded: z.boolean().optional(),
    requiredStaff: requiredStaffSchema,
    notes: z.string().trim().optional(),
    showInPrint: z.boolean().optional(),
  })
  .superRefine(checkEndTime)

export type ShiftEditFormValues = z.infer<typeof shiftEditFormSchema>

export function shiftEditFormValuesToInputs(values: ShiftEditFormValues) {
  return {
    time: {
      start: values.startTime,
      end: values.openEnded ? null : values.endTime,
      openEnded: Boolean(values.openEnded),
    },
    details: {
      requiredStaff: Number(values.requiredStaff),
      notes: values.notes?.trim() ? values.notes.trim() : null,
      showInPrint: values.showInPrint ?? true,
    },
  }
}
