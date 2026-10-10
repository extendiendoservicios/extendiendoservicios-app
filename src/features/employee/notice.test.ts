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

describe('getNoticeMessage · Sin salida (AJ2-09)', () => {
  it('avisa que el día terminó y que lo cargue la oficina', () => {
    const notice = getNoticeMessage(
      baseAssignment({ noCheckout: true, status: 'present' }),
    )
    expect(notice?.text).toContain('Sin salida')
    expect(notice?.text).toContain('supervisor o a la oficina')
  })
})

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
      text: 'Avisaste que no vas: enfermedad.',
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
    expect(message).toEqual({
      text: 'La administración registró que no vas: problema de transporte.',
      byAdmin: true,
    })
  })

  it('usa el texto propio cuando el motivo es "Otro"', () => {
    const message = getNoticeMessage(
      baseAssignment({
        status: 'absence_notified',
        lastNoticeKind: 'absence',
        lastNoticeReasonCode: 'other',
        lastNoticeReasonText: 'Tengo que cuidar a mi hijo',
        lastNoticeSource: 'employee_app',
      }),
    )
    expect(message?.text).toBe(
      'Avisaste que no vas: "Tengo que cuidar a mi hijo".',
    )
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

describe('getNoticeMessage · en camino (P19.5c)', () => {
  it('muestra la hora estimada en hora de Argentina', () => {
    const message = getNoticeMessage(
      baseAssignment({
        lastNoticeKind: 'on_the_way',
        lastNoticeEstimatedArrivalAt: '2026-10-07T11:40:00Z',
      }),
    )
    expect(message?.text).toBe('Avisaste que estás en camino · llegás ~08:40')
  })

  it('sin estimación, avisa solo que está en camino', () => {
    const message = getNoticeMessage(
      baseAssignment({ lastNoticeKind: 'on_the_way' }),
    )
    expect(message?.text).toBe('Avisaste que estás en camino.')
  })

  it('deja de mostrarse cuando ya registró el inicio', () => {
    const message = getNoticeMessage(
      baseAssignment({
        lastNoticeKind: 'on_the_way',
        status: 'present',
        checkInAt: '2026-10-07T11:00:00Z',
      }),
    )
    expect(message).toBeNull()
  })

  it('si después avisó una demora, manda la demora', () => {
    const message = getNoticeMessage(
      baseAssignment({
        status: 'delay_notified',
        lastNoticeKind: 'delay',
        lastNoticeMinutesLate: 20,
      }),
    )
    expect(message?.text).toBe('Avisaste una demora de 20 min.')
  })

  describe('vencimiento del «en camino» (P19.5g)', () => {
    const expiresAt = '2026-10-07T11:15:00Z'
    const antes = new Date('2026-10-07T11:10:00Z')
    const despues = new Date('2026-10-07T11:15:00Z')
    const enCamino = {
      lastNoticeKind: 'on_the_way' as const,
      lastNoticeEstimatedArrivalAt: '2026-10-07T11:00:00Z',
      onTheWayExpiresAt: expiresAt,
    }

    it('vigente con estimación: muestra la hora', () => {
      const message = getNoticeMessage(baseAssignment(enCamino), antes)
      expect(message?.text).toMatch(/^Avisaste que estás en camino · llegás ~/)
    })

    it('vigente sin estimación: avisa solo que está en camino', () => {
      const message = getNoticeMessage(
        baseAssignment({ ...enCamino, lastNoticeEstimatedArrivalAt: null }),
        antes,
      )
      expect(message?.text).toBe('Avisaste que estás en camino.')
    })

    it('vencido: no muestra la hora pasada y pide avisar de nuevo', () => {
      const message = getNoticeMessage(baseAssignment(enCamino), despues)
      expect(message?.text).toBe(
        'Tu aviso de llegada venció. Si seguís en camino, avisá de nuevo.',
      )
    })

    it('una demora posterior manda sobre el vencimiento', () => {
      const message = getNoticeMessage(
        baseAssignment({
          status: 'delay_notified',
          lastNoticeKind: 'delay',
          lastNoticeMinutesLate: 25,
          onTheWayExpiresAt: null,
        }),
        despues,
      )
      expect(message?.text).toBe('Avisaste una demora de 25 min.')
    })

    it('tras fichar no se muestra nada, ni vigente ni vencido', () => {
      const fichado = baseAssignment({
        ...enCamino,
        status: 'present',
        checkInAt: '2026-10-07T11:05:00Z',
      })
      expect(getNoticeMessage(fichado, antes)).toBeNull()
      expect(getNoticeMessage(fichado, despues)).toBeNull()
    })
  })
})
