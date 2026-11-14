import { useAuth } from './AuthProvider'
import type { Role } from './session'

/**
 * `true` si la persona tiene al menos uno de los roles pedidos (P29.2).
 * Sirve para mostrar u ocultar opciones de experiencia (por ejemplo «Ir a
 * mi app de empleado»); la seguridad real sigue siendo RLS.
 */
export function useHasRole(...wanted: Role[]): boolean {
  const { roles } = useAuth()
  return roles.some((role) => wanted.includes(role))
}
