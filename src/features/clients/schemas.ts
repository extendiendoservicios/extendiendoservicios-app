import { z } from 'zod'
import type { Coordinates } from '@/components/map'
import { CLIENT_STATUS_LABELS, type ClientStatus } from '@/api/clients'

/**
 * Esquemas zod de ADM-20 y del panel de contactos de ADM-21 (CLIENT-001):
 * repiten las restricciones que ya exige el servidor (`04_Modelo_de_Datos.md`
 * sección 2.2: `cuit` de 11 dígitos, `clients.cuit unique`, un solo contacto
 * principal por cliente), no las reemplazan — `clients_write_admin` y el
 * índice único parcial de `client_contacts` vuelven a validar todo esto.
 */

export const CLIENT_STATUS_OPTIONS: { value: ClientStatus; label: string }[] = (
  ['active', 'suspended', 'closed'] as const
).map((value) => ({
  value,
  label: CLIENT_STATUS_LABELS[value],
}))

/** Cadena vacía → `null` (así no se guarda `''` en una columna opcional). */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/** `04` sección 2.2: "cuit unique | 11 dígitos", igual check que aplica `0016_hardening.sql`. */
const cuitSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^[0-9]{11}$/.test(value),
    'El CUIT tiene que tener 11 dígitos, sin puntos ni guiones.',
  )

export const clientFormSchema = z.object({
  legalName: z.string().trim().min(1, 'Falta la razón social.'),
  tradeName: z.string().trim().optional(),
  cuit: cuitSchema,
  adminAddress: z.string().trim().optional(),
  // Ya validado por `MapPicker` (`useCoordinateFields`, rango de lat/lng):
  // acá solo se declara el tipo para que `react-hook-form` lo trate como un
  // campo más del formulario (Controller), sin repetir esa validación. Sin
  // `.default(...)`: el valor inicial lo pone `defaultValues` del
  // formulario (siempre `null` en ADM-20), no el esquema -- así el tipo de
  // entrada y el de salida coinciden (`Coordinates | null`, nunca
  // `undefined`).
  coordinates: z.custom<Coordinates | null>(),
  status: z.enum(['active', 'suspended', 'closed']),
  notes: z.string().trim().optional(),
})

export type ClientFormValues = z.infer<typeof clientFormSchema>

/** Normaliza los campos de texto opcionales antes de mandarlos a `src/api/clients.ts`. */
export function clientFormValuesToInput(values: ClientFormValues) {
  return {
    legalName: values.legalName.trim(),
    tradeName: emptyToNull(values.tradeName),
    cuit: emptyToNull(values.cuit),
    adminAddress: emptyToNull(values.adminAddress),
    latitude: values.coordinates?.lat ?? null,
    longitude: values.coordinates?.lng ?? null,
    status: values.status,
    notes: emptyToNull(values.notes),
  }
}

/** CLIENT-005: alta y edición de un contacto (formulario en línea de ADM-21). */
export const clientContactFormSchema = z.object({
  name: z.string().trim().min(1, 'Falta el nombre.'),
  roleTitle: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || z.email().safeParse(value).success,
      'Ingresá un email válido.',
    ),
  isPrimary: z.boolean(),
})

export type ClientContactFormValues = z.infer<typeof clientContactFormSchema>

export function clientContactFormValuesToInput(
  values: ClientContactFormValues,
) {
  return {
    name: values.name.trim(),
    roleTitle: emptyToNull(values.roleTitle),
    phone: emptyToNull(values.phone),
    email: emptyToNull(values.email),
    isPrimary: values.isPrimary,
  }
}
