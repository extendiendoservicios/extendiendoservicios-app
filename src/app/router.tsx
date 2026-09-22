import { lazy, Suspense } from 'react'
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router'
import { ConstructionPage } from '@/pages/common/ConstructionPage'
import { NotFoundPage } from '@/pages/common/NotFoundPage'
import { StagingBanner } from '@/components/StagingBanner'
import { RequireRole } from '@/features/auth/RequireRole'
import { LazyAdminShell, LazyMobileShell } from '@/app/shells/lazyShells'
import { RouteFallback } from './routes/RouteFallback'
import { adminRoutes } from './routes/adminRoutes'
import { employeeRoutes } from './routes/employeeRoutes'
import { supervisorRoutes } from './routes/supervisorRoutes'
import { commonRoutes } from './routes/commonRoutes'

// React Router 7 en modo biblioteca (SPA, sin modo framework ni SSR —
// ADR-021).
//
// `RootLayout` es el único punto de montaje del banner "Entorno de prueba"
// (INFRA-022, `StagingBanner`): al envolver TODO el árbol de rutas (la
// portada incluida), ningún layout tiene que acordarse de agregarlo por su
// cuenta, y no aparece nunca en `production`/`local` (la propia
// `StagingBanner` no renderiza nada fuera de `VITE_APP_ENV=staging`).
function RootLayout() {
  return (
    <>
      <StagingBanner />
      <Outlet />
    </>
  )
}

// DS-015: rutas de `05_Pantallas_y_Navegacion.md` sección 5, como
// placeholders, dentro del shell que corresponda. `RequireRole`
// (`src/features/auth/RequireRole.tsx`, AUTH-008, sesión real de
// `AuthProvider`) protege cada grupo: sin sesión, cualquiera de estas
// rutas redirige a `/ingresar`; con un rol que no corresponde, a la vía
// propia de sus roles (o `/sin-acceso` si no tiene ninguno).
// `AdminShell`/`MobileShell` van
// detrás de `React.lazy` (`lazyShells.tsx`) para que el celular no baje el
// código del shell de administración, ni viceversa (ver tamaños de bundle
// en el reporte del encargo).
const rootChildren: RouteObject[] = [
  {
    index: true,
    element: <ConstructionPage />,
    // Portada pública "Plataforma en construcción": es lo que hoy sirve
    // app.extendiendoservicios.com (verificado por
    // tests/e2e/construction-page.spec.ts) y sigue siendo así hasta F6.
    // AUTH-004 va a reemplazar este `element` por el redirect según sesión
    // y rol que pide `05` sección 5 ("/ → redirige según sesión y rol");
    // hasta entonces `/` no depende de `RequireRole` ni de `useSession`.
  },
  ...commonRoutes,
  {
    path: 'admin',
    element: (
      <RequireRole allow={['owner', 'admin']}>
        <Suspense fallback={<RouteFallback />}>
          <LazyAdminShell />
        </Suspense>
      </RequireRole>
    ),
    children: adminRoutes,
  },
  {
    path: 'app',
    element: (
      <RequireRole allow={['employee']}>
        <Suspense fallback={<RouteFallback />}>
          <LazyMobileShell variant="employee" />
        </Suspense>
      </RequireRole>
    ),
    children: employeeRoutes,
  },
  {
    path: 'sup',
    element: (
      <RequireRole allow={['supervisor']}>
        <Suspense fallback={<RouteFallback />}>
          <LazyMobileShell variant="supervisor" />
        </Suspense>
      </RequireRole>
    ),
    children: supervisorRoutes,
  },
]

// `/dev/design` (DS-016 parcial, P05.2) y `/dev/rol` (atajo de desarrollo
// para entrar con una cuenta real del seed, P06.2): solo en desarrollo.
// `import.meta.env.DEV` es una constante que Vite
// resuelve en build (`true`/`false` literal) y luego elimina como código
// muerto: en `pnpm build` este bloque completo -- y los `import()` de cada
// página, que es lo que arma sus chunks -- desaparece de `dist/`
// (verificado en este encargo, igual que en P05.2).
if (import.meta.env.DEV) {
  const DesignPage = lazy(() => import('@/pages/dev/Design'))
  const DevRolePage = lazy(() => import('@/pages/dev/DevRole'))
  rootChildren.push(
    {
      path: 'dev/design',
      element: (
        <Suspense fallback={null}>
          <DesignPage />
        </Suspense>
      ),
    },
    {
      path: 'dev/rol',
      element: (
        <Suspense fallback={null}>
          <DevRolePage />
        </Suspense>
      ),
    },
  )
}

// Cualquier ruta que no matchea ninguna de las de arriba: 404 simple con la
// marca. Siempre al final (la especificidad de React Router ya la ordena
// después de cualquier ruta más concreta, pero así queda claro a simple
// vista).
rootChildren.push({ path: '*', element: <NotFoundPage /> })

const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: rootChildren,
  },
]

export const router = createBrowserRouter(routes)
