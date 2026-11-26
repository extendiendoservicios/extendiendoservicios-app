import type { ClientCalendarBlock } from '@/features/clients/clientCalendar'
import { applyTimeEdit, moveToDate } from '@/features/employees/calendarioMonth'
import type { CronogramaCommand } from '@/features/employees/cronogramaCommands'
import {
  COMPLETED_DATE_MESSAGE,
  DAY_MINUTES,
  MIN_BLOCK_MINUTES,
  OPEN_ENDED_DRAW_MINUTES,
  completedDateChangeBlocked,
  hasScheduleChanged,
  minutesToTime,
  timeToMinutes,
  wholeShiftChange,
  type OwnTimeChange,
  type ScheduleChange,
  type WeekBlock,
} from '@/features/employees/cronogramaWeek'

/**
 * P34.2 (D-08, D-09): lógica sin React de la edición del calendario del
 * cliente. Cada bloque es un turno, así que todo cambio de horario o de día
 * es siempre sobre el TURNO ENTERO (`shift_time`), sin preguntar alcance. Se
 * reutilizan las funciones del editor del empleado armando un `WeekBlock` cuyo
 * horario es el del turno; las franjas propias de cada persona acompañan al
 * turno (D-16, `ownTimeShifts`).
 */

/** El bloque del cliente visto como el `WeekBlock` que entienden las reglas del empleado. */
export function toWeekBlock(
  block: ClientCalendarBlock,
  client: { id: string; name: string },
): WeekBlock {
  const startMin = timeToMinutes(block.start)
  const endMin = block.openEnded
    ? startMin + OPEN_ENDED_DRAW_MINUTES
    : timeToMinutes(block.endTime)
  return {
    assignmentId: '',
    shiftId: block.shiftId,
    date: block.date,
    siteId: block.siteId,
    siteName: block.siteName,
    clientId: client.id,
    clientName: client.name,
    colorIndex: block.colorIndex,
    shiftStatus: block.status,
    startMin,
    endMin,
    openEnded: block.openEnded,
    assignedCount: block.people.length,
    shiftStartMin: startMin,
    shiftEndMin: endMin,
  }
}

/**
 * D-16: franjas propias que acompañan al turno. Una persona tiene franja propia
 * si su horario efectivo difiere del del turno (mismo criterio que
 * `hasOwnTime`). Cada franja se corre lo mismo que el turno (`wholeShiftChange`
 * ya devuelve el corrimiento aplicado, con los límites del día), sin salirse
 * del día ni bajar de 15 minutos. Devuelve también cómo estaban, para deshacer.
 */
export function ownTimeShifts(
  block: ClientCalendarBlock,
  whole: { startMin: number; endMin: number },
): { ownTimes: OwnTimeChange[]; undoOwnTimes: OwnTimeChange[] } {
  const ownTimes: OwnTimeChange[] = []
  const undoOwnTimes: OwnTimeChange[] = []
  if (block.openEnded) {
    return { ownTimes, undoOwnTimes }
  }
  const shiftStart = timeToMinutes(block.start)
  const shiftEnd = timeToMinutes(block.endTime)
  const appliedStart = whole.startMin - shiftStart
  const appliedEnd = whole.endMin - shiftEnd
  for (const person of block.people) {
    const start = timeToMinutes(person.startTime)
    const end = timeToMinutes(person.endTime)
    if (start === shiftStart && end === shiftEnd) {
      continue
    }
    const nextStart = Math.min(
      Math.max(start + appliedStart, 0),
      DAY_MINUTES - MIN_BLOCK_MINUTES,
    )
    const nextEnd = Math.min(
      Math.max(end + appliedEnd, nextStart + MIN_BLOCK_MINUTES),
      DAY_MINUTES,
    )
    if (nextStart === start && nextEnd === end) {
      continue
    }
    ownTimes.push({
      assignmentId: person.assignmentId,
      start: minutesToTime(nextStart),
      end: minutesToTime(nextEnd),
    })
    undoOwnTimes.push({
      assignmentId: person.assignmentId,
      start: person.startTime,
      end: person.endTime,
    })
  }
  return { ownTimes, undoOwnTimes }
}

export type ClientChangePlan =
  | { kind: 'noop' }
  | { kind: 'blocked'; message: string }
  | {
      kind: 'apply'
      weekBlock: WeekBlock
      command: Extract<CronogramaCommand, { kind: 'shift_time' }>
    }

/** Decide qué hacer con un cambio ya calculado sobre el turno entero. */
export function planWholeShiftChange(
  weekBlock: WeekBlock,
  next: ScheduleChange,
  block?: ClientCalendarBlock,
): ClientChangePlan {
  if (!hasScheduleChanged(weekBlock, next)) {
    return { kind: 'noop' }
  }
  if (completedDateChangeBlocked(weekBlock, next)) {
    return { kind: 'blocked', message: COMPLETED_DATE_MESSAGE }
  }
  const whole = wholeShiftChange(weekBlock, next)
  const own = block ? ownTimeShifts(block, whole) : null
  return {
    kind: 'apply',
    weekBlock,
    command: {
      kind: 'shift_time',
      shiftId: weekBlock.shiftId,
      date: next.date,
      start: minutesToTime(whole.startMin),
      end: minutesToTime(whole.endMin),
      openEnded: weekBlock.openEnded,
      ...(own && own.ownTimes.length > 0
        ? { ownTimes: own.ownTimes, undoOwnTimes: own.undoOwnTimes }
        : {}),
    },
  }
}

/** D-08: edición en el lugar de la hora de inicio o de fin. */
export function planTimeEdit(
  block: ClientCalendarBlock,
  client: { id: string; name: string },
  edge: 'start' | 'end',
  value: string,
): ClientChangePlan {
  const weekBlock = toWeekBlock(block, client)
  const result = applyTimeEdit(weekBlock, edge, value)
  if (!result.ok) {
    return { kind: 'blocked', message: result.message }
  }
  return planWholeShiftChange(weekBlock, result.next, block)
}

/** D-09: mover el turno entero a otro día con el mismo horario. */
export function planMoveToDate(
  block: ClientCalendarBlock,
  client: { id: string; name: string },
  date: string,
): ClientChangePlan {
  const weekBlock = toWeekBlock(block, client)
  return planWholeShiftChange(weekBlock, moveToDate(weekBlock, date), block)
}

/** D-09: un turno finalizado o cancelado no se arrastra a otro día. */
export function canDragBlock(block: ClientCalendarBlock): boolean {
  return !block.cancelled && !block.completed
}

/**
 * Filtros de la dirección (`sede=`, `empleado=`) que no están en las listas
 * ya cargadas se ignoran para no vaciar el calendario. Mientras la lista no
 * cargó (`undefined`) se respeta lo que viene.
 */
export function validFilter(
  value: string | undefined,
  knownIds: string[] | undefined,
): string | undefined {
  if (!value || !knownIds) {
    return value || undefined
  }
  return knownIds.includes(value) ? value : undefined
}
