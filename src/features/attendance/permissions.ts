import type { AdminCapability, Role } from '@/api/users'

/**
 * Permisos de asistencia administrativa (ATT-010 a ATT-014, ABS-006,
 * ABS-008; `06_API.md` sección 10 y 11): registrar en nombre del empleado
 * (`admin_record_attendance`, `close_assignment`) y avisar demora o
 * ausencia en su nombre (`notify_delay`, `notify_absence`). Mismo criterio
 * que `src/features/planning/permissions.ts`: el servidor vuelve a
 * verificar todo esto (`app.require_capability('manage_attendance')` en
 * cada RPC).
 */
export interface AttendanceScreenActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

/**
 * El dueño siempre tiene la capacidad (regla común de la capa,
 * `app.has_capability`: `owner` -> `true` sin mirar la tabla); un
 * administrador la necesita cargada explícitamente en ADM-27.
 */
export function canManageAttendance(actor: AttendanceScreenActor): boolean {
  return (
    actor.roles.includes('owner') ||
    (actor.roles.includes('admin') &&
      actor.capabilities.includes('manage_attendance'))
  )
}
