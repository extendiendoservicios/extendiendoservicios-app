import { describe, expect, it } from 'vitest'
import {
  makeStatusRow,
  makeWorkday,
  makeWorkdaySupervision,
} from '@/features/geo/coordinatorFixtures'
import {
  buildActivityTimeline,
  buildDayCards,
  buildTodayCards,
  describePause,
} from './coordinatorCards'

describe('buildTodayCards (OD-04)', () => {
  it('una tarjeta por coordinador, ordenada por estado, con pausas y horas de su jornada', () => {
    const cards = buildTodayCards(
      [
        makeStatusRow({
          supervisorId: 'b',
          firstName: 'Beto',
          lastName: 'Paz',
          status: 'not_started',
          workdayId: null,
          startedAt: null,
        }),
        makeStatusRow({
          supervisorId: 'a',
          firstName: 'Ana',
          lastName: 'Gómez',
          status: 'paused',
          workdayId: 'w-a',
          workedMinutes: 10,
        }),
      ],
      [
        makeWorkday({
          id: 'w-a',
          supervisorId: 'a',
          state: 'paused',
          workedMinutes: 125,
        }),
      ],
    )
    expect(cards.map((card) => card.name)).toEqual(['Ana Gómez', 'Beto Paz'])
    expect(cards[0]!.workedMinutes).toBe(125)
    expect(cards[0]!.pauses).toHaveLength(1)
    expect(cards[1]!.workday).toBeNull()
  })

  it('la supervisión en curso sale de la jornada o, si no, del estado', () => {
    const withWorkday = buildTodayCards(
      [makeStatusRow({ status: 'supervising', workdayId: 'w1' })],
      [
        makeWorkday({
          openSupervisionId: 'sup1',
          supervisions: [makeWorkdaySupervision({ supervisionId: 'sup1' })],
        }),
      ],
    )
    expect(withWorkday[0]!.supervision).toEqual({
      clientName: 'Logística Central',
      siteName: 'Munro',
    })

    const fromStatus = buildTodayCards(
      [
        makeStatusRow({
          status: 'supervising',
          clientName: 'Cliente X',
          siteName: 'Sede Y',
        }),
      ],
      [],
    )
    expect(fromStatus[0]!.supervision).toEqual({
      clientName: 'Cliente X',
      siteName: 'Sede Y',
    })
  })

  it('cerrada sola y sin corregir lleva advertencia', () => {
    const [card] = buildTodayCards(
      [makeStatusRow({ status: 'finished', autoClosed: true })],
      [],
    )
    expect(card!.autoCloseWarning).toBe(true)
  })
})

describe('buildDayCards', () => {
  it('deduce el estado de la jornada de otra fecha', () => {
    const cards = buildDayCards([
      makeWorkday({ supervisorId: 'a' }),
      makeWorkday({ supervisorId: 'b', state: 'paused', endedAt: null }),
    ])
    expect(cards.map((card) => card.status)).toEqual(['paused', 'finished'])
  })
})

describe('describePause', () => {
  it('pausa cerrada con motivo y pausa abierta', () => {
    const pause = makeWorkday().pauses[0]!
    expect(describePause(pause)).toBe('12:00 a 12:30 · Almuerzo')
    expect(describePause({ ...pause, endsAt: null, reason: null })).toBe(
      'desde las 12:00 · sin cerrar',
    )
  })
})

describe('buildActivityTimeline (OD-04)', () => {
  it('ordena por hora, nombra las supervisiones y marca correcciones y bajas', () => {
    const base = {
      hasPosition: true,
      correctedFrom: null,
      correctionReason: null,
      supervisionId: null,
      reason: null,
      corrected: false,
      removed: false,
    }
    const items = buildActivityTimeline(
      makeWorkday({
        events: [
          {
            ...base,
            id: 'e2',
            kind: 'supervision_start',
            recordedAt: '2026-10-21T13:00:00Z',
            supervisionId: 'sup1',
          },
          {
            ...base,
            id: 'e1',
            kind: 'start',
            recordedAt: '2026-10-21T11:00:00Z',
            corrected: true,
            correctedFrom: '2026-10-21T11:30:00Z',
            correctionReason: 'Se olvidó',
          },
          {
            ...base,
            id: 'e3',
            kind: 'pause',
            reason: 'Almuerzo',
            recordedAt: '2026-10-21T15:00:00Z',
            removed: true,
            correctionReason: 'Duplicada',
          },
        ],
      }),
    )
    expect(items.map((item) => item.id)).toEqual(['e1', 'e2', 'e3'])
    expect(items[0]!.title).toBe('08:00 · Inicio de la jornada')
    expect(items[0]!.description).toContain('Corregido: antes')
    expect(items[0]!.description).toContain('Motivo: Se olvidó')
    expect(items[1]!.title).toBe(
      '10:00 · Inicio de una supervisión · Logística Central · Munro',
    )
    expect(items[2]!.description).toBe('Dada de baja · Motivo: Duplicada')
    expect(items[2]!.variant).toBe('crit')
  })
})
