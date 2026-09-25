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

/** Alta puntual o edición de franja (ADM-07). `clientId`/`siteId`/`date` solo hacen falta al crear: en edición son de solo lectura. */
export const shiftFormSchema = z
  .object({
    clientId: z.string().trim().min(1, 'Elegí un cliente.'),
    siteId: z.string().trim().min(1, 'Elegí una sede.'),
    date: z.string().trim().min(1, 'Falta la fecha.'),
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim().min(1, 'Falta la hora de fin.'),
    requiredStaff: requiredStaffSchema,
    notes: z.string().trim().optional(),
  })
  .refine((values) => values.endTime > values.startTime, {
    message: 'La hora de fin tiene que ser posterior a la de inicio.',
    path: ['endTime'],
  })

export type ShiftFormValues = z.infer<typeof shiftFormSchema>

/** Normaliza el formulario de alta puntual antes de mandarlo a `src/api/shifts.ts`. */
export function shiftFormValuesToCreateInput(values: ShiftFormValues) {
  return {
    clientId: values.clientId,
    siteId: values.siteId,
    date: values.date,
    start: values.startTime,
    end: values.endTime,
    requiredStaff: Number(values.requiredStaff),
    notes: values.notes?.trim() ? values.notes.trim() : null,
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
    endTime: z.string().trim().min(1, 'Falta la hora de fin.'),
  })
  .refine((values) => values.endTime > values.startTime, {
    message: 'La hora de fin tiene que ser posterior a la de inicio.',
    path: ['endTime'],
  })

export type ShiftTimeFormValues = z.infer<typeof shiftTimeFormSchema>

/** Igual que `shiftTimeFormSchema`, con dotación y notas agregadas (ASSIGN-013). */
export const shiftEditFormSchema = z
  .object({
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim().min(1, 'Falta la hora de fin.'),
    requiredStaff: requiredStaffSchema,
    notes: z.string().trim().optional(),
  })
  .refine((values) => values.endTime > values.startTime, {
    message: 'La hora de fin tiene que ser posterior a la de inicio.',
    path: ['endTime'],
  })

export type ShiftEditFormValues = z.infer<typeof shiftEditFormSchema>

export function shiftEditFormValuesToInputs(values: ShiftEditFormValues) {
  return {
    time: { start: values.startTime, end: values.endTime },
    details: {
      requiredStaff: Number(values.requiredStaff),
      notes: values.notes?.trim() ? values.notes.trim() : null,
    },
  }
}
