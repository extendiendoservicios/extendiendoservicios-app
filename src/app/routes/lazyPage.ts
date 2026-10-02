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
      const module = await load()
      return { Component: module.default }
    },
  }
}
