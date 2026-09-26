import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de ADM-06 y ADM-08 (ASSIGN-011 a ASSIGN-013, `06_API.md`
 * sección 8): asignar, quitar y cambiar la franja propia de una asignación,
 * y editar la dotación/notas del turno. Sin React, mismo criterio que
 * `src/features/shifts/permissions.ts`. El servidor vuelve a verificar todo
 * esto (`app.require_role`/`app.has_capability` en cada RPC,
 * `0024_rpc_assignments.sql`).
 */
export interface AssignmentsScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

function isOwner(actor: AssignmentsScreenActor): boolean {
  return actor.roles.includes('owner')
}

/**
 * Asignar, quitar y editar la dotación/notas del turno, ANTES de que el
 * turno empiece (`06` sección 7 y 8: "O, A" a secas). Después de la hora de
 * inicio hace falta además `manage_attendance` (`canManageAssignmentsAfterStart`).
 */
export function canManageAssignments(actor: AssignmentsScreenActor): boolean {
  return isOwner(actor) || actor.roles.includes('admin')
}

/**
 * `assign_employee`/`remove_assignment` después de que el turno empezó
 * (`06` sección 8: "O, A (después del inicio del turno: + manage_attendance)",
 * `0024_rpc_assignments.sql`: `SHIFT_STARTED` si falta la capacidad).
 */
export function canManageAssignmentsAfterStart(
  actor: AssignmentsScreenActor,
): boolean {
  return (
    isOwner(actor) ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('manage_attendance'))
  )
}

/**
 * `update_task_status` desde ADM-06 (TASK-006, `0025_rpc_tasks.sql`:
 * `app.is_admin()` -- owner o CUALQUIER administrador, sin capacidad
 * puntual, en cualquier momento del turno, P-063). Hoy coincide con
 * `canManageAssignments`, pero es una regla propia del servidor (no
 * comparte código con `assign_employee`): se deja como función aparte para
 * que un cambio futuro de una no arrastre a la otra por accidente.
 */
export function canManageTasks(actor: AssignmentsScreenActor): boolean {
  return isOwner(actor) || actor.roles.includes('admin')
}
