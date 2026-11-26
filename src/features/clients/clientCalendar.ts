import type { AssignmentBoardRow } from '@/api/assignments'
import type { Holiday } from '@/api/settings'
import type { ShiftListRow } from '@/api/shifts'
import {
  addDaysToIsoDate,
  weekdayOfIsoDate,
} from '@/features/settings/dateOnly'
import { cronogramaTitle, monthRange } from '@/features/employees/cronograma'

/**
 * P34.1 (OL-01): lógica sin React del calendario del cliente. A diferencia del
 * calendario del empleado, cada bloque es un turno (que puede tener varias
 * personas), no una asignación.
 */

/** D-06: bloques que muestra una celda antes del «+N más». */
export const MAX_VISIBLE_BLOCKS = 4

export interface ClientCalendarPerson {
  employeeId: string
  /** Nombre y inicial del apellido: «Ana P.». */
  shortName: string
}

export interface ClientCalendarBlock {
  shiftId: string
  date: string
  /** `08:00`. */
  start: string
  /** `12:00`, o `—` en un turno «a terminar». */
  end: string
  openEnded: boolean
  siteId: string
  siteName: string
  colorIndex: number | null
  status: ShiftListRow['status']
  cancelled: boolean
  completed: boolean
  inProgress: boolean
  requiredStaff: number
  people: ClientCalendarPerson[]
  /** Personas que faltan para completar la dotación (solo si ya hay alguien). */
  missing: number
  /** Sin nadie asignado (no cancelado ni finalizado). */
  uncovered: boolean
}

export interface ClientCalendarDay {
  date: string
  day: number
  inMonth: boolean
  /** Nombre del feriado (o «Feriado» si no tiene nombre). */
  holiday?: string
  blocks: ClientCalendarBlock[]
}

export interface ClientCalendarMonth {
  title: string
  weeks: ClientCalendarDay[][]
  from: string
  to: string
  /** Turnos sin cubrir del mes (D-12). */
  uncoveredCount: number
}

export const HOLIDAY_FALLBACK_NAME = 'Feriado'

type PersonRow = Pick<
  AssignmentBoardRow,
  'shiftId' | 'employeeId' | 'employeeFirstName' | 'employeeLastName'
>

function hhmm(time: string): string {
  return time.slice(0, 5)
}

/** «Ana P.»: nombre de pila y la inicial del apellido. */
export function shortPersonName(firstName: string, lastName: string): string {
  const first = firstName.trim()
  const initial = lastName.trim().charAt(0).toUpperCase()
  return initial ? `${first} ${initial}.` : first
}

/** Agrupa las asignaciones vigentes por turno, sin repetir personas y por nombre. */
export function groupPeopleByShift(
  assignments: PersonRow[],
): Map<string, ClientCalendarPerson[]> {
  const byShift = new Map<string, ClientCalendarPerson[]>()
  for (const row of assignments) {
    const list = byShift.get(row.shiftId) ?? []
    if (list.some((person) => person.employeeId === row.employeeId)) {
      continue
    }
    list.push({
      employeeId: row.employeeId,
      shortName: shortPersonName(row.employeeFirstName, row.employeeLastName),
    })
    byShift.set(row.shiftId, list)
  }
  for (const list of byShift.values()) {
    list.sort((a, b) => a.shortName.localeCompare(b.shortName, 'es'))
  }
  return byShift
}

export function buildClientBlock(
  shift: ShiftListRow,
  people: ClientCalendarPerson[],
): ClientCalendarBlock {
  const cancelled = shift.status === 'cancelled'
  const completed = shift.status === 'completed'
  const missing = Math.max(0, shift.requiredStaff - people.length)
  return {
    shiftId: shift.id,
    date: shift.shiftDate,
    start: hhmm(shift.startTime),
    end: shift.openEnded ? '—' : hhmm(shift.endTime),
    openEnded: shift.openEnded,
    siteId: shift.siteId,
    siteName: shift.siteName,
    colorIndex: shift.clientCalendarColor ?? null,
    status: shift.status,
    cancelled,
    completed,
    inProgress: shift.status === 'in_progress',
    requiredStaff: shift.requiredStaff,
    people,
    missing: people.length > 0 && !cancelled ? missing : 0,
    uncovered: people.length === 0 && !cancelled && !completed,
  }
}

/** D-06: por hora de inicio y, a igual hora, por sede. */
export function compareBlocks(
  a: ClientCalendarBlock,
  b: ClientCalendarBlock,
): number {
  return (
    a.start.localeCompare(b.start) ||
    a.siteName.localeCompare(b.siteName, 'es') ||
    a.shiftId.localeCompare(b.shiftId)
  )
}

/** Lunes de la semana de una fecha. */
function mondayOf(isoDate: string): string {
  const weekday = weekdayOfIsoDate(isoDate)
  return addDaysToIsoDate(isoDate, -((weekday + 6) % 7))
}

export function buildClientCalendarMonth(input: {
  year: number
  /** 1 a 12. */
  month: number
  shifts: ShiftListRow[]
  assignments: PersonRow[]
  holidays: Pick<Holiday, 'holidayDate' | 'name' | 'deletedAt'>[]
}): ClientCalendarMonth {
  const { from, to } = monthRange(input.year, input.month)
  const people = groupPeopleByShift(input.assignments)

  const blocksByDate = new Map<string, ClientCalendarBlock[]>()
  let uncoveredCount = 0
  for (const shift of input.shifts) {
    const block = buildClientBlock(shift, people.get(shift.id) ?? [])
    if (block.uncovered) {
      uncoveredCount += 1
    }
    const list = blocksByDate.get(block.date) ?? []
    list.push(block)
    blocksByDate.set(block.date, list)
  }
  for (const list of blocksByDate.values()) {
    list.sort(compareBlocks)
  }

  const holidayNames = new Map<string, string>()
  for (const holiday of input.holidays) {
    if (holiday.deletedAt == null) {
      holidayNames.set(
        holiday.holidayDate,
        holiday.name?.trim() || HOLIDAY_FALLBACK_NAME,
      )
    }
  }

  const weeks: ClientCalendarDay[][] = []
  for (let monday = mondayOf(from); monday <= to;) {
    const week: ClientCalendarDay[] = []
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDaysToIsoDate(monday, offset)
      const inMonth = date >= from && date <= to
      week.push({
        date,
        day: Number(date.slice(8, 10)),
        inMonth,
        holiday: inMonth ? holidayNames.get(date) : undefined,
        blocks: inMonth ? (blocksByDate.get(date) ?? []) : [],
      })
    }
    weeks.push(week)
    monday = addDaysToIsoDate(monday, 7)
  }

  return {
    title: cronogramaTitle(input.year, input.month),
    weeks,
    from,
    to,
    uncoveredCount,
  }
}

/** D-06: los bloques que se dibujan y cuántos quedan escondidos. */
export function visibleBlocks(
  blocks: ClientCalendarBlock[],
  expanded: boolean,
): { shown: ClientCalendarBlock[]; hidden: number } {
  if (expanded || blocks.length <= MAX_VISIBLE_BLOCKS) {
    return { shown: blocks, hidden: 0 }
  }
  return {
    shown: blocks.slice(0, MAX_VISIBLE_BLOCKS),
    hidden: blocks.length - MAX_VISIBLE_BLOCKS,
  }
}

export interface ClientCalendarEmployeeOption {
  employeeId: string
  name: string
}

/** D-03: quienes tienen asignaciones vigentes del cliente en el mes, por apellido. */
export function employeeOptions(
  assignments: Pick<
    AssignmentBoardRow,
    'employeeId' | 'employeeFirstName' | 'employeeLastName'
  >[],
): ClientCalendarEmployeeOption[] {
  const byId = new Map<string, ClientCalendarEmployeeOption>()
  for (const row of assignments) {
    if (!byId.has(row.employeeId)) {
      byId.set(row.employeeId, {
        employeeId: row.employeeId,
        name: `${row.employeeLastName}, ${row.employeeFirstName}`,
      })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Texto de los filtros aplicados, para el encabezado de la hoja impresa (D-14). */
export function describeFilters(input: {
  siteName?: string | null
  employeeName?: string | null
}): string {
  return [
    `Sede: ${input.siteName ?? 'todas las sedes'}`,
    `Empleado: ${input.employeeName ?? 'todos los empleados'}`,
  ].join(' · ')
}

/** Texto de «N turnos sin cubrir este mes». */
export function uncoveredLabel(count: number): string {
  return count === 1
    ? '1 turno sin cubrir este mes'
    : `${count} turnos sin cubrir este mes`
}
