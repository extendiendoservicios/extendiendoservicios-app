import type { AdminCapability, Role } from '@/api/users'
import { canManageAttendance } from '@/features/attendance/permissions'

/**
 * Permisos de las correcciones de jornada (P24.3, CJ-32). El servidor vuelve
 * a verificar (`app.require_capability('manage_attendance')` en
 * `admin_correct_workday_event`, `admin_add_workday_pause` y
 * `admin_record_workday`).
 */
interface WorkdayActor {
  roles: Role[]
  capabilities: AdminCapability[]
}

/** Corregir horas, agregar o quitar pausas y registrar una jornada en nombre: dueño, o administrador con `manage_attendance`. */
export function canCorrectWorkdays(actor: WorkdayActor): boolean {
  return canManageAttendance(actor)
}
