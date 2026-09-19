import { useMatches, type RouteObject } from 'react-router'

/**
 * Metadata de cada ruta placeholder (DS-015): el ID estable de
 * `05_Pantallas_y_Navegacion.md` (`ADM-06`, `EMP-04`, `SUP-03`, `COM-04`…),
 * el título y, para algunas, un subtítulo. `AdminShell` y `MobileShell` la
 * leen con `useRouteHandle` para la topbar / la cabecera de subpágina, sin
 * que cada página tenga que repetirla.
 */
export interface RouteHandle {
  screenId: string
  title: string
  subtitle?: string
}

export function PlaceholderScreen({ screenId, title, subtitle }: RouteHandle) {
  return (
    <div className="flex flex-col gap-2 p-6">
      <p className="text-[11px] font-semibold tracking-[0.5px] text-text-3 uppercase">
        {screenId}
      </p>
      <h1 className="text-[17px] font-semibold tracking-[-0.25px] text-text">
        {title}
      </h1>
      {subtitle && <p className="text-[12.5px] text-text-3">{subtitle}</p>}
      <p className="mt-4 text-sm text-text-2">Pantalla en construcción.</p>
    </div>
  )
}

interface PlaceholderRouteConfig extends RouteHandle {
  /** Ausente solo en la ruta índice (`index: true`) de cada grupo. */
  path?: string
  index?: boolean
}

/**
 * Arma una `RouteObject` con la pantalla placeholder y su `handle`, para no
 * repetir `screenId`/`title`/`subtitle` dos veces por ruta (una vez para lo
 * que se ve, otra para lo que leen los shells).
 */
export function placeholderRoute(config: PlaceholderRouteConfig): RouteObject {
  const { screenId, title, subtitle } = config
  const element = (
    <PlaceholderScreen screenId={screenId} title={title} subtitle={subtitle} />
  )
  const handle: RouteHandle = { screenId, title, subtitle }

  if (config.index) {
    return { index: true, element, handle }
  }
  return { path: config.path, element, handle }
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'screenId' in value &&
    'title' in value
  )
}

/**
 * El `handle` de la ruta hoja actualmente activa (el último `match` de
 * `useMatches()` que tenga uno) — lo usan `AdminShell` (topbar) y
 * `MobileShell` (cabecera de subpágina) para no duplicar título/subtítulo
 * por fuera del árbol de rutas.
 */
export function useRouteHandle(): RouteHandle | undefined {
  const matches = useMatches()
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle
    if (isRouteHandle(handle)) {
      return handle
    }
  }
  return undefined
}
