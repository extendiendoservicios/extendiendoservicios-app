import type { AssignmentBoardRow } from '@/api/assignments'
import type { AdminWorkday } from '@/api/workdaysAdmin'
import type {
  AgendaEmployeeColor,
  AgendaLeave,
  AgendaStaffLine,
  AgendaStaffMember,
} from '@/api/agenda'

/**
 * Armado de la lista diaria de la Agenda como el parte de WhatsApp (AG-21 a
 * AG-25), sin React: todo el personal activo por legajo, con el renglón fijo,
 * los renglones automáticos (turnos y licencias, por hora) y los renglones
 * libres del día. Los coordinadores suman su jornada y supervisiones, solo para
 * mirar. Nada de esto se guarda en la Agenda salvo el renglón fijo, el color y
 * los renglones libres.
 */

/** Legajo con dos dígitos (con más de 99, tres): 2 → «02», 15 → «15», 105 → «105». */
export function formatEmployeeNumber(employeeNumber: number): string {
  return String(employeeNumber).padStart(2, '0')
}

function timeHm(time: string): string {
  return time.slice(0, 5)
}

/** Hora al estilo del grupo: «07:00» → «7», «09:15» → «9:15», «12:15» → «12:15». */
export function formatGroupTime(time: string): string {
  const [hours = '0', minutes = '00'] = timeHm(time).split(':')
  const h = String(Number(hours))
  return minutes === '00' ? h : `${h}:${minutes}`
}

/** «7 A 11», «9:15 A 12:15» o, si el turno es «a terminar», «DESDE 7». */
export function formatGroupRange(
  startTime: string,
  endTime: string,
  openEnded: boolean,
): string {
  if (openEnded) {
    return `DESDE ${formatGroupTime(startTime)}`
  }
  return `${formatGroupTime(startTime)} A ${formatGroupTime(endTime)}`
}

/** Horario efectivo para mostrar en la lista de pantalla («08:00 a 12:00»). */
export function formatShiftTimeLabel(
  startTime: string,
  endTime: string,
  openEnded: boolean,
): string {
  if (openEnded) {
    return `Desde ${timeHm(startTime)} (a terminar)`
  }
  return `${timeHm(startTime)} a ${timeHm(endTime)}`
}

/** Renglón automático de un turno real: lleva lo que hace falta para actuar sobre él. */
export interface ShiftLine {
  kind: 'shift'
  /** Texto del parte: «7 A 11 MERCED 1358 (VIDRIOS)». */
  text: string
  assignmentId: string
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
  openEnded: boolean
  shiftStatus: AssignmentBoardRow['shiftStatus']
  siteName: string
  clientName: string
  /** Otras personas asignadas al mismo turno ese día (para el aviso de cancelar). */
  otherPeopleCount: number
}

/** Renglón automático de una licencia: «VACACIONES DIA 1». */
export interface LeaveLine {
  kind: 'leave'
  text: string
}

export type AutoLine = ShiftLine | LeaveLine

export interface DailyStaffEntry {
  employeeId: string
  /** Legajo: «02», «15», «105». */
  numberLabel: string
  /** «Nombre Apellido». */
  name: string
  /** «02 Nombre Apellido». */
  label: string
  isCoordinator: boolean
  borderColor: number | null
  fillColor: number | null
  /** Renglón fijo de puesto o zona, o `null`. */
  fixedLine: string | null
  /** Licencias y turnos, ordenados por hora (las licencias, de todo el día, primero). */
  autoLines: AutoLine[]
  /** Renglones libres del día, por posición. */
  freeLines: AgendaStaffLine[]
}

/** Días transcurridos de una licencia contando el primero como 1. */
export function leaveDayNumber(startsOn: string, day: string): number {
  const toUtc = (iso: string) =>
    Date.UTC(
      Number(iso.slice(0, 4)),
      Number(iso.slice(5, 7)) - 1,
      Number(iso.slice(8, 10)),
    )
  return Math.round((toUtc(day) - toUtc(startsOn)) / 86_400_000) + 1
}

/** «VACACIONES DIA 1»: el motivo tal cual en mayúsculas y el número de día. */
export function leaveLineText(leave: AgendaLeave, day: string): string {
  const reason = leave.reason?.trim() ? leave.reason.trim() : 'Licencia'
  return `${reason.toUpperCase()} DIA ${leaveDayNumber(leave.startsOn, day)}`
}

/** Los turnos cancelados no figuran. */
function isListable(row: AssignmentBoardRow): boolean {
  return row.shiftStatus !== 'cancelled'
}

export function buildDailyStaffList(input: {
  day: string
  staff: AgendaStaffMember[]
  /** Asignaciones vigentes (no quitadas) del día. */
  assignments: AssignmentBoardRow[]
  /** Observación del turno, por id de turno. */
  shiftObservations: Record<string, string>
  leaves: AgendaLeave[]
  staffLines: AgendaStaffLine[]
  colors: AgendaEmployeeColor[]
}): DailyStaffEntry[] {
  const colorById = new Map(input.colors.map((c) => [c.employeeId, c]))
  const rows = input.assignments.filter(isListable)

  const peopleByShift = new Map<string, number>()
  for (const row of rows) {
    peopleByShift.set(row.shiftId, (peopleByShift.get(row.shiftId) ?? 0) + 1)
  }

  const shiftsByEmployee = new Map<string, ShiftLine[]>()
  for (const row of rows) {
    const observation = input.shiftObservations[row.shiftId]
    const text = [
      formatGroupRange(row.startTime, row.endTime, row.openEnded),
      row.siteName,
      observation ? `(${observation})` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toUpperCase()
    const line: ShiftLine = {
      kind: 'shift',
      text,
      assignmentId: row.id,
      shiftId: row.shiftId,
      shiftDate: row.shiftDate,
      startTime: row.startTime,
      endTime: row.endTime,
      openEnded: row.openEnded,
      shiftStatus: row.shiftStatus,
      siteName: row.siteName,
      clientName: row.clientName,
      otherPeopleCount: (peopleByShift.get(row.shiftId) ?? 1) - 1,
    }
    const list = shiftsByEmployee.get(row.employeeId)
    if (list) {
      list.push(line)
    } else {
      shiftsByEmployee.set(row.employeeId, [line])
    }
  }

  const leavesByEmployee = new Map<string, LeaveLine[]>()
  for (const leave of input.leaves) {
    const line: LeaveLine = {
      kind: 'leave',
      text: leaveLineText(leave, input.day),
    }
    const list = leavesByEmployee.get(leave.employeeId)
    if (list) {
      list.push(line)
    } else {
      leavesByEmployee.set(leave.employeeId, [line])
    }
  }

  const linesByEmployee = new Map<string, AgendaStaffLine[]>()
  for (const line of input.staffLines) {
    const list = linesByEmployee.get(line.employeeId)
    if (list) {
      list.push(line)
    } else {
      linesByEmployee.set(line.employeeId, [line])
    }
  }

  return [...input.staff]
    .sort((a, b) => a.employeeNumber - b.employeeNumber)
    .map((member) => {
      const color = colorById.get(member.profileId)
      const numberLabel = formatEmployeeNumber(member.employeeNumber)
      const name = `${member.firstName} ${member.lastName}`.trim()
      const shifts = [...(shiftsByEmployee.get(member.profileId) ?? [])].sort(
        (a, b) => a.startTime.localeCompare(b.startTime),
      )
      return {
        employeeId: member.profileId,
        numberLabel,
        name,
        label: `${numberLabel} ${name}`,
        isCoordinator: member.isCoordinator,
        borderColor: color?.borderColor ?? null,
        fillColor: color?.fillColor ?? null,
        fixedLine: color?.fixedLine ?? null,
        autoLines: [
          ...(leavesByEmployee.get(member.profileId) ?? []),
          ...shifts,
        ],
        freeLines: [...(linesByEmployee.get(member.profileId) ?? [])].sort(
          (a, b) => a.position - b.position,
        ),
      }
    })
}

export interface DailyCoordinatorEntry {
  workdayId: string
  supervisorId: string
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

/** Jornada y supervisiones de los coordinadores del día (solo lectura), por persona. */
export function buildCoordinatorWorkdays(
  workdays: AdminWorkday[],
): Map<string, DailyCoordinatorEntry> {
  const result = new Map<string, DailyCoordinatorEntry>()
  for (const workday of workdays) {
    const start = clockLabel(workday.startedAt)
    result.set(workday.supervisorId, {
      workdayId: workday.id,
      supervisorId: workday.supervisorId,
      workdayLabel: workday.endedAt
        ? `Jornada ${start} a ${clockLabel(workday.endedAt)}`
        : `Jornada desde ${start} (en curso)`,
      supervisions: workday.supervisions.map((supervision) => ({
        id: supervision.supervisionId,
        clientName: supervision.clientName,
        siteName: supervision.siteName,
      })),
    })
  }
  return result
}

/** Pasa dos renglones libres de lugar y devuelve el nuevo orden (para subir o bajar). */
export function moveLine<T>(lines: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta
  if (target < 0 || target >= lines.length) {
    return lines
  }
  const next = [...lines]
  const moved = next[index] as T
  next[index] = next[target] as T
  next[target] = moved
  return next
}
