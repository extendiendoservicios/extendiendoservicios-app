import L from 'leaflet'
import type { BadgeVariant } from '@/components/status'

/**
 * Marcadores propios de `MapView`/`MapPicker` con `L.divIcon` (SITE-004,
 * SITE-005), en vez del ícono por omisión de Leaflet: evita el problema
 * clásico de los `.png` del marcador por omisión rotos con Vite (Leaflet
 * arma esas rutas con `L.Icon.Default.imagePath`, que apunta a los
 * archivos del paquete en `node_modules` y no a algo que Vite sirva; la
 * solución habitual de reasignar `iconUrl`/`iconRetinaUrl`/`shadowUrl` a
 * mano con `import ... ?url` no hace falta acá porque no se usa
 * `L.Icon.Default` en absoluto).
 *
 * El pin es un `<div>` con clases de Tailwind que ya apuntan a los tokens
 * del design system (`bg-primary`, `bg-success`, etc., `src/styles/
 * tokens.css`): ninguna variante mete un color suelto acá.
 */
const VARIANT_BG_CLASS: Record<BadgeVariant, string> = {
  neutral: 'bg-text-3',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  dark: 'bg-dark',
  'neutral-strike': 'bg-text-3',
}

const PIN_SIZE = 26

/**
 * Forma del marcador: `dot` (círculo, por omisión) o `supervisor` (rombo con
 * un punto blanco). La forma distinta evita depender solo del color (B-12).
 */
export type MarkerShape = 'dot' | 'supervisor'

/** Ícono de pin coloreado por `variant` (`07` sección 3: mismas variantes que `StatusBadge`). */
export function createMarkerIcon(
  variant: BadgeVariant = 'primary',
  shape: MarkerShape = 'dot',
): L.DivIcon {
  const bgClass = VARIANT_BG_CLASS[variant]
  const html =
    shape === 'supervisor'
      ? `<span class="flex size-full rotate-45 items-center justify-center rounded-[5px] border-2 border-white shadow-[0_1px_4px_rgba(19,21,30,0.35)] ${bgClass}" aria-hidden="true"><span class="size-[7px] rounded-full bg-white"></span></span>`
      : `<span class="block size-full rounded-full border-2 border-white shadow-[0_1px_4px_rgba(19,21,30,0.35)] ${bgClass}" aria-hidden="true"></span>`

  return L.divIcon({
    className: 'es-map-marker',
    html,
    iconSize: [PIN_SIZE, PIN_SIZE],
    // El punto de anclaje queda en el centro del círculo (no en la base,
    // como el pin clásico): es un marcador redondo, no una gota con punta.
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
    popupAnchor: [0, -PIN_SIZE / 2],
  })
}
