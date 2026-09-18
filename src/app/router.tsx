import { lazy, Suspense } from 'react'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { ConstructionPage } from '@/pages/common/ConstructionPage'

// React Router 7 en modo biblioteca (SPA, sin modo framework ni SSR — ADR-021).
// Única ruta "real" de esta fase: la página "en construcción". El shell real
// (AdminShell, MobileShell, RequireRole) llega en F5.
const routes: RouteObject[] = [
  {
    path: '/',
    element: <ConstructionPage />,
  },
]

// `/dev/design` (DS-016 parcial, P05.2): vidriera de componentes, solo en
// desarrollo. `import.meta.env.DEV` es una constante que Vite resuelve en
// build (`true`/`false` literal) y luego elimina como código muerto: en
// `pnpm build` este bloque completo -- y el `import()` de la página, que es
// lo que arma su chunk -- desaparece de `dist/` (verificado en la
// verificación de este encargo).
if (import.meta.env.DEV) {
  const DesignPage = lazy(() => import('@/pages/dev/Design'))
  routes.push({
    path: '/dev/design',
    element: (
      <Suspense fallback={null}>
        <DesignPage />
      </Suspense>
    ),
  })
}

export const router = createBrowserRouter(routes)
