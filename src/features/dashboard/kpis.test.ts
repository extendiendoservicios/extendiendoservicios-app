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
      lateArrivals: 0,
      onTheWay: 0,
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
      lateArrivals: 0,
      onTheWay: 0,
    })
  })

  it('AJ-02/AJ-07: "En camino" no es alerta y "Llegada tarde" sí, sin duplicar demoras avisadas ni turnos cancelados', () => {
    const shifts = [makeShift({ id: 's1' })]
    const assignments = [
      makeAssignment({ id: 'a1', displayStatus: 'on_the_way' }),
      makeAssignment({ id: 'a2', displayStatus: 'late' }),
      // Ya cuenta como demora avisada: no suma de nuevo como llegada tarde.
      makeAssignment({
        id: 'a3',
        status: 'delay_notified',
        displayStatus: 'late',
      }),
      makeAssignment({
        id: 'a4',
        shiftId: 's9',
        shiftStatus: 'cancelled',
        displayStatus: 'late',
      }),
    ]
    const kpis = computeKpis(shifts, assignments, NOW)
    expect(kpis.onTheWay).toBe(1)
    expect(kpis.lateArrivals).toBe(1)
    expect(kpis.delayNotices).toBe(1)
    expect(kpis.noRecord).toBe(0)
  })
})

describe('shiftStartInstant (bordes del día)', () => {
  it('00:00 y 23:59 quedan dentro del mismo día de Argentina', () => {
    expect(
      new Date(
        shiftStartInstant('2026-09-30', '00:00:00').getTime(),
      ).toISOString(),
    ).toBe('2026-09-30T03:00:00.000Z')
    expect(
      new Date(
        shiftStartInstant('2026-09-30', '23:59:00').getTime(),
      ).toISOString(),
    ).toBe('2026-10-01T02:59:00.000Z')
  })
})

describe('isShiftUpcoming (borde de las 2 h)', () => {
  const assigned = { status: 'assigned' as const, startTime: '13:00:00' }

  it('cuenta los turnos scheduled y assigned, pero no el que empieza justo ahora', () => {
    expect(
      isShiftUpcoming(
        makeShift({ status: 'scheduled', startTime: '12:00:00' }),
        NOW,
      ),
    ).toBe(true)
    // Empieza exactamente ahora: ya no es "próximo" (el inicio tiene que ser posterior a `now`).
    expect(
      isShiftUpcoming(
        makeShift({ status: 'assigned', startTime: '11:00:00' }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isShiftUpcoming(
        makeShift({ status: 'assigned', startTime: '11:01:00' }),
        NOW,
      ),
    ).toBe(true)
  })

  it('el borde de 2 h es cerrado: 13:00 entra con now = 11:00:00, pero no con un segundo menos', () => {
    expect(isShiftUpcoming(makeShift(assigned), NOW)).toBe(true)
    const oneSecondLater = new Date(NOW.getTime() + 1000)
    expect(isShiftUpcoming(makeShift(assigned), oneSecondLater)).toBe(true)
    // Con `now` un segundo antes, 13:00 está a 2 h y 1 s: fuera de la ventana.
    const oneSecondBefore = new Date(NOW.getTime() - 1000)
    expect(isShiftUpcoming(makeShift(assigned), oneSecondBefore)).toBe(false)
  })

  it('un turno de la noche no entra en la ventana de la mañana', () => {
    expect(
      isShiftUpcoming(
        makeShift({ status: 'assigned', startTime: '22:00:00' }),
        NOW,
      ),
    ).toBe(false)
  })
})

describe('computeKpis (casos de borde)', () => {
  it('los turnos cancelados no cuentan en clientes ni sedes distintos', () => {
    const shifts = [
      makeShift({ id: 's1' }),
      makeShift({
        id: 's2',
        clientId: 'c2',
        siteId: 'site2',
        status: 'cancelled',
        displayStatus: 'cancelled',
      }),
    ]
    const kpis = computeKpis(shifts, [], NOW)
    expect(kpis.shiftsToday).toBe(1)
    expect(kpis.clientsToday).toBe(1)
    expect(kpis.sitesToday).toBe(1)
  })

  it('un turno completado cuenta como turno de hoy, pero no como próximo, presente ni sin registro', () => {
    const shifts = [
      makeShift({
        id: 's1',
        status: 'completed',
        displayStatus: 'completed',
        startTime: '12:00:00',
      }),
    ]
    const assignments = [
      makeAssignment({
        shiftId: 's1',
        shiftStatus: 'completed',
        status: 'finished',
        displayStatus: 'finished',
        checkInAt: at('08:00'),
        checkOutAt: at('11:00'),
      }),
    ]
    const kpis = computeKpis(shifts, assignments, NOW)
    expect(kpis.shiftsToday).toBe(1)
    expect(kpis.upcoming).toBe(0)
    expect(kpis.present).toBe(0)
    expect(kpis.noRecord).toBe(0)
  })

  it('un servicio en curso pasada su hora de fin sigue contando como presente hasta que se registre el fin', () => {
    const shifts = [
      makeShift({
        id: 's1',
        status: 'in_progress',
        displayStatus: 'in_progress',
        startTime: '07:00:00',
        endTime: '10:00:00',
      }),
    ]
    const assignments = [
      makeAssignment({
        shiftId: 's1',
        shiftStatus: 'in_progress',
        status: 'present',
        displayStatus: 'present',
        startsAt: at('07:00'),
        endsAt: at('10:00'),
        checkInAt: at('07:05'),
      }),
    ]
    const kpis = computeKpis(shifts, assignments, NOW)
    expect(kpis.present).toBe(1)
    expect(kpis.upcoming).toBe(0)
  })

  it('las asignaciones de un turno cancelado no suman avisos ni sin registro', () => {
    const assignments = [
      makeAssignment({
        id: 'a1',
        shiftStatus: 'cancelled',
        status: 'absence_notified',
        displayStatus: 'absence_notified',
      }),
      makeAssignment({
        id: 'a2',
        shiftStatus: 'cancelled',
        status: 'delay_notified',
        displayStatus: 'no_record',
      }),
      makeAssignment({
        id: 'a3',
        shiftStatus: 'cancelled',
        status: 'expected',
        displayStatus: 'no_record',
      }),
    ]
    const kpis = computeKpis([], assignments, NOW)
    expect(kpis.noRecord).toBe(0)
    expect(kpis.absenceNotices).toBe(0)
    expect(kpis.delayNotices).toBe(0)
  })

  it('un aviso de demora con la hora de inicio pasada cuenta como demora y como sin registro', () => {
    const assignments = [
      makeAssignment({ status: 'delay_notified', displayStatus: 'no_record' }),
    ]
    const kpis = computeKpis([], assignments, NOW)
    expect(kpis.delayNotices).toBe(1)
    expect(kpis.noRecord).toBe(1)
  })

  it('cuenta los próximos de varios turnos y respeta el borde de 2 h en el cálculo completo', () => {
    const shifts = [
      makeShift({ id: 's1', status: 'scheduled', startTime: '11:30:00' }),
      makeShift({ id: 's2', status: 'assigned', startTime: '13:00:00' }),
      makeShift({ id: 's3', status: 'assigned', startTime: '13:01:00' }),
      makeShift({ id: 's4', status: 'cancelled', startTime: '12:00:00' }),
    ]
    expect(computeKpis(shifts, [], NOW).upcoming).toBe(2)
  })
})
