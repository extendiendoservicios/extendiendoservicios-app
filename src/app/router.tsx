import { lazy, Suspense } from 'react'
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  useLocation,
  type RouteObject,
} from 'react-router'
import { NotFoundPage } from '@/pages/common/NotFoundPage'
import { StagingBanner } from '@/components/StagingBanner'
import { RequireRole } from '@/features/auth/RequireRole'
import { useAuth } from '@/features/auth/AuthProvider'
import { homePathForRoles } from '@/features/auth/session'
import { useMediaQuery } from '@/hooks/useMediaQuery'
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
// (INFRA-022, `StagingBanner`): al envolver TODO el árbol de rutas, ningún
// layout tiene que acordarse de agregarlo por su cuenta, y no aparece nunca
// en `production`/`local` (la propia `StagingBanner` no renderiza nada
// fuera de `VITE_APP_ENV=staging`).
//
// Desde AUTH-004/AUTH-005 (P06.3) también es el punto único del redirect
// defensivo de `isPasswordRecovery` hacia `/restablecer` (COM-03) — ver el
// comentario grande de `ResetPasswordPage.tsx` para el detalle.
//
// El caso normal NO lo necesita: `additional_redirect_urls` funciona y
// COM-02 pide `${origin}/restablecer`, así que el enlace cae donde tiene
// que caer. Sigue acá para el caso en que Auth vuelve al `site_url`: eso
// pasa, por diseño, con cualquier origen que no esté en la lista blanca
// (por ejemplo una URL de vista previa de Cloudflare Pages). Ahí la
// persona aterriza en `/` con el token en el hash; como
// `detectSessionInUrl` procesa ese hash sin importar qué ruta esté
// montada, `AuthProvider` igual llega a `isPasswordRecovery: true` — este
// layout, que envuelve
// TODA ruta (la propia `/restablecer` incluida, de ahí el chequeo de
// `pathname`), es el único lugar por el que pasa cualquier ruta a la que
// ese enlace pueda haber caído, así que es el lugar correcto para
// corregirlo sin importar dónde haya aterrizado.
function RootLayout() {
  const { isPasswordRecovery } = useAuth()
  const location = useLocation()

  if (isPasswordRecovery && location.pathname !== '/restablecer') {
    return <Navigate to="/restablecer" replace />
  }

  return (
    <>
      <StagingBanner />
      <Outlet />
    </>
  )
}

/**
 * `/` (AUTH-004, `05` sección 5: "/ → redirige según sesión y rol"):
 * reemplaza a la portada `ConstructionPage` de F5 (borrada en este
 * paquete, junto con el e2e que la probaba — ver el reporte del encargo
 * P06.3). Sin sesión → `/ingresar` (COM-01); con sesión, la vía de sus
 * roles (`homePathForRoles`, con el mismo ancho "de escritorio" que usa
 * `LoginPage` — 1024 px, `05` sección 7) o `/sin-acceso` si no tiene
 * ninguno.
 */
function RootRedirect() {
  const { status, roles } = useAuth()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  if (status === 'loading') {
    return <RouteFallback />
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/ingresar" replace />
  }
  return (
    <Navigate
      to={homePathForRoles(roles, isDesktop) ?? '/sin-acceso'}
      replace
    />
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
  { index: true, element: <RootRedirect /> },
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
