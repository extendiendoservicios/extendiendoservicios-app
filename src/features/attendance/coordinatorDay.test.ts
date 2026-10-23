import { describe, expect, it } from 'vitest'
import { makeStatusRow, makeWorkday } from '@/features/geo/coordinatorFixtures'
import {
  rowFromStatus,
  rowFromWorkday,
  sortCoordinatorRows,
} from './coordinatorDay'
import { mapWorkdayRow } from './workdaysAdmin'

describe('sección «Coordinadores» de Asistencia de hoy (P24.4)', () => {
  it('una jornada cerrada sola y sin corregir lleva la advertencia; corregida, ya no', () => {
    expect(
      rowFromStatus(makeStatusRow({ status: 'finished', autoClosed: true }))
        .autoCloseWarning,
    ).toBe(true)
    expect(
      rowFromStatus(
        makeStatusRow({
          status: 'finished',
          autoClosed: true,
          corrected: true,
        }),
      ).autoCloseWarning,
    ).toBe(false)
  })

  it('en otras fechas el estado sale de la jornada: finalizada, en pausa o en actividad', () => {
    expect(rowFromWorkday(makeWorkday()).status).toBe('finished')
    expect(rowFromWorkday(makeWorkday({ state: 'paused' })).status).toBe(
      'paused',
    )
    expect(
      rowFromWorkday(makeWorkday({ state: 'running', endedAt: null })).status,
    ).toBe('in_activity')
    expect(rowFromWorkday(makeWorkday()).workedMinutes).toBe(510)
  })

  it('ordena por estado y después por nombre', () => {
    const sorted = sortCoordinatorRows(
      [
        makeStatusRow({
          supervisorId: '1',
          firstName: 'Zoe',
          status: 'not_started',
        }),
        makeStatusRow({
          supervisorId: '2',
          firstName: 'Beto',
          status: 'finished',
        }),
        makeStatusRow({
          supervisorId: '3',
          firstName: 'Ana',
          status: 'finished',
        }),
        makeStatusRow({
          supervisorId: '4',
          firstName: 'Cora',
          status: 'supervising',
        }),
      ].map(rowFromStatus),
    )
    expect(sorted.map((row) => row.supervisorId)).toEqual(['4', '3', '2', '1'])
  })
})

describe('mapWorkdayRow (v_supervisor_workdays_admin)', () => {
  it('normaliza las pausas y las supervisiones que llegan como jsonb', () => {
    const workday = mapWorkdayRow({
      id: 'w1',
      supervisor_id: 'sv1',
      supervisor_first_name: 'Sofía',
      supervisor_last_name: 'Ruiz',
      work_date: '2026-10-21',
      started_at: '2026-10-21T11:00:00Z',
      ended_at: null,
      state: 'paused',
      worked_minutes: 60,
      pause_minutes: 5,
      auto_closed: false,
      corrected: false,
      auto_close_warning: false,
      pauses: [
        {
          type: 'pause',
          starts_at: '2026-10-21T12:00:00Z',
          ends_at: null,
          minutes: 5,
          reason: null,
          corrected: false,
        },
      ],
      supervisions: [
        {
          supervision_id: 'sup1',
          shift_id: 's1',
          client_legal_name: 'Logística Central',
          site_name: 'Munro',
          status: 'in_progress',
          check_in_at: '2026-10-21T11:30:00Z',
          check_out_at: null,
          duration_minutes: 20,
          unclosed: false,
        },
      ],
    })
    expect(workday?.state).toBe('paused')
    expect(workday?.pauses).toEqual([
      {
        type: 'pause',
        startsAt: '2026-10-21T12:00:00Z',
        endsAt: null,
        minutes: 5,
        reason: null,
        corrected: false,
      },
    ])
    expect(workday?.supervisions[0]).toMatchObject({
      supervisionId: 'sup1',
      clientName: 'Logística Central',
      durationMinutes: 20,
    })
  })

  it('descarta filas incompletas y tolera pausas o supervisiones nulas', () => {
    const base = {
      id: 'w1',
      supervisor_id: 'sv1',
      supervisor_first_name: null,
      supervisor_last_name: null,
      work_date: '2026-10-21',
      started_at: '2026-10-21T11:00:00Z',
      ended_at: null,
      state: null,
      worked_minutes: null,
      pause_minutes: null,
      auto_closed: null,
      corrected: null,
      auto_close_warning: null,
      pauses: null,
      supervisions: null,
    }
    expect(mapWorkdayRow({ ...base, id: null })).toBeNull()
    const workday = mapWorkdayRow(base)
    expect(workday).toMatchObject({
      state: 'running',
      workedMinutes: 0,
      pauses: [],
      supervisions: [],
      autoClosed: false,
    })
  })
})
