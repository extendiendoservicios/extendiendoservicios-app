import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import type { GeoStatus, GeoUnvalidatedReason } from '@/lib/geo'
import { fromPostgrestError } from './errors'
import { mapBoardAttendanceGeo, type BoardAttendanceGeo } from './attendance'

/**
 * `src/api/supervisions.ts` (SUP-008, mismo patrón que `src/api/assignments.ts`
 * -- ver `src/api/README.md`): listado y detalle de `v_supervisions_admin`
 * para ADM-13 y ADM-15, más la única RPC administrativa que queda,
 * `cancel_supervision` (`06_API.md` sección 12).
 *
 * P24.3 (coordinación libre, CJ-01 y CJ-26): desaparece la asignación
 * manual. `assign_supervision` y `mark_supervision_not_done` están revocadas
 * en el servidor (dan 42501) y se quitaron de acá; el coordinador elige y
 * toma el turno él mismo (`take_supervision`, de la app del coordinador).
 * Un turno puede tener varias supervisiones (CJ-05) y la duración de cada
 * una es informativa (CJ-14).
 *
 * `cancel_supervision` ya trae `hint` en mayúsculas y `message` en voseo, así
 * que `fromPostgrestError` lo deja pasar tal cual.
 */

export type SupervisionStatus =
  Database['public']['Enums']['supervision_status']

/**
 * Las cinco etiquetas de `04_Modelo_de_Datos.md` sección 3. `assigned` y
 * `not_done` ya no se generan (CJ-26), pero quedan en el historial.
 */
export const SUPERVISION_STATUS_LABELS: Record<SupervisionStatus, string> = {
  assigned: 'Asignada',
  in_progress: 'En curso',
  completed: 'Completada',
  not_done: 'No realizada',
  cancelled: 'Cancelada',
}

// -------------------------------------------------------------------------
// 1. Listado administrativo (ADM-13, `v_supervisions_admin`)
// -------------------------------------------------------------------------

/** Un criterio de `criteria_snapshot` (`0029`: "arreglo de objetos `{id, title, description, position}`"). */
export interface SupervisionCriterion {
  id: string
  title: string
  description: string | null
  position: number
}

/** Una fila de `v_supervisions_admin` para ADM-13 (`05` línea 57). */
export interface SupervisionListRow {
  id: string
  shiftId: string
  shiftDate: string
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  startTime: string
  endTime: string
  /** AJ2-10: el turno supervisado es «A terminar» (el fin 23:59 no se muestra). */
  shiftOpenEnded: boolean
  supervisorId: string
  supervisorFirstName: string
  supervisorLastName: string
  status: SupervisionStatus
  assignedAt: string
  checkInAt: string | null
  checkOutAt: string | null
  generalNotes: string | null
  cancelReason: string | null
  notDoneReason: string | null
  criteriaSnapshot: SupervisionCriterion[]
  ratingsCount: number
  ratingsAvg: number | null
  assignedEmployeesCount: number
  /** Minutos previstos de la franja (AJ-06); `null` si el turno es «A terminar» (AJ2-10). */
  plannedMinutes: number | null
  /** Minutos trabajados, de inicio a fin real; `null` sin fin registrado (AJ-06). */
  workedMinutes: number | null
  // Opcionales a propósito: las fixtures de otros dominios arman filas sin estos campos.
  /** P24.1: jornada del coordinador a la que pertenece; `null` en las anteriores a la coordinación libre. */
  workdayId?: string | null
  /** CJ-14: duración informativa (no suma horas); cuenta hasta ahora si sigue abierta. */
  durationMinutes?: number | null
  /** CJ-31: «Sin cerrar», la jornada se cerró sola con la supervisión abierta. */
  unclosed?: boolean
  /** CJ-31: la jornada de esta supervisión se cerró automáticamente. */
  workdayAutoClosed?: boolean
  /** B1 (B-07): validación por ubicación del fichaje de inicio y de fin; `null` si no hay fichaje. `recordId` es el de `supervision_attendance`. */
  checkInGeo?: BoardAttendanceGeo | null
  checkOutGeo?: BoardAttendanceGeo | null
}

interface SupervisionListRawRow {
  id: string
  shift_id: string
  shift_date: string
  client_id: string
  client_legal_name: string
  site_id: string
  site_name: string
  start_time: string
  end_time: string
  shift_open_ended: boolean | null
  supervisor_id: string
  supervisor_first_name: string
  supervisor_last_name: string
  status: SupervisionStatus
  assigned_at: string
  check_in_at: string | null
  check_out_at: string | null
  general_notes: string | null
  cancel_reason: string | null
  not_done_reason: string | null
  criteria_snapshot: SupervisionCriterion[] | null
  ratings_count: number
  ratings_avg: number | null
  assigned_employees_count: number
  planned_minutes: number | null
  worked_minutes: number | null
  workday_id: string | null
  duration_minutes: number | null
  unclosed: boolean | null
  workday_auto_closed: boolean | null
  check_in_record_id: string | null
  check_in_geo_status: GeoStatus | null
  check_in_geo_reason: GeoUnvalidatedReason | null
  check_in_distance_m: number | null
  check_in_geofence_radius_m: number | null
  check_in_accuracy_m: number | string | null
  check_in_outside_reason: string | null
  check_in_geo_overridden: boolean | null
  check_out_record_id: string | null
  check_out_geo_status: GeoStatus | null
  check_out_geo_reason: GeoUnvalidatedReason | null
  check_out_distance_m: number | null
  check_out_geofence_radius_m: number | null
  check_out_accuracy_m: number | string | null
  check_out_outside_reason: string | null
  check_out_geo_overridden: boolean | null
}

const SUPERVISION_LIST_SELECT =
  'id, shift_id, shift_date, client_id, client_legal_name, site_id, site_name, start_time, end_time, supervisor_id, supervisor_first_name, supervisor_last_name, status, assigned_at, check_in_at, check_out_at, general_notes, cancel_reason, not_done_reason, criteria_snapshot, ratings_count, ratings_avg, assigned_employees_count, planned_minutes, worked_minutes, shift_open_ended, check_in_record_id, check_in_geo_status, check_in_geo_reason, check_in_distance_m, check_in_geofence_radius_m, check_in_accuracy_m, check_in_outside_reason, check_in_geo_overridden, check_out_record_id, check_out_geo_status, check_out_geo_reason, check_out_distance_m, check_out_geofence_radius_m, check_out_accuracy_m, check_out_outside_reason, check_out_geo_overridden, workday_id, duration_minutes, unclosed, workday_auto_closed'

function mapSupervisionListRow(row: SupervisionListRawRow): SupervisionListRow {
  return {
    id: row.id,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    clientId: row.client_id,
    clientName: row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    startTime: row.start_time,
    endTime: row.end_time,
    shiftOpenEnded: row.shift_open_ended ?? false,
    supervisorId: row.supervisor_id,
    supervisorFirstName: row.supervisor_first_name,
    supervisorLastName: row.supervisor_last_name,
    status: row.status,
    assignedAt: row.assigned_at,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    generalNotes: row.general_notes,
    cancelReason: row.cancel_reason,
    notDoneReason: row.not_done_reason,
    criteriaSnapshot: row.criteria_snapshot ?? [],
    ratingsCount: row.ratings_count,
    ratingsAvg: row.ratings_avg,
    assignedEmployeesCount: row.assigned_employees_count,
    plannedMinutes: row.planned_minutes,
    workedMinutes: row.worked_minutes,
    workdayId: row.workday_id,
    durationMinutes: row.duration_minutes,
    unclosed: row.unclosed ?? false,
    workdayAutoClosed: row.workday_auto_closed ?? false,
    checkInGeo: mapBoardAttendanceGeo(
      row.check_in_record_id,
      row.check_in_geo_status,
      {
        reason: row.check_in_geo_reason,
        distanceM: row.check_in_distance_m,
        radiusM: row.check_in_geofence_radius_m,
        accuracyM: row.check_in_accuracy_m,
        outsideReason: row.check_in_outside_reason,
        overridden: row.check_in_geo_overridden,
        timeCorrected: false,
      },
    ),
    checkOutGeo: mapBoardAttendanceGeo(
      row.check_out_record_id,
      row.check_out_geo_status,
      {
        reason: row.check_out_geo_reason,
        distanceM: row.check_out_distance_m,
        radiusM: row.check_out_geofence_radius_m,
        accuracyM: row.check_out_accuracy_m,
        outsideReason: row.check_out_outside_reason,
        overridden: row.check_out_geo_overridden,
        timeCorrected: false,
      },
    ),
  }
}

export interface SupervisionListFilters {
  /** Vía `ratings` (`06` sección 12: "empleado (vía ratings)") -- resuelto con una consulta previa, mismo criterio que `fetchAssignCandidates`. */
  employeeId?: string
  supervisorId?: string
  clientId?: string
  siteId?: string
  dateFrom?: string
  dateTo?: string
}

/** Ids de supervisión donde ese empleado tiene una calificación cargada (filtro "empleado" de ADM-13). */
async function fetchSupervisionIdsRatedForEmployee(
  employeeId: string,
): Promise<string[]> {
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from('assignments')
    .select('id')
    .eq('employee_id', employeeId)

  if (assignmentError) {
    throw fromPostgrestError(assignmentError)
  }
  const assignmentIds = (assignmentRows ?? []).map((row) => row.id)
  if (assignmentIds.length === 0) {
    return []
  }

  const { data, error } = await supabase
    .from('ratings')
    .select('supervision_id')
    .in('assignment_id', assignmentIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  return Array.from(new Set((data ?? []).map((row) => row.supervision_id)))
}

/**
 * Listado administrativo de supervisiones (ADM-13, `06` sección 12:
 * "Listado administrativo | from('v_supervisions_admin') | O, A | Filtros:
 * empleado (vía ratings), supervisor, cliente, sede, fecha, estado").
 */
export async function fetchSupervisionsAdmin(
  filters: SupervisionListFilters = {},
): Promise<SupervisionListRow[]> {
  let supervisionIdsForEmployee: string[] | null = null
  if (filters.employeeId) {
    supervisionIdsForEmployee = await fetchSupervisionIdsRatedForEmployee(
      filters.employeeId,
    )
    if (supervisionIdsForEmployee.length === 0) {
      return []
    }
  }

  let query = supabase
    .from('v_supervisions_admin')
    .select(SUPERVISION_LIST_SELECT)

  if (filters.supervisorId) {
    query = query.eq('supervisor_id', filters.supervisorId)
  }
  if (filters.clientId) {
    query = query.eq('client_id', filters.clientId)
  }
  if (filters.siteId) {
    query = query.eq('site_id', filters.siteId)
  }
  if (filters.dateFrom) {
    query = query.gte('shift_date', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('shift_date', filters.dateTo)
  }
  if (supervisionIdsForEmployee) {
    query = query.in('id', supervisionIdsForEmployee)
  }

  const { data, error } = await query
    .order('shift_date', { ascending: false })
    .order('start_time', { ascending: false })
    .order('id', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) =>
    mapSupervisionListRow(row as unknown as SupervisionListRawRow),
  )
}

// -------------------------------------------------------------------------
// 2. Detalle (ADM-15, `06` sección 12: "Detalle | from('supervisions') +
//    turno, sede, supervision_attendance, ratings con asignación y empleado")
// -------------------------------------------------------------------------

/** Una fila de "calificaciones por empleado" de ADM-15: una por cada asignación vigente del turno, con su calificación si ya la cargaron. */
export interface SupervisionEmployeeRating {
  assignmentId: string
  employeeId: string
  employeeFirstName: string
  employeeLastName: string
  rating: {
    id: string
    score: number
    comment: string | null
    createdAt: string
    updatedAt: string | null
    updatedByFirstName: string | null
    updatedByLastName: string | null
  } | null
}

export interface SupervisionDetailResult {
  detail: SupervisionListRow
  employeeRatings: SupervisionEmployeeRating[]
}

interface SupervisionAssignmentRawRow {
  id: string
  employee_id: string
  removed_at: string | null
  employees: {
    profile_id: string
    profiles: { first_name: string; last_name: string } | null
  } | null
}

interface SupervisionRatingRawRow {
  id: string
  assignment_id: string
  score: number
  comment: string | null
  created_at: string
  updated_at: string | null
  updated_by: string | null
  updated_by_profile: { first_name: string; last_name: string } | null
}

/**
 * Detalle de una supervisión para ADM-15: cabecera de `v_supervisions_admin`
 * (ya trae franja, criterios y contadores, `0029` SUP-006) más una fila por
 * cada asignación VIGENTE del turno (empleado, calificación si existe, y
 * quién y cuándo la editó por última vez -- P-083, "muestran quién y cuándo
 * editó").
 */
export async function fetchSupervisionDetail(
  id: string,
): Promise<SupervisionDetailResult> {
  const { data, error } = await supabase
    .from('v_supervisions_admin')
    .select(SUPERVISION_LIST_SELECT)
    .eq('id', id)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }
  const detail = mapSupervisionListRow(data as unknown as SupervisionListRawRow)

  const [assignmentsResult, ratingsResult] = await Promise.all([
    supabase
      .from('assignments')
      .select(
        'id, employee_id, removed_at, employees(profile_id, profiles!employees_profile_id_fkey(first_name, last_name))',
      )
      .eq('shift_id', detail.shiftId)
      .is('removed_at', null),
    supabase
      .from('ratings')
      .select(
        'id, assignment_id, score, comment, created_at, updated_at, updated_by, updated_by_profile:profiles!ratings_updated_by_fkey(first_name, last_name)',
      )
      .eq('supervision_id', id),
  ])

  if (assignmentsResult.error) {
    throw fromPostgrestError(assignmentsResult.error)
  }
  if (ratingsResult.error) {
    throw fromPostgrestError(ratingsResult.error)
  }

  const ratingsByAssignmentId = new Map(
    (ratingsResult.data as unknown as SupervisionRatingRawRow[]).map(
      (row) => [row.assignment_id, row] as const,
    ),
  )

  const employeeRatings: SupervisionEmployeeRating[] = (
    assignmentsResult.data as unknown as SupervisionAssignmentRawRow[]
  ).map((assignment) => {
    const rating = ratingsByAssignmentId.get(assignment.id)
    return {
      assignmentId: assignment.id,
      employeeId: assignment.employee_id,
      employeeFirstName: assignment.employees?.profiles?.first_name ?? '',
      employeeLastName: assignment.employees?.profiles?.last_name ?? '',
      rating: rating
        ? {
            id: rating.id,
            score: rating.score,
            comment: rating.comment,
            createdAt: rating.created_at,
            updatedAt: rating.updated_at,
            updatedByFirstName: rating.updated_by_profile?.first_name ?? null,
            updatedByLastName: rating.updated_by_profile?.last_name ?? null,
          }
        : null,
    }
  })

  return { detail, employeeRatings }
}

// -------------------------------------------------------------------------
// 3. Candidatos a coordinador (prioridades de ADM-16, ADM-21 y ADM-22)
// -------------------------------------------------------------------------

export interface SupervisorCandidate {
  profileId: string
  firstName: string
  lastName: string
}

/**
 * Coordinadores activos (personas con rol supervisor, perfil activo y sin
 * baja lógica) para el selector de «Coordinadores preferenciales» de la
 * ficha del cliente y de la sede. Mismos chequeos que hace
 * `set_supervisor_priority` del lado del servidor (`SUPERVISOR_ROLE_REQUIRED`).
 * Se usa el estado GUARDADO (`status`), no `effective_status`.
 */
export async function fetchSupervisorCandidates(): Promise<
  SupervisorCandidate[]
> {
  const { data, error } = await supabase
    .from('v_employees')
    .select('profile_id, first_name, last_name')
    .contains('roles', ['supervisor'])
    .eq('status', 'active')
    .eq('profile_is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw fromPostgrestError(error)
  }
  // El selector muestra "Nombre Apellido": se ordena por ese mismo texto, con las
  // reglas del español (acentos y ñ), y no por apellido en la base.
  return (data ?? [])
    .map((row) => ({
      profileId: row.profile_id as string,
      firstName: row.first_name as string,
      lastName: row.last_name as string,
    }))
    .sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(
        `${b.firstName} ${b.lastName}`,
        'es',
      ),
    )
}

// -------------------------------------------------------------------------
// 4. RPC de escritura (`0029_rpc_supervisions.sql`)
// -------------------------------------------------------------------------

export interface SupervisionRow {
  id: string
  shiftId: string
  supervisorId: string
  status: SupervisionStatus
  assignedAt: string
  generalNotes: string | null
  cancelReason: string | null
  notDoneReason: string | null
}

function mapSupervisionRow(row: {
  id: string
  shift_id: string
  supervisor_id: string
  status: SupervisionStatus
  assigned_at: string
  general_notes: string | null
  cancel_reason: string | null
  not_done_reason: string | null
}): SupervisionRow {
  return {
    id: row.id,
    shiftId: row.shift_id,
    supervisorId: row.supervisor_id,
    status: row.status,
    assignedAt: row.assigned_at,
    generalNotes: row.general_notes,
    cancelReason: row.cancel_reason,
    notDoneReason: row.not_done_reason,
  }
}

/** Cancela una supervisión `in_progress` (también la «Sin cerrar», CJ-31) con motivo obligatorio (ADM-15). */
export async function cancelSupervision(
  supervisionId: string,
  reason: string,
): Promise<SupervisionRow> {
  const { data, error } = await supabase.rpc('cancel_supervision', {
    p_supervision_id: supervisionId,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapSupervisionRow(data)
}
