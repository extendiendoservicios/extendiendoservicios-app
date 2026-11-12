import type { AssignmentBoardRow } from '@/api/assignments'
import type { ShiftListRow } from '@/api/shifts'
import { addDaysToIsoDate } from '@/features/settings/dateOnly'

/**
 * OF-10 (P28.6): lógica sin React de la vista semana editable del cronograma.
 * Calcula el horario según la posición del puntero, decide si un cambio es del
 * turno entero o de una sola persona, arma lo que hace falta para «Deshacer» y
 * filtra los turnos sin cubrir.
 */

/** Los horarios se ajustan a múltiplos de 15 minutos. */
export const SNAP_MINUTES = 15
export const DAY_MINUTES = 24 * 60
/** Duración mínima de un bloque al estirar los bordes. */
export const MIN_BLOCK_MINUTES = SNAP_MINUTES
/** Un turno «A terminar» se dibuja con esta duración. */
export const OPEN_ENDED_DRAW_MINUTES = 60

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes ?? 0)
}

/** `485` → `08:05`. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)))
  const hours = Math.floor(clamped / 60)
  const rest = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Minutos que equivalen a un desplazamiento vertical de `deltaPx` píxeles. */
export function pxToMinutes(deltaPx: number, pxPerHour: number): number {
  return (deltaPx / pxPerHour) * 60
}

export interface BlockTimes {
  startMin: number
  endMin: number
}

export interface BlockPosition extends BlockTimes {
  /** Corrimiento en días respecto del día de origen. */
  dayOffset: number
}

/** Mueve el bloque conservando su duración; no se sale del día. */
export function moveBlock(
  block: BlockTimes,
  deltaMinutes: number,
  dayOffset: number,
): BlockPosition {
  const duration = block.endMin - block.startMin
  const start = clamp(
    snapMinutes(block.startMin + deltaMinutes),
    0,
    Math.max(0, DAY_MINUTES - duration),
  )
  return { dayOffset, startMin: start, endMin: start + duration }
}

/** Estira un borde; el bloque nunca baja de 15 minutos ni se sale del día. */
export function resizeBlock(
  block: BlockTimes,
  edge: 'start' | 'end',
  deltaMinutes: number,
): BlockTimes {
  if (edge === 'start') {
    const start = clamp(
      snapMinutes(block.startMin + deltaMinutes),
      0,
      block.endMin - MIN_BLOCK_MINUTES,
    )
    return { startMin: start, endMin: block.endMin }
  }
  const end = clamp(
    snapMinutes(block.endMin + deltaMinutes),
    block.startMin + MIN_BLOCK_MINUTES,
    DAY_MINUTES,
  )
  return { startMin: block.startMin, endMin: end }
}

/** Texto del horario durante el arrastre: `08:30–12:30`. */
export function previewLabel(times: BlockTimes, openEnded = false): string {
  const start = minutesToTime(times.startMin)
  return openEnded ? start : `${start}–${minutesToTime(times.endMin)}`
}

// ---------------------------------------------------------------------------
// Bloques de la semana
// ---------------------------------------------------------------------------

export interface WeekBlock {
  assignmentId: string
  shiftId: string
  date: string
  siteId: string
  siteName: string
  clientName: string
  colorIndex: number | null
  startMin: number
  endMin: number
  openEnded: boolean
  /** Personas asignadas al turno (de `v_shifts_board.assigned_count`). */
  assignedCount: number
  /** Franja del turno completo, para saber si el horario es propio. */
  shiftStartMin: number
  shiftEndMin: number
}

/** Arma los bloques de la semana; descarta los turnos cancelados. */
export function buildWeekBlocks(
  assignments: AssignmentBoardRow[],
  shifts: Pick<
    ShiftListRow,
    'id' | 'assignedCount' | 'startTime' | 'endTime'
  >[],
): WeekBlock[] {
  const byShift = new Map(shifts.map((shift) => [shift.id, shift]))
  return assignments
    .filter((row) => row.shiftStatus !== 'cancelled')
    .map((row) => {
      const shift = byShift.get(row.shiftId)
      const startMin = timeToMinutes(row.startTime)
      const endMin = row.openEnded
        ? Math.min(DAY_MINUTES, startMin + OPEN_ENDED_DRAW_MINUTES)
        : timeToMinutes(row.endTime)
      return {
        assignmentId: row.id,
        shiftId: row.shiftId,
        date: row.shiftDate,
        siteId: row.siteId,
        siteName: row.siteName,
        clientName: row.clientName,
        colorIndex: row.clientCalendarColor,
        startMin,
        endMin: Math.max(endMin, startMin + MIN_BLOCK_MINUTES),
        openEnded: row.openEnded,
        assignedCount: shift?.assignedCount ?? 1,
        shiftStartMin: shift ? timeToMinutes(shift.startTime) : startMin,
        shiftEndMin: shift ? timeToMinutes(shift.endTime) : endMin,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
}

/** Rango de horas a dibujar: de 06:00 a 22:00 como mínimo, más si hay turnos fuera. */
export function visibleHourRange(blocks: BlockTimes[]): {
  startHour: number
  endHour: number
} {
  let startHour = 6
  let endHour = 22
  for (const block of blocks) {
    startHour = Math.min(startHour, Math.floor(block.startMin / 60))
    endHour = Math.max(endHour, Math.ceil(block.endMin / 60))
  }
  return { startHour, endHour: Math.min(24, endHour) }
}

// ---------------------------------------------------------------------------
// Turno entero o solo esta persona
// ---------------------------------------------------------------------------

/**
 * Si la persona es la única asignada se mueve el turno entero sin preguntar;
 * con más personas hay que preguntar (OF-10).
 */
export function decideScope(assignedCount: number): 'whole' | 'ask' {
  return assignedCount <= 1 ? 'whole' : 'ask'
}

/**
 * `true` si la persona tiene una franja propia distinta de la del turno (el
 * bloque dibuja la franja propia). Un turno «A terminar» no tiene franja propia
 * a efectos del cronograma: su fin dibujado es solo una convención.
 */
export function hasOwnTime(
  block: Pick<
    WeekBlock,
    'startMin' | 'endMin' | 'shiftStartMin' | 'shiftEndMin' | 'openEnded'
  >,
): boolean {
  return (
    !block.openEnded &&
    (block.startMin !== block.shiftStartMin ||
      block.endMin !== block.shiftEndMin)
  )
}

export interface WholeShiftChange {
  startMin: number
  endMin: number
  /** Franja propia de la persona después del cambio; `null` si no tiene. */
  ownTime: BlockTimes | null
}

/**
 * DEF-P28-02: horario del TURNO ENTERO para un cambio hecho sobre un bloque.
 * El bloque puede dibujar la franja propia de la persona, que no es la del
 * turno; por eso no se copia el horario del bloque al turno: se calcula cuánto
 * se movió cada borde (`next` contra el bloque) y se aplica ese mismo corrimiento
 * al horario del turno, con los límites del día y los 15 minutos mínimos.
 *
 * La franja propia de la persona acompaña el mismo corrimiento (efectivo, ya
 * con los límites): así sigue dentro del turno y se ve igual que lo que la
 * persona arrastró. Si no tiene franja propia, `ownTime` es `null`.
 */
export function wholeShiftChange(
  block: WeekBlock,
  next: Pick<ScheduleChange, 'startMin' | 'endMin'>,
): WholeShiftChange {
  const deltaStart = next.startMin - block.startMin
  const deltaEnd = block.openEnded ? 0 : next.endMin - block.endMin
  let appliedStart: number
  let appliedEnd: number
  if (block.openEnded) {
    appliedStart = clamp(
      deltaStart,
      -block.shiftStartMin,
      DAY_MINUTES - MIN_BLOCK_MINUTES - block.shiftStartMin,
    )
    appliedEnd = 0
  } else if (deltaStart === deltaEnd) {
    // Mover: el turno entero se corre lo mismo, sin salirse del día.
    const delta = clamp(
      deltaStart,
      -block.shiftStartMin,
      DAY_MINUTES - block.shiftEndMin,
    )
    appliedStart = delta
    appliedEnd = delta
  } else {
    // Estirar un borde: el turno no baja de 15 minutos ni se sale del día.
    appliedStart =
      deltaStart === 0
        ? 0
        : clamp(
            deltaStart,
            -block.shiftStartMin,
            block.shiftEndMin - MIN_BLOCK_MINUTES - block.shiftStartMin,
          )
    appliedEnd =
      deltaEnd === 0
        ? 0
        : clamp(
            deltaEnd,
            block.shiftStartMin + MIN_BLOCK_MINUTES - block.shiftEndMin,
            DAY_MINUTES - block.shiftEndMin,
          )
  }
  return {
    startMin: block.shiftStartMin + appliedStart,
    endMin: block.shiftEndMin + appliedEnd,
    ownTime: hasOwnTime(block)
      ? {
          startMin: block.startMin + appliedStart,
          endMin: block.endMin + appliedEnd,
        }
      : null,
  }
}

export interface ScheduleChange {
  date: string
  startMin: number
  endMin: number
}

export function hasScheduleChanged(
  block: Pick<WeekBlock, 'date' | 'startMin' | 'endMin'>,
  next: ScheduleChange,
): boolean {
  return (
    block.date !== next.date ||
    block.startMin !== next.startMin ||
    block.endMin !== next.endMin
  )
}

/** Fecha destino a partir de la fecha de origen y el corrimiento en días. */
export function shiftDate(date: string, dayOffset: number): string {
  return dayOffset === 0 ? date : addDaysToIsoDate(date, dayOffset)
}

/**
 * Turnos de la misma sede, en la fecha de destino, a los que se puede pasar a
 * una sola persona (excluye el turno de origen y los cancelados o finalizados).
 */
export function targetShiftCandidates(
  shifts: ShiftListRow[],
  siteId: string,
  date: string,
  sourceShiftId: string,
): ShiftListRow[] {
  return shifts
    .filter(
      (shift) =>
        shift.siteId === siteId &&
        shift.shiftDate === date &&
        shift.id !== sourceShiftId &&
        shift.status !== 'cancelled' &&
        shift.status !== 'completed',
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

/** Fecha (`YYYY-MM-DD`) y minutos desde la medianoche en Buenos Aires. */
function buenosAiresNow(now: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

/**
 * El turno todavía no terminó a la hora `now` (hora de Buenos Aires): es de
 * una fecha futura, o es de hoy y su hora de fin no pasó. Un turno sin hora
 * de fin (`openEnded`) de hoy cuenta como no terminado; uno que cruza la
 * medianoche termina al día siguiente.
 */
export function shiftNotEndedYet(shift: ShiftListRow, now: Date): boolean {
  const { date, minutes } = buenosAiresNow(now)
  if (shift.shiftDate > date) return true
  if (shift.shiftDate < date) {
    // Cruza la medianoche: terminó hoy a la hora de fin, no antes.
    if (shift.openEnded || shift.endTime >= shift.startTime) return false
    return (
      addDaysToIsoDate(shift.shiftDate, 1) === date &&
      toMinutes(shift.endTime) > minutes
    )
  }
  if (shift.openEnded) return true
  if (shift.endTime <= shift.startTime) return true
  return toMinutes(shift.endTime) > minutes
}

function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

/**
 * Turnos sin cubrir de la semana: faltan asignados respecto de la dotación,
 * no están cancelados ni finalizados, la persona no está ya en ellos y,
 * si se pasa `now`, todavía no terminaron (los ya pasados no se muestran).
 */
export function uncoveredShifts(
  shifts: ShiftListRow[],
  assignedShiftIds: ReadonlySet<string>,
  now?: Date,
): ShiftListRow[] {
  return shifts
    .filter(
      (shift) =>
        (!now || shiftNotEndedYet(shift, now)) &&
        shift.status !== 'cancelled' &&
        shift.status !== 'completed' &&
        shift.assignedCount < shift.requiredStaff &&
        !assignedShiftIds.has(shift.id),
    )
    .sort(
      (a, b) =>
        a.shiftDate.localeCompare(b.shiftDate) ||
        a.startTime.localeCompare(b.startTime),
    )
}

/** Quita tildes y pasa a minúsculas para comparar textos. */
function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/**
 * Filtro simple del panel «Turnos sin cubrir»: por texto (sede o cliente, sin
 * distinguir tildes ni mayúsculas) y por día de la semana (fecha `YYYY-MM-DD`;
 * `null` o vacío = todos). Conserva el orden.
 */
export function filterUncoveredShifts(
  shifts: ShiftListRow[],
  filter: { text: string; date: string | null },
): ShiftListRow[] {
  const text = normalizeText(filter.text)
  return shifts.filter(
    (shift) =>
      (!filter.date || shift.shiftDate === filter.date) &&
      (!text ||
        normalizeText(`${shift.siteName} ${shift.clientName}`).includes(text)),
  )
}

// ---------------------------------------------------------------------------
// Deshacer
// ---------------------------------------------------------------------------

/** Franja propia de una asignación que acompaña a un cambio de horario del turno. */
export interface OwnTimeChange {
  assignmentId: string
  start: string
  end: string
}

export type UndoAction =
  | {
      kind: 'shift_time'
      shiftId: string
      date: string
      start: string
      end: string
      openEnded: boolean
      /** Franja propia de la persona que se acomoda junto con el turno. */
      ownTime?: OwnTimeChange
    }
  | {
      kind: 'assignment_time'
      assignmentId: string
      start: string
      end: string
    }
  | {
      kind: 'move'
      /** Asignación nueva (la que devolvió `move_assignment`). */
      assignmentId: string
      targetShiftId: string
      start: string | null
      end: string | null
    }
  | { kind: 'unassign'; assignmentId: string; reason?: string }

/** `previous` de `move_assignment` (claves tal cual las manda el servidor). */
export interface MovePrevious {
  assignment_id: string
  shift_id: string
  start_time: string | null
  end_time: string | null
}

export function undoForShiftTime(block: WeekBlock): UndoAction {
  const ownTime = hasOwnTime(block)
    ? {
        assignmentId: block.assignmentId,
        start: minutesToTime(block.startMin),
        end: minutesToTime(block.endMin),
      }
    : undefined
  return {
    kind: 'shift_time',
    shiftId: block.shiftId,
    date: block.date,
    start: minutesToTime(block.shiftStartMin),
    end: minutesToTime(block.shiftEndMin),
    openEnded: block.openEnded,
    ...(ownTime ? { ownTime } : {}),
  }
}

export function undoForAssignmentTime(block: WeekBlock): UndoAction {
  return {
    kind: 'assignment_time',
    assignmentId: block.assignmentId,
    start: minutesToTime(block.startMin),
    end: minutesToTime(block.endMin),
  }
}

export function undoForMove(
  newAssignmentId: string,
  previous: MovePrevious,
): UndoAction {
  return {
    kind: 'move',
    assignmentId: newAssignmentId,
    targetShiftId: previous.shift_id,
    start: previous.start_time ? previous.start_time.slice(0, 5) : null,
    end: previous.end_time ? previous.end_time.slice(0, 5) : null,
  }
}

export function undoForAssign(assignmentId: string): UndoAction {
  return { kind: 'unassign', assignmentId }
}
