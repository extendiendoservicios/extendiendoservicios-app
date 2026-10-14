import { z } from 'zod'
import { GEOFENCE_RADIUS_MAX_M, GEOFENCE_RADIUS_MIN_M } from '@/lib/geo'

/**
 * Esquemas zod del módulo B1 (P22.4): repiten las restricciones que ya exige
 * el servidor (`geofence_radius_m` de 50 a 1000, motivo obligatorio de las
 * correcciones), no las reemplazan -- `set_geofence_radius`, el `check` de
 * `sites` y las RPC de corrección vuelven a validar todo.
 */

export const RADIUS_RANGE_MESSAGE = `El radio tiene que ser un número entero entre ${GEOFENCE_RADIUS_MIN_M} y ${GEOFENCE_RADIUS_MAX_M} metros.`

/** `true` si el texto es un entero entre 50 y 1000. */
export function isValidRadiusText(text: string): boolean {
  const trimmed = text.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    return false
  }
  const value = Number(trimmed)
  return value >= GEOFENCE_RADIUS_MIN_M && value <= GEOFENCE_RADIUS_MAX_M
}

/** Radio general (obligatorio) como texto de un campo numérico. */
export const generalRadiusSchema = z.object({
  radius: z
    .string()
    .trim()
    .min(1, RADIUS_RANGE_MESSAGE)
    .refine(isValidRadiusText, RADIUS_RANGE_MESSAGE),
})

export type GeneralRadiusFormValues = z.infer<typeof generalRadiusSchema>

/**
 * Radio propio de la sede (opcional): vacío deja el general. Se usa como
 * pieza del esquema de ADM-23.
 */
export const siteRadiusFieldSchema = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || isValidRadiusText(value), RADIUS_RANGE_MESSAGE)

/** Texto del campo a número o `null` (vacío = usar el radio general). */
export function radiusTextToValue(text: string | undefined): number | null {
  const trimmed = text?.trim() ?? ''
  return trimmed.length > 0 ? Number(trimmed) : null
}

const reasonSchema = z.string().trim().min(1, 'Escribí el motivo.')

/** «Corregir hora» (`correct_attendance_time`): hora nueva (datetime-local, hora de Argentina) y motivo obligatorio. */
export const correctTimeSchema = z.object({
  at: z.string().trim().min(1, 'Indicá la hora nueva.'),
  reason: reasonSchema,
})

export type CorrectTimeFormValues = z.infer<typeof correctTimeSchema>

/** «Marcar como válido» (`override_geo_validation`): solo el motivo, obligatorio. */
export const overrideGeoSchema = z.object({ reason: reasonSchema })

export type OverrideGeoFormValues = z.infer<typeof overrideGeoSchema>
