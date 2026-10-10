import { describe, expect, it } from 'vitest'
import { availableNoticeKinds, isNotifiable } from './notifyCandidates'
import type { MyDayAssignment } from '@/api/myDay'

function baseAssignment(
  overrides: Partial<MyDayAssignment> = {},
): MyDayAssignment {
  return {
    assignmentId: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-09-26',
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
    startsAt: null,
    endsAt: null,
    openEnded: false,
    noCheckout: false,
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

describe('isNotifiable', () => {
  it('no se puede avisar un turno cancelado (CB-03)', () => {
    expect(isNotifiable(baseAssignment({ shiftStatus: 'cancelled' }))).toBe(
      false,
    )
  })

  it('se puede avisar si está esperada, sin inicio registrado', () => {
    expect(isNotifiable(baseAssignment({ status: 'expected' }))).toBe(true)
  })

  it('se puede avisar si ya tiene una demora avisada', () => {
    expect(isNotifiable(baseAssignment({ status: 'delay_notified' }))).toBe(
      true,
    )
  })

  it('no se puede avisar si ya tiene una ausencia avisada', () => {
    expect(isNotifiable(baseAssignment({ status: 'absence_notified' }))).toBe(
      false,
    )
  })

  it('no se puede avisar si ya tiene el inicio registrado', () => {
    expect(
      isNotifiable(
        baseAssignment({
          status: 'present',
          checkInAt: '2026-09-26T11:00:00Z',
        }),
      ),
    ).toBe(false)
  })
})

describe('availableNoticeKinds', () => {
  it('ofrece demora y ausencia si todavía no avisó nada', () => {
    expect(
      availableNoticeKinds(baseAssignment({ status: 'expected' })),
    ).toEqual(['delay', 'absence'])
  })

  it('ofrece solo ausencia si ya avisó una demora', () => {
    expect(
      availableNoticeKinds(baseAssignment({ status: 'delay_notified' })),
    ).toEqual(['absence'])
  })
})
