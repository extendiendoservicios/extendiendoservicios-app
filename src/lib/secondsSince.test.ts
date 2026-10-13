import { describe, expect, it } from 'vitest'
import { secondsSince } from './secondsSince'

describe('secondsSince', () => {
  it('calcula los segundos transcurridos', () => {
    expect(secondsSince(10_000, 4_000)).toBe(6)
  })
  it('no devuelve negativos', () => {
    expect(secondsSince(1_000, 5_000)).toBe(0)
  })
  it('devuelve null sin marca válida (0, negativa, NaN, nula)', () => {
    expect(secondsSince(1_790_000_000_000, 0)).toBeNull()
    expect(secondsSince(1_790_000_000_000, -1)).toBeNull()
    expect(secondsSince(1_790_000_000_000, Number.NaN)).toBeNull()
    expect(secondsSince(1_790_000_000_000, null)).toBeNull()
    expect(secondsSince(1_790_000_000_000, undefined)).toBeNull()
  })
})
