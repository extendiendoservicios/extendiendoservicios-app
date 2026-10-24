import { describe, expect, it } from 'vitest'
import {
  availableWorkdayActions,
  currentPause,
  liveWorkedMinutes,
  openSupervisionOf,
  workdayActionBlock,
  workdayBarState,
} from './workday'
import { makeWorkday, makeWorkdaySupervision } from './fixtures'

describe('workdayBarState', () => {
  it('sin jornada de hoy: sin iniciar', () => {
    expect(workdayBarState(null)).toBe('not_started')
    expect(workdayBarState(undefined)).toBe('not_started')
  })

  it('en marcha sin supervisión abierta: en actividad', () => {
    expect(workdayBarState(makeWorkday())).toBe('active')
  })

  it('en marcha con una supervisión abierta: supervisando', () => {
    const workday = makeWorkday({
      supervisions: [makeWorkdaySupervision()],
    })
    expect(workdayBarState(workday)).toBe('supervising')
  })

  it('una supervisión ya cerrada no cuenta como abierta', () => {
    const workday = makeWorkday({
      supervisions: [
        makeWorkdaySupervision({
          status: 'completed',
          checkOutAt: '2026-10-23T12:30:00Z',
        }),
      ],
    })
    expect(openSupervisionOf(workday)).toBeNull()
    expect(workdayBarState(workday)).toBe('active')
  })

  it('en pausa', () => {
    expect(workdayBarState(makeWorkday({ state: 'paused' }))).toBe('paused')
  })

  it('finalizada', () => {
    expect(
      workdayBarState(
        makeWorkday({ state: 'ended', endedAt: '2026-10-23T20:00:00Z' }),
      ),
    ).toBe('ended')
  })

  it('cerrada automáticamente (CJ-31) mientras no la corrigió la administración', () => {
    const workday = makeWorkday({
      state: 'ended',
      autoClosed: true,
      autoCloseWarning: true,
    })
    expect(workdayBarState(workday)).toBe('auto_closed')
    expect(
      workdayBarState({ ...workday, autoCloseWarning: false, corrected: true }),
    ).toBe('ended')
  })
})

describe('availableWorkdayActions', () => {
  it('muestra los botones que corresponden a cada estado', () => {
    expect(availableWorkdayActions('not_started')).toEqual(['start'])
    expect(availableWorkdayActions('active')).toEqual(['pause', 'end'])
    expect(availableWorkdayActions('supervising')).toEqual(['pause', 'end'])
    expect(availableWorkdayActions('paused')).toEqual(['resume', 'end'])
    expect(availableWorkdayActions('ended')).toEqual(['reopen'])
    expect(availableWorkdayActions('auto_closed')).toEqual(['reopen'])
  })

  it('con una supervisión abierta no se puede pausar ni finalizar (CJ-29)', () => {
    expect(workdayActionBlock('supervising', 'pause')).toMatch(/supervisión/)
    expect(workdayActionBlock('supervising', 'end')).toMatch(/supervisión/)
    expect(workdayActionBlock('active', 'pause')).toBeNull()
    expect(workdayActionBlock('paused', 'end')).toBeNull()
  })
})

describe('liveWorkedMinutes', () => {
  const fetchedAt = Date.parse('2026-10-23T14:00:00Z')

  it('en marcha suma los minutos enteros transcurridos desde la lectura', () => {
    const workday = makeWorkday({ workedMinutes: 125 })
    expect(liveWorkedMinutes(workday, fetchedAt, fetchedAt)).toBe(125)
    expect(liveWorkedMinutes(workday, fetchedAt, fetchedAt + 59_000)).toBe(125)
    expect(liveWorkedMinutes(workday, fetchedAt, fetchedAt + 90_000)).toBe(126)
    expect(liveWorkedMinutes(workday, fetchedAt, fetchedAt + 30 * 60_000)).toBe(
      155,
    )
  })

  it('en pausa o finalizada no avanza', () => {
    const later = fetchedAt + 60 * 60_000
    expect(
      liveWorkedMinutes(makeWorkday({ state: 'paused' }), fetchedAt, later),
    ).toBe(125)
    expect(
      liveWorkedMinutes(makeWorkday({ state: 'ended' }), fetchedAt, later),
    ).toBe(125)
  })

  it('un reloj del teléfono atrasado respecto de la lectura no resta horas', () => {
    expect(
      liveWorkedMinutes(makeWorkday(), fetchedAt, fetchedAt - 10 * 60_000),
    ).toBe(125)
  })
})

describe('currentPause', () => {
  it('devuelve la pausa abierta solo si está en pausa', () => {
    const open = {
      type: 'pause' as const,
      startsAt: '2026-10-23T14:00:00Z',
      endsAt: null,
      minutes: 5,
      reason: 'Almuerzo',
    }
    const closed = { ...open, endsAt: '2026-10-23T13:00:00Z' }
    expect(
      currentPause(makeWorkday({ state: 'paused', pauses: [closed, open] })),
    ).toBe(open)
    expect(currentPause(makeWorkday({ pauses: [closed] }))).toBeNull()
  })
})
