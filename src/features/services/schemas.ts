import { z } from 'zod'
import { SERVICE_STATUS_LABELS, type ServiceStatus } from '@/api/services'

/**
 * Esquemas zod de ADM-25 (SERVICE-001): repiten las restricciones que ya
 * exige el servidor (`04_Modelo_de_Datos.md` sección 2.3,
 * `0007_services_shifts_assignments.sql`: al menos un día de la semana sin
 * repetir, `end_time > start_time`, dotación 1..10), no las reemplazan —
 * `services_weekdays_check`, `services_time_range_check` y
 * `services_required_staff_check` vuelven a validar todo esto.
 */

export const SERVICE_STATUS_OPTIONS: { value: ServiceStatus; label: string }[] =
  (['active', 'paused', 'ended'] as const).map((value) => ({
    value,
    label: SERVICE_STATUS_LABELS[value],
  }))

/**
 * Orden de exhibición (semana empieza en lunes), valor `'0'`..`'6'` =
 * domingo..sábado (`04` sección 2.1) — mismo orden que `WEEKDAY_OPTIONS` de
 * `src/features/employees/components/EmployeeAvailabilityTab.tsx`.
 */
export const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: 'Lunes' },
  { value: '2', label: 'Martes' },
  { value: '3', label: 'Miércoles' },
  { value: '4', label: 'Jueves' },
  { value: '5', label: 'Viernes' },
  { value: '6', label: 'Sábado' },
  { value: '0', label: 'Domingo' },
]

/**
 * AJ3-05: `services.weeks_of_month` (`services_weeks_of_month_check`, 0044):
 * no vacío, sin repetidos, cada valor de 1 a 5 (5 = la última del mes).
 * `null` en la columna = todas las semanas (no pasa por este esquema).
 */
export const weeksOfMonthSchema = z
  .array(z.number().int().min(1).max(5))
  .min(1, 'Elegí al menos una semana del mes.')
  .refine(
    (weeks) => new Set(weeks).size === weeks.length,
    'No repitas semanas del mes.',
  )

/** Columna → campos del formulario (`null` = «Todas las semanas»). */
export function weeksOfMonthToFormValues(weeks: number[] | null): {
  weeksMode: 'all' | 'some'
  weeksOfMonth: string[]
} {
  return weeks && weeks.length > 0
    ? { weeksMode: 'some', weeksOfMonth: weeks.map(String) }
    : { weeksMode: 'all', weeksOfMonth: [] }
}

/** Campos del formulario → columna (`null` si se repite todas las semanas). */
export function weeksOfMonthFromFormValues(values: {
  weeksMode?: 'all' | 'some'
  weeksOfMonth?: string[]
}): number[] | null {
  if (values.weeksMode !== 'some') {
    return null
  }
  return [...new Set((values.weeksOfMonth ?? []).map(Number))].sort(
    (a, b) => a - b,
  )
}

/** Cadena vacía → `null` (así no se guarda `''` en una columna opcional). */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/** Cadena vacía → `null`, si no un número (para `min_hours_month`/`max_hours_month`). */
function emptyToNullNumber(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? Number(trimmed) : null
}

/**
 * `0007_services_shifts_assignments.sql`: `required_staff between 1 and
 * 10`. Como texto (no `z.coerce.number()`), mismo criterio que
 * `employeeNumberSchema` de `employees/schemas.ts`: el tipo de entrada y el
 * de salida de `z.coerce` no coinciden, lo que rompe el tipado de
 * `zodResolver` con `useForm`.
 */
const requiredStaffSchema = z
  .string()
  .trim()
  .min(1, 'Indicá la dotación.')
  .regex(/^[0-9]+$/, 'La dotación tiene que ser un número entero.')
  .refine(
    (value) => Number(value) >= 1 && Number(value) <= 10,
    'La dotación tiene que ser de 1 a 10 personas.',
  )

/** Un decimal opcional, no negativo (horas mensuales informativas, P-047). */
const optionalHoursSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || (!Number.isNaN(Number(value)) && Number(value) >= 0),
    'Ingresá un número de horas válido.',
  )

export const serviceFormSchema = z
  .object({
    clientId: z.string().trim().min(1, 'Elegí un cliente.'),
    siteId: z.string().trim().min(1, 'Elegí una sede.'),
    name: z.string().trim().min(1, 'Falta el nombre del servicio.'),
    weekdays: z.array(z.string()).min(1, 'Elegí al menos un día de la semana.'),
    weeksMode: z.enum(['all', 'some']).optional(),
    weeksOfMonth: z.array(z.string()).optional(),
    startTime: z.string().trim().min(1, 'Falta la hora de inicio.'),
    endTime: z.string().trim(),
    openEnded: z.boolean().optional(),
    requiredStaff: requiredStaffSchema,
    validFrom: z
      .string()
      .trim()
      .min(1, 'Falta la fecha de inicio de vigencia.'),
    validTo: z.string().trim().optional(),
    worksOnHolidays: z.boolean(),
    minHoursMonth: optionalHoursSchema,
    maxHoursMonth: optionalHoursSchema,
    status: z.enum(['active', 'paused', 'ended']),
    notes: z.string().trim().optional(),
  })
  .superRefine((values, ctx) => {
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
  })
  .superRefine((values, ctx) => {
    // AJ2-10: con «A terminar» no hay hora de fin que pedir ni comparar.
    if (values.openEnded) {
      if (values.startTime >= '23:59') {
        ctx.addIssue({
          code: 'custom',
          message:
            'Con «A terminar» el inicio tiene que ser antes de las 23:59.',
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
    } else if (values.endTime <= values.startTime) {
      ctx.addIssue({
        code: 'custom',
        message: 'La hora de fin tiene que ser posterior a la de inicio.',
        path: ['endTime'],
      })
    }
  })
  .refine((values) => !values.validTo || values.validTo >= values.validFrom, {
    message: 'La fecha "hasta" no puede ser anterior a la fecha "desde".',
    path: ['validTo'],
  })
  .refine(
    (values) =>
      !values.minHoursMonth ||
      !values.maxHoursMonth ||
      Number(values.maxHoursMonth) >= Number(values.minHoursMonth),
    {
      message: 'Las horas máximas no pueden ser menos que las horas mínimas.',
      path: ['maxHoursMonth'],
    },
  )

export type ServiceFormValues = z.infer<typeof serviceFormSchema>

/** Normaliza los campos del formulario antes de mandarlos a `src/api/services.ts`. */
export function serviceFormValuesToInput(values: ServiceFormValues) {
  return {
    clientId: values.clientId,
    siteId: values.siteId,
    name: values.name.trim(),
    weekdays: [...new Set(values.weekdays.map(Number))].sort((a, b) => a - b),
    weeksOfMonth: weeksOfMonthFromFormValues(values),
    startTime: values.startTime,
    endTime: values.openEnded ? null : values.endTime,
    openEnded: Boolean(values.openEnded),
    requiredStaff: Number(values.requiredStaff),
    validFrom: values.validFrom,
    validTo: emptyToNull(values.validTo),
    worksOnHolidays: values.worksOnHolidays,
    minHoursMonth: emptyToNullNumber(values.minHoursMonth),
    maxHoursMonth: emptyToNullNumber(values.maxHoursMonth),
    status: values.status,
    notes: emptyToNull(values.notes),
  }
}
