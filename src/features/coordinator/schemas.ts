import { z } from 'zod'

/** Largo máximo del motivo de la pausa (`pause_workday`: `REASON_TOO_LONG`). */
export const PAUSE_REASON_MAX_LENGTH = 300

/** La pausa de la jornada: el motivo es opcional (CJ-16). */
export const pauseWorkdaySchema = z.object({
  reason: z
    .string()
    .trim()
    .max(
      PAUSE_REASON_MAX_LENGTH,
      `El motivo puede tener hasta ${PAUSE_REASON_MAX_LENGTH} caracteres.`,
    ),
})

export type PauseWorkdayValues = z.infer<typeof pauseWorkdaySchema>
