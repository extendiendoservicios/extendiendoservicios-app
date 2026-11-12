import { supabase } from '@/lib/supabase'
import { fromPostgrestError } from '@/api/errors'
import type { AssignmentStatus, ShiftStatus } from '@/components/status/types'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { addDaysToIsoDate } from '@/features/settings/dateOnly'

/**
 * Cobertura de los servicios de un listado (OF-04, P28.3): empleados fijos y
 * turno de hoy o el próximo con quién está asignado. Son tres consultas por
 * lista, sin importar cuántos servicios tenga (nada de N+1): `service_fixed_employees`,
 * `v_shifts_board` y `v_assignments_board`, las tres filtradas con `in(...)`.
 */

/** Hasta cuántos días adelante se busca el próximo turno (cubre servicios de «1.ª semana del mes»). */
export const COVERAGE_LOOKAHEAD_DAYS = 35

export interface CoverageEmployee {
  employeeId: string
  name: string
}

export interface CoverageAssignment extends CoverageEmployee {
  status: AssignmentStatus
}

export interface CoverageShift {
  id: string
  shiftDate: string
  startTime: string
  endTime: string
  openEnded: boolean
  status: ShiftStatus
  requiredStaff: number
  assignedCount: number
  assignments: CoverageAssignment[]
}

export interface ServiceCoverage {
  fixedEmployees: CoverageEmployee[]
  /** Turno de hoy o el próximo no cancelado; `null` si no hay en los próximos 35 días. */
  nextShift: CoverageShift | null
}

export function emptyCoverage(): ServiceCoverage {
  return { fixedEmployees: [], nextShift: null }
}

interface FixedRow {
  service_id: string
  employee_id: string
  employees: {
    profiles: { first_name: string; last_name: string } | null
  } | null
}

interface ShiftRow {
  id: string | null
  service_id: string | null
  shift_date: string | null
  start_time: string | null
  end_time: string | null
  open_ended: boolean | null
  display_status: string | null
  required_staff: number | null
  assigned_count: number | null
}

interface AssignmentRow {
  shift_id: string | null
  employee_id: string | null
  employee_first_name: string | null
  employee_last_name: string | null
  status: AssignmentStatus | null
  effective_start_time: string | null
}

/**
 * Elige, por servicio, el primer turno que no está cancelado (la lista ya
 * viene ordenada por fecha y hora).
 */
export function pickNextShifts(rows: ShiftRow[]): Map<string, ShiftRow> {
  const next = new Map<string, ShiftRow>()
  for (const row of rows) {
    if (!row.service_id || !row.id) continue
    if (row.display_status === 'cancelled') continue
    if (!next.has(row.service_id)) next.set(row.service_id, row)
  }
  return next
}

/** `true` si al turno le falta dotación o el estado ya lo marca sin cubrir. */
export function isShiftUncovered(shift: CoverageShift): boolean {
  return (
    shift.status === 'uncovered' || shift.assignedCount < shift.requiredStaff
  )
}

export async function fetchServicesCoverage(
  serviceIds: string[],
): Promise<Record<string, ServiceCoverage>> {
  const result: Record<string, ServiceCoverage> = {}
  if (serviceIds.length === 0) return result
  for (const id of serviceIds) result[id] = emptyCoverage()

  const today = todayInBuenosAires()
  const until = addDaysToIsoDate(today, COVERAGE_LOOKAHEAD_DAYS)

  const [fixed, shifts] = await Promise.all([
    supabase
      .from('service_fixed_employees')
      .select(
        'service_id, employee_id, employees(profiles!employees_profile_id_fkey(first_name, last_name))',
      )
      .in('service_id', serviceIds),
    supabase
      .from('v_shifts_board')
      .select(
        'id, service_id, shift_date, start_time, end_time, open_ended, display_status, required_staff, assigned_count',
      )
      .in('service_id', serviceIds)
      .gte('shift_date', today)
      .lte('shift_date', until)
      .order('shift_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(5000),
  ])
  if (fixed.error) throw fromPostgrestError(fixed.error)
  if (shifts.error) throw fromPostgrestError(shifts.error)

  for (const row of (fixed.data ?? []) as unknown as FixedRow[]) {
    const profile = row.employees?.profiles
    result[row.service_id]?.fixedEmployees.push({
      employeeId: row.employee_id,
      name: profile ? `${profile.first_name} ${profile.last_name}`.trim() : '',
    })
  }
  for (const coverage of Object.values(result)) {
    coverage.fixedEmployees.sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }

  const nextByService = pickNextShifts(shifts.data)
  const shiftIds = Array.from(nextByService.values()).map((s) => s.id as string)
  const assignmentsByShift = new Map<string, CoverageAssignment[]>()
  if (shiftIds.length > 0) {
    const assignments = await supabase
      .from('v_assignments_board')
      .select(
        'shift_id, employee_id, employee_first_name, employee_last_name, status, effective_start_time',
      )
      .in('shift_id', shiftIds)
      .is('removed_at', null)
      .limit(5000)
    if (assignments.error) throw fromPostgrestError(assignments.error)
    for (const row of assignments.data as AssignmentRow[]) {
      if (!row.shift_id || !row.employee_id || !row.status) continue
      const list = assignmentsByShift.get(row.shift_id) ?? []
      list.push({
        employeeId: row.employee_id,
        name: `${row.employee_first_name ?? ''} ${row.employee_last_name ?? ''}`.trim(),
        status: row.status,
      })
      assignmentsByShift.set(row.shift_id, list)
    }
  }

  for (const [serviceId, row] of nextByService) {
    const assignments = assignmentsByShift.get(row.id as string) ?? []
    result[serviceId] = {
      ...(result[serviceId] ?? emptyCoverage()),
      nextShift: {
        id: row.id as string,
        shiftDate: row.shift_date as string,
        startTime: row.start_time ?? '',
        endTime: row.end_time ?? '',
        openEnded: row.open_ended ?? false,
        status: (row.display_status ?? 'scheduled') as ShiftStatus,
        requiredStaff: row.required_staff ?? 0,
        assignedCount: row.assigned_count ?? assignments.length,
        assignments,
      },
    }
  }
  return result
}
