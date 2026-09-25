import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import {
  mapShiftBoardRow,
  SHIFT_BOARD_SELECT,
  type ShiftBoardRow,
  type ShiftListRow,
  type ShiftStatus,
} from './shifts'
import { weekdayOfIsoDate } from '@/features/settings/dateOnly'

/**
 * `src/api/assignments.ts` (ASSIGN-007, mismo patrón que `src/api/shifts.ts`
 * -- ver `src/api/README.md`): lecturas por rango de fechas de
 * `v_shifts_board`/`v_assignments_board` para ADM-03, ADM-04 y ADM-05
 * completa, y las cuatro RPC de `0024_rpc_assignments.sql` (`06_API.md`
 * sección 8): `assign_employee`, `remove_assignment`,
 * `update_assignment_time`, `update_shift_details`.
 *
 * Las cuatro RPC ya traen `hint` en mayúsculas y `message` en voseo
 * (`0024_rpc_assignments.sql`), así que -- igual que en `shifts.ts` --
 * `fromPostgrestError` las deja pasar tal cual, sin un `mapWriteError`
 * propio.
 *
 * Las pantallas de este paquete (ADM-03, ADM-04, ADM-05) son de solo
 * lectura y navegación: las cuatro mutaciones quedan listas, con hooks y
 * tests, para que P11.3 las use desde ADM-06 (detalle del turno) y ADM-08
 * (drawer "Asignar empleado").
 */

export type AssignmentStatus = Database['public']['Enums']['assignment_status']

/** Las tres advertencias que puede devolver `assign_employee` (`06` sección 8, P-034, P-035, P-033). No bloquean. */
export type AssignEmployeeWarning =
  'NOT_ENABLED_FOR_CLIENT' | 'OUTSIDE_AVAILABILITY' | 'ON_LEAVE'

// -------------------------------------------------------------------------
// 0. Paginado de las lecturas por rango
// -------------------------------------------------------------------------

/**
 * `supabase/config.toml` fija `max_rows = 1000`: PostgREST corta ahí sin
 * avisar. Un mes con 60 clientes y franjas de mañana y tarde puede pasar
 * ese número, y el calendario mostraría el mes incompleto. Se pide de a
 * páginas hasta que una vuelva incompleta. `build` arma la consulta de
 * nuevo en cada vuelta (el builder de PostgREST no se reutiliza) y tiene
 * que ordenar por una clave única al final, para que las páginas no se
 * pisen ni salteen filas.
 */
export const RANGE_PAGE_SIZE = 1000

interface PageQuery<T> {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null
    error: Parameters<typeof fromPostgrestError>[0] | null
  }>
}

async function fetchAllPages<T>(build: () => PageQuery<T>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += RANGE_PAGE_SIZE) {
    const { data, error } = await build().range(
      offset,
      offset + RANGE_PAGE_SIZE - 1,
    )
    if (error) {
      throw fromPostgrestError(error)
    }
    const page = data ?? []
    rows.push(...page)
    if (page.length < RANGE_PAGE_SIZE) {
      return rows
    }
  }
}

// -------------------------------------------------------------------------
// 1. Lecturas por rango de fechas (ADM-03, ADM-05 completa)
// -------------------------------------------------------------------------

export interface ShiftsBoardRangeFilters {
  clientId?: string
  siteId?: string
  /** Turnos donde este empleado tiene una asignación vigente en el rango (resuelto con una consulta aparte a `assignments`). */
  employeeId?: string
  /** `display_status` mostrado (incluye los derivados `uncovered`/`upcoming`, `04` sección 4). */
  status?: string
}

/**
 * `v_shifts_board` entre dos fechas (`06` sección 7: "Calendario mensual |
 * ... | Filtros: cliente, sede, empleado (vía asignaciones), estado
 * mostrado"). Sin límite de horizonte (P-054): quien llama decide el rango.
 */
export async function fetchShiftsBoardByRange(
  from: string,
  to: string,
  filters: ShiftsBoardRangeFilters = {},
): Promise<ShiftListRow[]> {
  let shiftIdsForEmployee: string[] | null = null
  if (filters.employeeId) {
    shiftIdsForEmployee = await fetchShiftIdsAssignedToEmployee(
      filters.employeeId,
      from,
      to,
    )
    if (shiftIdsForEmployee.length === 0) {
      return []
    }
  }

  const employeeShiftIds = shiftIdsForEmployee
  const rows = await fetchAllPages(() => {
    let query = supabase
      .from('v_shifts_board')
      .select(SHIFT_BOARD_SELECT)
      .gte('shift_date', from)
      .lte('shift_date', to)

    if (filters.clientId) {
      query = query.eq('client_id', filters.clientId)
    }
    if (filters.siteId) {
      query = query.eq('site_id', filters.siteId)
    }
    if (filters.status) {
      query = query.eq('display_status', filters.status)
    }
    if (employeeShiftIds) {
      query = query.in('id', employeeShiftIds)
    }

    return query
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
  })
  return rows.map((row) => mapShiftBoardRow(row as ShiftBoardRow))
}

/** Ids de turno con una asignación vigente (`removed_at is null`) de ese empleado en el rango. Auxiliar del filtro "empleado" de ADM-03. */
async function fetchShiftIdsAssignedToEmployee(
  employeeId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('shift_id, shift_date')
    .eq('employee_id', employeeId)
    .is('removed_at', null)
    .gte('shift_date', from)
    .lte('shift_date', to)

  if (error) {
    throw fromPostgrestError(error)
  }
  return Array.from(new Set((data ?? []).map((row) => row.shift_id)))
}

// -------------------------------------------------------------------------
// 2. Grilla semanal por empleado (ADM-04, `v_assignments_board`)
// -------------------------------------------------------------------------

/** Una fila de `v_assignments_board` para la grilla semanal (`06` sección 7: "Grilla semanal por empleado"). */
export interface AssignmentBoardRow {
  id: string
  shiftId: string
  shiftDate: string
  shiftStatus: Database['public']['Enums']['shift_status']
  employeeId: string
  employeeFirstName: string
  employeeLastName: string
  siteId: string
  siteName: string
  clientName: string
  /** Franja efectiva: la propia de la asignación si tiene, si no la del turno (`effective_*`). */
  startTime: string
  endTime: string
  status: AssignmentStatus
  notes: string | null
}

interface AssignmentBoardRawRow {
  id: string
  shift_id: string
  shift_date: string
  shift_status: Database['public']['Enums']['shift_status']
  employee_id: string
  employee_first_name: string
  employee_last_name: string
  site_id: string
  site_name: string
  client_legal_name: string
  effective_start_time: string | null
  effective_end_time: string | null
  status: AssignmentStatus
  notes: string | null
}

const ASSIGNMENT_BOARD_SELECT =
  'id, shift_id, shift_date, shift_status, employee_id, employee_first_name, employee_last_name, site_id, site_name, client_legal_name, effective_start_time, effective_end_time, status, notes'

/**
 * A diferencia de `v_shifts_board` (que trae `client_legal_name` y
 * `client_trade_name`, `04_Modelo_de_Datos.md` sección 4), `v_assignments_board`
 * solo trae la razón social (ver `database.types.ts`) -- el nombre de
 * fantasía queda afuera de la grilla semanal (ADM-04) hasta que la vista lo
 * sume. Reportado al orquestador.
 */
function mapAssignmentBoardRow(row: AssignmentBoardRawRow): AssignmentBoardRow {
  return {
    id: row.id,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    shiftStatus: row.shift_status,
    employeeId: row.employee_id,
    employeeFirstName: row.employee_first_name,
    employeeLastName: row.employee_last_name,
    siteId: row.site_id,
    siteName: row.site_name,
    clientName: row.client_legal_name,
    startTime: row.effective_start_time ?? '',
    endTime: row.effective_end_time ?? '',
    status: row.status,
    notes: row.notes,
  }
}

export interface AssignmentsBoardRangeFilters {
  clientId?: string
  siteId?: string
}

/**
 * Asignaciones vigentes entre dos fechas, para agrupar por empleado y día
 * en el cliente (`06` sección 7: "Grilla semanal por empleado | ... |
 * Agrupado en el cliente por empleado y día").
 */
export async function fetchAssignmentsBoardByRange(
  from: string,
  to: string,
  filters: AssignmentsBoardRangeFilters = {},
): Promise<AssignmentBoardRow[]> {
  const rows = await fetchAllPages(() => {
    let query = supabase
      .from('v_assignments_board')
      .select(ASSIGNMENT_BOARD_SELECT)
      .gte('shift_date', from)
      .lte('shift_date', to)

    if (filters.clientId) {
      query = query.eq('client_id', filters.clientId)
    }
    if (filters.siteId) {
      query = query.eq('site_id', filters.siteId)
    }

    return query
      .order('shift_date', { ascending: true })
      .order('effective_start_time', { ascending: true })
      .order('id', { ascending: true })
  })
  return rows.map((row) => mapAssignmentBoardRow(row as AssignmentBoardRawRow))
}

// -------------------------------------------------------------------------
// 3. assign_employee (usada desde ADM-08, P11.3)
// -------------------------------------------------------------------------

export interface AssignEmployeeInput {
  shiftId: string
  employeeId: string
  /** Franja propia opcional (P-046): si se omiten, la asignación hereda la del turno. */
  start?: string
  end?: string
}

export interface AssignmentRow {
  id: string
  shiftId: string
  employeeId: string
  startTime: string | null
  endTime: string | null
  status: AssignmentStatus
  notes: string | null
}

export interface AssignEmployeeResult {
  assignment: AssignmentRow
  warnings: AssignEmployeeWarning[]
}

function mapAssignmentRow(row: {
  id: string
  shift_id: string
  employee_id: string
  start_time: string | null
  end_time: string | null
  status: AssignmentStatus
  notes: string | null
}): AssignmentRow {
  return {
    id: row.id,
    shiftId: row.shift_id,
    employeeId: row.employee_id,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    notes: row.notes,
  }
}

/**
 * Asigna un empleado a un turno (`06` sección 8: `assign_employee`).
 * Devuelve la asignación creada y las advertencias (no bloquean): las
 * muestra ADM-08 antes de confirmar (P-034, P-035, P-033).
 */
export async function assignEmployee(
  input: AssignEmployeeInput,
): Promise<AssignEmployeeResult> {
  const { data, error } = await supabase.rpc('assign_employee', {
    p_shift_id: input.shiftId,
    p_employee_id: input.employeeId,
    p_start: input.start,
    p_end: input.end,
  })

  if (error) {
    throw fromPostgrestError(error)
  }

  const payload = data as {
    assignment: Parameters<typeof mapAssignmentRow>[0]
    warnings: AssignEmployeeWarning[]
  }
  return {
    assignment: mapAssignmentRow(payload.assignment),
    warnings: payload.warnings ?? [],
  }
}

// -------------------------------------------------------------------------
// 4. remove_assignment (con motivo obligatorio, usada desde ADM-06, P11.3)
// -------------------------------------------------------------------------

/** Quita una asignación con motivo obligatorio (`06` sección 8: `remove_assignment`). */
export async function removeAssignment(
  assignmentId: string,
  reason: string,
): Promise<AssignmentRow> {
  const { data, error } = await supabase.rpc('remove_assignment', {
    p_assignment_id: assignmentId,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAssignmentRow(data)
}

// -------------------------------------------------------------------------
// 5. update_assignment_time (franja propia, usada desde ADM-06, P11.3)
// -------------------------------------------------------------------------

/** Cambia la franja propia de una asignación (`06` sección 8: `update_assignment_time`, P-046). */
export async function updateAssignmentTime(
  assignmentId: string,
  start?: string,
  end?: string,
): Promise<AssignmentRow> {
  const { data, error } = await supabase.rpc('update_assignment_time', {
    p_assignment_id: assignmentId,
    p_start: start,
    p_end: end,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAssignmentRow(data)
}

// -------------------------------------------------------------------------
// 6. update_shift_details (dotación y notas, usada desde ADM-06/ADM-07, P11.3)
// -------------------------------------------------------------------------

export interface ShiftDetailsRow {
  id: string
  requiredStaff: number
  notes: string | null
  status: Database['public']['Enums']['shift_status']
}

/**
 * Edita la dotación y las notas administrativas de un turno (`06` sección 7,
 * corregida en `0024_rpc_assignments.sql`: `update_shift_details`, no un
 * `update` directo de `shifts.notes` -- ver la nota grande de
 * `src/api/shifts.ts`).
 */
export async function updateShiftDetails(
  shiftId: string,
  requiredStaff: number,
  notes?: string | null,
): Promise<ShiftDetailsRow> {
  const { data, error } = await supabase.rpc('update_shift_details', {
    p_shift_id: shiftId,
    p_required_staff: requiredStaff,
    p_notes: notes ?? undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  const row = data as {
    id: string
    required_staff: number
    notes: string | null
    status: Database['public']['Enums']['shift_status']
  }
  return {
    id: row.id,
    requiredStaff: row.required_staff,
    notes: row.notes,
    status: row.status,
  }
}

// -------------------------------------------------------------------------
// 7. Detalle del turno (ADM-06, ASSIGN-011)
// -------------------------------------------------------------------------

/** Una asignación vigente del detalle del turno (ADM-06: "empleado, franja propia, estado"). */
export interface ShiftDetailAssignment {
  id: string
  employeeId: string
  employeeFirstName: string
  employeeLastName: string
  /** Franja propia (P-046); `null` si hereda la del turno. */
  startTime: string | null
  endTime: string | null
  status: AssignmentStatus
  notes: string | null
}

/** Una tarea del checklist copiado al turno, en lectura (ADM-06: "tareas, en lectura"; el alta es F12). */
export interface ShiftDetailTask {
  id: string
  title: string
  description: string | null
  isRequired: boolean
  status: Database['public']['Enums']['task_status']
  position: number
  notDoneReason: string | null
}

/** Una supervisión del turno, en lectura (ADM-06: "supervisiones, en lectura"; el alta es F15). */
export interface ShiftDetailSupervision {
  id: string
  supervisorId: string
  supervisorFirstName: string
  supervisorLastName: string
  status: Database['public']['Enums']['supervision_status']
  assignedAt: string
  generalNotes: string | null
  notDoneReason: string | null
}

export interface ShiftDetail {
  id: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  siteCity: string | null
  shiftDate: string
  startTime: string
  endTime: string
  /** Instante de inicio (`shifts.starts_at`, ADM-08/ADM-06: "después del inicio del turno" de `06` sección 8). */
  startsAt: string | null
  requiredStaff: number
  status: ShiftStatus
  /** `true` si viene de un servicio recurrente; `false` si es puntual (ADM-06: "origen"). */
  fromService: boolean
  notes: string | null
  generated: boolean
  /** Solo las vigentes (`removed_at is null`): las quitadas quedan para historia (P-049), no se muestran acá. */
  assignments: ShiftDetailAssignment[]
  tasks: ShiftDetailTask[]
  supervisions: ShiftDetailSupervision[]
}

/**
 * `06` sección 7: "Detalle del turno | from('shifts') + assignments (con
 * empleado), shift_tasks, attendance_records, attendance_notices,
 * supervisions | Un solo select con embebidos." Sin `attendance_records`/
 * `attendance_notices` acá: ese contenido ("inicio y fin reales, avisos") es
 * de ATT-014 (F14, depende de esta misma tarea) -- el encargo de ASSIGN-011
 * solo pide "asignaciones vigentes (empleado, franja efectiva, estado),
 * tareas en lectura, supervisiones en lectura, notas". Reportado al
 * orquestador.
 *
 * `employees` (no `v_people_basic`) como escalón intermedio hacia
 * `profiles`, con el `hint` de la restricción (`employees_profile_id_fkey`):
 * `employees` tiene tres FK hacia `profiles` (`created_by`, `updated_by`,
 * `profile_id`), así que un embed `profiles(...)` sin el `hint` sería
 * ambiguo para PostgREST -- mismo criterio que `actor`/`target` de
 * `src/api/settings.ts` (`security_events`).
 */
const SHIFT_DETAIL_SELECT = `
  id, client_id, site_id, shift_date, start_time, end_time, required_staff, status, notes, generated, service_id, starts_at,
  client:clients(id, legal_name, trade_name),
  site:sites(id, name, city),
  assignments(
    id, employee_id, start_time, end_time, status, notes, removed_at,
    employees(profile_id, profiles!employees_profile_id_fkey(first_name, last_name))
  ),
  shift_tasks(id, title, description, is_required, status, position, not_done_reason),
  supervisions(
    id, supervisor_id, status, assigned_at, general_notes, not_done_reason,
    employees(profile_id, profiles!employees_profile_id_fkey(first_name, last_name))
  )
`

interface ShiftDetailRawRow {
  id: string
  client_id: string
  site_id: string
  shift_date: string
  start_time: string
  end_time: string
  required_staff: number
  status: ShiftStatus
  notes: string | null
  generated: boolean
  service_id: string | null
  starts_at: string | null
  client: { id: string; legal_name: string; trade_name: string | null } | null
  site: { id: string; name: string; city: string | null } | null
  assignments: {
    id: string
    employee_id: string
    start_time: string | null
    end_time: string | null
    status: AssignmentStatus
    notes: string | null
    removed_at: string | null
    employees: {
      profile_id: string
      profiles: { first_name: string; last_name: string } | null
    } | null
  }[]
  shift_tasks: {
    id: string
    title: string
    description: string | null
    is_required: boolean
    status: Database['public']['Enums']['task_status']
    position: number
    not_done_reason: string | null
  }[]
  supervisions: {
    id: string
    supervisor_id: string
    status: Database['public']['Enums']['supervision_status']
    assigned_at: string
    general_notes: string | null
    not_done_reason: string | null
    employees: {
      profile_id: string
      profiles: { first_name: string; last_name: string } | null
    } | null
  }[]
}

export async function fetchShiftDetail(shiftId: string): Promise<ShiftDetail> {
  const { data, error } = await supabase
    .from('shifts')
    .select(SHIFT_DETAIL_SELECT)
    .eq('id', shiftId)
    .is('deleted_at', null)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }

  const row = data as unknown as ShiftDetailRawRow
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client?.trade_name ?? row.client?.legal_name ?? '',
    siteId: row.site_id,
    siteName: row.site?.name ?? '',
    siteCity: row.site?.city ?? null,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    startsAt: row.starts_at,
    requiredStaff: row.required_staff,
    status: row.status,
    fromService: row.service_id != null,
    notes: row.notes,
    generated: row.generated,
    assignments: row.assignments
      .filter((a) => a.removed_at == null)
      .map((a) => ({
        id: a.id,
        employeeId: a.employee_id,
        employeeFirstName: a.employees?.profiles?.first_name ?? '',
        employeeLastName: a.employees?.profiles?.last_name ?? '',
        startTime: a.start_time,
        endTime: a.end_time,
        status: a.status,
        notes: a.notes,
      })),
    tasks: row.shift_tasks
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        isRequired: t.is_required,
        status: t.status,
        position: t.position,
        notDoneReason: t.not_done_reason,
      })),
    supervisions: row.supervisions.map((s) => ({
      id: s.id,
      supervisorId: s.supervisor_id,
      supervisorFirstName: s.employees?.profiles?.first_name ?? '',
      supervisorLastName: s.employees?.profiles?.last_name ?? '',
      status: s.status,
      assignedAt: s.assigned_at,
      generalNotes: s.general_notes,
      notDoneReason: s.not_done_reason,
    })),
  }
}

// -------------------------------------------------------------------------
// 8. Candidatos para asignar (ADM-08, ASSIGN-012)
// -------------------------------------------------------------------------

/** Otra asignación vigente del mismo empleado ese día (ADM-08: "ya asignado en otro turno del día, con horario"). */
export interface AssignCandidateConflict {
  shiftId: string
  siteName: string
  startTime: string
  endTime: string
}

export interface AssignCandidate {
  employeeId: string
  firstName: string
  lastName: string
  /** `true` si no tiene restricciones cargadas, o si el cliente del turno está entre las habilitadas (P-034: lista vacía = habilitado para todos). */
  enabledForClient: boolean
  /** Mismo criterio para `employee_availability` (P-035, sin filas = sin restricción). */
  availableThatDay: boolean
  /** Licencia vigente el día del turno (P-033; `06` sección 8 la evalúa contra `shift_date`, no contra hoy). */
  onLeave: boolean
  conflicts: AssignCandidateConflict[]
}

export interface AssignCandidatesParams {
  shiftId: string
  clientId: string
  shiftDate: string
  /** Franja del turno (no la propia de la asignación, que todavía no existe): referencia de "disponible ese día y hora". */
  startTime: string
  endTime: string
  /** Empleados con una asignación vigente en ESTE turno: se excluyen de la lista (ya asignados, `06` sección 8: `ALREADY_ASSIGNED`). */
  excludeEmployeeIds: string[]
}

interface SameDayAssignmentRow {
  employee_id: string
  shift_id: string
  start_time: string | null
  end_time: string | null
  shift: {
    start_time: string
    end_time: string
    site: { name: string } | null
  } | null
}

/**
 * Candidatos de `v_employees` para ADM-08 (`06` sección 8: "Candidatos para
 * asignar | from('v_employees').eq('effective_status','active') +
 * habilitaciones y disponibilidad embebidas | El cliente ordena: habilitados
 * y disponibles primero; marca advertencias"). `effective_status = 'active'`
 * ya excluye a quien está de licencia HOY (`0011_views.sql`): si alguien
 * empieza una licencia recién la semana que viene, no aparece como candidato
 * ni para un turno de hoy ni para uno de esa semana que viene, aunque el
 * turno caiga fuera de su licencia -- esa es la regla que pide `06`
 * literalmente (compararla contra `shift_date` en vez de "hoy" es cosa de
 * `assign_employee`, no de este listado). Reportado al orquestador como
 * limitación menor.
 */
export async function fetchAssignCandidates(
  params: AssignCandidatesParams,
): Promise<AssignCandidate[]> {
  const { data: employeesData, error: employeesError } = await supabase
    .from('v_employees')
    .select('profile_id, first_name, last_name')
    .eq('effective_status', 'active')
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })

  if (employeesError) {
    throw fromPostgrestError(employeesError)
  }

  const candidateRows = (employeesData ?? []).filter(
    (row) => !params.excludeEmployeeIds.includes(row.profile_id as string),
  )
  if (candidateRows.length === 0) {
    return []
  }
  const employeeIds = candidateRows.map((row) => row.profile_id as string)
  const weekday = weekdayOfIsoDate(params.shiftDate)

  const [permissionsResult, availabilityResult, leavesResult, sameDayResult] =
    await Promise.all([
      supabase
        .from('employee_client_permissions')
        .select('employee_id, client_id')
        .in('employee_id', employeeIds),
      supabase
        .from('employee_availability')
        .select('employee_id, weekday, start_time, end_time')
        .in('employee_id', employeeIds),
      supabase
        .from('employee_leaves')
        .select('employee_id')
        .in('employee_id', employeeIds)
        .is('deleted_at', null)
        .lte('starts_on', params.shiftDate)
        .or(`ends_on.is.null,ends_on.gte.${params.shiftDate}`),
      supabase
        .from('assignments')
        .select(
          'employee_id, shift_id, start_time, end_time, shift:shifts(start_time, end_time, site:sites(name))',
        )
        .in('employee_id', employeeIds)
        .eq('shift_date', params.shiftDate)
        .neq('shift_id', params.shiftId)
        .is('removed_at', null),
    ])

  for (const result of [
    permissionsResult,
    availabilityResult,
    leavesResult,
    sameDayResult,
  ]) {
    if (result.error) {
      throw fromPostgrestError(result.error)
    }
  }

  const clientIdsByEmployee = new Map<string, string[]>()
  for (const row of permissionsResult.data ?? []) {
    const list = clientIdsByEmployee.get(row.employee_id) ?? []
    list.push(row.client_id)
    clientIdsByEmployee.set(row.employee_id, list)
  }

  const availabilityByEmployee = new Map<
    string,
    { weekday: number; start_time: string; end_time: string }[]
  >()
  for (const row of availabilityResult.data ?? []) {
    const list = availabilityByEmployee.get(row.employee_id) ?? []
    list.push(row)
    availabilityByEmployee.set(row.employee_id, list)
  }

  const onLeaveEmployeeIds = new Set(
    (leavesResult.data ?? []).map((row) => row.employee_id),
  )

  const conflictsByEmployee = new Map<string, AssignCandidateConflict[]>()
  for (const row of (sameDayResult.data ??
    []) as unknown as SameDayAssignmentRow[]) {
    const list = conflictsByEmployee.get(row.employee_id) ?? []
    list.push({
      shiftId: row.shift_id,
      siteName: row.shift?.site?.name ?? '',
      startTime: row.start_time ?? row.shift?.start_time ?? '',
      endTime: row.end_time ?? row.shift?.end_time ?? '',
    })
    conflictsByEmployee.set(row.employee_id, list)
  }

  const candidates: AssignCandidate[] = candidateRows.map((row) => {
    const employeeId = row.profile_id as string
    const enabledClientIds = clientIdsByEmployee.get(employeeId)
    const enabledForClient =
      enabledClientIds == null || enabledClientIds.includes(params.clientId)

    const availabilitySlots = availabilityByEmployee.get(employeeId)
    const availableThatDay =
      availabilitySlots == null ||
      availabilitySlots.some(
        (slot) =>
          slot.weekday === weekday &&
          slot.start_time <= params.startTime &&
          slot.end_time >= params.endTime,
      )

    return {
      employeeId,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
      enabledForClient,
      availableThatDay,
      onLeave: onLeaveEmployeeIds.has(employeeId),
      conflicts: conflictsByEmployee.get(employeeId) ?? [],
    }
  })

  // "Habilitados y disponibles primero" (06 sección 8): el resto queda
  // después, en el mismo orden alfabético que ya trajo la consulta.
  return candidates.sort((a, b) => {
    const rankA = a.enabledForClient && a.availableThatDay && !a.onLeave ? 0 : 1
    const rankB = b.enabledForClient && b.availableThatDay && !b.onLeave ? 0 : 1
    return rankA - rankB
  })
}
