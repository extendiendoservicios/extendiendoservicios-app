import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import {
  mapShiftBoardRow,
  SHIFT_BOARD_SELECT,
  type ShiftBoardRow,
  type ShiftListRow,
} from './shifts'

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
