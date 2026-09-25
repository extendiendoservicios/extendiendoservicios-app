import { describe, expect, it } from 'vitest'
import type { ShiftListRow } from '@/api/shifts'
import { groupShiftsByFranja, shiftFranjaKey } from './grouping'

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

describe('shiftFranjaKey', () => {
  it('arma "HH:MM–HH:MM" sin segundos', () => {
    expect(shiftFranjaKey({ startTime: '08:00:00', endTime: '16:00:00' })).toBe(
      '08:00–16:00',
    )
  })
})

describe('groupShiftsByFranja', () => {
  it('agrupa turnos consecutivos con la misma franja y ordena por hora', () => {
    const shifts = [
      makeShift({ id: 's2', startTime: '14:00:00', endTime: '18:00:00' }),
      makeShift({ id: 's1', startTime: '08:00:00', endTime: '12:00:00' }),
      makeShift({ id: 's3', startTime: '08:00:00', endTime: '12:00:00' }),
    ]

    const groups = groupShiftsByFranja(shifts)

    expect(groups).toEqual([
      { franja: '08:00–12:00', shifts: [shifts[1], shifts[2]] },
      { franja: '14:00–18:00', shifts: [shifts[0]] },
    ])
  })

  it('con la misma franja repartida en dos turnos con otra franja en el medio, ordena por hora y junta las dos del mismo horario', () => {
    const shifts = [
      makeShift({
        id: 's1',
        siteId: 'a',
        startTime: '08:00:00',
        endTime: '12:00:00',
      }),
      makeShift({
        id: 's2',
        siteId: 'b',
        startTime: '09:00:00',
        endTime: '11:00:00',
      }),
      makeShift({
        id: 's3',
        siteId: 'c',
        startTime: '08:00:00',
        endTime: '12:00:00',
      }),
    ]

    const groups = groupShiftsByFranja(shifts)

    // Al ordenar por hora de inicio, las dos franjas "08:00–12:00" quedan
    // adyacentes (antes que "09:00–11:00") y se agrupan en un solo bloque.
    expect(groups.map((g) => g.franja)).toEqual(['08:00–12:00', '09:00–11:00'])
    expect(groups[0]?.shifts.map((s) => s.id)).toEqual(['s1', 's3'])
  })
})
