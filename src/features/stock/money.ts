/**
 * Pesos de Insumos (IS-34): dos decimales y separadores argentinos
 * (`$ 1.234,50`). Los precios se cargan como texto y se pasan a número acá.
 */

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** `1234.5` -> `$ 1.234,50` (con espacio común, no el no separable de Intl). */
export function formatMoney(value: number): string {
  return moneyFormatter.format(value).split(String.fromCharCode(160)).join(' ')
}

/** Cantidad entera con separador de miles argentino: `1.250`. */
export function formatQty(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(
    value,
  )
}

/**
 * Número a texto para precargar un campo de precio: `1234.5` -> `1234,50`.
 * Sin separador de miles, para que se pueda editar sin estorbos.
 */
export function moneyToInputText(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

/**
 * Pasa lo que escribió la persona a número. Acepta `1234,50`, `1.234,50`,
 * `1234.50`, `$ 1.234,5` y `1.234` (puntos de miles). Devuelve `null` si no es
 * un monto válido (letras, negativo, más de dos decimales).
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[\s$]/g, '')
  if (cleaned === '') return null
  let normalized: string
  if (cleaned.includes(',')) {
    // Con coma decimal, los puntos son de miles.
    if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(cleaned)) return null
    normalized = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // «1.234»: puntos de miles.
    normalized = cleaned.replace(/\./g, '')
  } else if (/^\d+(\.\d+)?$/.test(cleaned)) {
    normalized = cleaned
  } else {
    return null
  }
  const [, decimals = ''] = normalized.split('.')
  if (decimals.length > 2) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Cantidad entera positiva o cero escrita como texto; `null` si no lo es. */
export function parseWholeNumber(text: string): number | null {
  const cleaned = text.trim()
  if (!/^\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isSafeInteger(value) ? value : null
}
