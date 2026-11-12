import { describe, expect, it } from 'vitest'
import {
  isShiftUncovered,
  pickNextShifts,
  type CoverageShift,
} from './serviceCoverage'

function row(over: Record<string, unknown>) {
  return {
    id: 's1',
    service_id: 'sv1',
    shift_date: '2026-11-13',
    start_time: '08:00:00',
    end_time: '12:00:00',
    open_ended: false,
    display_status: 'scheduled',
    required_staff: 2,
    assigned_count: 1,
    ...over,
  } as Parameters<typeof pickNextShifts>[0][number]
}

describe('pickNextShifts (OF-04)', () => {
  it('elige el primer turno no cancelado de cada servicio', () => {
    const next = pickNextShifts([
      row({ id: 'a', display_status: 'cancelled' }),
      row({ id: 'b', shift_date: '2026-11-14' }),
      row({ id: 'c', shift_date: '2026-11-15' }),
      row({ id: 'd', service_id: 'sv2' }),
    ])
    expect(next.get('sv1')?.id).toBe('b')
    expect(next.get('sv2')?.id).toBe('d')
  })
})

describe('isShiftUncovered (OF-04)', () => {
  const shift: CoverageShift = {
    id: 's1',
    shiftDate: '2026-11-13',
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'scheduled',
    requiredStaff: 2,
    assignedCount: 1,
    assignments: [],
  }
  it('marca sin cubrir si falta dotación', () => {
    expect(isShiftUncovered(shift)).toBe(true)
    expect(isShiftUncovered({ ...shift, assignedCount: 2 })).toBe(false)
    expect(
      isShiftUncovered({ ...shift, assignedCount: 2, status: 'uncovered' }),
    ).toBe(true)
  })
})
