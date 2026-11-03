import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { EmployeeLeave } from '@/api/employees'
import type { Holiday } from '@/api/settings'
import {
  addDaysToIsoDate,
  weekdayOfIsoDate,
} from '@/features/settings/dateOnly'

/**
 * Cronograma mensual del empleado (OD-01 a OD-03, P27.4): lógica sin React
 * que arma la grilla del modelo en papel de la empresa. Una fila por semana
 * (lunes a domingo); cada día es vacío, feriado, licencia o una pila de turnos.
 */

export const CRONOGRAMA_WEEKDAYS = [
  'LUNES',
  'MARTES',
  'MIÉRCOLES',
  'JUEVES',
  'VIERNES',
  'SÁBADO',
  'DOMINGO',
] as const

/** Texto de la celda de una licencia sin motivo cargado (OD-02). */
export const CRONOGRAMA_LEAVE_FALLBACK = 'LICENCIA'
/** Texto de la celda de un feriado (OD-02). */
export const CRONOGRAMA_HOLIDAY_LABEL = 'FERIADO'

export interface CronogramaShift {
  key: string
  /** `08:00`. */
  start: string
  /** `12:00`, o `A terminar` en un turno abierto. */
  end: string
  /** Nombre de la sede en mayúsculas. */
  site: string
  /** Índice 0–11 del color del cliente (P24.8); `null` si no tiene. */
  colorIndex: number | null
}

export type CronogramaDayKind = 'empty' | 'holiday' | 'leave' | 'shifts'

export interface CronogramaDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** Número del día del mes. */
  day: number
  /** Falso en los días de las semanas parciales que caen en otro mes. */
  inMonth: boolean
  kind: CronogramaDayKind
  /** Texto de la celda entera (licencia o feriado). */
  label?: string
  /** Un feriado que además tiene turnos los muestra, con la marca de feriado. */
  holiday?: boolean
  shifts: CronogramaShift[]
}

export interface CronogramaMonth {
  /** `MES DE NOVIEMBRE 2026`. */
  title: string
  weeks: CronogramaDay[][]
  /** Primer y último día del mes (`YYYY-MM-DD`), para pedir los datos. */
  from: string
  to: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function monthRange(
  year: number,
  month: number,
): { from: string; to: string } {
  const lastDay = new Date(year, month, 0).getDate()
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  }
}

export function cronogramaTitle(year: number, month: number): string {
  const name = format(new Date(year, month - 1, 1), 'MMMM', { locale: es })
  return `MES DE ${name.toUpperCase()} ${year}`
}

function hhmm(time: string): string {
  return time.slice(0, 5)
}

/** Lunes de la semana de una fecha (la semana empieza el lunes). */
function mondayOf(isoDate: string): string {
  const weekday = weekdayOfIsoDate(isoDate)
  return addDaysToIsoDate(isoDate, -((weekday + 6) % 7))
}

export function leaveLabel(leave: Pick<EmployeeLeave, 'reason'>): string {
  const reason = leave.reason?.trim()
  return reason ? reason.toUpperCase() : CRONOGRAMA_LEAVE_FALLBACK
}

/**
 * Arma el mes. Los turnos son los del empleado cargados en el calendario,
 * futuros incluidos; se descartan los de turnos cancelados. Las asignaciones
 * quitadas ya vienen filtradas de la consulta. Una licencia abierta (sin fin)
 * llega hasta el final del mes. Si un día tiene licencia, manda la licencia.
 */
export function buildCronogramaMonth(input: {
  year: number
  /** 1 a 12. */
  month: number
  assignments: AssignmentBoardRow[]
  leaves: EmployeeLeave[]
  holidays: Pick<Holiday, 'holidayDate' | 'deletedAt'>[]
}): CronogramaMonth {
  const { from, to } = monthRange(input.year, input.month)

  const shiftsByDate = new Map<string, CronogramaShift[]>()
  const sorted = input.assignments
    .filter((row) => row.shiftStatus !== 'cancelled')
    .sort(
      (a, b) =>
        a.shiftDate.localeCompare(b.shiftDate) ||
        a.startTime.localeCompare(b.startTime) ||
        a.id.localeCompare(b.id),
    )
  for (const row of sorted) {
    const list = shiftsByDate.get(row.shiftDate) ?? []
    list.push({
      key: row.id,
      start: hhmm(row.startTime),
      end: row.openEnded ? 'A terminar' : hhmm(row.endTime),
      site: row.siteName.toUpperCase(),
      colorIndex: row.clientCalendarColor,
    })
    shiftsByDate.set(row.shiftDate, list)
  }

  const holidayDates = new Set(
    input.holidays
      .filter((holiday) => holiday.deletedAt == null)
      .map((holiday) => holiday.holidayDate),
  )
  const activeLeaves = input.leaves.filter((leave) => leave.deletedAt == null)
  function leaveOn(date: string): EmployeeLeave | undefined {
    return activeLeaves.find(
      (leave) =>
        leave.startsOn <= date &&
        (leave.endsOn == null || leave.endsOn >= date),
    )
  }

  const weeks: CronogramaDay[][] = []
  for (let monday = mondayOf(from); monday <= to;) {
    const week: CronogramaDay[] = []
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDaysToIsoDate(monday, offset)
      const inMonth = date >= from && date <= to
      const day: CronogramaDay = {
        date,
        day: Number(date.slice(8, 10)),
        inMonth,
        kind: 'empty',
        shifts: [],
      }
      if (inMonth) {
        const leave = leaveOn(date)
        const shifts = shiftsByDate.get(date) ?? []
        if (leave) {
          day.kind = 'leave'
          day.label = leaveLabel(leave)
        } else if (shifts.length > 0) {
          day.kind = 'shifts'
          day.shifts = shifts
          day.holiday = holidayDates.has(date)
        } else if (holidayDates.has(date)) {
          day.kind = 'holiday'
          day.label = CRONOGRAMA_HOLIDAY_LABEL
        }
      }
      week.push(day)
    }
    weeks.push(week)
    monday = addDaysToIsoDate(monday, 7)
  }

  return { title: cronogramaTitle(input.year, input.month), weeks, from, to }
}
