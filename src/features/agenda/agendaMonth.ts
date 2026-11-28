import type { AgendaItem } from '@/api/agenda'
import { buildMonthGridDays } from '@/features/planning/planningDates'

/**
 * Armado de la pizarra del mes (AG-04, AG-08, AG-10, AG-20), sin React: la
 * grilla lunes a domingo con los eventos de cada día, las siete columnas de
 * «Nuevos» y las notas. Pura, para probarla sin renderizar nada.
 */

/** Cuántos eventos se ven por celda antes del «+N». */
export const MAX_EVENTS_PER_CELL = 3

/** Cantidad de columnas de «Nuevos» (slot 0 a 6). */
export const NEW_SLOTS = 7

/** Nombre de cada columna de «Nuevos» (AG-29): el slot 0 es Lunes y el 6, Domingo. */
export const NEW_SLOT_NAMES = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const

/** Primer día del mes como `YYYY-MM-01`. */
export function monthStartIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export interface AgendaGridDay {
  date: string
  /** Número de día (1–31), automático. */
  dayNumber: number
  isCurrentMonth: boolean
  isHoliday: boolean
  holidayName: string | null
  events: AgendaItem[]
  /** Los que entran en la celda. */
  shownEvents: AgendaItem[]
  /** Cuántos quedan afuera («+N»). */
  hiddenCount: number
}

export type AgendaGridWeek = AgendaGridDay[]

/** Eventos por fecha, en el orden en que vienen (posición y carga). */
export function groupEventsByDay(
  items: AgendaItem[],
): Map<string, AgendaItem[]> {
  const byDay = new Map<string, AgendaItem[]>()
  for (const item of items) {
    if (item.kind !== 'evento' || !item.day) {
      continue
    }
    const list = byDay.get(item.day)
    if (list) {
      list.push(item)
    } else {
      byDay.set(item.day, [item])
    }
  }
  return byDay
}

/**
 * Semanas del mes (lunes a domingo). Los días de los meses vecinos van
 * atenuados y sin eventos: la pizarra se lee de a un mes.
 *
 * `holidays`: fecha (`YYYY-MM-DD`) a nombre del feriado.
 */
export function buildAgendaGrid(
  year: number,
  month: number,
  items: AgendaItem[],
  holidays: ReadonlyMap<string, string> = new Map(),
  maxPerCell: number = MAX_EVENTS_PER_CELL,
): AgendaGridWeek[] {
  const byDay = groupEventsByDay(items)
  const days = buildMonthGridDays(year, month).map<AgendaGridDay>((day) => {
    const events = day.isCurrentMonth ? (byDay.get(day.date) ?? []) : []
    const holidayName = holidays.get(day.date) ?? null
    return {
      date: day.date,
      dayNumber: Number(day.date.slice(8, 10)),
      isCurrentMonth: day.isCurrentMonth,
      isHoliday: holidayName !== null,
      holidayName,
      events,
      shownEvents: events.slice(0, maxPerCell),
      hiddenCount: Math.max(0, events.length - maxPerCell),
    }
  })
  const weeks: AgendaGridWeek[] = []
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7))
  }
  return weeks
}

/** Los días del mes que tienen eventos, para la lista del celular (AG-20). */
export function daysWithEvents(
  items: AgendaItem[],
): Array<{ date: string; events: AgendaItem[] }> {
  return [...groupEventsByDay(items).entries()]
    .map(([date, events]) => ({ date, events }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** «Nuevos»: las 7 columnas, cada una con sus bloques por orden. */
export function groupNewBySlot(items: AgendaItem[]): AgendaItem[][] {
  const columns: AgendaItem[][] = Array.from({ length: NEW_SLOTS }, () => [])
  for (const item of items) {
    if (item.kind === 'nuevo' && item.slot != null) {
      columns[item.slot]?.push(item)
    }
  }
  return columns
}

/** Notas del mes, por orden. */
export function notesOf(items: AgendaItem[]): AgendaItem[] {
  return items.filter((item) => item.kind === 'nota')
}

/** Resumen de una línea de un evento para el bloquecito de la celda. */
export function eventSummary(item: AgendaItem): string {
  const parts = [
    item.timeText,
    item.workType,
    item.place ?? item.clientPerson,
  ].filter((part): part is string => Boolean(part))
  if (parts.length > 0) {
    return parts.join(' · ')
  }
  return item.people ?? item.observation ?? ''
}

/** Título corto de un bloque de «Nuevos». */
export function newItemTitle(item: AgendaItem): string {
  return (
    item.placeName ??
    item.clientName ??
    item.address ??
    item.daysHours ??
    item.observation ??
    'Sin nombre'
  )
}
