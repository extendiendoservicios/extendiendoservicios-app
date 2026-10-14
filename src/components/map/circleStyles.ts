import type { BadgeVariant } from '@/components/status'

/**
 * Círculos de Leaflet (radio de una sede, precisión del GPS) con los tokens
 * del design system: se pintan por clase de Tailwind sobre el `<path>` SVG
 * (`stroke-*`/`fill-*` apuntan a `--success`, `--danger`, etc.), nunca con
 * colores sueltos. El CSS de clase pisa los atributos de presentación que
 * Leaflet pone en el `<path>`.
 */
const CIRCLE_CLASS: Record<BadgeVariant, string> = {
  neutral: 'stroke-text-3 fill-text-3',
  primary: 'stroke-primary fill-primary',
  success: 'stroke-success fill-success',
  warning: 'stroke-warning fill-warning',
  danger: 'stroke-danger fill-danger',
  info: 'stroke-info fill-info',
  dark: 'stroke-dark fill-dark',
  'neutral-strike': 'stroke-text-3 fill-text-3',
}

/** `pathOptions` de un círculo de Leaflet coloreado por variante. */
export function circlePathOptions(
  variant: BadgeVariant,
  options: { fillOpacity?: number; weight?: number; dashArray?: string } = {},
) {
  return {
    className: CIRCLE_CLASS[variant],
    weight: options.weight ?? 2,
    fillOpacity: options.fillOpacity ?? 0.15,
    dashArray: options.dashArray,
  }
}
