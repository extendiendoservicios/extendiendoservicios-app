import type { FixedServiceSchedule } from '@/api/services'
import { formatServiceDays } from './weekdays'

/**
 * P31.7: aviso al cargar fijos. Una persona fija de dos servicios que se
 * superponen (mismo día de la semana, horarios que se pisan y vigencias que se
 * cruzan) nunca puede quedar asignada a los dos: el turno que choca queda sin
 * cubrir y aparece la tarjeta punteada «Se superpone con…» en su calendario.
 * El aviso no bloquea el guardado.
 */

export interface ServiceSchedule {
  serviceId?: string
  weekdays: number[]
  weeksOfMonth: number[] | null
  startTime: string
  endTime: string | null
  openEnded: boolean
  validFrom: string | null
  validTo: string | null
}

export type { FixedServiceSchedule }

export interface FixedOverlap {
  employeeId: string
  serviceName: string
  days: string
  range: string
}

const MINUTES_PER_DAY = 24 * 60

function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Franja en minutos; «A terminar» se toma hasta el fin del día. Cruza medianoche si el fin es anterior. */
function timeWindow(schedule: {
  startTime: string
  endTime: string | null
  openEnded: boolean
}): [number, number] | null {
  const start = toMinutes(schedule.startTime)
  if (start == null) return null
  if (schedule.openEnded || !schedule.endTime) {
    return [start, MINUTES_PER_DAY]
  }
  const end = toMinutes(schedule.endTime)
  if (end == null) return null
  return [start, end <= start ? end + MINUTES_PER_DAY : end]
}

function datesCross(a: ServiceSchedule, b: ServiceSchedule): boolean {
  const aFrom = a.validFrom ?? '0000-01-01'
  const aTo = a.validTo ?? '9999-12-31'
  const bFrom = b.validFrom ?? '0000-01-01'
  const bTo = b.validTo ?? '9999-12-31'
  return aFrom <= bTo && bFrom <= aTo
}

function weeksCross(a: number[] | null, b: number[] | null): boolean {
  if (!a || a.length === 0 || !b || b.length === 0) return true
  return a.some((week) => b.includes(week))
}

export function schedulesOverlap(
  a: ServiceSchedule,
  b: ServiceSchedule,
): boolean {
  if (!a.weekdays.some((day) => b.weekdays.includes(day))) return false
  if (!weeksCross(a.weeksOfMonth, b.weeksOfMonth)) return false
  if (!datesCross(a, b)) return false
  const wa = timeWindow(a)
  const wb = timeWindow(b)
  if (!wa || !wb) return false
  return wa[0] < wb[1] && wb[0] < wa[1]
}

function formatRange(schedule: FixedServiceSchedule): string {
  const start = schedule.startTime.slice(0, 5)
  if (schedule.openEnded || !schedule.endTime) {
    return `desde las ${start}`
  }
  return `de ${start} a ${schedule.endTime.slice(0, 5)}`
}

/**
 * Para cada persona elegida, los otros servicios donde ya es fija y que se
 * superponen con el servicio del formulario. Sin horario o días cargados, no
 * hay nada que comparar.
 */
export function findFixedOverlaps(
  current: ServiceSchedule,
  employeeIds: string[],
  others: FixedServiceSchedule[],
): FixedOverlap[] {
  if (current.weekdays.length === 0 || !current.startTime) return []
  const chosen = new Set(employeeIds)
  return others
    .filter(
      (other) =>
        chosen.has(other.employeeId) &&
        other.serviceId !== current.serviceId &&
        schedulesOverlap(current, other),
    )
    .map((other) => ({
      employeeId: other.employeeId,
      serviceName: other.serviceName,
      days: formatServiceDays(other.weekdays, other.weeksOfMonth).toLowerCase(),
      range: formatRange(other),
    }))
}
