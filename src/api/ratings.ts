import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from './errors'

/**
 * `src/api/ratings.ts` (SUP-008, `06_API.md` sección 13): calificaciones ya
 * cargadas, para la pestaña "Calificaciones" de ADM-13 y la de ADM-17
 * ("Calificaciones recibidas"), más `rate_employee` (edición administrativa
 * de ADM-15, `manage_supervisions` no hace falta acá -- la capacidad es
 * `edit_ratings`, `0029`). Los criterios de calificación
 * (`fetchRatingCriteria`) ya viven en `src/api/settings.ts` desde USERS-015
 * (ADM-30): no se duplican acá.
 *
 * `fetchRatings` trae TODAS las calificaciones con sus datos embebidos (sin
 * filtro por columnas anidadas del lado del servidor) y filtra en el
 * cliente: decisión propia, documentada en el reporte del encargo -- evita
 * depender de filtros `!inner` de PostgREST sobre columnas de dos niveles de
 * profundidad (`assignments.shifts.site_id`, `supervisions.supervisor_id`)
 * sin un entorno para probarlos contra `App_dev`, y la escala esperada
 * (dotación de decenas de personas, `08_Fases_y_Backlog.md` F9) hace que
 * filtrar del lado del cliente sea una alternativa razonable, igual criterio
 * que `fetchAttendanceBoardByDate` con el filtro de texto.
 */

export interface RatingListRow {
  id: string
  supervisionId: string
  assignmentId: string
  employeeId: string
  employeeFirstName: string
  employeeLastName: string
  shiftDate: string
  siteId: string
  siteName: string
  supervisorId: string
  supervisorFirstName: string
  supervisorLastName: string
  score: number
  comment: string | null
  createdAt: string
}

interface RatingRawRow {
  id: string
  supervision_id: string
  assignment_id: string
  score: number
  comment: string | null
  created_at: string
  assignment: {
    employee_id: string
    employees: {
      profile_id: string
      profiles: { first_name: string; last_name: string } | null
    } | null
    shift: {
      shift_date: string
      site_id: string
      sites: { name: string } | null
    } | null
  } | null
  supervision: {
    supervisor_id: string
    employees: {
      profile_id: string
      profiles: { first_name: string; last_name: string } | null
    } | null
  } | null
}

const RATING_LIST_SELECT = `
  id, supervision_id, assignment_id, score, comment, created_at,
  assignment:assignments(
    employee_id,
    employees(profile_id, profiles!employees_profile_id_fkey(first_name, last_name)),
    shift:shifts(shift_date, site_id, sites(name))
  ),
  supervision:supervisions(
    supervisor_id,
    employees(profile_id, profiles!employees_profile_id_fkey(first_name, last_name))
  )
`

function mapRatingRow(row: RatingRawRow): RatingListRow {
  return {
    id: row.id,
    supervisionId: row.supervision_id,
    assignmentId: row.assignment_id,
    employeeId: row.assignment?.employee_id ?? '',
    employeeFirstName: row.assignment?.employees?.profiles?.first_name ?? '',
    employeeLastName: row.assignment?.employees?.profiles?.last_name ?? '',
    shiftDate: row.assignment?.shift?.shift_date ?? '',
    siteId: row.assignment?.shift?.site_id ?? '',
    siteName: row.assignment?.shift?.sites?.name ?? '',
    supervisorId: row.supervision?.supervisor_id ?? '',
    supervisorFirstName: row.supervision?.employees?.profiles?.first_name ?? '',
    supervisorLastName: row.supervision?.employees?.profiles?.last_name ?? '',
    score: row.score,
    comment: row.comment,
    createdAt: row.created_at,
  }
}

export interface RatingListFilters {
  employeeId?: string
  supervisorId?: string
  siteId?: string
  dateFrom?: string
  dateTo?: string
}

function matchesFilters(row: RatingListRow, filters: RatingListFilters) {
  if (filters.employeeId && row.employeeId !== filters.employeeId) {
    return false
  }
  if (filters.supervisorId && row.supervisorId !== filters.supervisorId) {
    return false
  }
  if (filters.siteId && row.siteId !== filters.siteId) {
    return false
  }
  if (filters.dateFrom && row.shiftDate < filters.dateFrom) {
    return false
  }
  if (filters.dateTo && row.shiftDate > filters.dateTo) {
    return false
  }
  return true
}

/**
 * Calificaciones ya cargadas (`06` sección 13: "Calificaciones de un
 * empleado | from('ratings') embebiendo assignments.employee_id | O, A |
 * Lista con filtros"), reutilizada también por la pestaña "Calificaciones"
 * de ADM-13 (`05` línea 57: "fecha, sede, supervisor, puntaje, comentario").
 */
export async function fetchRatings(
  filters: RatingListFilters = {},
): Promise<RatingListRow[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select(RATING_LIST_SELECT)
    .order('created_at', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? [])
    .map((row) => mapRatingRow(row as unknown as RatingRawRow))
    .filter((row) => matchesFilters(row, filters))
}

export interface RateEmployeeInput {
  supervisionId: string
  assignmentId: string
  score: number
  comment?: string | null
}

export interface RatingRow {
  id: string
  supervisionId: string
  assignmentId: string
  score: number
  comment: string | null
  createdAt: string
  updatedAt: string | null
}

/**
 * Upsert de la calificación de un empleado (ADM-15, edición administrativa,
 * `06` sección 13: `rate_employee`, `S` propia dentro del plazo de P-083;
 * `O, A + edit_ratings` siempre). `score` de 1 a 5.
 */
export async function rateEmployee(
  input: RateEmployeeInput,
): Promise<RatingRow> {
  const { data, error } = await supabase.rpc('rate_employee', {
    p_supervision_id: input.supervisionId,
    p_assignment_id: input.assignmentId,
    p_score: input.score,
    p_comment: input.comment ?? undefined,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return {
    id: data.id,
    supervisionId: data.supervision_id,
    assignmentId: data.assignment_id,
    score: data.score,
    comment: data.comment,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

/** Promedio y cantidad de calificaciones de un empleado (`v_employee_ratings`, AJ-04, AJ-05). */
export interface EmployeeRatingSummary {
  average: number
  count: number
}

/**
 * Promedio de calificaciones de todos los empleados en una sola consulta
 * (`v_employee_ratings`, solo dueño y administradores). Los empleados sin
 * calificaciones no tienen fila: quien lo usa muestra «Sin calificaciones».
 */
export async function fetchEmployeeRatingsSummary(): Promise<
  Map<string, EmployeeRatingSummary>
> {
  const { data, error } = await supabase
    .from('v_employee_ratings')
    .select('employee_id, ratings_count, ratings_avg')

  if (error) {
    throw fromPostgrestError(error)
  }

  const summaries = new Map<string, EmployeeRatingSummary>()
  for (const row of data ?? []) {
    if (row.employee_id == null || row.ratings_avg == null) {
      continue
    }
    summaries.set(row.employee_id, {
      average: Number(row.ratings_avg),
      count: row.ratings_count ?? 0,
    })
  }
  return summaries
}
