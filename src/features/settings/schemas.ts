import { z } from 'zod'

/**
 * Esquemas zod de las pantallas de Configuración (USERS-012, USERS-014,
 * USERS-015): repiten las restricciones que ya exige el servidor (columnas
 * `not null`, largo del texto, tamaño y tipo del logo) -- no las reemplazan,
 * el servidor vuelve a validar todo (ver `src/api/README.md`).
 */

/** ADM-28: nombre, teléfono y texto de consentimiento (solo dueño). */
export const companyDetailsSchema = z.object({
  name: z.string().trim().max(120, 'El nombre es demasiado largo.').optional(),
  supportPhone: z
    .string()
    .trim()
    .max(30, 'El teléfono es demasiado largo.')
    .optional(),
  locationConsentText: z
    .string()
    .trim()
    .max(2000, 'El texto es demasiado largo.')
    .optional(),
})
export type CompanyDetailsFormValues = z.infer<typeof companyDetailsSchema>

/** ADM-29: alta manual de un feriado. */
export const createHolidaySchema = z.object({
  holidayDate: z.string().min(1, 'Elegí una fecha.'),
  name: z.string().trim().min(1, 'Falta el nombre del feriado.').max(120),
})
export type CreateHolidayFormValues = z.infer<typeof createHolidaySchema>

/** ADM-30: alta y edición de un criterio de calificación. */
export const ratingCriterionSchema = z.object({
  title: z.string().trim().min(1, 'Falta el título.').max(120),
  description: z
    .string()
    .trim()
    .max(500, 'La descripción es demasiado larga.')
    .optional(),
})
export type RatingCriterionFormValues = z.infer<typeof ratingCriterionSchema>
