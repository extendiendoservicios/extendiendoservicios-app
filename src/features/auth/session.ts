import type { Database } from '@/lib/database.types'

/**
 * Utilidades de rol puras (sin React), compartidas por `AuthProvider`
 * (`AuthProvider.tsx`), `RequireRole` y los shells. Hasta P06.2 este
 * archivo tenía además la sesión provisoria de F5 (`useSession`,
 * `SessionState`) y dependía de `devRole.ts`: los tres desaparecieron acá
 * — la sesión real vive en `AuthProvider.tsx` (`useAuth`) y `/dev/rol`
 * (`src/pages/dev/DevRole.tsx`) ahora inicia sesión de verdad contra
 * `App_dev` con una cuenta del seed, sin simular nada.
 */

/** Literalmente `app_role` (`04_Modelo_de_Datos.md` sección 3). */
export type Role = Database['public']['Enums']['app_role']

/**
 * Etiquetas en español de cada rol (`04_Modelo_de_Datos.md`, tabla de
 * `app_role`: "Dueño, Administrador, Supervisor, Empleado"). Las usan los
 * shells para el pie de la sidebar, el menú de usuario y el menú "Más".
 */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  supervisor: 'Supervisor',
  employee: 'Empleado',
}

/**
 * Vía de inicio de quien tiene estos roles (`05_Pantallas_y_Navegacion.md`
 * sección 5): `RequireRole` redirige ahí a quien entra a una vía que no le
 * corresponde, y AUTH-004 (paquete siguiente) la va a usar para el
 * redirect de `/`. Con empleado y supervisor a la vez gana `/app`, igual
 * que en `ProfileLayout` (`commonRoutes.tsx`): el acceso a la supervisión
 * está en EMP-13 ("Más"). Sin ningún rol, `null` (COM-05, `/sin-acceso`).
 */
export function homePathForRoles(roles: Role[]): string | null {
  if (roles.includes('owner') || roles.includes('admin')) return '/admin'
  if (roles.includes('employee')) return '/app'
  if (roles.includes('supervisor')) return '/sup'
  return null
}
