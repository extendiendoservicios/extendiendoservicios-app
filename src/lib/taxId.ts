/**
 * CUIL / CUIT (AJ2-05): se escribe con o sin guiones ni puntos, la base
 * guarda solo los 11 dígitos y en pantalla se muestra siempre como
 * `XX-XXXXXXXX-X`.
 */

/** Saca todo lo que no sea dígito (puntos, guiones, espacios). */
export function cleanTaxId(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Formato de visualización `20-12345678-3`. Si el valor no tiene exactamente
 * 11 dígitos (datos viejos o incompletos) se devuelve tal cual, sin tocar.
 */
export function formatTaxId(value: string): string
export function formatTaxId(value: string | null | undefined): string | null
export function formatTaxId(value: string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  const digits = cleanTaxId(value)
  if (
    digits.length !== 11 ||
    !/^[0-9]{11}$/.test(value.replace(/[\s.-]/g, ''))
  ) {
    return value
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}

/**
 * Formato mientras se escribe: agrupa lo que haya hasta 11 dígitos
 * (`20`, `20-1234`, `20-12345678-3`). Ignora lo que sobre de 11.
 */
export function formatTaxIdWhileTyping(value: string): string {
  const digits = cleanTaxId(value).slice(0, 11)
  if (digits.length <= 2) {
    return digits
  }
  if (digits.length <= 10) {
    return `${digits.slice(0, 2)}-${digits.slice(2)}`
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
}
