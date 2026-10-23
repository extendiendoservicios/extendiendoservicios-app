import { describe, expect, it } from 'vitest'
import {
  formatPauseDuration,
  isWithinWorkdayBounds,
  workdayTimeBounds,
} from './time'

describe('workdayTimeBounds', () => {
  it('de una jornada pasada va de las 0:00 a las 23:59 de ese día', () => {
    const now = new Date('2026-10-23T15:00:00Z')
    expect(workdayTimeBounds('2026-10-20', now)).toEqual({
      min: '2026-10-20T00:00',
      max: '2026-10-20T23:59',
    })
  })

  it('de la jornada de hoy llega hasta ahora (hora de Argentina), no a futuro', () => {
    const now = new Date('2026-10-23T15:00:00Z') // 12:00 en Argentina
    expect(workdayTimeBounds('2026-10-23', now)).toEqual({
      min: '2026-10-23T00:00',
      max: '2026-10-23T12:00',
    })
  })
})

describe('isWithinWorkdayBounds', () => {
  const bounds = { min: '2026-10-20T00:00', max: '2026-10-20T23:59' }
  it('acepta el borde y rechaza el día siguiente', () => {
    expect(isWithinWorkdayBounds('2026-10-20T23:59', bounds)).toBe(true)
    expect(isWithinWorkdayBounds('2026-10-21T00:00', bounds)).toBe(false)
    expect(isWithinWorkdayBounds('2026-10-19T23:59', bounds)).toBe(false)
  })
})

describe('formatPauseDuration', () => {
  const fmt = (m: number) => `${m} min`

  it('una pausa cerrada de menos de un minuto se lee «menos de 1 min», aunque el servidor la redondee a 0 o a 1', () => {
    const base = { startsAt: '2026-10-23T23:33:00Z' }
    expect(
      formatPauseDuration(
        { ...base, endsAt: '2026-10-23T23:33:20Z', minutes: 0 },
        fmt,
      ),
    ).toBe('menos de 1 min')
    expect(
      formatPauseDuration(
        { ...base, endsAt: '2026-10-23T23:33:40Z', minutes: 1 },
        fmt,
      ),
    ).toBe('menos de 1 min')
  })

  it('desde un minuto muestra lo que da el servidor', () => {
    expect(
      formatPauseDuration(
        {
          startsAt: '2026-10-23T23:33:00Z',
          endsAt: '2026-10-23T23:34:10Z',
          minutes: 1,
        },
        fmt,
      ),
    ).toBe('1 min')
  })

  it('una pausa abierta muestra lo que da el servidor', () => {
    expect(
      formatPauseDuration(
        { startsAt: '2026-10-23T23:33:00Z', endsAt: null, minutes: 0 },
        fmt,
      ),
    ).toBe('0 min')
  })
})
