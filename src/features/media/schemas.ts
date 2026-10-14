import { z } from 'zod'
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from '@/api/mediaAdmin'

/**
 * Plazos de vencimiento de fotos y videos (ADM-28, H-17). Repite el
 * `check between 7 and 365` del servidor (`RETENTION_OUT_OF_RANGE`); no lo
 * reemplaza. Texto, no `z.coerce.number()`, como en el resto de los formularios.
 */
const daysSchema = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Indicá los días de las ${what}.`)
    .regex(/^[0-9]+$/, 'Tiene que ser un número entero de días.')
    .refine(
      (value) =>
        Number(value) >= RETENTION_MIN_DAYS &&
        Number(value) <= RETENTION_MAX_DAYS,
      `Tiene que ser de ${RETENTION_MIN_DAYS} a ${RETENTION_MAX_DAYS} días.`,
    )

export const mediaRetentionSchema = z.object({
  photoDays: daysSchema('fotos'),
  videoDays: daysSchema('videos'),
})

export type MediaRetentionFormValues = z.infer<typeof mediaRetentionSchema>

export function retentionValuesToInput(values: MediaRetentionFormValues) {
  return {
    photoDays: Number(values.photoDays),
    videoDays: Number(values.videoDays),
  }
}

/** Lo que se muestra del medidor en bytes: «412 MB», «1,2 GB», «850 KB». */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`
}
