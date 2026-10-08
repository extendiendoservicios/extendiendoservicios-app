import { describe, expect, it } from 'vitest'
import type { MyDayAssignment } from '@/api/myDay'
import { ApiError } from '@/api/errors'
import {
  canNotifyOnTheWay,
  hasActiveOnTheWay,
  isInOnTheWayWindow,
  onTheWayAction,
  onTheWayErrorMessage,
  validateEtaMinutes,
} from './onTheWay'

/** Turno de 08:00 a 12:00 (Argentina) = 11:00 a 15:00 UTC del 7 oct 2026. */
function assignment(overrides: Partial<MyDayAssignment> = {}): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-10-07',
    isToday: true,
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteAddress: null,
    siteContactName: null,
    siteContactPhone: null,
    accessInstructions: null,
    buildingHours: null,
    phoneRestricted: false,
    photosNotAllowed: false,
    restrictionsNotes: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    startsAt: '2026-10-07T11:00:00Z',
    endsAt: '2026-10-07T15:00:00Z',
    status: 'expected',
    shiftStatus: 'scheduled',
    notes: null,
    tasksTotal: 0,
    tasksDone: 0,
    changedSinceLastSeen: false,
    checkInAt: null,
    checkOutAt: null,
    siteCity: null,
    siteLatitude: null,
    siteLongitude: null,
    checkInSource: null,
    checkInRecordedBy: null,
    checkOutSource: null,
    checkOutRecordedBy: null,
    lastNoticeKind: null,
    lastNoticeMinutesLate: null,
    lastNoticeReasonCode: null,
    lastNoticeReasonText: null,
    lastNoticeReportedBy: null,
    lastNoticeSource: null,
    lastNoticeAt: null,
    lastNoticeEstimatedArrivalAt: null,
    onTheWayExpiresAt: null,
    ...overrides,
  }
}

const at = (iso: string) => new Date(iso)

describe('isInOnTheWayWindow', () => {
  it('abre exactamente 3 h antes del inicio', () => {
    expect(isInOnTheWayWindow(assignment(), at('2026-10-07T07:59:59Z'))).toBe(
      false,
    )
    expect(isInOnTheWayWindow(assignment(), at('2026-10-07T08:00:00Z'))).toBe(
      true,
    )
  })

  it('sigue abierta pasado el inicio y cierra en el fin', () => {
    expect(isInOnTheWayWindow(assignment(), at('2026-10-07T11:30:00Z'))).toBe(
      true,
    )
    expect(isInOnTheWayWindow(assignment(), at('2026-10-07T14:59:59Z'))).toBe(
      true,
    )
    expect(isInOnTheWayWindow(assignment(), at('2026-10-07T15:00:00Z'))).toBe(
      false,
    )
  })

  it('sin startsAt/endsAt arma la franja con la hora de pared de Argentina', () => {
    const a = assignment({ startsAt: null, endsAt: null })
    expect(isInOnTheWayWindow(a, at('2026-10-07T07:59:00Z'))).toBe(false)
    expect(isInOnTheWayWindow(a, at('2026-10-07T08:01:00Z'))).toBe(true)
  })

  it('respeta la franja propia de la asignación (inicio efectivo)', () => {
    const a = assignment({ startsAt: '2026-10-07T13:00:00Z' })
    expect(isInOnTheWayWindow(a, at('2026-10-07T09:59:00Z'))).toBe(false)
    expect(isInOnTheWayWindow(a, at('2026-10-07T10:00:00Z'))).toBe(true)
  })
})

describe('canNotifyOnTheWay / onTheWayAction', () => {
  const now = at('2026-10-07T10:00:00Z')

  it('ofrece "notify" dentro de la ventana, sin inicio ni ausencia', () => {
    expect(canNotifyOnTheWay(assignment(), now)).toBe(true)
    expect(onTheWayAction(assignment(), now)).toBe('notify')
  })

  it('ofrece "change" si el último aviso es en camino', () => {
    const a = assignment({ lastNoticeKind: 'on_the_way' })
    expect(hasActiveOnTheWay(a)).toBe(true)
    expect(onTheWayAction(a, now)).toBe('change')
  })

  it('vencido ofrece "renew" y deja de estar vigente; vigente sigue en "change"', () => {
    const a = assignment({
      lastNoticeKind: 'on_the_way',
      onTheWayExpiresAt: '2026-10-07T10:15:00Z',
    })
    expect(onTheWayAction(a, at('2026-10-07T10:14:59Z'))).toBe('change')
    expect(onTheWayAction(a, at('2026-10-07T10:15:00Z'))).toBe('renew')
    expect(hasActiveOnTheWay(a, at('2026-10-07T10:15:00Z'))).toBe(false)
  })

  it('con demora avisada sigue ofreciendo "notify" (el último manda)', () => {
    const a = assignment({ status: 'delay_notified', lastNoticeKind: 'delay' })
    expect(hasActiveOnTheWay(a)).toBe(false)
    expect(onTheWayAction(a, now)).toBe('notify')
  })

  it.each([
    ['fuera de la ventana', assignment(), at('2026-10-07T07:00:00Z')],
    [
      'inicio registrado',
      assignment({ checkInAt: '2026-10-07T10:50:00Z', status: 'present' }),
      now,
    ],
    ['ausencia avisada', assignment({ status: 'absence_notified' }), now],
    ['turno cancelado', assignment({ shiftStatus: 'cancelled' }), now],
    ['turno terminado', assignment({ shiftStatus: 'completed' }), now],
    ['servicio finalizado', assignment({ status: 'finished' }), now],
  ])('no ofrece nada: %s', (_label, a, when) => {
    expect(onTheWayAction(a, when)).toBe('none')
  })
})

describe('validateEtaMinutes', () => {
  it('acepta sin estimar y el rango 1 a 240', () => {
    expect(validateEtaMinutes(null)).toBeNull()
    expect(validateEtaMinutes(1)).toBeNull()
    expect(validateEtaMinutes(240)).toBeNull()
  })

  it.each([0, -5, 241, 1.5, Number.NaN])('rechaza %s', (value) => {
    expect(validateEtaMinutes(value)).toMatch(/1 a 240/)
  })
})

describe('onTheWayErrorMessage', () => {
  it.each([
    ['ABSENCE_ALREADY_NOTIFIED', /ya avisaste que no vas/i],
    ['INVALID_ETA', /1 a 240/],
    ['ON_THE_WAY_TOO_EARLY', /3 horas antes/],
    ['ON_THE_WAY_TOO_LATE', /ya terminó/],
    ['ASSIGNMENT_STARTED', /inicio/],
    ['SHIFT_CANCELLED', /cancelado/],
    ['SHIFT_COMPLETED', /terminó/],
  ])('mapea %s a un texto claro', (hint, expected) => {
    expect(
      onTheWayErrorMessage(new ApiError('texto del servidor', hint)),
    ).toMatch(expected)
  })

  it('usa el mensaje del servidor si el código no se conoce', () => {
    expect(onTheWayErrorMessage(new ApiError('Algo pasó.', 'OTRO'))).toBe(
      'Algo pasó.',
    )
  })

  it('un error que no es de la API da un texto genérico', () => {
    expect(onTheWayErrorMessage(new Error('boom'))).toMatch(/Probá de nuevo/)
  })
})
