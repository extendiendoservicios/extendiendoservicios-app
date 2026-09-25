import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de ADM-05, ADM-07 y ADM-09 (`03_Plan_Maestro_Tecnico.md`
 * sección 6, `06_API.md` sección 7), sin React -- mismo criterio que
 * `features/services/permissions.ts`-like modules del resto del repo
 * (`employees/permissions.ts`, `settings/permissions.ts`). El servidor
 * vuelve a verificar todo esto (`app.require_role`/`app.require_capability`
 * en cada RPC, `0023_rpc_shifts.sql`) -- acá solo se decide qué mostrar.
 *
 * - Crear un turno puntual y cambiar su franja: dueño y CUALQUIER
 *   administrador (`06` sección 7: "O, A" a secas para `create_shift` y
 *   `update_shift_time`).
 * - Generar turnos del mes: dueño y administrador con `generate_shifts`
 *   (`06` sección 6).
 * - Cancelar un turno: dueño y administrador con `cancel_shifts`
 *   (`06` sección 7).
 */
export interface ShiftsScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

function isOwner(actor: ShiftsScreenActor): boolean {
  return actor.roles.includes('owner')
}

/** ADM-07: crear turno puntual y cambiar franja de uno existente. */
export function canManageShiftTime(actor: ShiftsScreenActor): boolean {
  return isOwner(actor) || actor.roles.includes('admin')
}

/** ADM-09: ejecutar "Generar turnos del mes". */
export function canGenerateShifts(actor: ShiftsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('generate_shifts'))
  )
}

/** Diálogo de cancelación (SHIFT-011): cancelar un turno con motivo. */
export function canCancelShift(actor: ShiftsScreenActor): boolean {
  return (
    isOwner(actor) ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('cancel_shifts'))
  )
}
