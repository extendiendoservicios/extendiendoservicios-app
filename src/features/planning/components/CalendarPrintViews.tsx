import { Badge } from '@/components/ui/badge'
import { getStatusMeta } from '@/components/status'
import type { ShiftStatus as BadgeShiftStatus } from '@/components/status'
import type { ShiftListRow } from '@/api/shifts'
import type { AssignmentBoardRow } from '@/api/assignments'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatShiftRange } from '@/features/shifts/openEnded'
import { shiftFranjaKey } from '@/features/shifts/grouping'
import { shiftChipLabel } from '@/features/planning/grouping'
import { clientChipColors } from '@/features/planning/clientColors'
import type { ColorBy } from '@/features/planning/colorBy'
import {
  leaveEntryText,
  leaveReasonLabel,
  leaveSummaryLabel,
  type LeaveEntry,
} from '@/features/planning/calendarFilters'

/**
 * Contenido de la hoja impresa del calendario (OD-15): tablas estáticas, sin
 * enlaces ni recortes («+n más» no existe en papel: salen todos los turnos),
 * con el texto del estado al lado del color para que se lea en blanco y
 * negro. Se montan dentro de `CalendarPrintButton`.
 */

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function PrintLine({
  label,
  displayStatus,
  clientCalendarColor,
  colorBy,
}: {
  label: string
  displayStatus: string
  clientCalendarColor?: number | null
  colorBy: ColorBy
}) {
  const meta = getStatusMeta({
    domain: 'shift',
    status: displayStatus as BadgeShiftStatus,
  })
  const colors =
    colorBy === 'client' ? clientChipColors(clientCalendarColor) : null
  const text = `${label} (${meta.label})`
  if (colors) {
    return (
      <div
        style={{ background: colors.background, color: colors.color }}
        className="mb-px rounded px-1 py-px text-[7pt] leading-tight break-words"
      >
        {text}
      </div>
    )
  }
  return (
    <Badge
      variant={meta.variant}
      className="mb-px block w-full rounded px-1 py-px text-[7pt] leading-tight break-words whitespace-normal"
    >
      {text}
    </Badge>
  )
}

function PrintLeave({ text }: { text: string }) {
  return (
    <div className="mb-px rounded border border-dashed border-black px-1 py-px text-[7pt] leading-tight italic">
      {text}
    </div>
  )
}

// -------------------------------------------------------------------------
// Mes
// -------------------------------------------------------------------------

interface MonthPrintProps {
  gridDays: { date: string; isCurrentMonth: boolean }[]
  shiftsByDate: Map<string, ShiftListRow[]>
  /** Quienes están de licencia (nombre y motivo), por fecha. */
  leaveNamesByDate: Map<string, LeaveEntry[]>
  holidayDates: ReadonlySet<string>
  colorBy: ColorBy
}

function MonthPrint({
  gridDays,
  shiftsByDate,
  leaveNamesByDate,
  holidayDates,
  colorBy,
}: MonthPrintProps) {
  const weeks: (typeof gridDays)[] = []
  for (let index = 0; index < gridDays.length; index += 7) {
    weeks.push(gridDays.slice(index, index + 7))
  }
  return (
    <table className="border border-black text-[8pt]">
      <thead>
        <tr>
          {WEEKDAY_LABELS.map((label) => (
            <th key={label} className="border border-black px-1 py-0.5">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]?.date}>
            {week.map((day) => {
              const shifts = shiftsByDate.get(day.date) ?? []
              const leaves = leaveNamesByDate.get(day.date) ?? []
              return (
                <td
                  key={day.date}
                  className={`h-[24mm] border border-black p-0.5 align-top ${
                    day.isCurrentMonth ? '' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <div className="mb-px flex justify-between text-[8pt] font-bold">
                    <span>{Number(day.date.slice(8, 10))}</span>
                    {holidayDates.has(day.date) && (
                      <span className="font-semibold">Feriado</span>
                    )}
                  </div>
                  {shifts.map((shift) => (
                    <PrintLine
                      key={shift.id}
                      label={shiftChipLabel(shift)}
                      displayStatus={shift.displayStatus}
                      clientCalendarColor={shift.clientCalendarColor}
                      colorBy={colorBy}
                    />
                  ))}
                  {leaves.length > 0 && (
                    <PrintLeave
                      text={
                        leaves.length === 1
                          ? leaveSummaryLabel(
                              leaves.map((entry) => entry.name),
                              leaves.map((entry) => entry.reason),
                            )
                          : `${leaves.length} licencias: ${leaves
                              .map(leaveEntryText)
                              .join(', ')}`
                      }
                    />
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// -------------------------------------------------------------------------
// Semana
// -------------------------------------------------------------------------

interface WeekPrintProps {
  weekDays: string[]
  employees: { profileId: string; firstName: string; lastName: string }[]
  assignmentsByEmployee: Map<string, Map<string, AssignmentBoardRow[]>>
  /** Fecha → ids de empleados de licencia. */
  leaveIdsByDate: Map<string, string[]>
  /** Motivo de la licencia de un empleado ese día (P27.5). */
  leaveReasonOf: (employeeId: string, day: string) => string | null
  colorBy: ColorBy
}

function WeekPrint({
  weekDays,
  employees,
  assignmentsByEmployee,
  leaveIdsByDate,
  leaveReasonOf,
  colorBy,
}: WeekPrintProps) {
  return (
    <table className="border border-black text-[8pt]">
      <thead>
        <tr>
          <th className="w-[32mm] border border-black px-1 py-0.5 text-left">
            Empleado
          </th>
          {weekDays.map((day) => (
            <th
              key={day}
              className="border border-black px-1 py-0.5 text-left capitalize"
            >
              {formatDateOnly(day)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {employees.map((employee) => {
          const byDate = assignmentsByEmployee.get(employee.profileId)
          return (
            <tr key={employee.profileId}>
              <td className="border border-black p-0.5 align-top font-semibold">
                {employee.firstName} {employee.lastName}
              </td>
              {weekDays.map((day) => {
                const assignments = byDate?.get(day) ?? []
                const onLeave = (leaveIdsByDate.get(day) ?? []).includes(
                  employee.profileId,
                )
                return (
                  <td key={day} className="border border-black p-0.5 align-top">
                    {onLeave && (
                      <PrintLeave
                        text={leaveReasonLabel(
                          leaveReasonOf(employee.profileId, day),
                        )}
                      />
                    )}
                    {assignments.map((assignment) => (
                      <PrintLine
                        key={assignment.id}
                        label={`${assignment.clientName} · ${assignment.siteName} · ${formatShiftRange(
                          assignment.startTime,
                          assignment.endTime,
                          assignment.openEnded,
                        )}`}
                        displayStatus={assignment.shiftStatus}
                        clientCalendarColor={assignment.clientCalendarColor}
                        colorBy={colorBy}
                      />
                    ))}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// -------------------------------------------------------------------------
// Día
// -------------------------------------------------------------------------

interface DayPrintProps {
  shifts: ShiftListRow[]
  /** Nombres de los asignados por turno. */
  employeesOfShift: (shiftId: string) => string[]
  supervisorsOfShift: (shiftId: string) => string[]
  leaveNames: string[]
  colorBy: ColorBy
}

function DayPrint({
  shifts,
  employeesOfShift,
  supervisorsOfShift,
  leaveNames,
  colorBy,
}: DayPrintProps) {
  return (
    <div className="flex flex-col gap-3">
      <table className="border border-black text-[9pt]">
        <thead>
          <tr>
            <th className="w-[28mm] border border-black px-1 py-0.5 text-left">
              Horario
            </th>
            <th className="border border-black px-1 py-0.5 text-left">
              Cliente · sede
            </th>
            <th className="w-[20mm] border border-black px-1 py-0.5 text-left">
              Dotación
            </th>
            <th className="border border-black px-1 py-0.5 text-left">
              Asignados
            </th>
            <th className="w-[40mm] border border-black px-1 py-0.5 text-left">
              Coordinador
            </th>
          </tr>
        </thead>
        <tbody>
          {shifts.length === 0 && (
            <tr>
              <td colSpan={5} className="border border-black p-1">
                No hay turnos para este día.
              </td>
            </tr>
          )}
          {shifts.map((shift) => (
            <tr key={shift.id}>
              <td className="border border-black p-1 align-top">
                {shiftFranjaKey(shift)}
              </td>
              <td className="border border-black p-1 align-top">
                <PrintLine
                  label={`${shift.clientName} · ${shift.siteName}`}
                  displayStatus={shift.displayStatus}
                  clientCalendarColor={shift.clientCalendarColor}
                  colorBy={colorBy}
                />
              </td>
              <td className="border border-black p-1 align-top">
                {shift.assignedCount}/{shift.requiredStaff}
              </td>
              <td className="border border-black p-1 align-top">
                {employeesOfShift(shift.id).join(', ') || '—'}
              </td>
              <td className="border border-black p-1 align-top">
                {supervisorsOfShift(shift.id).join(', ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leaveNames.length > 0 && (
        <p className="text-[9pt]">
          <strong>De licencia:</strong> {leaveNames.join(', ')}
        </p>
      )}
    </div>
  )
}

export { MonthPrint, WeekPrint, DayPrint }
