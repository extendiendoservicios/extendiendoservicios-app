import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de ADM-13, ADM-15, y de la sección "Supervisiones" de
 * ADM-06 y la pestaña "Calificaciones" de ADM-17 (SUP-008, `06_API.md`
 * secciones 12 y 13). Sin React, mismo criterio que
 * `src/features/planning/permissions.ts`. El servidor vuelve a verificar
 * todo esto (`app.require_capability`/`app.has_capability` en cada RPC,
 * `0029_rpc_supervisions.sql`).
 */
export interface SupervisionsScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

function isOwner(actor: SupervisionsScreenActor): boolean {
  return actor.roles.includes('owner')
}

function isAdmin(actor: SupervisionsScreenActor): boolean {
  return actor.roles.includes('admin')
}

/**
 * `cancel_supervision`, `set_supervisor_priority` y `remove_supervisor_priority`
 * (`06` sección 12 y P24.1: "O; A + manage_supervisions"). Decide si se ven
 * «Cancelar» en ADM-15 y «Quitar» en el turno, y las preferencias de
 * coordinadores en las fichas del coordinador, del cliente y de la sede.
 */
export function canManageSupervisions(actor: SupervisionsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (isAdmin(actor) && actor.capabilities.includes('manage_supervisions'))
  )
}

/**
 * `rate_employee` sin la ventana de P-083 (`06` sección 13: "O, A +
 * edit_ratings"). En ADM-15 decide si la edición de una calificación ya
 * cargada se ve habilitada fuera del plazo del supervisor (el propio
 * supervisor no entra en esta pantalla administrativa).
 */
export function canEditRatingsAlways(actor: SupervisionsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (isAdmin(actor) && actor.capabilities.includes('edit_ratings'))
  )
}
