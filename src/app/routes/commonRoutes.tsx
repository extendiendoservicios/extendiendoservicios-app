import { Suspense } from 'react'
import type { RouteObject } from 'react-router'
import { RequireRole } from '@/features/auth/RequireRole'
import { useAuth } from '@/features/auth/AuthProvider'
import { LazyAdminShell, LazyMobileShell } from '@/app/shells/lazyShells'
import { RouteFallback } from './RouteFallback'
import {
  PlaceholderScreen,
  placeholderRoute,
  type RouteHandle,
} from './placeholder'

/**
 * Pantallas comunes (DS-015), `05_Pantallas_y_Navegacion.md` sección 5:
 * `ingresar`, `recuperar`, `restablecer` y `sin-acceso` son de acceso
 * público (nadie tiene sesión todavía cuando las ve, o la sesión ya no
 * sirve) y no llevan ningún shell — tarjeta centrada sobre `--bg`, como
 * COM-01 en el mockup (M01). La autenticación real de estas pantallas es
 * de F6 (AUTH-003/005/006); acá son placeholders.
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
 * staging) — con parent "vacío", una ruta relativa `'ingresar'` ya resuelve
 * a `/ingresar`.
 */
function centeredPlaceholderRoute(
  path: string,
  handle: RouteHandle,
): RouteObject {
  return {
    path,
    element: (
      <div className="grid min-h-dvh place-items-center bg-bg p-6">
        <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 shadow-card">
          <PlaceholderScreen {...handle} />
        </div>
      </div>
    ),
    handle,
  }
}

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

export const commonRoutes: RouteObject[] = [
  centeredPlaceholderRoute('ingresar', {
    screenId: 'COM-01',
    title: 'Ingreso',
    subtitle: 'Iniciar sesión con email y contraseña',
  }),
  centeredPlaceholderRoute('recuperar', {
    screenId: 'COM-02',
    title: 'Recuperar contraseña',
    subtitle: 'Pedir el email de restablecimiento',
  }),
  centeredPlaceholderRoute('restablecer', {
    screenId: 'COM-03',
    title: 'Restablecer contraseña',
    subtitle: 'Definir nueva contraseña desde el enlace del email',
  }),
  centeredPlaceholderRoute('sin-acceso', {
    screenId: 'COM-05',
    title: 'Sin acceso',
    subtitle: 'El usuario fue desactivado o no tiene ningún rol',
  }),
  {
    element: (
      <RequireRole allow={['owner', 'admin', 'employee', 'supervisor']}>
        <Suspense fallback={<RouteFallback />}>
          <ProfileLayout />
        </Suspense>
      </RequireRole>
    ),
    children: [
      placeholderRoute({
        path: 'perfil',
        screenId: 'COM-04',
        title: 'Mi perfil',
        subtitle: 'Ver y editar datos propios',
      }),
    ],
  },
]
