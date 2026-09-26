import { describe, expect, it } from 'vitest'
import {
  countPendingRequiredTasks,
  isEarlyLeave,
  scheduledEndInstant,
} from './finishSummary'
import type { ShiftTask } from '@/api/tasks'
import type { MyDayAssignment } from '@/api/myDay'

function task(overrides: Partial<ShiftTask>): ShiftTask {
  return {
    id: 't1',
    shiftId: 'sh1',
    position: 0,
    title: 'Barrer',
    description: null,
    isRequired: true,
    status: 'pending',
    notDoneReason: null,
    statusChangedAt: null,
    ...overrides,
  }
}

describe('countPendingRequiredTasks', () => {
  it('cuenta solo las obligatorias que siguen pendientes o en curso', () => {
    const tasks = [
      task({ id: 't1', isRequired: true, status: 'pending' }),
      task({ id: 't2', isRequired: true, status: 'in_progress' }),
      task({ id: 't3', isRequired: true, status: 'done' }),
      task({ id: 't4', isRequired: true, status: 'not_done' }),
      task({ id: 't5', isRequired: false, status: 'pending' }),
    ]
    expect(countPendingRequiredTasks(tasks)).toBe(2)
  })

  it('da 0 sin tareas', () => {
    expect(countPendingRequiredTasks([])).toBe(0)
  })
})

function assignment(overrides: Partial<MyDayAssignment>) {
  return {
    shiftDate: '2026-09-26',
    endTime: '18:00:00',
    endsAt: null,
    ...overrides,
  } as Pick<MyDayAssignment, 'shiftDate' | 'endTime' | 'endsAt'>
}

describe('scheduledEndInstant', () => {
  it('usa `endsAt` cuando la asignación tiene franja propia', () => {
    const result = scheduledEndInstant(
      assignment({ endsAt: '2026-09-26T17:00:00.000Z' }),
    )
    expect(result.toISOString()).toBe('2026-09-26T17:00:00.000Z')
  })

  it('combina la fecha y la hora efectiva con el offset fijo de Argentina', () => {
    const result = scheduledEndInstant(assignment({}))
    // 18:00 de Argentina (-03:00) = 21:00 UTC.
    expect(result.toISOString()).toBe('2026-09-26T21:00:00.000Z')
  })
})

describe('isEarlyLeave', () => {
  it('es salida anticipada si todavía no llegó la hora prevista de fin', () => {
    const before = new Date('2026-09-26T20:00:00.000Z')
    expect(isEarlyLeave(before, assignment({}))).toBe(true)
  })

  it('no es salida anticipada en la hora de fin o después', () => {
    const atEnd = new Date('2026-09-26T21:00:00.000Z')
    const after = new Date('2026-09-26T22:00:00.000Z')
    expect(isEarlyLeave(atEnd, assignment({}))).toBe(false)
    expect(isEarlyLeave(after, assignment({}))).toBe(false)
  })
})
