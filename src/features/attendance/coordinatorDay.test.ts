import { describe, expect, it } from 'vitest'
import { makeStatusRow, makeWorkday } from '@/features/geo/coordinatorFixtures'
import {
  rowFromStatus,
  rowFromWorkday,
  sortCoordinatorRows,
} from './coordinatorDay'

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
