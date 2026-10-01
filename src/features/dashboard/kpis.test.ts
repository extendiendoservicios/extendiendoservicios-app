import { describe, expect, it } from 'vitest'
import { computeKpis, isShiftUpcoming, shiftStartInstant } from './kpis'
import { NOW, at, makeAssignment, makeShift } from './fixtures'

describe('shiftStartInstant', () => {
  it('interpreta la hora del turno en horario de Argentina', () => {
    expect(
      new Date(
        shiftStartInstant('2026-09-30', '13:30:00').getTime(),
      ).toISOString(),
    ).toBe('2026-09-30T16:30:00.000Z')
  })
})

describe('isShiftUpcoming', () => {
  it('cuenta los turnos que empiezan dentro de 2 h, no los de más adelante ni los ya empezados', () => {
    const base = { status: 'assigned' as const }
    expect(
      isShiftUpcoming(makeShift({ ...base, startTime: '12:30:00' }), NOW),
    ).toBe(true)
    expect(
      isShiftUpcoming(makeShift({ ...base, startTime: '13:00:00' }), NOW),
    ).toBe(true)
    expect(
      isShiftUpcoming(makeShift({ ...base, startTime: '13:01:00' }), NOW),
    ).toBe(false)
    expect(
      isShiftUpcoming(makeShift({ ...base, startTime: '10:59:00' }), NOW),
    ).toBe(false)
  })

  it('no cuenta turnos en curso, terminados ni cancelados', () => {
    for (const status of ['in_progress', 'completed', 'cancelled'] as const) {
      expect(
        isShiftUpcoming(makeShift({ status, startTime: '12:00:00' }), NOW),
      ).toBe(false)
    }
  })
})

describe('computeKpis', () => {
  it('sin datos, todo en cero', () => {
    expect(computeKpis([], [], NOW)).toEqual({
      shiftsToday: 0,
      clientsToday: 0,
      sitesToday: 0,
      present: 0,
      upcoming: 0,
      noRecord: 0,
      absenceNotices: 0,
      delayNotices: 0,
    })
  })

  it('calcula cada indicador y deja afuera lo cancelado', () => {
    const shifts = [
      makeShift({ id: 's1' }),
      makeShift({
        id: 's2',
        clientId: 'c2',
        siteId: 'site2',
        startTime: '12:30:00',
        endTime: '16:00:00',
      }),
      makeShift({ id: 's3', status: 'cancelled', displayStatus: 'cancelled' }),
    ]
    const assignments = [
      makeAssignment({
        id: 'a1',
        status: 'present',
        displayStatus: 'present',
        checkInAt: at('08:01'),
      }),
      makeAssignment({
        id: 'a2',
        status: 'expected',
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a3',
        status: 'absence_notified',
        displayStatus: 'absence_notified',
      }),
      makeAssignment({
        id: 'a4',
        status: 'delay_notified',
        displayStatus: 'delay_notified',
      }),
      makeAssignment({
        id: 'a5',
        status: 'delay_notified',
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a6',
        shiftId: 's3',
        shiftStatus: 'cancelled',
        status: 'present',
        displayStatus: 'present',
      }),
    ]
    expect(computeKpis(shifts, assignments, NOW)).toEqual({
      shiftsToday: 2,
      clientsToday: 2,
      sitesToday: 2,
      present: 1,
      upcoming: 1,
      noRecord: 2,
      absenceNotices: 1,
      delayNotices: 2,
    })
  })
})
