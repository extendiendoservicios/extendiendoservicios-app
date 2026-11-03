import type { LeaveInRange } from '@/api/employees'

/**
 * P27.5 (OD-12, OD-14, OD-15): filtros compartidos por las tres vistas del
 * calendario de Planificación (mes, semana y día) y licencias del calendario.
 * Lógica sin React. Los filtros viven en la URL de `/admin/planificacion`
 * (`?cliente=&sede=&empleado=&estado=`), así se conservan al cambiar de vista
 * y quedan en el enlace.
 */

export interface CalendarFilters {
  /** Id del cliente, o `'all'`. */
  clientId: string
  siteId: string
  employeeId: string
  /** `display_status` del turno, o `'all'`. */
  status: string
}

export const ALL = 'all'

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  clientId: ALL,
  siteId: ALL,
  employeeId: ALL,
  status: ALL,
}

export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: 'Todos los estados' },
  { value: 'scheduled', label: 'Programado' },
  { value: 'assigned', label: 'Asignado' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Finalizado' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'uncovered', label: 'Sin cubrir' },
]

const PARAM_NAMES = {
  clientId: 'cliente',
  siteId: 'sede',
  employeeId: 'empleado',
  status: 'estado',
} as const

/** Lee los filtros de los parámetros de la URL (lo que falta es «todos»). */
export function readCalendarFilters(params: URLSearchParams): CalendarFilters {
  const read = (key: keyof typeof PARAM_NAMES): string =>
    params.get(PARAM_NAMES[key]) || ALL
  return {
    clientId: read('clientId'),
    siteId: read('siteId'),
    employeeId: read('employeeId'),
    status: read('status'),
  }
}

/** Devuelve una copia de `params` con los filtros escritos (los de «todos» se quitan). */
export function writeCalendarFilters(
  params: URLSearchParams,
  filters: CalendarFilters,
): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of Object.keys(PARAM_NAMES) as (keyof typeof PARAM_NAMES)[]) {
    const value = filters[key]
    if (value && value !== ALL) {
      next.set(PARAM_NAMES[key], value)
    } else {
      next.delete(PARAM_NAMES[key])
    }
  }
  return next
}

export function hasActiveFilters(filters: CalendarFilters): boolean {
  return (
    filters.clientId !== ALL ||
    filters.siteId !== ALL ||
    filters.employeeId !== ALL ||
    filters.status !== ALL
  )
}

/** Filtros para las consultas de `v_shifts_board` (lo de «todos» queda sin definir). */
export function toBoardFilters(filters: CalendarFilters): {
  clientId?: string
  siteId?: string
  employeeId?: string
  status?: string
} {
  return {
    clientId: filters.clientId !== ALL ? filters.clientId : undefined,
    siteId: filters.siteId !== ALL ? filters.siteId : undefined,
    employeeId: filters.employeeId !== ALL ? filters.employeeId : undefined,
    status: filters.status !== ALL ? filters.status : undefined,
  }
}

/** Nombres para el encabezado impreso (se completan desde las listas de opciones). */
export interface FilterNames {
  client?: string
  site?: string
  employee?: string
}

/**
 * Líneas del encabezado impreso que dicen qué filtros se aplicaron
 * (OD-15), por ejemplo `['Cliente: Limpia Ya', 'Estado: Programado']`.
 * Sin filtros devuelve `['Sin filtros']`.
 */
export function describeCalendarFilters(
  filters: CalendarFilters,
  names: FilterNames,
): string[] {
  const lines: string[] = []
  if (filters.clientId !== ALL) {
    lines.push(`Cliente: ${names.client ?? 'sin nombre'}`)
  }
  if (filters.siteId !== ALL) {
    lines.push(`Sede: ${names.site ?? 'sin nombre'}`)
  }
  if (filters.employeeId !== ALL) {
    lines.push(`Empleado: ${names.employee ?? 'sin nombre'}`)
  }
  if (filters.status !== ALL) {
    const label =
      STATUS_FILTER_OPTIONS.find((option) => option.value === filters.status)
        ?.label ?? filters.status
    lines.push(`Estado: ${label}`)
  }
  return lines.length > 0 ? lines : ['Sin filtros']
}

/** Lo mínimo de un turno que hace falta para filtrar la vista de día en el cliente. */
export interface FilterableShift {
  id: string
  clientId?: string | null
  siteId?: string | null
  displayStatus: string
}

/**
 * Filtra los turnos de un día (la vista de día trae todos los del día y se
 * refresca sola). Cliente, sede y estado se resuelven acá; el empleado llega como
 * conjunto de turnos suyos (`shiftIdsOfEmployee`, de una consulta aparte) y
 * es `null` si no hay filtro por empleado.
 */
export function filterShiftsOfDay<T extends FilterableShift>(
  shifts: T[],
  filters: CalendarFilters,
  shiftIdsOfEmployee: ReadonlySet<string> | null,
): T[] {
  return shifts.filter((shift) => {
    if (filters.clientId !== ALL && shift.clientId !== filters.clientId) {
      return false
    }
    if (filters.siteId !== ALL && shift.siteId !== filters.siteId) {
      return false
    }
    if (filters.status !== ALL && shift.displayStatus !== filters.status) {
      return false
    }
    if (filters.employeeId !== ALL) {
      return shiftIdsOfEmployee?.has(shift.id) ?? false
    }
    return true
  })
}

// -------------------------------------------------------------------------
// Licencias en el calendario (OD-14)
// -------------------------------------------------------------------------

/**
 * Qué licencias se muestran con los filtros dados: con un empleado elegido,
 * solo las suyas (junto con sus turnos). Con cliente, sede o estado elegidos
 * y sin empleado, ninguna: la licencia no pertenece a un cliente, una sede ni
 * un estado de turno, y mezclarlas ensuciaría el filtro. Sin filtros, todas.
 */
export function visibleLeaves(
  leaves: readonly LeaveInRange[],
  filters: CalendarFilters,
): LeaveInRange[] {
  if (filters.employeeId !== ALL) {
    return leaves.filter((leave) => leave.employeeId === filters.employeeId)
  }
  if (
    filters.clientId !== ALL ||
    filters.siteId !== ALL ||
    filters.status !== ALL
  ) {
    return []
  }
  return [...leaves]
}

/** `true` si la licencia cubre ese día (`endsOn` vacío = sin fecha de fin). */
export function leaveCoversDate(leave: LeaveInRange, date: string): boolean {
  return (
    leave.startsOn <= date && (leave.endsOn == null || leave.endsOn >= date)
  )
}

/**
 * Empleados de licencia cada día de la lista de fechas: `Map` fecha → ids,
 * sin repetir y solo con las fechas que tienen alguno.
 */
export function leaveEmployeesByDate(
  leaves: readonly LeaveInRange[],
  dates: readonly string[],
): Map<string, string[]> {
  const byDate = new Map<string, string[]>()
  for (const date of dates) {
    const ids: string[] = []
    for (const leave of leaves) {
      if (leaveCoversDate(leave, date) && !ids.includes(leave.employeeId)) {
        ids.push(leave.employeeId)
      }
    }
    if (ids.length > 0) {
      byDate.set(date, ids)
    }
  }
  return byDate
}

/** P27.5: quién está de licencia un día y con qué motivo. */
export interface LeaveEntry {
  name: string
  reason: string | null
}

/** Motivo de la licencia que cubre ese día para ese empleado (vacío = sin motivo). */
export function leaveReasonOn(
  leaves: readonly LeaveInRange[],
  employeeId: string,
  date: string,
): string | null {
  const leave = leaves.find(
    (item) => item.employeeId === employeeId && leaveCoversDate(item, date),
  )
  return leave?.reason?.trim() || null
}

/** Rótulo de una licencia: su motivo («Franco») o «Licencia» si no tiene. */
export function leaveReasonLabel(reason: string | null | undefined): string {
  return reason?.trim() || 'Licencia'
}

/** Nombre y motivo para un título o listado: `Ana Gómez (Franco)`. */
export function leaveEntryText(entry: LeaveEntry): string {
  const reason = entry.reason?.trim()
  return reason ? `${entry.name} (${reason})` : entry.name
}

/**
 * Texto corto de las licencias de un día para una celda del mes: con una
 * persona, `Franco: Ana Gómez` (o `Licencia: Ana Gómez` si no tiene motivo);
 * con varias, `3 licencias` (los nombres y motivos van en el título de la
 * celda).
 */
export function leaveSummaryLabel(
  names: readonly string[],
  reasons: readonly (string | null)[] = [],
): string {
  if (names.length === 1) {
    return `${leaveReasonLabel(reasons[0])}: ${names[0]}`
  }
  return `${names.length} licencias`
}
