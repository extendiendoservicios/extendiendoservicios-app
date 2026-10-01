import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import type { AssignmentStatus } from './assignments'
import { fetchShiftTasksReadOnly } from './tasks'
import type { GeolocationCoords } from '@/lib/geolocation'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'

/**
 * `src/api/mySupervisions.ts` (MOB-SUP-002 a MOB-SUP-005, MOB-SUP-009,
 * MOB-SUP-012, `06_API.md` sección 12 y 13, migración `0029`): el acceso a
 * datos propio de la vía del supervisor (SUP-02 a SUP-04), con sus hooks de
 * TanStack Query en el mismo archivo -- a pedido explícito del encargo
 * P15.4 (distinto del resto de `src/api/`, donde los hooks van en
 * `src/features/<dominio>/queries.ts`, ver `src/api/README.md`): este
 * archivo es enteramente propio (nadie más lo toca), así que juntar acceso
 * a datos y hooks acá evita que haya que compartir una carpeta
 * `src/features/supervisions/` con `front-admin`, que también tiene su
 * propio módulo de datos para las pantallas ADM-13/ADM-15 (`06` sección 12:
 * "O, A" en la fila de listado administrativo, que este archivo no cubre).
 *
 * No crea `src/api/supervisions.ts` ni `src/api/ratings.ts` (son de
 * `front-admin`, ver el encargo): la lectura de `rating_criteria` que
 * necesita SUP-03 (`06` sección 13: "Criterios vigentes | O, A, S") vive acá
 * porque `ratings.ts` todavía no existe y este paquete no lo crea.
 *
 * P15.5 (MOB-SUP-006 a MOB-SUP-008, MOB-SUP-011) agrega lo que faltaba para
 * SUP-05 (calificar), SUP-06 (cerrar) y SUP-08 (historial): las
 * asignaciones del turno con su `assignment_id` (`fetchSupervisionAssignments`),
 * la foto de las personas (`fetchPeopleAvatars`, `v_people_basic`), las
 * calificaciones ya cargadas (`fetchSupervisionRatings`) y el cálculo de la
 * ventana de edición del supervisor (`isRatingWindowClosed`/`canRateNow`,
 * P-083, MOB-SUP-011).
 */

export type SupervisionStatus =
  Database['public']['Enums']['supervision_status']

// -------------------------------------------------------------------------
// 1. v_my_supervisions (SUP-02, SUP-03, SUP-07 -- y SUP-08 en P15.5)
// -------------------------------------------------------------------------

/** Un empleado asignado al turno de la supervisión, con su asistencia (SUP-03: "estado de asistencia e inicio real"). */
export interface SupervisedEmployee {
  employeeId: string
  firstName: string
  lastName: string
  status: AssignmentStatus
  /** `null` si todavía no registró el inicio. */
  checkInAt: string | null
}

/** Un criterio de calificación vigente (P-080, guía de texto, sin puntaje propio) o el guardado en `criteria_snapshot` al iniciar (P-087). */
export interface RatingCriterion {
  id: string
  title: string
  description: string | null
  position: number
}

/**
 * Una fila de `v_my_supervisions`: una supervisión propia, sin acotar por
 * fecha en la vista (a diferencia de `v_my_day`) -- el rango lo decide cada
 * función de este módulo según lo que necesite cada pantalla (`06` sección
 * 12: "Hoy del supervisor... más próximos 7 días"; "Historial propio |
 * status in (completed, not_done)").
 */
export interface MySupervision {
  id: string
  shiftId: string
  shiftDate: string
  /** `true` si `shiftDate` es hoy en Buenos Aires (la vista no lo calcula: se deriva acá, mismo criterio que `MyDayAssignment.isToday`). */
  isToday: boolean
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  siteAddress: string | null
  siteCity: string | null
  siteLatitude: number | null
  siteLongitude: number | null
  siteContactName: string | null
  siteContactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  phoneRestricted: boolean
  photosNotAllowed: boolean
  restrictionsNotes: string | null
  startTime: string
  endTime: string
  startsAt: string | null
  endsAt: string | null
  status: SupervisionStatus
  assignedAt: string | null
  notDoneReason: string | null
  cancelReason: string | null
  generalNotes: string | null
  /** `null` hasta que se registra el inicio (`supervision_check_in` la completa, P-087). */
  criteriaSnapshot: RatingCriterion[] | null
  checkInAt: string | null
  checkOutAt: string | null
  assignedEmployees: SupervisedEmployee[]
}

type MySupervisionRawRow =
  Database['public']['Views']['v_my_supervisions']['Row']

interface RawAssignedEmployee {
  employee_id: string
  first_name: string | null
  last_name: string | null
  status: AssignmentStatus
  check_in_at: string | null
}

function mapAssignedEmployees(json: unknown): SupervisedEmployee[] {
  if (!Array.isArray(json)) return []
  return (json as RawAssignedEmployee[]).map((row) => ({
    employeeId: row.employee_id,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    status: row.status,
    checkInAt: row.check_in_at,
  }))
}

function mapCriteriaSnapshot(json: unknown): RatingCriterion[] | null {
  if (!Array.isArray(json)) return null
  return (json as RatingCriterion[]).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    position: row.position,
  }))
}

/**
 * Todas las columnas no nulas de una fila real (`v_my_supervisions` tipa
 * todo como nullable por ser una vista, pero `supervisor_id = auth.uid()`
 * en su definición asegura que cada fila que llega acá es una supervisión
 * propia completa).
 */
function mapMySupervisionRow(row: MySupervisionRawRow): MySupervision {
  const shiftDate = row.shift_date as string
  return {
    id: row.id as string,
    shiftId: row.shift_id as string,
    shiftDate,
    isToday: shiftDate === todayInBuenosAires(),
    clientId: row.client_id as string,
    clientName: row.client_legal_name as string,
    siteId: row.site_id as string,
    siteName: row.site_name as string,
    siteAddress: row.site_address,
    siteCity: row.site_city,
    siteLatitude: row.site_latitude,
    siteLongitude: row.site_longitude,
    siteContactName: row.site_contact_name,
    siteContactPhone: row.site_contact_phone,
    accessInstructions: row.site_access_instructions,
    buildingHours: row.site_building_hours,
    phoneRestricted: Boolean(row.site_phone_restricted),
    photosNotAllowed: Boolean(row.site_photos_not_allowed),
    restrictionsNotes: row.site_restrictions_notes,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status as SupervisionStatus,
    assignedAt: row.assigned_at,
    notDoneReason: row.not_done_reason,
    cancelReason: row.cancel_reason,
    generalNotes: row.general_notes,
    criteriaSnapshot: mapCriteriaSnapshot(row.criteria_snapshot),
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    assignedEmployees: mapAssignedEmployees(row.assigned_employees),
  }
}

const MY_SUPERVISIONS_SELECT = '*'

/**
 * Supervisiones propias de hoy y de los próximos 7 días (SUP-02, `06`
 * sección 12: "Hoy del supervisor... más próximos 7 días"). Mismo rango que
 * `v_my_day` para el empleado (P-093), calculado acá porque
 * `v_my_supervisions` no lo acota por sí sola.
 */
export async function fetchMySupervisionsUpcoming(): Promise<MySupervision[]> {
  const today = todayInBuenosAires()
  const in7Days = addDays(today, 7)

  const { data, error } = await supabase
    .from('v_my_supervisions')
    .select(MY_SUPERVISIONS_SELECT)
    .gte('shift_date', today)
    .lte('shift_date', in7Days)
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data as MySupervisionRawRow[]).map(mapMySupervisionRow)
}

/**
 * Todas las supervisiones asignadas o en curso (SUP-07, `06` sección 12:
 * "Todas las asignadas pendientes... futuras incluidas"). Sin límite de
 * fecha: una supervisión asignada de hace varios días que nadie canceló
 * también tiene que verse acá para que la persona la resuelva.
 */
export async function fetchMySupervisionsPending(): Promise<MySupervision[]> {
  const { data, error } = await supabase
    .from('v_my_supervisions')
    .select(MY_SUPERVISIONS_SELECT)
    .in('status', ['assigned', 'in_progress'])
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data as MySupervisionRawRow[]).map(mapMySupervisionRow)
}

/**
 * Historial propio (SUP-08, `06` sección 12: "completadas y no realizadas
 * por fecha"). Sin pantalla propia en este paquete (P15.5): queda lista
 * para que ese encargo la use tal cual.
 */
export async function fetchMySupervisionsHistory(): Promise<MySupervision[]> {
  const { data, error } = await supabase
    .from('v_my_supervisions')
    .select(MY_SUPERVISIONS_SELECT)
    .in('status', ['completed', 'not_done'])
    .order('shift_date', { ascending: false })
    .order('start_time', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data as MySupervisionRawRow[]).map(mapMySupervisionRow)
}

/**
 * Una supervisión propia por id (SUP-03, SUP-04): consulta directa por
 * columna en vez de reusar la caché de otra lista, para que el detalle
 * funcione sin importar por dónde entró la persona (Hoy, Supervisiones o,
 * en P15.5, Historial).
 */
export async function fetchMySupervisionById(
  id: string,
): Promise<MySupervision | null> {
  const { data, error } = await supabase
    .from('v_my_supervisions')
    .select(MY_SUPERVISIONS_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapMySupervisionRow(data) : null
}

/** Suma `days` días a una fecha `"YYYY-MM-DD"` sin pasar por `Date` (evita el corrimiento de zona horaria, mismo criterio que `todayInBuenosAires`). */
function addDays(dateOnly: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateOnly.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// -------------------------------------------------------------------------
// 2. rating_criteria vigentes (SUP-03: "criterios de calificación vigentes,
//    guía") -- `06` sección 13, P-080
// -------------------------------------------------------------------------

/**
 * Los `rating_criteria` vigentes hoy, ordenados por `position` (P-080: guía
 * de texto, no se puntúa por criterio). Lectura directa de la tabla (política
 * `rating_criteria_select_staff`, `0012_rls_policies.sql`): más simple que
 * depender de `criteria_snapshot` (que recién existe después de registrar el
 * inicio, `supervision_check_in`) para una guía que SUP-03 muestra siempre,
 * haya empezado la supervisión o no.
 */
export async function fetchVigentRatingCriteria(): Promise<RatingCriterion[]> {
  const today = todayInBuenosAires()
  const { data, error } = await supabase
    .from('rating_criteria')
    .select('id, title, description, position, valid_from, valid_to')
    .lte('valid_from', today)
    .or(`valid_to.is.null,valid_to.gte.${today}`)
    .order('position', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    position: row.position,
  }))
}

// -------------------------------------------------------------------------
// 3. supervision_check_in / supervision_check_out (SUP-04, `06` sección 12,
//    ADR-009, P-041, P-085)
// -------------------------------------------------------------------------

export type SupervisionAttendanceKind =
  Database['public']['Enums']['attendance_kind']

/** Resultado de registrar el inicio o el fin de una supervisión: solo lo que la pantalla puede mostrar (ADR-009, mismo criterio que `AttendanceRecord` de `src/api/attendance.ts`). */
export interface SupervisionAttendanceRecord {
  id: string
  supervisionId: string
  kind: SupervisionAttendanceKind
  /** Hora del servidor (`now()` dentro de la RPC, nunca la del dispositivo). */
  recordedAt: string
}

function mapSupervisionAttendanceRecord(row: {
  id: string
  supervision_id: string
  kind: SupervisionAttendanceKind
  recorded_at: string
}): SupervisionAttendanceRecord {
  return {
    id: row.id,
    supervisionId: row.supervision_id,
    kind: row.kind,
    recordedAt: row.recorded_at,
  }
}

/**
 * Registra el inicio de la supervisión (`06` sección 12:
 * `supervision_check_in`). `coords`: mismo criterio que `recordCheckIn`
 * (`src/api/attendance.ts`) -- `null` si no hay consentimiento, se negó el
 * permiso o no llegó a tiempo; el registro se hace igual (ADR-009).
 */
export async function supervisionCheckIn(
  supervisionId: string,
  coords: GeolocationCoords | null,
): Promise<SupervisionAttendanceRecord> {
  const { data, error } = await supabase.rpc('supervision_check_in', {
    p_supervision_id: supervisionId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapSupervisionAttendanceRecord(data)
}

/** Registra el fin de la supervisión (`06` sección 12: `supervision_check_out`). Mismo criterio de ubicación que `supervisionCheckIn`. */
export async function supervisionCheckOut(
  supervisionId: string,
  coords: GeolocationCoords | null,
): Promise<SupervisionAttendanceRecord> {
  const { data, error } = await supabase.rpc('supervision_check_out', {
    p_supervision_id: supervisionId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapSupervisionAttendanceRecord(data)
}

// -------------------------------------------------------------------------
// 4. Accesos preparados para P15.5 (SUP-05, SUP-06): `rate_employee`,
//    `complete_supervision`, `mark_supervision_not_done` -- sin pantalla
//    propia en este paquete, tipados y listos para que ese encargo los use
//    tal cual (mismo criterio que dejó P13.2 con `record_check_in` para
//    P13.3, ver `src/api/attendance.ts`).
// -------------------------------------------------------------------------

/** El resultado de calificar a un empleado (`06` sección 13: `rate_employee`, upsert). */
export interface RatingResult {
  id: string
  supervisionId: string
  assignmentId: string
  score: number
  comment: string | null
}

/**
 * Puntúa (o edita, es upsert) a un empleado del turno supervisado (SUP-05,
 * P-080, P-081, P-083). `score`: entero de 1 a 5. Dentro del plazo de
 * P-083 para el supervisor (`RATING_WINDOW_CLOSED` si venció); el dueño y
 * el administrador con `edit_ratings` no tienen ventana.
 */
export async function rateEmployee(
  supervisionId: string,
  assignmentId: string,
  score: number,
  comment?: string,
): Promise<RatingResult> {
  const { data, error } = await supabase.rpc('rate_employee', {
    p_supervision_id: supervisionId,
    p_assignment_id: assignmentId,
    p_score: score,
    p_comment: comment,
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
  }
}

/** Completa la supervisión (SUP-06, `06` sección 12: `complete_supervision`, requiere fin registrado). Nota general opcional. */
export async function completeSupervision(
  supervisionId: string,
  generalNotes?: string,
): Promise<MySupervisionStatusResult | null> {
  const { data, error } = await supabase.rpc('complete_supervision', {
    p_supervision_id: supervisionId,
    p_general_notes: generalNotes,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapMySupervisionShallowRpcResult(data) : null
}

/** Marca la supervisión como no realizada (SUP-06, `06` sección 12: `mark_supervision_not_done`, motivo obligatorio). */
export async function markSupervisionNotDone(
  supervisionId: string,
  reason: string,
): Promise<MySupervisionStatusResult | null> {
  const { data, error } = await supabase.rpc('mark_supervision_not_done', {
    p_supervision_id: supervisionId,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return data ? mapMySupervisionShallowRpcResult(data) : null
}

/**
 * `complete_supervision`/`mark_supervision_not_done` devuelven la fila cruda
 * de `supervisions` (sin los joins de `v_my_supervisions`): alcanza con el
 * subconjunto que SUP-06 necesita mostrar (estado y motivo), sin fingir que
 * es una `MySupervision` completa -- se deja como un tipo aparte, más chico,
 * en vez de forzar el tipo grande con campos inventados.
 */
export interface MySupervisionStatusResult {
  id: string
  status: SupervisionStatus
  notDoneReason: string | null
  generalNotes: string | null
}

function mapMySupervisionShallowRpcResult(data: {
  id: string
  status: SupervisionStatus
  not_done_reason: string | null
  general_notes: string | null
}): MySupervisionStatusResult {
  return {
    id: data.id,
    status: data.status,
    notDoneReason: data.not_done_reason,
    generalNotes: data.general_notes,
  }
}

// -------------------------------------------------------------------------
// 5. Asignaciones, fotos y calificaciones cargadas del turno supervisado
//    (SUP-03/SUP-05, P15.5): completa lo que `v_my_supervisions` no trae --
//    `assigned_employees` no incluye `assignment_id` (lo pide `rate_employee`,
//    `06` sección 13) ni foto (`v_people_basic`, P-103, "personal
//    supervisado" es uno de los dos usos documentados de la vista en
//    `0011_views.sql`); las calificaciones ya cargadas viven en `ratings`
//    (política `ratings_select_own_supervision`, `0012_rls_policies.sql`).
// -------------------------------------------------------------------------

/** Une `employeeId` con el `assignmentId` que pide `rate_employee` (SUP-05, `06` sección 13). */
export interface SupervisionAssignment {
  assignmentId: string
  employeeId: string
}

/**
 * Las asignaciones vigentes del turno supervisado. Consulta directa a
 * `assignments` (política `assignments_select_supervisor`,
 * `app.supervises_shift(shift_id)`, `0012_rls_policies.sql`): la misma tabla
 * que ya lee `v_my_supervisions` para armar `assigned_employees`, pero acá
 * hace falta la columna `id` (el `assignment_id`), que la vista no expone.
 */
export async function fetchSupervisionAssignments(
  shiftId: string,
): Promise<SupervisionAssignment[]> {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, employee_id')
    .eq('shift_id', shiftId)
    .is('removed_at', null)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    assignmentId: row.id,
    employeeId: row.employee_id,
  }))
}

/**
 * Foto de un grupo de personas (`v_people_basic`, P-103). Devuelve un mapa
 * `profileId -> avatarPath` (`null` si no tiene foto cargada); las
 * `profileId` que no aparecen en el resultado son las que la RLS de
 * `profiles` no deja ver desde esta cuenta.
 */
export async function fetchPeopleAvatars(
  profileIds: string[],
): Promise<Record<string, string | null>> {
  if (profileIds.length === 0) return {}
  const { data, error } = await supabase
    .from('v_people_basic')
    .select('profile_id, avatar_path')
    .in('profile_id', profileIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  const result: Record<string, string | null> = {}
  for (const row of data ?? []) {
    if (row.profile_id == null) continue
    result[row.profile_id] = row.avatar_path
  }
  return result
}

/** Una calificación ya cargada (SUP-03: "con su calificación si existe"; SUP-05: prellenar al editar). */
export interface SupervisionRating {
  id: string
  assignmentId: string
  score: number
  comment: string | null
}

/** Las calificaciones cargadas de una supervisión propia. */
export async function fetchSupervisionRatings(
  supervisionId: string,
): Promise<SupervisionRating[]> {
  const { data, error } = await supabase
    .from('ratings')
    .select('id, assignment_id, score, comment')
    .eq('supervision_id', supervisionId)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    score: row.score,
    comment: row.comment,
  }))
}

// -------------------------------------------------------------------------
// 6. Ventana de edición de la calificación (MOB-SUP-011, P-083 ratificada
//    el 27 sep 2026 en P15.0): mismo cálculo que hace `rate_employee` en
//    `0029_rpc_supervisions.sql` ("now() > greatest(fin previsto del turno,
//    fin registrado de la supervisión)"), repetido en el cliente para no
//    ofrecer "Calificar" fuera de plazo (la RPC vuelve a verificarlo con
//    `RATING_WINDOW_CLOSED` si algo se escapa, por ejemplo un reloj mal
//    puesto en el teléfono). Solo aplica a la rama del supervisor: el dueño
//    y el administrador con `edit_ratings` no tienen ventana y no pasan por
//    esta pantalla (SUP-05 es exclusiva de la vía `/sup`).
// -------------------------------------------------------------------------

export function isRatingWindowClosed(
  supervision: MySupervision,
  now: Date = new Date(),
): boolean {
  const shiftEndsAt = supervision.endsAt ? new Date(supervision.endsAt) : null
  const checkOutAt = supervision.checkOutAt
    ? new Date(supervision.checkOutAt)
    : null
  const deadline =
    shiftEndsAt && checkOutAt
      ? new Date(Math.max(shiftEndsAt.getTime(), checkOutAt.getTime()))
      : (shiftEndsAt ?? checkOutAt)
  if (!deadline) return false
  return now.getTime() > deadline.getTime()
}

/**
 * `true` si el supervisor puede calificar (o editar) ahora mismo: la
 * supervisión tiene que estar `in_progress` o `completed`
 * (`SUPERVISION_NOT_ACTIVE` en cualquier otro estado, `06` sección 13) y el
 * plazo de P-083 todavía no cerró.
 */
export function canRateNow(
  supervision: MySupervision,
  now: Date = new Date(),
): boolean {
  return (
    (supervision.status === 'in_progress' ||
      supervision.status === 'completed') &&
    !isRatingWindowClosed(supervision, now)
  )
}

// -------------------------------------------------------------------------
// 7bis. Resumen de calificaciones por lote (SUP-08, `05` fila SUP-08: "lista
//    de completadas y no realizadas... con sede y puntajes") -- una sola
//    consulta para toda la lista del historial, en vez de una por fila.
// -------------------------------------------------------------------------

export interface SupervisionRatingsSummary {
  supervisionId: string
  ratedCount: number
  /** Promedio de los puntajes cargados, `null` si todavía no hay ninguno. */
  averageScore: number | null
}

/** El resumen de calificaciones de un grupo de supervisiones propias (SUP-08). */
export async function fetchRatingsSummaryBySupervisionIds(
  supervisionIds: string[],
): Promise<SupervisionRatingsSummary[]> {
  if (supervisionIds.length === 0) return []
  const { data, error } = await supabase
    .from('ratings')
    .select('supervision_id, score')
    .in('supervision_id', supervisionIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  const scoresBySupervision = new Map<string, number[]>()
  for (const row of data ?? []) {
    const scores = scoresBySupervision.get(row.supervision_id) ?? []
    scores.push(row.score)
    scoresBySupervision.set(row.supervision_id, scores)
  }
  return supervisionIds.map((supervisionId) => {
    const scores = scoresBySupervision.get(supervisionId) ?? []
    return {
      supervisionId,
      ratedCount: scores.length,
      averageScore:
        scores.length > 0
          ? scores.reduce((sum, score) => sum + score, 0) / scores.length
          : null,
    }
  })
}

// -------------------------------------------------------------------------
// 7. Hooks de TanStack Query (MOB-SUP-002 a MOB-SUP-005; MOB-SUP-011 y
//    MOB-SUP-006/007/008 en P15.5) -- en este mismo archivo, ver el
//    comentario grande del principio.
// -------------------------------------------------------------------------

/** 60 s: "resto de listas" (`05_Pantallas_y_Navegacion.md` sección 0 -- SUP-02/SUP-07 no son ninguna de las tres pantallas con polling de 30 s). */
const SUPERVISIONS_POLLING_MS = 60_000

export const mySupervisionsKeys = {
  all: ['mySupervisions'] as const,
  upcoming: () => [...mySupervisionsKeys.all, 'upcoming'] as const,
  pending: () => [...mySupervisionsKeys.all, 'pending'] as const,
  history: () => [...mySupervisionsKeys.all, 'history'] as const,
  detail: (id: string) => [...mySupervisionsKeys.all, 'detail', id] as const,
  criteria: () => [...mySupervisionsKeys.all, 'criteria'] as const,
}

/** SUP-02 · Hoy: supervisiones de hoy y de los próximos 7 días. */
export function useMySupervisionsUpcomingQuery() {
  return useQuery({
    queryKey: mySupervisionsKeys.upcoming(),
    queryFn: fetchMySupervisionsUpcoming,
    refetchInterval: SUPERVISIONS_POLLING_MS,
  })
}

/** SUP-07 · Supervisiones (tab): todas las asignadas o en curso, futuras incluidas. */
export function useMySupervisionsPendingQuery() {
  return useQuery({
    queryKey: mySupervisionsKeys.pending(),
    queryFn: fetchMySupervisionsPending,
    refetchInterval: SUPERVISIONS_POLLING_MS,
  })
}

/** SUP-08 (P15.5): historial propio. Sin polling (una lista que no cambia sola: son supervisiones ya cerradas). */
export function useMySupervisionsHistoryQuery() {
  return useQuery({
    queryKey: mySupervisionsKeys.history(),
    queryFn: fetchMySupervisionsHistory,
  })
}

/** SUP-03/SUP-04: el detalle de una supervisión propia por id. Sin polling (se abre a demanda). */
export function useMySupervisionQuery(id: string) {
  return useQuery({
    queryKey: mySupervisionsKeys.detail(id),
    queryFn: () => fetchMySupervisionById(id),
    enabled: Boolean(id),
  })
}

/** SUP-03: guía de criterios vigentes. `staleTime` largo -- cambia poco (solo cuando el dueño edita `rating_criteria`, ADM-30). */
export function useVigentRatingCriteriaQuery() {
  return useQuery({
    queryKey: mySupervisionsKeys.criteria(),
    queryFn: fetchVigentRatingCriteria,
    staleTime: 5 * 60_000,
  })
}

/**
 * SUP-03: las tareas del turno supervisado, en lectura ("`06` sección 9:
 * O, A, S, E (sus turnos)" -- el supervisor de ese turno también puede leer
 * `shift_tasks`, mismo acceso que ya usa `ServiceDetailPage` del empleado
 * con `fetchShiftTasksReadOnly`, `src/api/tasks.ts`). Sin mutación: SUP-03
 * las muestra siempre en solo lectura, marcarlas es cosa del empleado
 * (EMP-08).
 */
export function useSupervisionShiftTasksQuery(shiftId: string) {
  return useQuery({
    queryKey: [...mySupervisionsKeys.all, 'shiftTasks', shiftId] as const,
    queryFn: () => fetchShiftTasksReadOnly(shiftId),
    enabled: Boolean(shiftId),
  })
}

/**
 * Devuelve la promesa de la recarga: los `onSuccess` la devuelven para que la
 * mutación siga "pendiente" (botón ocupado) hasta tener el estado nuevo. Si
 * no, entre la respuesta de la RPC y la recarga el botón queda habilitado y
 * un segundo toque responde, por ejemplo, ALREADY_STARTED. El detalle
 * (`detail(id)`) cuelga de `all`, así que una sola invalidación alcanza.
 */
function invalidateSupervisionCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  _supervisionId: string,
) {
  return queryClient.invalidateQueries({ queryKey: mySupervisionsKeys.all })
}

/** SUP-04: registrar el inicio. Invalida todas las listas y el detalle (el estado cambió a `in_progress`). */
export function useSupervisionCheckInMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      coords,
    }: {
      supervisionId: string
      coords: GeolocationCoords | null
    }) => supervisionCheckIn(supervisionId, coords),
    onSuccess: (_, { supervisionId }) =>
      invalidateSupervisionCaches(queryClient, supervisionId),
  })
}

/** SUP-04: registrar el fin. Mismo criterio de invalidación que `useSupervisionCheckInMutation`. */
export function useSupervisionCheckOutMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      coords,
    }: {
      supervisionId: string
      coords: GeolocationCoords | null
    }) => supervisionCheckOut(supervisionId, coords),
    onSuccess: (_, { supervisionId }) =>
      invalidateSupervisionCaches(queryClient, supervisionId),
  })
}

/** SUP-05 (P15.5): calificar a un empleado. Sin pantalla propia en este paquete, ver la sección 4. */
export function useRateEmployeeMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      assignmentId,
      score,
      comment,
    }: {
      supervisionId: string
      assignmentId: string
      score: number
      comment?: string
    }) => rateEmployee(supervisionId, assignmentId, score, comment),
    onSuccess: (_, { supervisionId }) =>
      invalidateSupervisionCaches(queryClient, supervisionId),
  })
}

/** SUP-06 (P15.5): completar la supervisión. Sin pantalla propia en este paquete, ver la sección 4. */
export function useCompleteSupervisionMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      generalNotes,
    }: {
      supervisionId: string
      generalNotes?: string
    }) => completeSupervision(supervisionId, generalNotes),
    onSuccess: (_, { supervisionId }) =>
      invalidateSupervisionCaches(queryClient, supervisionId),
  })
}

/** SUP-03/SUP-05: las asignaciones vigentes del turno, para vincular `employeeId` con `assignmentId`. Sin polling (cambia poco mientras dura el turno). */
export function useSupervisionAssignmentsQuery(shiftId: string) {
  return useQuery({
    queryKey: [...mySupervisionsKeys.all, 'assignments', shiftId] as const,
    queryFn: () => fetchSupervisionAssignments(shiftId),
    enabled: Boolean(shiftId),
  })
}

/** SUP-05: la foto de un grupo de personas (`v_people_basic`). */
export function usePeopleAvatarsQuery(profileIds: string[]) {
  const key = profileIds.slice().sort()
  return useQuery({
    queryKey: [...mySupervisionsKeys.all, 'avatars', ...key] as const,
    queryFn: () => fetchPeopleAvatars(profileIds),
    enabled: profileIds.length > 0,
  })
}

/** SUP-03/SUP-05: las calificaciones ya cargadas de una supervisión propia. */
export function useSupervisionRatingsQuery(supervisionId: string) {
  return useQuery({
    queryKey: [...mySupervisionsKeys.all, 'ratings', supervisionId] as const,
    queryFn: () => fetchSupervisionRatings(supervisionId),
    enabled: Boolean(supervisionId),
  })
}

/** SUP-08: el resumen de calificaciones de toda la lista del historial, en una sola consulta. Sin polling (lista de supervisiones ya cerradas). */
export function useHistoryRatingsSummaryQuery(supervisionIds: string[]) {
  const key = supervisionIds.slice().sort()
  return useQuery({
    queryKey: [...mySupervisionsKeys.all, 'ratingsSummary', ...key] as const,
    queryFn: () => fetchRatingsSummaryBySupervisionIds(supervisionIds),
    enabled: supervisionIds.length > 0,
  })
}

/** SUP-06 (P15.5): marcar como no realizada. Sin pantalla propia en este paquete, ver la sección 4. */
export function useMarkSupervisionNotDoneMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      supervisionId,
      reason,
    }: {
      supervisionId: string
      reason: string
    }) => markSupervisionNotDone(supervisionId, reason),
    onSuccess: (_, { supervisionId }) =>
      invalidateSupervisionCaches(queryClient, supervisionId),
  })
}
