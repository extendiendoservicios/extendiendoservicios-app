import { describe, expect, it } from 'vitest'
import { computeAttention } from './attention'
import { NOW, at, makeAssignment, makeShift } from './fixtures'
import { ALL_DAY_FILTER, filterByFranja, listFranjas } from './servicesToday'

describe('computeAttention (AJ-02, AJ-07)', () => {
  it('"Llegada tarde" es una alerta y va después de las críticas; "En camino" no aparece', () => {
    const shifts = [makeShift({ id: 's1' })]
    const assignments = [
      makeAssignment({ id: 'a-late', displayStatus: 'late' }),
      makeAssignment({ id: 'a-way', displayStatus: 'on_the_way' }),
      makeAssignment({ id: 'a-norec', displayStatus: 'no_record' }),
    ]
    const items = computeAttention(shifts, assignments, NOW)
    expect(items.map((item) => item.kind)).toEqual(['noRecord', 'late'])
    expect(items[1]?.minutesSince).toBe(180)
  })

  it('un turno cancelado no genera alerta de llegada tarde', () => {
    const items = computeAttention(
      [],
      [
        makeAssignment({
          shiftStatus: 'cancelled',
          displayStatus: 'late',
        }),
      ],
      NOW,
    )
    expect(items).toEqual([])
  })
})

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

describe('computeAttention (bordes)', () => {
  const overdueBase = {
    shiftStatus: 'in_progress' as const,
    status: 'present' as const,
    displayStatus: 'present' as const,
    startsAt: at('07:00'),
    checkInAt: at('07:02'),
  }

  it('en curso pasada la hora de fin: justo a la hora de fin todavía no es alerta, un minuto después sí', () => {
    const atTheEnd = makeAssignment({ ...overdueBase, endsAt: at('11:00') })
    expect(computeAttention([], [atTheEnd], NOW)).toEqual([])

    const oneMinutePast = makeAssignment({
      ...overdueBase,
      endsAt: at('10:59'),
    })
    const items = computeAttention([], [oneMinutePast], NOW)
    expect(items.map((item) => item.kind)).toEqual(['overdue'])
    expect(items[0]?.minutesSince).toBe(1)
  })

  it('una asignación terminada (con fin registrado) no es alerta aunque haya pasado su hora de fin', () => {
    const finished = makeAssignment({
      shiftStatus: 'in_progress',
      status: 'finished',
      displayStatus: 'finished',
      endsAt: at('10:00'),
      checkInAt: at('08:00'),
      checkOutAt: at('10:00'),
    })
    expect(computeAttention([], [finished], NOW)).toEqual([])
  })

  it('un turno cancelado no genera "sin cubrir" ni ausencia', () => {
    const shifts = [
      makeShift({
        id: 's1',
        status: 'cancelled',
        displayStatus: 'cancelled',
        assignedCount: 0,
      }),
    ]
    const assignments = [
      makeAssignment({
        shiftId: 's1',
        shiftStatus: 'cancelled',
        status: 'absence_notified',
      }),
    ]
    expect(computeAttention(shifts, assignments, NOW)).toEqual([])
  })

  it('dentro de una misma categoría va primero la que hace más que espera', () => {
    const assignments = [
      makeAssignment({
        id: 'a-reciente',
        startsAt: at('10:30'),
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a-vieja',
        startsAt: at('08:00'),
        displayStatus: 'no_record',
      }),
    ]
    const items = computeAttention([], assignments, NOW)
    expect(items.map((item) => item.assignment?.id)).toEqual([
      'a-vieja',
      'a-reciente',
    ])
    expect(items.map((item) => item.minutesSince)).toEqual([180, 30])
  })

  it('el turno sin cubrir cuenta los minutos desde su hora de inicio', () => {
    const shifts = [
      makeShift({
        id: 's1',
        status: 'scheduled',
        displayStatus: 'uncovered',
        assignedCount: 0,
        startTime: '09:30:00',
      }),
    ]
    const items = computeAttention(shifts, [], NOW)
    expect(items.map((item) => item.kind)).toEqual(['uncovered'])
    expect(items[0]?.minutesSince).toBe(90)
  })
})

describe('computeAttention: «Sin salida» (AJ2-10)', () => {
  it('un turno «A terminar» sin salida aparece como algo a atender, no como fin pasado común', () => {
    const shifts = [makeShift({ id: 's1', openEnded: true })]
    const assignments = [
      makeAssignment({
        id: 'a-open',
        status: 'present',
        displayStatus: 'no_checkout',
        shiftStatus: 'in_progress',
        openEnded: true,
        checkInAt: at('08:05'),
        endsAt: at('10:00'),
      }),
    ]
    const items = computeAttention(shifts, assignments, NOW)
    expect(items.map((item) => item.kind)).toEqual(['noCheckout'])
    expect(items[0]?.minutesSince).toBe(60)
  })

  it('va después de «sin registro» y antes de una ausencia avisada', () => {
    const assignments = [
      makeAssignment({ id: 'a-abs', status: 'absence_notified' }),
      makeAssignment({
        id: 'a-nc',
        status: 'present',
        displayStatus: 'no_checkout',
        checkInAt: at('08:05'),
      }),
      makeAssignment({ id: 'a-nr', displayStatus: 'no_record' }),
    ]
    const items = computeAttention([makeShift()], assignments, NOW)
    expect(items.map((item) => item.kind)).toEqual([
      'noRecord',
      'noCheckout',
      'absence',
    ])
  })

  it('las franjas del tablero dicen «A terminar» en vez de 23:59', () => {
    const rows = [
      makeAssignment({ id: 'a1', endTime: '23:59:00', openEnded: true }),
    ]
    expect(listFranjas(rows)).toEqual(['08:00–A terminar'])
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
