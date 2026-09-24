import type { AdminCapability, Role } from '@/api/users'

/**
 * Lógica de permisos de ADM-16, ADM-17 y ADM-18 (EMP-003, EMP-005), sin
 * React -- mismo criterio que `features/users/permissions.ts`. El servidor
 * vuelve a verificar todo esto (Edge Function `admin-users` y las políticas
 * de `employees`, `06_API.md` sección 3 y `04_Modelo_de_Datos.md` sección
 * 7.2) -- acá solo se decide qué mostrar.
 *
 * Reglas replicadas del servidor:
 * - Editar datos laborales y personales: el dueño y CUALQUIER administrador
 *   (`04` sección 7.2: "employees | O, A: todas" sin exigir capacidad;
 *   `employees_update_admin`, `0012_rls_policies.sql`, usa `app.is_admin()`
 *   sin chequear `manage_users`).
 * - Crear, resetear contraseña, cerrar sesiones y dar de baja: el dueño y un
 *   administrador con la capacidad `manage_users` (`06` sección 3: "Crear |
 *   O; A + manage_users"; `06` sección 2.1: mismo requisito para las
 *   acciones de la Edge Function que también aplican acá).
 */
export interface EmployeesScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

function isOwner(actor: EmployeesScreenActor): boolean {
  return actor.roles.includes('owner')
}

function isAdminWithManageUsers(actor: EmployeesScreenActor): boolean {
  return (
    actor.roles.includes('admin') && actor.capabilities.includes('manage_users')
  )
}

/** Alta, resetear contraseña, cerrar sesiones, dar de baja. */
export function canManageEmployeeAccounts(
  actor: EmployeesScreenActor,
): boolean {
  return isOwner(actor) || isAdminWithManageUsers(actor)
}

/** Editar datos laborales y personales (sin exigir `manage_users`). */
export function canEditEmployee(actor: EmployeesScreenActor): boolean {
  return isOwner(actor) || actor.roles.includes('admin')
}
