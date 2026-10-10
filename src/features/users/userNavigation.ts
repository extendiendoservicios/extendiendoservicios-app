import type { AdminUserRow } from '@/api/users'

/**
 * AJ2-12: a dónde lleva el clic en una fila de "Usuarios y roles". Quien
 * tiene ficha de empleado (rol empleado o supervisor) abre `/admin/empleados/:id`.
 * Dueños y administradores sin esos roles no tienen ficha ni pantalla de
 * perfil propia en la administración: `null` = la fila no navega.
 */
export function userDetailPath(
  user: Pick<AdminUserRow, 'profileId' | 'roles'>,
): string | null {
  const hasEmployeeRecord =
    user.roles.includes('employee') || user.roles.includes('supervisor')
  return hasEmployeeRecord ? `/admin/empleados/${user.profileId}` : null
}
