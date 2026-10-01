import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de ADM-13, ADM-14, ADM-15, y de la sección "Supervisiones" de
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
 * `assign_supervision`/`cancel_supervision` (`06` sección 12: "O; A +
 * manage_supervisions"). También decide si se ve el botón "Asignar
 * supervisión" en ADM-06 y ADM-13.
 */
export function canManageSupervisions(actor: SupervisionsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (isAdmin(actor) && actor.capabilities.includes('manage_supervisions'))
  )
}

/**
 * `mark_supervision_not_done` (`06` sección 12: "S (propia); O, A" -- sin
 * capacidad adicional para el administrador, a diferencia de
 * `canManageSupervisions`; `0029`: "no exige ninguna capacidad para O/A").
 */
export function canMarkSupervisionNotDone(
  actor: SupervisionsScreenActor,
): boolean {
  return isOwner(actor) || isAdmin(actor)
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
