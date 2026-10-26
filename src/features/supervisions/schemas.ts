import { z } from 'zod'

/**
 * Esquemas zod de supervisiones y calificaciones (SUP-008): repiten las
 * restricciones que ya exige `rate_employee` (`0029_rpc_supervisions.sql`),
 * no las reemplazan -- el servidor vuelve a
 * validar todo.
 */

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
