import { describe, expect, it } from 'vitest'
import {
  applyDismissals,
  computeAttention,
  isNegativeAttention,
} from './attention'
import { NOW, at, makeAssignment, makeShift } from './fixtures'
import { ALL_DAY_FILTER, filterByFranja, listFranjas } from './servicesToday'

describe('computeAttention (AJ-02, AJ-07)', () => {
  it('"Llegada tarde" es una alerta y va después de las críticas; "En camino" pasada la hora de inicio no aparece', () => {
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

describe('computeAttention · «Fuera de zona» (B-21)', () => {
  it('un fichaje fuera de zona de hoy suma un aviso `outsideGeo`', () => {
    const items = computeAttention(
      [makeShift({ id: 's1' })],
      [
        makeAssignment({
          id: 'a-fuera',
          status: 'present',
          displayStatus: 'present',
          checkInAt: at('08:05'),
          hasOutsideGeo: true,
        }),
        makeAssignment({ id: 'a-ok', hasOutsideGeo: false }),
      ],
      NOW,
    )
    expect(items.map((item) => [item.kind, item.assignment?.id])).toEqual([
      ['outsideGeo', 'a-fuera'],
    ])
  })

  it('sigue avisando aunque el turno ya haya terminado, pero no si fue cancelado', () => {
    const finished = computeAttention(
      [],
      [
        makeAssignment({
          id: 'a1',
          shiftStatus: 'completed',
          hasOutsideGeo: true,
        }),
      ],
      NOW,
    )
    expect(finished.map((item) => item.kind)).toEqual(['outsideGeo'])

    const cancelled = computeAttention(
      [],
      [
        makeAssignment({
          id: 'a2',
          shiftStatus: 'cancelled',
          hasOutsideGeo: true,
        }),
      ],
      NOW,
    )
    expect(cancelled).toEqual([])
  })

  it('es independiente de las demás: una asignación puede tener los dos avisos', () => {
    const items = computeAttention(
      [],
      [
        makeAssignment({
          id: 'a1',
          status: 'present',
          displayStatus: 'present',
          checkInAt: at('08:05'),
          endsAt: at('10:00'),
          hasOutsideGeo: true,
        }),
      ],
      NOW,
    )
    expect(items.map((item) => item.kind)).toEqual(['overdue', 'outsideGeo'])
  })

  it('va después de «Turno sin cubrir» y antes de «Llegada tarde»', () => {
    const items = computeAttention(
      [
        makeShift({
          id: 's2',
          displayStatus: 'uncovered',
          status: 'scheduled',
          assignedCount: 0,
        }),
      ],
      [
        makeAssignment({ id: 'a-late', displayStatus: 'late' }),
        makeAssignment({ id: 'a-fuera', hasOutsideGeo: true }),
      ],
      NOW,
    )
    expect(items.map((item) => item.kind)).toEqual([
      'uncovered',
      'outsideGeo',
      'late',
    ])
  })
})

describe('demoras avisadas (OG-03)', () => {
  const shifts = [makeShift({ id: 's1' })]
  // Inicio 08:00 y aviso de 20 min: hora estimada 08:20.
  const delayed = (overrides = {}) =>
    makeAssignment({
      id: 'a-delay',
      status: 'delay_notified',
      displayStatus: 'no_record',
      lastNoticeKind: 'delay',
      lastNoticeMinutesLate: 20,
      lastNoticeAt: at('07:50'),
      ...overrides,
    })

  it('hasta la hora estimada entra como delayNotified y no como no registró', () => {
    const items = computeAttention(shifts, [delayed()], new Date(at('08:10')))
    expect(items.map((item) => item.kind)).toEqual(['delayNotified'])
    expect(items[0]?.minutesSince).toBe(20)
  })

  it('pasada la hora estimada vuelve a no registró el inicio', () => {
    const items = computeAttention(shifts, [delayed()], new Date(at('08:21')))
    expect(items.map((item) => item.kind)).toEqual(['noRecord'])
  })

  it('con el inicio fichado desaparece', () => {
    const items = computeAttention(
      shifts,
      [
        delayed({
          status: 'present',
          displayStatus: 'present',
          checkInAt: at('08:05'),
        }),
      ],
      new Date(at('08:10')),
    )
    expect(items.map((item) => item.kind)).not.toContain('delayNotified')
  })
})

describe('«En camino» (P32, D-09, D-10)', () => {
  const shifts = [makeShift({ id: 's1' })]
  // Turno de 08:00 a 12:00.
  const onTheWay = (overrides = {}) =>
    makeAssignment({
      id: 'a-way',
      displayStatus: 'on_the_way',
      lastNoticeKind: 'on_the_way',
      lastNoticeAt: at('07:40'),
      ...overrides,
    })

  it('verde sin hora estimada, antes del inicio', () => {
    const items = computeAttention(shifts, [onTheWay()], new Date(at('07:45')))
    expect(items.map((item) => [item.kind, item.tone])).toEqual([
      ['onTheWay', 'ok'],
    ])
  })

  it('verde si la hora estimada es anterior o igual al inicio', () => {
    const early = computeAttention(
      shifts,
      [onTheWay({ lastNoticeEstimatedArrivalAt: at('07:55') })],
      new Date(at('07:45')),
    )
    expect(early[0]?.tone).toBe('ok')
    const exact = computeAttention(
      shifts,
      [onTheWay({ lastNoticeEstimatedArrivalAt: at('08:00') })],
      new Date(at('07:45')),
    )
    expect(exact[0]?.tone).toBe('ok')
  })

  it('amarilla si la hora estimada es posterior al inicio', () => {
    const items = computeAttention(
      shifts,
      [onTheWay({ lastNoticeEstimatedArrivalAt: at('08:05') })],
      new Date(at('07:45')),
    )
    expect(items.map((item) => [item.kind, item.tone])).toEqual([
      ['onTheWay', 'warn'],
    ])
    expect(items[0]?.estimatedArrivalAt).toBe(at('08:05'))
  })

  it('la amarilla sigue pasado el inicio hasta la hora estimada y después desaparece', () => {
    const row = onTheWay({
      status: 'expected',
      displayStatus: 'no_record',
      lastNoticeEstimatedArrivalAt: at('08:05'),
    })
    const during = computeAttention(shifts, [row], new Date(at('08:03')))
    expect(during.map((item) => item.kind)).toEqual(['onTheWay'])
    const after = computeAttention(shifts, [row], new Date(at('08:06')))
    expect(after.map((item) => item.kind)).toEqual(['noRecord'])
  })

  it('pasada la hora de inicio sin fichar, la verde deja de mostrarse y siguen las alertas de siempre', () => {
    const row = onTheWay({ displayStatus: 'no_record' })
    const items = computeAttention(shifts, [row], new Date(at('08:10')))
    expect(items.map((item) => item.kind)).toEqual(['noRecord'])
  })

  it('con el inicio fichado desaparece', () => {
    const items = computeAttention(
      shifts,
      [
        onTheWay({
          status: 'present',
          displayStatus: 'present',
          checkInAt: at('07:58'),
          lastNoticeEstimatedArrivalAt: at('08:05'),
        }),
      ],
      new Date(at('07:59')),
    )
    expect(items.map((item) => item.kind)).not.toContain('onTheWay')
  })

  it('un turno cancelado no lo muestra', () => {
    const items = computeAttention(
      shifts,
      [onTheWay({ shiftStatus: 'cancelled' })],
      new Date(at('07:45')),
    )
    expect(items).toEqual([])
  })

  it('orden: la amarilla junto a las alertas amarillas, la verde al final; la verde no es alerta negativa', () => {
    const items = computeAttention(
      [makeShift({ id: 's1' })],
      [
        onTheWay({ id: 'a-green', employeeId: 'e1' }),
        onTheWay({
          id: 'a-yellow',
          employeeId: 'e2',
          lastNoticeEstimatedArrivalAt: at('08:20'),
        }),
        makeAssignment({
          id: 'a-delay',
          employeeId: 'e3',
          status: 'delay_notified',
          displayStatus: 'no_record',
          lastNoticeKind: 'delay',
          lastNoticeMinutesLate: 30,
        }),
        makeAssignment({
          id: 'a-abs',
          employeeId: 'e4',
          status: 'absence_notified',
        }),
      ],
      new Date(at('07:50')),
    )
    expect(items.map((item) => item.key)).toEqual([
      'absence-a-abs',
      'delayNotified-a-delay',
      'onTheWay-a-yellow',
      'onTheWay-a-green',
    ])
    expect(items.filter(isNegativeAttention)).toHaveLength(3)
  })

  it('se puede cerrar como las demás', () => {
    const items = computeAttention(shifts, [onTheWay()], new Date(at('07:45')))
    const { open, closed } = applyDismissals(items, [
      {
        id: 'd1',
        kind: 'onTheWay',
        shiftId: 's1',
        assignmentId: 'a-way',
        dismissedBy: 'u1',
        dismissedAt: at('07:46'),
      },
    ])
    expect(open).toHaveLength(0)
    expect(closed).toHaveLength(1)
  })
})

describe('applyDismissals (OG-02)', () => {
  const shifts = [makeShift({ id: 's1' })]
  const assignments = [
    makeAssignment({
      id: 'a1',
      status: 'expected',
      displayStatus: 'no_record',
    }),
  ]
  const items = computeAttention(shifts, assignments, NOW)
  const dismissal = (overrides = {}) => ({
    id: 'd1',
    kind: 'noRecord',
    shiftId: 's1',
    assignmentId: 'a1',
    dismissedBy: 'admin1',
    dismissedAt: at('10:00'),
    ...overrides,
  })

  it('sin cierres, todo queda abierto', () => {
    const result = applyDismissals(items, [])
    expect(result.open).toHaveLength(1)
    expect(result.closed).toHaveLength(0)
  })

  it('un cierre de la misma situación lo pasa a cerrados', () => {
    const result = applyDismissals(items, [dismissal()])
    expect(result.open).toHaveLength(0)
    expect(result.closed.map((c) => c.dismissal.id)).toEqual(['d1'])
  })

  it('el cierre de otro tipo de aviso de la misma asignación no lo afecta', () => {
    const result = applyDismissals(items, [
      dismissal({ kind: 'delayNotified' }),
    ])
    expect(result.open).toHaveLength(1)
  })

  it('un cierre sin situación vigente no suma a cerrados', () => {
    const result = applyDismissals(items, [dismissal({ assignmentId: 'otra' })])
    expect(result.closed).toHaveLength(0)
  })

  it('Turno sin cubrir se cierra por turno', () => {
    const uncovered = computeAttention(
      [makeShift({ id: 's9', displayStatus: 'uncovered', assignedCount: 0 })],
      [],
      NOW,
    )
    const result = applyDismissals(uncovered, [
      dismissal({ kind: 'uncovered', shiftId: 's9', assignmentId: null }),
    ])
    expect(result.open).toHaveLength(0)
    expect(result.closed).toHaveLength(1)
  })
})
