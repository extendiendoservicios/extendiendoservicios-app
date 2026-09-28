import { z } from 'zod'

/**
 * Esquemas zod de supervisiones y calificaciones (SUP-008): repiten las
 * restricciones que ya exigen `assign_supervision`/`rate_employee`
 * (`0029_rpc_supervisions.sql`), no las reemplazan -- el servidor vuelve a
 * validar todo.
 */

/** ADM-14: turno y supervisor obligatorios (la fecha solo filtra la lista de turnos, no se manda a la RPC). */
export const assignSupervisionSchema = z.object({
  shiftId: z.string().trim().min(1, 'Elegí un turno.'),
  supervisorId: z.string().trim().min(1, 'Elegí un supervisor.'),
})

export type AssignSupervisionFormValues = z.infer<
  typeof assignSupervisionSchema
>

/** ADM-15: `rate_employee` exige `score` entre 1 y 5 (`ratings_score_check`, 0010). */
export const rateEmployeeSchema = z.object({
  score: z
    .number({ message: 'Elegí un puntaje de 1 a 5.' })
    .int()
    .min(1, 'Elegí un puntaje de 1 a 5.')
    .max(5, 'Elegí un puntaje de 1 a 5.'),
  comment: z.string().trim().optional(),
})

export type RateEmployeeFormValues = z.infer<typeof rateEmployeeSchema>
