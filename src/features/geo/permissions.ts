import type { AdminCapability, Role } from '@/api/users'
import { canManageAttendance } from '@/features/attendance/permissions'
import type { BoardAttendanceGeo } from '@/api/attendance'

/**
 * Permisos del módulo B1 en administración. El servidor vuelve a verificar
 * (`require_capability('manage_attendance')`, `require_admin`).
 */
interface GeoActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

/** «Corregir hora» y «Marcar como válido»: dueño, o administrador con `manage_attendance` (B-09, B-28). */
export function canCorrectAttendance(actor: GeoActor): boolean {
  return canManageAttendance(actor)
}

/** Radio general (B-02, `set_geofence_radius`): dueño y administradores. */
export function canEditGeofenceRadius(actor: Pick<GeoActor, 'roles'>): boolean {
  return actor.roles.includes('owner') || actor.roles.includes('admin')
}

/**
 * «Marcar como válido» (B-09): solo si el fichaje está en rojo o gris y no
 * se marcó ya.
 */
export function canMarkGeoAsValid(
  geo: Pick<BoardAttendanceGeo, 'status' | 'overridden'> | null | undefined,
): boolean {
  return geo != null && geo.status !== 'valid' && !geo.overridden
}
