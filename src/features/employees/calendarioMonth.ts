import {
  timeToMinutes,
  type ScheduleChange,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'

/**
 * OH-05 (P30.4a): lógica sin React del calendario mensual editable del
 * empleado. El mes vive en la dirección (`?mes=2027-01`), un bloque se mueve
 * de día manteniendo su horario y cada hora se edita en el lugar.
 */

/** Rectángulo de la celda de un día, para saber sobre cuál se soltó el bloque. */
export interface DayRect {
  date: string
  left: number
  right: number
  top: number
  bottom: number
}

/** Fecha de la celda que contiene el punto, o `null` si no cae en ninguna. */
export function dateAtPoint(
  rects: DayRect[],
  x: number,
  y: number,
): string | null {
  const hit = rects.find(
    (rect) =>
      x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
  )
  return hit?.date ?? null
}

/** `2027-01` → `{ year: 2027, month: 1 }`; `null` si no es un mes válido. */
export function parseMonthParam(
  value: string | null,
): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '')
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? { year, month } : null
}

export function formatMonthParam(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** El mes de la dirección o, si falta o está roto, el mes de `today`. */
export function resolveMonth(
  value: string | null,
  today: Date,
): { year: number; month: number } {
  return (
    parseMonthParam(value) ?? {
      year: today.getFullYear(),
      month: today.getMonth() + 1,
    }
  )
}

/** Todas las fechas `YYYY-MM-DD` del mes. */
export function monthDates(year: number, month: number): string[] {
  const last = new Date(year, month, 0).getDate()
  return Array.from(
    { length: last },
    (_, i) =>
      `${formatMonthParam(year, month)}-${String(i + 1).padStart(2, '0')}`,
  )
}

/** Mover de día: mismo horario exacto (no se redondea a 15 minutos). */
export function moveToDate(block: WeekBlock, date: string): ScheduleChange {
  return { date, startMin: block.startMin, endMin: block.endMin }
}

export type TimeEdit =
  { ok: true; next: ScheduleChange } | { ok: false; message: string }

/**
 * Cambio de horario al editar en el lugar la hora de inicio o de fin. Un
 * turno «A terminar» no tiene hora de fin: al cambiar el inicio conserva su
 * duración dibujada.
 */
export function applyTimeEdit(
  block: WeekBlock,
  edge: 'start' | 'end',
  value: string,
): TimeEdit {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return { ok: false, message: 'Ingresá una hora válida.' }
  }
  const minutes = timeToMinutes(value)
  if (edge === 'start') {
    const endMin = block.openEnded
      ? minutes + (block.endMin - block.startMin)
      : block.endMin
    if (!block.openEnded && minutes >= endMin) {
      return {
        ok: false,
        message: 'La hora de inicio tiene que ser anterior a la de fin.',
      }
    }
    return { ok: true, next: { date: block.date, startMin: minutes, endMin } }
  }
  if (minutes <= block.startMin) {
    return {
      ok: false,
      message: 'La hora de fin tiene que ser posterior a la de inicio.',
    }
  }
  return {
    ok: true,
    next: { date: block.date, startMin: block.startMin, endMin: minutes },
  }
}
