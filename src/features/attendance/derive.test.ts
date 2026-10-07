import { describe, expect, it } from 'vitest'
import {
  getArrivalHint,
  getAttendanceRowVariant,
  getAttendanceStatusBadgeInput,
  getAvailableAttendanceActions,
  getWorkedHoursIndicator,
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

describe('estados nuevos en camino y llegada tarde (AJ-02, AJ-07)', () => {
  const base = {
    status: 'expected' as const,
    minutesEarlyLeave: null,
    lastNoticeMinutesLate: null,
    shiftStatus: 'assigned' as const,
  }

  it('traduce display_status a on_the_way y late', () => {
    expect(
      getAttendanceStatusBadgeInput({ ...base, displayStatus: 'on_the_way' }),
    ).toEqual({ status: 'on_the_way' })
    expect(
      getAttendanceStatusBadgeInput({ ...base, displayStatus: 'late' }),
    ).toEqual({ status: 'late' })
  })

  it('el turno cancelado manda sobre on_the_way y late', () => {
    for (const displayStatus of ['on_the_way', 'late']) {
      const cancelled = { ...base, shiftStatus: 'cancelled' as const }
      expect(
        getAttendanceStatusBadgeInput({ ...cancelled, displayStatus }),
      ).toEqual({ status: 'expected' })
      expect(
        getAttendanceRowVariant({ ...cancelled, displayStatus }),
      ).toBeUndefined()
    }
  })

  it('colorea la fila: celeste en camino, amarilla llegada tarde, roja sin registro', () => {
    expect(
      getAttendanceRowVariant({ ...base, displayStatus: 'on_the_way' }),
    ).toBe('info')
    expect(getAttendanceRowVariant({ ...base, displayStatus: 'late' })).toBe(
      'warn',
    )
    expect(
      getAttendanceRowVariant({ ...base, displayStatus: 'no_record' }),
    ).toBe('crit')
  })

  it('muestra "llega ~HH:MM" en hora de Argentina solo si está en camino y informó la hora', () => {
    const arrival = '2026-09-30T11:30:00Z' // 08:30 en Argentina
    expect(
      getArrivalHint({
        ...base,
        displayStatus: 'on_the_way',
        lastNoticeEstimatedArrivalAt: arrival,
      }),
    ).toBe('llega ~08:30')
    expect(
      getArrivalHint({
        ...base,
        displayStatus: 'on_the_way',
        lastNoticeEstimatedArrivalAt: null,
      }),
    ).toBeNull()
    expect(
      getArrivalHint({
        ...base,
        displayStatus: 'late',
        lastNoticeEstimatedArrivalAt: arrival,
      }),
    ).toBeNull()
  })
})

describe('getWorkedHoursIndicator (AJ-03)', () => {
  const row = {
    workedMinutes: 240,
    plannedMinutes: 240,
    minutesEarlyLeave: null,
    checkInAt: '2026-09-30T11:00:00Z',
    checkOutAt: '2026-09-30T15:00:00Z',
  }

  it('tilde verde si trabajó exactamente lo previsto (sin margen)', () => {
    expect(getWorkedHoursIndicator(row)).toEqual({
      kind: 'ok',
      workedMinutes: 240,
      text: '4 h',
    })
  })

  it('tilde verde si trabajó de más', () => {
    expect(getWorkedHoursIndicator({ ...row, workedMinutes: 250 }).kind).toBe(
      'ok',
    )
  })

  it('advertencia "Faltan X min" si trabajó un minuto menos', () => {
    expect(getWorkedHoursIndicator({ ...row, workedMinutes: 239 })).toEqual({
      kind: 'warning',
      workedMinutes: 239,
      text: '3 h 59 min',
      reason: 'Faltan 1 min',
    })
  })

  it('advertencia con salida anticipada aunque las horas alcancen', () => {
    expect(
      getWorkedHoursIndicator({ ...row, minutesEarlyLeave: 5 }),
    ).toMatchObject({ kind: 'warning', reason: 'Salida anticipada' })
  })

  it('salida anticipada y faltante juntos', () => {
    expect(
      getWorkedHoursIndicator({
        ...row,
        workedMinutes: 178,
        minutesEarlyLeave: 62,
      }),
    ).toMatchObject({
      kind: 'warning',
      text: '2 h 58 min',
      reason: 'Salida anticipada · faltan 1 h 2 min',
    })
  })

  it('sin fin registrado: en curso si ya empezó, guion si no', () => {
    expect(
      getWorkedHoursIndicator({
        ...row,
        workedMinutes: null,
        checkOutAt: null,
      }),
    ).toEqual({ kind: 'in_progress' })
    expect(
      getWorkedHoursIndicator({
        ...row,
        workedMinutes: null,
        checkInAt: null,
        checkOutAt: null,
      }),
    ).toEqual({ kind: 'none' })
  })
})
