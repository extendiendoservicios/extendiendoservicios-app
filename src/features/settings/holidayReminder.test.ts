import { describe, expect, it } from 'vitest'
import {
  describeNationalHolidaysLoad,
  nextYearOf,
  shouldRemindNextYearHolidays,
} from './holidayReminder'

describe('shouldRemindNextYearHolidays (AJ2-13)', () => {
  it('antes del 1 de octubre no avisa', () => {
    expect(shouldRemindNextYearHolidays('2026-09-30', 0)).toBe(false)
    expect(shouldRemindNextYearHolidays('2026-01-15', 0)).toBe(false)
  })

  it('desde el 1 de octubre avisa si el año siguiente no tiene feriados', () => {
    expect(shouldRemindNextYearHolidays('2026-10-01', 0)).toBe(true)
    expect(shouldRemindNextYearHolidays('2026-12-31', 0)).toBe(true)
  })

  it('si ya hay feriados cargados no avisa', () => {
    expect(shouldRemindNextYearHolidays('2026-10-09', 3)).toBe(false)
  })

  it('mientras la consulta no respondió no avisa', () => {
    expect(shouldRemindNextYearHolidays('2026-10-09', undefined)).toBe(false)
  })
})

describe('nextYearOf / describeNationalHolidaysLoad', () => {
  it('calcula el año siguiente', () => {
    expect(nextYearOf('2026-10-09')).toBe(2027)
  })

  it('describe el resultado de la carga', () => {
    expect(
      describeNationalHolidaysLoad(2027, {
        created: 12,
        reactivated: 0,
        skipped: 1,
      }),
    ).toBe('Feriados nacionales de 2027: 12 nuevos, 1 ya existían.')
    expect(
      describeNationalHolidaysLoad(2027, {
        created: 0,
        reactivated: 0,
        skipped: 0,
      }),
    ).toBe('No agregamos feriados nuevos de 2027.')
  })
})
