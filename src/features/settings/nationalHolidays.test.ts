import { describe, expect, it } from 'vitest'
import { computeNationalHolidays } from './nationalHolidays'

/**
 * `computeNationalHolidays` (USERS-014, ADM-29): reglas fijas de cálculo,
 * no una tabla de fechas -- se verifican los fijos, los móviles atados a
 * Pascua y los de "n-ésimo lunes del mes" contra fechas reales conocidas de
 * más de un año (ver el comentario de cabecera de `nationalHolidays.ts`).
 */
describe('computeNationalHolidays', () => {
  it('2026: feriados fijos en su fecha de siempre', () => {
    const holidays = computeNationalHolidays(2026)
    const byDate = new Map(holidays.map((h) => [h.date, h.name]))

    expect(byDate.get('2026-01-01')).toBe('Año Nuevo')
    expect(byDate.get('2026-03-24')).toContain('Memoria')
    expect(byDate.get('2026-04-02')).toContain('Malvinas')
    expect(byDate.get('2026-05-01')).toBe('Día del Trabajador')
    expect(byDate.get('2026-05-25')).toContain('Revolución de Mayo')
    expect(byDate.get('2026-06-20')).toContain('Belgrano')
    expect(byDate.get('2026-07-09')).toBe('Día de la Independencia')
    expect(byDate.get('2026-12-08')).toContain('Inmaculada')
    expect(byDate.get('2026-12-25')).toBe('Navidad')
  })

  it('2026: Pascua cae el 5 de abril -> Carnaval y Viernes Santo calculados bien', () => {
    const holidays = computeNationalHolidays(2026)
    const dates = holidays
      .filter((h) => h.name === 'Carnaval')
      .map((h) => h.date)

    // Pascua 2026: 5 de abril (dato de calendario conocido) -> Carnaval el
    // lunes y martes 48/47 días antes (16 y 17 de febrero); Viernes Santo,
    // dos días antes (3 de abril).
    expect(dates).toEqual(['2026-02-16', '2026-02-17'])
    expect(holidays.find((h) => h.name === 'Viernes Santo')?.date).toBe(
      '2026-04-03',
    )
  })

  it('2024: Pascua cae el 31 de marzo (otro año, mismo algoritmo)', () => {
    const holidays = computeNationalHolidays(2024)
    const dates = holidays
      .filter((h) => h.name === 'Carnaval')
      .map((h) => h.date)

    expect(dates).toEqual(['2024-02-12', '2024-02-13'])
    expect(holidays.find((h) => h.name === 'Viernes Santo')?.date).toBe(
      '2024-03-29',
    )
  })

  it('calcula el 3er lunes de agosto, el 2do de octubre y el 4to de noviembre', () => {
    const holidays2026 = computeNationalHolidays(2026)
    const byName2026 = new Map(holidays2026.map((h) => [h.name, h.date]))

    expect(
      byName2026.get('Paso a la Inmortalidad del General José de San Martín'),
    ).toBe('2026-08-17')
    expect(byName2026.get('Día del Respeto a la Diversidad Cultural')).toBe(
      '2026-10-12',
    )
    expect(byName2026.get('Día de la Soberanía Nacional')).toBe('2026-11-23')
  })

  it('devuelve la lista ordenada por fecha, sin fechas repetidas', () => {
    const holidays = computeNationalHolidays(2027)
    const dates = holidays.map((h) => h.date)
    const sorted = [...dates].sort()

    expect(dates).toEqual(sorted)
    expect(new Set(dates).size).toBe(dates.length)
  })
})
