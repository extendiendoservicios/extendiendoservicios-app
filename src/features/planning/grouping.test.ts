import { describe, expect, it } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import type { AssignmentBoardRow } from '@/api/assignments'
import {
  groupAssignmentsByEmployeeAndDate,
  groupShiftsByDate,
  shiftChipLabel,
} from './grouping'

function makeShift(overrides: Partial<ShiftListRow> = {}): ShiftListRow {
  return {
    id: 'sh1',
    clientId: 'c1',
    clientName: 'Limpia Ya',
    siteId: 'si1',
    siteName: 'Sede Centro',
    siteCity: 'CABA',
    shiftDate: '2026-10-05',
    startTime: '08:00:00',
    endTime: '12:00:00',
    requiredStaff: 2,
    status: 'scheduled',
    displayStatus: 'scheduled',
    assignedCount: 0,
    presentCount: 0,
    finishedCount: 0,
    absentCount: 0,
    delayedCount: 0,
    generated: true,
    notes: null,
    ...overrides,
  }
}

function makeAssignment(
  overrides: Partial<AssignmentBoardRow> = {},
): AssignmentBoardRow {
  return {
    id: 'a1',
    shiftId: 'sh1',
    shiftDate: '2026-10-05',
    shiftStatus: 'assigned',
    employeeId: 'emp1',
    employeeFirstName: 'Ana',
    employeeLastName: 'Gómez',
    siteId: 'si1',
    siteName: 'Sede Centro',
    clientName: 'Limpia Ya',
    startTime: '08:00:00',
    endTime: '12:00:00',
    status: 'expected',
    notes: null,
    ...overrides,
  }
}

describe('groupShiftsByDate', () => {
  it('agrupa por shiftDate y preserva el orden de llegada dentro de cada día', () => {
    const shifts = [
      makeShift({ id: 's1', shiftDate: '2026-10-05' }),
      makeShift({ id: 's2', shiftDate: '2026-10-06' }),
      makeShift({ id: 's3', shiftDate: '2026-10-05' }),
    ]

    const grouped = groupShiftsByDate(shifts)

    expect(grouped.get('2026-10-05')?.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(grouped.get('2026-10-06')?.map((s) => s.id)).toEqual(['s2'])
  })

  it('con 600 turnos arma el mapa sin descartar ninguno', () => {
    const shifts = Array.from({ length: 600 }, (_, index) =>
      makeShift({
        id: `s${index}`,
        shiftDate: `2026-10-${String((index % 28) + 1).padStart(2, '0')}`,
      }),
    )

    const grouped = groupShiftsByDate(shifts)
    const total = Array.from(grouped.values()).reduce(
      (acc, list) => acc + list.length,
      0,
    )
    expect(total).toBe(600)
  })
})

describe('groupAssignmentsByEmployeeAndDate', () => {
  it('agrupa por empleado y, dentro de cada empleado, por fecha', () => {
    const assignments = [
      makeAssignment({ id: 'a1', employeeId: 'emp1', shiftDate: '2026-10-05' }),
      makeAssignment({ id: 'a2', employeeId: 'emp1', shiftDate: '2026-10-06' }),
      makeAssignment({ id: 'a3', employeeId: 'emp2', shiftDate: '2026-10-05' }),
    ]

    const grouped = groupAssignmentsByEmployeeAndDate(assignments)

    expect(
      grouped
        .get('emp1')
        ?.get('2026-10-05')
        ?.map((a) => a.id),
    ).toEqual(['a1'])
    expect(
      grouped
        .get('emp1')
        ?.get('2026-10-06')
        ?.map((a) => a.id),
    ).toEqual(['a2'])
    expect(
      grouped
        .get('emp2')
        ?.get('2026-10-05')
        ?.map((a) => a.id),
    ).toEqual(['a3'])
  })
})

describe('shiftChipLabel', () => {
  it('arma "cliente · sede · franja"', () => {
    expect(shiftChipLabel(makeShift())).toBe(
      'Limpia Ya · Sede Centro · 08:00–12:00',
    )
  })
})
