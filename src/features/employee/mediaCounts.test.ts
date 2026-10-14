import { describe, expect, it } from 'vitest'
import { formatMediaCounts } from './mediaCounts'

describe('formatMediaCounts', () => {
  it('cuenta fotos y videos con el plural que corresponde', () => {
    expect(formatMediaCounts(3, 1)).toBe('3 fotos y 1 video')
    expect(formatMediaCounts(1, 2)).toBe('1 foto y 2 videos')
  })

  it('omite lo que no hay', () => {
    expect(formatMediaCounts(2, 0)).toBe('2 fotos')
    expect(formatMediaCounts(0, 1)).toBe('1 video')
  })

  it('sin nada dice Ninguno', () => {
    expect(formatMediaCounts(0, 0)).toBe('Ninguno')
  })
})
