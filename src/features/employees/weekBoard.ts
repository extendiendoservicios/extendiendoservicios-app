import type { FixedPatternRow, WeekBoardBlock } from '@/api/employeeFixed'

/**
 * Pizarra semanal del empleado (OH-07, P30.4b): lógica sin React. La base usa
 * `weekday` 0 = domingo a 6 = sábado; la pantalla muestra de lunes a domingo.
 */

/** Orden de pantalla (lunes a domingo) como `weekday` de la base. */
export const SCREEN_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const

export const BOARD_WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  0: 'Domingo',
}

/** Tope de bloques que acepta `save_employee_week_board`. */
export const MAX_BOARD_BLOCKS = 60
/** Tope del texto de un bloque. */
export const MAX_LABEL_LENGTH = 80
export const NEW_BLOCK_START = '08:00'
export const NEW_BLOCK_END = '12:00'
export const NEW_BLOCK_LABEL = 'NUEVO'

/** Posición de pantalla (0 = lunes … 6 = domingo) de un `weekday` de la base. */
export function weekdayToScreenIndex(weekday: number): number {
  return (weekday + 6) % 7
}

/** `weekday` de la base (0 = domingo) de una posición de pantalla (0 = lunes). */
export function screenIndexToWeekday(index: number): number {
  return (index + 1) % 7
}

function hhmm(time: string): string {
  return time.slice(0, 5)
}

/** `[1, 3]` → `1.ª y 3.ª`; `[5]` → `última`. */
export function formatBoardWeeks(weeks: number[]): string {
  const labels = [...weeks]
    .sort((a, b) => a - b)
    .map((week) => (week === 5 ? 'última' : `${week}.ª`))
  if (labels.length === 1) {
    return labels[0] as string
  }
  return `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
}

function clampLabel(label: string): string {
  return label.length > MAX_LABEL_LENGTH
    ? label.slice(0, MAX_LABEL_LENGTH)
    : label
}

let idCounter = 0

/** Identificador nuevo para un bloque (texto único de hasta 64 caracteres). */
export function newBlockId(): string {
  idCounter += 1
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `b-${random}-${idCounter}`.slice(0, 64)
}

/**
 * Arma la pizarra desde el patrón fijo: un bloque por servicio y por día de
 * `weekdays`. El nombre es el de la sede en mayúsculas, como en el calendario;
 * si el servicio no se presta todas las semanas del mes se agrega
 * «(1.ª y 3.ª)». Los ids son estables (servicio y día) para poder comparar.
 */
export function blocksFromPattern(rows: FixedPatternRow[]): WeekBoardBlock[] {
  const blocks: WeekBoardBlock[] = []
  for (const row of rows) {
    const suffix =
      row.weeksOfMonth && row.weeksOfMonth.length > 0
        ? ` (${formatBoardWeeks(row.weeksOfMonth)})`
        : ''
    const days = [...new Set(row.weekdays)].sort(
      (a, b) => weekdayToScreenIndex(a) - weekdayToScreenIndex(b),
    )
    for (const weekday of days) {
      blocks.push({
        id: `${row.serviceId}-${weekday}`.slice(0, 64),
        weekday,
        start: hhmm(row.startTime),
        end: row.openEnded ? null : hhmm(row.endTime),
        label: clampLabel(`${row.siteName.toUpperCase()}${suffix}`),
        colorIndex: row.calendarColor,
        serviceId: row.serviceId,
      })
    }
  }
  return blocks.slice(0, MAX_BOARD_BLOCKS)
}

/** Bloques de un día ordenados por hora de inicio (los empates conservan el orden). */
export function blocksOfWeekday(
  blocks: WeekBoardBlock[],
  weekday: number,
): WeekBoardBlock[] {
  return blocks
    .map((block, position) => ({ block, position }))
    .filter(({ block }) => block.weekday === weekday)
    .sort(
      (a, b) =>
        a.block.start.localeCompare(b.block.start) || a.position - b.position,
    )
    .map(({ block }) => block)
}

export function canAddBlock(blocks: WeekBoardBlock[]): boolean {
  return blocks.length < MAX_BOARD_BLOCKS
}

export function addBlock(
  blocks: WeekBoardBlock[],
  weekday: number,
): WeekBoardBlock[] {
  if (!canAddBlock(blocks)) {
    return blocks
  }
  return [
    ...blocks,
    {
      id: newBlockId(),
      weekday,
      start: NEW_BLOCK_START,
      end: NEW_BLOCK_END,
      label: NEW_BLOCK_LABEL,
      colorIndex: null,
      serviceId: null,
    },
  ]
}

export function duplicateBlock(
  blocks: WeekBoardBlock[],
  id: string,
): WeekBoardBlock[] {
  const source = blocks.find((block) => block.id === id)
  if (!source || !canAddBlock(blocks)) {
    return blocks
  }
  return [...blocks, { ...source, id: newBlockId() }]
}

export function removeBlock(
  blocks: WeekBoardBlock[],
  id: string,
): WeekBoardBlock[] {
  return blocks.filter((block) => block.id !== id)
}

export function moveBlock(
  blocks: WeekBoardBlock[],
  id: string,
  weekday: number,
): WeekBoardBlock[] {
  return blocks.map((block) =>
    block.id === id && block.weekday !== weekday
      ? { ...block, weekday }
      : block,
  )
}

export function updateBlock(
  blocks: WeekBoardBlock[],
  id: string,
  patch: Partial<
    Pick<WeekBoardBlock, 'start' | 'end' | 'label' | 'colorIndex'>
  >,
): WeekBoardBlock[] {
  return blocks.map((block) => {
    if (block.id !== id) {
      return block
    }
    const next = { ...block, ...patch }
    return { ...next, label: clampLabel(next.label) }
  })
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidBoardTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

export type TimeEditResult =
  | { ok: true; patch: { start: string } | { end: string | null } }
  | { ok: false; message: string }

/** Valida la hora tipeada en una casilla: el inicio es obligatorio; el fin vacío = sin hora de fin. */
export function editBoardTime(
  edge: 'start' | 'end',
  value: string,
): TimeEditResult {
  const text = value.trim()
  if (edge === 'end' && text === '') {
    return { ok: true, patch: { end: null } }
  }
  if (!isValidBoardTime(text)) {
    return {
      ok: false,
      message: 'La hora tiene que tener el formato HH:MM (por ejemplo 08:30).',
    }
  }
  return { ok: true, patch: edge === 'start' ? { start: text } : { end: text } }
}

export interface ColumnRect {
  weekday: number
  left: number
  right: number
  top: number
  bottom: number
}

/** `weekday` de la columna que contiene el punto, o `null` si está fuera de todas. */
export function weekdayAtPoint(
  rects: ColumnRect[],
  x: number,
  y: number,
): number | null {
  const hit = rects.find(
    (rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  )
  return hit ? hit.weekday : null
}
