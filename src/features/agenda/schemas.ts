import { z } from 'zod'
import {
  AGENDA_TEXT_MAX_LENGTH,
  type AgendaFields,
  type AgendaItem,
} from '@/api/agenda'

/**
 * Esquemas de la Agenda (P37.2): repiten las restricciones del servidor
 * (`save_agenda_item`, 0092) sin reemplazarlas. Todos los campos son opcionales,
 * pero no se guarda un elemento vacío (AG-05, `EMPTY_AGENDA_ITEM`).
 */

const optionalText = z
  .string()
  .trim()
  .max(AGENDA_TEXT_MAX_LENGTH, `Máximo ${AGENDA_TEXT_MAX_LENGTH} caracteres.`)

const colorIndex = z.number().int().min(0).max(19).nullable()
/** El relleno también admite el 20 (verde «resuelto», lo pone el servidor). */
const fillIndex = z.number().int().min(0).max(20).nullable()

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí el día.')

export const agendaEventSchema = z
  .object({
    workType: optionalText,
    timeText: optionalText,
    place: optionalText,
    clientPerson: optionalText,
    people: optionalText,
    observation: optionalText,
    day: isoDate,
    borderColor: colorIndex,
    fillColor: fillIndex,
  })
  .refine(
    (v) =>
      [
        v.workType,
        v.timeText,
        v.place,
        v.clientPerson,
        v.people,
        v.observation,
      ].join('').length > 0,
    { message: 'Completá al menos un dato del evento.', path: ['workType'] },
  )

export type AgendaEventValues = z.infer<typeof agendaEventSchema>

export const agendaNewSchema = z
  .object({
    placeName: optionalText,
    clientName: optionalText,
    address: optionalText,
    daysHours: optionalText,
    /** Texto tal cual lo tipea la persona (se convierte con `parseBudget`). */
    budget: z.string().trim(),
    observation: optionalText,
    slot: z.number().int().min(0).max(6),
    borderColor: colorIndex,
    fillColor: fillIndex,
  })
  .superRefine((v, ctx) => {
    if (v.budget !== '' && parseBudget(v.budget) === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'El presupuesto no es un importe válido.',
        path: ['budget'],
      })
    }
    const hasData =
      [v.placeName, v.clientName, v.address, v.daysHours, v.observation].join(
        '',
      ).length > 0 || v.budget !== ''
    if (!hasData) {
      ctx.addIssue({
        code: 'custom',
        message: 'Completá al menos un dato del bloque.',
        path: ['placeName'],
      })
    }
  })

export type AgendaNewValues = z.infer<typeof agendaNewSchema>

export const agendaNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Escribí la nota.')
    .max(
      AGENDA_TEXT_MAX_LENGTH,
      `Máximo ${AGENDA_TEXT_MAX_LENGTH} caracteres.`,
    ),
  borderColor: colorIndex,
  fillColor: fillIndex,
})

export type AgendaNoteValues = z.infer<typeof agendaNoteSchema>

/**
 * Importe en pesos tal como se escribe en Argentina («1.250,50», «$ 1500»),
 * a número. `null` si no es un importe válido (negativo incluido).
 */
export function parseBudget(text: string): number | null {
  const clean = text.replace(/[$\s]/g, '')
  if (clean === '') {
    return null
  }
  let normalized = clean
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(clean)) {
    normalized = clean.replace(/\./g, '')
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null
  }
  return Number(normalized)
}

/** Importe a texto con coma decimal y puntos de miles (sin decimales si es entero). */
export function formatBudget(value: number | null): string {
  if (value == null) {
    return ''
  }
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** Los textos de un evento para `save_agenda_item`. */
export function eventValuesToFields(values: AgendaEventValues): AgendaFields {
  return {
    workType: values.workType,
    timeText: values.timeText,
    place: values.place,
    clientPerson: values.clientPerson,
    people: values.people,
    observation: values.observation,
  }
}

export function newValuesToFields(values: AgendaNewValues): AgendaFields {
  return {
    placeName: values.placeName,
    clientName: values.clientName,
    address: values.address,
    daysHours: values.daysHours,
    budget: parseBudget(values.budget),
    observation: values.observation,
  }
}

export function eventItemToValues(item: AgendaItem): AgendaEventValues {
  return {
    workType: item.workType ?? '',
    timeText: item.timeText ?? '',
    place: item.place ?? '',
    clientPerson: item.clientPerson ?? '',
    people: item.people ?? '',
    observation: item.observation ?? '',
    day: item.day ?? '',
    borderColor: item.borderColor,
    fillColor: item.fillColor,
  }
}

export function newItemToValues(item: AgendaItem): AgendaNewValues {
  return {
    placeName: item.placeName ?? '',
    clientName: item.clientName ?? '',
    address: item.address ?? '',
    daysHours: item.daysHours ?? '',
    budget: item.budget == null ? '' : formatBudget(item.budget),
    observation: item.observation ?? '',
    slot: item.slot ?? 0,
    borderColor: item.borderColor,
    fillColor: item.fillColor,
  }
}

/** Trabajos sugeridos (AG-06); el campo acepta además cualquier texto libre. */
export const WORK_TYPE_OPTIONS = [
  'Final de obra',
  'Reunión',
  'Presupuesto',
  'Turno',
] as const
