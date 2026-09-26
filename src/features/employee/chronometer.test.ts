import { describe, expect, it } from 'vitest'
import { elapsedSeconds, formatElapsed } from './chronometer'

describe('elapsedSeconds', () => {
  it('calcula los segundos entre el inicio registrado y ahora', () => {
    const checkInAt = '2026-09-26T18:00:00.000Z'
    const now = new Date('2026-09-26T18:05:30.000Z')
    expect(elapsedSeconds(checkInAt, now)).toBe(330)
  })

  it('nunca da negativo (reloj del dispositivo atrasado respecto del inicio)', () => {
    const checkInAt = '2026-09-26T18:10:00.000Z'
    const now = new Date('2026-09-26T18:00:00.000Z')
    expect(elapsedSeconds(checkInAt, now)).toBe(0)
  })
})

describe('formatElapsed', () => {
  it('muestra minutos y segundos mientras dura menos de una hora', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(65)).toBe('01:05')
    expect(formatElapsed(3599)).toBe('59:59')
  })

  it('agrega las horas sin cero a la izquierda a partir de la primera hora', () => {
    expect(formatElapsed(3600)).toBe('1:00:00')
    expect(formatElapsed(3661)).toBe('1:01:01')
    expect(formatElapsed(36_000)).toBe('10:00:00')
  })

  it('trunca valores negativos o no enteros a 0', () => {
    expect(formatElapsed(-5)).toBe('00:00')
  })
})
