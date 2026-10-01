import { useEffect, useMemo, useState } from 'react'
import type { AttendanceBoardRow } from '@/api/attendance'
import type { ShiftListRow } from '@/api/shifts'
import { useAuth } from '@/features/auth/AuthProvider'
import { getAvailableAttendanceActions } from '@/features/attendance/derive'
import { canManageAttendance } from '@/features/attendance/permissions'
import {
  useAttendanceBoardByDateQuery,
  useEmployeePhonesQuery,
} from '@/features/attendance/queries'
import { RecordAttendanceSheet } from '@/features/attendance/components/RecordAttendanceSheet'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { AssignEmployeeSheet } from '@/features/planning/components/AssignEmployeeSheet'
import {
  canManageAssignments,
  canManageAssignmentsAfterStart,
} from '@/features/planning/permissions'
import { useShiftsByDateQuery } from '@/features/shifts/queries'
import { useSupervisionsAdminQuery } from '@/features/supervisions/queries'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { computeAttention, type AttentionItem } from '../attention'
import { computeKpis, shiftStartInstant } from '../kpis'
import { AttentionBlock } from './AttentionBlock'
import { DashboardKpis } from './DashboardKpis'
import { ServicesTodayTable } from './ServicesTodayTable'
import { SupervisionsTodayBlock } from './SupervisionsTodayBlock'

/** Reloj del tablero: avanza cada 30 s, igual que el polling, para que "hoy" y los cálculos por hora no queden viejos. */
const CLOCK_TICK_MS = 30_000

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const intervalId = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(intervalId)
  }, [])
  return now
}

/**
 * ADM-02 "Resumen" (DASH-001 a DASH-007, `05` línea 36): KPIs, "Requiere
 * atención", "Servicios de hoy" y supervisiones del día. Tres consultas del
 * día, todas filtradas por fecha y con polling de 30 s (las de turnos y
 * asignaciones se comparten con ADM-05 y ADM-10 por clave de caché), más la
 * de supervisiones (60 s, solo lectura). Sin consultas por fila.
 */
function DashboardScreen() {
  const auth = useAuth()
  const actor = { roles: auth.roles, capabilities: auth.capabilities }
  const canRecord = canManageAttendance(actor)
  const canAssignBeforeStart = canManageAssignments(actor)
  const canAssignAfterStart = canManageAssignmentsAfterStart(actor)

  const now = useClock()
  const today = todayInBuenosAires()

  const shiftsQuery = useShiftsByDateQuery(today, true)
  const boardQuery = useAttendanceBoardByDateQuery(today, {}, true)
  const supervisionsQuery = useSupervisionsAdminQuery({
    dateFrom: today,
    dateTo: today,
  })

  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data])
  // `v_assignments_board` solo trae la razón social; el resto del tablero
  // muestra el nombre de fantasía del turno. Se toma el del turno para que
  // un mismo cliente no aparezca con dos nombres distintos.
  const assignments = useMemo(() => {
    const clientNameByShift = new Map(
      shifts.map((shift) => [shift.id, shift.clientName]),
    )
    return (boardQuery.data ?? []).map((row) => {
      const clientName = clientNameByShift.get(row.shiftId)
      return clientName ? { ...row, clientName } : row
    })
  }, [boardQuery.data, shifts])

  const employeeIds = useMemo(
    () => Array.from(new Set(assignments.map((row) => row.employeeId))),
    [assignments],
  )
  const phonesQuery = useEmployeePhonesQuery(employeeIds)

  const kpis = useMemo(
    () => computeKpis(shifts, assignments, now),
    [shifts, assignments, now],
  )
  const attention = useMemo(
    () => computeAttention(shifts, assignments, now),
    [shifts, assignments, now],
  )
  const shiftById = useMemo(
    () => new Map(shifts.map((shift) => [shift.id, shift])),
    [shifts],
  )

  const [recordTarget, setRecordTarget] = useState<AttendanceBoardRow | null>(
    null,
  )
  const [assignTarget, setAssignTarget] = useState<ShiftListRow | null>(null)

  function recordActionsFor(row: AttendanceBoardRow) {
    return getAvailableAttendanceActions({
      shiftStatus: row.shiftStatus,
      status: row.status,
      checkInAt: row.checkInAt,
      checkOutAt: row.checkOutAt,
      startsAt: row.startsAt,
      now,
    })
  }

  function canRecordRow(row: AttendanceBoardRow): boolean {
    return canRecord && recordActionsFor(row).length > 0
  }

  /** Después de la hora de inicio asignar exige además `manage_attendance` (`06` sección 8). */
  function canAssignTo(shiftId: string): boolean {
    const shift = shiftById.get(shiftId)
    if (!shift) {
      return false
    }
    const started =
      shiftStartInstant(shift.shiftDate, shift.startTime).getTime() <=
      now.getTime()
    return started ? canAssignAfterStart : canAssignBeforeStart
  }

  function handleAssign(shiftId: string) {
    const shift = shiftById.get(shiftId)
    if (shift) {
      setAssignTarget(shift)
    }
  }

  const isLoading = shiftsQuery.isLoading || boardQuery.isLoading
  const loadError = shiftsQuery.error ?? boardQuery.error
  const updatedAt = Math.min(
    ...[shiftsQuery.dataUpdatedAt, boardQuery.dataUpdatedAt].filter(
      (timestamp) => timestamp > 0,
    ),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-text-3 capitalize">
          {formatDateOnly(today)}
        </p>
        {Number.isFinite(updatedAt) && <UpdatedAgo dataUpdatedAt={updatedAt} />}
      </div>

      {loadError && (
        <p role="alert" className="text-[13px] text-danger-800">
          {loadError.message}
        </p>
      )}

      <DashboardKpis kpis={kpis} />

      <AttentionBlock
        items={attention}
        isLoading={isLoading}
        phones={phonesQuery.data}
        canRecord={(item: AttentionItem) =>
          item.assignment != null && canRecordRow(item.assignment)
        }
        canAssign={canAssignTo}
        onRecord={(item) => item.assignment && setRecordTarget(item.assignment)}
        onAssign={(item) => handleAssign(item.shiftId)}
      />

      <ServicesTodayTable
        rows={assignments}
        isLoading={isLoading}
        phones={phonesQuery.data}
        canRecord={canRecordRow}
        canAssign={canAssignTo}
        onRecord={setRecordTarget}
        onAssign={(row) => handleAssign(row.shiftId)}
      />

      <SupervisionsTodayBlock
        rows={supervisionsQuery.data ?? []}
        isLoading={supervisionsQuery.isLoading}
      />

      {recordTarget && (
        <RecordAttendanceSheet
          assignmentId={recordTarget.id}
          employeeName={`${recordTarget.employeeFirstName} ${recordTarget.employeeLastName}`}
          shiftDate={recordTarget.shiftDate}
          actions={recordActionsFor(recordTarget)}
          open
          onOpenChange={(open) => {
            if (!open) {
              setRecordTarget(null)
            }
          }}
        />
      )}

      {assignTarget && (
        <AssignEmployeeSheet
          shiftId={assignTarget.id}
          clientId={assignTarget.clientId}
          shiftDate={assignTarget.shiftDate}
          shiftStartTime={assignTarget.startTime}
          shiftEndTime={assignTarget.endTime}
          excludeEmployeeIds={assignments
            .filter((row) => row.shiftId === assignTarget.id)
            .map((row) => row.employeeId)}
          open
          onOpenChange={(open) => {
            if (!open) {
              setAssignTarget(null)
            }
          }}
        />
      )}
    </div>
  )
}

export { DashboardScreen }
