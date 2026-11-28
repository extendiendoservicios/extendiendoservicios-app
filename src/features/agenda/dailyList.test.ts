import { describe, expect, it } from 'vitest'
import type { AssignmentBoardRow } from '@/api/assignments'
import {
  buildDailyEmployeeList,
  formatEmployeeNumber,
  formatShiftTimeLabel,
} from './dailyList'

function row(overrides: Partial<AssignmentBoardRow>): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 's1',
    shiftDate: '2026-11-28',
    shiftStatus: 'assigned',
    employeeId: 'e1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Pérez',
    siteId: 'site1',
    siteName: 'Sede Centro',
    clientName: 'Cliente SA',
    clientId: 'c1',
    clientCalendarColor: null,
    startTime: '08:00:00',
    endTime: '12:00:00',
    openEnded: false,
    status: 'expected',
    notes: null,
    ...overrides,
  }
}

const employees = [
  { profileId: 'e1', name: 'Ana Pérez', employeeNumber: 12 },
  { profileId: 'e2', name: 'Beto Gómez', employeeNumber: 3 },
  { profileId: 'e3', name: 'Carla Ruiz', employeeNumber: 105 },
]

describe('lista diaria de empleados de la Agenda', () => {
  it('muestra el legajo con tres dígitos', () => {
    expect(formatEmployeeNumber(1)).toBe('001')
    expect(formatEmployeeNumber(42)).toBe('042')
    expect(formatEmployeeNumber(1234)).toBe('1234')
  })

  it('ordena por legajo, no por nombre ni por orden de llegada', () => {
    const list = buildDailyEmployeeList({
      assignments: [
        row({ id: 'a1', employeeId: 'e3' }),
        row({ id: 'a2', employeeId: 'e1', shiftId: 's2' }),
        row({ id: 'a3', employeeId: 'e2', shiftId: 's3' }),
      ],
      employees,
      colors: [],
    })
    expect(list.map((entry) => entry.label)).toEqual([
      '003 Beto Gómez',
      '012 Ana Pérez',
      '105 Carla Ruiz',
    ])
  })

  it('agrupa los turnos de una persona por hora y trae su color', () => {
    const list = buildDailyEmployeeList({
      assignments: [
        row({
          id: 'a1',
          shiftId: 's1',
          startTime: '14:00:00',
          endTime: '18:00:00',
        }),
        row({
          id: 'a2',
          shiftId: 's2',
          startTime: '08:00:00',
          endTime: '12:00:00',
        }),
      ],
      employees,
      colors: [{ employeeId: 'e1', borderColor: 2, fillColor: 12 }],
    })
    expect(list).toHaveLength(1)
    expect(list[0]?.shifts.map((s) => s.timeLabel)).toEqual([
      '08:00 a 12:00',
      '14:00 a 18:00',
    ])
    expect(list[0]?.borderColor).toBe(2)
    expect(list[0]?.fillColor).toBe(12)
  })

  it('deja afuera los turnos cancelados y cuenta las otras personas del turno', () => {
    const list = buildDailyEmployeeList({
      assignments: [
        row({ id: 'a1', shiftId: 's1', employeeId: 'e1' }),
        row({ id: 'a2', shiftId: 's1', employeeId: 'e2' }),
        row({
          id: 'a3',
          shiftId: 's9',
          employeeId: 'e3',
          shiftStatus: 'cancelled',
        }),
      ],
      employees,
      colors: [],
    })
    expect(list.map((entry) => entry.employeeId)).toEqual(['e2', 'e1'])
    expect(list[0]?.shifts[0]?.otherPeopleCount).toBe(1)
  })

  it('manda al final a quien no figura entre los activos, sin legajo', () => {
    const list = buildDailyEmployeeList({
      assignments: [
        row({
          id: 'a1',
          employeeId: 'zz',
          employeeFirstName: 'Zoe',
          employeeLastName: 'Díaz',
        }),
        row({ id: 'a2', employeeId: 'e2', shiftId: 's2' }),
      ],
      employees,
      colors: [],
    })
    expect(list.map((entry) => entry.label)).toEqual([
      '003 Beto Gómez',
      'Zoe Díaz',
    ])
  })

  it('arma el horario efectivo, también para turnos «a terminar»', () => {
    expect(formatShiftTimeLabel('08:00:00', '12:30:00', false)).toBe(
      '08:00 a 12:30',
    )
    expect(formatShiftTimeLabel('08:00:00', '23:59:00', true)).toBe(
      'Desde 08:00 (a terminar)',
    )
  })
})
