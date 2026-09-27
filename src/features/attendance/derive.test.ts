import { describe, expect, it } from 'vitest'
import {
  getAttendanceStatusBadgeInput,
  getAvailableAttendanceActions,
} from './derive'

/**
 * `getAvailableAttendanceActions`/`getAttendanceStatusBadgeInput` (ATT-011,
 * ATT-012, ATT-014): reglas de negocio sin React, replicadas de
 * `0027_rpc_notices_admin_attendance.sql` para decidir qué botones mostrar
 * en ADM-10/ADM-11 y qué `StatusBadge` pintar.
 */

describe('getAvailableAttendanceActions', () => {
  const BASE = {
    shiftStatus: 'in_progress' as const,
    status: 'expected' as const,
    checkInAt: null,
    checkOutAt: null,
    startsAt: '2026-09-26T11:00:00Z',
    now: new Date('2026-09-26T10:00:00Z'),
  }

  it('sin turno cancelado: ofrece inicio, demora y ausencia antes del inicio', () => {
    const actions = getAvailableAttendanceActions(BASE)
    expect(actions).toEqual(
      expect.arrayContaining(['check_in', 'delay', 'absence']),
    )
    expect(actions).not.toContain('check_out')
    expect(actions).not.toContain('close')
  })

  it('turno cancelado: no ofrece ninguna acción', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      shiftStatus: 'cancelled',
    })
    expect(actions).toEqual([])
  })

  it('después de la hora de inicio, sin check-in: ya no ofrece demora, pero sí ausencia (P-073, P14.0)', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      now: new Date('2026-09-26T11:30:00Z'),
    })
    expect(actions).toContain('absence')
    expect(actions).not.toContain('delay')
  })

  it('con inicio registrado, sin fin: ofrece fin y cierre manual, no inicio/demora/ausencia', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      status: 'present',
      checkInAt: '2026-09-26T11:05:00Z',
    })
    expect(actions).toEqual(expect.arrayContaining(['check_out', 'close']))
    expect(actions).not.toContain('check_in')
    expect(actions).not.toContain('delay')
    expect(actions).not.toContain('absence')
  })

  it('con inicio y fin registrados: no ofrece ninguna acción', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      status: 'finished',
      checkInAt: '2026-09-26T11:05:00Z',
      checkOutAt: '2026-09-26T15:00:00Z',
    })
    expect(actions).toEqual([])
  })

  it('ausencia ya avisada: no vuelve a ofrecer demora ni ausencia, pero sí inicio', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      status: 'absence_notified',
    })
    expect(actions).toEqual(['check_in'])
  })

  it('turno finalizado sin inicio: no ofrece nada', () => {
    const actions = getAvailableAttendanceActions({
      ...BASE,
      shiftStatus: 'completed',
    })
    expect(actions).toEqual([])
  })
})

describe('getAttendanceStatusBadgeInput', () => {
  it('no_record cuando display_status lo marca', () => {
    expect(
      getAttendanceStatusBadgeInput({
        status: 'expected',
        displayStatus: 'no_record',
        minutesEarlyLeave: null,
        lastNoticeMinutesLate: null,
      }),
    ).toEqual({ status: 'no_record' })
  })

  it('early_leave (derivado) cuando terminó con salida anticipada', () => {
    expect(
      getAttendanceStatusBadgeInput({
        status: 'finished',
        displayStatus: 'finished',
        minutesEarlyLeave: 20,
        lastNoticeMinutesLate: null,
      }),
    ).toEqual({ status: 'early_leave', minutes: 20 })
  })

  it('finished sin salida anticipada: queda finished', () => {
    expect(
      getAttendanceStatusBadgeInput({
        status: 'finished',
        displayStatus: 'finished',
        minutesEarlyLeave: null,
        lastNoticeMinutesLate: null,
      }),
    ).toEqual({ status: 'finished' })
  })

  it('delay_notified con los minutos del último aviso', () => {
    expect(
      getAttendanceStatusBadgeInput({
        status: 'delay_notified',
        displayStatus: 'delay_notified',
        minutesEarlyLeave: null,
        lastNoticeMinutesLate: 15,
      }),
    ).toEqual({ status: 'delay_notified', minutes: 15 })
  })

  it('cualquier otro estado, tal cual', () => {
    expect(
      getAttendanceStatusBadgeInput({
        status: 'present',
        displayStatus: 'present',
        minutesEarlyLeave: null,
        lastNoticeMinutesLate: null,
      }),
    ).toEqual({ status: 'present' })
  })
})
