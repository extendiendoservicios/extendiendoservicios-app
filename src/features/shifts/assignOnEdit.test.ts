import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/errors'
import { assignEmployeesOnEdit, remainingSlots } from './assignOnEdit'

describe('assignEmployeesOnEdit', () => {
  it('asigna en orden y junta las advertencias', async () => {
    const assign = vi
      .fn()
      .mockResolvedValueOnce({ assignment: {}, warnings: [] })
      .mockResolvedValueOnce({
        assignment: {},
        warnings: ['OUTSIDE_AVAILABILITY'],
      })
    const result = await assignEmployeesOnEdit('s1', ['e1', 'e2'], assign)
    expect(assign).toHaveBeenNthCalledWith(1, {
      shiftId: 's1',
      employeeId: 'e1',
    })
    expect(assign).toHaveBeenNthCalledWith(2, {
      shiftId: 's1',
      employeeId: 'e2',
    })
    expect(result.assigned).toEqual([
      { employeeId: 'e1', warnings: [] },
      { employeeId: 'e2', warnings: ['OUTSIDE_AVAILABILITY'] },
    ])
    expect(result.rejected).toEqual([])
  })

  it('un rechazo no corta a los demás y conserva el mensaje del servidor', async () => {
    const assign = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Está de licencia.', 'ON_LEAVE'))
      .mockResolvedValueOnce({ assignment: {}, warnings: [] })
    const result = await assignEmployeesOnEdit('s1', ['e1', 'e2'], assign)
    expect(result.rejected).toEqual([
      { employeeId: 'e1', message: 'Está de licencia.' },
    ])
    expect(result.assigned).toEqual([{ employeeId: 'e2', warnings: [] }])
  })

  it('con un error que no es de la API usa un mensaje genérico', async () => {
    const assign = vi.fn().mockRejectedValue(new Error('red'))
    const result = await assignEmployeesOnEdit('s1', ['e1'], assign)
    expect(result.rejected[0]?.message).toBe(
      'No pudimos asignar a esta persona.',
    )
  })
})

describe('remainingSlots', () => {
  it('resta los asignados y no baja de cero', () => {
    expect(remainingSlots(3, 1)).toBe(2)
    expect(remainingSlots(1, 2)).toBe(0)
  })
})
