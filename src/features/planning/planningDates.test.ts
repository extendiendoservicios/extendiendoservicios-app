import { describe, expect, it } from 'vitest'
import {
  addMonthsToYearMonth,
  addWeeksToIsoDate,
  buildMonthGridDays,
  monthRange,
  startOfWeekIso,
  weekDaysIso,
} from './planningDates'

describe('monthRange', () => {
  it('devuelve el primer y el último día del mes', () => {
    expect(monthRange(2026, 2)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('respeta los meses de 31 días', () => {
    expect(monthRange(2026, 10)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    })
  })
})

describe('startOfWeekIso', () => {
  it('un jueves devuelve el lunes de esa semana', () => {
    // 2026-10-08 es jueves.
    expect(startOfWeekIso('2026-10-08')).toBe('2026-10-05')
  })

  it('un lunes se devuelve a sí mismo', () => {
    expect(startOfWeekIso('2026-10-05')).toBe('2026-10-05')
  })

  it('un domingo devuelve el lunes anterior', () => {
    // 2026-10-11 es domingo.
    expect(startOfWeekIso('2026-10-11')).toBe('2026-10-05')
  })
})

describe('weekDaysIso', () => {
  it('devuelve los 7 días de lunes a domingo', () => {
    expect(weekDaysIso('2026-10-05')).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ])
  })
})

describe('addWeeksToIsoDate', () => {
  it('suma una semana', () => {
    expect(addWeeksToIsoDate('2026-10-05', 1)).toBe('2026-10-12')
  })

  it('resta una semana', () => {
    expect(addWeeksToIsoDate('2026-10-05', -1)).toBe('2026-09-28')
  })
})

describe('addMonthsToYearMonth', () => {
  it('avanza un mes cruzando el año', () => {
    expect(addMonthsToYearMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
  })

  it('retrocede un mes cruzando el año', () => {
    expect(addMonthsToYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })
})

describe('buildMonthGridDays', () => {
  it('cubre semanas completas (lunes a domingo) y marca los días fuera del mes', () => {
    // Octubre 2026 empieza jueves 1° y termina sábado 31.
    const days = buildMonthGridDays(2026, 10)

    expect(days[0]?.date).toBe('2026-09-28') // lunes anterior al 1°
    expect(days[0]?.isCurrentMonth).toBe(false)
    expect(days).toContainEqual({ date: '2026-10-01', isCurrentMonth: true })
    expect(days).toContainEqual({ date: '2026-10-31', isCurrentMonth: true })
    expect(days.length % 7).toBe(0)
    // El último día es un domingo: la semana que contiene el 31 (sábado) sigue hasta el domingo 1/11.
    expect(days[days.length - 1]?.date).toBe('2026-11-01')
    expect(days[days.length - 1]?.isCurrentMonth).toBe(false)
  })
})
