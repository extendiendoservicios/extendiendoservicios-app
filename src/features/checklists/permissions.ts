import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de ADM-26, y de la parte "plantillas" de ADM-21/ADM-22 (TASK-004,
 * `06_API.md` sección 9, P-064): "O; A + edit_checklists" para crear o
 * editar una plantilla o sus ítems. La lectura (ver la plantilla vigente) es
 * de cualquier O/A, sin capacidad -- por eso ADM-26 no se oculta del menú
 * para un administrador sin la capacidad, queda de solo lectura (regla del
 * encargo, mismo criterio que `canCancelShift` en `features/shifts/permissions.ts`).
 *
 * El servidor vuelve a verificar todo esto (`app.require_capability
 * ('edit_checklists')` en `clone_checklist_template`,
 * `0025_rpc_tasks.sql`, y RLS `checklist_templates_write_admin`/
 * `checklist_template_items_write_admin` en `0012_rls_policies.sql`) -- acá
 * solo se decide qué mostrar habilitado.
 */
export interface ChecklistsScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

function isOwner(actor: ChecklistsScreenActor): boolean {
  return actor.roles.includes('owner')
}

/** Crear, editar, reordenar y dar de baja plantillas e ítems (ADM-26, ADM-22). */
export function canEditChecklists(actor: ChecklistsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('edit_checklists'))
  )
}
