import { describe, expect, it } from 'vitest'
import { normalizeTypedTime, parseTypedTime } from './typedTime'

describe('parseTypedTime (DEF-P30-05)', () => {
  it.each([
    ['0830', '08:30'],
    ['830', '08:30'],
    ['8:30', '08:30'],
    ['08:30', '08:30'],
    ['8.30', '08:30'],
    ['8h30', '08:30'],
    ['8', '08:00'],
    ['14', '14:00'],
    ['1745', '17:45'],
    ['0:5', '00:05'],
  ])('«%s» se entiende como %s', (raw, expected) => {
    expect(parseTypedTime(raw)).toBe(expected)
  })

  it.each(['', 'abc', '2460', '25:00', '12:60', '12345'])(
    '«%s» no es una hora',
    (raw) => {
      expect(parseTypedTime(raw)).toBeNull()
    },
  )

  it('normalizeTypedTime deja el texto original si no se entiende', () => {
    expect(normalizeTypedTime(' 0830 ')).toBe('08:30')
    expect(normalizeTypedTime('xx')).toBe('xx')
    expect(normalizeTypedTime('')).toBe('')
  })
})
