import { describe, expect, it } from 'vitest'
import { formatShiftRange } from './openEnded'

describe('formatShiftRange', () => {
  it('muestra inicio y fin', () => {
    expect(formatShiftRange('08:00:00', '12:00:00', false)).toBe('08:00–12:00')
  })

  it('un turno «A terminar» no muestra 23:59', () => {
    expect(formatShiftRange('08:00:00', '23:59:00', true)).toBe(
      '08:00–A terminar',
    )
  })

  it('sin fin también es «A terminar»', () => {
    expect(formatShiftRange('08:00:00', null, false)).toBe('08:00–A terminar')
  })
})
