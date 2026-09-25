/**
 * Tipos de estado (DS-007): un valor por cada enumeración real del modelo de
 * datos (`04_Modelo_de_Datos.md` sección 9), más los estados derivados que
 * `07_Design_System.md` sección 3 agrega para el tablero (`uncovered`,
 * `upcoming`, `no_record`, `early_leave`).
 *
 * `UserAccountStatus` es la excepción: `07` sección 3 escribe sus dos
 * valores directamente en español ("activo"/"desactivado"; no hay un enum
 * `user_status` en `04`, es un concepto de Auth, no de una tabla del
 * dominio). Se dejan tal cual los escribe el plan.
 */

export type ShiftStatus =
  | 'scheduled'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  // Derivados de `v_shifts_board.display_status` (04 sección 5).
  | 'uncovered'
  | 'upcoming'

export type AssignmentStatus =
  | 'expected'
  | 'delay_notified'
  | 'absence_notified'
  | 'present'
  | 'finished'
  // Derivados de `v_assignments_board.display_status` (04 sección 5).
  | 'no_record'
  | 'early_leave'

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'not_done'

export type SupervisionStatus =
  'assigned' | 'in_progress' | 'completed' | 'not_done' | 'cancelled'

export type EmployeeStatus =
  | 'active'
  | 'terminated'
  // Derivado en `v_employees.effective_status` (04 sección 5).
  | 'on_leave'

export type ClientStatus = 'active' | 'suspended' | 'closed'

export type SiteStatus = 'active' | 'inactive'

export type ServiceStatus = 'active' | 'paused' | 'ended'

export type UserAccountStatus = 'activo' | 'desactivado'

export type StatusDomain =
  | 'shift'
  | 'assignment'
  | 'task'
  | 'supervision'
  | 'employee'
  | 'client'
  | 'site'
  | 'service'
  | 'user'

/** Variantes visuales de `Badge`/`StatusBadge` (`07` sección 3). */
export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'dark'
  | 'neutral-strike'
