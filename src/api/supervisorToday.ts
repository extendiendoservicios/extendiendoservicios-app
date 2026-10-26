import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { fromPostgrestError } from './errors'
import type { AssignmentStatus } from './assignments'
import type { SupervisionStatus } from './mySupervisions'

/**
 * `src/api/supervisorToday.ts` (P24.2, CJ-02, CJ-04, CJ-25): los turnos de hoy
 * de todos los clientes y sedes, con la prioridad del coordinador, los
 * empleados asignados y quién supervisa cada turno. Sale de
 * `v_supervisor_today` (respaldada por `app.supervisor_today()`: el
 * coordinador no lee esos turnos por RLS).
 */

export type TodayShiftState = 'in_progress' | 'pending' | 'finished'

/** Un empleado asignado al turno (con su `assignment_id`, que pide `rate_employee`). */
export interface TodayShiftEmployee {
  assignmentId: string
  employeeId: string
  firstName: string
  lastName: string
  status: AssignmentStatus
  checkInAt: string | null
  checkOutAt: string | null
}

/** Un coordinador que supervisa o ya supervisó el turno (CJ-05, CJ-25). */
export interface TodayShiftSupervisor {
  supervisionId: string
  supervisorId: string
  firstName: string
  lastName: string
  status: SupervisionStatus
  checkInAt: string | null
  checkOutAt: string | null
  isMe: boolean
}

export interface TodayShift {
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
  startsAt: string | null
  endsAt: string | null
  openEnded: boolean
  displayState: TodayShiftState
  requiredStaff: number | null
  clientId: string
  clientName: string
  siteId: string
  siteName: string
  siteAddress: string | null
  siteCity: string | null
  siteLatitude: number | null
  siteLongitude: number | null
  /** Datos útiles de la sede (los mismos de `v_my_day`); `null` si no están cargados. */
  siteContactName: string | null
  siteContactPhone: string | null
  accessInstructions: string | null
  buildingHours: string | null
  restrictionsNotes: string | null
  /** Radio efectivo de la sede (el propio o el general), el mismo que aplica `take_supervision`; `null` si la vista no lo trae. */
  siteRadiusM: number | null
  /** Precisión máxima de la empresa (`geofence_max_accuracy_m`); `null` si la vista no la trae. */
  maxAccuracyM: number | null
  /** `true` si la sede es preferencial (propia o por su cliente, CJ-24): va en «Mis sedes». */
  isPriority: boolean
  assignedEmployees: TodayShiftEmployee[]
  supervisors: TodayShiftSupervisor[]
  /** Mi supervisión de este turno (no cancelada), si ya la tomé (CJ-27). */
  mySupervisionId: string | null
  mySupervisionStatus: SupervisionStatus | null
}

type TodayRawRow = Database['public']['Views']['v_supervisor_today']['Row']

interface RawEmployee {
  assignment_id: string
  employee_id: string
  first_name: string | null
  last_name: string | null
  status: AssignmentStatus
  check_in_at: string | null
  check_out_at: string | null
}

interface RawSupervisor {
  supervision_id: string
  supervisor_id: string
  first_name: string | null
  last_name: string | null
  status: SupervisionStatus
  check_in_at: string | null
  check_out_at: string | null
  is_me: boolean
}

function asArray<T>(json: unknown): T[] {
  return Array.isArray(json) ? (json as T[]) : []
}

export function mapTodayShiftRow(row: TodayRawRow): TodayShift {
  return {
    shiftId: row.shift_id as string,
    shiftDate: row.shift_date as string,
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    openEnded: Boolean(row.open_ended),
    displayState: (row.display_state ?? 'pending') as TodayShiftState,
    requiredStaff: row.required_staff,
    clientId: row.client_id as string,
    clientName: row.client_legal_name as string,
    siteId: row.site_id as string,
    siteName: row.site_name as string,
    siteAddress: row.site_address,
    siteCity: row.site_city,
    siteLatitude: row.site_latitude,
    siteLongitude: row.site_longitude,
    siteContactName: row.site_contact_name ?? null,
    siteContactPhone: row.site_contact_phone ?? null,
    accessInstructions: row.access_instructions ?? null,
    buildingHours: row.building_hours ?? null,
    restrictionsNotes: row.restrictions_notes ?? null,
    siteRadiusM: row.site_radius_m ?? null,
    maxAccuracyM: row.max_accuracy_m ?? null,
    isPriority: Boolean(row.is_priority),
    assignedEmployees: asArray<RawEmployee>(row.assigned_employees).map(
      (e) => ({
        assignmentId: e.assignment_id,
        employeeId: e.employee_id,
        firstName: e.first_name ?? '',
        lastName: e.last_name ?? '',
        status: e.status,
        checkInAt: e.check_in_at,
        checkOutAt: e.check_out_at,
      }),
    ),
    supervisors: asArray<RawSupervisor>(row.supervisors).map((s) => ({
      supervisionId: s.supervision_id,
      supervisorId: s.supervisor_id,
      firstName: s.first_name ?? '',
      lastName: s.last_name ?? '',
      status: s.status,
      checkInAt: s.check_in_at,
      checkOutAt: s.check_out_at,
      isMe: Boolean(s.is_me),
    })),
    mySupervisionId: row.my_supervision_id,
    mySupervisionStatus: row.my_supervision_status,
  }
}

/** Los turnos de hoy no cancelados de todos los clientes y sedes (SUP-02, SUP-03). */
export async function fetchSupervisorToday(): Promise<TodayShift[]> {
  const { data, error } = await supabase
    .from('v_supervisor_today')
    .select('*')
    .order('start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map(mapTodayShiftRow)
}

/** 30 s: hace falta ver pronto quién tomó un turno para no pisarse (CJ-25). */
const SUPERVISOR_TODAY_POLLING_MS = 30_000

export const supervisorTodayKeys = {
  all: ['supervisorToday'] as const,
}

/** SUP-02 y SUP-03: los turnos del día. */
export function useSupervisorTodayQuery() {
  return useQuery({
    queryKey: supervisorTodayKeys.all,
    queryFn: fetchSupervisorToday,
    refetchInterval: SUPERVISOR_TODAY_POLLING_MS,
  })
}
