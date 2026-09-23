import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { RouteFallback } from '@/app/routes/RouteFallback'
import { useAuth } from './AuthProvider'
import { homePathForRoles, type Role } from './session'

/**
 * `RequireRole` (AUTH-008): protección de experiencia por grupo de rutas
 * (`/admin`, `/app`, `/sup`), `05_Pantallas_y_Navegacion.md` sección 5. La
 * protección real de los datos es RLS (`03_Plan_Maestro_Tecnico.md` sección
 * 15) — esto solo evita que alguien vea la navegación de un rol que no
 * tiene.
 *
 * Lee `useAuth()` (`AuthProvider.tsx`), la sesión real de `supabase-js`:
 * - `'loading'` (bootstrap de la sesión persistida, dura milisegundos) →
 *   el mismo `RouteFallback` que usa el `Suspense` de cada shell, para no
 *   parpadear a `/ingresar` mientras `supabase-js` todavía está leyendo la
 *   sesión guardada.
 * - `'unauthenticated'` → `/ingresar` (COM-01). Cualquier sesión que
 *   `supabase-js` no pueda renovar (expiró, fue revocada — AUTH-010) cae
 *   acá también: `AuthProvider` la resuelve a este mismo estado, no hay una
 *   rama aparte para "sesión vencida".
 * - Con sesión pero ningún rol de `allow` → la vía propia de sus roles
 *   (`homePathForRoles`: un empleado que abre `/admin` termina en `/app`),
 *   o `/sin-acceso` (COM-05) si no tiene ningún rol (usuario desactivado o
 *   sin roles asignados — el hook de `0016_hardening.sql` le entrega
 *   claims vacíos, no le niega el login). La vía propia siempre admite al
 *   menos uno de sus roles, así que no hay redirecciones en bucle.
 * - Con un rol permitido → `children`.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: Role[]
  children: ReactNode
}) {
  const { status, roles } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <RouteFallback />
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/ingresar" replace state={{ from: location }} />
  }

  const hasAllowedRole = roles.some((role) => allow.includes(role))
  if (!hasAllowedRole) {
    return <Navigate to={homePathForRoles(roles) ?? '/sin-acceso'} replace />
  }

  return <>{children}</>
}
