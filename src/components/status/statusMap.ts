import type {
  AssignmentStatus,
  BadgeVariant,
  ClientStatus,
  EmployeeStatus,
  ServiceStatus,
  ShiftStatus,
  SiteStatus,
  SupervisionStatus,
  TaskStatus,
  UserAccountStatus,
} from './types'

/**
 * Mapa único de estados (DS-007): la tabla exacta de `07_Design_System.md`
 * sección 3, dominio por dominio. Es el único lugar del repo donde una
 * variante o una etiqueta de estado se escribe a mano (`07` sección 3 y
 * regla común 1: "usá los IDs del plan tal cual").
 */
interface StatusMeta {
  variant: BadgeVariant
  label: string
}

const SHIFT_STATUS_MAP: Record<ShiftStatus, StatusMeta> = {
  scheduled: { variant: 'neutral', label: 'Programado' },
  assigned: { variant: 'primary', label: 'Asignado' },
  in_progress: { variant: 'success', label: 'En curso' },
  completed: { variant: 'dark', label: 'Finalizado' },
  cancelled: { variant: 'neutral-strike', label: 'Cancelado' },
  uncovered: { variant: 'danger', label: 'Sin cubrir' },
  upcoming: { variant: 'info', label: 'Próximo' },
}

const ASSIGNMENT_STATUS_MAP: Record<AssignmentStatus, StatusMeta> = {
  expected: { variant: 'neutral', label: 'Esperado' },
  delay_notified: { variant: 'warning', label: 'Demora avisada' },
  absence_notified: { variant: 'danger', label: 'Ausencia avisada' },
  present: { variant: 'success', label: 'Presente' },
  finished: { variant: 'dark', label: 'Finalizado' },
  no_record: { variant: 'danger', label: 'Sin registro' },
  early_leave: { variant: 'warning', label: 'Salida anticipada' },
}

const TASK_STATUS_MAP: Record<TaskStatus, StatusMeta> = {
  pending: { variant: 'neutral', label: 'Pendiente' },
  in_progress: { variant: 'primary', label: 'En curso' },
  done: { variant: 'success', label: 'Completada' },
  not_done: { variant: 'danger', label: 'No realizada' },
}

const SUPERVISION_STATUS_MAP: Record<SupervisionStatus, StatusMeta> = {
  assigned: { variant: 'neutral', label: 'Asignada' },
  in_progress: { variant: 'primary', label: 'En curso' },
  completed: { variant: 'success', label: 'Completada' },
  not_done: { variant: 'danger', label: 'No realizada' },
  cancelled: { variant: 'neutral-strike', label: 'Cancelada' },
}

const EMPLOYEE_STATUS_MAP: Record<EmployeeStatus, StatusMeta> = {
  active: { variant: 'success', label: 'Activo' },
  on_leave: { variant: 'warning', label: 'De licencia' },
  terminated: { variant: 'neutral', label: 'Baja' },
}

const CLIENT_STATUS_MAP: Record<ClientStatus, StatusMeta> = {
  active: { variant: 'success', label: 'Activo' },
  suspended: { variant: 'warning', label: 'Suspendido' },
  closed: { variant: 'neutral', label: 'Baja' },
}

const SITE_STATUS_MAP: Record<SiteStatus, StatusMeta> = {
  active: { variant: 'success', label: 'Activa' },
  inactive: { variant: 'neutral', label: 'Inactiva' },
}

/**
 * `04_Modelo_de_Datos.md` sección 3: "service_status | active, paused,
 * ended | Activo, Pausado, Finalizado". Agregada en SERVICE-003 (P10.2):
 * `07_Design_System.md` sección 3 no tenía una fila para servicios (todas
 * las demás tablas del modelo sí la tienen) — variante elegida por
 * analogía con Cliente (`active`/`suspended`/`closed` → éxito/warning/
 * neutral), señalado en el reporte del encargo para que lo confirme
 * front-plataforma y lo sume a `07`.
 */
const SERVICE_STATUS_MAP: Record<ServiceStatus, StatusMeta> = {
  active: { variant: 'success', label: 'Activo' },
  paused: { variant: 'warning', label: 'Pausado' },
  ended: { variant: 'neutral', label: 'Finalizado' },
}

const USER_STATUS_MAP: Record<UserAccountStatus, StatusMeta> = {
  activo: { variant: 'success', label: 'Activo' },
  desactivado: { variant: 'neutral', label: 'Desactivado' },
}

/** Estados de asignación que llevan el sufijo "· n min" (`07` sección 3). */
const MINUTES_SUFFIX_STATUSES: ReadonlySet<AssignmentStatus> = new Set([
  'delay_notified',
  'early_leave',
])

export type StatusBadgeInput =
  | { domain: 'shift'; status: ShiftStatus }
  | { domain: 'assignment'; status: AssignmentStatus; minutes?: number }
  | { domain: 'task'; status: TaskStatus }
  | { domain: 'supervision'; status: SupervisionStatus }
  | { domain: 'employee'; status: EmployeeStatus }
  | { domain: 'client'; status: ClientStatus }
  | { domain: 'site'; status: SiteStatus }
  | { domain: 'service'; status: ServiceStatus }
  | { domain: 'user'; status: UserAccountStatus }

/**
 * Variante y etiqueta para un estado de un dominio dado. Agrega el sufijo
 * "· n min" cuando corresponde (asignación con `delay_notified` o
 * `early_leave` y se pasó `minutes`).
 */
export function getStatusMeta(input: StatusBadgeInput): StatusMeta {
  switch (input.domain) {
    case 'shift':
      return SHIFT_STATUS_MAP[input.status]
    case 'assignment': {
      const meta = ASSIGNMENT_STATUS_MAP[input.status]
      if (input.minutes != null && MINUTES_SUFFIX_STATUSES.has(input.status)) {
        return { ...meta, label: `${meta.label} · ${input.minutes} min` }
      }
      return meta
    }
    case 'task':
      return TASK_STATUS_MAP[input.status]
    case 'supervision':
      return SUPERVISION_STATUS_MAP[input.status]
    case 'employee':
      return EMPLOYEE_STATUS_MAP[input.status]
    case 'client':
      return CLIENT_STATUS_MAP[input.status]
    case 'site':
      return SITE_STATUS_MAP[input.status]
    case 'service':
      return SERVICE_STATUS_MAP[input.status]
    case 'user':
      return USER_STATUS_MAP[input.status]
  }
}

/** Estados de asignación/turno que pintan una fila de tabla (`07` sección 3). */
const CRITICAL_ASSIGNMENT_STATUSES: ReadonlySet<AssignmentStatus> = new Set([
  'no_record',
  'absence_notified',
])
const WARNING_ASSIGNMENT_STATUSES: ReadonlySet<AssignmentStatus> = new Set([
  'delay_notified',
  'early_leave',
])

export type TableRowVariant = 'crit' | 'warn'

/**
 * Helper de filas de tabla (`07` sección 3: "crit cuando hay no_record,
 * uncovered o absence_notified; warn cuando hay delay_notified o
 * early_leave"). Una fila suele tener un turno y una o más asignaciones.
 */
export function getTableRowVariant(row: {
  shiftStatus?: ShiftStatus
  assignmentStatuses?: AssignmentStatus[]
}): TableRowVariant | undefined {
  if (row.shiftStatus === 'uncovered') {
    return 'crit'
  }
  const assignmentStatuses = row.assignmentStatuses ?? []
  if (
    assignmentStatuses.some((status) =>
      CRITICAL_ASSIGNMENT_STATUSES.has(status),
    )
  ) {
    return 'crit'
  }
  if (
    assignmentStatuses.some((status) => WARNING_ASSIGNMENT_STATUSES.has(status))
  ) {
    return 'warn'
  }
  return undefined
}

/** Clase de fondo de `07` sección 3 para cada variante de fila. */
export const TABLE_ROW_CLASS_NAME: Record<TableRowVariant, string> = {
  crit: 'bg-danger-bg',
  warn: 'bg-warning-bg',
}
