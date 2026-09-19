import {
  Calendar,
  CheckSquare,
  Clock,
  Home,
  MapPin,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Navegación de `AdminShell` (DS-013): las ocho secciones de P-121
 * (`07_Design_System.md` "Shells"), agrupadas en "Operación" y
 * "Configuración" (`05_Pantallas_y_Navegacion.md` sección 2: "Resumen ·
 * Planificación · Asistencia · Supervisiones · Empleados · Clientes y
 * sedes · Tareas · Configuración"). Sin campana ni badges de módulos
 * (`07` sección 4).
 *
 * Íconos del mapeo de `07` sección 1.4 (home, calendar, clock, users,
 * map-pin, check-square, settings); `shield` (también en esa lista) para
 * Supervisiones, que no tiene ícono propio asignado ahí.
 */
export interface AdminNavItem {
  label: string
  path: string
  icon: LucideIcon
  /**
   * Prefijos de ruta que marcan este ítem como activo (además de `path`
   * mismo). Por ejemplo, "Clientes y sedes" también se resalta en
   * `/admin/sedes/...` y `/admin/servicios/...` (`05` sección 2.5: sedes y
   * servicios cuelgan de un cliente). Por defecto, solo `path`.
   */
  matchPrefixes?: string[]
}

export const ADMIN_NAV_OPERATION: AdminNavItem[] = [
  { label: 'Resumen', path: '/admin', icon: Home },
  {
    label: 'Planificación',
    path: '/admin/planificacion',
    icon: Calendar,
    matchPrefixes: ['/admin/planificacion', '/admin/turnos'],
  },
  { label: 'Asistencia', path: '/admin/asistencia', icon: Clock },
  { label: 'Supervisiones', path: '/admin/supervisiones', icon: Shield },
  { label: 'Empleados', path: '/admin/empleados', icon: Users },
  {
    label: 'Clientes y sedes',
    path: '/admin/clientes',
    icon: MapPin,
    matchPrefixes: ['/admin/clientes', '/admin/sedes', '/admin/servicios'],
  },
  { label: 'Tareas', path: '/admin/tareas', icon: CheckSquare },
]

export const ADMIN_NAV_CONFIGURATION: AdminNavItem[] = [
  {
    label: 'Configuración',
    path: '/admin/configuracion/usuarios',
    icon: Settings,
    matchPrefixes: ['/admin/configuracion'],
  },
]

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  ...ADMIN_NAV_OPERATION,
  ...ADMIN_NAV_CONFIGURATION,
]

/**
 * Tabbar de administración por debajo de 1024 px (`05` sección 7): "Hoy
 * (ADM-02), Planificar (ADM-05 día), Asistencia (ADM-10), Supervisiones
 * (ADM-13), Más (resto)". "Más" no es un ítem de navegación fijo (no tiene
 * una pantalla propia, agrupa "el resto"): lo arma `AdminShell` aparte,
 * como disparador de un menú, no como un link de esta lista.
 */
export const ADMIN_TABBAR_ITEMS: AdminNavItem[] = [
  { label: 'Hoy', path: '/admin', icon: Home },
  {
    label: 'Planificar',
    path: '/admin/planificacion?vista=dia',
    icon: Calendar,
    matchPrefixes: ['/admin/planificacion', '/admin/turnos'],
  },
  { label: 'Asistencia', path: '/admin/asistencia', icon: Clock },
  { label: 'Supervisiones', path: '/admin/supervisiones', icon: Shield },
]

/** Resto de las secciones, para el menú del botón "Más" del tabbar. */
export const ADMIN_MORE_ITEMS: AdminNavItem[] = [
  { label: 'Empleados', path: '/admin/empleados', icon: Users },
  {
    label: 'Clientes y sedes',
    path: '/admin/clientes',
    icon: MapPin,
  },
  { label: 'Tareas', path: '/admin/tareas', icon: CheckSquare },
  {
    label: 'Configuración',
    path: '/admin/configuracion/usuarios',
    icon: Settings,
  },
]

/**
 * Activo si `pathname` es exactamente el prefijo, o un descendiente de él
 * (`/admin/empleados/12` activa "Empleados", pero `/admin/empleadosx` no).
 * `/admin` es un caso especial: por ser prefijo de toda la sección, solo se
 * activa con coincidencia exacta (si no, "Resumen" quedaría siempre
 * resaltado).
 */
function isPathActive(pathname: string, prefix: string): boolean {
  if (prefix === '/admin') {
    return pathname === '/admin'
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isAdminNavItemActive(
  pathname: string,
  item: AdminNavItem,
): boolean {
  const prefixes = item.matchPrefixes ?? [item.path.split('?')[0] ?? '']
  return prefixes.some((prefix) => isPathActive(pathname, prefix))
}
