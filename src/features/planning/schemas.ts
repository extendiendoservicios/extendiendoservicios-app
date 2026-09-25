import { z } from 'zod'

/**
 * Esquemas zod de las mutaciones de asignaciones (ASSIGN-007): repiten las
 * restricciones que ya exigen `assign_employee`/`update_assignment_time`/
 * `update_shift_details` (`0024_rpc_assignments.sql`), no las reemplazan.
 * Ninguna pantalla de este paquete (ADM-03, ADM-04, ADM-05) los usa
 * todavía: quedan listos para ADM-06/ADM-08 (P11.3).
 */

/** Franja propia opcional de una asignación (P-046): las dos horas van juntas, o ninguna. */
export const assignmentTimeSchema = z
  .object({
    startTime: z.string().trim().optional(),
    endTime: z.string().trim().optional(),
  })
  .refine((values) => Boolean(values.startTime) === Boolean(values.endTime), {
    message: 'Si cargás una franja propia, completá las dos horas.',
    path: ['endTime'],
  })
  .refine(
    (values) =>
      !values.startTime || !values.endTime || values.endTime > values.startTime,
    {
      message: 'La hora de fin tiene que ser posterior a la de inicio.',
      path: ['endTime'],
    },
  )

export type AssignmentTimeFormValues = z.infer<typeof assignmentTimeSchema>

/** Alta de ADM-08 (P11.3): empleado obligatorio, franja propia opcional. */
export const assignEmployeeSchema = z
  .object({
    employeeId: z.string().trim().min(1, 'Elegí un empleado.'),
  })
  .and(assignmentTimeSchema)

export type AssignEmployeeFormValues = z.infer<typeof assignEmployeeSchema>

/** Mismo rango que `services.required_staff`/`shifts.required_staff` (1 a 10, `04` sección 2). */
export const shiftDetailsSchema = z.object({
  requiredStaff: z
    .string()
    .trim()
    .min(1, 'Indicá la dotación.')
    .regex(/^[0-9]+$/, 'La dotación tiene que ser un número entero.')
    .refine(
      (value) => Number(value) >= 1 && Number(value) <= 10,
      'La dotación tiene que ser de 1 a 10 personas.',
    ),
  notes: z.string().trim().optional(),
})

export type ShiftDetailsFormValues = z.infer<typeof shiftDetailsSchema>

export function shiftDetailsFormValuesToInput(values: ShiftDetailsFormValues) {
  return {
    requiredStaff: Number(values.requiredStaff),
    notes: values.notes?.trim() ? values.notes.trim() : null,
  }
}
