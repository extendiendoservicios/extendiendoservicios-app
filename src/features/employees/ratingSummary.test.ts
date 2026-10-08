import { describe, expect, it } from 'vitest'
import {
  formatRatingAverage,
  formatRatingsCount,
  ratingSortValue,
  ratingToStars,
  sortByRating,
} from './ratingSummary'

describe('promedio de calificaciones (AJ-04, AJ-05)', () => {
  it('formatea con una decimal y coma', () => {
    expect(formatRatingAverage(4.33)).toBe('4,3')
    expect(formatRatingAverage(5)).toBe('5,0')
    expect(formatRatingAverage(3.95)).toBe('4,0')
  })

  it('redondea a estrellas enteras dentro de 1 a 5', () => {
    expect(ratingToStars(4.3)).toBe(4)
    expect(ratingToStars(4.5)).toBe(5)
    expect(ratingToStars(0.2)).toBe(1)
  })

  it('pluraliza la cantidad', () => {
    expect(formatRatingsCount(1)).toBe('1 calificación')
    expect(formatRatingsCount(12)).toBe('12 calificaciones')
  })

  it('sin calificaciones vale menos que cualquier promedio', () => {
    expect(ratingSortValue(undefined)).toBe(-1)
    expect(ratingSortValue({ average: 0, count: 0 })).toBe(-1)
    expect(ratingSortValue({ average: 1.5, count: 2 })).toBe(1.5)
  })

  it('ordena sin mutar, con los sin calificaciones al final de mayor a menor', () => {
    const summaries = new Map([
      ['a', { average: 4.3, count: 10 }],
      ['b', { average: 4.9, count: 3 }],
      ['c', { average: 4.3, count: 20 }],
    ])
    const rows = ['a', 'sin', 'b', 'c']
    const desc = sortByRating(rows, (id) => summaries.get(id), 'desc')
    expect(desc).toEqual(['b', 'c', 'a', 'sin'])
    expect(sortByRating(rows, (id) => summaries.get(id), 'asc')).toEqual([
      'sin',
      'a',
      'c',
      'b',
    ])
    expect(rows).toEqual(['a', 'sin', 'b', 'c'])
  })
})
