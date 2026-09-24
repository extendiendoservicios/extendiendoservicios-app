import { z } from 'zod'
import type { Coordinates } from '@/components/map'
import { SITE_STATUS_LABELS, type SiteStatus } from '@/api/sites'

/**
 * Esquemas zod de ADM-23 (SITE-001): repiten las restricciones que ya exige
 * el servidor (`04_Modelo_de_Datos.md` sección 2.2: `name`/`address` no
 * nulos, nombre único por cliente), no las reemplazan —
 * `sites_write_admin` y el índice único `sites_client_id_name_key` vuelven
 * a validar todo esto.
 */

export const SITE_STATUS_OPTIONS: { value: SiteStatus; label: string }[] = (
  ['active', 'inactive'] as const
).map((value) => ({
  value,
  label: SITE_STATUS_LABELS[value],
}))

/** Cadena vacía → `null` (así no se guarda `''` en una columna opcional). */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export const siteFormSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre de la sede.'),
  address: z.string().trim().min(1, 'Falta la dirección.'),
  city: z.string().trim().optional(),
  // Ya validado por `MapPicker` (`useCoordinateFields`, rango de lat/lng):
  // acá solo se declara el tipo para que `react-hook-form` lo trate como un
  // campo más del formulario (Controller), mismo criterio que
  // `clientFormSchema.coordinates`.
  coordinates: z.custom<Coordinates | null>(),
  contactName: z.string().trim().optional(),
  contactPhone: z.string().trim().optional(),
  accessInstructions: z.string().trim().optional(),
  buildingHours: z.string().trim().optional(),
  phoneRestricted: z.boolean(),
  photosNotAllowed: z.boolean(),
  restrictionsNotes: z.string().trim().optional(),
  status: z.enum(['active', 'inactive']),
})

export type SiteFormValues = z.infer<typeof siteFormSchema>

/** Normaliza los campos de texto opcionales antes de mandarlos a `src/api/sites.ts`. */
export function siteFormValuesToInput(values: SiteFormValues) {
  return {
    name: values.name.trim(),
    address: values.address.trim(),
    city: emptyToNull(values.city),
    latitude: values.coordinates?.lat ?? null,
    longitude: values.coordinates?.lng ?? null,
    contactName: emptyToNull(values.contactName),
    contactPhone: emptyToNull(values.contactPhone),
    accessInstructions: emptyToNull(values.accessInstructions),
    buildingHours: emptyToNull(values.buildingHours),
    phoneRestricted: values.phoneRestricted,
    photosNotAllowed: values.photosNotAllowed,
    restrictionsNotes: emptyToNull(values.restrictionsNotes),
    status: values.status,
  }
}
