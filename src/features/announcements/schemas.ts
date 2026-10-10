import { z } from 'zod'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementAudience,
  type AnnouncementInput,
} from '@/api/announcements'
import { localDateToIsoDate } from '@/features/settings/dateOnly'

/**
 * Esquema zod del formulario de anuncios (AJ2-03): repite las reglas de
 * `create_announcement`/`update_announcement` (título ≤ 120, texto ≤ 2000,
 * «Elegir personas» con al menos una, fecha «hasta» no pasada). No las
 * reemplaza: el servidor vuelve a validar todo.
 */

export const AUDIENCE_OPTIONS: {
  value: AnnouncementAudience
  label: string
}[] = [
  { value: 'employees', label: 'Empleados' },
  { value: 'supervisors', label: 'Supervisores' },
  { value: 'all', label: 'Todos' },
  { value: 'custom', label: 'Elegir personas' },
]

export interface AnnouncementFormValues {
  title: string
  body: string
  audience: AnnouncementAudience
  /** `yyyy-MM-dd` o cadena vacía (sin vencimiento). */
  visibleUntil: string
  recipientIds: string[]
}

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormValues = {
  title: '',
  body: '',
  audience: 'employees',
  visibleUntil: '',
  recipientIds: [],
}

interface SchemaOptions {
  /** Hoy como `yyyy-MM-dd` (para tests). Por defecto, el del navegador. */
  today?: string
  /**
   * Fecha «hasta» guardada (edición): el servidor solo rechaza una fecha
   * pasada si cambia, así que si queda igual no se marca.
   */
  originalVisibleUntil?: string | null
}

export function createAnnouncementFormSchema(options: SchemaOptions = {}) {
  const today = options.today ?? localDateToIsoDate(new Date())
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, 'Escribí el título.')
        .max(
          ANNOUNCEMENT_TITLE_MAX,
          `El título puede tener hasta ${ANNOUNCEMENT_TITLE_MAX} caracteres.`,
        ),
      body: z
        .string()
        .trim()
        .min(1, 'Escribí el texto del anuncio.')
        .max(
          ANNOUNCEMENT_BODY_MAX,
          `El texto puede tener hasta ${ANNOUNCEMENT_BODY_MAX} caracteres.`,
        ),
      audience: z.enum(['employees', 'supervisors', 'all', 'custom']),
      visibleUntil: z.string(),
      recipientIds: z.array(z.string()),
    })
    .superRefine((values, ctx) => {
      if (values.audience === 'custom' && values.recipientIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['recipientIds'],
          message: 'Elegí al menos una persona.',
        })
      }
      if (
        values.visibleUntil !== '' &&
        values.visibleUntil < today &&
        values.visibleUntil !== (options.originalVisibleUntil ?? '')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['visibleUntil'],
          message: 'La fecha «hasta» no puede ser anterior a hoy.',
        })
      }
    })
}

export const announcementFormSchema = createAnnouncementFormSchema()

/** Valores del formulario → entrada de la API. */
export function announcementValuesToInput(
  values: AnnouncementFormValues,
): AnnouncementInput {
  return {
    title: values.title.trim(),
    body: values.body.trim(),
    audience: values.audience,
    visibleUntil: values.visibleUntil === '' ? null : values.visibleUntil,
    recipientIds: values.audience === 'custom' ? values.recipientIds : [],
  }
}
