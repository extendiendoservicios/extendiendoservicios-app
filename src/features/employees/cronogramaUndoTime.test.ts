import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import type { ShiftListRow } from '@/api/shifts'
import { applyTimeEdit } from './calendarioMonth'
import { runCronogramaCommand } from './cronogramaCommands'
import {
  buildWeekBlocks,
  minutesToTime,
  wholeShiftChange,
} from './cronogramaWeek'

/** Base falsa: el turno y la franja propia de la asignación (null = hereda el turno). */
const db = vi.hoisted(() => ({
  shift: { start: '', end: '', open: false },
  own: null as { start: string; end: string } | null,
}))

vi.mock('@/api/shifts', () => ({
  updateShiftTime: (
    _id: string,
    start: string,
    end: string | null,
    open: boolean,
  ) => {
    db.shift = { start, end: open ? '23:59' : (end ?? ''), open }
    return Promise.resolve()
  },
}))
vi.mock('@/api/assignments', () => ({
  updateAssignmentTime: (_id: string, start: string, end: string) => {
    db.own = { start, end }
    return Promise.resolve()
  },
}))
vi.mock('@/api/ownerDelete', () => ({ ownerDelete: vi.fn() }))

function rows(open: boolean) {
  const effStart = db.own?.start ?? db.shift.start
  const effEnd = db.own?.end ?? db.shift.end
  const assignment = {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-16',
    shiftStatus: 'assigned',
    siteId: 'si',
    siteName: 'Sede',
    clientName: 'Cliente',
    clientCalendarColor: 0,
    startTime: `${effStart}:00`,
    endTime: `${effEnd}:00`,
    openEnded: open,
  } as unknown as AssignmentBoardRow
  const shift = {
    id: 's1',
    assignedCount: 1,
    startTime: `${db.shift.start}:00`,
    endTime: `${db.shift.end}:00`,
  } as unknown as ShiftListRow
  return buildWeekBlocks([assignment], [shift])[0]!
}

/** Cambia una hora como lo hace el calendario y después aprieta «Deshacer». */
async function changeAndUndo(
  edge: 'start' | 'end',
  value: string,
  open = false,
) {
  const block = rows(open)
  const edit = applyTimeEdit(block, edge, value)
  if (!edit.ok) {
    throw new Error(edit.message)
  }
  const whole = wholeShiftChange(block, edit.next)
  const result = await runCronogramaCommand(
    {
      kind: 'shift_time',
      shiftId: block.shiftId,
      date: edit.next.date,
      start: minutesToTime(whole.startMin),
      end: minutesToTime(whole.endMin),
      openEnded: block.openEnded,
      ...(whole.ownTime
        ? {
            ownTime: {
              assignmentId: block.assignmentId,
              start: minutesToTime(whole.ownTime.startMin),
              end: minutesToTime(whole.ownTime.endMin),
            },
          }
        : {}),
    },
    block,
  )
  const after = structuredClone({ shift: db.shift, own: db.own })
  await runCronogramaCommand(result.undo!)
  return after
}

beforeEach(() => {
  db.shift = { start: '08:00', end: '12:00', open: false }
  db.own = null
})

describe('Deshacer del cambio de hora en el lugar (DEF-P30-04)', () => {
  it('turno sin franja propia: vuelve a 08:00', async () => {
    const after = await changeAndUndo('start', '09:00')
    expect(after.shift.start).toBe('09:00')
    expect(db.shift).toEqual({ start: '08:00', end: '12:00', open: false })
  })

  it('cambiando el fin vuelve al fin anterior', async () => {
    await changeAndUndo('end', '13:00')
    expect(db.shift).toEqual({ start: '08:00', end: '12:00', open: false })
  })

  it('con franja propia dentro del turno: vuelven turno y franja', async () => {
    db.shift = { start: '07:00', end: '13:00', open: false }
    db.own = { start: '08:00', end: '12:00' }
    await changeAndUndo('start', '09:00')
    expect(db.shift).toEqual({ start: '07:00', end: '13:00', open: false })
    expect(db.own).toEqual({ start: '08:00', end: '12:00' })
  })

  it('turno «A terminar»: vuelve a 08:00 y sigue a terminar', async () => {
    db.shift = { start: '08:00', end: '23:59', open: true }
    await changeAndUndo('start', '09:00', true)
    expect(db.shift).toEqual({ start: '08:00', end: '23:59', open: true })
  })
})
