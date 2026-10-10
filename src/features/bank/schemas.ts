import { z } from 'zod'
import type { BankDetails } from '@/api/bankDetails'

/**
 * Validación de «Datos bancarios» (AJ2-04) de los formularios de cliente y de
 * empleado. Repite lo que exige el servidor (`client_bank_details` y
 * `employee_bank_details`, 0040): CBU de 22 dígitos, alias de 6 a 20
 * caracteres (letras, números, punto y guion), banco de hasta 100
 * caracteres. El servidor vuelve a validar y normalizar todo.
 */

export const CBU_LENGTH = 22
export const ALIAS_MAX_LENGTH = 20
export const BANK_NAME_MAX_LENGTH = 100

/** Deja solo los dígitos: se acepta que escriban el CBU con espacios, guiones o puntos. */
export function cleanCbu(value: string): string {
  return value.replace(/[\s.-]/g, '')
}

/** CBU agrupado para leerlo mejor, en dos bloques: 8 y 14 dígitos. */
export function formatCbu(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 8) {
    return digits
  }
  return `${digits.slice(0, 8)} ${digits.slice(8)}`
}

/** Para el campo del formulario: solo dígitos (hasta 22), agrupados mientras se escribe. */
export function formatCbuWhileTyping(value: string): string {
  return formatCbu(value.replace(/\D/g, '').slice(0, CBU_LENGTH))
}

const bankNameSchema = z
  .string()
  .trim()
  .max(
    BANK_NAME_MAX_LENGTH,
    `El nombre del banco puede tener hasta ${BANK_NAME_MAX_LENGTH} caracteres.`,
  )
  .optional()

const cbuSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^[0-9]{22}$/.test(cleanCbu(value)),
    'El CBU tiene que tener exactamente 22 dígitos.',
  )

const aliasSchema = z
  .string()
  .trim()
  .optional()
  .refine(
    (value) => !value || /^[A-Za-z0-9.-]{6,20}$/.test(value),
    'El alias tiene que tener entre 6 y 20 caracteres: letras, números, punto o guion.',
  )

/** Campos de la sección «Datos bancarios»; se suman al esquema de cada formulario. */
export const bankFieldsShape = {
  bankName: bankNameSchema,
  cbu: cbuSchema,
  alias: aliasSchema,
}

export interface BankFormValues {
  bankName?: string
  cbu?: string
  alias?: string
}

/** Valores iniciales del formulario a partir de lo guardado (vacío si no hay nada). */
export function bankDetailsToFormValues(
  details: BankDetails | null | undefined,
): Required<BankFormValues> {
  return {
    bankName: details?.bankName ?? '',
    cbu: formatCbu(details?.cbu),
    alias: details?.alias ?? '',
  }
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/** Del formulario a lo que se manda al servidor: CBU solo con dígitos, vacíos en `null`. */
export function bankFormValuesToInput(values: BankFormValues): BankDetails {
  return {
    bankName: emptyToNull(values.bankName),
    cbu: emptyToNull(values.cbu ? cleanCbu(values.cbu) : values.cbu),
    alias: emptyToNull(values.alias),
  }
}

/** `true` si los tres campos del formulario están vacíos. */
export function isBankFormEmpty(values: BankFormValues): boolean {
  const input = bankFormValuesToInput(values)
  return !input.bankName && !input.cbu && !input.alias
}
