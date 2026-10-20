import { addMonths, format } from 'date-fns'
import { z } from 'zod'
import {
  weeksOfMonthFromFormValues,
  weeksOfMonthSchema,
} from '@/features/services/schemas'

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

/** `"AAAA-MM-DD"` → `Date` local (sin pasar por UTC). */
function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year as number, (month as number) - 1, day)
}

/**
 * Última fecha que admite «Repetir este turno» (AJ3-08): la primera + 3
 * meses, igual que `create_shift_series` (`SERIES_RANGE_TOO_LONG`). Con
 * `addMonths` un 31 de enero da el 30 de abril, como `interval '3 months'`.
 */
export function maxSeriesDate(fromIsoDate: string): string {
  return format(addMonths(parseIsoDate(fromIsoDate), 3), 'yyyy-MM-dd')
}

/** Día de la semana (`'0'` domingo a `'6'` sábado) de una fecha; el que se tilda por defecto al repetir. */
export function defaultWeekdayForDate(isoDate: string): string[] {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
    ? [String(parseIsoDate(isoDate).getDay())]
    : []
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
    // Módulo H: «Pide fotos».
    requiresPhotos: z.boolean().optional(),
    // AJ3-08: «Repetir este turno». Apagado = alta de un solo turno.
    repeat: z.boolean().optional(),
    weekdays: z.array(z.string()).optional(),
    weeksMode: z.enum(['all', 'some']).optional(),
    weeksOfMonth: z.array(z.string()).optional(),
    repeatTo: z.string().trim().optional(),
    worksOnHolidays: z.boolean().optional(),
  })
  .superRefine(checkEndTime)
  .superRefine((values, ctx) => {
    if (!values.repeat) {
      return
    }
    if ((values.weekdays ?? []).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Elegí al menos un día de la semana.',
        path: ['weekdays'],
      })
    }
    if (values.weeksMode === 'some') {
      const parsed = weeksOfMonthSchema.safeParse(
        (values.weeksOfMonth ?? []).map(Number),
      )
      if (!parsed.success) {
        ctx.addIssue({
          code: 'custom',
          message:
            parsed.error.issues[0]?.message ??
            'Elegí al menos una semana del mes.',
          path: ['weeksOfMonth'],
        })
      }
    }
    if (!values.repeatTo) {
      ctx.addIssue({
        code: 'custom',
        message: 'Elegí hasta qué fecha se repite.',
        path: ['repeatTo'],
      })
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(values.date)) {
      if (values.repeatTo < values.date) {
        ctx.addIssue({
          code: 'custom',
          message:
            'La fecha «hasta» tiene que ser igual o posterior a «desde».',
          path: ['repeatTo'],
        })
      } else if (values.repeatTo > maxSeriesDate(values.date)) {
        ctx.addIssue({
          code: 'custom',
          message:
            'La repetición puede abarcar como máximo 3 meses desde la primera fecha.',
          path: ['repeatTo'],
        })
      }
    }
  })

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
    requiresPhotos: Boolean(values.requiresPhotos),
  }
}

/**
 * AJ3-08: regla de repetición del formulario (días, semanas del mes, hasta y
 * feriados), lista para `preview_shift_series` / `create_shift_series`.
 * `null` si «Repetir este turno» está apagado o la regla aún no está completa
 * y dentro del tope (así la vista previa no consulta con datos inválidos).
 */
export function shiftFormValuesToSeriesRule(
  values: Pick<
    ShiftFormValues,
    | 'repeat'
    | 'date'
    | 'repeatTo'
    | 'weekdays'
    | 'weeksMode'
    | 'weeksOfMonth'
    | 'worksOnHolidays'
  >,
) {
  if (!values.repeat || !values.repeatTo) {
    return null
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (
    !iso.test(values.date) ||
    !iso.test(values.repeatTo) ||
    values.repeatTo < values.date ||
    values.repeatTo > maxSeriesDate(values.date)
  ) {
    return null
  }
  const weekdays = [...new Set((values.weekdays ?? []).map(Number))].sort(
    (a, b) => a - b,
  )
  if (weekdays.length === 0) {
    return null
  }
  const weeksOfMonth = weeksOfMonthFromFormValues(values)
  if (weeksOfMonth && !weeksOfMonthSchema.safeParse(weeksOfMonth).success) {
    return null
  }
  return {
    from: values.date,
    to: values.repeatTo,
    weekdays,
    weeksOfMonth,
    worksOnHolidays: Boolean(values.worksOnHolidays),
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
    requiresPhotos: z.boolean().optional(),
    /** P19.11d: fecha del turno (`"YYYY-MM-DD"`); vacía o ausente = no se edita. */
    date: z.string().optional(),
  })
  .superRefine(checkEndTime)

export type ShiftEditFormValues = z.infer<typeof shiftEditFormSchema>

export function shiftEditFormValuesToInputs(values: ShiftEditFormValues) {
  return {
    time: {
      start: values.startTime,
      end: values.openEnded ? null : values.endTime,
      openEnded: Boolean(values.openEnded),
      date: values.date || undefined,
    },
    details: {
      requiredStaff: Number(values.requiredStaff),
      notes: values.notes?.trim() ? values.notes.trim() : null,
      showInPrint: values.showInPrint ?? true,
      requiresPhotos: Boolean(values.requiresPhotos),
    },
  }
}
