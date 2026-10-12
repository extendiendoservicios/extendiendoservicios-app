import { describe, expect, it } from 'vitest'
import { dateMatchesWeeksOfMonth, serviceHasDateInMonth } from './weeksOfMonth'

describe('dateMatchesWeeksOfMonth', () => {
  it('null = todas las semanas', () => {
    expect(dateMatchesWeeksOfMonth(2026, 10, 31, null)).toBe(true)
  })

  it('los días 1-7, 8-14, 15-21 y 22-28 son la 1.ª a 4.ª', () => {
    const cases: [number, number][] = [
      [1, 1],
      [7, 1],
      [8, 2],
      [14, 2],
      [15, 3],
      [21, 3],
      [22, 4],
      [28, 4],
    ]
    for (const [day, week] of cases) {
      expect(dateMatchesWeeksOfMonth(2026, 10, day, [week])).toBe(true)
      expect(dateMatchesWeeksOfMonth(2026, 10, day, [week === 1 ? 2 : 1])).toBe(
        false,
      )
    }
  })

  it('5 = la última ocurrencia: día + 7 cae en el mes siguiente', () => {
    // Octubre 2026 tiene 31 días: del 25 al 31 es la última de cada día.
    expect(dateMatchesWeeksOfMonth(2026, 10, 24, [5])).toBe(false)
    expect(dateMatchesWeeksOfMonth(2026, 10, 25, [5])).toBe(true)
    expect(dateMatchesWeeksOfMonth(2026, 10, 31, [5])).toBe(true)
  })

  it('la última puede coincidir con la 4.ª (febrero de 28 días)', () => {
    expect(dateMatchesWeeksOfMonth(2026, 2, 22, [5])).toBe(true)
    expect(dateMatchesWeeksOfMonth(2026, 2, 22, [4, 5])).toBe(true)
  })

  it('un día 29 a 31 solo coincide con la última', () => {
    expect(dateMatchesWeeksOfMonth(2026, 10, 29, [4])).toBe(false)
    expect(dateMatchesWeeksOfMonth(2026, 10, 29, [5])).toBe(true)
  })
})

describe('serviceHasDateInMonth', () => {
  const base = {
    weekdays: [1],
    weeksOfMonth: null,
    validFrom: '2026-01-01',
    validTo: null,
  }

  it('sin semanas, un lunes cualquiera del mes alcanza', () => {
    expect(serviceHasDateInMonth(base, 2026, 10)).toBe(true)
  })

  it('respeta la vigencia', () => {
    expect(
      serviceHasDateInMonth({ ...base, validFrom: '2026-10-27' }, 2026, 10),
    ).toBe(false) // el último lunes de octubre es el 26: queda fuera de la vigencia
  })

  it('con semanas, mira los días que cumplen ambas reglas', () => {
    // Lunes de octubre 2026: 5, 12, 19, 26. El 26 es la última y la 4.ª.
    expect(
      serviceHasDateInMonth({ ...base, weeksOfMonth: [5] }, 2026, 10),
    ).toBe(true)
    // Vigente solo hasta el 20: quedan la 1.ª, 2.ª y 3.ª; la última no.
    expect(
      serviceHasDateInMonth(
        { ...base, weeksOfMonth: [5], validTo: '2026-10-20' },
        2026,
        10,
      ),
    ).toBe(false)
    expect(
      serviceHasDateInMonth(
        { ...base, weeksOfMonth: [3], validTo: '2026-10-20' },
        2026,
        10,
      ),
    ).toBe(true)
  })
})
