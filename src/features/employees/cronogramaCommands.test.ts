import { beforeEach, describe, expect, it, vi } from 'vitest'

const { moveToNew, move, del } = vi.hoisted(() => ({
  moveToNew: vi.fn(),
  move: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/api/assignments', () => ({
  moveAssignmentToNewShift: moveToNew,
  moveAssignment: move,
}))
vi.mock('@/api/shifts', () => ({}))
vi.mock('@/api/ownerDelete', () => ({ ownerDelete: del }))

const { runCronogramaCommand } = await import('./cronogramaCommands')

const RESULT = {
  warnings: ['ON_LEAVE'],
  shiftWarnings: ['HOLIDAY'],
  shiftId: 'nuevo',
  assignmentId: 'a2',
  previous: {
    assignment_id: 'a1',
    shift_id: 'viejo',
    shift_date: '2026-11-18',
    employee_id: 'e1',
    start_time: '08:00:00',
    end_time: '12:00:00',
    from_fixed: false,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  moveToNew.mockResolvedValue(RESULT)
  move.mockResolvedValue({})
  del.mockResolvedValue({})
})

describe('cronogramaCommands: pasar a un turno nuevo (OF-23)', () => {
  const command = {
    kind: 'move_new_shift' as const,
    assignmentId: 'a1',
    date: '2026-11-18',
    start: '14:00',
    end: '18:00',
  }

  it('llama a move_assignment_to_new_shift y devuelve las advertencias del turno', async () => {
    const result = await runCronogramaCommand({ ...command, canUndo: true })
    expect(moveToNew).toHaveBeenCalledWith({
      assignmentId: 'a1',
      date: '2026-11-18',
      start: '14:00',
      end: '18:00',
    })
    expect(result.shiftWarnings).toEqual(['HOLIDAY'])
  })

  it('quien puede borrar turnos tiene «Deshacer»: devuelve a la persona y borra el turno creado', async () => {
    const result = await runCronogramaCommand({ ...command, canUndo: true })
    expect(result.undo).toEqual({
      kind: 'move_back_delete_shift',
      assignmentId: 'a2',
      targetShiftId: 'viejo',
      start: '08:00',
      end: '12:00',
      deleteShiftId: 'nuevo',
    })
    await runCronogramaCommand(result.undo!)
    expect(move).toHaveBeenCalledWith({
      assignmentId: 'a2',
      targetShiftId: 'viejo',
      start: '08:00',
      end: '12:00',
    })
    expect(del).toHaveBeenCalledWith({
      kind: 'shift',
      id: 'nuevo',
      confirmName: '',
    })
    expect(move.mock.invocationCallOrder[0]).toBeLessThan(
      del.mock.invocationCallOrder[0] as number,
    )
  })

  it('sin permiso para borrar turnos no hay «Deshacer»', async () => {
    const result = await runCronogramaCommand({ ...command, canUndo: false })
    expect(result.undo).toBeNull()
  })
})
