import { Suspense } from 'react'
import type { RouteObject } from 'react-router'
import { RequireRole } from '@/features/auth/RequireRole'
import { useAuth } from '@/features/auth/AuthProvider'
import { LazyAdminShell, LazyMobileShell } from '@/app/shells/lazyShells'
import LoginPage from '@/pages/auth/LoginPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import NoAccessPage from '@/pages/auth/NoAccessPage'
import ProfilePage from '@/pages/common/ProfilePage'
import { RouteFallback } from './RouteFallback'
import type { RouteHandle } from './placeholder'

/**
 * Pantallas comunes (DS-015), `05_Pantallas_y_Navegacion.md` sección 5:
 * `ingresar`, `recuperar`, `restablecer` y `sin-acceso` son de acceso
 * público (nadie tiene sesión todavía cuando las ve, o la sesión ya no
 * sirve) y no llevan ningún shell — cada una arma su propia tarjeta
 * centrada con `AuthScreenLayout` (`src/pages/auth/AuthScreenLayout.tsx`).
 * Sin `React.lazy`: son las primeras pantallas que ve cualquiera sin
 * sesión (empezando por `/ingresar`, a donde `/` redirige, `router.tsx`),
 * así que no hay ningún ahorro real en diferirlas — a diferencia de
 * `AdminShell`/`MobileShell` (`lazyShells.tsx`), que sí conviene no bajar
 * hasta saber la vía.
 *
 * Implementadas en P06.3 (AUTH-003/005/006/007): `src/pages/auth/`
 * (`LoginPage`, `ForgotPasswordPage`, `ResetPasswordPage`, `NoAccessPage`)
 * y `src/pages/common/ProfilePage.tsx`.
 *
 * `perfil` (COM-04) sí lleva shell, "según rol" (`05` sección 5): la
 * decide `ProfileLayout` a partir de `useAuth()`, no una ruta fija —
 * owner/admin ven `AdminShell`, empleado `MobileShell` de empleado,
 * supervisor `MobileShell` de supervisor. Usa los mismos `lazy()` que
 * `router.tsx` (`lazyShells.tsx`) para no romper el code splitting por vía:
 * si importara `AdminShell`/`MobileShell` directo, esta ruta (siempre
 * presente, no lazy) los metería igual en el bundle principal.
 *
 * Rutas relativas (sin `/` inicial): estas rutas cuelgan de `RootLayout`
 * (`router.tsx`), un layout sin `path` propio (solo monta el banner de
 * staging y, desde AUTH-004, el redirect defensivo de `isPasswordRecovery`)
 * — con parent "vacío", una ruta relativa `'ingresar'` ya resuelve a
 * `/ingresar`.
 */
function ProfileLayout() {
  const { roles } = useAuth()

  if (roles.includes('owner') || roles.includes('admin')) {
    return <LazyAdminShell />
  }
  if (roles.includes('supervisor') && !roles.includes('employee')) {
    return <LazyMobileShell variant="supervisor" />
  }
  // Empleado, o empleado y supervisor a la vez (acceso cruzado: `05`
  // sección 3, EMP-13 ya incluye el enlace a supervisión en ese caso).
  return <LazyMobileShell variant="employee" />
}

const profileHandle: RouteHandle = {
  screenId: 'COM-04',
  title: 'Mi perfil',
  subtitle: 'Ver y editar datos propios',
}

export const commonRoutes: RouteObject[] = [
  { path: 'ingresar', element: <LoginPage /> },
  { path: 'recuperar', element: <ForgotPasswordPage /> },
  { path: 'restablecer', element: <ResetPasswordPage /> },
  { path: 'sin-acceso', element: <NoAccessPage /> },
  {
    element: (
      <RequireRole allow={['owner', 'admin', 'employee', 'supervisor']}>
        <Suspense fallback={<RouteFallback />}>
          <ProfileLayout />
        </Suspense>
      </RequireRole>
    ),
    children: [
      { path: 'perfil', element: <ProfilePage />, handle: profileHandle },
    ],
  },
]
