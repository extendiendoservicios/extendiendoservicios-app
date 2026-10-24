import { describe, expect, it } from 'vitest'
import { at, makeAssignment, NOW } from '@/features/dashboard/fixtures'
import {
  makeWorkday,
  makeWorkdaySupervision,
} from '@/features/geo/coordinatorFixtures'
import {
  ATTENDANCE_AND_WORKDAYS_TITLE,
  buildAttendanceEntries,
  buildAttendanceSheet,
  buildWorkdaysSection,
  sumWorkdayMinutes,
  WORKDAYS_CONSENT_TEXT,
  WORKDAYS_SHEET_TITLE,
} from './detailSheet'

const coordinator = {
  name: 'Sofía Ruiz',
  dni: '28111222',
  employeeNumber: 7,
  roleLabels: ['Coordinador'],
  signerLabel: 'Coordinador',
}

describe('hoja de jornadas del coordinador (CJ-13, CJ-14, CJ-19)', () => {
  it('una fila por día con inicio, fin, pausas y horas netas, y debajo sus supervisiones', () => {
    const section = buildWorkdaysSection([makeWorkday()], 'Total del período')

    expect(section.columns.map((column) => column.header)).toEqual([
      'Fecha',
      'Inicio',
      'Fin',
      'Pausas',
      'Observaciones',
      'Horas netas',
    ])
    expect(section.rows).toEqual([
      {
        key: 'workday-w1',
        date: '21 oct 2026',
        start: '08:00',
        end: '17:00',
        pauses: '12:00 a 12:30 (30 min) — Almuerzo',
        notes: '',
        hours: '8 h 30 min',
      },
      {
        key: 'supervision-sup1',
        date: '',
        start:
          'Supervisión: Logística Central · Munro, 10:00 a 10:45 (45 min, informativo)',
        end: '',
        pauses: '',
        notes: '',
        hours: '',
      },
    ])
    expect(section.spans['supervision-sup1']).toEqual({
      from: 'start',
      to: 'notes',
    })
    expect(section.footer).toEqual({
      label: 'Total del período',
      value: '8 h 30 min',
    })
  })

  it('las horas son las de la jornada: el tiempo de las supervisiones no suma (CJ-14)', () => {
    const workdays = [
      makeWorkday({
        id: 'w1',
        workedMinutes: 480,
        supervisions: [
          makeWorkdaySupervision({ supervisionId: 'a', durationMinutes: 90 }),
          makeWorkdaySupervision({ supervisionId: 'b', durationMinutes: 60 }),
        ],
      }),
      makeWorkday({ id: 'w2', workDate: '2026-10-22', workedMinutes: 120 }),
    ]
    expect(sumWorkdayMinutes(workdays)).toBe(600)
    const sheet = buildAttendanceSheet({
      person: coordinator,
      from: '2026-10-01',
      to: '2026-10-31',
      entries: [],
      includeServices: false,
      workdays,
    })
    expect(sheet.totalMinutes).toBe(600)
    expect(sheet.sections).toHaveLength(1)
    expect(sheet.grandTotal).toBeUndefined()
    expect(sheet.title).toBe(WORKDAYS_SHEET_TITLE)
    expect(sheet.consentText).toBe(WORKDAYS_CONSENT_TEXT)
    expect(sheet.signers).toEqual([
      'Responsable (administración)',
      'Coordinador',
    ])
    expect(sheet.facts).toContainEqual({ label: 'Jornadas', value: '2' })
  })

  it('marca las jornadas cerradas automáticamente y las corregidas, y la que sigue en curso', () => {
    const section = buildWorkdaysSection(
      [
        makeWorkday({
          id: 'w1',
          autoClosed: true,
          autoCloseWarning: true,
          supervisions: [],
        }),
        makeWorkday({
          id: 'w2',
          workDate: '2026-10-22',
          autoClosed: true,
          corrected: true,
          supervisions: [],
        }),
        makeWorkday({
          id: 'w3',
          workDate: '2026-10-23',
          corrected: true,
          endedAt: null,
          state: 'running',
          pauses: [],
          supervisions: [],
        }),
      ],
      'Total del período',
    )
    expect(section.rows.map((row) => row.notes)).toEqual([
      'Cerrada automáticamente',
      'Cerrada automáticamente · Corregida',
      'Corregida',
    ])
    expect(section.rows[2]).toMatchObject({ end: 'En curso', pauses: '—' })
  })

  it('una supervisión sin cerrar o todavía abierta lo dice', () => {
    const section = buildWorkdaysSection(
      [
        makeWorkday({
          supervisions: [
            makeWorkdaySupervision({ supervisionId: 'a', unclosed: true }),
            makeWorkdaySupervision({
              supervisionId: 'b',
              checkOutAt: null,
              durationMinutes: 12,
            }),
          ],
        }),
      ],
      'Total del período',
    )
    expect(section.rows[1]?.start).toContain('— Sin cerrar')
    expect(section.rows[2]?.start).toBe(
      'Supervisión: Logística Central · Munro, desde 10:00 (12 min, informativo)',
    )
  })

  it('una pausa abierta y una reapertura se muestran con su motivo', () => {
    const section = buildWorkdaysSection(
      [
        makeWorkday({
          supervisions: [],
          pauses: [
            {
              type: 'reopened',
              pauseEventId: 'p1',
              resumeEventId: 'r1',
              startsAt: '2026-10-21T15:00:00Z',
              endsAt: '2026-10-21T16:00:00Z',
              minutes: 60,
              reason: 'Jornada reabierta',
              corrected: false,
            },
            {
              type: 'pause',
              pauseEventId: 'p2',
              resumeEventId: null,
              startsAt: '2026-10-21T18:00:00Z',
              endsAt: null,
              minutes: 5,
              reason: null,
              corrected: false,
            },
          ],
        }),
      ],
      'Total del período',
    )
    expect(section.rows[0]?.pauses).toBe(
      '12:00 a 13:00 (1 h) — Jornada reabierta; desde 15:00',
    )
  })
})

describe('persona con dos roles (CJ-34)', () => {
  it('lleva una sección por rol, cada una con su total, y la suma al final', () => {
    const entries = buildAttendanceEntries([
      makeAssignment({
        id: 'a1',
        shiftDate: '2026-10-20',
        checkInAt: at('08:00'),
        checkOutAt: at('12:00'),
        workedMinutes: 240,
      }),
    ])
    const sheet = buildAttendanceSheet({
      person: {
        ...coordinator,
        roleLabels: ['Empleado', 'Coordinador'],
        signerLabel: 'Empleado y coordinador',
      },
      from: '2026-10-01',
      to: '2026-10-31',
      entries,
      workdays: [makeWorkday({ workedMinutes: 480 })],
      now: NOW,
    })

    expect(sheet.title).toBe(ATTENDANCE_AND_WORKDAYS_TITLE)
    expect(sheet.sections.map((section) => section.key)).toEqual([
      'services',
      'workdays',
    ])
    expect(sheet.sections.map((section) => section.heading)).toEqual([
      'Turnos como empleado',
      'Jornadas como coordinador',
    ])
    expect(sheet.sections.map((section) => section.footer)).toEqual([
      { label: 'Total como empleado', value: '4 h' },
      { label: 'Total como coordinador', value: '8 h' },
    ])
    expect(sheet.grandTotal).toEqual({
      label: 'Total general (empleado y coordinador)',
      value: '12 h',
    })
    expect(sheet.totalMinutes).toBe(720)
  })

  it('un período sin jornadas deja la sección vacía con su total en 0 min', () => {
    const sheet = buildAttendanceSheet({
      person: coordinator,
      from: '2026-10-01',
      to: '2026-10-31',
      entries: [],
      includeServices: false,
      workdays: [],
    })
    expect(sheet.sections[0]?.rows).toEqual([])
    expect(sheet.sections[0]?.footer.value).toBe('0 min')
  })
})
