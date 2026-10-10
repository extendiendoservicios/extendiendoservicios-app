import { describe, expect, it } from 'vitest'
import { at, makeAssignment, NOW } from '@/features/dashboard/fixtures'
import { absenceDetail, isAbsence } from './absences'

describe('isAbsence (AJ2-14)', () => {
  it('sin inicio y con la franja terminada es inasistencia', () => {
    expect(isAbsence(makeAssignment({ endsAt: at('10:00') }), NOW)).toBe(true)
  })

  it('sin inicio y con la franja en curso todavía no lo es', () => {
    expect(isAbsence(makeAssignment(), NOW)).toBe(false)
  })

  it('con aviso de ausencia lo es aunque la franja siga en curso', () => {
    expect(isAbsence(makeAssignment({ status: 'absence_notified' }), NOW)).toBe(
      true,
    )
  })

  it('con inicio registrado nunca lo es', () => {
    expect(
      isAbsence(
        makeAssignment({ endsAt: at('10:00'), checkInAt: at('08:05') }),
        NOW,
      ),
    ).toBe(false)
  })

  it('turno cancelado o asignación quitada no cuentan', () => {
    expect(
      isAbsence(
        makeAssignment({ endsAt: at('10:00'), shiftStatus: 'cancelled' }),
        NOW,
      ),
    ).toBe(false)
    expect(
      isAbsence(
        makeAssignment({ endsAt: at('10:00'), removedAt: at('07:00') }),
        NOW,
      ),
    ).toBe(false)
  })

  it('sin endsAt usa la fecha y la hora de fin del turno', () => {
    const row = makeAssignment({ endsAt: null, endTime: '10:00:00' })
    expect(isAbsence(row, NOW)).toBe(true)
    // Franja nocturna: termina al día siguiente, así que a las 11:00 sigue en curso.
    const night = makeAssignment({
      endsAt: null,
      startTime: '22:00:00',
      endTime: '06:00:00',
      shiftDate: '2026-09-30',
    })
    expect(isAbsence(night, NOW)).toBe(false)
  })
})

describe('absenceDetail', () => {
  it('sin aviso: sin fichaje de inicio', () => {
    expect(absenceDetail(makeAssignment())).toBe(
      'Inasistencia: sin fichaje de inicio',
    )
  })

  it('con aviso: el motivo de la lista', () => {
    expect(
      absenceDetail(
        makeAssignment({
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'procedure',
        }),
      ),
    ).toBe('Ausencia avisada: Trámite')
  })

  it('con motivo «otro» muestra el texto libre', () => {
    expect(
      absenceDetail(
        makeAssignment({
          status: 'absence_notified',
          lastNoticeKind: 'absence',
          lastNoticeReasonCode: 'other',
          lastNoticeReasonText: 'Se rompió el auto',
        }),
      ),
    ).toBe('Ausencia avisada: Se rompió el auto')
  })

  it('con aviso pero sin motivo cargado, solo «Ausencia avisada»', () => {
    expect(absenceDetail(makeAssignment({ status: 'absence_notified' }))).toBe(
      'Ausencia avisada',
    )
  })
})
