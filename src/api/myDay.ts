import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'

/**
 * `src/api/myDay.ts` (ATT-005, `06_API.md` sección 10): la pantalla Hoy del
 * empleado (EMP-03) y lo que necesita el detalle del servicio (EMP-04) que
 * no sale de `v_my_day` directamente (compañeros de turno, tareas
 * previstas). Mismo patrón que `src/api/assignments.ts`/`src/api/tasks.ts`
 * (ver `src/api/README.md`).
 */

export type AssignmentStatus = Database['public']['Enums']['assignment_status']
export type ShiftStatus = Database['public']['Enums']['shift_status']

// -------------------------------------------------------------------------
// 1. v_my_day (EMP-03, EMP-04)
// -------------------------------------------------------------------------

/**
 * Una fila de `v_my_day`: una asignación propia de hoy o de los próximos 7
 * días (P-093, la vista ya filtra el rango y `employee_id = auth.uid()` —
 * ver `0011_views.sql`). Nombres en `camelCase`, sin repetir acá las
 * columnas `client_legal_name`/`client_trade_name` sueltas: `clientName` ya
 * resuelve la preferencia por el nombre de fantasía (mismo criterio que
 * `mapShiftBoardRow`, `src/api/shifts.ts`).
 */
export interface MyDayAssignment {
  assignmentId: string
  shiftId: string
  shiftDate: string
  /** `true` si `shiftDate` es hoy (P-093: distingue "hoy en detalle" de la lista simple de próximos días). */
  isToday: boolean
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  siteAddress: string | null
  siteContactName: string | null
  siteContactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  phoneRestricted: boolean
  photosNotAllowed: boolean
  restrictionsNotes: string | null
  /** Franja efectiva: la propia de la asignación si tiene, si no la del turno (`effective_*`). */
  startTime: string
  endTime: string
  startsAt: string | null
  endsAt: string | null
  status: AssignmentStatus
  shiftStatus: ShiftStatus
  notes: string | null
  tasksTotal: number
  tasksDone: number
  /**
   * `true` si la asignación o el turno cambiaron desde la última vez que la
   * persona abrió Hoy (P-092). OJO: esto se enciende también por acciones
   * DEL PROPIO empleado (registrar el inicio, el fin, cargar la
   * observación o marcar una tarea actualizan `assignments.updated_at`,
   * `reporte P13.1`) — la pantalla NO tiene que tratar esas asignaciones
   * como "cambio de otro": ver `isRelevantChange` más abajo, la regla real
   * que hay que usar para pintar el bloque "Cambios desde tu última
   * visita" de EMP-03.
   */
  changedSinceLastSeen: boolean
  checkInAt: string | null
  checkOutAt: string | null
}

interface MyDayRawRow {
  assignment_id: string
  shift_id: string
  shift_date: string
  is_today: boolean
  client_id: string
  client_legal_name: string
  client_trade_name: string | null
  site_id: string
  site_name: string
  site_address: string | null
  site_contact_name: string | null
  site_contact_phone: string | null
  access_instructions: string | null
  building_hours: string | null
  phone_restricted: boolean
  photos_not_allowed: boolean
  restrictions_notes: string | null
  effective_start_time: string
  effective_end_time: string
  effective_starts_at: string | null
  effective_ends_at: string | null
  status: AssignmentStatus
  shift_status: ShiftStatus
  notes: string | null
  tasks_total: number
  tasks_done: number
  changed_since_last_seen: boolean
  check_in_at: string | null
  check_out_at: string | null
}

function mapMyDayRow(row: MyDayRawRow): MyDayAssignment {
  return {
    assignmentId: row.assignment_id,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    isToday: row.is_today,
    clientId: row.client_id,
    clientName: row.client_trade_name ?? row.client_legal_name,
    siteId: row.site_id,
    siteName: row.site_name,
    siteAddress: row.site_address,
    siteContactName: row.site_contact_name,
    siteContactPhone: row.site_contact_phone,
    accessInstructions: row.access_instructions,
    buildingHours: row.building_hours,
    phoneRestricted: row.phone_restricted,
    photosNotAllowed: row.photos_not_allowed,
    restrictionsNotes: row.restrictions_notes,
    startTime: row.effective_start_time,
    endTime: row.effective_end_time,
    startsAt: row.effective_starts_at,
    endsAt: row.effective_ends_at,
    status: row.status,
    shiftStatus: row.shift_status,
    notes: row.notes,
    tasksTotal: row.tasks_total,
    tasksDone: row.tasks_done,
    changedSinceLastSeen: row.changed_since_last_seen,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
  }
}

/**
 * `v_my_day` completa (EMP-03: hoy y los próximos 7 días, ya resuelto por
 * la vista). Orden por fecha y franja de inicio, para que "hoy" salga
 * primero y cada día quede con sus servicios en el orden en que empiezan
 * (CB-01: varios turnos en el día, en orden).
 */
export async function fetchMyDay(): Promise<MyDayAssignment[]> {
  const { data, error } = await supabase
    .from('v_my_day')
    .select('*')
    .order('shift_date', { ascending: true })
    .order('effective_start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data as unknown as MyDayRawRow[]).map(mapMyDayRow)
}

/**
 * Regla real para pintar el bloque "Cambios desde tu última visita" de
 * EMP-03 (P-092, ver el comentario grande de `changedSinceLastSeen`
 * arriba): un cambio solo es relevante para el aviso si la asignación
 * TODAVÍA no tiene el inicio registrado. Una vez que el empleado fichó el
 * inicio, cualquier `changed_since_last_seen` que se prenda de ahí en
 * adelante (su propio fin, su propia observación, sus propias tareas) ya
 * no es una novedad que este bloque tenga que anunciar.
 */
export function isRelevantChange(assignment: MyDayAssignment): boolean {
  return assignment.changedSinceLastSeen && assignment.checkInAt == null
}

// -------------------------------------------------------------------------
// 2. mark_changes_seen (EMP-03: se llama al abrir Hoy, después de leer la vista)
// -------------------------------------------------------------------------

/**
 * Marca como vistos los cambios de hoy (`profiles.last_seen_changes_at =
 * now()`, `06` sección 10). Se llama DESPUÉS de leer `v_my_day` (nunca
 * antes): si se llamara primero, la propia lectura podría no traer más
 * `changed_since_last_seen` en `true` y la persona se perdería el aviso que
 * vino a ver.
 */
export async function markChangesSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_changes_seen')
  if (error) {
    throw fromPostgrestError(error)
  }
}

// -------------------------------------------------------------------------
// 3. Compañeros del turno (EMP-04, `v_people_basic`, P-103)
// -------------------------------------------------------------------------

/** Un compañero de turno: solo nombre y foto (P-103, `v_people_basic` no expone más columnas). */
export interface ShiftPeer {
  profileId: string
  firstName: string
  lastName: string
  avatarPath: string | null
}

/**
 * Compañeros de un turno, sin la propia fila (EMP-04: "compañeros del
 * turno (nombre y foto)"). Dos pasos porque `v_people_basic` no sabe nada
 * de turnos: primero los `employee_id` de las asignaciones vigentes de ese
 * turno (RLS `assignments_select_employee`, ver `0012_rls_policies.sql`:
 * cualquier empleado con una asignación vigente en el turno puede leer las
 * de sus compañeros), después sus datos básicos.
 */
export async function fetchShiftPeers(
  shiftId: string,
  selfProfileId: string,
): Promise<ShiftPeer[]> {
  const { data: assignmentRows, error: assignmentsError } = await supabase
    .from('assignments')
    .select('employee_id')
    .eq('shift_id', shiftId)
    .is('removed_at', null)

  if (assignmentsError) {
    throw fromPostgrestError(assignmentsError)
  }

  const peerIds = Array.from(
    new Set((assignmentRows ?? []).map((row) => row.employee_id)),
  ).filter((id) => id !== selfProfileId)

  if (peerIds.length === 0) {
    return []
  }

  const { data: peopleRows, error: peopleError } = await supabase
    .from('v_people_basic')
    .select('profile_id, first_name, last_name, avatar_path')
    .in('profile_id', peerIds)

  if (peopleError) {
    throw fromPostgrestError(peopleError)
  }

  return (peopleRows ?? []).map((row) => ({
    profileId: row.profile_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    avatarPath: row.avatar_path,
  }))
}
