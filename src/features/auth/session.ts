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
  supervisor: 'Coordinador',
  employee: 'Empleado',
}

/**
 * Vía de inicio de quien tiene estos roles (`05_Pantallas_y_Navegacion.md`
 * sección 5, fila COM-01): la usa `RequireRole` para mandar a quien entra a
 * una vía que no le corresponde, y AUTH-004 (`LoginPage`, `router.tsx`) para
 * el redirect al entrar y para `/`. Sin ningún rol, `null` (COM-05,
 * `/sin-acceso`).
 *
 * P29.2 (OG-06, confirmado en C-03): quien tiene `owner` o `admin` entra
 * SIEMPRE a `/admin`, en computadora y en celular, aunque además tenga
 * `employee` o `supervisor` (antes, en ventanas angostas, ganaba `/app` o
 * `/sup`). Para fichar o ver su jornada entra a propósito desde el menú de
 * usuario del panel («Ir a mi app de empleado», OG-08); `RequireRole` de
 * `/app` y `/sup` lo deja pasar porque tiene esos roles. Sin ancho como
 * parámetro: el resultado ya no depende del dispositivo.
 *
 * Con empleado y supervisor a la vez gana `/app`, igual que en
 * `ProfileLayout` (`commonRoutes.tsx`): el acceso a la supervisión está en
 * EMP-13 ("Más").
 */
export function homePathForRoles(roles: Role[]): string | null {
  if (roles.includes('owner') || roles.includes('admin')) return '/admin'
  if (roles.includes('employee')) return '/app'
  if (roles.includes('supervisor')) return '/sup'
  return null
}
