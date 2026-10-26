import { describe, expect, it } from 'vitest'
import {
  anchorSecondsAt,
  availableWorkdayActions,
  currentPause,
  formatClock,
  nextCounterAnchor,
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

describe('contador con segundos', () => {
  const readAt = Date.parse('2026-10-23T14:00:00Z')

  it('formatClock arma H:MM:SS', () => {
    expect(formatClock(0)).toBe('0:00:00')
    expect(formatClock(59)).toBe('0:00:59')
    expect(formatClock(125 * 60 + 7)).toBe('2:05:07')
    expect(formatClock(-5)).toBe('0:00:00')
  })

  it('en marcha suma los segundos transcurridos desde la lectura', () => {
    const anchor = nextCounterAnchor(
      null,
      makeWorkday({ workedMinutes: 95 }),
      readAt,
    )
    expect(anchorSecondsAt(anchor, readAt)).toBe(95 * 60)
    expect(anchorSecondsAt(anchor, readAt + 7_400)).toBe(95 * 60 + 7)
    expect(anchorSecondsAt(anchor, readAt + 90_000)).toBe(95 * 60 + 90)
  })

  it('en pausa o finalizada no avanza', () => {
    const later = readAt + 3_600_000
    for (const state of ['paused', 'ended'] as const) {
      const anchor = nextCounterAnchor(null, makeWorkday({ state }), readAt)
      expect(anchorSecondsAt(anchor, later)).toBe(125 * 60)
    }
  })

  it('un reloj del teléfono atrasado respecto de la lectura no resta tiempo', () => {
    const anchor = nextCounterAnchor(null, makeWorkday(), readAt)
    expect(anchorSecondsAt(anchor, readAt - 600_000)).toBe(125 * 60)
  })

  it('una lectura nueva que redondea hacia abajo no hace retroceder el contador', () => {
    // Se mostraba 125 min + 30 s; el servidor sigue diciendo 125 min.
    const first = nextCounterAnchor(null, makeWorkday(), readAt)
    const second = nextCounterAnchor(first, makeWorkday(), readAt + 30_000)
    expect(anchorSecondsAt(second, readAt + 30_000)).toBe(125 * 60 + 30)
    expect(anchorSecondsAt(second, readAt + 45_000)).toBe(125 * 60 + 45)
  })

  it('si el servidor va más adelante, el contador se adelanta a su valor', () => {
    const first = nextCounterAnchor(null, makeWorkday(), readAt)
    const second = nextCounterAnchor(
      first,
      makeWorkday({ workedMinutes: 127 }),
      readAt + 30_000,
    )
    expect(anchorSecondsAt(second, readAt + 30_000)).toBe(127 * 60)
  })

  it('una corrección grande hacia atrás manda el servidor', () => {
    const first = nextCounterAnchor(null, makeWorkday(), readAt)
    const second = nextCounterAnchor(
      first,
      makeWorkday({ workedMinutes: 100 }),
      readAt + 30_000,
    )
    expect(anchorSecondsAt(second, readAt + 30_000)).toBe(100 * 60)
  })

  it('al reanudar desde una pausa se parte del valor del servidor', () => {
    const paused = nextCounterAnchor(
      null,
      makeWorkday({ state: 'paused' }),
      readAt,
    )
    const resumed = nextCounterAnchor(paused, makeWorkday(), readAt + 5_000)
    expect(anchorSecondsAt(resumed, readAt + 8_000)).toBe(125 * 60 + 3)
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
