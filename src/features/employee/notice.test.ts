import { describe, expect, it } from 'vitest'
import { getNoticeMessage } from './notice'
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
    ...overrides,
  }
}

describe('getNoticeMessage', () => {
  it('arma el mensaje de una demora avisada', () => {
    const message = getNoticeMessage(
      baseAssignment({
        status: 'delay_notified',
        lastNoticeKind: 'delay',
        lastNoticeMinutesLate: 15,
        lastNoticeSource: 'employee_app',
      }),
    )
    expect(message).toEqual({
      text: 'Avisaste una demora de 15 min.',
      byAdmin: false,
    })
  })

  it('arma el mensaje de una ausencia avisada, con la etiqueta del motivo', () => {
    const message = getNoticeMessage(
      baseAssignment({
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeReasonCode: 'illness',
        lastNoticeSource: 'employee_app',
      }),
    )
    expect(message).toEqual({
      text: 'Avisaste que no vas: Enfermedad.',
      byAdmin: false,
    })
  })

  it('marca que lo cargó la administración cuando el origen es admin', () => {
    const message = getNoticeMessage(
      baseAssignment({
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeReasonCode: 'transport',
        lastNoticeSource: 'admin',
      }),
    )
    expect(message?.byAdmin).toBe(true)
  })

  it('no muestra nada si la asignación ya no está en el estado del aviso (por ejemplo, ya presente)', () => {
    expect(
      getNoticeMessage(
        baseAssignment({
          status: 'present',
          lastNoticeKind: 'delay',
          lastNoticeMinutesLate: 15,
        }),
      ),
    ).toBeNull()
  })

  it('no muestra nada si nunca hubo un aviso', () => {
    expect(getNoticeMessage(baseAssignment())).toBeNull()
  })
})
