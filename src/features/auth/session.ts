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
 * sección 5, fila COM-01): la usa `RequireRole` para mandar a quien entra a
 * una vía que no le corresponde a su propia vía, y AUTH-004 (`LoginPage`,
 * `router.tsx`) para el redirect al entrar y para `/`. Con empleado y
 * supervisor a la vez gana `/app`, igual que en `ProfileLayout`
 * (`commonRoutes.tsx`): el acceso a la supervisión está en EMP-13 ("Más").
 * Sin ningún rol, `null` (COM-05, `/sin-acceso`).
 *
 * `isDesktopWidth` (por omisión `true`, el comportamiento de siempre):
 * la fila de COM-01 tiene CINCO casos, no cuatro — "owner o admin y el
 * ancho es de escritorio → ADM-02" Y, por separado, "admin en móvil →
 * ADM-02 responsive" son el MISMO destino (`/admin`, una sola ruta
 * responsive, `05` sección 7) contado dos veces para dejar explícito que
 * owner/admin sin otro rol también entra por acá en el celular. El ancho
 * sólo importa para alguien que además de owner/admin tiene un rol con
 * experiencia mobile-first propia (empleado o supervisor, sin sidebar
 * responsiva): en el celular, esos roles ganan por sobre owner/admin (un
 * administrador que abre la app desde el teléfono para fichar su propio
 * turno entra por `/app`, no por el `AdminShell` colapsado); en
 * escritorio, owner/admin sigue ganando siempre (regla explícita del
 * primer caso). Por eso el orden de las comprobaciones cambia con
 * `isDesktopWidth` en vez de ser fijo. `RequireRole` no pasa este
 * parámetro (sigue devolviendo `/admin` fijo para owner/admin, ver su
 * comentario): esta regla de ancho es específica de "al entrar" (COM-01,
 * AUTH-004), no de la protección general de rutas — decisión menor, ver
 * el reporte del encargo P06.3.
 */
export function homePathForRoles(
  roles: Role[],
  isDesktopWidth = true,
): string | null {
  const isAdmin = roles.includes('owner') || roles.includes('admin')
  if (isAdmin && isDesktopWidth) return '/admin'
  if (roles.includes('employee')) return '/app'
  if (roles.includes('supervisor')) return '/sup'
  if (isAdmin) return '/admin'
  return null
}
