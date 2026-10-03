import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'

/**
 * Carga diferida de una pantalla con la propiedad `lazy` de React Router
 * (RESP-010, P17.4.1). Se usa `lazy` de la ruta y no `React.lazy` + `Suspense`
 * por tres razones:
 *
 * - El `handle` (`screenId`, `title`, `subtitle`) queda en el objeto de la
 *   ruta, que es estático: los shells lo leen con `useMatches()` desde el
 *   primer cuadro, así que la cabecera nunca parpadea sin título.
 * - Al navegar, el router espera al chunk antes de cambiar de pantalla: la
 *   pantalla anterior sigue visible, sin saltos de layout ni fallbacks
 *   intermedios dentro del shell.
 * - Las rutas hermanas y el layout padre cargan sus chunks en paralelo.
 */
export function lazyPage(
  load: () => Promise<{ default: ComponentType }>,
): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      try {
        const module = await load()
        return { Component: module.default }
      } catch (error) {
        if (reloadAfterChunkError()) {
          // La recarga ya está en marcha: no hace falta mostrar el error.
          return new Promise<never>(() => {})
        }
        throw error
      }
    },
  }
}

const RELOAD_KEY = 'es:chunk-reload-at'
/** Ventana para no recargar en bucle si el chunk falta de verdad. */
const RELOAD_WINDOW_MS = 30_000

/**
 * Si alguien tiene la app abierta durante un despliegue, los chunks de la
 * versión anterior dejan de existir en el servidor y la navegación siguiente
 * falla al importarlos. Se recarga la página una vez para tomar la versión
 * nueva; si vuelve a fallar dentro de `RELOAD_WINDOW_MS`, se deja pasar el
 * error. Devuelve `true` si recargó.
 */
export function reloadAfterChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false
  }
  window.location.reload()
  return true
}
