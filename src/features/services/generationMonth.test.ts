import { describe, expect, it } from 'vitest'
import { generationMonthFor } from './generationMonth'

describe('generationMonthFor', () => {
  it('usa el mes en curso si la fecha de inicio ya pasó o es de este mes', () => {
    expect(generationMonthFor('2026-09-01', '2026-11-02')).toEqual({
      year: 2026,
      month: 11,
    })
    expect(generationMonthFor('2026-11-20', '2026-11-02')).toEqual({
      year: 2026,
      month: 11,
    })
  })

  it('usa el mes de la fecha de inicio si es futuro', () => {
    expect(generationMonthFor('2027-01-05', '2026-11-02')).toEqual({
      year: 2027,
      month: 1,
    })
  })

  it('sin fecha de inicio usa el mes en curso', () => {
    expect(generationMonthFor(null, '2026-11-02')).toEqual({
      year: 2026,
      month: 11,
    })
  })
})
