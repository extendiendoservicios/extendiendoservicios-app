import { describe, expect, it } from 'vitest'
import {
  applyTimeEdit,
  dateAtPoint,
  formatMonthParam,
  monthDates,
  moveToDate,
  parseMonthParam,
  resolveMonth,
} from '@/features/employees/calendarioMonth'
import type { WeekBlock } from '@/features/employees/cronogramaWeek'

function block(over: Partial<WeekBlock> = {}): WeekBlock {
  return {
    assignmentId: 'a1',
    shiftId: 's1',
    date: '2026-11-03',
    siteId: 'si1',
    siteName: 'Sede Central',
    clientName: 'Cliente',
    colorIndex: 0,
    startMin: 8 * 60 + 5,
    endMin: 12 * 60,
    openEnded: false,
    assignedCount: 1,
    shiftStartMin: 8 * 60 + 5,
    shiftEndMin: 12 * 60,
    ...over,
  }
}

describe('mes en la dirección (OH-03)', () => {
  it('lee y escribe YYYY-MM', () => {
    expect(parseMonthParam('2027-01')).toEqual({ year: 2027, month: 1 })
    expect(formatMonthParam(2027, 1)).toBe('2027-01')
  })

  it('un valor roto o fuera de rango no es un mes', () => {
    expect(parseMonthParam(null)).toBeNull()
    expect(parseMonthParam('2027-13')).toBeNull()
    expect(parseMonthParam('enero')).toBeNull()
  })

  it('sin mes válido usa el mes de hoy', () => {
    const today = new Date(2026, 10, 18)
    expect(resolveMonth(null, today)).toEqual({ year: 2026, month: 11 })
    expect(resolveMonth('2027-02', today)).toEqual({ year: 2027, month: 2 })
  })

  it('lista todas las fechas del mes', () => {
    const dates = monthDates(2028, 2)
    expect(dates).toHaveLength(29)
    expect(dates[0]).toBe('2028-02-01')
    expect(dates[28]).toBe('2028-02-29')
  })
})

describe('arrastre entre días', () => {
  const rects = [
    { date: '2026-11-03', left: 0, right: 100, top: 0, bottom: 80 },
    { date: '2026-11-04', left: 100, right: 200, top: 0, bottom: 80 },
    { date: '2026-11-10', left: 0, right: 100, top: 80, bottom: 160 },
  ]

  it('encuentra el día bajo el puntero', () => {
    expect(dateAtPoint(rects, 150, 10)).toBe('2026-11-04')
    expect(dateAtPoint(rects, 10, 100)).toBe('2026-11-10')
  })

  it('fuera de las celdas no hay día', () => {
    expect(dateAtPoint(rects, 500, 500)).toBeNull()
  })

  it('mover de día mantiene el horario exacto, sin redondear', () => {
    expect(moveToDate(block(), '2026-11-10')).toEqual({
      date: '2026-11-10',
      startMin: 485,
      endMin: 720,
    })
  })
})

describe('edición de una hora en el lugar', () => {
  it('cambia el inicio y conserva el fin', () => {
    expect(applyTimeEdit(block(), 'start', '09:00')).toEqual({
      ok: true,
      next: { date: '2026-11-03', startMin: 540, endMin: 720 },
    })
  })

  it('cambia el fin y conserva el inicio', () => {
    expect(applyTimeEdit(block(), 'end', '13:30')).toEqual({
      ok: true,
      next: { date: '2026-11-03', startMin: 485, endMin: 810 },
    })
  })

  it('rechaza un fin anterior o igual al inicio', () => {
    expect(applyTimeEdit(block(), 'end', '08:05')).toMatchObject({ ok: false })
    expect(applyTimeEdit(block(), 'start', '12:00')).toMatchObject({
      ok: false,
    })
  })

  it('rechaza una hora vacía', () => {
    expect(applyTimeEdit(block(), 'start', '')).toMatchObject({
      ok: false,
      message: 'Ingresá una hora válida.',
    })
  })

  it('en un turno «A terminar» el inicio mueve el bloque con su duración', () => {
    const open = block({ openEnded: true, startMin: 480, endMin: 540 })
    expect(applyTimeEdit(open, 'start', '10:00')).toEqual({
      ok: true,
      next: { date: '2026-11-03', startMin: 600, endMin: 660 },
    })
  })
})
