import { describe, expect, it } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import {
  buildCronogramaMonth,
  cronogramaTitle,
  leaveLabel,
  monthRange,
} from './cronograma'

function assignment(over: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-03',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Prueba',
    siteId: 'si1',
    siteName: 'Sede Central',
    clientName: 'Cliente',
    clientId: 'c1',
    clientCalendarColor: 2,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...over,
  }
}

function dayOf(month: ReturnType<typeof buildCronogramaMonth>, date: string) {
  return month.weeks.flat().find((day) => day.date === date)!
}

const base = {
  year: 2026,
  month: 11,
  assignments: [] as AssignmentBoardRow[],
  leaves: [],
  holidays: [],
}

describe('cronograma: licencias superpuestas (OF-20)', () => {
  it('muestra todas las licencias del mismo día', () => {
    const month = buildCronogramaMonth({
      ...base,
      leaves: [
        {
          id: 'l1',
          startsOn: '2026-11-02',
          endsOn: '2026-11-06',
          reason: 'Vacaciones',
          deletedAt: null,
        },
        {
          id: 'l2',
          startsOn: '2026-11-04',
          endsOn: '2026-11-05',
          reason: 'Enfermedad',
          deletedAt: null,
        },
      ],
    })
    expect(dayOf(month, '2026-11-03').label).toBe('VACACIONES')
    expect(dayOf(month, '2026-11-04').label).toBe('VACACIONES / ENFERMEDAD')
    expect(dayOf(month, '2026-11-04').kind).toBe('leave')
  })
})

describe('cronograma: estructura del mes', () => {
  it('título, rango y semanas de lunes a domingo', () => {
    expect(cronogramaTitle(2026, 11)).toBe('MES DE NOVIEMBRE 2026')
    expect(monthRange(2026, 2)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
    const month = buildCronogramaMonth(base)
    // Noviembre de 2026 empieza en domingo: 6 semanas (26 oct al 6 dic).
    expect(month.weeks).toHaveLength(6)
    expect(month.weeks[0]![0]!.date).toBe('2026-10-26')
    expect(month.weeks[0]![6]!.date).toBe('2026-11-01')
    expect(month.weeks[0]![0]!.inMonth).toBe(false)
    expect(month.weeks[0]![6]!.inMonth).toBe(true)
    expect(month.weeks[5]![6]!.date).toBe('2026-12-06')
    expect(month.weeks.every((week) => week.length === 7)).toBe(true)
  })

  it('febrero de 2027 (empieza lunes) ocupa 4 semanas', () => {
    const month = buildCronogramaMonth({ ...base, year: 2027, month: 2 })
    expect(month.weeks).toHaveLength(4)
    expect(month.weeks[0]![0]!.date).toBe('2027-02-01')
  })

  it('un día sin nada queda vacío', () => {
    expect(dayOf(buildCronogramaMonth(base), '2026-11-10')).toMatchObject({
      kind: 'empty',
      shifts: [],
    })
  })
})

describe('cronograma: turnos', () => {
  it('apila los turnos del día por hora, con sede en mayúsculas y color del cliente', () => {
    const month = buildCronogramaMonth({
      ...base,
      assignments: [
        assignment({
          id: 'b',
          startTime: '14:00:00',
          endTime: '18:30:00',
          siteName: 'Torre Sur',
          clientCalendarColor: 5,
        }),
        assignment({ id: 'a' }),
      ],
    })
    const day = dayOf(month, '2026-11-03')
    expect(day.kind).toBe('shifts')
    expect(day.shifts).toEqual([
      {
        key: 'a',
        start: '08:00',
        end: '12:00',
        site: 'SEDE CENTRAL',
        colorIndex: 2,
      },
      {
        key: 'b',
        start: '14:00',
        end: '18:30',
        site: 'TORRE SUR',
        colorIndex: 5,
      },
    ])
  })

  it('incluye los turnos futuros, descarta los cancelados y marca el turno abierto', () => {
    const month = buildCronogramaMonth({
      ...base,
      assignments: [
        assignment({
          id: 'x',
          shiftDate: '2026-11-04',
          shiftStatus: 'cancelled',
        }),
        assignment({
          id: 'o',
          shiftDate: '2026-11-05',
          openEnded: true,
          endTime: '23:59:00',
        }),
      ],
    })
    expect(dayOf(month, '2026-11-04').kind).toBe('empty')
    expect(dayOf(month, '2026-11-05').shifts[0]!.end).toBe('A terminar')
    const future = buildCronogramaMonth({
      ...base,
      year: 2027,
      month: 1,
      assignments: [assignment({ id: 'f', shiftDate: '2027-01-15' })],
    })
    expect(dayOf(future, '2027-01-15').kind).toBe('shifts')
  })
})

describe('cronograma: días especiales', () => {
  it('licencia: el motivo en mayúsculas, o LICENCIA sin motivo', () => {
    expect(leaveLabel({ reason: ' Franco ' })).toBe('FRANCO')
    expect(leaveLabel({ reason: null })).toBe('LICENCIA')
    const month = buildCronogramaMonth({
      ...base,
      leaves: [
        {
          id: 'l1',
          startsOn: '2026-11-09',
          endsOn: '2026-11-10',
          reason: 'Vacaciones',
          deletedAt: null,
        },
        {
          id: 'l2',
          startsOn: '2026-11-20',
          endsOn: null,
          reason: null,
          deletedAt: null,
        },
        {
          id: 'l3',
          startsOn: '2026-11-12',
          endsOn: '2026-11-12',
          reason: 'Baja',
          deletedAt: '2026-11-01T00:00:00Z',
        },
      ],
    })
    expect(dayOf(month, '2026-11-08').kind).toBe('empty')
    expect(dayOf(month, '2026-11-09')).toMatchObject({
      kind: 'leave',
      label: 'VACACIONES',
    })
    expect(dayOf(month, '2026-11-10').label).toBe('VACACIONES')
    expect(dayOf(month, '2026-11-11').kind).toBe('empty')
    expect(dayOf(month, '2026-11-12').kind).toBe('empty')
    // Abierta: hasta el fin del mes.
    expect(dayOf(month, '2026-11-30')).toMatchObject({
      kind: 'leave',
      label: 'LICENCIA',
    })
  })

  it('feriado: celda entera; con turnos los muestra marcados; la licencia manda', () => {
    const month = buildCronogramaMonth({
      ...base,
      holidays: [
        { holidayDate: '2026-11-23', deletedAt: null },
        { holidayDate: '2026-11-03', deletedAt: null },
        { holidayDate: '2026-11-17', deletedAt: '2026-10-01T00:00:00Z' },
      ],
      assignments: [assignment({})],
      leaves: [
        {
          id: 'l',
          startsOn: '2026-11-23',
          endsOn: '2026-11-23',
          reason: 'Franco',
          deletedAt: null,
        },
      ],
    })
    expect(dayOf(month, '2026-11-23')).toMatchObject({
      kind: 'leave',
      label: 'FRANCO',
    })
    expect(dayOf(month, '2026-11-03')).toMatchObject({
      kind: 'shifts',
      holiday: true,
    })
    expect(dayOf(month, '2026-11-17').kind).toBe('empty')
    const plain = buildCronogramaMonth({
      ...base,
      holidays: [{ holidayDate: '2026-11-23', deletedAt: null }],
    })
    expect(dayOf(plain, '2026-11-23')).toMatchObject({
      kind: 'holiday',
      label: 'FERIADO',
    })
  })
})
