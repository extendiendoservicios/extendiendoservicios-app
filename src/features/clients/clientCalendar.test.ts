import { describe, expect, it } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import {
  buildClientCalendarMonth,
  describeFilters,
  employeeOptions,
  shortPersonName,
  uncoveredLabel,
  visibleBlocks,
} from './clientCalendar'

function shift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 's1',
    clientId: 'c1',
    clientName: 'Cliente',
    clientCalendarColor: 2,
    siteId: 'site1',
    siteName: 'Sede Norte',
    siteCity: null,
    shiftDate: '2026-11-10',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 1,
    status: 'scheduled',
    displayStatus: 'scheduled',
    openEnded: false,
    assignedCount: 0,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    noCheckoutCount: 0,
    generated: false,
    notes: null,
    ...overrides,
  }
}

function person(
  shiftId: string,
  employeeId: string,
  first: string,
  last: string,
) {
  return {
    shiftId,
    employeeId,
    employeeFirstName: first,
    employeeLastName: last,
  }
}

function build(
  shifts: ShiftListRow[],
  assignments: ReturnType<typeof person>[] = [],
  holidays: {
    holidayDate: string
    name: string | null
    deletedAt: string | null
  }[] = [],
) {
  return buildClientCalendarMonth({
    year: 2026,
    month: 11,
    shifts,
    assignments,
    holidays,
  })
}

function at<T>(list: T[], index: number): T {
  const item = list.at(index)
  if (item === undefined) {
    throw new Error(`No hay elemento en ${index}`)
  }
  return item
}

function day(month: ReturnType<typeof build>, date: string) {
  const found = month.weeks.flat().find((d) => d.date === date)
  if (!found) {
    throw new Error(`No existe el día ${date}`)
  }
  return found
}

describe('shortPersonName', () => {
  it('arma nombre e inicial del apellido', () => {
    expect(shortPersonName('Ana', 'pérez')).toBe('Ana P.')
    expect(shortPersonName('Ana', '')).toBe('Ana')
  })
})

describe('buildClientCalendarMonth', () => {
  it('arma semanas de lunes a domingo con días fuera del mes', () => {
    const month = build([])
    expect(month.title).toBe('MES DE NOVIEMBRE 2026')
    expect(at(at(month.weeks, 0), 0).date).toBe('2026-10-26')
    expect(at(at(month.weeks, 0), 0).inMonth).toBe(false)
    // El 30 de noviembre de 2026 es lunes: la última semana es casi toda de diciembre.
    expect(at(at(month.weeks, -1), 0).date).toBe('2026-11-30')
    expect(at(at(month.weeks, -1), 0).inMonth).toBe(true)
    expect(at(at(month.weeks, -1), 6).date).toBe('2026-12-06')
    expect(at(at(month.weeks, -1), 6).inMonth).toBe(false)
  })

  it('agrupa por día y ordena por hora y sede', () => {
    const month = build([
      shift({ id: 'a', startTime: '14:00:00', siteName: 'Zeta' }),
      shift({ id: 'b', startTime: '08:00:00', siteName: 'Sur' }),
      shift({ id: 'c', startTime: '08:00:00', siteName: 'Norte' }),
      shift({ id: 'd', shiftDate: '2026-11-11' }),
    ])
    expect(day(month, '2026-11-10').blocks.map((b) => b.shiftId)).toEqual([
      'c',
      'b',
      'a',
    ])
    expect(day(month, '2026-11-11').blocks).toHaveLength(1)
  })

  it('arma las personas con nombre corto y calcula faltantes', () => {
    const month = build(
      [shift({ id: 's1', requiredStaff: 3 })],
      [
        person('s1', 'e2', 'Luis', 'Gómez'),
        person('s1', 'e1', 'Ana', 'Pérez'),
        person('s1', 'e1', 'Ana', 'Pérez'),
      ],
    )
    const block = at(day(month, '2026-11-10').blocks, 0)
    expect(block.people.map((p) => p.shortName)).toEqual(['Ana P.', 'Luis G.'])
    expect(block.missing).toBe(1)
    expect(block.uncovered).toBe(false)
  })

  it('marca sin cubrir y cuenta los del mes sin contar cancelados ni finalizados', () => {
    const month = build([
      shift({ id: 'a' }),
      shift({ id: 'b', shiftDate: '2026-11-12' }),
      shift({ id: 'c', status: 'cancelled' }),
      shift({ id: 'd', status: 'completed' }),
    ])
    expect(month.uncoveredCount).toBe(2)
    const cancelled = day(month, '2026-11-10').blocks.find(
      (b) => b.shiftId === 'c',
    )
    expect(cancelled?.cancelled).toBe(true)
    expect(cancelled?.uncovered).toBe(false)
  })

  it('un turno a terminar muestra el fin como guion largo', () => {
    const month = build([shift({ openEnded: true, endTime: '23:59:00' })])
    expect(at(day(month, '2026-11-10').blocks, 0).end).toBe('—')
  })

  it('pone el nombre del feriado vigente y salta los dados de baja', () => {
    const month = build(
      [],
      [],
      [
        { holidayDate: '2026-11-23', name: 'Soberanía', deletedAt: null },
        { holidayDate: '2026-11-24', name: 'Baja', deletedAt: '2026-01-01' },
      ],
    )
    expect(day(month, '2026-11-23').holiday).toBe('Soberanía')
    expect(day(month, '2026-11-24').holiday).toBeUndefined()
  })
})

describe('visibleBlocks', () => {
  const month = build(
    Array.from({ length: 6 }, (_, i) => shift({ id: `s${i}` })),
  )
  const blocks = day(month, '2026-11-10').blocks

  it('muestra hasta 4 y cuenta el resto', () => {
    const { shown, hidden } = visibleBlocks(blocks, false)
    expect(shown).toHaveLength(4)
    expect(hidden).toBe(2)
  })

  it('desplegado muestra todos', () => {
    expect(visibleBlocks(blocks, true)).toEqual({ shown: blocks, hidden: 0 })
  })
})

describe('filtros', () => {
  it('lista a quienes tienen asignaciones, sin repetir y por apellido', () => {
    expect(
      employeeOptions([
        person('s1', 'e1', 'Ana', 'Pérez'),
        person('s2', 'e1', 'Ana', 'Pérez'),
        person('s1', 'e2', 'Luis', 'Gómez'),
      ]),
    ).toEqual([
      { employeeId: 'e2', name: 'Gómez, Luis' },
      { employeeId: 'e1', name: 'Pérez, Ana' },
    ])
  })

  it('describe los filtros aplicados', () => {
    expect(describeFilters({})).toBe(
      'Sede: todas las sedes · Empleado: todos los empleados',
    )
    expect(
      describeFilters({ siteName: 'Norte', employeeName: 'Pérez, Ana' }),
    ).toBe('Sede: Norte · Empleado: Pérez, Ana')
  })

  it('pluraliza el aviso de sin cubrir', () => {
    expect(uncoveredLabel(1)).toBe('1 turno sin cubrir este mes')
    expect(uncoveredLabel(3)).toBe('3 turnos sin cubrir este mes')
  })
})
