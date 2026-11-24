import { describe, expect, it } from 'vitest'
import {
  addMonths,
  dayLabel,
  fullDateLabel,
  isSelectable,
  monthRange,
  upcomingBounds,
} from './dates'

describe('fechas de «Próximos días» (P32, D-05)', () => {
  it('mañana y hoy + 60 salen de la fecha de Buenos Aires, no de la del dispositivo', () => {
    // 02:30 UTC del 25/11 todavía es 24/11 en Buenos Aires (UTC-3).
    expect(upcomingBounds(new Date('2026-11-25T02:30:00Z'))).toEqual({
      min: '2026-11-25',
      max: '2027-01-23',
    })
  })

  it('suma meses cruzando el año y da el rango de cada mes', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(monthRange('2026-02')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })

  it('isSelectable incluye los dos extremos', () => {
    expect(isSelectable('2026-11-25', '2026-11-25', '2027-01-23')).toBe(true)
    expect(isSelectable('2027-01-23', '2026-11-25', '2027-01-23')).toBe(true)
    expect(isSelectable('2026-11-24', '2026-11-25', '2027-01-23')).toBe(false)
    expect(isSelectable('2027-01-24', '2026-11-25', '2027-01-23')).toBe(false)
  })

  it('rotula la fecha completa y la corta en español', () => {
    expect(fullDateLabel('2026-11-25')).toBe(
      'miércoles 25 de noviembre de 2026',
    )
    expect(dayLabel('2026-11-25')).toBe('miércoles 25 de noviembre')
  })
})
