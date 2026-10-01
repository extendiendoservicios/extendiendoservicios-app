import { describe, expect, it } from 'vitest'
import { computeAttention } from './attention'
import { NOW, at, makeAssignment, makeShift } from './fixtures'
import { ALL_DAY_FILTER, filterByFranja, listFranjas } from './servicesToday'

describe('computeAttention', () => {
  it('sin datos no hay nada que atender', () => {
    expect(computeAttention([], [], NOW)).toEqual([])
  })

  it('arma las cuatro categorías, ordenadas por urgencia', () => {
    const shifts = [
      makeShift({ id: 's1' }),
      makeShift({
        id: 's2',
        displayStatus: 'uncovered',
        status: 'scheduled',
        assignedCount: 0,
      }),
      makeShift({
        id: 's3',
        startTime: '07:00:00',
        endTime: '10:00:00',
        status: 'in_progress',
        displayStatus: 'in_progress',
      }),
    ]
    const assignments = [
      makeAssignment({
        id: 'a-absence',
        shiftId: 's1',
        status: 'absence_notified',
        displayStatus: 'absence_notified',
      }),
      makeAssignment({
        id: 'a-norec',
        shiftId: 's1',
        status: 'expected',
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a-overdue',
        shiftId: 's3',
        shiftStatus: 'in_progress',
        status: 'present',
        displayStatus: 'present',
        startsAt: at('07:00'),
        endsAt: at('10:00'),
        checkInAt: at('07:02'),
      }),
      makeAssignment({
        id: 'a-ok',
        shiftId: 's3',
        shiftStatus: 'in_progress',
        status: 'present',
        displayStatus: 'present',
        checkInAt: at('08:00'),
      }),
    ]
    const items = computeAttention(shifts, assignments, NOW)
    expect(items.map((item) => item.kind)).toEqual([
      'noRecord',
      'overdue',
      'absence',
      'uncovered',
    ])
    expect(items[0]?.minutesSince).toBe(180)
    expect(items[1]?.minutesSince).toBe(60)
    expect(items[3]?.shiftId).toBe('s2')
    expect(items[2]?.shift?.id).toBe('s1')
  })

  it('no duplica el turno sin cubrir cuando el hueco es una ausencia avisada', () => {
    const shifts = [makeShift({ id: 's1', displayStatus: 'uncovered' })]
    const assignments = [
      makeAssignment({
        status: 'absence_notified',
        displayStatus: 'absence_notified',
      }),
    ]
    expect(
      computeAttention(shifts, assignments, NOW).map((item) => item.kind),
    ).toEqual(['absence'])
  })

  it('ignora los turnos cancelados y los terminados', () => {
    const assignments = [
      makeAssignment({
        id: 'a1',
        shiftStatus: 'cancelled',
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a2',
        shiftStatus: 'completed',
        status: 'absence_notified',
      }),
    ]
    expect(computeAttention([], assignments, NOW)).toEqual([])
  })

  it('un servicio en curso dentro de su horario no es una alerta', () => {
    const assignments = [
      makeAssignment({
        status: 'present',
        displayStatus: 'present',
        checkInAt: at('08:00'),
        shiftStatus: 'in_progress',
      }),
    ]
    expect(computeAttention([], assignments, NOW)).toEqual([])
  })
})

describe('filtro por franja', () => {
  const rows = [
    makeAssignment({ id: 'a1' }),
    makeAssignment({ id: 'a2', startTime: '14:00:00', endTime: '18:00:00' }),
    makeAssignment({ id: 'a3' }),
  ]

  it('lista las franjas distintas y filtra', () => {
    expect(listFranjas(rows)).toEqual(['08:00–12:00', '14:00–18:00'])
    expect(filterByFranja(rows, '14:00–18:00').map((r) => r.id)).toEqual(['a2'])
    expect(filterByFranja(rows, ALL_DAY_FILTER)).toHaveLength(3)
  })
})
