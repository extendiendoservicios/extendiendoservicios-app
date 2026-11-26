import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronogramaCommand } from './cronogramaCommands'
import type { WeekBlock } from './cronogramaWeek'

const { calls, updateShiftTime, updateAssignmentTime } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    updateShiftTime: vi.fn((_id: string, start: string, end: string | null) => {
      calls.push(`turno ${start}-${end}`)
      return Promise.resolve()
    }),
    updateAssignmentTime: vi.fn((id: string, start: string, end: string) => {
      calls.push(`franja ${id} ${start}-${end}`)
      return Promise.resolve()
    }),
  }
})

vi.mock('@/api/shifts', () => ({ updateShiftTime }))
vi.mock('@/api/assignments', () => ({ updateAssignmentTime }))
vi.mock('@/api/ownerDelete', () => ({ ownerDelete: vi.fn() }))

const { runCronogramaCommand } = await import('./cronogramaCommands')

const BLOCK: WeekBlock = {
  assignmentId: '',
  shiftId: 's1',
  date: '2026-11-10',
  siteId: 'site1',
  siteName: 'Sede',
  clientId: 'c1',
  clientName: 'Cliente',
  colorIndex: null,
  shiftStatus: 'scheduled',
  startMin: 8 * 60,
  endMin: 12 * 60,
  openEnded: false,
  assignedCount: 2,
  shiftStartMin: 8 * 60,
  shiftEndMin: 12 * 60,
}

const COMMAND: Extract<CronogramaCommand, { kind: 'shift_time' }> = {
  kind: 'shift_time',
  shiftId: 's1',
  date: '2026-11-10',
  start: '07:00',
  end: '12:00',
  openEnded: false,
  ownTimes: [
    { assignmentId: 'a1', start: '08:00', end: '11:00' },
    { assignmentId: 'a2', start: '07:30', end: '10:00' },
  ],
  undoOwnTimes: [
    { assignmentId: 'a1', start: '09:00', end: '11:00' },
    { assignmentId: 'a2', start: '08:30', end: '10:00' },
  ],
}

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
})

describe('shift_time con franjas propias de varias personas (D-16)', () => {
  it('cambia primero el turno y después cada franja, en orden', async () => {
    await runCronogramaCommand(COMMAND, BLOCK)
    expect(calls).toEqual([
      'turno 07:00-12:00',
      'franja a1 08:00-11:00',
      'franja a2 07:30-10:00',
    ])
  })

  it('el deshacer vuelve el turno y todas las franjas a como estaban', async () => {
    const result = await runCronogramaCommand(COMMAND, BLOCK)
    expect(result.undo).toMatchObject({
      kind: 'shift_time',
      start: '08:00',
      end: '12:00',
      ownTimes: COMMAND.undoOwnTimes,
    })
    calls.length = 0
    await runCronogramaCommand(result.undo!)
    expect(calls).toEqual([
      'turno 08:00-12:00',
      'franja a1 09:00-11:00',
      'franja a2 08:30-10:00',
    ])
  })

  it('si una franja falla, avisa con el mensaje del servidor y deja aplicado lo demás', async () => {
    updateAssignmentTime.mockRejectedValueOnce(
      new Error('La franja se superpone con otro turno de la persona.'),
    )
    const result = await runCronogramaCommand(COMMAND, BLOCK)
    expect(result.ownTimeErrors).toEqual([
      'La franja se superpone con otro turno de la persona.',
    ])
    expect(calls).toContain('franja a2 07:30-10:00')
    // El deshacer solo toca la franja que sí se guardó.
    expect(result.undo).toMatchObject({
      ownTimes: [{ assignmentId: 'a2', start: '08:30', end: '10:00' }],
    })
  })

  it('sin ownTimes se comporta como antes', async () => {
    const { ownTimes: _o, undoOwnTimes: _u, ...plain } = COMMAND
    const result = await runCronogramaCommand(plain, BLOCK)
    expect(calls).toEqual(['turno 07:00-12:00'])
    expect(result.ownTimeErrors).toBeUndefined()
  })
})
