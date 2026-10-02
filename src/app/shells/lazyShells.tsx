import { lazy } from 'react'

/**
 * `AdminShell`/`MobileShell` diferidos con `React.lazy` (DS-015: "Carga
 * diferida por vía... para que el celular no descargue el código de
 * administración"). Las pantallas de cada vía se difieren aparte, con la
 * propiedad `lazy` de sus rutas (`routes/lazyPage.ts`, P17.4.1): este archivo
 * cubre solo los shells. Un único punto de definición, usado tanto por
 * `router.tsx` (`/admin`, `/app`, `/sup`) como por `commonRoutes.tsx`
 * (`/perfil`, que elige el shell según el rol en tiempo de ejecución): si
 * cada archivo hiciera su propio `lazy(() => import(...))` del mismo
 * módulo, Vite igual dedupica el chunk, pero importar el componente real
 * (no la versión lazy) desde `commonRoutes.tsx` —siempre presente, nunca
 * lazy— lo metería igual en el bundle principal y anularía la separación
 * por vía para todo el mundo, no solo para quien visita `/perfil`.
 */
export const LazyAdminShell = lazy(() =>
  import('./AdminShell').then((module) => ({ default: module.AdminShell })),
)

export const LazyMobileShell = lazy(() =>
  import('./MobileShell').then((module) => ({ default: module.MobileShell })),
)
