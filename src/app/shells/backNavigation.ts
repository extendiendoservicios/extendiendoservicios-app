import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * Flecha "atrás" de las cabeceras de celular (P17.8).
 *
 * Regla: `navigate(-1)` si la persona llegó navegando dentro de la app, y si
 * entró directo por URL (no hay historial propio), el padre lógico de la
 * ruta. Las pantallas raíz de cada tabbar no llevan flecha.
 */

/** Pantallas raíz del tabbar de administración (Hoy, Planificar, Asistencia, Supervisiones). */
export const ADMIN_ROOT_PATHS: readonly string[] = [
  '/admin',
  '/admin/planificacion',
  '/admin/asistencia',
  '/admin/supervisiones',
]

/**
 * Segmentos "intermedios" sin pantalla propia: al subir un nivel desde
 * `/admin/sedes/12` no existe `/admin/sedes`, así que el padre es otro.
 */
const ADMIN_PARENT_OVERRIDES: Record<string, string> = {
  '/admin/turnos': '/admin/planificacion',
  '/admin/sedes': '/admin/clientes',
  '/admin/servicios': '/admin/clientes',
}

const MOBILE_PARENT_OVERRIDES: Record<string, string> = {
  '/app/servicio': '/app',
  '/app/en-curso': '/app',
  '/app/resumen': '/app',
}

function normalize(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function stripLastSegment(pathname: string): string {
  const index = pathname.lastIndexOf('/')
  return index <= 0 ? '/' : pathname.slice(0, index)
}

/**
 * Padre lógico de `pathname` dentro de la vía `rootPath` (`/admin`, `/app` o
 * `/sup`). Si la ruta está fuera de la vía (por ejemplo `/perfil`), vuelve a
 * la raíz de la vía.
 */
export function getParentPath(pathname: string, rootPath: string): string {
  const path = normalize(pathname)
  if (path === rootPath || !path.startsWith(`${rootPath}/`)) {
    return rootPath
  }

  // Las secciones de "Más" de administración (Empleados, Clientes y sedes,
  // Tareas, Configuración y sus pantallas hermanas) vuelven al inicio.
  if (rootPath === '/admin') {
    if (
      path === '/admin/empleados' ||
      path === '/admin/clientes' ||
      path === '/admin/tareas' ||
      path === '/admin/anuncios' ||
      path.startsWith('/admin/configuracion/')
    ) {
      return '/admin'
    }
  }

  let parent = stripLastSegment(path)

  // `/sup/supervisiones/:id/calificar/:assignmentId`: no hay pantalla en
  // `/calificar`, se sube un nivel más.
  if (parent.endsWith('/calificar')) {
    parent = stripLastSegment(parent)
  }

  // `/admin/turnos/:id` o `/app/servicio/:id` suben a un segmento sin
  // pantalla propia: se resuelve con la tabla de excepciones.
  const overrides =
    rootPath === '/admin' ? ADMIN_PARENT_OVERRIDES : MOBILE_PARENT_OVERRIDES
  return overrides[parent] ?? parent
}

/** `true` si la pantalla es una raíz de tabbar de administración. */
export function isAdminRootPath(pathname: string): boolean {
  return ADMIN_ROOT_PATHS.includes(normalize(pathname))
}

/**
 * Acción de "volver" para el `pathname` actual: `navigate(-1)` si hay
 * historial dentro de la app (`location.key` distinto de `'default'`, que es
 * el de la primera entrada), o ir al padre lógico si se entró directo.
 */
export function useGoBack(rootPath: string): () => void {
  const navigate = useNavigate()
  const location = useLocation()
  const { pathname, key } = location

  return useCallback(() => {
    if (key !== 'default') {
      void navigate(-1)
      return
    }
    void navigate(getParentPath(pathname, rootPath), { replace: true })
  }, [key, navigate, pathname, rootPath])
}
