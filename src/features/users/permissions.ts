import type { AdminCapability, Role } from '@/api/users'

/**
 * Lógica de permisos de ADM-27, sin React (USERS-008 a USERS-011): quién ve
 * qué botón. El servidor vuelve a verificar todo esto (Edge Function
 * `admin-users` y las RPC `set_user_roles`/`set_admin_capability`,
 * `06_API.md` sección 2) — acá solo se decide qué mostrar, nunca qué
 * permitir de verdad.
 *
 * Reglas replicadas del servidor (no reinventadas, ver los comentarios de
 * `supabase/functions/admin-users/index.ts` y `supabase/migrations/
 * 0013_rpc_users.sql`):
 * - El dueño puede todo.
 * - Un administrador con la capacidad `manage_users` puede resetear
 *   contraseña, cambiar email, cerrar sesiones y desactivar, pero nunca
 *   sobre alguien que ya tenga rol `owner` o `admin` (`assertCanActOnTarget`
 *   de la Edge Function).
 * - Reactivar es solo del dueño (`06` sección 2.1: "reactivate_user | O").
 * - Crear un usuario con rol `admin` es solo del dueño: un administrador
 *   que lo pidiera se encuentra con `FORBIDDEN` (`create_user`, "A +
 *   manage_users (solo roles supervisor y employee)") -- ADM-27 solo da de
 *   alta administradores (`05_Pantallas_y_Navegacion.md`: "Alta de usuario
 *   administrativo"), así que ese botón directamente no se ofrece a un
 *   administrador (decisión menor, ver el reporte del encargo).
 * - Editar roles y capacidades es solo del dueño en esta pantalla
 *   (`08_Fases_y_Backlog.md`, USERS-010: "ADM-27 edición de roles y
 *   capacidades (solo dueño)") -- más restrictivo que lo que la RPC
 *   `set_user_roles` le permitiría a un administrador con `manage_users`
 *   sobre roles no privilegiados; esa vía más amplia queda para las
 *   pantallas de empleados (ADM-17/ADM-18), no para ADM-27.
 */
export interface UsersScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

export function isOwner(actor: UsersScreenActor): boolean {
  return actor.roles.includes('owner')
}

function isAdminWithManageUsers(actor: UsersScreenActor): boolean {
  return (
    actor.roles.includes('admin') && actor.capabilities.includes('manage_users')
  )
}

function isPrivilegedRoleSet(roles: Role[]): boolean {
  return roles.includes('owner') || roles.includes('admin')
}

/** Puede llamar a las acciones de la Edge Function en general (sujeto a `canActOnUser`). */
export function canManageUsers(actor: UsersScreenActor): boolean {
  return isOwner(actor) || isAdminWithManageUsers(actor)
}

/**
 * Puede resetear contraseña, cambiar email, cerrar sesiones o desactivar a
 * `targetRoles`. El dueño siempre puede (salvo lo que el servidor corte
 * aparte, como `LAST_OWNER`); un administrador con `manage_users` no puede
 * tocar a alguien con rol `owner` o `admin`.
 */
export function canActOnUser(
  actor: UsersScreenActor,
  targetRoles: Role[],
): boolean {
  if (!canManageUsers(actor)) {
    return false
  }
  if (isOwner(actor)) {
    return true
  }
  return !isPrivilegedRoleSet(targetRoles)
}

/** Solo el dueño reactiva (`06` sección 2.1). */
export function canReactivateUser(actor: UsersScreenActor): boolean {
  return isOwner(actor)
}

/** Solo el dueño da de alta un usuario administrativo desde ADM-27. */
export function canCreateAdminUser(actor: UsersScreenActor): boolean {
  return isOwner(actor)
}

/** Solo el dueño edita roles y capacidades desde ADM-27 (USERS-010). */
export function canEditRolesAndCapabilities(actor: UsersScreenActor): boolean {
  return isOwner(actor)
}

/** Cada botón que puede aparecer en el menú "…" de una fila de ADM-27. */
export type UserActionKind =
  | 'edit-roles'
  | 'reset-password'
  | 'update-email'
  | 'sign-out'
  | 'deactivate'
  | 'reactivate'

/**
 * Qué acciones ve `actor` para una fila puntual (`UserActionsMenu.tsx`
 * arma el menú a partir de esta lista, en vez de repetir las mismas
 * condiciones dentro del JSX -- así queda testeable sin renderizar ningún
 * componente de Radix, algo especialmente frágil de simular en jsdom para
 * un menú que abre por puntero).
 */
export function getVisibleUserActions(
  actor: UsersScreenActor,
  user: { roles: Role[]; deletedAt: string | null },
): UserActionKind[] {
  const actions: UserActionKind[] = []
  const isDeactivated = user.deletedAt != null

  if (canEditRolesAndCapabilities(actor)) {
    actions.push('edit-roles')
  }
  if (!isDeactivated && canActOnUser(actor, user.roles)) {
    actions.push('reset-password', 'update-email', 'sign-out', 'deactivate')
  }
  if (isDeactivated && canReactivateUser(actor)) {
    actions.push('reactivate')
  }
  return actions
}
