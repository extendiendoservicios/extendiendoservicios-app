import type { CSSProperties } from 'react'

/**
 * Paleta de la Agenda (AG-11): 20 colores. Los índices 0–9 son los diez
 * saturados (rojo, azul, amarillo, verde, naranja, lila, rosa, celeste,
 * violeta y turquesa) y los 10–19 son sus pasteles, en el mismo orden. Cada
 * elemento elige un color de borde y uno de relleno por separado.
 *
 * El índice 20 no es de la paleta: es el verde «resuelto» (AG-12), el verde de
 * éxito de la plataforma (`--success`, no un flúor). Lo pone el servidor al
 * tildar «Resuelto».
 *
 * El texto sobre cada relleno sale de la luminancia del color (oscuro o blanco,
 * el que dé más contraste), así que se lee sobre cualquier relleno (AA, 4,5:1;
 * lo prueba `agendaColors.test.ts`).
 */
export interface AgendaColor {
  index: number
  /** Nombre accesible, para el selector. */
  name: string
  hex: string
  /** Color del texto que se apoya sobre este color como relleno. */
  textColor: string
}

const DARK_TEXT = '#1a1a1a'
const LIGHT_TEXT = '#ffffff'

const SATURATED: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Rojo', hex: '#d32f2f' },
  { name: 'Azul', hex: '#1e63d6' },
  { name: 'Amarillo', hex: '#f2c200' },
  { name: 'Verde', hex: '#2e9e44' },
  { name: 'Naranja', hex: '#f07f13' },
  { name: 'Lila', hex: '#b388eb' },
  { name: 'Rosa', hex: '#ec5f9e' },
  { name: 'Celeste', hex: '#29b6e8' },
  { name: 'Violeta', hex: '#7b3fc4' },
  { name: 'Turquesa', hex: '#14a89b' },
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

/** Luminancia relativa (WCAG 2.x) de un color `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Relación de contraste (WCAG 2.x) entre dos colores `#rrggbb`. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  const [lighter, darker] = a >= b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** El texto (oscuro o blanco) que más contrasta con `background`. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, DARK_TEXT) >=
    contrastRatio(background, LIGHT_TEXT)
    ? DARK_TEXT
    : LIGHT_TEXT
}

/** Pastel: el tono saturado mezclado con blanco (28 % de color). */
function pastel(hex: string): string {
  return toHex(parseHex(hex).map((channel) => channel * 0.28 + 255 * 0.72))
}

export const AGENDA_COLORS: readonly AgendaColor[] = [
  ...SATURATED.map((color, index) => ({
    index,
    name: color.name,
    hex: color.hex,
    textColor: readableTextColor(color.hex),
  })),
  ...SATURATED.map((color, index) => {
    const hex = pastel(color.hex)
    return {
      index: index + 10,
      name: `${color.name} pastel`,
      hex,
      textColor: readableTextColor(hex),
    }
  }),
]

/** Índice del relleno «resuelto» (el verde de éxito de la plataforma). */
export const RESOLVED_FILL_INDEX = 20

/** Verde de éxito (`--success`), con su respaldo para la impresión. */
export const RESOLVED_FILL_HEX = '#2e7d32'
export const RESOLVED_FILL_CSS = `var(--success, ${RESOLVED_FILL_HEX})`
export const RESOLVED_TEXT_COLOR = LIGHT_TEXT

export function getAgendaColor(
  index: number | null | undefined,
): AgendaColor | null {
  if (index == null) {
    return null
  }
  return AGENDA_COLORS[index] ?? null
}

export interface AgendaColorStyle {
  /** Color de relleno (CSS) o `null` si no tiene. */
  background: string | null
  /** Color del texto sobre ese relleno, o `null` para el de siempre. */
  color: string | null
  /** Color del borde (CSS) o `null` si no tiene. */
  borderColor: string | null
}

/** Colores efectivos de un par (borde, relleno), con el verde de «resuelto» para el 20. */
export function agendaColorStyle(
  border: number | null | undefined,
  fill: number | null | undefined,
): AgendaColorStyle {
  const borderColor = getAgendaColor(border)?.hex ?? null
  if (fill === RESOLVED_FILL_INDEX) {
    return {
      background: RESOLVED_FILL_CSS,
      color: RESOLVED_TEXT_COLOR,
      borderColor,
    }
  }
  const fillColor = getAgendaColor(fill)
  return {
    background: fillColor?.hex ?? null,
    color: fillColor?.textColor ?? null,
    borderColor,
  }
}

/** Estilo en línea de un bloque de la Agenda (pantalla e impresión). */
export function agendaBlockStyle(
  border: number | null | undefined,
  fill: number | null | undefined,
): CSSProperties {
  const style = agendaColorStyle(border, fill)
  const result: CSSProperties = {}
  if (style.background) {
    result.background = style.background
  }
  if (style.color) {
    result.color = style.color
  }
  if (style.borderColor) {
    result.borderColor = style.borderColor
    result.borderWidth = 2
  }
  return result
}
