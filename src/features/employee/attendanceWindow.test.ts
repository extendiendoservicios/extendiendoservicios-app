import { describe, expect, it } from 'vitest'
import { canEditTasks, taskWindowNotice } from './attendanceWindow'

describe('canEditTasks', () => {
  it('solo se puede editar con la asignación en `present`', () => {
    expect(canEditTasks({ status: 'present' })).toBe(true)
    expect(canEditTasks({ status: 'expected' })).toBe(false)
    expect(canEditTasks({ status: 'finished' })).toBe(false)
    expect(canEditTasks({ status: 'absence_notified' })).toBe(false)
  })
})

describe('taskWindowNotice', () => {
  it('avisa que falta fichar el inicio', () => {
    expect(taskWindowNotice({ checkInAt: null, checkOutAt: null })).toMatch(
      /no registraste el inicio/,
    )
  })

  it('avisa que el servicio ya terminó', () => {
    expect(
      taskWindowNotice({
        checkInAt: '2026-09-26T11:00:00Z',
        checkOutAt: '2026-09-26T15:00:00Z',
      }),
    ).toMatch(/ya registraste el fin/i)
  })
})
