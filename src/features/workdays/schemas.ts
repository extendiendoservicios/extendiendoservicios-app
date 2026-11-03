import { z } from 'zod'

/**
 * Esquemas zod de las correcciones de jornada (P24.3, CJ-32): repiten las
 * restricciones de `admin_correct_workday_event`, `admin_add_workday_pause`
 * y `admin_record_workday` (motivo obligatorio, orden de las horas), no las
 * reemplazan: el servidor vuelve a validar todo, incluido el rango del día.
 * Las horas son valores de `datetime-local` (`yyyy-MM-ddTHH:mm`, Argentina).
 */

const reasonSchema = z.string().trim().min(1, 'Escribí el motivo.')
const MAX_PAUSE_REASON = 200
/** `admin_correct_workday_event` admite hasta 300 (`REASON_TOO_LONG`). */
const MAX_CORRECTED_PAUSE_REASON = 300

export const INVALID_RANGE_MESSAGE =
  'El inicio tiene que ser anterior al fin: revisá las horas que elegiste.'
export const SAME_DAY_MESSAGE =
  'El inicio y el fin tienen que ser del mismo día: la jornada no pasa la medianoche.'

/** «Corregir hora» de un evento de la jornada. */
export const correctWorkdayEventSchema = z.object({
  at: z.string().trim().min(1, 'Indicá la hora nueva.'),
  /** OD-07: motivo de la pausa (solo si el evento es una pausa); vacío lo borra. */
  pauseReason: z
    .string()
    .trim()
    .max(
      MAX_CORRECTED_PAUSE_REASON,
      `El motivo de la pausa admite hasta ${MAX_CORRECTED_PAUSE_REASON} caracteres.`,
    )
    .optional(),
  reason: reasonSchema,
})
export type CorrectWorkdayEventFormValues = z.infer<
  typeof correctWorkdayEventSchema
>

/** «Agregar pausa». `pauseReason` es el motivo de la pausa (opcional, CJ-16); `reason`, el de la corrección. */
export const addWorkdayPauseSchema = z
  .object({
    startsAt: z.string().trim().min(1, 'Indicá cuándo empezó la pausa.'),
    endsAt: z.string().trim().min(1, 'Indicá cuándo terminó la pausa.'),
    pauseReason: z
      .string()
      .trim()
      .max(
        MAX_PAUSE_REASON,
        `El motivo de la pausa admite hasta ${MAX_PAUSE_REASON} caracteres.`,
      )
      .optional(),
    reason: reasonSchema,
  })
  .refine(
    (values) =>
      !values.startsAt || !values.endsAt || values.startsAt < values.endsAt,
    {
      path: ['endsAt'],
      message: INVALID_RANGE_MESSAGE,
    },
  )
export type AddWorkdayPauseFormValues = z.infer<typeof addWorkdayPauseSchema>

/**
 * «Registrar jornada» en nombre del coordinador. El día sale del inicio. Si
 * no hay fin, queda abierta (el servidor solo lo admite para hoy).
 */
export const recordWorkdaySchema = z
  .object({
    startedAt: z.string().trim().min(1, 'Indicá cuándo empezó la jornada.'),
    endedAt: z.string().trim().optional(),
    reason: reasonSchema,
  })
  .superRefine((values, context) => {
    if (!values.endedAt) {
      return
    }
    if (values.startedAt.slice(0, 10) !== values.endedAt.slice(0, 10)) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: SAME_DAY_MESSAGE,
      })
    } else if (values.startedAt >= values.endedAt) {
      context.addIssue({
        code: 'custom',
        path: ['endedAt'],
        message: INVALID_RANGE_MESSAGE,
      })
    }
  })
export type RecordWorkdayFormValues = z.infer<typeof recordWorkdaySchema>

/**
 * «Finalizar jornada» (OD-06) y «Cerrar pausa» (OD-07): la hora (por defecto
 * ahora; el rango lo valida el diálogo con `workdayTimeBounds`) y el motivo
 * obligatorio.
 */
export const workdayActionSchema = z.object({
  at: z.string().trim().min(1, 'Indicá la hora.'),
  reason: reasonSchema,
})
export type WorkdayActionFormValues = z.infer<typeof workdayActionSchema>

/**
 * «Corregir horas» de una supervisión (OD-07): inicio y, si ya tiene fin,
 * fin, con motivo obligatorio. El fin tiene que ser posterior al inicio.
 */
export const correctSupervisionTimeSchema = z
  .object({
    startAt: z.string().trim().min(1, 'Indicá la hora de inicio.'),
    endAt: z.string().trim().optional(),
    reason: reasonSchema,
  })
  .refine((values) => !values.endAt || values.startAt < values.endAt, {
    path: ['endAt'],
    message: 'El fin tiene que ser posterior al inicio.',
  })
export type CorrectSupervisionTimeFormValues = z.infer<
  typeof correctSupervisionTimeSchema
>
