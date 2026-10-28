import {
  History,
  Home,
  MoreHorizontal,
  Package,
  Shield,
  type LucideIcon,
} from 'lucide-react'

/**
 * Tabbar de `MobileShell` (DS-014), `05_Pantallas_y_Navegacion.md`
 * secciones 3 y 4:
 * - Empleado: "Hoy · Insumos · Fichar (botón) · Más" (P-122, IS-33).
 * - Supervisor: "Hoy · Supervisiones · Insumos · Historial · Más" (IS-33, el
 *   máximo de cinco de `10_Extension_Points.md`).
 *
 * "Fichar" no es un ítem de esta lista: es el `Fab` de P05.2
 * (`src/components/Fab.tsx`), que `MobileShell` ubica antes del último ítem
 * ("Más") del empleado directamente (no navega con `NavLink`, ver
 * `MobileShell.tsx`).
 */
export interface MobileNavItem {
  label: string
  path: string
  icon: LucideIcon
}

export const EMPLOYEE_TABBAR_ITEMS: MobileNavItem[] = [
  { label: 'Hoy', path: '/app', icon: Home },
  { label: 'Insumos', path: '/app/insumos', icon: Package },
  { label: 'Más', path: '/app/mas', icon: MoreHorizontal },
]

export const SUPERVISOR_TABBAR_ITEMS: MobileNavItem[] = [
  { label: 'Hoy', path: '/sup', icon: Home },
  { label: 'Supervisiones', path: '/sup/supervisiones', icon: Shield },
  { label: 'Insumos', path: '/sup/insumos', icon: Package },
  { label: 'Historial', path: '/sup/historial', icon: History },
  { label: 'Más', path: '/sup/mas', icon: MoreHorizontal },
]

/** Mismo criterio que `isAdminNavItemActive` (`adminNav.ts`). */
export function isMobileNavItemActive(
  pathname: string,
  item: MobileNavItem,
  rootPath: '/app' | '/sup',
): boolean {
  if (item.path === rootPath) {
    return pathname === rootPath
  }
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}
