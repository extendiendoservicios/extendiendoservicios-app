/**
 * Paleta fija de 12 colores por cliente para el calendario de Planificación
 * (P24.8, opción B de la maqueta «color por cliente»). `clients.calendar_color`
 * guarda el índice (0–11) y la base lo asigna sola al crear el cliente.
 *
 * Fondo y texto salen del tono base como en la maqueta
 * (`color-mix(tono 16 % con blanco)` y `color-mix(tono 62 % con negro)`), pero
 * se calculan acá para no depender de `color-mix` y poder probar el contraste
 * AA (4,5:1) en un test. La app no tiene tema oscuro (solo el de alto
 * contraste, también sobre blanco), así que el par sirve para ambos.
 *
 * Ninguno se parece al rojo de «Sin cubrir» ni al verde de «Finalizado»; el
 * oliva y el turquesa quedan lejos del verde de estado (#2f9e6b) por tono y
 * claridad, y el estado va aparte en un puntito.
 */
export interface ClientColor {
  index: number
  /** Nombre accesible, para el selector y la leyenda. */
  name: string
  /** Tono base (puntito de muestra, borde). */
  hex: string
}

export const CLIENT_COLORS: readonly ClientColor[] = [
  { index: 0, name: 'Azul', hex: '#3f6fd8' },
  { index: 1, name: 'Violeta', hex: '#8a56c4' },
  { index: 2, name: 'Naranja', hex: '#e07b22' },
  { index: 3, name: 'Magenta', hex: '#d2477f' },
  { index: 4, name: 'Oliva', hex: '#6f9a1f' },
  { index: 5, name: 'Celeste', hex: '#1f9bc9' },
  { index: 6, name: 'Mostaza', hex: '#b8921a' },
  { index: 7, name: 'Marrón', hex: '#9a6b3f' },
  { index: 8, name: 'Índigo', hex: '#4a4fb8' },
  { index: 9, name: 'Pizarra', hex: '#5f7388' },
  { index: 10, name: 'Turquesa', hex: '#1d9a8f' },
  { index: 11, name: 'Rosa', hex: '#e0679a' },
]

function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function toHex(rgb: number[]): string {
  return `#${rgb
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('')}`
}

/** Mezcla `base` (proporción `share`) con `other` (blanco o negro). */
function mix(base: string, share: number, other: number): string {
  return toHex(parseHex(base).map((c) => c * share + other * (1 - share)))
}

export interface ClientChipColors {
  /** Fondo del chip. */
  background: string
  /** Texto del chip. */
  color: string
  /** Tono base. */
  dot: string
}

export function getClientColor(
  index: number | null | undefined,
): ClientColor | null {
  if (index == null) {
    return null
  }
  return CLIENT_COLORS[index] ?? null
}

/** Colores del chip de un cliente, o `null` si el índice no es válido. */
export function clientChipColors(
  index: number | null | undefined,
): ClientChipColors | null {
  const color = getClientColor(index)
  if (!color) {
    return null
  }
  return {
    background: mix(color.hex, 0.16, 255),
    color: mix(color.hex, 0.62, 0),
    dot: color.hex,
  }
}
