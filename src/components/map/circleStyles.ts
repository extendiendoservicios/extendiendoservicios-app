import type { BadgeVariant } from '@/components/status'

/**
 * Círculos de Leaflet (radio de una sede, precisión del GPS) con los tokens
 * del design system. Leaflet solo lee `className` al crear el trazo, y
 * react-leaflet aplica los cambios con `setStyle`; por eso el color va como
 * `color`/`fillColor` explícitos (que sí se actualizan en vivo), leídos de las
 * variables CSS de `tokens.css`. El valor de respaldo es el mismo del token.
 */
const CIRCLE_TOKEN: Record<BadgeVariant, { token: string; fallback: string }> =
  {
    neutral: { token: '--text-3', fallback: '#838b9c' },
    primary: { token: '--primary', fallback: '#569ea4' },
    success: { token: '--success', fallback: '#2f9e6b' },
    warning: { token: '--warning', fallback: '#c8820c' },
    danger: { token: '--danger', fallback: '#ce4b52' },
    info: { token: '--info', fallback: '#3b72c4' },
    dark: { token: '--dark', fallback: '#13151e' },
    'neutral-strike': { token: '--text-3', fallback: '#838b9c' },
  }

/** Color resuelto del token de la variante (hex), para `stroke` y `fill`. */
export function circleColor(variant: BadgeVariant): string {
  const { token, fallback } = CIRCLE_TOKEN[variant]
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
  return value || fallback
}

/** `pathOptions` de un círculo de Leaflet coloreado por variante. */
export function circlePathOptions(
  variant: BadgeVariant,
  options: { fillOpacity?: number; weight?: number; dashArray?: string } = {},
) {
  const color = circleColor(variant)
  return {
    color,
    fillColor: color,
    weight: options.weight ?? 2,
    fillOpacity: options.fillOpacity ?? 0.15,
    dashArray: options.dashArray,
  }
}
