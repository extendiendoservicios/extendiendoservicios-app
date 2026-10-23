import { describe, expect, it } from 'vitest'
import { isWithinWorkdayBounds, workdayTimeBounds } from './time'

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
