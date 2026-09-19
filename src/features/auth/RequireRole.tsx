import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { homePathForRoles, useSession, type Role } from './session'

/**
 * `RequireRole` (DS-015/AUTH-008): protección de experiencia por grupo de
 * rutas (`/admin`, `/app`, `/sup`), `05_Pantallas_y_Navegacion.md` sección
 * 5. La protección real de los datos es RLS (`03_Plan_Maestro_Tecnico.md`
 * sección 15) — esto solo evita que alguien vea la navegación de un rol que
 * no tiene.
 *
 * Lee `useSession()` (`session.ts`), no `supabase-js` directamente: en F6
 * (AUTH-008) esa función pasa a leer el `AuthProvider` real sin que este
 * componente, ni `router.tsx`, necesiten otro cambio (ver
 * `docs/design-system.md`).
 *
 * - Sin sesión (`unauthenticated`) → `/ingresar` (COM-01). En producción y
 *   en staging es siempre este caso mientras no exista AUTH-002: no hay
 *   ninguna forma de autenticarse todavía. En desarrollo depende del rol
 *   simulado en `/dev/rol` (`devRole.ts`).
 * - Con sesión pero ningún rol de `allow` → la vía propia de sus roles
 *   (`homePathForRoles`: un empleado que abre `/admin` termina en `/app`),
 *   o `/sin-acceso` (COM-05) si no tiene ningún rol. La vía propia siempre
 *   admite al menos uno de sus roles, así que no hay redirecciones en bucle.
 * - Con un rol permitido → `children`.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: Role[]
  children: ReactNode
}) {
  const session = useSession()
  const location = useLocation()

  if (session.status === 'loading') {
    // La implementación provisoria nunca queda en este estado (no hay
    // ninguna llamada asíncrona); se maneja igual para que AUTH-002 no
    // tenga que tocar este componente cuando sí pueda ocurrir.
    return null
  }

  if (session.status === 'unauthenticated') {
    return <Navigate to="/ingresar" replace state={{ from: location }} />
  }

  const hasAllowedRole = session.roles.some((role) => allow.includes(role))
  if (!hasAllowedRole) {
    return (
      <Navigate to={homePathForRoles(session.roles) ?? '/sin-acceso'} replace />
    )
  }

  return <>{children}</>
}
