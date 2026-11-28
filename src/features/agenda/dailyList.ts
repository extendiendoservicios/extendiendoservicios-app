import type { AssignmentBoardRow } from '@/api/assignments'
import type { AdminWorkday } from '@/api/workdaysAdmin'
import type { AgendaEmployeeColor } from '@/api/agenda'

/**
 * Armado de la lista diaria de la Agenda (AG-15): empleados con turno ese día
 * ordenados por legajo («001 Nombre Apellido»), con sus turnos reales debajo, y
 * los coordinadores con su jornada y sus supervisiones (solo para mirar). Todo
 * sale de los registros: nada de esto se guarda en la Agenda.
 */

/** Legajo con tres dígitos: 1 → «001». */
export function formatEmployeeNumber(employeeNumber: number): string {
  return String(employeeNumber).padStart(3, '0')
}

/** Lo mínimo del empleado que hace falta para el legajo (`EmployeeOption`). */
export interface DailyEmployeeInfo {
  profileId: string
  name: string
  employeeNumber: number
}

export interface DailyShiftEntry {
  assignmentId: string
  shiftId: string
  shiftDate: string
  /** «08:00 a 12:00» o «Desde 08:00 (a terminar)». */
  timeLabel: string
  startTime: string
  endTime: string
  openEnded: boolean
  siteName: string
  clientName: string
  shiftStatus: AssignmentBoardRow['shiftStatus']
  /** Otras personas asignadas al mismo turno ese día (para el aviso de cancelar). */
  otherPeopleCount: number
}

export interface DailyEmployeeEntry {
  employeeId: string
  /** Legajo con tres dígitos, o `null` si la persona ya no figura entre los activos. */
  numberLabel: string | null
  /** «001 Nombre Apellido». */
  label: string
  name: string
  borderColor: number | null
  fillColor: number | null
  shifts: DailyShiftEntry[]
}

function timeHm(time: string): string {
  return time.slice(0, 5)
}

/** Horario efectivo de la asignación para mostrar. */
export function formatShiftTimeLabel(
  startTime: string,
  endTime: string,
  openEnded: boolean,
): string {
  const start = timeHm(startTime)
  if (openEnded) {
    return `Desde ${start} (a terminar)`
  }
  return `${start} a ${timeHm(endTime)}`
}

/** Los turnos que ya no corren no figuran en la lista del día. */
function isListable(row: AssignmentBoardRow): boolean {
  return row.shiftStatus !== 'cancelled'
}

export function buildDailyEmployeeList(input: {
  assignments: AssignmentBoardRow[]
  employees: DailyEmployeeInfo[]
  colors: AgendaEmployeeColor[]
}): DailyEmployeeEntry[] {
  const infoById = new Map(input.employees.map((e) => [e.profileId, e]))
  const colorById = new Map(input.colors.map((c) => [c.employeeId, c]))
  const rows = input.assignments.filter(isListable)

  const peopleByShift = new Map<string, number>()
  for (const row of rows) {
    peopleByShift.set(row.shiftId, (peopleByShift.get(row.shiftId) ?? 0) + 1)
  }

  const byEmployee = new Map<string, DailyEmployeeEntry>()
  for (const row of rows) {
    let entry = byEmployee.get(row.employeeId)
    if (!entry) {
      const info = infoById.get(row.employeeId)
      const name =
        info?.name ?? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
      const numberLabel = info
        ? formatEmployeeNumber(info.employeeNumber)
        : null
      const color = colorById.get(row.employeeId)
      entry = {
        employeeId: row.employeeId,
        numberLabel,
        label: numberLabel ? `${numberLabel} ${name}` : name,
        name,
        borderColor: color?.borderColor ?? null,
        fillColor: color?.fillColor ?? null,
        shifts: [],
      }
      byEmployee.set(row.employeeId, entry)
    }
    entry.shifts.push({
      assignmentId: row.id,
      shiftId: row.shiftId,
      shiftDate: row.shiftDate,
      timeLabel: formatShiftTimeLabel(
        row.startTime,
        row.endTime,
        row.openEnded,
      ),
      startTime: row.startTime,
      endTime: row.endTime,
      openEnded: row.openEnded,
      siteName: row.siteName,
      clientName: row.clientName,
      shiftStatus: row.shiftStatus,
      otherPeopleCount: (peopleByShift.get(row.shiftId) ?? 1) - 1,
    })
  }

  const entries = [...byEmployee.values()]
  for (const entry of entries) {
    entry.shifts.sort((a, b) => a.startTime.localeCompare(b.startTime))
  }
  // Por legajo; sin legajo (ya no figura entre los activos), al final y por nombre.
  return entries.sort((a, b) => {
    if (a.numberLabel && b.numberLabel) {
      return a.numberLabel.localeCompare(b.numberLabel)
    }
    if (a.numberLabel) {
      return -1
    }
    if (b.numberLabel) {
      return 1
    }
    return a.name.localeCompare(b.name, 'es')
  })
}

export interface DailyCoordinatorEntry {
  workdayId: string
  supervisorId: string
  label: string
  /** «Jornada 08:00 a 16:30» o «Jornada desde 08:00 (en curso)». */
  workdayLabel: string
  supervisions: Array<{
    id: string
    clientName: string
    siteName: string
  }>
}

/** `ISO` a «HH:MM» en hora de Argentina. */
function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

export function buildDailyCoordinatorList(input: {
  workdays: AdminWorkday[]
  employees: DailyEmployeeInfo[]
}): DailyCoordinatorEntry[] {
  const infoById = new Map(input.employees.map((e) => [e.profileId, e]))
  const entries = input.workdays.map((workday) => {
    const info = infoById.get(workday.supervisorId)
    const name = info?.name ?? workday.supervisorName
    const numberLabel = info ? formatEmployeeNumber(info.employeeNumber) : null
    const start = clockLabel(workday.startedAt)
    return {
      sortKey: numberLabel ?? '~',
      entry: {
        workdayId: workday.id,
        supervisorId: workday.supervisorId,
        label: numberLabel ? `${numberLabel} ${name}` : name,
        workdayLabel: workday.endedAt
          ? `Jornada ${start} a ${clockLabel(workday.endedAt)}`
          : `Jornada desde ${start} (en curso)`,
        supervisions: workday.supervisions.map((supervision) => ({
          id: supervision.supervisionId,
          clientName: supervision.clientName,
          siteName: supervision.siteName,
        })),
      } satisfies DailyCoordinatorEntry,
    }
  })
  return entries
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map((item) => item.entry)
}
