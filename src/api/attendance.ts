import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import type { GeolocationCoords } from '@/lib/geolocation'
import type { AssignmentStatus } from './assignments'

/**
 * `src/api/attendance.ts` (ATT-005, `06_API.md` sección 10, migración
 * `0026_rpc_attendance.sql`): `record_check_in`, `record_check_out` y
 * `set_assignment_notes`. Este paquete (P13.2) no llama todavía a
 * `recordCheckIn`/`recordCheckOut` desde ninguna pantalla propia (EMP-05 y
 * EMP-07 son de P13.3) — quedan completas, tipadas y con tests para que ese
 * encargo las use tal cual, sin tener que tocar este archivo.
 *
 * Igual que `assignments.ts`/`tasks.ts`: las tres RPC ya devuelven `hint` en
 * mayúsculas y `message` en voseo armado del lado del servidor (`06`
 * sección 15: `NOT_TODAY`, `ALREADY_CHECKED_IN`, `NOT_CHECKED_IN`,
 * `ALREADY_CHECKED_OUT`, `COORDINATES_INCOMPLETE`,
 * `COORDINATES_OUT_OF_RANGE`, `NOTES_TOO_LONG`, `SHIFT_COMPLETED`,
 * `FORBIDDEN`, etc.), así que `fromPostgrestError` alcanza sin un
 * `mapWriteError` propio: la pantalla solo tiene que mostrar `error.message`
 * y, si necesita lógica especial (por ejemplo deshabilitar el botón),
 * mirar `error.hint`.
 *
 * IMPORTANTE (ADR-009, P-067): las coordenadas que devuelve el servidor
 * (latitud, longitud, precisión) NO se mapean a ningún tipo de este
 * archivo — a propósito, para que sea imposible mostrarlas por accidente en
 * una pantalla ("no se muestran en ninguna pantalla de la Base"). Si algún
 * día un módulo extra las necesita, se agrega ahí, no acá.
 */

export type AttendanceKind = Database['public']['Enums']['attendance_kind']

/** Resultado de fichar el inicio o el fin: solo lo que la pantalla puede mostrar (ADR-009). */
export interface AttendanceRecord {
  id: string
  assignmentId: string
  kind: AttendanceKind
  /** Hora del servidor (`now()` dentro de la RPC, nunca la del dispositivo — ADR-009). */
  recordedAt: string
}

function mapAttendanceRecord(row: {
  id: string
  assignment_id: string
  kind: AttendanceKind
  recorded_at: string
}): AttendanceRecord {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    kind: row.kind,
    recordedAt: row.recorded_at,
  }
}

/**
 * Registra el inicio del servicio (`06` sección 10: `record_check_in`).
 * `coords`: `null` si el empleado no dio su consentimiento, negó el permiso
 * del navegador o la posición no llegó a tiempo (`getCurrentPositionSafe`,
 * `src/lib/geolocation.ts`) — en ese caso se manda sin latitud, longitud ni
 * precisión, y el registro se hace igual (P-067, P-091, `COORDINATES_INCOMPLETE`
 * solo salta si se manda ALGUNA de las tres sin las otras dos, nunca por
 * mandar ninguna).
 */
export async function recordCheckIn(
  assignmentId: string,
  coords: GeolocationCoords | null,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('record_check_in', {
    p_assignment_id: assignmentId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

/** Registra el fin del servicio (`06` sección 10: `record_check_out`). Mismo criterio de ubicación que `recordCheckIn`. */
export async function recordCheckOut(
  assignmentId: string,
  coords: GeolocationCoords | null,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('record_check_out', {
    p_assignment_id: assignmentId,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracyM,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

/** La asignación después de guardar la observación (`06` sección 8: `set_assignment_notes`). */
export interface AssignmentNotesResult {
  id: string
  notes: string | null
}

/**
 * Guarda la observación del servicio (P-062, una por asignación). Texto
 * vacío o solo espacios se guarda como `null` del lado del servidor; más de
 * 2000 caracteres → `NOTES_TOO_LONG`. El empleado solo puede sobre su
 * propia asignación y mientras el turno no esté `completed`
 * (`SHIFT_COMPLETED`); sobre una ajena, `FORBIDDEN`.
 */
export async function setAssignmentNotes(
  assignmentId: string,
  notes: string,
): Promise<AssignmentNotesResult> {
  const { data, error } = await supabase.rpc('set_assignment_notes', {
    p_assignment_id: assignmentId,
    p_notes: notes,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return { id: data.id, notes: data.notes }
}

/**
 * A partir de acá: P14.3 (ATT-010 a ATT-014, ABS-006, ABS-008, ATT-016),
 * migración `0027_rpc_notices_admin_attendance.sql`. `admin_record_attendance`
 * y `close_assignment` (ADM-11, `06` sección 10) y las lecturas de
 * `v_assignments_board` para ADM-06 (ATT-014), ADM-10 (ATT-011/ATT-012) y
 * ADM-12 (ATT-013). Front-movil (P14.2, en paralelo) usa este mismo archivo
 * para `record_check_in`/`record_check_out`/`set_assignment_notes` de
 * arriba, pero no toca nada de acá para abajo: el aviso en nombre del
 * empleado (`notify_delay`/`notify_absence`) vive aparte, en
 * `src/api/adminNotices.ts`, para no pisar el módulo `src/api/notices.ts`
 * que crea ese paquete (instrucción del orquestador).
 */

export type AttendanceSource = Database['public']['Enums']['attendance_source']
export type NoticeKind = Database['public']['Enums']['notice_kind']
export type AbsenceReason = Database['public']['Enums']['absence_reason']

/**
 * Registra inicio o fin en nombre del empleado (ADM-11, ATT-010; `06`
 * sección 10: `admin_record_attendance`; P-075). Motivo siempre obligatorio.
 * `at`: instante elegido (por defecto ahora, si se omite); tiene que estar
 * entre las 0:00 (Argentina) del día del turno y este momento -- si no,
 * `AT_OUT_OF_RANGE` (código nuevo de esta migración, ver el reporte de
 * P14.1). Capacidad `manage_attendance` (el dueño la tiene siempre).
 */
export async function adminRecordAttendance(
  assignmentId: string,
  kind: AttendanceKind,
  reason: string,
  at?: string,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('admin_record_attendance', {
    p_assignment_id: assignmentId,
    p_kind: kind,
    p_at: at,
    p_reason: reason,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

/**
 * Cierre manual de una asignación `present` sin fin (ADM-11, ATT-010; `06`
 * sección 10: `close_assignment`; P-069). Atajo semántico de
 * `adminRecordAttendance(assignmentId, 'check_out', reason, at)` -- misma
 * validación de rango de `at` y mismas transiciones (ver la nota grande de
 * `0027_rpc_notices_admin_attendance.sql`); se deja como función propia
 * porque `06` la lista con su propio nombre e intención ("cierre manual").
 * Motivo siempre obligatorio.
 */
export async function closeAssignment(
  assignmentId: string,
  reason: string,
  at?: string,
): Promise<AttendanceRecord> {
  const { data, error } = await supabase.rpc('close_assignment', {
    p_assignment_id: assignmentId,
    p_reason: reason,
    p_at: at,
  })

  if (error) {
    throw fromPostgrestError(error)
  }
  return mapAttendanceRecord(data)
}

// ---------------------------------------------------------------------------
// Lecturas de `v_assignments_board` para ADM-06, ADM-10 y ADM-12
// ---------------------------------------------------------------------------

/** Una fila de `v_assignments_board` con las columnas de asistencia (ATT-011 a ATT-014). */
export interface AttendanceBoardRow {
  id: string
  shiftId: string
  shiftDate: string
  shiftStatus: Database['public']['Enums']['shift_status']
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  employeeId: string
  employeeFirstName: string
  employeeLastName: string
  employeeAvatarPath: string | null
  /** Franja efectiva (propia de la asignación, o la del turno). */
  startTime: string
  endTime: string
  /** Instante de inicio y fin de la franja efectiva (para decidir "antes/después del inicio" en el cliente). */
  startsAt: string | null
  endsAt: string | null
  status: AssignmentStatus
  /** `04` sección 5: agrega `no_record` cuando el estado es `expected`/`delay_notified` y ya pasó el inicio. */
  displayStatus: string
  notes: string | null
  checkInAt: string | null
  checkOutAt: string | null
  checkInSource: AttendanceSource | null
  checkInRecordedBy: string | null
  checkOutSource: AttendanceSource | null
  checkOutRecordedBy: string | null
  /** Minutos de demora del check-in real contra el inicio previsto (`04` sección 4, distinto del aviso). */
  minutesLate: number | null
  /** Minutos de salida anticipada (P-076): el fin real quedó antes del fin previsto. */
  minutesEarlyLeave: number | null
  lastNoticeKind: NoticeKind | null
  lastNoticeMinutesLate: number | null
  lastNoticeReasonCode: AbsenceReason | null
  lastNoticeReasonText: string | null
  lastNoticeReportedBy: string | null
  lastNoticeSource: AttendanceSource | null
  lastNoticeAt: string | null
}

/** Todas las columnas de `v_assignments_board` que usa esta pantalla (`06` sección 10, P14.1). */
const ATTENDANCE_BOARD_SELECT = `
  id, shift_id, shift_date, shift_status, client_id, client_legal_name, site_id, site_name,
  employee_id, employee_first_name, employee_last_name, employee_avatar_path,
  effective_start_time, effective_end_time, effective_starts_at, effective_ends_at,
  status, display_status, notes,
  check_in_at, check_out_at, check_in_source, check_in_recorded_by, check_out_source, check_out_recorded_by,
  minutes_late, minutes_early_leave,
  last_notice_kind, last_notice_minutes_late, last_notice_reason_code, last_notice_reason_text,
  last_notice_reported_by, last_notice_source, last_notice_at
`

interface AttendanceBoardRawRow {
  id: string
  shift_id: string
  shift_date: string
  shift_status: Database['public']['Enums']['shift_status']
  client_id: string
  client_legal_name: string
  site_id: string
  site_name: string
  employee_id: string
  employee_first_name: string
  employee_last_name: string
  employee_avatar_path: string | null
  effective_start_time: string
  effective_end_time: string
  effective_starts_at: string | null
  effective_ends_at: string | null
  status: AssignmentStatus
  display_status: string
  notes: string | null
  check_in_at: string | null
  check_out_at: string | null
  check_in_source: AttendanceSource | null
  check_in_recorded_by: string | null
  check_out_source: AttendanceSource | null
  check_out_recorded_by: string | null
  minutes_late: number | null
  minutes_early_leave: number | null
  last_notice_kind: NoticeKind | null
  last_notice_minutes_late: number | null
  last_notice_reason_code: AbsenceReason | null
  last_notice_reason_text: string | null
  last_notice_reported_by: string | null
  last_notice_source: AttendanceSource | null
  last_notice_at: string | null
}

function mapAttendanceBoardRow(row: AttendanceBoardRawRow): AttendanceBoardRow {
  return {
    id: row.id,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    shiftStatus: row.shift_status,
    clientId: row.client_id,
    clientName: row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    employeeId: row.employee_id,
    employeeFirstName: row.employee_first_name,
    employeeLastName: row.employee_last_name,
    employeeAvatarPath: row.employee_avatar_path,
    startTime: row.effective_start_time,
    endTime: row.effective_end_time,
    startsAt: row.effective_starts_at,
    endsAt: row.effective_ends_at,
    status: row.status,
    displayStatus: row.display_status,
    notes: row.notes,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    checkInSource: row.check_in_source,
    checkInRecordedBy: row.check_in_recorded_by,
    checkOutSource: row.check_out_source,
    checkOutRecordedBy: row.check_out_recorded_by,
    minutesLate: row.minutes_late,
    minutesEarlyLeave: row.minutes_early_leave,
    lastNoticeKind: row.last_notice_kind,
    lastNoticeMinutesLate: row.last_notice_minutes_late,
    lastNoticeReasonCode: row.last_notice_reason_code,
    lastNoticeReasonText: row.last_notice_reason_text,
    lastNoticeReportedBy: row.last_notice_reported_by,
    lastNoticeSource: row.last_notice_source,
    lastNoticeAt: row.last_notice_at,
  }
}

export interface AttendanceBoardFilters {
  clientId?: string
  siteId?: string
  /** `display_status` (incluye el derivado `no_record`). */
  status?: string
}

/**
 * Asistencia de una fecha (ADM-10, ATT-011): todas las asignaciones vigentes
 * de ese día, con su estado de asistencia. `v_assignments_board` no pasa de
 * `max_rows` para un solo día (a diferencia de los rangos de
 * `src/api/assignments.ts`), así que alcanza con una sola página.
 */
export async function fetchAttendanceBoardByDate(
  date: string,
  filters: AttendanceBoardFilters = {},
): Promise<AttendanceBoardRow[]> {
  let query = supabase
    .from('v_assignments_board')
    .select(ATTENDANCE_BOARD_SELECT)
    .eq('shift_date', date)
    .is('removed_at', null)

  if (filters.clientId) {
    query = query.eq('client_id', filters.clientId)
  }
  if (filters.siteId) {
    query = query.eq('site_id', filters.siteId)
  }
  if (filters.status) {
    query = query.eq('display_status', filters.status)
  }

  const { data, error } = await query
    .order('effective_start_time', { ascending: true })
    .order('id', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) =>
    mapAttendanceBoardRow(row as AttendanceBoardRawRow),
  )
}

/**
 * Historial de asistencia de un empleado (ADM-12, ATT-013): `v_assignments_board`
 * filtrado por empleado y rango de fechas, del más reciente al más antiguo.
 * Incluye asignaciones quitadas (`removed_at`), a diferencia de
 * `fetchAttendanceBoardByDate`: son historia, no seguimiento en vivo.
 */
export async function fetchEmployeeAttendanceHistory(
  employeeId: string,
  from: string,
  to: string,
): Promise<AttendanceBoardRow[]> {
  const { data, error } = await supabase
    .from('v_assignments_board')
    .select(ATTENDANCE_BOARD_SELECT)
    .eq('employee_id', employeeId)
    .gte('shift_date', from)
    .lte('shift_date', to)
    .order('shift_date', { ascending: false })
    .order('effective_start_time', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) =>
    mapAttendanceBoardRow(row as AttendanceBoardRawRow),
  )
}

/**
 * Asistencia de las asignaciones vigentes de un turno puntual (ADM-06,
 * ATT-014/ABS-006): mismas columnas que `fetchAttendanceBoardByDate`, pero
 * por lista de ids de asignación en vez de por fecha -- para completar,
 * asignación por asignación, lo que ya trae `fetchShiftDetail`
 * (`src/api/assignments.ts`) con inicio y fin reales, quién y cómo se
 * registraron, y el último aviso.
 */
export async function fetchAssignmentsAttendance(
  assignmentIds: string[],
): Promise<AttendanceBoardRow[]> {
  if (assignmentIds.length === 0) {
    return []
  }
  const { data, error } = await supabase
    .from('v_assignments_board')
    .select(ATTENDANCE_BOARD_SELECT)
    .in('id', assignmentIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) =>
    mapAttendanceBoardRow(row as AttendanceBoardRawRow),
  )
}

/**
 * Teléfonos de una lista de empleados, para "llamar" (`tel:`, ADM-10/ADM-02).
 * `v_assignments_board` no trae el teléfono (no es un dato de asistencia):
 * se busca aparte en `v_employees`, igual criterio que
 * `EmployeesPage`/`EmployeeDetailPage` (`src/api/employees.ts`).
 */
export async function fetchEmployeePhonesByIds(
  employeeIds: string[],
): Promise<Map<string, string | null>> {
  if (employeeIds.length === 0) {
    return new Map()
  }
  const { data, error } = await supabase
    .from('v_employees')
    .select('profile_id, phone')
    .in('profile_id', employeeIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  return new Map(
    (data ?? []).map((row) => [row.profile_id as string, row.phone]),
  )
}

// ---------------------------------------------------------------------------
// Historial completo de una asignación (ADM-06, ATT-014/ABS-006)
// ---------------------------------------------------------------------------

/**
 * Un evento del historial de una asignación (registro de asistencia o
 * aviso), para armar el `Timeline` de ADM-06 (ATT-014, ABS-006: "avisos" en
 * plural). `v_assignments_board` solo trae el ÚLTIMO aviso (`last_notice_*`,
 * pensado para un tablero, no para un historial): acá se leen
 * `attendance_records`/`attendance_notices` directo (RLS `..._select_admin`,
 * `0012_rls_policies.sql`: el dueño y cualquier administrador pueden verlas
 * todas), para tener el historial completo de una asignación puntual.
 */
export interface AttendanceEvent {
  id: string
  createdAt: string
  source: AttendanceSource
  reportedBy: string | null
  /** Discrimina el resto de los campos: `attendance_records.kind` o `attendance_notices.kind`. */
  kind: AttendanceKind | NoticeKind
  /** Solo para un registro (`attendance_records`): el instante real de inicio o fin. */
  recordedAt?: string
  /** Solo para un aviso de demora (`attendance_notices`). */
  minutesLate?: number | null
  /** Solo para un aviso de ausencia (`attendance_notices`). */
  reasonCode?: AbsenceReason | null
  reasonText?: string | null
}

function isAttendanceKind(kind: string): kind is AttendanceKind {
  return kind === 'check_in' || kind === 'check_out'
}

/**
 * Historial completo (registros + avisos) de una lista de asignaciones,
 * ordenado del más antiguo al más reciente por asignación -- para el
 * `Timeline` de ADM-06.
 */
export async function fetchAttendanceTimeline(
  assignmentIds: string[],
): Promise<Map<string, AttendanceEvent[]>> {
  if (assignmentIds.length === 0) {
    return new Map()
  }

  const [recordsResult, noticesResult] = await Promise.all([
    supabase
      .from('attendance_records')
      .select(
        'id, assignment_id, kind, recorded_at, source, recorded_by, created_at',
      )
      .in('assignment_id', assignmentIds),
    supabase
      .from('attendance_notices')
      .select(
        'id, assignment_id, kind, minutes_late, reason_code, reason_text, reported_by, source, created_at',
      )
      .in('assignment_id', assignmentIds),
  ])

  if (recordsResult.error) {
    throw fromPostgrestError(recordsResult.error)
  }
  if (noticesResult.error) {
    throw fromPostgrestError(noticesResult.error)
  }

  const eventsByAssignment = new Map<string, AttendanceEvent[]>()

  function pushEvent(assignmentId: string, event: AttendanceEvent) {
    const list = eventsByAssignment.get(assignmentId) ?? []
    list.push(event)
    eventsByAssignment.set(assignmentId, list)
  }

  for (const row of recordsResult.data ?? []) {
    pushEvent(row.assignment_id, {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      reportedBy: row.recorded_by,
      kind: isAttendanceKind(row.kind) ? row.kind : 'check_in',
      recordedAt: row.recorded_at,
    })
  }
  for (const row of noticesResult.data ?? []) {
    pushEvent(row.assignment_id, {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      reportedBy: row.reported_by,
      kind: row.kind,
      minutesLate: row.minutes_late,
      reasonCode: row.reason_code,
      reasonText: row.reason_text,
    })
  }

  for (const [assignmentId, events] of eventsByAssignment) {
    eventsByAssignment.set(
      assignmentId,
      events
        .slice()
        .sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
    )
  }

  return eventsByAssignment
}

/** Nombre y apellido de una persona, lo mínimo que expone `v_people_basic` (P-103, mismo criterio que `src/api/myDay.ts`). */
export interface PersonName {
  firstName: string
  lastName: string
}

/**
 * Nombres de quien registró o avisó algo en nombre de otra persona (ATT-014,
 * ABS-006: "quién y cómo se registraron" -- `check_in_recorded_by`,
 * `check_out_recorded_by`, `last_notice_reported_by` de `v_assignments_board`
 * son ids de `profiles`, sin nombre; acá se resuelven en un segundo paso,
 * igual criterio que `fetchShiftPeers`, `src/api/myDay.ts`).
 */
export async function fetchPeopleNamesByIds(
  profileIds: string[],
): Promise<Map<string, PersonName>> {
  const ids = Array.from(new Set(profileIds))
  if (ids.length === 0) {
    return new Map()
  }
  const { data, error } = await supabase
    .from('v_people_basic')
    .select('profile_id, first_name, last_name')
    .in('profile_id', ids)

  if (error) {
    throw fromPostgrestError(error)
  }
  return new Map(
    (data ?? []).map((row) => [
      row.profile_id as string,
      { firstName: row.first_name ?? '', lastName: row.last_name ?? '' },
    ]),
  )
}
